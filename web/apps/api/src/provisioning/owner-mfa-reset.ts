import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import { createTwoFactorPlugin } from '../auth/config.ts';

/**
 * DEC-437: the one DROMEX module permitted to change a Better Auth-owned row,
 * and the checks that pin that permission to what was verified.
 *
 * Better Auth 1.7.4 offers no supported way to recover an Owner whose factor
 * is enabled, whose authenticator is lost, and who has no usable stored
 * recovery code. DEC-437 permits exactly two statements, for that case only,
 * and this module is the only place either may appear (a static allowlist
 * test enforces it):
 *
 * - W1 turns the single active Owner's two-factor flag off and stamps that
 *   row's update time, exactly as Better Auth's own disable does;
 * - W2 removes that Owner's existing factor row, and with it the lost secret,
 *   the stored codes, and the lockout counters.
 *
 * Nothing here inserts or rewrites a factor row: Better Auth's own enrolment
 * creates the replacement through its adapter, so its runtime defaults are
 * always present. No user id or email is accepted from any operator input;
 * the target is read from `dromex_principal`, locked, and checked again inside
 * the transaction, the factor state must still match what was classified, and
 * both statements must change exactly the expected number of rows, or the
 * whole transaction rolls back.
 *
 * The pinned version and schema below were verified against Better Auth
 * 1.7.4. Any Better Auth upgrade must re-review this module before either pin
 * changes (DEC-437, DEC-431).
 */

export const BETTER_AUTH_VERIFIED_VERSION = '1.7.4';

const TIMESTAMPTZ = 'timestamp with time zone';

/** Every column of the Better Auth tables terminal recovery reads or changes. */
export const VERIFIED_BETTER_AUTH_SCHEMA: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  user: {
    id: 'text',
    name: 'text',
    email: 'text',
    emailVerified: 'boolean',
    image: 'text',
    createdAt: TIMESTAMPTZ,
    updatedAt: TIMESTAMPTZ,
    twoFactorEnabled: 'boolean',
  },
  session: {
    id: 'text',
    expiresAt: TIMESTAMPTZ,
    token: 'text',
    createdAt: TIMESTAMPTZ,
    updatedAt: TIMESTAMPTZ,
    ipAddress: 'text',
    userAgent: 'text',
    userId: 'text',
  },
  twoFactor: {
    id: 'text',
    secret: 'text',
    backupCodes: 'text',
    userId: 'text',
    verified: 'boolean',
    failedVerificationCount: 'integer',
    lockedUntil: TIMESTAMPTZ,
  },
};

export type BetterAuthCompatibility = 'compatible' | 'version_mismatch' | 'schema_mismatch';

/** The version the installed two-factor plugin reports about itself. */
export function installedBetterAuthVersion(): string {
  return createTwoFactorPlugin().version;
}

/** Refuses any version or column set other than the verified ones. */
export async function checkBetterAuthCompatibility(client: PoolClient, version: string): Promise<BetterAuthCompatibility> {
  if (version !== BETTER_AUTH_VERIFIED_VERSION) return 'version_mismatch';

  const tables = Object.keys(VERIFIED_BETTER_AUTH_SCHEMA);
  const { rows } = await client.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [tables],
  );

  for (const table of tables) {
    const expected = VERIFIED_BETTER_AUTH_SCHEMA[table]!;
    const actual = rows.filter((row) => row.table_name === table);
    if (actual.length !== Object.keys(expected).length) return 'schema_mismatch';
    if (actual.some((column) => expected[column.column_name] !== column.data_type)) return 'schema_mismatch';
  }
  return 'compatible';
}

export interface FactorSnapshot {
  enabled: boolean;
  factorRows: number;
  /** A digest of the flag and every factor row's stored codes, never the codes. */
  fingerprint: string;
}

const READ_FLAG = `SELECT "twoFactorEnabled" AS enabled FROM "user" WHERE id = $1`;
const LOCK_FLAG = `SELECT "twoFactorEnabled" AS enabled FROM "user" WHERE id = $1 FOR UPDATE`;
const READ_FACTORS = `SELECT id, "backupCodes" AS codes FROM "twoFactor" WHERE "userId" = $1 ORDER BY id`;
const LOCK_FACTORS = `SELECT id, "backupCodes" AS codes FROM "twoFactor" WHERE "userId" = $1 ORDER BY id FOR UPDATE`;

// W1 and W2, and nothing else, ever.
const W1 = `UPDATE "user" SET "twoFactorEnabled" = FALSE, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1 AND "twoFactorEnabled" = TRUE`;
const W2 = `DELETE FROM "twoFactor" WHERE "userId" = $1`;

function fingerprintOf(enabled: boolean | null | undefined, factors: ReadonlyArray<{ id: string; codes: string }>): string {
  return createHash('sha256')
    .update(JSON.stringify([enabled ?? null, factors.map((factor) => [factor.id, factor.codes])]))
    .digest('hex');
}

/** Read-only: the factor state the reset decision is based on. */
export async function readFactorSnapshot(client: PoolClient, userId: string): Promise<FactorSnapshot> {
  const { rows: flags } = await client.query<{ enabled: boolean | null }>(READ_FLAG, [userId]);
  const { rows: factors } = await client.query<{ id: string; codes: string }>(READ_FACTORS, [userId]);
  return {
    enabled: flags[0]?.enabled === true,
    factorRows: factors.length,
    fingerprint: fingerprintOf(flags[0]?.enabled, factors),
  };
}

export class FactorResetRefused extends Error {
  constructor(readonly reason: 'not_eligible' | 'factor_changed') {
    super('The Owner factor reset was refused. Nothing was changed.');
    this.name = 'FactorResetRefused';
  }
}

export interface FactorResetOutcome {
  /** How many factor rows W2 removed: 1, or 0 when the flag had no row. */
  removedFactorRows: number;
}

/**
 * Runs the DEC-437 reset as one transaction on `client`: locks the single
 * Owner principal, the Owner's user row, and any factor row; re-checks the
 * target and the classified factor state; clears DROMEX MFA completion; runs
 * W1 and W2 with exact row counts; then lets `record` write the DROMEX run
 * state and audit rows inside the same transaction before committing. Any
 * refusal or error rolls every part back.
 */
export async function resetOwnerFactor(
  client: PoolClient,
  input: { userId: string; fingerprint: string; record: (outcome: FactorResetOutcome) => Promise<void> },
): Promise<FactorResetOutcome> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`SET LOCAL statement_timeout = '15s'`);

    const { rows: owners } = await client.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM dromex_principal WHERE is_owner LIMIT 2 FOR UPDATE`,
    );
    if (owners.length !== 1 || owners[0]!.user_id !== input.userId || owners[0]!.status !== 'active') {
      throw new FactorResetRefused('not_eligible');
    }

    const { rows: flags } = await client.query<{ enabled: boolean | null }>(LOCK_FLAG, [input.userId]);
    const { rows: factors } = await client.query<{ id: string; codes: string }>(LOCK_FACTORS, [input.userId]);
    if (
      flags.length !== 1 ||
      flags[0]!.enabled !== true ||
      factors.length > 1 ||
      fingerprintOf(flags[0]!.enabled, factors) !== input.fingerprint
    ) {
      throw new FactorResetRefused('factor_changed');
    }

    await client.query(
      `UPDATE dromex_principal SET mfa_completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [input.userId],
    );

    const flagged = await client.query(W1, [input.userId]);
    if (flagged.rowCount !== 1) throw new FactorResetRefused('factor_changed');
    const removed = await client.query(W2, [input.userId]);
    if (removed.rowCount !== factors.length) throw new FactorResetRefused('factor_changed');

    const outcome: FactorResetOutcome = { removedFactorRows: factors.length };
    await input.record(outcome);
    await client.query('COMMIT');
    return outcome;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
