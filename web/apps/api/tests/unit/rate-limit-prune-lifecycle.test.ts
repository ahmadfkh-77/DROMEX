import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMIT_PRUNE_MIN_RETENTION_MS,
  RateLimitStorageError,
  createRateLimitStorage,
} from '../../src/auth/rate-limit-storage.ts';

/**
 * SEC-1b v2 (DEC-492): how a background prune fails, is configured, and ends.
 * A scripted fake pool; no database. The database counterparts are in
 * tests/integration/rate-limit-prune.test.ts.
 */

const NOW = 1_800_000_000_000;
const RULE = { window: 60, max: 5 };
const KEY = '192.0.2.1|/sign-in/email';

type Script = (sql: string) => { rows: unknown[]; rowCount: number };

function fakePool(script: Script) {
  const statements: { sql: string; values: unknown[] | undefined }[] = [];
  const counts = { connects: 0, releases: 0 };
  const client = {
    async query(sql: string, values?: unknown[]) {
      const normal = sql.replace(/\s+/g, ' ').trim();
      statements.push({ sql: normal, values });
      return script(normal);
    },
    release() {
      counts.releases += 1;
    },
  };
  const pool = {
    async connect() {
      counts.connects += 1;
      return client;
    },
  } as unknown as Pool;
  return { pool, statements, counts };
}

const healthy: Script = (sql) => {
  if (sql.startsWith('SELECT count, last_request_ms')) return { rows: [{ count: 0, last_request_ms: '0' }], rowCount: 1 };
  return { rows: [], rowCount: 1 };
};
const failingDelete: Script = (sql) => {
  if (sql.startsWith('DELETE FROM')) throw new Error('synthetic prune failure with secret-row-content');
  return healthy(sql);
};
const deletes = (statements: { sql: string; values: unknown[] | undefined }[]) => statements.filter((entry) => entry.sql.startsWith('DELETE FROM'));

afterEach(() => vi.restoreAllMocks());

describe('background prune failure reporting', () => {
  it('reports only a short fixed code, never the error, a key or a row', async () => {
    const { pool } = fakePool(failingDelete);
    const codes: unknown[][] = [];
    let clock = NOW;
    const storage = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1000, onPruneError: (...args: unknown[]) => void codes.push(args) });
    await storage.consume(KEY, RULE);
    clock = NOW + 1000;
    await storage.consume(KEY, RULE);
    await storage.settled();
    expect(codes).toEqual([['rate_limit_prune_failed']]);
  });

  it('writes the same short code to stderr when no callback is given, and nothing else', async () => {
    const { pool } = fakePool(failingDelete);
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    let clock = NOW;
    const storage = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1000 });
    await storage.consume(KEY, RULE);
    clock = NOW + 1000;
    await storage.consume(KEY, RULE);
    await storage.settled();
    const text = written.join('');
    expect(text).toContain('rate_limit_prune_failed');
    expect(text).not.toContain('secret-row-content');
    expect(text).not.toContain(KEY);
    expect(text.length).toBeLessThan(80);
  });

  it('survives a callback that throws: the request still decides and nothing is rejected unhandled', async () => {
    const { pool } = fakePool(failingDelete);
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      let clock = NOW;
      const storage = createRateLimitStorage(pool, () => clock, {
        pruneIntervalMs: 1000,
        onPruneError: () => {
          throw new Error('callback failure');
        },
      });
      await storage.consume(KEY, RULE);
      clock = NOW + 1000;
      await expect(storage.consume(KEY, RULE)).resolves.toEqual({ allowed: true, retryAfter: null });
      await storage.settled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });
});

describe('background prune configuration', () => {
  it('uses the configured retention and batch for the background prune', async () => {
    const { pool, statements } = fakePool(healthy);
    const retentionMs = RATE_LIMIT_PRUNE_MIN_RETENTION_MS * 2;
    let clock = NOW;
    const storage = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1000, retentionMs, batch: 7 });
    await storage.consume(KEY, RULE);
    clock = NOW + 1000;
    await storage.consume(KEY, RULE);
    await storage.settled();
    const [statement] = deletes(statements);
    expect(statement!.values).toEqual([String(clock - retentionMs), 7]);
  });

  it('refuses an unsafe configuration when the storage is created, not later', () => {
    const { pool } = fakePool(healthy);
    for (const bad of [
      { pruneIntervalMs: 0 },
      { pruneIntervalMs: -1 },
      { pruneIntervalMs: 1.5 },
      { pruneIntervalMs: 1000, retentionMs: RATE_LIMIT_PRUNE_MIN_RETENTION_MS - 1 },
      { pruneIntervalMs: 1000, batch: 0 },
      { pruneIntervalMs: 1000, batch: 1001 },
    ]) {
      expect(() => createRateLimitStorage(pool, () => NOW, bad), JSON.stringify(bad)).toThrow(RateLimitStorageError);
    }
  });
});

describe('background prune lifecycle', () => {
  it('settled() resolves at once when nothing is running, and waits for a running prune', async () => {
    const { pool, counts } = fakePool(healthy);
    let clock = NOW;
    const storage = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1000 });
    await expect(storage.settled()).resolves.toBeUndefined();
    await storage.consume(KEY, RULE);
    clock = NOW + 1000;
    await storage.consume(KEY, RULE);
    await storage.settled();
    // Every connection taken, by the two requests and the prune, was returned.
    expect(counts.releases).toBe(counts.connects);
    expect(counts.connects).toBe(3);
  });

  it('never prunes when it was not asked to, and leaves no timer behind', async () => {
    const { pool, statements } = fakePool(healthy);
    const storage = createRateLimitStorage(pool, () => NOW);
    await storage.consume(KEY, RULE);
    await storage.settled();
    expect(deletes(statements)).toHaveLength(0);
    // The pruning is driven by requests, not a timer, so there is nothing to stop at shutdown.
    const source = await readFile(fileURLToPath(new URL('../../src/auth/rate-limit-storage.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/(setInterval|setTimeout|setImmediate)/);
  });

  it('settled() waits for every running prune, even when a later one started before an earlier ended', async () => {
    const releases: Array<() => void> = [];
    const finished: boolean[] = [];
    let deletesSeen = 0;
    const { pool } = fakePool((sql) => {
      if (sql.startsWith('DELETE FROM')) {
        const index = deletesSeen;
        deletesSeen += 1;
        return new Promise((resolve) => releases.push(() => (finished[index] = true, resolve({ rows: [], rowCount: 0 })))) as never;
      }
      return healthy(sql);
    });
    let clock = NOW;
    const storage = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1000 });
    await storage.consume(KEY, RULE);
    clock += 1000;
    await storage.consume(KEY, RULE);
    clock += 1000;
    await storage.consume(KEY, RULE);
    for (let turn = 0; turn < 20 && releases.length < 2; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(releases).toHaveLength(2);
    let settled = false;
    const waiting = storage.settled().then(() => (settled = true));
    releases[1]!();
    for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    releases[0]!();
    await waiting;
    expect(finished).toEqual([true, true]);
  });

  it('a clock that steps backwards restarts the interval instead of stalling pruning', async () => {
    const { pool, statements } = fakePool(healthy);
    let clock = NOW;
    const storage = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1000 });
    await storage.consume(KEY, RULE); // starts the interval at NOW
    clock = NOW - 6 * 60 * 60 * 1000; // stepped back six hours
    await storage.consume(KEY, RULE); // restarts the interval here
    clock += 1000;
    await storage.consume(KEY, RULE);
    await storage.settled();
    expect(deletes(statements)).toHaveLength(1);
  });

  it('a prune that starts after the pool has ended fails quietly with the one code', async () => {
    let ended = false;
    const { pool } = fakePool(healthy);
    const original = pool.connect.bind(pool) as () => Promise<unknown>;
    (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => {
      if (ended) throw new Error('Cannot use a pool after calling end on the pool');
      return original();
    };
    const codes: string[] = [];
    let clock = NOW;
    const storage = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1000, onPruneError: (code) => void codes.push(code) });
    await storage.consume(KEY, RULE);
    clock += 1000;
    // The request commits and releases first; the pool ends before the prune connects.
    const request = storage.consume(KEY, RULE);
    await request;
    ended = true;
    await storage.settled();
    expect(codes.length).toBeLessThanOrEqual(1);
    for (const code of codes) expect(code).toBe('rate_limit_prune_failed');
  });
});
