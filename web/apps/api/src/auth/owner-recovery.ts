import type { Pool, PoolClient } from 'pg';

import { securityEvent, type SecurityAudit } from './security-audit.ts';

/**
 * DROMEX's record of an Owner recovery in progress (DEC-436).
 *
 * Better Auth owns the factor, the recovery codes, and the sessions; this
 * module owns only what Better Auth does not model: which Better Auth session
 * is a recovery session, which replacement step it has reached, and when it
 * expires. It writes no Better Auth-owned row (DEC-431). It only reads
 * `"session"` (to count sessions) and `"user"` (to confirm whether the factor
 * is still enabled and to snapshot a name for the audit trail).
 *
 * Every state change and its audit events commit in one transaction, and
 * every step is a conditional update on the database's own clock, so an
 * expired, out-of-order, or concurrently claimed step changes nothing.
 */

/** Recovery lifetime. The database refuses anything longer than five minutes. */
export const RECOVERY_LIFETIME_SECONDS = 300;

/** Attempts at a code from the new authenticator before the recovery fails closed. */
export const RECOVERY_MAX_VERIFY_ATTEMPTS = 5;

export type OpenRecoveryStep = 'code_accepted' | 'replacement_started' | 'enrolment_started';
export type EndedRecoveryStep = 'failed' | 'expired' | 'abandoned';

export interface RecoveryActor {
  userId: string;
  name: string;
}

export interface ActiveRecovery {
  id: string;
  userId: string;
  sessionId: string;
  step: OpenRecoveryStep;
  factorDisabled: boolean;
  verifyAttempts: number;
}

export type BeginOutcome = { recoveryId: string } | { refused: 'not_eligible' | 'recovery_in_progress' };

export interface OwnerRecovery {
  /** True when this Better Auth session was ever bound to a recovery. Throws on any failure. */
  isRecoverySession(sessionId: string): Promise<boolean>;
  /**
   * Starts a recovery for an active Owner, in one transaction: ends any
   * expired recovery, clears `mfa_completed_at`, records the recovery bound to
   * `sessionId`, records the session as a recovery session, and audits it.
   */
  begin(input: { actor: RecoveryActor; sessionId: string; clientAddress: string }): Promise<BeginOutcome>;
  /** The open recovery bound to this session; `expired` after ending an expired one; otherwise null. */
  loadForSession(sessionId: string, actor: RecoveryActor, clientAddress: string): Promise<ActiveRecovery | 'expired' | null>;
  /** Atomically moves `code_accepted` to `replacement_started` while unexpired. False if anything disagrees. */
  claimReplacement(recovery: ActiveRecovery, actor: RecoveryActor, clientAddress: string): Promise<boolean>;
  /** Records the disabled old factor and the rotated session Better Auth bound to the new enrolment. */
  recordEnrolmentStarted(recovery: ActiveRecovery, sessionId: string, actor: RecoveryActor, clientAddress: string): Promise<void>;
  /** Reserves one verification attempt while unexpired and below the limit; the new count, or null. */
  reserveVerifyAttempt(recovery: ActiveRecovery): Promise<number | null>;
  /** Sets `mfa_completed_at`, ends the recovery as completed, and records the final session, in one transaction. */
  complete(recovery: ActiveRecovery, sessionId: string, actor: RecoveryActor, clientAddress: string): Promise<void>;
  /** Ends an open recovery, auditing it, and auditing that terminal recovery is required once the factor is disabled. */
  end(
    recovery: ActiveRecovery,
    step: EndedRecoveryStep,
    reason: string,
    actor: RecoveryActor,
    clientAddress: string,
    options?: { factorDisabled?: boolean },
  ): Promise<void>;
  /** Ends the open recovery bound to a session that signed out, if any. */
  abandonForSession(sessionId: string, clientAddress: string): Promise<void>;
  /** Unexpired sessions for a user, optionally excluding one. */
  countSessions(userId: string, exceptSessionId?: string): Promise<number>;
  /** True unless Better Auth still reports the factor enabled. */
  factorIsAbsent(userId: string): Promise<boolean>;
}

interface RecoveryRow {
  id: string;
  user_id: string;
  session_id: string;
  step: OpenRecoveryStep;
  factor_disabled: boolean;
  verify_attempts: number;
  expired: boolean;
}

class RecoveryRefusal extends Error {
  constructor(readonly reason: 'not_eligible' | 'recovery_in_progress') {
    super('Owner recovery refused.');
    this.name = 'RecoveryRefusal';
  }
}

const UNIQUE_VIOLATION = '23505';

function toActive(row: RecoveryRow): ActiveRecovery {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    step: row.step,
    factorDisabled: row.factor_disabled,
    verifyAttempts: row.verify_attempts,
  };
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    // A connection whose rollback failed is destroyed rather than reused.
    client.release(broken);
  }
}

const ENDED_EVENT = {
  failed: 'replacement_failed',
  expired: 'recovery_expired',
  abandoned: 'recovery_abandoned',
} as const;

export function createOwnerRecovery(pool: Pool, audit: SecurityAudit): OwnerRecovery {
  async function endWith(
    client: PoolClient,
    recoveryId: string,
    step: EndedRecoveryStep,
    reason: string,
    actor: RecoveryActor | null,
    clientAddress: string,
    factorDisabled: boolean,
  ): Promise<void> {
    const { rows } = await client.query<{ factor_disabled: boolean }>(
      `UPDATE dromex_owner_recovery
          SET step = $2, ended_at = CURRENT_TIMESTAMP, factor_disabled = factor_disabled OR $3::boolean
        WHERE id = $1 AND ended_at IS NULL
        RETURNING factor_disabled`,
      [recoveryId, step, factorDisabled],
    );
    if (rows.length === 0) return;

    await audit.record(securityEvent(ENDED_EVENT[step], 'failure', actor, recoveryId, clientAddress, { reason }), client);
    if (rows[0]!.factor_disabled) {
      await audit.record(
        securityEvent('terminal_recovery_required', 'failure', actor, recoveryId, clientAddress, { reason: 'factor_disabled' }),
        client,
      );
    }
  }

  return {
    async isRecoverySession(sessionId) {
      // A session a terminal recovery run obtained (DEC-437) is refused
      // exactly like a web recovery session.
      const { rows } = await pool.query<{ bound: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM dromex_recovery_session WHERE session_id = $1)
             OR EXISTS (SELECT 1 FROM dromex_terminal_recovery_session WHERE session_id = $1) AS bound`,
        [sessionId],
      );
      return rows[0]?.bound === true;
    },

    async begin({ actor, sessionId, clientAddress }) {
      try {
        return await inTransaction(pool, async (client) => {
          // Serialises concurrent recoveries for this user.
          const { rows: principals } = await client.query<{ status: string; is_owner: boolean }>(
            `SELECT status, is_owner FROM dromex_principal WHERE user_id = $1 FOR UPDATE`,
            [actor.userId],
          );
          const principal = principals[0];
          if (principal === undefined || principal.status !== 'active' || principal.is_owner !== true) {
            throw new RecoveryRefusal('not_eligible');
          }

          // A terminal recovery in progress excludes web recovery (DEC-437).
          // The terminal run locks the same principal row when it begins.
          const { rows: terminal } = await client.query(
            `SELECT 1 FROM dromex_terminal_recovery WHERE user_id = $1 AND ended_at IS NULL`,
            [actor.userId],
          );
          if (terminal.length > 0) throw new RecoveryRefusal('recovery_in_progress');

          const { rows: stale } = await client.query<{ id: string }>(
            `SELECT id::text AS id FROM dromex_owner_recovery
              WHERE user_id = $1 AND ended_at IS NULL AND expires_at <= CURRENT_TIMESTAMP`,
            [actor.userId],
          );
          for (const row of stale) {
            await endWith(client, row.id, 'expired', 'expired', actor, clientAddress, false);
          }

          // Ordinary access ends for every Owner session before any recovery
          // session exists outside this transaction (DEC-436).
          await client.query(
            `UPDATE dromex_principal SET mfa_completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
            [actor.userId],
          );

          let recoveryId: string;
          try {
            const { rows } = await client.query<{ id: string }>(
              `INSERT INTO dromex_owner_recovery (user_id, session_id, step, expires_at)
               VALUES ($1, $2, 'code_accepted', CURRENT_TIMESTAMP + make_interval(secs => $3))
               RETURNING id::text AS id`,
              [actor.userId, sessionId, RECOVERY_LIFETIME_SECONDS],
            );
            recoveryId = rows[0]!.id;
          } catch (error) {
            if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) throw new RecoveryRefusal('recovery_in_progress');
            throw error;
          }

          await client.query(`INSERT INTO dromex_recovery_session (session_id, recovery_id) VALUES ($1, $2)`, [
            sessionId,
            recoveryId,
          ]);
          await audit.record(securityEvent('recovery_code_accepted', 'success', actor, recoveryId, clientAddress), client);
          await audit.record(securityEvent('recovery_session_created', 'success', actor, recoveryId, clientAddress), client);
          return { recoveryId };
        });
      } catch (error) {
        if (error instanceof RecoveryRefusal) return { refused: error.reason };
        throw error;
      }
    },

    async loadForSession(sessionId, actor, clientAddress) {
      const { rows } = await pool.query<RecoveryRow>(
        `SELECT id::text AS id, user_id, session_id, step, factor_disabled, verify_attempts,
                expires_at <= CURRENT_TIMESTAMP AS expired
           FROM dromex_owner_recovery
          WHERE session_id = $1 AND ended_at IS NULL`,
        [sessionId],
      );
      const row = rows[0];
      if (row === undefined) return null;
      if (row.expired) {
        await inTransaction(pool, (client) => endWith(client, row.id, 'expired', 'expired', actor, clientAddress, false));
        return 'expired';
      }
      return toActive(row);
    },

    async claimReplacement(recovery, actor, clientAddress) {
      return inTransaction(pool, async (client) => {
        const { rowCount } = await client.query(
          `UPDATE dromex_owner_recovery SET step = 'replacement_started'
            WHERE id = $1 AND session_id = $2 AND step = 'code_accepted'
              AND ended_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
          [recovery.id, recovery.sessionId],
        );
        if (rowCount !== 1) return false;
        await audit.record(securityEvent('replacement_started', 'success', actor, recovery.id, clientAddress), client);
        return true;
      });
    },

    async recordEnrolmentStarted(recovery, sessionId, actor, clientAddress) {
      await inTransaction(pool, async (client) => {
        const { rowCount } = await client.query(
          `UPDATE dromex_owner_recovery
              SET step = 'enrolment_started', factor_disabled = TRUE, session_id = $2
            WHERE id = $1 AND step = 'replacement_started' AND ended_at IS NULL`,
          [recovery.id, sessionId],
        );
        if (rowCount !== 1) throw new Error('The recovery was not awaiting enrolment.');
        await client.query(`INSERT INTO dromex_recovery_session (session_id, recovery_id) VALUES ($1, $2)`, [
          sessionId,
          recovery.id,
        ]);
        await audit.record(securityEvent('old_factor_disabled', 'success', actor, recovery.id, clientAddress), client);
      });
    },

    async reserveVerifyAttempt(recovery) {
      const { rows } = await pool.query<{ verify_attempts: number }>(
        `UPDATE dromex_owner_recovery SET verify_attempts = verify_attempts + 1
          WHERE id = $1 AND session_id = $2 AND step = 'enrolment_started' AND ended_at IS NULL
            AND expires_at > CURRENT_TIMESTAMP AND verify_attempts < $3
          RETURNING verify_attempts`,
        [recovery.id, recovery.sessionId, RECOVERY_MAX_VERIFY_ATTEMPTS],
      );
      return rows[0]?.verify_attempts ?? null;
    },

    async complete(recovery, sessionId, actor, clientAddress) {
      await inTransaction(pool, async (client) => {
        const principal = await client.query(
          `UPDATE dromex_principal SET mfa_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1 AND status = 'active' AND is_owner AND mfa_completed_at IS NULL`,
          [actor.userId],
        );
        if (principal.rowCount !== 1) throw new Error('The Owner principal could not be completed.');

        const ended = await client.query(
          `UPDATE dromex_owner_recovery SET step = 'completed', ended_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND step = 'enrolment_started' AND ended_at IS NULL`,
          [recovery.id],
        );
        if (ended.rowCount !== 1) throw new Error('The recovery was not awaiting verification.');

        await client.query(
          `INSERT INTO dromex_recovery_session (session_id, recovery_id) VALUES ($1, $2) ON CONFLICT (session_id) DO NOTHING`,
          [sessionId, recovery.id],
        );
        await audit.record(securityEvent('new_totp_verified', 'success', actor, recovery.id, clientAddress), client);
        await audit.record(securityEvent('replacement_completed', 'success', actor, recovery.id, clientAddress), client);
      });
    },

    async end(recovery, step, reason, actor, clientAddress, options = {}) {
      await inTransaction(pool, (client) =>
        endWith(client, recovery.id, step, reason, actor, clientAddress, options.factorDisabled === true),
      );
    },

    async abandonForSession(sessionId, clientAddress) {
      const { rows } = await pool.query<{ id: string; user_id: string; user_name: string; expired: boolean }>(
        `SELECT r.id::text AS id, r.user_id, u.name AS user_name, r.expires_at <= CURRENT_TIMESTAMP AS expired
           FROM dromex_owner_recovery r JOIN "user" u ON u.id = r.user_id
          WHERE r.session_id = $1 AND r.ended_at IS NULL`,
        [sessionId],
      );
      const row = rows[0];
      if (row === undefined) return;
      const actor = { userId: row.user_id, name: row.user_name };
      await inTransaction(pool, (client) =>
        row.expired
          ? endWith(client, row.id, 'expired', 'expired', actor, clientAddress, false)
          : endWith(client, row.id, 'abandoned', 'signed_out', actor, clientAddress, false),
      );
    },

    async countSessions(userId, exceptSessionId) {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "session"
          WHERE "userId" = $1 AND "expiresAt" > CURRENT_TIMESTAMP AND ($2::text IS NULL OR id <> $2::text)`,
        [userId, exceptSessionId ?? null],
      );
      return rows[0]?.n ?? 0;
    },

    async factorIsAbsent(userId) {
      const { rows } = await pool.query<{ enabled: boolean | null }>(
        `SELECT "twoFactorEnabled" AS enabled FROM "user" WHERE id = $1`,
        [userId],
      );
      return rows[0]?.enabled !== true;
    },
  };
}
