import { Pool, types } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createRateLimitStorage,
  RateLimitStorageError,
} from '../../src/auth/rate-limit-storage.ts';
import { migrateAuthSchema } from '../helpers/auth-fixtures.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

const RULE = { window: 60, max: 5 };
const KEY = '192.0.2.1|/sign-in/email';
const T0 = 1_789_289_796_705;

describe('DROMEX rate-limit storage on PostgreSQL 18.6', () => {
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

  async function storedRow() {
    const { rows } = await pool.query<{ count: number; last_request_ms: string }>(
      `SELECT count, last_request_ms FROM dromex_rate_limit WHERE key = $1`,
      [KEY],
    );
    return rows[0];
  }

  it('is created by the DROMEX migrator, with a BIGINT millisecond column', async () => {
    const ledger = await pool.query(`SELECT id, name FROM dromex_migration ORDER BY id`);
    expect(ledger.rows).toEqual([
      { id: '0001', name: 'dromex_principal' },
      { id: '0002', name: 'dromex_rate_limit' },
      { id: '0003', name: 'dromex_owner_bootstrap' },
    ]);

    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dromex_rate_limit'`,
    );
    expect(Object.fromEntries(rows.map((row) => [row.column_name, row.data_type]))).toEqual({
      key: 'text',
      count: 'integer',
      last_request_ms: 'bigint',
    });
  });

  it('round-trips a stored millisecond timestamp exactly', async () => {
    let clock = T0;
    const storage = createRateLimitStorage(pool, () => clock);

    await storage.consume(KEY, RULE);
    expect(await storedRow()).toEqual({ count: 1, last_request_ms: String(T0) });

    for (let i = 0; i < 4; i += 1) await storage.consume(KEY, RULE);
    clock = T0 + 20_000;

    // The retry time is derived from the value read back, so an exact
    // round-trip is what makes it exactly 40 seconds.
    expect(await storage.consume(KEY, RULE)).toEqual({ allowed: false, retryAfter: 40 });
  });

  it('allows five requests, blocks the sixth with a bounded retry time, and resets after the window', async () => {
    let clock = T0;
    const storage = createRateLimitStorage(pool, () => clock);

    for (let i = 0; i < 5; i += 1) {
      expect(await storage.consume(KEY, RULE)).toEqual({ allowed: true, retryAfter: null });
    }
    expect(await storage.consume(KEY, RULE)).toEqual({ allowed: false, retryAfter: 60 });

    clock = T0 + 59_001;
    expect(await storage.consume(KEY, RULE)).toEqual({ allowed: false, retryAfter: 1 });

    clock = T0 + 60_000;
    expect(await storage.consume(KEY, RULE)).toEqual({ allowed: true, retryAfter: null });
    expect(await storedRow()).toEqual({ count: 1, last_request_ms: String(T0 + 60_000) });
  });

  it('never reports a retry time above the window, even for a timestamp in the future', async () => {
    await pool.query(
      `INSERT INTO dromex_rate_limit (key, count, last_request_ms) VALUES ($1, 5, $2)`,
      [KEY, String(T0 + 3_600_000)],
    );
    const storage = createRateLimitStorage(pool, () => T0);

    expect(await storage.consume(KEY, RULE)).toEqual({ allowed: false, retryAfter: 60 });
  });

  it('refuses negative timestamps and counts at the database level', async () => {
    await expect(
      pool.query(`INSERT INTO dromex_rate_limit (key, count, last_request_ms) VALUES ($1, 1, -1)`, [KEY]),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      pool.query(`INSERT INTO dromex_rate_limit (key, count, last_request_ms) VALUES ($1, -1, 1)`, [KEY]),
    ).rejects.toThrow(/check constraint/i);
  });

  it('fails closed on a stored timestamp outside the safe integer range, changing nothing', async () => {
    await pool.query(
      `INSERT INTO dromex_rate_limit (key, count, last_request_ms) VALUES ($1, 1, 9007199254740993)`,
      [KEY],
    );
    const storage = createRateLimitStorage(pool);

    await expect(storage.consume(KEY, RULE)).rejects.toBeInstanceOf(RateLimitStorageError);
    expect(await storedRow()).toEqual({ count: 1, last_request_ms: '9007199254740993' });
  });

  it('fails closed on an invalid clock or rule', async () => {
    await expect(createRateLimitStorage(pool, () => -1).consume(KEY, RULE)).rejects.toBeInstanceOf(
      RateLimitStorageError,
    );
    await expect(createRateLimitStorage(pool, () => 1.5).consume(KEY, RULE)).rejects.toBeInstanceOf(
      RateLimitStorageError,
    );
    const storage = createRateLimitStorage(pool);
    await expect(storage.consume(KEY, { window: 0, max: 5 })).rejects.toBeInstanceOf(RateLimitStorageError);
    await expect(storage.consume(KEY, { window: 60, max: 1.5 })).rejects.toBeInstanceOf(RateLimitStorageError);
    expect(await storedRow()).toBeUndefined();
  });

  it('neither loses increments nor over-grants under concurrent requests', async () => {
    const storage = createRateLimitStorage(pool);

    const results = await Promise.all(
      Array.from({ length: 25 }, () => storage.consume(KEY, RULE)),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    for (const result of results.filter((entry) => !entry.allowed)) {
      expect(result.retryAfter).toBeGreaterThanOrEqual(1);
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    }
    expect((await storedRow())?.count).toBe(5);
  });

  it('keeps separate keys in separate buckets', async () => {
    const storage = createRateLimitStorage(pool, () => T0);
    for (let i = 0; i < 5; i += 1) await storage.consume(KEY, RULE);

    expect(await storage.consume('198.51.100.7|/sign-in/email', RULE)).toEqual({
      allowed: true,
      retryAfter: null,
    });
  });

  it('does not change the global node-postgres BIGINT parser', () => {
    createRateLimitStorage(pool);
    expect(types.getTypeParser(20, 'text')('9007199254740993')).toBe('9007199254740993');
  });
});
