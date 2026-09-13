import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { DROMEX_CLIENT_IP_HEADER } from './config.ts';
import {
  PrincipalAccessDeniedError,
  requireActivePrincipal,
  type Principal,
  type PrincipalRepository,
} from './principal.ts';

/**
 * The HTTP authentication transport: the only way a browser reaches
 * authentication, and the request-time enforcement of route classification.
 *
 * Two rules shape everything here.
 *
 * 1. **A Better Auth session is necessary but never sufficient.** Every
 *    authenticated request also needs an active DROMEX principal, checked on
 *    each request from PostgreSQL.
 *
 * 2. **Nothing reaches Better Auth unless it is on the allowlist.** There is
 *    no wildcard route. Three exact routes exist; any other path — sign-up,
 *    raw `get-session`, password reset, account updates — is answered by a
 *    generic 404 that never touches Better Auth at all.
 */

/**
 * The seam between this transport and Better Auth. Deliberately two methods:
 * sign-in and sign-out go through Better Auth's router, which applies its
 * CSRF and rate-limit middleware; session resolution uses the server API,
 * which does neither and so neither consumes a rate-limit bucket nor writes a
 * rate-limit row on every authenticated request.
 */
export interface AuthBackend {
  handle(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<Response>;
}

export interface AuthRoutesDependencies {
  backend: AuthBackend;
  principals: PrincipalRepository;
  /** Canonical origin used to build the internal request URL. */
  baseURL: string;
  /** Browser origins allowed to call state-changing cleanup routes. */
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
}

const SIGN_IN_PATH = '/api/auth/sign-in/email';
const SIGN_OUT_PATH = '/api/auth/sign-out';
const SESSION_PATH = '/api/session';

/** Credentials are small. Anything larger is refused before parsing. */
const AUTH_BODY_LIMIT = 16 * 1024;

const UNAUTHORIZED = { error: 'unauthorized' } as const;
const FORBIDDEN = { error: 'forbidden' } as const;
const NOT_FOUND = { error: 'not_found' } as const;
const INVALID_CREDENTIALS = { error: 'invalid_credentials' } as const;
const TOO_MANY_REQUESTS = { error: 'too_many_requests' } as const;
const INTERNAL_ERROR = { error: 'internal_error' } as const;

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
}

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
 * Exact-match Origin check for cleanup routes. Better Auth validates the
 * Origin only when a cookie is present, so a route that must refuse
 * cross-origin calls in every state checks it here. A missing Origin is
 * refused: browsers send one on every cross-site POST and on same-origin
 * fetch POSTs.
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
 * `trustProxy` disabled is the TCP peer and cannot be influenced by headers.
 */
function toBackendHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    const key = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(key) ||
      CLIENT_ADDRESS_HEADERS.has(key) ||
      key === 'host' ||
      key === 'content-length'
    ) {
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
 * Forwards to one fixed Better Auth path. The path is never taken from the
 * incoming URL, so a client query string or path suffix cannot reach Better
 * Auth.
 */
function forwardToBackend(
  request: FastifyRequest,
  deps: AuthRoutesDependencies,
  path: string,
): Promise<Response> {
  const headers = toBackendHeaders(request);
  headers.set('content-type', 'application/json');

  return deps.backend.handle(
    new Request(new URL(path, deps.baseURL), {
      method: 'POST',
      headers,
      body: JSON.stringify(request.body ?? {}),
    }),
  );
}

function readUser(body: unknown): AuthenticatedIdentity['user'] | null {
  if (typeof body !== 'object' || body === null) return null;
  const { session, user } = body as { session?: unknown; user?: unknown };
  if (typeof session !== 'object' || session === null) return null;
  if (typeof user !== 'object' || user === null) return null;

  const { id, name, email } = user as Record<string, unknown>;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof email !== 'string') {
    return null;
  }
  return { id, name, email };
}

/**
 * Resolves the caller to an identity with an active principal, or `null`.
 *
 * When `reply` is given, Better Auth's Set-Cookie headers are forwarded, so a
 * sliding session refresh or an expired-cookie deletion reaches the browser.
 * Principal denial collapses into `null` like every other failure, so the
 * caller cannot tell which check refused. Any other error is rethrown and
 * handled as a denial by the guard.
 */
async function resolveIdentity(
  request: FastifyRequest,
  deps: AuthRoutesDependencies,
  reply: FastifyReply | null,
): Promise<AuthenticatedIdentity | null> {
  const response = await deps.backend.getSession(toBackendHeaders(request));

  if (reply) {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) reply.header('set-cookie', cookies);
  }

  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }

  const user = readUser(await response.json());
  if (user === null) return null;

  try {
    return { user, principal: await requireActivePrincipal(deps.principals, user.id) };
  } catch (error) {
    if (error instanceof PrincipalAccessDeniedError) return null;
    throw error;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/**
 * Enforces each route's classification at request time.
 *
 * Registration already guarantees every route declares one (DEC-428). This
 * hook is what makes the declaration mean something. Failures are logged by
 * error name only: never the message, which may carry query text, and never a
 * header or body.
 */
export function registerAuthenticationGuard(
  app: FastifyInstance,
  deps: AuthRoutesDependencies,
): void {
  assertDependencies(deps);
  app.decorateRequest('dromexIdentity', null);

  app.addHook('preHandler', async (request, reply) => {
    // The 404 handler inherits this hook; unknown routes stay a plain 404.
    if (request.is404) return;

    const access = request.routeOptions.config?.access;

    // Cleanup routes only destroy the caller's own authentication state, so a
    // disabled or missing principal must still reach them. They enforce their
    // own Origin check.
    if (access === 'public' || access === 'session-cleanup') return;

    if (access === 'guest-only') {
      try {
        if ((await resolveIdentity(request, deps, null)) !== null) {
          return reply.code(403).send(FORBIDDEN);
        }
        return;
      } catch (error) {
        request.log.warn({ errorName: errorName(error) }, 'session check failed');
        return reply.code(401).send(UNAUTHORIZED);
      }
    }

    if (access === 'authenticated') {
      try {
        const identity = await resolveIdentity(request, deps, reply);
        if (identity === null) return reply.code(401).send(UNAUTHORIZED);
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

async function discardBody(response: Response): Promise<string[]> {
  const cookies = response.headers.getSetCookie();
  await response.body?.cancel();
  return cookies;
}

/**
 * Registers the three approved authentication endpoints and the generic 404.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDependencies): void {
  assertDependencies(deps);

  app.post(
    SIGN_IN_PATH,
    { config: { access: 'guest-only' }, bodyLimit: AUTH_BODY_LIMIT },
    async (request, reply) => {
      let response: Response;
      try {
        response = await forwardToBackend(request, deps, SIGN_IN_PATH);
      } catch (error) {
        request.log.error({ errorName: errorName(error) }, 'sign-in failed');
        return reply.code(500).send(INTERNAL_ERROR);
      }
      // Better Auth's body carries the session token and is never forwarded.
      const cookies = await discardBody(response);

      if (response.ok) {
        if (cookies.length > 0) reply.header('set-cookie', cookies);
        return reply.code(200).send({ authenticated: true });
      }
      if (response.status === 429) return sendTooManyRequests(response, reply);
      if (response.status >= 500) return reply.code(500).send(INTERNAL_ERROR);

      // Unknown email, wrong password, missing principal, disabled principal,
      // malformed input, and a refused origin are deliberately one response.
      // No cookie is forwarded on failure.
      return reply.code(401).send(INVALID_CREDENTIALS);
    },
  );

  // Sign-out is idempotent security cleanup. It deliberately does not require
  // an active principal: a disabled or orphaned user must still be able to
  // destroy their own session. It only ever acts on the caller's own cookie,
  // and returns one generic result whether that session was valid, expired,
  // missing, already revoked, or belonged to a disabled or missing principal.
  app.post(
    SIGN_OUT_PATH,
    { config: { access: 'session-cleanup' }, bodyLimit: AUTH_BODY_LIMIT },
    async (request, reply) => {
      if (!hasTrustedOrigin(request, deps)) return reply.code(403).send(FORBIDDEN);

      let response: Response;
      try {
        response = await forwardToBackend(request, deps, SIGN_OUT_PATH);
      } catch (error) {
        request.log.error({ errorName: errorName(error) }, 'sign-out failed');
        return reply.code(500).send(INTERNAL_ERROR);
      }
      const cookies = await discardBody(response);

      if (response.ok) {
        if (cookies.length > 0) reply.header('set-cookie', cookies);
        return reply.code(200).send({ signedOut: true });
      }
      if (response.status === 429) return sendTooManyRequests(response, reply);
      if (response.status === 403) return reply.code(403).send(FORBIDDEN);
      // A revocation that did not happen is never reported as success.
      return reply.code(500).send(INTERNAL_ERROR);
    },
  );

  app.get(SESSION_PATH, { config: { access: 'authenticated' } }, async (request, reply) => {
    const identity = request.dromexIdentity;
    if (identity === null) return reply.code(401).send(UNAUTHORIZED);

    // The complete, deliberate response. No session id, token, cookie,
    // provider data, or permission data.
    return { user: identity.user, isOwner: identity.principal.isOwner };
  });

  // Fastify's default 404 body echoes the method and path. This one reveals
  // nothing about which authentication endpoints exist.
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(NOT_FOUND));
}
