import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { securityEvent, type SecurityAudit, type SecurityAuditActor, type SecurityAuditEventType } from '../auth/security-audit.ts';
import type { EmailSender } from '../email/message.ts';
import type { EmailSendResult, EmailTransport } from '../email/result.ts';
import { normalizeInvitationEmail, renderAdminInvitationEmail } from './invitation-email.ts';
import { generateInvitationToken } from './invitation-token.ts';

/**
 * Owner-managed Admin invitation issuance (DEC-440): create, resend, cancel,
 * expire, list, hand the email to the transport, and audit every step.
 * Acceptance lives in `invitation-acceptance.ts` (checkpoint 4B2).
 *
 * **Authorization lives here as well as on the route (DEC-428).** Every
 * operation re-reads the caller's principal inside its own transaction and
 * refuses anyone who is not the active, MFA-complete Owner, so no future
 * caller of this use case can skip the check.
 *
 * **Serialization.** Every operation on one email takes a transaction-scoped
 * advisory lock derived from the normalised email, then row locks, always in
 * that order. Together with the partial unique index (one pending invitation
 * per email) this makes concurrent creations, resends, and cancellations
 * resolve to exactly one consistent outcome.
 *
 * **The token.** It is generated just before the issuing transaction, only
 * its hash is written, and it is handed to the email renderer once, after
 * that transaction commits. No network call ever happens while a lock is
 * held. It is never returned, logged, or audited.
 *
 * **Delivery truthfulness.** A row starts as `sending`. The transport result
 * then records `provider_accepted`, `failed` with the result's reason, or
 * `not_sent` (`email_disabled`) when email is disabled or not configured.
 * A process that stops between the two leaves `sending`, which honestly means
 * "outcome unknown". Delivery status never grants anything (DEC-439 (5)).
 *
 * **Rate limits (implementation detail under DEC-440 (10)).** Per normalised
 * email, counted from the invitation rows themselves in database time: at
 * most one issuance (creation or resend) per 60 seconds, and at most six
 * issuances in any 24 hours — the initial invitation plus five resends.
 * Counting every issuance, not only resends, means cancelling and creating
 * again cannot bypass the daily limit.
 */

export const ADMIN_INVITATION_POLICY = {
  lifetime: '24 hours',
  issuanceCooldownSeconds: 60,
  maxIssuancesPerDay: 6,
  listLimit: 200,
  expiryBatch: 100,
} as const;

export type InvitationStatus = 'pending' | 'accepted' | 'superseded' | 'cancelled' | 'expired';
export type InvitationDeliveryStatus = 'sending' | 'provider_accepted' | 'failed' | 'not_sent';

/** The complete, deliberate Owner view of one invitation. */
export interface InvitationView {
  id: string;
  email: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  delivery: { status: InvitationDeliveryStatus; reason: string | null };
}

export type InvitationFailure =
  | 'forbidden'
  | 'invalid_email'
  | 'account_exists'
  | 'invitation_pending'
  | 'invitation_not_pending'
  | 'not_found'
  | 'rate_limited';

export type InvitationResult =
  | { ok: true; invitation: InvitationView }
  | { ok: false; error: Exclude<InvitationFailure, 'rate_limited'> }
  | { ok: false; error: 'rate_limited'; retryAfterSeconds: number };

export type InvitationListResult = { ok: true; invitations: InvitationView[] } | { ok: false; error: 'forbidden' };

/** How invitation emails leave the server. `null` means email is not configured. */
export interface InvitationDelivery {
  transport: EmailTransport;
  from: EmailSender;
  replyTo?: string;
  linkOrigin: string;
}

export interface AdminInvitationService {
  list(actor: SecurityAuditActor): Promise<InvitationListResult>;
  create(actor: SecurityAuditActor, email: unknown, clientAddress: string | null): Promise<InvitationResult>;
  resend(actor: SecurityAuditActor, invitationId: string, clientAddress: string | null): Promise<InvitationResult>;
  cancel(actor: SecurityAuditActor, invitationId: string, clientAddress: string | null): Promise<InvitationResult>;
}

export interface AdminInvitationDependencies {
  pool: Pool;
  audit: SecurityAudit;
  delivery: InvitationDelivery | null;
}

interface InvitationRow {
  id: string;
  email: string;
  status: InvitationStatus;
  created_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  delivery_id: string;
  delivery_status: InvitationDeliveryStatus;
  delivery_reason: string | null;
  due: boolean;
}

const COLUMNS = `id::text, email, status, created_at, expires_at, ended_at, delivery_id::text,
  delivery_status, delivery_reason, expires_at <= CURRENT_TIMESTAMP AS due`;

const DATABASE_ID = /^[1-9][0-9]{0,18}$/;

/** Refusals carry no detail beyond their code; this never leaves the module. */
class Refusal extends Error {
  constructor(
    readonly code: InvitationFailure,
    readonly retryAfterSeconds = 0,
  ) {
    super('Invitation operation refused.');
    this.name = 'InvitationRefusal';
  }
}

function view(row: InvitationRow): InvitationView {
  return {
    id: row.id,
    email: row.email,
    status: row.status === 'pending' && row.due ? 'expired' : row.status,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    endedAt: row.ended_at === null ? null : row.ended_at.toISOString(),
    delivery: { status: row.delivery_status, reason: row.delivery_reason },
  };
}

function refused(refusal: Refusal): InvitationResult {
  return refusal.code === 'rate_limited'
    ? { ok: false, error: 'rate_limited', retryAfterSeconds: Math.max(1, refusal.retryAfterSeconds) }
    : { ok: false, error: refusal.code };
}

/** The transport outcome as the stored delivery state and reason. Never the provider's own words. */
function deliveryOutcome(result: EmailSendResult | 'not_configured' | 'crashed'): {
  status: Exclude<InvitationDeliveryStatus, 'sending'>;
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

export function createAdminInvitationService(deps: AdminInvitationDependencies): AdminInvitationService {
  const { pool, audit, delivery } = deps;
  if (typeof audit?.record !== 'function') throw new Error('Admin invitations require the security audit.');

  async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    } finally {
      client.release();
    }
  }

  function event(
    type: SecurityAuditEventType,
    outcome: 'success' | 'failure',
    actor: SecurityAuditActor | null,
    clientAddress: string | null,
    invitationId: string | null,
    reason: string | null = null,
  ) {
    return securityEvent(type, outcome, actor, null, clientAddress, { invitationId, reason });
  }

  /** DEC-428: the use case's own check. Only the active, MFA-complete Owner passes. */
  async function requireOwner(client: PoolClient, actor: SecurityAuditActor): Promise<void> {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT (status = 'active' AND is_owner AND mfa_completed_at IS NOT NULL) AS ok
         FROM dromex_principal WHERE user_id = $1 FOR SHARE`,
      [actor.userId],
    );
    if (rows[0]?.ok !== true) throw new Refusal('forbidden');
  }

  async function lockEmail(client: PoolClient, email: string): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('dromex_admin_invitation:' || $1, 0))`, [email]);
  }

  /** Ends due pending invitations, each audited exactly once. Bounded; skips rows another transaction holds. */
  async function expireDue(client: PoolClient, clientAddress: string | null): Promise<void> {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE dromex_admin_invitation SET status = 'expired', ended_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT id FROM dromex_admin_invitation
                      WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP
                      ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id::text`,
      [ADMIN_INVITATION_POLICY.expiryBatch],
    );
    for (const row of rows) {
      await audit.record(event('admin_invitation_expired', 'success', null, clientAddress, row.id), client);
    }
  }

  /** Expires one locked row if it is due. Returns whether it is still usable. */
  async function stillPending(client: PoolClient, row: InvitationRow, clientAddress: string | null): Promise<boolean> {
    if (row.status !== 'pending') return false;
    if (!row.due) return true;
    await client.query(
      `UPDATE dromex_admin_invitation SET status = 'expired', ended_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'pending'`,
      [row.id],
    );
    await audit.record(event('admin_invitation_expired', 'success', null, clientAddress, row.id), client);
    return false;
  }

  async function checkIssuanceLimits(client: PoolClient, email: string): Promise<void> {
    const { rows } = await client.query<{ cooldown: number; daily: number }>(
      `SELECT
         COALESCE(ceil(EXTRACT(EPOCH FROM (max(created_at) + make_interval(secs => $2) - CURRENT_TIMESTAMP))), 0)::int AS cooldown,
         CASE WHEN count(*) >= $3
              THEN ceil(EXTRACT(EPOCH FROM (min(created_at) + interval '24 hours' - CURRENT_TIMESTAMP)))::int
              ELSE 0 END AS daily
         FROM dromex_admin_invitation
        WHERE email = $1 AND created_at > CURRENT_TIMESTAMP - interval '24 hours'`,
      [email, ADMIN_INVITATION_POLICY.issuanceCooldownSeconds, ADMIN_INVITATION_POLICY.maxIssuancesPerDay],
    );
    const wait = Math.max(rows[0]?.cooldown ?? 0, rows[0]?.daily ?? 0);
    if (wait > 0) throw new Refusal('rate_limited', wait);
  }

  async function insertInvitation(
    client: PoolClient,
    actor: SecurityAuditActor,
    email: string,
    tokenHash: Buffer,
    supersedesId: string | null,
  ): Promise<InvitationRow> {
    const { rows } = await client.query<InvitationRow>(
      `INSERT INTO dromex_admin_invitation
         (email, token_hash, status, invited_by_user_id, supersedes_id, expires_at, delivery_id, delivery_status)
       VALUES ($1, $2, 'pending', $3, $4, CURRENT_TIMESTAMP + interval '24 hours', $5, 'sending')
       RETURNING ${COLUMNS}`,
      [email, tokenHash, actor.userId, supersedesId, randomUUID()],
    );
    return rows[0]!;
  }

  async function lockInvitation(client: PoolClient, invitationId: string): Promise<InvitationRow> {
    if (!DATABASE_ID.test(invitationId)) throw new Refusal('not_found');
    const found = await client.query<{ email: string }>(`SELECT email FROM dromex_admin_invitation WHERE id = $1`, [invitationId]);
    const email = found.rows[0]?.email;
    if (email === undefined) throw new Refusal('not_found');
    await lockEmail(client, email);
    const { rows } = await client.query<InvitationRow>(
      `SELECT ${COLUMNS} FROM dromex_admin_invitation WHERE id = $1 FOR UPDATE`,
      [invitationId],
    );
    return rows[0]!;
  }

  /**
   * Runs one audited, Owner-checked transaction. A refusal commits its own
   * audit row (and any expiry it found) and becomes a result; any other error
   * rolls back and propagates.
   */
  async function operate<T>(
    actor: SecurityAuditActor,
    clientAddress: string | null,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; refusal: Refusal }> {
    return transaction(async (client) => {
      await client.query('SAVEPOINT invitation_work');
      try {
        await requireOwner(client, actor);
        return { ok: true as const, value: await work(client) };
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        await client.query('ROLLBACK TO SAVEPOINT invitation_work');
        // Expiry found before the refusal still counts, but only for an Owner.
        if (error.code !== 'forbidden') await expireDue(client, clientAddress);
        await audit.record(event('admin_invitation_refused', 'failure', actor, clientAddress, null, error.code), client);
        return { ok: false as const, refusal: error };
      }
    });
  }

  /** Hands one email to the transport after the issuing transaction, then records the truthful outcome. */
  async function deliver(
    actor: SecurityAuditActor,
    row: InvitationRow,
    token: string,
    clientAddress: string | null,
  ): Promise<InvitationView> {
    let result: EmailSendResult | 'not_configured' | 'crashed';
    if (delivery === null) {
      result = 'not_configured';
    } else {
      try {
        const message = renderAdminInvitationEmail({
          to: row.email,
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
    return transaction(async (client) => {
      const { rows } = await client.query<InvitationRow>(
        `UPDATE dromex_admin_invitation
            SET delivery_status = $2, delivery_reason = $3, delivery_attempts = $4, delivery_updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND delivery_status = 'sending'
          RETURNING ${COLUMNS}`,
        [row.id, outcome.status, outcome.reason, outcome.attempts],
      );
      const accepted = outcome.status === 'provider_accepted';
      await audit.record(
        event(
          accepted ? 'admin_invitation_delivery_accepted' : 'admin_invitation_delivery_failed',
          accepted ? 'success' : 'failure',
          actor,
          clientAddress,
          row.id,
          outcome.reason,
        ),
        client,
      );
      if (rows[0] !== undefined) return view(rows[0]);
      const current = await client.query<InvitationRow>(`SELECT ${COLUMNS} FROM dromex_admin_invitation WHERE id = $1`, [row.id]);
      return view(current.rows[0]!);
    });
  }

  return {
    async list(actor) {
      const outcome = await operate(actor, null, async (client) => {
        await expireDue(client, null);
        const { rows } = await client.query<InvitationRow>(
          `SELECT ${COLUMNS} FROM dromex_admin_invitation ORDER BY created_at DESC, id DESC LIMIT $1`,
          [ADMIN_INVITATION_POLICY.listLimit],
        );
        return rows.map(view);
      });
      return outcome.ok ? { ok: true, invitations: outcome.value } : { ok: false, error: 'forbidden' };
    },

    async create(actor, rawEmail, clientAddress) {
      const email = normalizeInvitationEmail(rawEmail);
      const { token, hash } = generateInvitationToken();

      const outcome = await operate(actor, clientAddress, async (client) => {
        if (email === null) throw new Refusal('invalid_email');
        await lockEmail(client, email);
        await expireDue(client, clientAddress);

        // DEC-444 (2): an address whose identity is still pending in invitation
        // setup may be invited again and resumes that identity. A completed
        // active or disabled account, and any identity setup did not create,
        // stays ineligible.
        const account = await client.query<{ resumable: boolean }>(
          `SELECT (p.status = 'pending' AND e.user_id = u.id AND e.step <> 'completed')
                  OR (p.user_id IS NULL AND e.step = 'identity_pending' AND e.user_id IS NULL) AS resumable
             FROM "user" u
             LEFT JOIN dromex_principal p ON p.user_id = u.id
             LEFT JOIN dromex_admin_enrolment e ON e.email = $1
            WHERE lower(u."email") = $1
            LIMIT 1`,
          [email],
        );
        if (account.rows.length > 0 && account.rows[0]!.resumable !== true) throw new Refusal('account_exists');

        const pending = await client.query<InvitationRow>(
          `SELECT ${COLUMNS} FROM dromex_admin_invitation WHERE email = $1 AND status = 'pending' FOR UPDATE`,
          [email],
        );
        if (pending.rows[0] !== undefined && (await stillPending(client, pending.rows[0], clientAddress))) {
          throw new Refusal('invitation_pending');
        }

        await checkIssuanceLimits(client, email);
        const row = await insertInvitation(client, actor, email, hash, null);
        await audit.record(event('admin_invitation_created', 'success', actor, clientAddress, row.id), client);
        return row;
      });

      if (!outcome.ok) return refused(outcome.refusal);
      return { ok: true, invitation: await deliver(actor, outcome.value, token, clientAddress) };
    },

    async resend(actor, invitationId, clientAddress) {
      const { token, hash } = generateInvitationToken();

      const outcome = await operate(actor, clientAddress, async (client) => {
        const current = await lockInvitation(client, invitationId);
        if (!(await stillPending(client, current, clientAddress))) throw new Refusal('invitation_not_pending');
        await checkIssuanceLimits(client, current.email);

        await client.query(
          `UPDATE dromex_admin_invitation SET status = 'superseded', ended_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'pending'`,
          [current.id],
        );
        await audit.record(event('admin_invitation_superseded', 'success', actor, clientAddress, current.id), client);
        const row = await insertInvitation(client, actor, current.email, hash, current.id);
        await audit.record(event('admin_invitation_resent', 'success', actor, clientAddress, row.id), client);
        return row;
      });

      if (!outcome.ok) return refused(outcome.refusal);
      return { ok: true, invitation: await deliver(actor, outcome.value, token, clientAddress) };
    },

    async cancel(actor, invitationId, clientAddress) {
      const outcome = await operate(actor, clientAddress, async (client) => {
        const current = await lockInvitation(client, invitationId);
        if (!(await stillPending(client, current, clientAddress))) throw new Refusal('invitation_not_pending');
        const { rows } = await client.query<InvitationRow>(
          `UPDATE dromex_admin_invitation SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'pending' RETURNING ${COLUMNS}`,
          [current.id],
        );
        await audit.record(event('admin_invitation_cancelled', 'success', actor, clientAddress, current.id), client);
        return view(rows[0]!);
      });

      return outcome.ok ? { ok: true, invitation: outcome.value } : refused(outcome.refusal);
    },
  };
}
