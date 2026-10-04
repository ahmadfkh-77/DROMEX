import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  RATE_LIMIT_MAX_WINDOW_SECONDS,
  RATE_LIMIT_PRUNE_BATCH,
  RATE_LIMIT_PRUNE_MAX_BATCH,
  RATE_LIMIT_PRUNE_MIN_RETENTION_MS,
  RATE_LIMIT_PRUNE_RETENTION_MS,
  RateLimitStorageError,
  createRateLimitStorage,
} from '../../src/auth/rate-limit-storage.ts';

/**
 * PROPOSAL (SEC-1b, DEC-492, pending Owner review): pruning idle rate-limit
 * rows. These tests use a scripted fake pool and need no database; the
 * real-database counterparts are in tests/integration/rate-limit-prune.test.ts.
 */

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const RULE = { window: 60, max: 5 };
const KEY = '192.0.2.1|/sign-in/email';

interface Statement {
  sql: string;
  values: unknown[] | undefined;
}

type Reply = { rows: unknown[]; rowCount: number };
type Script = (sql: string, values: unknown[] | undefined) => Reply | Promise<Reply>;

const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** A pool whose connections run a script and record every statement. */
function fakePool(script: Script) {
  const statements: Statement[] = [];
  const counts = { connects: 0, releases: 0 };
  const client = {
    async query(sql: string, values?: unknown[]) {
      const normal = squash(sql);
      statements.push({ sql: normal, values });
      return script(normal, values);
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

/** A consume() that finds a fresh row, and a prune that deletes `deleted` rows. */
function freshRows(deleted = 0): Script {
  return (sql) => {
    if (sql.startsWith('SELECT count, last_request_ms')) return { rows: [{ count: 0, last_request_ms: '0' }], rowCount: 1 };
    if (sql.startsWith('DELETE FROM')) return { rows: [], rowCount: deleted };
    return { rows: [], rowCount: 1 };
  };
}

const deletes = (statements: Statement[]) => statements.filter((entry) => entry.sql.startsWith('DELETE FROM'));
const flush = async () => {
  for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

describe('pruning idle rate-limit rows (SEC-1b proposal)', () => {
  describe('prune()', () => {
    it('issues one bounded, oldest-first, skip-locked delete whose cutoff is now minus the retention', async () => {
      const { pool, statements, counts } = fakePool(freshRows(7));

      const removed = await createRateLimitStorage(pool, () => NOW).prune();

      expect(removed).toBe(7);
      expect(statements.map((entry) => entry.sql.split(' ').slice(0, 2).join(' '))).toEqual(['BEGIN', 'SET LOCAL', 'DELETE FROM', 'COMMIT']);
      expect(statements[1]!.sql).toBe('SET LOCAL statement_timeout = 2000');
      const [remove] = deletes(statements);
      expect(remove!.sql).toContain('WHERE last_request_ms < $1');
      expect(remove!.sql).toContain('ORDER BY last_request_ms');
      expect(remove!.sql).toContain('LIMIT $2');
      expect(remove!.sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(remove!.values).toEqual([String(NOW - DAY), RATE_LIMIT_PRUNE_BATCH]);
      expect(RATE_LIMIT_PRUNE_RETENTION_MS).toBe(DAY);
      expect(counts).toEqual({ connects: 1, releases: 1 });
    });

    it('accepts exactly the retention floor and the batch limits, and uses them as given', async () => {
      const { pool, statements } = fakePool(freshRows());
      const storage = createRateLimitStorage(pool, () => NOW);

      await storage.prune({ retentionMs: RATE_LIMIT_PRUNE_MIN_RETENTION_MS, batch: 1 });
      await storage.prune({ retentionMs: RATE_LIMIT_PRUNE_MIN_RETENTION_MS + 1, batch: RATE_LIMIT_PRUNE_MAX_BATCH });

      expect(deletes(statements).map((entry) => entry.values)).toEqual([
        [String(NOW - RATE_LIMIT_PRUNE_MIN_RETENTION_MS), 1],
        [String(NOW - RATE_LIMIT_PRUNE_MIN_RETENTION_MS - 1), RATE_LIMIT_PRUNE_MAX_BATCH],
      ]);
    });

    it('refuses a retention below the floor, a bad batch, or a bad clock before it touches the database', async () => {
      const { pool, counts } = fakePool(freshRows());
      const storage = createRateLimitStorage(pool, () => NOW);

      for (const retentionMs of [RATE_LIMIT_PRUNE_MIN_RETENTION_MS - 1, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(storage.prune({ retentionMs }), `retention ${retentionMs}`).rejects.toBeInstanceOf(RateLimitStorageError);
      }
      for (const batch of [0, -1, 1.5, Number.NaN, RATE_LIMIT_PRUNE_MAX_BATCH + 1]) {
        await expect(storage.prune({ batch }), `batch ${batch}`).rejects.toBeInstanceOf(RateLimitStorageError);
      }
      for (const clock of [-1, 1.5, Number.NaN]) {
        await expect(createRateLimitStorage(pool, () => clock).prune(), `clock ${clock}`).rejects.toBeInstanceOf(RateLimitStorageError);
      }
      expect(counts.connects).toBe(0);
    });

    it('does nothing when the clock is too early for any row to be old enough', async () => {
      const { pool, counts } = fakePool(freshRows(3));

      expect(await createRateLimitStorage(pool, () => DAY).prune()).toBe(0);
      expect(counts.connects).toBe(0);
    });

    it('rolls back, releases the connection, and reports the failure when the delete fails', async () => {
      const { pool, statements, counts } = fakePool((sql) => {
        if (sql.startsWith('DELETE FROM')) throw new Error('synthetic delete failure');
        return { rows: [], rowCount: 1 };
      });

      await expect(createRateLimitStorage(pool, () => NOW).prune()).rejects.toThrow('synthetic delete failure');

      expect(statements.map((entry) => entry.sql.split(' ')[0])).toEqual(['BEGIN', 'SET', 'DELETE', 'ROLLBACK']);
      expect(counts).toEqual({ connects: 1, releases: 1 });
    });
  });

  describe('pruning after a request', () => {
    it('never prunes unless it was asked to', async () => {
      const { pool, statements } = fakePool(freshRows());
      let clock = NOW;
      const storage = createRateLimitStorage(pool, () => clock);

      for (let step = 0; step < 5; step += 1) {
        await storage.consume(KEY, RULE);
        clock += 7 * DAY;
      }
      await flush();

      expect(deletes(statements)).toHaveLength(0);
    });

    it('starts at most one background prune per interval, and the first only after a full interval', async () => {
      const { pool, statements } = fakePool(freshRows());
      let clock = NOW;
      const storage = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1000 });
      const prunes = async () => {
        await flush();
        return deletes(statements).length;
      };

      await storage.consume(KEY, RULE); // t = 0: the interval starts here
      expect(await prunes()).toBe(0);
      clock = NOW + 999;
      await storage.consume(KEY, RULE);
      expect(await prunes()).toBe(0);
      clock = NOW + 1000;
      await storage.consume(KEY, RULE); // one full interval: due
      expect(await prunes()).toBe(1);
      clock = NOW + 1500;
      await storage.consume(KEY, RULE);
      expect(await prunes()).toBe(1);
      clock = NOW + 2000;
      await storage.consume(KEY, RULE);
      expect(await prunes()).toBe(2);
    });

    it('shares the interval between storages on one pool, and keeps separate pools apart', async () => {
      const first = fakePool(freshRows());
      const second = fakePool(freshRows());
      let clock = NOW;
      const options = { pruneIntervalMs: 1000 };
      const a = createRateLimitStorage(first.pool, () => clock, options);
      const b = createRateLimitStorage(first.pool, () => clock, options);
      const other = createRateLimitStorage(second.pool, () => clock, options);

      await a.consume(KEY, RULE);
      await other.consume(KEY, RULE);
      clock = NOW + 1000;
      await b.consume(KEY, RULE); // due for the shared pool: one prune
      await a.consume(KEY, RULE); // the same pool, same instant: none
      await other.consume(KEY, RULE); // the other pool's own interval is due
      await flush();

      expect(deletes(first.statements)).toHaveLength(1);
      expect(deletes(second.statements)).toHaveLength(1);
    });

    it('never lets a failed prune block, delay, or change a request, or surface as an unhandled rejection', async () => {
      const failing = fakePool((sql) => {
        if (sql.startsWith('DELETE FROM')) throw new Error('synthetic prune failure');
        return freshRows()(sql, undefined);
      });
      const plain = fakePool(freshRows());
      let failures = 0;
      let clock = NOW;
      const withFailingPrune = createRateLimitStorage(failing.pool, () => clock, {
        pruneIntervalMs: 1000,
        onPruneError: () => {
          failures += 1;
        },
      });
      const withoutPrune = createRateLimitStorage(plain.pool, () => clock);

      const decisions = async (storage: ReturnType<typeof createRateLimitStorage>) => {
        const out = [];
        clock = NOW;
        for (let step = 0; step < 8; step += 1) {
          out.push(await storage.consume(KEY, RULE));
          clock += 700;
        }
        return out;
      };
      const noisy = await decisions(withFailingPrune);
      await flush();
      const quiet = await decisions(withoutPrune);

      expect(noisy).toEqual(quiet);
      expect(failures).toBeGreaterThanOrEqual(1);
      expect(deletes(failing.statements).length).toBeGreaterThanOrEqual(1);
    });

    it('tolerates a failing prune with no error callback at all', async () => {
      const { pool } = fakePool((sql) => {
        if (sql.startsWith('DELETE FROM')) throw new Error('synthetic prune failure');
        return freshRows()(sql, undefined);
      });
      let clock = NOW;
      const storage = createRateLimitStorage(pool, () => clock, { pruneIntervalMs: 1000 });

      await storage.consume(KEY, RULE);
      clock = NOW + 1000;
      await expect(storage.consume(KEY, RULE)).resolves.toEqual({ allowed: true, retryAfter: null });
      await flush();
    });
  });

  describe('a row pruned while a request is using its key', () => {
    it('is recreated once, and the request decides exactly as for a fresh row', async () => {
      let selects = 0;
      const { pool, statements } = fakePool((sql) => {
        if (sql.startsWith('SELECT count, last_request_ms')) {
          selects += 1;
          return selects === 1 ? { rows: [], rowCount: 0 } : { rows: [{ count: 0, last_request_ms: String(NOW) }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      });

      expect(await createRateLimitStorage(pool, () => NOW).consume(KEY, RULE)).toEqual({ allowed: true, retryAfter: null });

      expect(statements.filter((entry) => entry.sql.startsWith('INSERT INTO')).length).toBe(2);
      expect(statements.some((entry) => entry.sql === 'COMMIT')).toBe(true);
    });

    it('fails closed, with a rollback, if the row is still missing after the retry', async () => {
      const { pool, statements, counts } = fakePool((sql) =>
        sql.startsWith('SELECT count, last_request_ms') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 },
      );

      await expect(createRateLimitStorage(pool, () => NOW).consume(KEY, RULE)).rejects.toBeInstanceOf(RateLimitStorageError);

      expect(statements.filter((entry) => entry.sql.startsWith('INSERT INTO')).length).toBe(2);
      expect(statements.some((entry) => entry.sql === 'ROLLBACK')).toBe(true);
      expect(statements.some((entry) => entry.sql === 'COMMIT')).toBe(false);
      expect(counts.releases).toBe(counts.connects);
    });
  });

  describe('boundaries in the source', () => {
    const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
    const STORAGE = join(SRC, 'auth', 'rate-limit-storage.ts');
    let files: Array<{ path: string; text: string }> = [];

    beforeAll(async () => {
      const list = async (directory: string): Promise<string[]> => {
        const entries = await readdir(directory, { withFileTypes: true });
        const nested = await Promise.all(
          entries.map((entry) => {
            const path = join(directory, entry.name);
            return entry.isDirectory() ? list(path) : Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
          }),
        );
        return nested.flat();
      };
      files = await Promise.all((await list(SRC)).map(async (path) => ({ path, text: await readFile(path, 'utf8') })));
    });

    it('keeps every configured window within the longest window the retention is built on', () => {
      const windows: Array<[string, string]> = [];
      for (const file of files) {
        if (file.path === STORAGE) continue;
        for (const match of file.text.matchAll(/\bwindow:\s*([^\s,}]+)/g)) windows.push([relative(SRC, file.path).replaceAll('\\', '/'), match[1]!]);
      }

      expect(windows.length).toBeGreaterThan(10);
      for (const [file, value] of windows) {
        expect(value, `${file} must give its window as a plain number`).toMatch(/^[0-9_]+$/);
        expect(Number(value.replaceAll('_', '')), `${file} window`).toBeLessThanOrEqual(RATE_LIMIT_MAX_WINDOW_SECONDS);
      }
      expect(Math.max(...windows.map(([, value]) => Number(value.replaceAll('_', ''))))).toBe(RATE_LIMIT_MAX_WINDOW_SECONDS);
      expect(RATE_LIMIT_PRUNE_MIN_RETENTION_MS).toBeGreaterThanOrEqual(4 * RATE_LIMIT_MAX_WINDOW_SECONDS * 1000);
      expect(RATE_LIMIT_PRUNE_RETENTION_MS).toBeGreaterThan(RATE_LIMIT_PRUNE_MIN_RETENTION_MS);
    });

    it('lets only the storage module define or call prune, so no route or service can reach it', () => {
      const naming = files.filter((file) => /\bprune\s*\(/.test(file.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')));
      expect(naming.map((file) => relative(SRC, file.path).replaceAll('\\', '/'))).toEqual(['auth/rate-limit-storage.ts']);
    });

    it('turns pruning on only through the one shared interval constant', () => {
      const users = files.filter((file) => /pruneIntervalMs\s*:/.test(file.text) && file.path !== STORAGE);
      expect(users.map((file) => relative(SRC, file.path).replaceAll('\\', '/')).sort()).toEqual([
        'auth/config.ts',
        'invitations/invitation-acceptance.ts',
        'password-reset/password-reset.ts',
      ]);
      for (const file of users) expect(file.text).toMatch(/pruneIntervalMs:\s*RATE_LIMIT_PRUNE_INTERVAL_MS\b/);
    });
  });
});
