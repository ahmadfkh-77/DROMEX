import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../src/server.ts';
import { settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';

// Port 1 is reserved and closed, so the connection fails fast and
// deterministically. No container, and therefore no Docker, is required:
// these assertions must stay runnable on a machine with Docker stopped.
const UNREACHABLE_DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';

describe('GET /ready when PostgreSQL is unreachable', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({
      databaseUrl: UNREACHABLE_DATABASE_URL,
      auth: syntheticAuthSettings(),
    });
    await app.ready();
  });

  afterAll(async () => {
    await settle();
    await app.close();
  });

  it('responds 503 rather than 200 or 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
  });

  it('leaks no connection detail, driver text, or credential in the body', async () => {
    // OWASP A10 / ASVS 16.5.1: a generic message to the caller, detail to
    // the log. Asserted rather than trusted, because this is exactly the
    // kind of leak that appears by accident during later refactoring.
    // Deliberately a unit test: a security assertion should never be
    // skippable just because Docker is not running.
    const response = await app.inject({ method: 'GET', url: '/ready' });
    const body = response.body.toLowerCase();

    for (const leak of [
      'econnrefused',
      '127.0.0.1',
      'unused',
      'password',
      'postgres',
      'stack',
      'error:',
    ]) {
      expect(body).not.toContain(leak);
    }
  });
});
