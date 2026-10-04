import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AuthCookieNames } from '../auth/config.ts';
import { AUTH_BODY_LIMIT, INTERNAL_ERROR, errorName, expiredCookie, requestCookie } from '../auth/http.ts';
import type { AcceptanceRefusal, InvitationAcceptance } from './invitation-acceptance.ts';

/**
 * Restricted Admin invitation acceptance over HTTP (DEC-440, DEC-442, DEC-444).
 *
 * Four routes, each classified `invitation`: the authentication guard refuses
 * any request without an exact trusted Origin before the handler runs. Each
 * handler then requires a JSON body of exactly the approved shape, so a
 * cross-site form post can never reach the service. Every response is
 * `no-store` and `no-referrer`.
 *
 * The token arrives only in a POST body, never in a URL. Responses carry only
 * the next step, the TOTP enrolment material the invitee must see, or the
 * recovery codes shown once; a failure is a fixed code that reveals no account
 * state beyond what the token holder already learned. Nothing a request
 * carries is logged: failures are logged by error name only.
 */

export const INVITATION_ACCEPTANCE_PATHS = {
  inspect: '/api/invitation/inspect',
  password: '/api/invitation/password',
  totp: '/api/invitation/totp',
  complete: '/api/invitation/complete',
} as const;

export interface AcceptanceRoutesDependencies {
  acceptance: InvitationAcceptance;
  cookies: AuthCookieNames;
}

const STATUS: Record<Exclude<AcceptanceRefusal['error'], 'rate_limited'>, number> = {
  invitation_invalid: 400,
  invalid_request: 400,
  invalid_name: 400,
  password_rejected: 400,
  invalid_password: 401,
  invalid_code: 401,
  unauthorized: 401,
  setup_in_progress: 409,
  setup_incomplete: 409,
};

const SIX_DIGITS = /^\d{6}$/;
const MAX_RETRY_AFTER_SECONDS = 3600;

type Body = Record<string, unknown>;

/** The body when it is a plain object with exactly one of the allowed key sets. */
function shaped(body: unknown, ...allowed: string[][]): Body | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body).sort();
  return allowed.some((set) => set.length === keys.length && [...set].sort().every((key, index) => key === keys[index]))
    ? (body as Body)
    : null;
}

function isJson(request: FastifyRequest): boolean {
  const type = request.headers['content-type'];
  return typeof type === 'string' && /^application\/json\s*(;|$)/i.test(type);
}

function signedOut(deps: AcceptanceRoutesDependencies): string[] {
  return [expiredCookie(deps.cookies.sessionToken), expiredCookie(deps.cookies.twoFactor)];
}

function refused(reply: FastifyReply, result: AcceptanceRefusal, deps: AcceptanceRoutesDependencies): FastifyReply {
  if (result.error === 'rate_limited') {
    reply.header('retry-after', String(Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(result.retryAfterSeconds)))));
    return reply.code(429).send({ error: 'too_many_requests' });
  }
  // Only an ended invitation clears cookies: its setup sessions were just
  // revoked. An unrecognised session (for example the Owner's own, in the same
  // browser) is refused but never signed out from here.
  if (result.error === 'invitation_invalid') reply.header('set-cookie', signedOut(deps));
  return reply.code(STATUS[result.error]).send({ error: result.error });
}

export function registerInvitationAcceptanceRoutes(app: FastifyInstance, deps: AcceptanceRoutesDependencies): void {
  if (typeof deps?.acceptance?.inspect !== 'function' || !deps.cookies?.sessionToken || !deps.cookies.twoFactor) {
    throw new Error('Invitation acceptance requires its service and the authentication cookie names.');
  }

  const options = {
    config: { access: 'invitation' as const },
    bodyLimit: AUTH_BODY_LIMIT,
    // Runs before the authentication guard, so even its refusals carry these.
    onRequest: async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header('cache-control', 'no-store');
      reply.header('referrer-policy', 'no-referrer');
    },
  };

  /** Common handling: JSON only, then the step, with unexpected failures logged by name only. */
  function route(path: string, step: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>) {
    app.post(path, options, async (request, reply) => {
      if (!isJson(request)) return reply.code(415).send({ error: 'unsupported_media_type' });
      try {
        return await step(request, reply);
      } catch (error) {
        request.log.error({ errorName: errorName(error) }, 'invitation acceptance failed');
        return reply.code(500).send(INTERNAL_ERROR);
      }
    });
  }

  route(INVITATION_ACCEPTANCE_PATHS.inspect, async (request, reply) => {
    const body = shaped(request.body, ['token']);
    if (body === null) return reply.code(400).send({ error: 'invalid_request' });
    const result = await deps.acceptance.inspect({ token: body.token }, request.ip);
    return result.ok ? reply.code(200).send({ next: result.next }) : refused(reply, result, deps);
  });

  route(INVITATION_ACCEPTANCE_PATHS.password, async (request, reply) => {
    const body = shaped(request.body, ['token', 'password'], ['token', 'name', 'password']);
    if (body === null || typeof body.password !== 'string' || ('name' in body && typeof body.name !== 'string')) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const result = await deps.acceptance.setPassword(
      { token: body.token, password: body.password, ...('name' in body ? { name: body.name } : {}) },
      request.ip,
    );
    if (!result.ok) return refused(reply, result, deps);
    if (result.setCookies.length > 0) reply.header('set-cookie', result.setCookies);
    return result.next === 'verify_totp'
      ? reply.code(200).send({ next: result.next, totpUri: result.totpUri, manualEntrySecret: result.manualEntrySecret })
      : reply.code(200).send({ next: result.next });
  });

  route(INVITATION_ACCEPTANCE_PATHS.totp, async (request, reply) => {
    // Exactly a code for the enrolment session, or a code, the invitation
    // token, and the password when an already verified factor is resumed.
    const body = shaped(request.body, ['code'], ['code', 'password', 'token']);
    if (
      body === null ||
      typeof body.code !== 'string' ||
      !SIX_DIGITS.test(body.code) ||
      ('password' in body && typeof body.password !== 'string')
    ) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const session = requestCookie(request, deps.cookies.sessionToken);
    const challenge = requestCookie(request, deps.cookies.twoFactor);
    const result = await deps.acceptance.verifyTotp(
      {
        sessionCookie: session === null ? null : `${deps.cookies.sessionToken}=${session}`,
        challengeCookie: challenge === null ? null : `${deps.cookies.twoFactor}=${challenge}`,
        code: body.code,
        ...('token' in body ? { token: body.token, password: body.password } : {}),
      },
      request.ip,
    );
    if (!result.ok) return refused(reply, result, deps);
    reply.header('set-cookie', result.setCookies);
    return reply.code(200).send({ recoveryCodes: result.recoveryCodes, next: 'acknowledge_recovery_codes' });
  });

  route(INVITATION_ACCEPTANCE_PATHS.complete, async (request, reply) => {
    const body = shaped(request.body, ['recoveryCodesSaved']);
    if (body === null || body.recoveryCodesSaved !== true) return reply.code(400).send({ error: 'acknowledgement_required' });
    const session = requestCookie(request, deps.cookies.sessionToken);
    const result = await deps.acceptance.complete(
      { sessionCookie: session === null ? null : `${deps.cookies.sessionToken}=${session}`, acknowledged: true },
      request.ip,
    );
    if (!result.ok) return refused(reply, result, deps);
    reply.header('set-cookie', signedOut(deps));
    return reply.code(200).send({ signInRequired: true });
  });
}
