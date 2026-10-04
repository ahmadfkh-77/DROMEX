import type { Pool } from 'pg';

/**
 * DROMEX-owned, PostgreSQL-backed rate-limit storage, plugged into Better
 * Auth through its supported `rateLimit.customStorage` interface.
 *
 * It exists because Better Auth 1.7.4's database storage reads its BIGINT
 * timestamp as the text node-postgres returns and then adds a number to it,
 * producing a corrupt retry time. This module reads its own BIGINT column
 * explicitly and never touches the process-wide type parser.
 *
 * Semantics mirror Better Auth's own storage: a key allows `max` requests;
 * once reached, it is blocked until `window` seconds after the last counted
 * request, then starts again at one.
 */

const TABLE = 'dromex_rate_limit';

/** Stored values are never echoed: a message could otherwise carry them. */
export class RateLimitStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitStorageError';
  }
}

export interface RateLimitRule {
  /** Seconds. */
  window: number;
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the key frees up; `null` when allowed. */
  retryAfter: number | null;
}

/**
 * PROPOSAL (SEC-1b, DEC-492, pending Owner review): pruning idle rows.
 *
 * A row whose last request is older than its rule's window is treated by
 * `consume` exactly like a missing row: the count restarts at one either way.
 * Deleting rows idle for far longer than any window therefore changes no
 * decision. The longest window any rule uses is 900 seconds; a unit test scans
 * the source and fails if a longer one appears, so this number cannot silently
 * fall behind the rules.
 */
export const RATE_LIMIT_MAX_WINDOW_SECONDS = 900;
/** Proposed: delete only rows idle for more than 24 hours. */
export const RATE_LIMIT_PRUNE_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Floor, four times the longest window: a shorter retention is refused. */
export const RATE_LIMIT_PRUNE_MIN_RETENTION_MS = 4 * RATE_LIMIT_MAX_WINDOW_SECONDS * 1000;
/** Proposed: a bounded delete, never more than this many rows per run. */
export const RATE_LIMIT_PRUNE_BATCH = 100;
/** Hard ceiling for the batch size. */
export const RATE_LIMIT_PRUNE_MAX_BATCH = 1000;
/** Proposed: at most one prune per pool every ten minutes of requests. */
export const RATE_LIMIT_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
/** A prune that runs longer than this is cancelled by the database. */
const PRUNE_STATEMENT_TIMEOUT_MS = 2_000;

export interface RateLimitPruneOptions {
  /** Delete rows idle for longer than this. Defaults to 24 hours; never below the floor. */
  retentionMs?: number;
  /** Delete at most this many rows. Defaults to 100; at most 1000. */
  batch?: number;
}

export interface RateLimitStorageOptions {
  /**
   * Prune idle rows after a request, at most once per interval per pool, in
   * the background. `null` (the default) never prunes.
   */
  pruneIntervalMs?: number | null;
  /** Called, with no detail, when a background prune fails. Never affects a request. */
  onPruneError?: () => void;
}

export interface RateLimitStorage {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
  /** Deletes up to a bounded number of long-idle rows and returns how many. */
  prune(options?: RateLimitPruneOptions): Promise<number>;
}

const BIGINT_TEXT = /^(0|[1-9][0-9]*)$/;

/** Converts node-postgres BIGINT text into an exact, safe, non-negative number. */
export function parseStoredMillis(value: unknown): number {
  if (typeof value !== 'string' || !BIGINT_TEXT.test(value)) {
    throw new RateLimitStorageError('A stored rate-limit timestamp is malformed.');
  }
  const millis = Number(value);
  if (!Number.isSafeInteger(millis)) {
    throw new RateLimitStorageError('A stored rate-limit timestamp is outside the safe range.');
  }
  return millis;
}

export function parseStoredCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RateLimitStorageError('A stored rate-limit count is malformed.');
  }
  return value;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** When each pool last started a prune, so many storages sharing a pool prune together, not each. */
const lastPruneStartedMs = new WeakMap<Pool, number>();

export function createRateLimitStorage(
  pool: Pool,
  now: () => number = Date.now,
  options: RateLimitStorageOptions = {},
): RateLimitStorage {
  const pruneIntervalMs = options.pruneIntervalMs ?? null;

  /** Starts a background prune when one is due. Never throws, never waits, never changes a decision. */
  function pruneWhenDue(current: number): void {
    if (pruneIntervalMs === null) return;
    const last = lastPruneStartedMs.get(pool);
    if (last === undefined) {
      lastPruneStartedMs.set(pool, current);
      return;
    }
    if (current - last < pruneIntervalMs) return;
    lastPruneStartedMs.set(pool, current);
    try {
      storage.prune().catch(() => options.onPruneError?.());
    } catch {
      options.onPruneError?.();
    }
  }

  const storage: RateLimitStorage = {
    async consume(key, rule) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
        throw new RateLimitStorageError('A rate-limit key is invalid.');
      }
      if (!isPositiveSafeInteger(rule?.window) || !isPositiveSafeInteger(rule?.max)) {
        throw new RateLimitStorageError('A rate-limit rule is invalid.');
      }
      const current = now();
      if (!Number.isSafeInteger(current) || current < 0) {
        throw new RateLimitStorageError('The rate-limit clock is invalid.');
      }
      const windowMs = rule.window * 1000;

      const client = await pool.connect();
      let committed = false;
      try {
        await client.query('BEGIN');

        // Ensure the row exists, then lock it. Concurrent requests for the
        // same key queue on the row lock, so the read-decide-write below is
        // atomic and no increment can be lost or double-granted.
        //
        // A prune may delete a long-idle row between the insert (which found
        // it and did nothing) and the lock. Inserting once more recreates it,
        // and a row that is gone is exactly a row that has expired, so the
        // decision is the same.
        let row: { count: unknown; last_request_ms: unknown } | undefined;
        for (let attempt = 0; attempt < 2 && row === undefined; attempt += 1) {
          await client.query(
            `INSERT INTO ${TABLE} (key, count, last_request_ms) VALUES ($1, 0, $2)
             ON CONFLICT (key) DO NOTHING`,
            [key, String(current)],
          );
          const locked = await client.query<{ count: unknown; last_request_ms: unknown }>(
            `SELECT count, last_request_ms FROM ${TABLE} WHERE key = $1 FOR UPDATE`,
            [key],
          );
          row = locked.rows[0];
        }
        if (!row) {
          throw new RateLimitStorageError('A rate-limit row could not be locked.');
        }
        const count = parseStoredCount(row.count);
        const lastRequest = parseStoredMillis(row.last_request_ms);

        let decision: RateLimitDecision;
        if (count === 0 || current - lastRequest >= windowMs) {
          await client.query(
            `UPDATE ${TABLE} SET count = 1, last_request_ms = $2 WHERE key = $1`,
            [key, String(current)],
          );
          decision = { allowed: true, retryAfter: null };
        } else if (count >= rule.max) {
          const seconds = Math.ceil((lastRequest + windowMs - current) / 1000);
          decision = { allowed: false, retryAfter: Math.min(rule.window, Math.max(1, seconds)) };
        } else {
          await client.query(
            `UPDATE ${TABLE} SET count = count + 1, last_request_ms = $2 WHERE key = $1`,
            [key, String(current)],
          );
          decision = { allowed: true, retryAfter: null };
        }

        await client.query('COMMIT');
        committed = true;
        return decision;
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw cause;
      } finally {
        client.release();
        // After the connection is back in the pool, so a prune never competes
        // with the request that triggered it.
        if (committed) pruneWhenDue(current);
      }
    },

    async prune(pruneOptions = {}) {
      const retentionMs = pruneOptions.retentionMs ?? RATE_LIMIT_PRUNE_RETENTION_MS;
      const batch = pruneOptions.batch ?? RATE_LIMIT_PRUNE_BATCH;
      if (!Number.isSafeInteger(retentionMs) || retentionMs < RATE_LIMIT_PRUNE_MIN_RETENTION_MS) {
        throw new RateLimitStorageError('A rate-limit retention is invalid.');
      }
      if (!Number.isSafeInteger(batch) || batch < 1 || batch > RATE_LIMIT_PRUNE_MAX_BATCH) {
        throw new RateLimitStorageError('A rate-limit prune batch is invalid.');
      }
      const current = now();
      if (!Number.isSafeInteger(current) || current < 0) {
        throw new RateLimitStorageError('The rate-limit clock is invalid.');
      }
      // A row exactly at the cutoff is kept: only rows idle for LONGER than the
      // retention are removed.
      const cutoff = current - retentionMs;
      if (cutoff <= 0) return 0;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = ${PRUNE_STATEMENT_TIMEOUT_MS}`);
        // Oldest first, at most `batch` rows, and rows another request has
        // locked are skipped: a row in use is by definition still counting.
        const result = await client.query(
          `DELETE FROM ${TABLE} WHERE key IN (
             SELECT key FROM ${TABLE}
              WHERE last_request_ms < $1
              ORDER BY last_request_ms
              LIMIT $2
              FOR UPDATE SKIP LOCKED)`,
          [String(cutoff), batch],
        );
        await client.query('COMMIT');
        return result.rowCount ?? 0;
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw cause;
      } finally {
        client.release();
      }
    },
  };
  return storage;
}
