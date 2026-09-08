import Fastify, { type FastifyInstance } from 'fastify';

export interface BuildServerOptions {
  /** PostgreSQL connection string. Unused until /ready exists. */
  databaseUrl?: string;
}

export async function buildServer(
  _options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Liveness only: answers "is this process up". It must never consult a
  // dependency, or an orchestrator would restart a healthy process whenever
  // the database blips.
  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
