import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuth } from '../../src/auth/instance.ts';
import * as instanceModule from '../../src/auth/instance.ts';
import { syntheticSecret } from '../helpers/auth-settings.ts';

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
    secrets: [{ version: 1, value: syntheticSecret() }],
    baseURL: 'http://127.0.0.1:3000',
    trustedOrigins: ['http://127.0.0.1:5173'],
    database: inertPool(),
    ...overrides,
  };
}

describe('Better Auth instance', () => {
  afterEach(async () => {
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
    const pool = inertPool();
    const connectSpy = vi.spyOn(pool, 'connect');
    const querySpy = vi.spyOn(pool, 'query');

    createAuth(safeInput({ database: pool }));

    expect(connectSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('probes the database asynchronously after construction, and survives failure', async () => {
    const pool = inertPool();
    const connectSpy = vi.spyOn(pool, 'connect');

    createAuth(safeInput({ database: pool }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(connectSpy).toHaveBeenCalled();
  });

  it('mounts no route and exposes no Fastify plugin', () => {
    expect(Object.keys(instanceModule)).toEqual(['createAuth']);
  });

  it('fails closed on an invalid secret, without exposing it', () => {
    const weak = 'x'.repeat(8);

    try {
      createAuth(safeInput({ secrets: [{ version: 1, value: weak }] }));
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
