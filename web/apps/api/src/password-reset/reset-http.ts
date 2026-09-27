import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AuthCookieNames } from '../auth/config.ts';
import { AUTH_BODY_LIMIT, INTERNAL_ERROR, errorName, expiredCookie } from '../auth/http.ts';
import type { PasswordResetService, ResetRefusal } from './password-reset.ts';

/**
 * Password reset over HTTP (DEC-441, DEC-442, DEC-487).
 *
 * Three routes, each classified `password-reset`: the authentication guard
 * refuses any request without an exact trusted Origin before the handler
 * runs, and no session is ever read. Each handler requires a JSON body of
 * exactly the approved shape, so a cross-site form post can never reach the
 * service. Every response is `no-store` and `no-referrer`.
 *
 * `request` answers every well-formed body with one identical `202`; only the
 * per-network-source limit answers `429` (DEC-487 (5)). The token arrives only
 * in a POST body. Nothing a request carries is logged: failures are logged by
 * error name only.
 */

export const PASSWORD_RESET_PATHS = {
  request: '/api/password-reset/request',
  inspect: '/api/password-reset/inspect',
  complete: '/api/password-reset/complete',
} as const;

export interface PasswordResetRoutesDependencies {
  resets: PasswordResetService;
  cookies: AuthCookieNames;
}

/** The one response every accepted request receives, known address or not. */
const REQUESTED = { status: 'requested' } as const;
const MAX_RETRY_AFTER_SECONDS = 3600;

type Body = Record<string, unknown>;

function shaped(body: unknown, keys: string[]): Body | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]) ? (body as Body) : null;
}

function isJson(request: FastifyRequest): boolean {
  const type = request.headers['content-type'];
  return typeof type === 'string' && /^application\/json\s*(;|$)/i.test(type);
}

function tooMany(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  reply.header('retry-after', String(Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(retryAfterSeconds)))));
  return reply.code(429).send({ error: 'too_many_requests' });
}

function refused(reply: FastifyReply, result: ResetRefusal): FastifyReply {
  switch (result.error) {
    case 'rate_limited':
      return tooMany(reply, result.retryAfterSeconds);
    case 'password_rejected':
      return reply.code(400).send({ error: 'password_rejected', reason: result.reason });
    case 'reset_failed':
      return reply.code(500).send({ error: 'reset_failed' });
    default:
      return reply.code(400).send({ error: 'reset_link_invalid' });
  }
}

export function registerPasswordResetRoutes(app: FastifyInstance, deps: PasswordResetRoutesDependencies): void {
  if (typeof deps?.resets?.request !== 'function' || !deps.cookies?.sessionToken || !deps.cookies.twoFactor) {
    throw new Error('Password reset requires its service and the authentication cookie names.');
  }

  const options = {
    config: { access: 'password-reset' as const },
    bodyLimit: AUTH_BODY_LIMIT,
    // Runs before the authentication guard, so even its refusals carry these.
    onRequest: async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header('cache-control', 'no-store');
      reply.header('referrer-policy', 'no-referrer');
    },
  };

  function route(path: string, step: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>) {
    app.post(path, options, async (request, reply) => {
      if (!isJson(request)) return reply.code(415).send({ error: 'unsupported_media_type' });
      try {
        return await step(request, reply);
      } catch (error) {
        request.log.error({ errorName: errorName(error) }, 'password reset failed');
        return reply.code(500).send(INTERNAL_ERROR);
      }
    });
  }

  route(PASSWORD_RESET_PATHS.request, async (request, reply) => {
    const body = shaped(request.body, ['email']);
    if (body === null || typeof body.email !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    const result = await deps.resets.request({ email: body.email }, request.ip);
    return result.ok ? reply.code(202).send(REQUESTED) : tooMany(reply, result.retryAfterSeconds);
  });

  route(PASSWORD_RESET_PATHS.inspect, async (request, reply) => {
    const body = shaped(request.body, ['token']);
    if (body === null) return reply.code(400).send({ error: 'invalid_request' });
    const result = await deps.resets.inspect({ token: body.token }, request.ip);
    return result.ok ? reply.code(200).send({ next: 'choose_password' }) : refused(reply, result);
  });

  route(PASSWORD_RESET_PATHS.complete, async (request, reply) => {
    const body = shaped(request.body, ['token', 'newPassword']);
    if (body === null || typeof body.newPassword !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    const result = await deps.resets.complete({ token: body.token, newPassword: body.newPassword }, request.ip);
    if (!result.ok) return refused(reply, result);
    // Never signed in; any session this browser held has just ended.
    reply.header('set-cookie', [expiredCookie(deps.cookies.sessionToken), expiredCookie(deps.cookies.twoFactor)]);
    return reply.code(200).send({ signInRequired: true });
  });
}
