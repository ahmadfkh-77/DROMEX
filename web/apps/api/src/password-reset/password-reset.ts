import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { AuthSettings } from '../auth/config.ts';
import { checkNewPassword, type PasswordPolicyReason } from '../auth/password-policy.ts';
import { RATE_LIMIT_PRUNE_INTERVAL_MS, createRateLimitStorage, type RateLimitRule } from '../auth/rate-limit-storage.ts';
import { securityEvent, type SecurityAudit, type SecurityAuditActor, type SecurityAuditEventType } from '../auth/security-audit.ts';
import { isValidEmailAddress, type EmailSender } from '../email/message.ts';
import type { EmailSendResult, EmailTransport } from '../email/result.ts';
import { renderPasswordChangedEmail, renderPasswordResetEmail } from './reset-email.ts';
import { createResetIdentity, type ResetIdentityPort } from './reset-identity.ts';
import { createResetQueue, type ResetQueue } from './reset-queue.ts';
import { generateResetToken, hashResetToken, isWellFormedResetToken } from './reset-token.ts';

/**
 * Password reset (DEC-441, DEC-442, DEC-487, DEC-488).
 *
 * **Request.** {@link PasswordResetService.request} checks only the request
 * shape and the per-network-source limit, hands the address to a bounded
 * background job, and returns. The job alone looks the address up, decides
 * eligibility, applies the per-account and global limits, supersedes any
 * older reset, stores the hash of a new 256-bit token, and hands one email to
 * the transport. The caller's response therefore cannot depend on whether the
 * address is known, disabled, pending, limited, or dropped (DEC-487 (5)).
 *
 * **Eligibility.** An account whose Better Auth identity has a credential
 * account and a DROMEX principal that is `active` or `pending` (DEC-487 (4)).
 * A reset of a pending principal changes only its password: the principal
 * stays pending and its invitation is untouched. Disabled accounts and
 * identities without a principal are refused, and unknown addresses leave no
 * trace at all.
 *
 * **Completion.** Under a per-account lock, one transaction claims the token
 * (single use: `issued` to `claimed` under a row lock), re-checks
 * eligibility, and stamps `credentials_changed_at`, so every existing session
 * fails every gate from that moment. The internal Better Auth capability then
 * writes the password and deletes the account's sessions. A second
 * transaction stamps the credential change again (closing the gap between the
 * claim and the write), completes the reset, and audits how many sessions
 * were removed and whether any remain. Nothing signs the user in, and MFA is
 * never touched (DEC-441 (7), (8)). A password-changed email is then queued.
 *
 * **Failure.** Any error after the claim ends the reset as `failed` and is
 * audited; sessions stay ended. A claim abandoned by a crash is swept to
 * `failed` after the claim window. The token is never stored, logged,
 * audited, or returned; the audit carries only a reset reference, the
 * account's id and name snapshot, a reason code, and the client address.
 */

export const RESET_INTERRUPTIONS = ['after_claimed', 'after_password_written'] as const;
export type ResetInterruption = (typeof RESET_INTERRUPTIONS)[number];

/** Implementation detail under DEC-441 (9); PostgreSQL-backed where keyed by source. */
export const PASSWORD_RESET_LIMITS = {
  requestPerSource: { window: 900, max: 5 },
  inspectPerSource: { window: 60, max: 10 },
  completePerSource: { window: 60, max: 10 },
  /** Completion attempts per reset (password rejections do not use up the link). */
  completePerReset: { window: 900, max: 5 },
  /** At most one suppression audit per account per window, so refused requests cannot grow the audit. */
  suppressionAuditPerAccount: { window: 60, max: 1 },
} as const satisfies Record<string, RateLimitRule>;

export const PASSWORD_RESET_POLICY = {
  cooldownSeconds: 60,
  maxPerHour: 3,
  maxPerDay: 6,
  globalPerHour: 30,
  queueCapacity: 50,
  claimWindowSeconds: 120,
  sweepBatch: 100,
  maxEmailLength: 320,
} as const;

export interface PasswordResetDelivery {
  transport: EmailTransport;
  from: EmailSender;
  replyTo?: string;
  linkOrigin: string;
}

export type ResetRequestResult = { ok: true } | { ok: false; error: 'rate_limited'; retryAfterSeconds: number };

export type ResetRefusal =
  | { ok: false; error: 'reset_link_invalid' }
  | { ok: false; error: 'password_rejected'; reason: PasswordPolicyReason }
  | { ok: false; error: 'reset_failed' }
  | { ok: false; error: 'rate_limited'; retryAfterSeconds: number };

export type ResetInspectResult = { ok: true } | ResetRefusal;
export type ResetCompleteResult = { ok: true } | ResetRefusal;

export interface PasswordResetService {
  request(input: { email: unknown }, clientAddress: string): Promise<ResetRequestResult>;
  inspect(input: { token: unknown }, clientAddress: string): Promise<ResetInspectResult>;
  complete(input: { token: unknown; newPassword: unknown }, clientAddress: string): Promise<ResetCompleteResult>;
  /** Waits for every queued job. For tests and shutdown. */
  drain(): Promise<void>;
  /** Stops accepting jobs and waits for the queued ones. */
  close(): Promise<void>;
}

export interface PasswordResetDependencies {
  pool: Pool;
  audit: SecurityAudit;
  /** The runtime authentication settings; the internal identity is built from exactly these. */
  settings: AuthSettings;
  /** How emails leave the server. `null` means email is not configured: nothing is sent. */
  delivery: PasswordResetDelivery | null;
  /** Test seam: replaces the internal password-write identity. */
  identity?: ResetIdentityPort;
  /** Test seam: controls when queued jobs run. */
  schedule?: (run: () => void) => void;
  /** Test seam: called after each major transition. Production passes nothing. */
  interrupt?: (point: ResetInterruption) => void | Promise<void>;
  /** Receives a failed job's error name only. */
  onJobError?: (errorName: string) => void;
}

type ResetStatus = 'issued' | 'claimed' | 'completed' | 'superseded' | 'expired' | 'failed';

interface ResetRow {
  id: string;
  user_id: string;
  status: ResetStatus;
  delivery_id: string;
  due: boolean;
}

interface Account {
  userId: string;
  email: string;
  name: string;
  status: 'pending' | 'active' | 'disabled' | null;
  hasCredential: boolean;
}

const INVALID = { ok: false, error: 'reset_link_invalid' } as const;
const FAILED = { ok: false, error: 'reset_failed' } as const;

const ROW_COLUMNS = `id::text, user_id, status, delivery_id::text, expires_at <= CURRENT_TIMESTAMP AS due`;

/** Trimmed and lower-cased, exactly as Better Auth stores addresses; `null` for anything else. */
function normalizeResetEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > PASSWORD_RESET_POLICY.maxEmailLength) return null;
  const normalized = value.trim().toLowerCase();
  return isValidEmailAddress(normalized) ? normalized : null;
}

function limited(retryAfterSeconds: number): { ok: false; error: 'rate_limited'; retryAfterSeconds: number } {
  return { ok: false, error: 'rate_limited', retryAfterSeconds: Math.max(1, retryAfterSeconds) };
}

function deliveryOutcome(result: EmailSendResult | 'not_configured' | 'crashed'): {
  status: 'provider_accepted' | 'failed' | 'not_sent';
  reason: string | null;
  attempts: number;
} {
  if (result === 'not_configured') return { status: 'not_sent', reason: 'email_disabled', attempts: 0 };
  if (result === 'crashed') return { status: 'failed', reason: 'unexpected_failure', attempts: 0 };
  switch (result.status) {
    case 'accepted':
      return { status: 'provider_accepted', reason: null, attempts: Math.min(3, Math.max(0, result.attempts)) };
    case 'disabled':
      return { status: 'not_sent', reason: 'email_disabled', attempts: 0 };
    default:
      return { status: 'failed', reason: result.reason, attempts: Math.min(3, Math.max(0, result.attempts)) };
  }
}

export function createPasswordResetService(deps: PasswordResetDependencies): PasswordResetService {
  const { pool, audit, delivery } = deps;
  if (typeof audit?.record !== 'function') throw new Error('Password reset requires the security audit.');
  const identity = deps.identity ?? createResetIdentity(deps.settings, pool);
  const limits = createRateLimitStorage(pool, Date.now, { pruneIntervalMs: RATE_LIMIT_PRUNE_INTERVAL_MS });
  const queue: ResetQueue = createResetQueue({
    capacity: PASSWORD_RESET_POLICY.queueCapacity,
    ...(deps.schedule === undefined ? {} : { schedule: deps.schedule }),
    ...(deps.onJobError === undefined ? {} : { onError: deps.onJobError }),
  });
  const interrupt = async (point: ResetInterruption) => {
    if (deps.interrupt !== undefined) await deps.interrupt(point);
  };

  async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
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
      client.release(broken);
    }
  }

  async function record(
    db: PoolClient | null,
    type: SecurityAuditEventType,
    outcome: 'success' | 'failure',
    actor: SecurityAuditActor | null,
    clientAddress: string | null,
    passwordResetId: string | null,
    extra: { reason?: string; revokedSessionCount?: number } = {},
  ): Promise<void> {
    const event = securityEvent(type, outcome, actor, null, clientAddress, { passwordResetId, ...extra });
    if (db === null) await audit.record(event);
    else await audit.record(event, db);
  }

  /** Serialises issuance and completion for one account inside a transaction. */
  async function lockAccount(client: PoolClient, userId: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('dromex_password_reset:' || $1, 0))`, [userId]);
  }

  /**
   * Holds the account lock across the whole completion, including the Better
   * Auth write, on a dedicated connection. `null` when another completion or
   * issuance for the account holds it.
   */
  async function holdAccount(userId: string): Promise<(() => Promise<void>) | null> {
    const client = await pool.connect();
    let locked = false;
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended('dromex_password_reset:' || $1, 0)) AS locked`,
        [userId],
      );
      locked = rows[0]?.locked === true;
    } finally {
      if (!locked) client.release();
    }
    if (!locked) return null;
    return async () => {
      let discard = false;
      await client
        .query(`SELECT pg_advisory_unlock(hashtextextended('dromex_password_reset:' || $1, 0))`, [userId])
        .catch(() => {
          discard = true;
        });
      // A connection whose unlock failed is destroyed, which releases the lock.
      client.release(discard);
    };
  }

  /** Ends due issued resets and abandoned claims, each audited once. Bounded; skips rows another transaction holds. */
  async function sweep(client: PoolClient, clientAddress: string | null): Promise<void> {
    const expired = await client.query<{ id: string }>(
      `UPDATE dromex_password_reset SET status = 'expired', ended_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT id FROM dromex_password_reset
                      WHERE status = 'issued' AND expires_at <= CURRENT_TIMESTAMP
                      ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id::text`,
      [PASSWORD_RESET_POLICY.sweepBatch],
    );
    for (const row of expired.rows) await record(client, 'password_reset_expired', 'success', null, clientAddress, row.id);

    const abandoned = await client.query<{ id: string }>(
      `UPDATE dromex_password_reset SET status = 'failed', ended_at = CURRENT_TIMESTAMP, end_reason = 'claim_abandoned'
        WHERE id IN (SELECT id FROM dromex_password_reset
                      WHERE status = 'claimed' AND claimed_at <= CURRENT_TIMESTAMP - make_interval(secs => $2)
                      ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id::text`,
      [PASSWORD_RESET_POLICY.sweepBatch, PASSWORD_RESET_POLICY.claimWindowSeconds],
    );
    for (const row of abandoned.rows) {
      await record(client, 'password_reset_failed', 'failure', null, clientAddress, row.id, { reason: 'claim_abandoned' });
    }
  }

  async function findAccount(db: Pool | PoolClient, where: 'email' | 'id', value: string, lock = false): Promise<Account | null> {
    const { rows } = await db.query<{ id: string; email: string; name: string; status: Account['status']; has_credential: boolean }>(
      `SELECT u.id, u.email, u.name, p.status,
              EXISTS (SELECT 1 FROM account a WHERE a."userId" = u.id AND a."providerId" = 'credential') AS has_credential
         FROM "user" u
         LEFT JOIN dromex_principal p ON p.user_id = u.id
        WHERE ${where === 'email' ? 'lower(u.email) = $1' : 'u.id = $1'}
        LIMIT 1
        ${lock ? 'FOR SHARE OF u' : ''}`,
      [value],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : { userId: row.id, email: row.email, name: row.name, status: row.status, hasCredential: row.has_credential === true };
  }

  /** DEC-441 (1), DEC-487 (4). */
  function ineligibility(account: Account): string | null {
    if (account.status === 'disabled') return 'account_disabled';
    if (account.status !== 'active' && account.status !== 'pending') return 'not_eligible';
    if (!account.hasCredential) return 'not_eligible';
    return null;
  }

  async function suppress(client: PoolClient, account: Account, reason: string, clientAddress: string): Promise<void> {
    const decision = await limits.consume(`pw-reset-suppressed|${account.userId}`, PASSWORD_RESET_LIMITS.suppressionAuditPerAccount);
    if (!decision.allowed) return;
    await record(client, 'password_reset_request_suppressed', 'failure', { userId: account.userId, name: account.name }, clientAddress, null, {
      reason,
    });
  }

  /** Why issuance for this account must wait, or null. Counted from the rows in database time. */
  async function issuanceLimit(client: PoolClient, userId: string): Promise<string | null> {
    const { rows } = await client.query<{ recent: boolean; hour: number; day: number; global: number }>(
      `SELECT
         bool_or(created_at > CURRENT_TIMESTAMP - make_interval(secs => $2)) FILTER (WHERE user_id = $1) AS recent,
         count(*) FILTER (WHERE user_id = $1 AND created_at > CURRENT_TIMESTAMP - interval '1 hour')::int AS hour,
         count(*) FILTER (WHERE user_id = $1)::int AS day,
         count(*) FILTER (WHERE created_at > CURRENT_TIMESTAMP - interval '1 hour')::int AS global
         FROM dromex_password_reset
        WHERE created_at > CURRENT_TIMESTAMP - interval '24 hours'`,
      [userId, PASSWORD_RESET_POLICY.cooldownSeconds],
    );
    const row = rows[0]!;
    if (row.recent === true || row.hour >= PASSWORD_RESET_POLICY.maxPerHour || row.day >= PASSWORD_RESET_POLICY.maxPerDay) {
      return 'rate_limited';
    }
    if (row.global >= PASSWORD_RESET_POLICY.globalPerHour) return 'global_limit';
    return null;
  }

  /** Hands one email to the transport after the issuing transaction, then records the truthful outcome. */
  async function deliverReset(account: Account, row: ResetRow, token: string, clientAddress: string): Promise<void> {
    let result: EmailSendResult | 'not_configured' | 'crashed';
    if (delivery === null) {
      result = 'not_configured';
    } else {
      try {
        const message = renderPasswordResetEmail({
          to: account.email,
          token,
          deliveryId: row.delivery_id,
          linkOrigin: delivery.linkOrigin,
          from: delivery.from,
          ...(delivery.replyTo === undefined ? {} : { replyTo: delivery.replyTo }),
        });
        result = await delivery.transport.send(message);
      } catch {
        result = 'crashed';
      }
    }

    const outcome = deliveryOutcome(result);
    await transaction(async (client) => {
      await client.query(
        `UPDATE dromex_password_reset
            SET delivery_status = $2, delivery_reason = $3, delivery_attempts = $4, delivery_updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND delivery_status = 'sending'`,
        [row.id, outcome.status, outcome.reason, outcome.attempts],
      );
      const accepted = outcome.status === 'provider_accepted';
      await record(
        client,
        accepted ? 'password_reset_delivery_accepted' : 'password_reset_delivery_failed',
        accepted ? 'success' : 'failure',
        { userId: account.userId, name: account.name },
        clientAddress,
        row.id,
        accepted ? {} : { reason: outcome.reason ?? 'unexpected_failure' },
      );
    });
  }

  /** The background half of a request. Unknown addresses end here without a trace. */
  async function issue(email: string, clientAddress: string): Promise<void> {
    const found = await findAccount(pool, 'email', email);
    if (found === null) return;

    const { token, hash } = generateResetToken();
    const issued = await transaction(async (client) => {
      await lockAccount(client, found.userId);
      await sweep(client, clientAddress);
      const account = await findAccount(client, 'id', found.userId, true);
      if (account === null) return null;

      const refusal = ineligibility(account);
      if (refusal !== null) {
        await suppress(client, account, refusal, clientAddress);
        return null;
      }

      const open = await client.query<ResetRow>(
        `SELECT ${ROW_COLUMNS} FROM dromex_password_reset WHERE user_id = $1 AND status IN ('issued', 'claimed') FOR UPDATE`,
        [account.userId],
      );
      const current = open.rows[0];
      if (current?.status === 'claimed') {
        await suppress(client, account, 'reset_in_progress', clientAddress);
        return null;
      }

      const limit = await issuanceLimit(client, account.userId);
      if (limit !== null) {
        await suppress(client, account, limit, clientAddress);
        return null;
      }

      const actor = { userId: account.userId, name: account.name };
      if (current !== undefined) {
        await client.query(
          `UPDATE dromex_password_reset SET status = 'superseded', ended_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'issued'`,
          [current.id],
        );
        await record(client, 'password_reset_superseded', 'success', actor, clientAddress, current.id);
      }

      const inserted = await client.query<ResetRow>(
        `INSERT INTO dromex_password_reset (user_id, token_hash, status, supersedes_id, expires_at, delivery_id, delivery_status)
         VALUES ($1, $2, 'issued', $3, CURRENT_TIMESTAMP + interval '30 minutes', $4, 'sending')
         RETURNING ${ROW_COLUMNS}`,
        [account.userId, hash, current?.id ?? null, randomUUID()],
      );
      const row = inserted.rows[0]!;
      await record(client, 'password_reset_requested', 'success', actor, clientAddress, row.id);
      return { account, row };
    });

    if (issued !== null) await deliverReset(issued.account, issued.row, token, clientAddress);
  }

  /** Sends the password-changed notification and audits its outcome. */
  async function notifyChanged(account: Account, resetId: string, changedAt: Date, clientAddress: string): Promise<void> {
    let result: EmailSendResult | 'not_configured' | 'crashed';
    if (delivery === null) {
      result = 'not_configured';
    } else {
      try {
        result = await delivery.transport.send(
          renderPasswordChangedEmail({
            to: account.email,
            deliveryId: randomUUID(),
            changedAt,
            linkOrigin: delivery.linkOrigin,
            from: delivery.from,
            ...(delivery.replyTo === undefined ? {} : { replyTo: delivery.replyTo }),
          }),
        );
      } catch {
        result = 'crashed';
      }
    }
    const outcome = deliveryOutcome(result);
    const accepted = outcome.status === 'provider_accepted';
    await record(
      null,
      accepted ? 'password_changed_notification_accepted' : 'password_changed_notification_failed',
      accepted ? 'success' : 'failure',
      { userId: account.userId, name: account.name },
      clientAddress,
      resetId,
      accepted ? {} : { reason: outcome.reason ?? 'unexpected_failure' },
    );
  }

  async function consume(key: string, rule: RateLimitRule) {
    const decision = await limits.consume(key, rule);
    return decision.allowed ? null : limited(decision.retryAfter ?? rule.window);
  }

  /** The reset a well-formed token names, without locking or changing it; `null` when unknown. */
  async function lookup(token: string): Promise<ResetRow | null> {
    const { rows } = await pool.query<ResetRow>(`SELECT ${ROW_COLUMNS} FROM dromex_password_reset WHERE token_hash = $1`, [
      hashResetToken(token),
    ]);
    return rows[0] ?? null;
  }

  /** Why a locked reset cannot be used, or null. Ends a due or ineligible one, audited. */
  async function unusable(client: PoolClient, row: ResetRow, account: Account | null, clientAddress: string): Promise<string | null> {
    const actor = account === null ? null : { userId: account.userId, name: account.name };
    if (row.status === 'issued' && row.due) {
      await client.query(`UPDATE dromex_password_reset SET status = 'expired', ended_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.id]);
      await record(client, 'password_reset_expired', 'success', null, clientAddress, row.id);
      return 'reset_expired';
    }
    if (row.status !== 'issued') {
      const reason = row.status === 'expired' ? 'reset_expired' : row.status === 'superseded' ? 'reset_superseded' : 'reset_used';
      return reason;
    }
    const refusal = account === null ? 'not_eligible' : ineligibility(account);
    if (refusal !== null) {
      await client.query(
        `UPDATE dromex_password_reset SET status = 'failed', ended_at = CURRENT_TIMESTAMP, end_reason = $2 WHERE id = $1`,
        [row.id, refusal],
      );
      return refusal;
    }
    return null;
  }

  /**
   * Sets `credentials_changed_at` to now, never moving it backwards. "Now" is
   * this process's clock, not the database's: every gate compares it with a
   * session's `createdAt`, which Better Auth sets from this process's clock, so
   * both sides of the comparison must come from the same clock (DEC-487 (3)).
   */
  async function stampCredentialChange(client: PoolClient, userId: string): Promise<Date> {
    const { rows } = await client.query<{ changed_at: Date }>(
      `UPDATE dromex_principal
          SET credentials_changed_at = GREATEST(COALESCE(credentials_changed_at, '-infinity'), $2::timestamptz),
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
        RETURNING credentials_changed_at AS changed_at`,
      [userId, new Date()],
    );
    if (rows[0] === undefined) throw new Error('The principal to stamp does not exist.');
    return rows[0].changed_at;
  }

  async function failClaim(resetId: string, actor: SecurityAuditActor, reason: string, clientAddress: string): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        `UPDATE dromex_password_reset SET status = 'failed', ended_at = CURRENT_TIMESTAMP, end_reason = $2
          WHERE id = $1 AND status = 'claimed'`,
        [resetId, reason],
      );
      await record(client, 'password_reset_failed', 'failure', actor, clientAddress, resetId, { reason });
    });
  }

  return {
    async request(input, clientAddress) {
      const over = await consume(`pw-reset-request|${clientAddress}`, PASSWORD_RESET_LIMITS.requestPerSource);
      if (over !== null) return over;
      const email = normalizeResetEmail(input.email);
      // Everything past this line happens after the response, whatever it finds.
      if (email !== null) queue.offer(() => issue(email, clientAddress));
      return { ok: true };
    },

    async inspect(input, clientAddress) {
      const over = await consume(`pw-reset-inspect|${clientAddress}`, PASSWORD_RESET_LIMITS.inspectPerSource);
      if (over !== null) return over;
      if (!isWellFormedResetToken(input.token)) return INVALID;
      const row = await lookup(input.token);
      if (row === null || row.status !== 'issued' || row.due) return INVALID;
      const account = await findAccount(pool, 'id', row.user_id);
      return account !== null && ineligibility(account) === null ? { ok: true } : INVALID;
    },

    async complete(input, clientAddress) {
      const over = await consume(`pw-reset-complete|${clientAddress}`, PASSWORD_RESET_LIMITS.completePerSource);
      if (over !== null) return over;
      if (!isWellFormedResetToken(input.token)) return INVALID;
      const found = await lookup(input.token);
      // An unknown token is never audited, so guessing cannot grow the audit.
      if (found === null) return INVALID;

      const perReset = await consume(`pw-reset-complete|reset:${found.id}`, PASSWORD_RESET_LIMITS.completePerReset);
      if (perReset !== null) return perReset;

      const release = await holdAccount(found.user_id);
      if (release === null) return INVALID;
      try {
        // The password is checked before anything is claimed, so a rejected
        // password never uses up the link.
        const policy = checkNewPassword(input.newPassword);
        const rejection: PasswordPolicyReason | null = policy.ok ? null : policy.reason;

        const claimed = await transaction(async (client) => {
          await sweep(client, clientAddress);
          const locked = await client.query<ResetRow>(`SELECT ${ROW_COLUMNS} FROM dromex_password_reset WHERE id = $1 FOR UPDATE`, [found.id]);
          const row = locked.rows[0]!;
          const account = await findAccount(client, 'id', row.user_id, true);
          const actor = account === null ? null : { userId: account.userId, name: account.name };

          const reason = await unusable(client, row, account, clientAddress);
          if (reason !== null) {
            await record(client, 'password_reset_rejected', 'failure', actor, clientAddress, row.id, { reason });
            return null;
          }
          if (rejection !== null) {
            await record(client, 'password_reset_rejected', 'failure', actor, clientAddress, row.id, { reason: 'password_rejected' });
            return { kind: 'rejected' as const, reason: rejection };
          }

          const sessions = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [
            account!.userId,
          ]);
          const claim = await client.query(
            `UPDATE dromex_password_reset SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'issued'`,
            [row.id],
          );
          // Single use: exactly this one row moves from issued to claimed, or nothing proceeds.
          if (claim.rowCount !== 1) throw new Error('The reset was no longer issued.');
          // DEC-487 (3): every existing session ends here, before the write.
          await stampCredentialChange(client, account!.userId);
          await record(client, 'password_reset_claimed', 'success', actor, clientAddress, row.id);
          return { kind: 'claimed' as const, account: account!, row, sessionsBefore: sessions.rows[0]!.n };
        });

        if (claimed === null) return INVALID;
        if (claimed.kind === 'rejected') return { ok: false, error: 'password_rejected', reason: claimed.reason };

        const { account, row, sessionsBefore } = claimed;
        const actor = { userId: account.userId, name: account.name };
        await interrupt('after_claimed');

        let written: Awaited<ReturnType<ResetIdentityPort['writePassword']>>;
        try {
          written = await identity.writePassword({ userId: account.userId, email: account.email, newPassword: input.newPassword as string });
        } catch {
          await failClaim(row.id, actor, 'write_failed', clientAddress);
          return FAILED;
        }
        if (written !== 'written') {
          await failClaim(row.id, actor, 'password_rejected', clientAddress);
          return FAILED;
        }
        await interrupt('after_password_written');

        const changedAt = await transaction(async (client) => {
          const changed = await stampCredentialChange(client, account.userId);
          const completed = await client.query(
            `UPDATE dromex_password_reset SET status = 'completed', ended_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'claimed'`,
            [row.id],
          );
          if (completed.rowCount !== 1) throw new Error('The claimed reset was no longer claimed.');

          const remaining = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [
            account.userId,
          ]);
          const left = remaining.rows[0]!.n;
          await record(client, 'password_reset_sessions_revoked', 'success', actor, clientAddress, row.id, {
            revokedSessionCount: Math.max(0, sessionsBefore - left),
          });
          if (left > 0) {
            // Every remaining session predates the stamp above, so every gate refuses it.
            await record(client, 'password_reset_session_revocation_incomplete', 'failure', actor, clientAddress, row.id, {
              revokedSessionCount: left,
            });
          }
          await record(client, 'password_reset_completed', 'success', actor, clientAddress, row.id);
          return changed;
        }).catch(async () => {
          await failClaim(row.id, actor, 'completion_failed', clientAddress).catch(() => undefined);
          return null;
        });
        if (changedAt === null) return FAILED;

        queue.offer(() => notifyChanged(account, row.id, changedAt, clientAddress));
        return { ok: true };
      } finally {
        await release();
      }
    },

    drain: () => queue.drain(),
    close: () => queue.close(),
  };
}
