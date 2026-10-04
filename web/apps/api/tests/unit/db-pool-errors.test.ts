import { EventEmitter } from 'node:events';

import type { Pool, PoolConfig } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPool } from '../../src/db.ts';

/**
 * F9. An idle pooled connection is still connected to a live backend, so a
 * database restart, failover, or an administrator killing it makes it emit an
 * error. pg-pool re-emits that on the pool, and a pool `error` event with no
 * listener is an uncaught exception that ends the API process
 * (https://node-postgres.com/apis/pool, "Events"). Real pg-pool, fake client:
 * no database is needed, and a real-database counterpart runs in CI.
 */

const SECRETS = ['postgres://dromex_user:s3cr3t-pass@db.internal:5432/dromex', 'SELECT * FROM "user" WHERE email', 'db.internal'];

function poolError(code: string): Error {
  return Object.assign(
    new Error(`terminating connection ${SECRETS[0]} while running ${SECRETS[1]} on ${SECRETS[2]}`),
    { code },
  );
}

/** A client that never touches a socket; the pool is real. */
function withFakeClients(pool: Pool): EventEmitter[] {
  const made: EventEmitter[] = [];
  class FakeClient extends EventEmitter {
    _queryable = true;
    _ending = false;
    constructor() {
      super();
      made.push(this);
    }
    // Called by the pool because it is created with allowExitOnIdle.
    ref(): void {}
    unref(): void {}
    connect(cb: (error?: Error) => void): void {
      setImmediate(() => cb());
    }
    end(cb?: () => void): void {
      this._ending = true;
      this._queryable = false;
      setImmediate(() => cb?.());
    }
    query(): Promise<{ rows: unknown[]; rowCount: number }> {
      return Promise.resolve({ rows: [{ ok: 1 }], rowCount: 1 });
    }
  }
  (pool as unknown as { Client: PoolConfig['Client'] }).Client = FakeClient as unknown as PoolConfig['Client'];
  return made;
}

const stderrWrites = (spy: { mock: { calls: unknown[][] } }): string[] => spy.mock.calls.map((call) => String(call[0]));

describe('the production database pool (F9)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has an error listener, so an idle-connection error cannot become an uncaught exception', () => {
    const pool = createPool('postgres://u:p@127.0.0.1:1/none');
    expect(pool.listenerCount('error')).toBeGreaterThanOrEqual(1);
  });

  it('survives an error event and writes exactly one fixed line with no connection details', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const pool = createPool('postgres://u:p@127.0.0.1:1/none');

    expect(() => pool.emit('error', poolError('57P01'))).not.toThrow();

    const lines = stderrWrites(write);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('57P01');
    for (const secret of SECRETS) expect(lines[0]).not.toContain(secret);
    expect(lines[0]).not.toMatch(/terminating connection|password|postgres:\/\//i);
  });

  it('hands a reporter only a short code, never the error object or message', () => {
    const seen: unknown[][] = [];
    const pool = createPool('postgres://u:p@127.0.0.1:1/none', (...args: unknown[]) => seen.push(args));

    pool.emit('error', poolError('ECONNRESET'));
    pool.emit('error', poolError(`weird ${SECRETS[0]}`));
    pool.emit('error', new Error(SECRETS[1]));

    expect(seen).toEqual([['ECONNRESET'], ['unknown'], ['unknown']]);
  });

  it('discards the failed idle client and does not reuse it for the next checkout', async () => {
    const reports: string[] = [];
    const pool = createPool('postgres://u:p@127.0.0.1:1/none', (code: string) => reports.push(code));
    const made = withFakeClients(pool);

    const first = await pool.connect();
    first.release();
    expect(pool.idleCount).toBe(1);

    expect(() => made[0]!.emit('error', poolError('57P01'))).not.toThrow();
    expect(reports).toEqual(['57P01']);
    expect(pool.totalCount).toBe(0);
    expect(pool.idleCount).toBe(0);

    const next = await pool.connect();
    expect(made).toHaveLength(2);
    expect(next).toBe(made[1] as unknown);
    await expect(next.query('SELECT 1')).resolves.toMatchObject({ rowCount: 1 });
    next.release();
    await pool.end();
  });
});
