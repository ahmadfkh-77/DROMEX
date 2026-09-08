import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../src/server.ts';

// A closed, reserved port. Liveness must not depend on the database being up.
const UNREACHABLE_DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';

describe('GET /health (liveness)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ databaseUrl: UNREACHABLE_DATABASE_URL });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds 200 with a minimal liveness body', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports alive even when PostgreSQL is unreachable', async () => {
    // Liveness answers "is the process up", never "are dependencies up".
    // Dependency state belongs to /ready. Conflating them causes an
    // orchestrator to restart a healthy process during a database blip.
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
  });
});
