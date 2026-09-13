import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../src/server.ts';
import { settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

// Requires Docker: runs against a real postgres:18.6-trixie container started
// by the integration project's globalSetup.
describe('GET /ready when PostgreSQL is reachable', () => {
  let database: EphemeralDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await createEphemeralDatabase();
    app = await buildServer({ databaseUrl: database.uri, auth: syntheticAuthSettings() });
    await app.ready();
  });

  afterAll(async () => {
    await settle();
    await app.close();
    await database.drop();
  });

  it('responds 200 when the database answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });
});
