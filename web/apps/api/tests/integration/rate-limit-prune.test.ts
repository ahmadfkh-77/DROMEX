import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RATE_LIMIT_PRUNE_BATCH,
  RATE_LIMIT_PRUNE_MIN_RETENTION_MS,
  RateLimitStorageError,
  createRateLimitStorage,
} from '../../src/auth/rate-limit-storage.ts';
import { migrateAuthSchema } from '../helpers/auth-fixtures.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

/**
 * PROPOSAL (SEC-1b, DEC-492, pending Owner review): pruning idle rows of
 * `dromex_rate_limit`. A row idle for longer than its rule's window behaves
 * exactly like a missing row, so removing rows idle for far longer than the
 * longest window (900 seconds) changes no decision. Real PostgreSQL 18.6.
 */

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const CUTOFF = NOW - DAY;
const RULE = { window: 60, max: 5 };

describe('pruning idle rate-limit rows on PostgreSQL 18.6 (SEC-1b proposal)', () => {
  let database: EphemeralDatabase;
  let pool: Pool;

  beforeEach(async () => {
    database = await createEphemeralDatabase();
    pool = new Pool({ connectionString: database.uri, max: 20 });
    await migrateAuthSchema(pool);
  });

  afterEach(async () => {
    await pool?.end().catch(() => undefined);
    await database?.drop().catch(() => undefined);
  });

  const storage = () => createRateLimitStorage(pool, () => NOW);

  async function seed(key: string, count: number, lastRequestMs: number): Promise<void> {
    await pool.query('INSERT INTO dromex_rate_limit (key, count, last_request_ms) VALUES ($1, $2, $3)', [key, count, String(lastRequestMs)]);
  }
  async function seedStale(prefix: string, rows: number): Promise<string[]> {
    const keys = Array.from({ length: rows }, (_, index) => `${prefix}-${String(index).padStart(4, '0')}`);
    // Oldest first, all far beyond the retention.
    for (const [index, key] of keys.entries()) await seed(key, 5, CUTOFF - 1_000 - (rows - index));
    return keys;
  }
  async function stored(): Promise<Array<{ key: string; count: number; last: string }>> {
    const { rows } = await pool.query<{ key: string; count: number; last: string }>(
      'SELECT key, count, last_request_ms::text AS last FROM dromex_rate_limit ORDER BY key',
    );
    return rows;
  }
  const keysLeft = async () => (await stored()).map((row) => row.key);

  it('deletes rows idle for longer than the retention, and keeps a row exactly at the cutoff', async () => {
    await seed('older', 5, CUTOFF - 1);
    await seed('at-cutoff', 5, CUTOFF);
    await seed('newer', 5, CUTOFF + 1);

    expect(await storage().prune()).toBe(1);

    expect(await keysLeft()).toEqual(['at-cutoff', 'newer']);
  });

  it('never deletes a row that could still count, and a blocked key stays blocked', async () => {
    await seed('blocked', 5, NOW - 30_000); // blocked now, 30 seconds into its window
    await seed('recent', 1, NOW - 15 * 60 * 1000);
    await seed('almost-a-day', 5, CUTOFF + 60_000);
    await seed('stale', 5, CUTOFF - 60_000);

    expect(await storage().prune()).toBe(1);

    expect(await keysLeft()).toEqual(['almost-a-day', 'blocked', 'recent']);
    expect(await storage().consume('blocked', RULE)).toEqual({ allowed: false, retryAfter: 30 });
  });

  it('removes only rows that already behave like missing ones: the decision is the same either way', async () => {
    // Two identical long-idle rows; the batch removes only the older one.
    await seed('pruned', 5, CUTOFF - 2_000);
    await seed('kept', 5, CUTOFF - 1_000);
    await seed('never-existed-sentinel', 1, NOW);

    expect(await storage().prune({ batch: 1 })).toBe(1);
    expect(await keysLeft()).toEqual(['kept', 'never-existed-sentinel']);

    const decisions = [await storage().consume('pruned', RULE), await storage().consume('kept', RULE), await storage().consume('brand-new', RULE)];
    expect(decisions).toEqual([
      { allowed: true, retryAfter: null },
      { allowed: true, retryAfter: null },
      { allowed: true, retryAfter: null },
    ]);
    const afterwards = Object.fromEntries((await stored()).map((row) => [row.key, [row.count, row.last]]));
    expect(afterwards.pruned).toEqual([1, String(NOW)]);
    expect(afterwards.kept).toEqual([1, String(NOW)]);
    expect(afterwards['brand-new']).toEqual([1, String(NOW)]);
  });

  it('is bounded: never more than the batch per run, oldest first, and it drains in steps', async () => {
    const keys = await seedStale('stale', 250);
    await seed('live', 1, NOW);

    expect(RATE_LIMIT_PRUNE_BATCH).toBe(100);
    expect(await storage().prune()).toBe(100);
    expect((await keysLeft()).filter((key) => key.startsWith('stale'))).toEqual(keys.slice(100));
    expect(await storage().prune()).toBe(100);
    expect(await storage().prune({ batch: 7 })).toBe(7);
    expect(await storage().prune()).toBe(43);
    expect(await storage().prune()).toBe(0);
    expect(await keysLeft()).toEqual(['live']);
  });

  it('skips a row another request holds locked, without waiting, and takes it on the next run', async () => {
    await seedStale('stale', 3);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT key FROM dromex_rate_limit WHERE key = 'stale-0001' FOR UPDATE`);

      const started = Date.now();
      const removed = await storage().prune();
      const waited = Date.now() - started;

      expect(removed).toBe(2);
      expect(waited).toBeLessThan(1_500);
      expect(await keysLeft()).toEqual(['stale-0001']);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }

    expect(await storage().prune()).toBe(1);
    expect(await keysLeft()).toEqual([]);
  });

  it('refuses a retention below the floor and changes nothing', async () => {
    await seed('stale', 5, 1);

    await expect(storage().prune({ retentionMs: RATE_LIMIT_PRUNE_MIN_RETENTION_MS - 1 })).rejects.toBeInstanceOf(RateLimitStorageError);
    await expect(storage().prune({ batch: 0 })).rejects.toBeInstanceOf(RateLimitStorageError);

    expect(await keysLeft()).toEqual(['stale']);
  });

  it('lets requests and a prune run together on the same long-idle keys, without error or a wrong decision', async () => {
    const keys = await seedStale('stale', 100);
    const live = storage();

    const results = await Promise.allSettled([live.prune(), ...keys.map((key) => live.consume(key, RULE))]);

    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    for (const result of results.slice(1)) {
      expect((result as PromiseFulfilledResult<unknown>).value).toEqual({ allowed: true, retryAfter: null });
    }
    // Every key was consumed once, whether or not the prune took its stale row first.
    const rows = await stored();
    expect(rows.map((row) => row.key)).toEqual(keys);
    for (const row of rows) expect([row.count, row.last]).toEqual([1, String(NOW)]);
  });

  it('prunes in the background after a request once the interval has passed, without changing the request', async () => {
    await seedStale('stale', 5);
    let clock = NOW;
    let failures = 0;
    const live = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1_000, onPruneError: () => (failures += 1) });

    expect(await live.consume('trigger', RULE)).toEqual({ allowed: true, retryAfter: null }); // starts the interval
    expect(await keysLeft()).toHaveLength(6);
    clock = NOW + 1_000;
    expect(await live.consume('trigger', RULE)).toEqual({ allowed: true, retryAfter: null }); // due: prunes after it

    for (let attempt = 0; attempt < 100 && (await keysLeft()).length > 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await keysLeft()).toEqual(['trigger']);
    expect(failures).toBe(0);
  });

  it('uses the new index for its oldest-first lookup', async () => {
    await seedStale('stale', 20);
    const client = await pool.connect();
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': unknown }>(
        'EXPLAIN (FORMAT JSON) SELECT key FROM dromex_rate_limit WHERE last_request_ms < 1 ORDER BY last_request_ms LIMIT 100 FOR UPDATE SKIP LOCKED',
      );
      expect(JSON.stringify(rows[0]!['QUERY PLAN'])).toContain('dromex_rate_limit_last_request');
    } finally {
      client.release();
    }
  });
});
