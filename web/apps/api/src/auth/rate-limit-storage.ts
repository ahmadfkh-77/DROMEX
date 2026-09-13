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

export interface RateLimitStorage {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
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

export function createRateLimitStorage(
  pool: Pool,
  now: () => number = Date.now,
): RateLimitStorage {
  return {
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
      try {
        await client.query('BEGIN');

        // Ensure the row exists, then lock it. Concurrent requests for the
        // same key queue on the row lock, so the read-decide-write below is
        // atomic and no increment can be lost or double-granted.
        await client.query(
          `INSERT INTO ${TABLE} (key, count, last_request_ms) VALUES ($1, 0, $2)
           ON CONFLICT (key) DO NOTHING`,
          [key, String(current)],
        );
        const { rows } = await client.query<{ count: unknown; last_request_ms: unknown }>(
          `SELECT count, last_request_ms FROM ${TABLE} WHERE key = $1 FOR UPDATE`,
          [key],
        );
        const row = rows[0];
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
        return decision;
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw cause;
      } finally {
        client.release();
      }
    },
  };
}
