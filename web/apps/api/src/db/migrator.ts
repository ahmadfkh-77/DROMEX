import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

/**
 * The DROMEX web migration mechanism.
 *
 * Deliberately small and DROMEX-only. Better Auth owns its own schema and
 * discovers what to apply by introspecting the live database; this migrator
 * never reads, applies, or reasons about Better Auth's SQL. Keeping the two
 * apart is what stops a DROMEX change from being credited to Better Auth's
 * schema state, or the reverse (DEC-431).
 *
 * This is not a deployment tool. It is the smallest thing that can apply an
 * ordered list of DROMEX migrations exactly once, safely, and provably.
 *
 * The connection arrives as a parameter. This module never reads
 * `process.env`, never loads a `.env` file, and contains no connection string
 * or credential of its own.
 */

export interface DromexMigration {
  /** Zero-padded, sorts lexicographically in application order. */
  id: string;
  name: string;
  sql: string;
}

export interface MigrationResult {
  /** Identifiers applied by this run. */
  applied: string[];
  /** Identifiers already recorded and left alone. */
  skipped: string[];
}

/**
 * Serialises migration runs across processes.
 *
 * A fixed key derived from a DROMEX-specific string, so two API instances
 * starting at once cannot both apply the same migration. The lock is held for
 * the whole run and released in a `finally`.
 */
export const ADVISORY_LOCK_KEY = 4_173_967_201;

const LEDGER_TABLE = 'dromex_migration';

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Rejects a migration set that is internally inconsistent, before anything is
 * applied. Ordering is derived here rather than trusted from the caller, so a
 * reordered array cannot change the sequence that reaches the database.
 */
function validateSet(migrations: readonly DromexMigration[]): DromexMigration[] {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new Error(
        `Duplicate DROMEX migration identifier ${JSON.stringify(migration.id)}.`,
      );
    }
    seen.add(migration.id);
  }

  return [...migrations].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Applies every DROMEX migration that has not been applied yet.
 *
 * Fails closed, in every direction:
 *
 * - a recorded migration whose SQL has since changed is refused, because the
 *   database no longer matches the file that claims to describe it;
 * - a migration recorded in the ledger but absent from the supplied set is
 *   refused, because the history is incomplete and the next migration would
 *   be applied on top of an unknown state;
 * - a duplicate identifier is refused;
 * - each migration runs inside its own transaction together with its ledger
 *   row, so a failure leaves neither the schema change nor the record of it.
 */
export async function applyMigrations(
  pool: Pool,
  migrations: readonly DromexMigration[],
): Promise<MigrationResult> {
  const ordered = validateSet(migrations);
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureLedger(client);

    const { rows: recorded } = await client.query<{ id: string; checksum: string }>(
      `SELECT id, checksum FROM ${LEDGER_TABLE}`,
    );
    const recordedById = new Map(recorded.map((row) => [row.id, row.checksum]));

    const supplied = new Set(ordered.map((migration) => migration.id));
    for (const id of recordedById.keys()) {
      if (!supplied.has(id)) {
        throw new Error(
          `DROMEX migration ${JSON.stringify(id)} is recorded as applied but is missing from the migration set.`,
        );
      }
    }

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of ordered) {
      const checksum = checksumOf(migration.sql);
      const previous = recordedById.get(migration.id);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `DROMEX migration ${JSON.stringify(migration.id)} has already been applied, but its checksum changed. An applied migration must never be edited; add a new one instead.`,
          );
        }
        skipped.push(migration.id);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${LEDGER_TABLE} (id, name, checksum) VALUES ($1, $2, $3)`,
          [migration.id, migration.name, checksum],
        );
        await client.query('COMMIT');
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw cause;
      }

      applied.push(migration.id);
    }

    return { applied, skipped };
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
}
