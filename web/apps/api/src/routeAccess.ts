import type { FastifyInstance, RouteOptions } from 'fastify';

/**
 * Every route must declare how it is reached (DEC-428).
 *
 * - `public`        reachable without a session, deliberately and by decision
 * - `guest-only`    reachable only without a session
 * - `authenticated` requires a valid session
 *
 * The classification is metadata only. It does not itself authenticate or
 * authorise anything; the guards that enforce `guest-only` and
 * `authenticated` arrive in a later checkpoint. What this buys now is that a
 * route which nobody classified cannot reach production silently.
 */
export const ROUTE_ACCESS = ['public', 'guest-only', 'authenticated'] as const;

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
 * classification.
 *
 * Deliberately an `onRoute` hook rather than an inspection of the printed
 * route table: the hook runs as part of registration itself, so an
 * unclassified route cannot exist even briefly, and the failure is a thrown
 * error at the exact call site rather than a string parsed after the fact.
 *
 * Must be installed before any route is registered on the instance.
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

    // Fastify may register several methods per route, and adds a HEAD route
    // for each GET; each inherits this same config and is recorded here.
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      recorded.set(`${method} ${route.url}`, access);
    }
  });
}
