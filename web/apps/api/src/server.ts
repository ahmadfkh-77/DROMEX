import type { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';

import type { AuthSettings } from './auth/config.ts';
import {
  registerAuthenticationGuard,
  registerAuthRoutes,
  type AuthRoutesDependencies,
} from './auth/http.ts';
import { createAuth } from './auth/instance.ts';
import { createPrincipalRepository } from './auth/principal.ts';
import { loadRuntimeConfig, type RuntimeConfig } from './config/runtime.ts';
import { checkDatabase, createPool } from './db.ts';
import { registerRouteAccessGuard } from './routeAccess.ts';

export interface BuildServerOptions {
  /** PostgreSQL connection string. Required; there is no ambient fallback. */
  databaseUrl: string;
  /** Authentication settings. Required now that authentication routes exist. */
  auth: AuthSettings;
  /** Structured request logging. Off in tests, on for the running server. */
  logger?: boolean;
  /** Captures structured logs, so tests can prove what is never written. */
  logStream?: Writable;
}

/**
 * Defence in depth. Fastify's default serializers already record only the
 * method, URL, host, and socket address of a request, never its headers or
 * body; these paths keep that true if a log call ever adds headers.
 */
const LOG_REDACTIONS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
];

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  if (!options?.auth) {
    throw new Error('Authentication configuration is required to build the API server.');
  }
  if (!options.databaseUrl) {
    throw new Error('A database URL is required to build the API server.');
  }

  const logging = options.logStream !== undefined || options.logger === true;
  const app = Fastify({
    logger: logging
      ? {
          level: options.logStream ? 'trace' : 'info',
          redact: LOG_REDACTIONS,
          ...(options.logStream ? { stream: options.logStream } : {}),
        }
      : false,
  });

  // One pool serves readiness, Better Auth, and principal lookups alike.
  const pool = createPool(options.databaseUrl);

  let auth: ReturnType<typeof createAuth>;
  try {
    auth = createAuth({ ...options.auth, database: pool });
  } catch (cause) {
    await pool.end().catch(() => undefined);
    throw cause;
  }

  const authDependencies: AuthRoutesDependencies = {
    backend: {
      handle: (request) => auth.handler(request),
      getSession: (headers) => auth.api.getSession({ headers, asResponse: true }),
    },
    principals: createPrincipalRepository(pool),
    // Already validated and normalised by createAuth, which would have thrown.
    baseURL: new URL(options.auth.baseURL).origin,
    trustedOrigins: options.auth.trustedOrigins,
  };

  // Both guards are installed before any route: registration-time
  // classification, then request-time enforcement of it.
  registerRouteAccessGuard(app);
  registerAuthenticationGuard(app, authDependencies);

  // Liveness only: answers "is this process up". It must never consult a
  // dependency, or an orchestrator would restart a healthy process whenever
  // the database blips.
  //
  // Explicitly public: an orchestrator probes this before any session can
  // exist. "Public" here is a recorded decision, not an omission.
  app.get('/health', { config: { access: 'public' } }, async () => ({ status: 'ok' }));

  // Readiness: answers "can this process serve traffic". Public for the same
  // reason as /health, and it already returns a generic body that leaks no
  // infrastructure detail to an unauthenticated caller.
  app.get('/ready', { config: { access: 'public' } }, async (_request, reply) => {
    try {
      await checkDatabase(pool);
      return { status: 'ready' };
    } catch (cause) {
      // The detail goes to the log, never to the caller. Connection strings,
      // host names, and driver errors identify internal infrastructure to an
      // unauthenticated client (OWASP A10). The generic body is asserted by a
      // test so a later refactor cannot quietly reintroduce a leak.
      app.log.error({ err: cause }, 'readiness check failed');
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  registerAuthRoutes(app, authDependencies);

  app.addHook('onClose', async () => {
    await pool.end().catch(() => undefined);
  });

  return app;
}

function exitWithConfigurationError(cause: unknown): never {
  // Messages from configuration validation name variables, never values.
  const message = cause instanceof Error ? cause.message : 'Unknown configuration error.';
  process.stderr.write(`The API cannot start: ${message}\n`);
  process.exit(1);
}

// Runs only when this file is the process entry point, so importing
// buildServer from a test never binds a port or reads the environment. The
// container's CMD runs this file directly, which is what makes the service
// actually listen. Without this the container starts, does nothing, and
// exits 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config: RuntimeConfig;
  let app: FastifyInstance;

  try {
    config = loadRuntimeConfig(process.env);
    app = await buildServer({ databaseUrl: config.databaseUrl, auth: config.auth, logger: true });
  } catch (cause) {
    exitWithConfigurationError(cause);
  }

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (cause) {
    app.log.error({ err: cause }, 'the API failed to start');
    process.exit(1);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
}
