import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { DROMEX_CLIENT_IP_HEADER, type AuthCookieNames } from './config.ts';
import {
  PrincipalAccessDeniedError,
  requireActivePrincipal,
  type Principal,
  type PrincipalRepository,
} from './principal.ts';
import type { TotpReplayGuard } from './totp-replay.ts';

/**
 * The HTTP authentication transport: the only way a browser reaches
 * authentication, and the request-time enforcement of route classification.
 *
 * Three rules shape everything here.
 *
 * 1. **A Better Auth session is necessary but never sufficient.** Every
 *    authenticated request also needs an active DROMEX principal and
 *    completed mandatory MFA, all read from the database on each request.
 *
 * 2. **A correct password is only the first step.** It yields a signed,
 *    five-minute MFA challenge cookie and nothing more. A session is
 *    returned only after a TOTP code verifies, the code is recorded against
 *    replay, and the full gate passes (DEC-434).
 *
 * 3. **Nothing reaches Better Auth unless it is on the allowlist.** There is
 *    no wildcard route. Four exact routes exist; every other path — sign-up,
 *    raw `get-session`, MFA enable or disable, recovery codes, OTP — is
 *    answered by a generic 404 that never touches Better Auth at all.
 */

/**
 * The seam between this transport and Better Auth. Sign-in, TOTP
 * verification, and sign-out go through Better Auth's router, which applies
 * its Origin and rate-limit middleware. Session resolution and revocation of
 * a session this transport refuses use the server API, which does neither.
 */
export interface AuthBackend {
  handle(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<Response>;
  /** Revokes the session named by the cookie in `headers`. */
  signOut(headers: Headers): Promise<Response>;
}

/**
 * The ordinary gate's view of Owner recovery (DEC-436): whether a Better Auth
 * session was ever bound to a recovery. Such a session never becomes an
 * ordinary session, whatever else is true of it. Throws on any failure.
 */
export interface RecoverySessionGate {
  isRecoverySession(sessionId: string): Promise<boolean>;
}

export interface AuthRoutesDependencies {
  backend: AuthBackend;
  principals: PrincipalRepository;
  replay: TotpReplayGuard;
  /** Denies every session ever bound to an Owner recovery. */
  recoverySessions: RecoverySessionGate;
  cookies: AuthCookieNames;
  /** Canonical origin used to build the internal request URL. */
  baseURL: string;
  /** Browser origins allowed to call state-changing cleanup and challenge routes. */
  trustedOrigins: readonly string[];
}

export interface AuthenticatedIdentity {
  user: { id: string; name: string; email: string };
  principal: Principal;
}

declare module 'fastify' {
  interface FastifyRequest {
    dromexIdentity: AuthenticatedIdentity | null;
  }
  interface FastifyContextConfig {
    /**
     * Required on every `recovery` route (DEC-436): the route's own recovery
     * gate. The authentication guard runs it and refuses the request unless
     * it resolves to exactly `true`; a recovery route without one is refused.
     */
    recoveryGate?: (request: FastifyRequest) => Promise<boolean>;
  }
}

const SIGN_IN_PATH = '/api/auth/sign-in/email';
const VERIFY_TOTP_PATH = '/api/auth/two-factor/verify-totp';
const SIGN_OUT_PATH = '/api/auth/sign-out';
const SESSION_PATH = '/api/session';

/** Credentials are small. Anything larger is refused before parsing. */
const AUTH_BODY_LIMIT = 16 * 1024;

const UNAUTHORIZED = { error: 'unauthorized' } as const;
const FORBIDDEN = { error: 'forbidden' } as const;
const NOT_FOUND = { error: 'not_found' } as const;
const INVALID_CREDENTIALS = { error: 'invalid_credentials' } as const;
const INVALID_CODE = { error: 'invalid_code' } as const;
const TOO_MANY_REQUESTS = { error: 'too_many_requests' } as const;
const INTERNAL_ERROR = { error: 'internal_error' } as const;

const SIX_DIGITS = /^\d{6}$/;

/** Connection-scoped headers that must never be forwarded (RFC 9110 §7.6.1). */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Headers a client can use to claim an address. All are discarded, including
 * any attempt to send the DROMEX-internal header, which is set only here.
 */
const CLIENT_ADDRESS_HEADERS = new Set([
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-original-forwarded-for',
  'x-real-ip',
  'x-client-ip',
  'x-cluster-client-ip',
  'forwarded',
  'cf-connecting-ip',
  'true-client-ip',
  'fastly-client-ip',
  DROMEX_CLIENT_IP_HEADER,
]);

function assertDependencies(deps: AuthRoutesDependencies | undefined): asserts deps is AuthRoutesDependencies {
  if (!deps?.backend) {
    throw new Error('Authentication requires an authentication backend.');
  }
  if (!deps.principals) {
    throw new Error('Authentication requires a principal repository.');
  }
  if (!deps.baseURL) {
    throw new Error('Authentication requires a base URL.');
  }
  if (!Array.isArray(deps.trustedOrigins) || deps.trustedOrigins.length === 0) {
    throw new Error('Authentication requires at least one trusted origin.');
  }
  if (typeof deps.replay?.record !== 'function') {
    throw new Error('Authentication requires a TOTP replay guard.');
  }
  if (typeof deps.recoverySessions?.isRecoverySession !== 'function') {
    throw new Error('Authentication requires a recovery-session gate.');
  }
  if (!deps.cookies?.sessionToken || !deps.cookies.twoFactor || !deps.cookies.trustDevice) {
    throw new Error('Authentication requires the authentication cookie names.');
  }
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

function cookieName(setCookie: string): string {
  return setCookie.slice(0, Math.max(0, setCookie.indexOf('='))).trim();
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0]!.trim();
}

function isExpiring(setCookie: string): boolean {
  return /;\s*Max-Age=0(\s*;|\s*$)/i.test(setCookie) || cookiePair(setCookie).endsWith('=');
}

function setCookiesNamed(response: Response, name: string): string[] {
  return response.headers.getSetCookie().filter((cookie) => cookieName(cookie) === name);
}

/** The value of one request cookie, or `null`. */
function requestCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

/** A Set-Cookie that expires one cookie, with the attributes Better Auth uses. */
function expiredCookie(name: string): string {
  const secure = name.startsWith('__Secure-') ? '; Secure' : '';
  return `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

// ---------------------------------------------------------------------------
// Requests to Better Auth
// ---------------------------------------------------------------------------

function canonicalOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    // Opaque origins serialise as "null" and are never trusted.
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Exact-match Origin check. Better Auth validates the Origin only when a
 * cookie is present, so routes that must refuse cross-origin calls in every
 * state check it here. A missing Origin is refused.
 */
function hasTrustedOrigin(request: FastifyRequest, deps: AuthRoutesDependencies): boolean {
  const header = request.headers.origin;
  if (typeof header !== 'string') return false;
  const origin = canonicalOrigin(header);
  if (origin === null || origin !== header.replace(/\/$/, '')) return false;
  return deps.trustedOrigins.some((trusted) => canonicalOrigin(trusted) === origin);
}

/** Largest retry time passed to a client. Anything else is dropped. */
const MAX_RETRY_AFTER_SECONDS = 3600;

function sendTooManyRequests(response: Response, reply: FastifyReply): FastifyReply {
  const value = response.headers.get('x-retry-after');
  if (value !== null && /^[1-9][0-9]{0,3}$/.test(value) && Number(value) <= MAX_RETRY_AFTER_SECONDS) {
    reply.header('retry-after', value);
  }
  return reply.code(429).send(TOO_MANY_REQUESTS);
}

/**
 * Builds the headers Better Auth sees. Client-supplied address claims are
 * dropped, then the address is set from `request.ip`, which with Fastify's
 * `trustProxy` disabled is the TCP peer. A trusted-device cookie is never
 * forwarded, so Better Auth can never skip the second factor for one.
 */
function toBackendHeaders(request: FastifyRequest, deps: AuthRoutesDependencies): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    const key = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key) || CLIENT_ADDRESS_HEADERS.has(key) || key === 'host' || key === 'content-length') {
      continue;
    }
    if (key === 'cookie') {
      const kept = String(value)
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part !== '' && part.slice(0, part.indexOf('=')).trim() !== deps.cookies.trustDevice);
      if (kept.length > 0) headers.set('cookie', kept.join('; '));
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  headers.set(DROMEX_CLIENT_IP_HEADER, request.ip);
  return headers;
}

/**
 * A POST to one fixed Better Auth path. The path is never taken from the
 * incoming URL, so a client query string or path suffix cannot reach Better
 * Auth.
 */
function backendRequest(deps: AuthRoutesDependencies, path: string, headers: Headers, body: unknown): Request {
  headers.set('content-type', 'application/json');
  return new Request(new URL(path, deps.baseURL), {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

/** Revokes one session through the server API. Throws if it did not happen. */
async function revokeSession(deps: AuthRoutesDependencies, sessionPair: string): Promise<void> {
  const response = await deps.backend.signOut(new Headers({ cookie: sessionPair }));
  await response.body?.cancel();
  if (!response.ok) throw new Error('Session revocation was not confirmed.');
}

// ---------------------------------------------------------------------------
// Sessions and the mandatory MFA gate
// ---------------------------------------------------------------------------

export interface SessionView {
  /** Better Auth's internal session identifier, never the session token. */
  sessionId: string;
  user: AuthenticatedIdentity['user'];
  twoFactorEnabled: boolean;
  createdAt: Date | null;
}

function readSession(body: unknown): SessionView | null {
  if (typeof body !== 'object' || body === null) return null;
  const { session, user } = body as { session?: unknown; user?: unknown };
  if (typeof session !== 'object' || session === null) return null;
  if (typeof user !== 'object' || user === null) return null;

  const { id, name, email, twoFactorEnabled } = user as Record<string, unknown>;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof email !== 'string') {
    return null;
  }

  const { id: sessionId, createdAt: rawCreatedAt } = session as Record<string, unknown>;
  // Without Better Auth's own session identifier no recovery binding can be
  // checked (DEC-436), so the session is not admitted.
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  const createdAt = typeof rawCreatedAt === 'string' ? new Date(rawCreatedAt) : null;

  return {
    sessionId,
    user: { id, name, email },
    // Only a literal boolean true counts. Anything else is not MFA.
    twoFactorEnabled: twoFactorEnabled === true,
    createdAt: createdAt !== null && Number.isFinite(createdAt.getTime()) ? createdAt : null,
  };
}

/**
 * The mandatory MFA gate (DEC-434). Every value comes from the database: the
 * session and `twoFactorEnabled` through Better Auth, the principal and its
 * completion time through DROMEX. Every disagreement is a denial.
 */
async function gateIdentity(view: SessionView, deps: AuthRoutesDependencies): Promise<AuthenticatedIdentity | null> {
  let principal: Principal;
  try {
    principal = await requireActivePrincipal(deps.principals, view.user.id);
  } catch (error) {
    if (error instanceof PrincipalAccessDeniedError) return null;
    throw error;
  }

  if (!view.twoFactorEnabled) return null;
  if (!(principal.mfaCompletedAt instanceof Date)) return null;
  if (view.createdAt === null || view.createdAt.getTime() < principal.mfaCompletedAt.getTime()) return null;
  // DEC-436: a session ever bound to an Owner recovery never becomes an
  // ordinary session, even after MFA is complete again.
  if (await deps.recoverySessions.isRecoverySession(view.sessionId)) return null;

  return { user: view.user, principal };
}

/**
 * Resolves the caller to a fully authenticated identity, or `null`.
 *
 * When `reply` is given, Better Auth's Set-Cookie headers are forwarded, so a
 * sliding session refresh or an expired-cookie deletion reaches the browser.
 */
async function resolveIdentity(
  headers: Headers,
  deps: AuthRoutesDependencies,
  reply: FastifyReply | null,
): Promise<AuthenticatedIdentity | null> {
  const response = await deps.backend.getSession(headers);

  if (reply) {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) reply.header('set-cookie', cookies);
  }

  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }

  const view = readSession(await response.json());
  return view === null ? null : gateIdentity(view, deps);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function errorCode(body: unknown): unknown {
  return typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
}

/** Exactly `{ code: "<six digits>" }`, and nothing else. */
function readTotpCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'code') return null;
  const { code } = body as { code: unknown };
  return typeof code === 'string' && SIX_DIGITS.test(code) ? code : null;
}

/**
 * Enforces each route's classification at request time.
 *
 * Registration already guarantees every route declares one (DEC-428). This
 * hook is what makes the declaration mean something. Failures are logged by
 * error name only: never the message, a header, or a body.
 */
export function registerAuthenticationGuard(app: FastifyInstance, deps: AuthRoutesDependencies): void {
  assertDependencies(deps);
  app.decorateRequest('dromexIdentity', null);

  app.addHook('preHandler', async (request, reply) => {
    // The 404 handler inherits this hook; unknown routes stay a plain 404.
    if (request.is404) return;

    const access = request.routeOptions.config?.access;

    // Cleanup and challenge routes enforce their own Origin and state checks.
    if (access === 'public' || access === 'session-cleanup' || access === 'mfa-challenge') return;

    // Recovery routes carry their own gate (DEC-436). The guard runs it and
    // refuses a recovery route that has none, or whose gate does not admit.
    if (access === 'recovery') {
      const gate = request.routeOptions.config?.recoveryGate;
      if (typeof gate !== 'function') return reply.code(401).send(UNAUTHORIZED);
      try {
        if ((await gate(request)) === true) return;
      } catch (error) {
        request.log.warn({ errorName: errorName(error) }, 'recovery gate failed');
      }
      return reply.code(401).send(UNAUTHORIZED);
    }

    if (access === 'guest-only') {
      try {
        if ((await resolveIdentity(toBackendHeaders(request, deps), deps, null)) !== null) {
          return reply.code(403).send(FORBIDDEN);
        }
        return;
      } catch (error) {
        request.log.warn({ errorName: errorName(error) }, 'session check failed');
        return reply.code(401).send(UNAUTHORIZED);
      }
    }

    if (access === 'authenticated' || access === 'owner') {
      // Owner routes that change state refuse a cross-origin caller before any
      // session work, in addition to the SameSite session cookie.
      if (access === 'owner' && request.method !== 'GET' && request.method !== 'HEAD' && !hasTrustedOrigin(request, deps)) {
        return reply.code(403).send(FORBIDDEN);
      }
      try {
        const identity = await resolveIdentity(toBackendHeaders(request, deps), deps, reply);
        if (identity === null) return reply.code(401).send(UNAUTHORIZED);
        if (access === 'owner' && identity.principal.isOwner !== true) return reply.code(403).send(FORBIDDEN);
        request.dromexIdentity = identity;
        return;
      } catch (error) {
        request.log.warn({ errorName: errorName(error) }, 'session resolution failed');
        return reply.code(401).send(UNAUTHORIZED);
      }
    }

    // Unreachable while registration enforces classification. Deny rather
    // than assume, should that ever stop being true.
    return reply.code(401).send(UNAUTHORIZED);
  });
}

/**
 * Registers the four approved authentication endpoints and the generic 404.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDependencies): void {
  assertDependencies(deps);

  app.post(SIGN_IN_PATH, { config: { access: 'guest-only' }, bodyLimit: AUTH_BODY_LIMIT }, async (request, reply) => {
    let response: Response;
    try {
      response = await deps.backend.handle(
        backendRequest(deps, SIGN_IN_PATH, toBackendHeaders(request, deps), request.body),
      );
    } catch (error) {
      request.log.error({ errorName: errorName(error) }, 'sign-in failed');
      return reply.code(500).send(INTERNAL_ERROR);
    }

    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) return sendTooManyRequests(response, reply);
      if (response.status >= 500) return reply.code(500).send(INTERNAL_ERROR);
      // Unknown email, wrong password, missing principal, disabled principal,
      // malformed input, and a refused origin are deliberately one response.
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    // Better Auth's body carries a session token or challenge detail and is
    // never forwarded.
    const body: unknown = await response.json().catch(() => null);

    if (typeof body === 'object' && body !== null && (body as { twoFactorRedirect?: unknown }).twoFactorRedirect === true) {
      const challenge = setCookiesNamed(response, deps.cookies.twoFactor).filter((cookie) => !isExpiring(cookie));
      if (challenge.length === 0) return reply.code(401).send(INVALID_CREDENTIALS);
      reply.header('set-cookie', challenge);
      return reply.code(200).send({ mfaRequired: true });
    }

    // A session issued without a challenge means the account has no enrolled
    // second factor. Mandatory MFA forbids it: revoke it and refuse exactly
    // as for a wrong password. Enrolment happens only in the terminal.
    const session = setCookiesNamed(response, deps.cookies.sessionToken).find((cookie) => !isExpiring(cookie));
    if (session !== undefined) {
      try {
        await revokeSession(deps, cookiePair(session));
      } catch (error) {
        request.log.error({ errorName: errorName(error) }, 'revoking a session without MFA failed');
        return reply.code(500).send(INTERNAL_ERROR);
      }
    }
    return reply.code(401).send(INVALID_CREDENTIALS);
  });

  app.post(
    VERIFY_TOTP_PATH,
    { config: { access: 'mfa-challenge' }, bodyLimit: AUTH_BODY_LIMIT },
    async (request, reply) => {
      if (!hasTrustedOrigin(request, deps)) return reply.code(403).send(FORBIDDEN);

      const code = readTotpCode(request.body);
      const challenge = requestCookie(request, deps.cookies.twoFactor);
      if (code === null || challenge === null) return reply.code(401).send(INVALID_CODE);

      // Only the challenge cookie is forwarded: never an ordinary session,
      // which would let Better Auth take its enrolment path with no attempt
      // limit, and never a trusted-device cookie.
      const headers = toBackendHeaders(request, deps);
      headers.set('cookie', `${deps.cookies.twoFactor}=${challenge}`);

      let response: Response;
      try {
        response = await deps.backend.handle(
          backendRequest(deps, VERIFY_TOTP_PATH, headers, { code, trustDevice: false }),
        );
      } catch (error) {
        request.log.error({ errorName: errorName(error) }, 'TOTP verification failed');
        return reply.code(500).send(INTERNAL_ERROR);
      }

      const challengeCookies = setCookiesNamed(response, deps.cookies.twoFactor);

      if (!response.ok) {
        const failure: unknown = await response.json().catch(() => null);
        if (challengeCookies.length > 0) reply.header('set-cookie', challengeCookies);
        if (response.status === 429) return sendTooManyRequests(response, reply);
        // A session refused by the principal hook surfaces as a 500 with this
        // code; it is a refusal, not a server fault.
        if (response.status >= 500 && errorCode(failure) !== 'FAILED_TO_CREATE_SESSION') {
          return reply.code(500).send(INTERNAL_ERROR);
        }
        return reply.code(401).send(INVALID_CODE);
      }
      await response.body?.cancel();

      const sessionCookies = setCookiesNamed(response, deps.cookies.sessionToken).filter((cookie) => !isExpiring(cookie));
      const sessionPair = sessionCookies[0] === undefined ? null : cookiePair(sessionCookies[0]);
      if (sessionPair === null) {
        request.log.error({ errorName: 'MissingSessionCookie' }, 'TOTP verification issued no session');
        return reply.code(500).send(INTERNAL_ERROR);
      }

      // Nothing is returned to the browser until the new session is recorded
      // against replay and passes the full gate.
      let identity: AuthenticatedIdentity | null = null;
      try {
        const sessionResponse = await deps.backend.getSession(new Headers({ cookie: sessionPair }));
        const view = sessionResponse.ok
          ? readSession(await sessionResponse.json())
          : (await sessionResponse.body?.cancel(), null);
        if (view !== null && (await deps.replay.record(view.user.id, code)) === 'accepted') {
          identity = await gateIdentity(view, deps);
        }
      } catch (error) {
        request.log.error({ errorName: errorName(error) }, 'completing the MFA challenge failed');
        await revokeSession(deps, sessionPair).catch((revocationError: unknown) => {
          request.log.error({ errorName: errorName(revocationError) }, 'revoking a refused session failed');
        });
        return reply.code(500).send(INTERNAL_ERROR);
      }

      if (identity === null) {
        try {
          await revokeSession(deps, sessionPair);
        } catch (error) {
          request.log.error({ errorName: errorName(error) }, 'revoking a refused session failed');
          return reply.code(500).send(INTERNAL_ERROR);
        }
        if (challengeCookies.length > 0) reply.header('set-cookie', challengeCookies);
        return reply.code(401).send(INVALID_CODE);
      }

      reply.header('set-cookie', [...sessionCookies, ...challengeCookies]);
      return reply.code(200).send({ authenticated: true });
    },
  );

  // Sign-out is idempotent security cleanup. It deliberately does not require
  // an active principal: a disabled or orphaned user must still be able to
  // destroy their own session. It acts only on the caller's own cookie, and
  // also expires the challenge and trusted-device cookies.
  app.post(SIGN_OUT_PATH, { config: { access: 'session-cleanup' }, bodyLimit: AUTH_BODY_LIMIT }, async (request, reply) => {
    if (!hasTrustedOrigin(request, deps)) return reply.code(403).send(FORBIDDEN);

    let response: Response;
    try {
      response = await deps.backend.handle(backendRequest(deps, SIGN_OUT_PATH, toBackendHeaders(request, deps), request.body));
    } catch (error) {
      request.log.error({ errorName: errorName(error) }, 'sign-out failed');
      return reply.code(500).send(INTERNAL_ERROR);
    }
    const cookies = response.headers.getSetCookie();
    await response.body?.cancel();

    if (response.ok) {
      const cleared = [...cookies];
      for (const name of [deps.cookies.twoFactor, deps.cookies.trustDevice]) {
        if (!cleared.some((cookie) => cookieName(cookie) === name)) cleared.push(expiredCookie(name));
      }
      reply.header('set-cookie', cleared);
      return reply.code(200).send({ signedOut: true });
    }
    if (response.status === 429) return sendTooManyRequests(response, reply);
    if (response.status === 403) return reply.code(403).send(FORBIDDEN);
    // A revocation that did not happen is never reported as success.
    return reply.code(500).send(INTERNAL_ERROR);
  });

  app.get(SESSION_PATH, { config: { access: 'authenticated' } }, async (request, reply) => {
    const identity = request.dromexIdentity;
    if (identity === null) return reply.code(401).send(UNAUTHORIZED);

    // The complete, deliberate response. No session id, token, cookie,
    // factor detail, timestamp, or permission data.
    return { user: identity.user, isOwner: identity.principal.isOwner };
  });

  // Fastify's default 404 body echoes the method and path. This one reveals
  // nothing about which authentication endpoints exist.
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(NOT_FOUND));
}

/** Transport pieces shared with the Owner recovery routes (DEC-436). */
export {
  AUTH_BODY_LIMIT,
  FORBIDDEN,
  INTERNAL_ERROR,
  INVALID_CODE,
  UNAUTHORIZED,
  backendRequest,
  cookiePair,
  errorCode,
  errorName,
  expiredCookie,
  hasTrustedOrigin,
  isExpiring,
  readSession,
  readTotpCode,
  requestCookie,
  revokeSession,
  sendTooManyRequests,
  setCookiesNamed,
  toBackendHeaders,
};
