import { EventEmitter } from 'node:events';

import { Pool, type PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';

/**
 * Pins the mechanism behind the intermittent integration-step failure (F1):
 * every test passed, then one unhandled PostgreSQL 57P01 ("terminating
 * connection due to administrator command") at teardown made the step exit 1.
 *
 * Real pg-pool, fake client, no database. It shows the two halves of the race:
 * 1) `await pool.end()` resolves before the clients' sockets have closed;
 * 2) a late server-side termination (what `DROP DATABASE ... WITH (FORCE)`
 *    sends) then reaches the pool, and with no 'error' listener that is an
 *    uncaught exception.
 *
 * This documents the cause that `tests/helpers/db.ts` works around by waiting
 * for the sessions to go before forcing the drop. It cannot show that the
 * helper itself removes the race: that needs a real database and is judged
 * only from CI runs. If the first test starts failing, a newer pg-pool waits
 * for its clients and the helper's wait can be revisited.
 */
const CLOSE_DELAY_MS = 150;

interface World {
  closed: boolean;
  client?: EventEmitter;
}

function setup(world: World): Pool {
  class SlowClient extends EventEmitter {
    _queryable = true;
    _ending = false;
    constructor() {
      super();
      world.client = this;
    }
    connect(cb: (error?: Error) => void): void {
      setImmediate(() => cb());
    }
    end(cb?: () => void): void {
      this._ending = true;
      this._queryable = false;
      // The socket closes some time after end() is called, as with a real server.
      setTimeout(() => {
        world.closed = true;
        cb?.();
      }, CLOSE_DELAY_MS);
    }
    query(): Promise<{ rows: unknown[]; rowCount: number }> {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
  }
  return new Pool({ Client: SlowClient, max: 2 } as unknown as PoolConfig);
}

const fatal = (): Error =>
  Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, CLOSE_DELAY_MS + 50));

describe('pg-pool end() versus a forced drop', () => {
  it('end() resolves before the client has closed', async () => {
    const world: World = { closed: false };
    const pool = setup(world);
    (await pool.connect()).release();

    await pool.end();

    expect(world.closed, 'the client is still closing when pool.end() has already resolved').toBe(false);
    await settle();
    expect(world.closed).toBe(true);
  });

  it('a late termination escapes as an uncaught exception when the pool has no error listener', async () => {
    const world: World = { closed: false };
    const pool = setup(world);
    (await pool.connect()).release();
    await pool.end();

    expect(() => world.client!.emit('error', fatal())).toThrow('terminating connection');
    await settle();
  });

  it('the same late termination is harmless once the pool has an error listener', async () => {
    const world: World = { closed: false };
    const pool = setup(world);
    const seen: string[] = [];
    pool.on('error', (error) => seen.push((error as { code?: string }).code ?? '?'));
    (await pool.connect()).release();
    await pool.end();

    expect(() => world.client!.emit('error', fatal())).not.toThrow();
    expect(seen).toEqual(['57P01']);
    await settle();
  });
});
