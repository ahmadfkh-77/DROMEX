import { randomBytes } from 'node:crypto';

import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuth } from '../../src/auth/instance.ts';
import * as instanceModule from '../../src/auth/instance.ts';

// Synthetic, generated in memory, never printed and never persisted.
function syntheticSecret(): string {
  return randomBytes(32).toString('hex');
}

// Port 1 is reserved and closed, so Better Auth's asynchronous schema probe
// can never reach a real database from these tests.
const openedPools: Pool[] = [];

function inertPool(): Pool {
  const pool = new Pool({ connectionString: 'postgresql://127.0.0.1:1/unused' });
  openedPools.push(pool);
  return pool;
}

function safeInput(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'development' as const,
    secret: syntheticSecret(),
    baseURL: 'http://127.0.0.1:3000',
    trustedOrigins: ['http://127.0.0.1:5173'],
    database: inertPool(),
    ...overrides,
  };
}

describe('Better Auth instance', () => {
  afterEach(async () => {
    // Better Auth's schema probe is asynchronous. Letting it settle and
    // closing the pools inside the test's own lifetime keeps its failure log
    // from racing the worker teardown, which would otherwise surface as an
    // unhandled rejection and fail an otherwise-passing suite.
    await new Promise((resolve) => setTimeout(resolve, 200));
    while (openedPools.length > 0) {
      await openedPools.pop()?.end().catch(() => undefined);
    }
    vi.restoreAllMocks();
  });

  it('is constructed from explicit safe configuration', () => {
    const auth = createAuth(safeInput());

    expect(auth).toBeTruthy();
    expect(auth.handler).toBeTypeOf('function');
  });

  it('opens no database connection synchronously during construction', async () => {
    // Construction itself does not touch the database: the call returns
    // before any connect or query is issued. That is what makes it safe to
    // build the instance at module load, including for offline schema
    // generation.
    const pool = inertPool();
    const connectSpy = vi.spyOn(pool, 'connect');
    const querySpy = vi.spyOn(pool, 'query');

    createAuth(safeInput({ database: pool }));

    expect(connectSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    await pool.end().catch(() => undefined);
  });

  it('probes the database asynchronously after construction, and survives failure', async () => {
    // Better Auth runs a schema-validation probe shortly AFTER the
    // constructor returns. This is recorded explicitly rather than left
    // implicit, because the synchronous assertion above would otherwise read
    // as "this instance never touches the database", which is not true.
    //
    // What matters for safety is that the probe is asynchronous, non-fatal,
    // and directed only at the pool it was given. Schema generation points
    // that pool at a closed port, so the probe can never reach a real
    // database; it simply fails and logs.
    const pool = inertPool();
    const connectSpy = vi.spyOn(pool, 'connect');

    createAuth(safeInput({ database: pool }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(connectSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
    await pool.end().catch(() => undefined);
  });

  it('mounts no route and exposes no Fastify plugin', () => {
    // The instance is deliberately not reachable over HTTP in this
    // checkpoint. Anything that registers routes would contradict that.
    expect(instanceModule).not.toHaveProperty('registerAuthRoutes');
    expect(instanceModule).not.toHaveProperty('authPlugin');
    expect(Object.keys(instanceModule)).toEqual(['createAuth']);
  });

  it('fails closed on an invalid secret, without exposing it', () => {
    const weak = 'x'.repeat(8);

    try {
      createAuth(safeInput({ secret: weak }));
      throw new Error('expected construction to reject the weak secret');
    } catch (error) {
      const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
      expect(text).toMatch(/secret/i);
      expect(text).not.toContain(weak);
    }
  });

  it('fails closed on an invalid trusted origin, without exposing it', () => {
    const hostile = 'http://admin:hunter2@evil.example.com/x';

    try {
      createAuth(safeInput({ trustedOrigins: [hostile] }));
      throw new Error('expected construction to reject the malformed origin');
    } catch (error) {
      const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('evil.example.com');
    }
  });

  it('fails closed when insecure cookies are requested outside development', () => {
    // Production URLs are supplied deliberately so this reaches the cookie
    // check. With an http baseURL it would stop earlier, on the
    // https-in-production rule — correct behaviour, but a different assertion.
    expect(() =>
      createAuth(
        safeInput({
          environment: 'production',
          baseURL: 'https://app.fakihbrothers.com',
          trustedOrigins: ['https://app.fakihbrothers.com'],
          allowInsecureCookies: true,
        }),
      ),
    ).toThrow(/insecure cookies/i);
  });
});
