import { pathToFileURL } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';

import { checkDatabase, createPool } from './db.ts';

export interface BuildServerOptions {
  /** PostgreSQL connection string. Falls back to DATABASE_URL. */
  databaseUrl?: string;
  /** Structured request logging. Off in tests, on for the running server. */
  logger?: boolean;
}

export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const pool = createPool(options.databaseUrl ?? process.env.DATABASE_URL ?? '');

  // Liveness only: answers "is this process up". It must never consult a
  // dependency, or an orchestrator would restart a healthy process whenever
  // the database blips.
  app.get('/health', async () => ({ status: 'ok' }));

  // Readiness: answers "can this process serve traffic".
  app.get('/ready', async (_request, reply) => {
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

  app.addHook('onClose', async () => {
    await pool.end().catch(() => undefined);
  });

  return app;
}

// Runs only when this file is the process entry point, so importing
// buildServer from a test never binds a port. The container's CMD runs this
// file directly, which is what makes the service actually listen. Without
// this the container starts, does nothing, and exits 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildServer({ logger: true });
  const port = Number(process.env.API_PORT ?? 3000);
  const host = process.env.API_HOST ?? '0.0.0.0';

  try {
    await app.listen({ port, host });
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
