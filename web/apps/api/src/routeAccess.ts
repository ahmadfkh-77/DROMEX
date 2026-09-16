import type { FastifyInstance, RouteOptions } from 'fastify';

/**
 * Every route must declare how it is reached (DEC-428).
 *
 * - `public`          reachable without a session, deliberately and by decision
 * - `guest-only`      reachable only without a fully authenticated session
 * - `authenticated`   requires a valid session, an active DROMEX principal,
 *                     and completed mandatory MFA (DEC-434)
 * - `session-cleanup` reachable with or without a valid session or principal,
 *                     for endpoints that only destroy the caller's own
 *                     authentication state and reveal nothing (sign-out).
 *                     Such a route must enforce its own trusted Origin check.
 * - `mfa-challenge`   reachable only to complete a pending second-factor
 *                     challenge: no ordinary session is consulted. Such a
 *                     route must itself require the signed challenge cookie
 *                     and a trusted Origin, and must refuse to return a
 *                     session unless the full mandatory-MFA gate passes —
 *                     or, for the recovery-code route, unless the session is
 *                     first recorded as a recovery session (DEC-436).
 * - `recovery`        reachable only by a session bound to an in-progress
 *                     Owner recovery (DEC-436). Such a route must carry its
 *                     own `recoveryGate`, which the authentication guard
 *                     runs; a recovery route without one is refused.
 * - `owner`           everything `authenticated` requires, and the principal
 *                     must be the Owner (DEC-440). A state-changing method
 *                     also requires a trusted Origin, checked before the
 *                     session. The use case checks the Owner again (DEC-428).
 *
 * The classification itself does not authenticate anything; the
 * authentication guard in `auth/http.ts` enforces it per request. What this
 * registration check buys is that a route nobody classified cannot exist.
 */
export const ROUTE_ACCESS = [
  'public',
  'guest-only',
  'authenticated',
  'session-cleanup',
  'mfa-challenge',
  'recovery',
  'owner',
] as const;

export type RouteAccess = (typeof ROUTE_ACCESS)[number];

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }

  interface FastifyInstance {
    /** Classification recorded per `"METHOD /url"`, for tests and diagnostics. */
    routeAccess: ReadonlyMap<string, RouteAccess>;
  }
}

function isRouteAccess(value: unknown): value is RouteAccess {
  return ROUTE_ACCESS.includes(value as RouteAccess);
}

/**
 * Fails route registration when a route carries no recognised `access`
 * classification. Must be installed before any route is registered.
 */
export function registerRouteAccessGuard(app: FastifyInstance): void {
  const recorded = new Map<string, RouteAccess>();
  app.decorate('routeAccess', recorded);

  app.addHook('onRoute', (route: RouteOptions) => {
    const access: unknown = route.config?.access;

    if (access === undefined) {
      throw new Error(
        `Route "${route.method} ${route.url}" declares no "access" classification. ` +
          `Every route must set config.access to one of: ${ROUTE_ACCESS.join(', ')}. ` +
          `A route that is intentionally public must say so explicitly.`,
      );
    }

    if (!isRouteAccess(access)) {
      throw new Error(
        `Route "${route.method} ${route.url}" declares an unrecognised "access" ` +
          `classification ${JSON.stringify(access)}. Expected one of: ${ROUTE_ACCESS.join(', ')}.`,
      );
    }

    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      recorded.set(`${method} ${route.url}`, access);
    }
  });
}
