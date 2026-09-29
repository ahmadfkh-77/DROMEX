import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { securityEvent, type SecurityAudit, type SecurityAuditActor, type SecurityAuditEventType } from '../auth/security-audit.ts';
import type { InvitationDeliveryStatus, InvitationStatus } from '../invitations/admin-invitations.ts';
import { parseStatusChangeReason } from './account-reason.ts';

/**
 * Owner account and session management (checkpoint 4E, DEC-408, DEC-427):
 * list Admin accounts and invitations, show one account, disable and
 * re-enable an Admin with a reason, and revoke one or every session of an
 * Admin.
 *
 * **Authorization lives here as well as on the route (DEC-428).** Every
 * operation re-reads the caller's principal and refuses anyone who is not the
 * active, MFA-complete Owner. The Owner is never a target: an Owner acting on
 * their own account is refused as `owner_protected`, and the database refuses
 * a status change by an account to itself.
 *
 * **Atomicity.** Each change is one DROMEX transaction that locks the target
 * principal, re-checks its state, writes the change the gates read (status
 * and `sessions_revoked_at`), the status change with its reason, and the
 * audit event, and commits them together. Concurrent actions on one account
 * serialise on that row lock, so each sees the state the previous one left.
 * Deleting Better Auth's session rows follows the commit of a disable or a
 * revoke-all, through the session control port; it is cleanup, because every gate already refuses those
 * sessions, and a cleanup that fails is audited, never reported as a failed
 * action. A single-session revocation is the exception: it deletes the one
 * session while the row lock is held and audits only once the deletion
 * happened, so a failed deletion changes nothing and is reported as a failure.
 *
 * **Clocks.** `sessions_revoked_at` is stamped from the API process's clock,
 * because the gate compares it with Better Auth's session `createdAt`, which
 * comes from that clock (the DEC-487 precision).
 *
 * **What is never returned.** Session identifiers, tokens, IP addresses, user
 * agents, factor or recovery-code state, invitation tokens or hashes, and the
 * audit trail. A session is named by an opaque reference derived from its
 * identifier. There is no "last activity" value, because DROMEX records none.
 */

export const ADMIN_ACCOUNT_POLICY = {
  listLimit: 200,
  sessionLimit: 50,
} as const;

export type AccountState =
  | 'active'
  | 'disabled'
  | 'enrolment_in_progress'
  | 'invitation_pending'
  | 'invitation_expired'
  | 'invitation_cancelled';

export interface InvitationSnapshot {
  id: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  delivery: { status: InvitationDeliveryStatus; reason: string | null };
}

export interface AccountSummary {
  userId: string;
  name: string;
  email: string;
  state: AccountState;
  /** Sessions the gate would admit right now; `null` unless the account is active. */
  activeSessions: number | null;
  invitation: InvitationSnapshot | null;
}

/** The latest invitation to an address that has no DROMEX account yet. */
export interface InvitationEntry {
  invitationId: string;
  email: string;
  state: Extract<AccountState, 'invitation_pending' | 'invitation_expired' | 'invitation_cancelled' | 'enrolment_in_progress'>;
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  delivery: { status: InvitationDeliveryStatus; reason: string | null };
}

export interface SessionSummary {
  /** Opaque: never Better Auth's session identifier or token. */
  ref: string;
  signedInAt: string;
  expiresAt: string;
}

export type AccountRefusalCode =
  | 'forbidden'
  | 'not_found'
  | 'owner_protected'
  | 'invalid_reason'
  | 'account_not_active'
  | 'account_not_disabled'
  | 'session_not_found';

export interface ActionAvailability {
  available: boolean;
  reason: Extract<AccountRefusalCode, 'account_not_active' | 'account_not_disabled'> | null;
}

export interface AccountDetail {
  userId: string;
  name: string;
  email: string;
  state: AccountState;
  identityCreatedAt: string;
  /** When invitation setup completed, where DROMEX recorded it. */
  setupCompletedAt: string | null;
  invitation: InvitationSnapshot | null;
  lastStatusChange: { action: 'disabled' | 'enabled'; reason: string; changedAt: string; changedByName: string } | null;
  sessions: SessionSummary[];
  actions: { disable: ActionAvailability; enable: ActionAvailability; revokeAllSessions: ActionAvailability };
}

export type AccountListResult =
  | { ok: true; accounts: AccountSummary[]; invitations: InvitationEntry[] }
  | { ok: false; error: 'forbidden' };

export type AccountResult = { ok: true; account: AccountDetail } | { ok: false; error: AccountRefusalCode };

/** How the service reaches Better Auth's session store. Supplied by the server. */
export interface SessionControlPort {
  revokeSession(userId: string, sessionId: string): Promise<boolean>;
  revokeAllSessions(userId: string): Promise<{ remaining: number }>;
}

export interface AdminAccountService {
  list(actor: SecurityAuditActor): Promise<AccountListResult>;
  detail(actor: SecurityAuditActor, userId: string): Promise<AccountResult>;
  disable(actor: SecurityAuditActor, userId: string, reason: unknown, clientAddress: string | null): Promise<AccountResult>;
  enable(actor: SecurityAuditActor, userId: string, reason: unknown, clientAddress: string | null): Promise<AccountResult>;
  revokeAllSessions(actor: SecurityAuditActor, userId: string, clientAddress: string | null): Promise<AccountResult>;
  revokeSession(actor: SecurityAuditActor, userId: string, sessionRef: string, clientAddress: string | null): Promise<AccountResult>;
}

export interface AdminAccountDependencies {
  pool: Pool;
  audit: SecurityAudit;
  sessions: SessionControlPort;
  /** The API process's clock. Tests may pin it; production passes nothing. */
  now?: () => Date;
  /** Reports a failed Better Auth cleanup by error name only. */
  onCleanupError?: (errorName: string) => void;
}

/** A Better Auth identifier as the routes accept it. Anything else is simply not found. */
const USER_ID = /^[A-Za-z0-9_-]{1,255}$/;
const SESSION_REF = /^[0-9a-f]{32}$/;
const SESSION_REF_LABEL = 'dromex/session-ref/v1\0';

/** The opaque reference for one session: stable, unguessable from outside, and not the identifier. */
function sessionRefOf(sessionId: string): string {
  return createHash('sha256').update(SESSION_REF_LABEL).update(sessionId).digest('hex').slice(0, 32);
}

interface TargetRow {
  user_id: string;
  status: 'pending' | 'active' | 'disabled';
  is_owner: boolean;
  mfa_completed_at: Date | null;
}

interface SessionRow {
  id: string;
  created_at: Date;
  expires_at: Date;
}

interface InvitationRow {
  id: string;
  email: string;
  status: InvitationStatus;
  created_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  delivery_status: InvitationDeliveryStatus;
  delivery_reason: string | null;
  due: boolean;
}

/**
 * Sessions of one user that the ordinary gate would admit now, in the same
 * terms as `gateIdentity` (auth/http.ts): unexpired, an active MFA-complete
 * principal with an enabled factor, created no earlier than MFA completion,
 * the last password change, or the Owner's last revocation, and never bound
 * to a recovery or an invitation setup. Read-only; Better Auth's rows are
 * never written here.
 */
const ACTIVE_SESSIONS = `
  SELECT s.id, s."createdAt" AS created_at, s."expiresAt" AS expires_at
    FROM "session" s
    JOIN "user" u ON u.id = s."userId"
    JOIN dromex_principal p ON p.user_id = s."userId"
   WHERE s."userId" = $1
     AND s."expiresAt" > CURRENT_TIMESTAMP
     AND p.status = 'active'
     AND u."twoFactorEnabled" IS TRUE
     AND p.mfa_completed_at IS NOT NULL
     AND s."createdAt" >= p.mfa_completed_at
     AND (p.credentials_changed_at IS NULL OR s."createdAt" >= p.credentials_changed_at)
     AND (p.sessions_revoked_at IS NULL OR s."createdAt" >= p.sessions_revoked_at)
     AND NOT EXISTS (SELECT 1 FROM dromex_recovery_session r WHERE r.session_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM dromex_terminal_recovery_session t WHERE t.session_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM dromex_admin_enrolment_session e WHERE e.session_id = s.id)
   ORDER BY s."createdAt" DESC, s.id
   LIMIT $2`;

const INVITATION_COLUMNS = `i.id::text, i.email, i.status, i.created_at, i.expires_at, i.ended_at,
  i.delivery_status, i.delivery_reason, i.expires_at <= CURRENT_TIMESTAMP AS due`;

/** The newest invitation per normalised address. */
const LATEST_INVITATIONS = `
  SELECT DISTINCT ON (i.email) ${INVITATION_COLUMNS}
    FROM dromex_admin_invitation i
   ORDER BY i.email, i.created_at DESC, i.id DESC`;

/** Refusals carry no detail beyond their code; this never leaves the module. */
class Refusal extends Error {
  readonly code: AccountRefusalCode;
  /** The account refused, when it exists; audited as the target. */
  readonly target: string | null;

  constructor(code: AccountRefusalCode, target: string | null = null) {
    super('Account operation refused.');
    this.code = code;
    this.target = target;
    this.name = 'AccountRefusal';
  }
}

function effectiveStatus(row: InvitationRow): InvitationStatus {
  return row.status === 'pending' && row.due ? 'expired' : row.status;
}

function snapshot(row: InvitationRow): InvitationSnapshot {
  return {
    id: row.id,
    status: effectiveStatus(row),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    endedAt: row.ended_at === null ? null : row.ended_at.toISOString(),
    delivery: { status: row.delivery_status, reason: row.delivery_reason },
  };
}

/** A pending principal's state follows its newest invitation; without one, setup simply has not finished. */
function stateOf(status: TargetRow['status'], invitation: InvitationRow | null): AccountState {
  if (status === 'active') return 'active';
  if (status === 'disabled') return 'disabled';
  const effective = invitation === null ? null : effectiveStatus(invitation);
  if (effective === 'expired') return 'invitation_expired';
  if (effective === 'cancelled') return 'invitation_cancelled';
  return 'enrolment_in_progress';
}

function availability(status: TargetRow['status']): AccountDetail['actions'] {
  const notActive = { available: false, reason: 'account_not_active' } as const;
  const notDisabled = { available: false, reason: 'account_not_disabled' } as const;
  const yes = { available: true, reason: null } as const;
  return {
    disable: status === 'active' ? yes : notActive,
    enable: status === 'disabled' ? yes : notDisabled,
    revokeAllSessions: status === 'pending' ? notActive : yes,
  };
}

export function createAdminAccountService(deps: AdminAccountDependencies): AdminAccountService {
  const { pool, audit, sessions } = deps;
  const now = deps.now ?? (() => new Date());
  if (typeof audit?.record !== 'function') throw new Error('Account management requires the security audit.');
  if (typeof sessions?.revokeAllSessions !== 'function' || typeof sessions.revokeSession !== 'function') {
    throw new Error('Account management requires the session control port.');
  }

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
    actor: SecurityAuditActor,
    clientAddress: string | null,
    extra: { targetUserId?: string | null; accountChangeId?: string | null; reason?: string | null; revokedSessionCount?: number | null },
  ) {
    return securityEvent(type, outcome, actor, null, clientAddress, extra);
  }

  /** DEC-428: the use case's own check. Only the active, MFA-complete Owner passes. */
  async function requireOwner(client: PoolClient | Pool, actor: SecurityAuditActor): Promise<void> {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT (status = 'active' AND is_owner AND mfa_completed_at IS NOT NULL) AS ok
         FROM dromex_principal WHERE user_id = $1`,
      [actor.userId],
    );
    if (rows[0]?.ok !== true) throw new Refusal('forbidden');
  }

  /** Locks the target principal. The Owner and anything unknown are refused before any change. */
  async function lockTarget(client: PoolClient, actor: SecurityAuditActor, userId: string): Promise<TargetRow> {
    if (!USER_ID.test(userId)) throw new Refusal('not_found');
    if (userId === actor.userId) throw new Refusal('owner_protected', userId);
    const { rows } = await client.query<TargetRow>(
      `SELECT user_id, status, is_owner, mfa_completed_at FROM dromex_principal WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const target = rows[0];
    if (target === undefined) throw new Refusal('not_found');
    if (target.is_owner) throw new Refusal('owner_protected', userId);
    return target;
  }

  async function activeSessions(client: PoolClient | Pool, userId: string): Promise<SessionRow[]> {
    const { rows } = await client.query<SessionRow>(ACTIVE_SESSIONS, [userId, ADMIN_ACCOUNT_POLICY.sessionLimit]);
    return rows;
  }

  /** Moves `sessions_revoked_at` forward to the API clock, never backwards. */
  async function stampRevocation(client: PoolClient, userId: string, status: TargetRow['status']): Promise<void> {
    await client.query(
      `UPDATE dromex_principal
          SET status = $3,
              sessions_revoked_at = GREATEST(COALESCE(sessions_revoked_at, '-infinity'), $2::timestamptz),
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1`,
      [userId, now(), status],
    );
  }

  async function recordChange(
    client: PoolClient,
    actor: SecurityAuditActor,
    userId: string,
    action: 'disabled' | 'enabled',
    reason: string,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO dromex_account_status_change (user_id, action, reason, changed_by_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id::text`,
      [userId, action, reason, actor.userId],
    );
    return rows[0]!.id;
  }

  async function loadDetail(client: PoolClient | Pool, userId: string): Promise<AccountDetail | null> {
    const found = await client.query<TargetRow & { name: string; email: string; identity_created_at: Date; completed_at: Date | null }>(
      `SELECT p.user_id, p.status, p.is_owner, p.mfa_completed_at, u.name, u.email,
              u."createdAt" AS identity_created_at, e.completed_at
         FROM dromex_principal p
         JOIN "user" u ON u.id = p.user_id
         LEFT JOIN dromex_admin_enrolment e ON e.user_id = p.user_id
        WHERE p.user_id = $1 AND NOT p.is_owner`,
      [userId],
    );
    const row = found.rows[0];
    if (row === undefined) return null;

    const invitation = await client.query<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM dromex_admin_invitation i
        WHERE i.email = lower($1) ORDER BY i.created_at DESC, i.id DESC LIMIT 1`,
      [row.email],
    );
    const change = await client.query<{ action: 'disabled' | 'enabled'; reason: string; changed_at: Date; changed_by_name: string }>(
      `SELECT c.action, c.reason, c.changed_at, u.name AS changed_by_name
         FROM dromex_account_status_change c
         JOIN "user" u ON u.id = c.changed_by_user_id
        WHERE c.user_id = $1
        ORDER BY c.changed_at DESC, c.id DESC LIMIT 1`,
      [userId],
    );
    const latest = invitation.rows[0] ?? null;
    const last = change.rows[0];

    return {
      userId: row.user_id,
      name: row.name,
      email: row.email,
      state: stateOf(row.status, latest),
      identityCreatedAt: row.identity_created_at.toISOString(),
      setupCompletedAt: row.completed_at === null ? null : row.completed_at.toISOString(),
      invitation: latest === null ? null : snapshot(latest),
      lastStatusChange:
        last === undefined
          ? null
          : { action: last.action, reason: last.reason, changedAt: last.changed_at.toISOString(), changedByName: last.changed_by_name },
      sessions: (await activeSessions(client, userId)).map((session) => ({
        ref: sessionRefOf(session.id),
        signedInAt: session.created_at.toISOString(),
        expiresAt: session.expires_at.toISOString(),
      })),
      actions: availability(row.status),
    };
  }

  /** Records a refusal in its own small transaction and turns it into a result. */
  async function refused(actor: SecurityAuditActor, clientAddress: string | null, refusal: Refusal): Promise<AccountResult> {
    await audit.record(
      event('admin_account_action_refused', 'failure', actor, clientAddress, { targetUserId: refusal.target, reason: refusal.code }),
    );
    return { ok: false, error: refusal.code };
  }

  /**
   * Deletes Better Auth's session rows after a committed change. The gate
   * already refuses every one of them; a failure or a leftover is audited.
   */
  async function cleanUp(actor: SecurityAuditActor, userId: string, clientAddress: string | null): Promise<void> {
    let remaining: number | null;
    try {
      remaining = (await sessions.revokeAllSessions(userId)).remaining;
    } catch (error) {
      deps.onCleanupError?.(error instanceof Error ? error.name : 'UnknownError');
      remaining = null;
    }
    if (remaining === 0) return;
    await audit.record(
      event('admin_account_session_cleanup_incomplete', 'failure', actor, clientAddress, {
        targetUserId: userId,
        revokedSessionCount: remaining,
        reason: remaining === null ? 'cleanup_failed' : 'sessions_remaining',
      }),
    );
  }

  /** Runs one Owner-checked, audited change; a refusal becomes an audited result. */
  async function change(
    actor: SecurityAuditActor,
    userId: string,
    clientAddress: string | null,
    work: (client: PoolClient, target: TargetRow) => Promise<void>,
    after: 'cleanup' | 'none',
  ): Promise<AccountResult> {
    let account: AccountDetail;
    try {
      account = await transaction(async (client) => {
        await requireOwner(client, actor);
        const target = await lockTarget(client, actor, userId);
        await work(client, target);
        return (await loadDetail(client, userId))!;
      });
    } catch (error) {
      if (error instanceof Refusal) return refused(actor, clientAddress, error);
      throw error;
    }
    if (after === 'cleanup') {
      await cleanUp(actor, userId, clientAddress);
      account = (await loadDetail(pool, userId)) ?? account;
    }
    return { ok: true, account };
  }

  function statusChange(action: 'disabled' | 'enabled') {
    return async (actor: SecurityAuditActor, userId: string, rawReason: unknown, clientAddress: string | null) => {
      const reason = parseStatusChangeReason(rawReason);
      return change(
        actor,
        userId,
        clientAddress,
        async (client, target) => {
          if (reason === null) throw new Refusal('invalid_reason', target.user_id);
          if (action === 'disabled' && target.status !== 'active') throw new Refusal('account_not_active', target.user_id);
          if (action === 'enabled' && (target.status !== 'disabled' || target.mfa_completed_at === null)) {
            throw new Refusal('account_not_disabled', target.user_id);
          }
          const revoked = action === 'disabled' ? (await activeSessions(client, target.user_id)).length : null;
          await stampRevocation(client, target.user_id, action === 'disabled' ? 'disabled' : 'active');
          const changeId = await recordChange(client, actor, target.user_id, action, reason);
          await audit.record(
            event(action === 'disabled' ? 'admin_account_disabled' : 'admin_account_enabled', 'success', actor, clientAddress, {
              targetUserId: target.user_id,
              accountChangeId: changeId,
              revokedSessionCount: revoked,
            }),
            client,
          );
        },
        // Only a disable needs Better Auth's rows deleted. After a re-enable every
        // earlier session is already refused by the stamp, and a cleanup could
        // delete a session the Admin legitimately began a moment later.
        action === 'disabled' ? 'cleanup' : 'none',
      );
    };
  }

  return {
    async list(actor) {
      try {
        await requireOwner(pool, actor);
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        await refused(actor, null, error);
        return { ok: false, error: 'forbidden' };
      }

      const accounts = await pool.query<{
        user_id: string;
        status: TargetRow['status'];
        name: string;
        email: string;
        invitation_id: string | null;
      }>(
        `SELECT p.user_id, p.status, u.name, u.email, latest.id AS invitation_id
           FROM dromex_principal p
           JOIN "user" u ON u.id = p.user_id
           LEFT JOIN (${LATEST_INVITATIONS}) latest ON latest.email = lower(u.email)
          WHERE NOT p.is_owner
          ORDER BY u.name, u.email
          LIMIT $1`,
        [ADMIN_ACCOUNT_POLICY.listLimit],
      );
      const invitations = await pool.query<InvitationRow & { has_identity: boolean; has_principal: boolean }>(
        `SELECT latest.*,
                EXISTS (SELECT 1 FROM "user" u WHERE lower(u.email) = latest.email) AS has_identity,
                EXISTS (SELECT 1 FROM "user" u JOIN dromex_principal p ON p.user_id = u.id
                         WHERE lower(u.email) = latest.email) AS has_principal
           FROM (${LATEST_INVITATIONS}) latest
          ORDER BY latest.created_at DESC, latest.id DESC
          LIMIT $1`,
        [ADMIN_ACCOUNT_POLICY.listLimit],
      );
      const byId = new Map(invitations.rows.map((row) => [row.id, row]));

      const summaries: AccountSummary[] = [];
      for (const row of accounts.rows) {
        const invitation = row.invitation_id === null ? null : (byId.get(row.invitation_id) ?? null);
        summaries.push({
          userId: row.user_id,
          name: row.name,
          email: row.email,
          state: stateOf(row.status, invitation),
          activeSessions: row.status === 'active' ? (await activeSessions(pool, row.user_id)).length : null,
          invitation: invitation === null ? null : snapshot(invitation),
        });
      }

      const entries: InvitationEntry[] = [];
      for (const row of invitations.rows) {
        if (row.has_principal) continue;
        const effective = effectiveStatus(row);
        // A superseded or accepted newest invitation cannot exist without an account; nothing to show.
        if (effective !== 'pending' && effective !== 'expired' && effective !== 'cancelled') continue;
        entries.push({
          invitationId: row.id,
          email: row.email,
          state:
            effective === 'pending'
              ? row.has_identity
                ? 'enrolment_in_progress'
                : 'invitation_pending'
              : effective === 'expired'
                ? 'invitation_expired'
                : 'invitation_cancelled',
          createdAt: row.created_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          endedAt: row.ended_at === null ? null : row.ended_at.toISOString(),
          delivery: { status: row.delivery_status, reason: row.delivery_reason },
        });
      }
      return { ok: true, accounts: summaries, invitations: entries };
    },

    async detail(actor, userId) {
      try {
        await requireOwner(pool, actor);
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        return refused(actor, null, error);
      }
      if (!USER_ID.test(userId)) return { ok: false, error: 'not_found' };
      const account = await loadDetail(pool, userId);
      return account === null ? { ok: false, error: 'not_found' } : { ok: true, account };
    },

    disable: statusChange('disabled'),
    enable: statusChange('enabled'),

    async revokeAllSessions(actor, userId, clientAddress) {
      return change(
        actor,
        userId,
        clientAddress,
        async (client, target) => {
          if (target.status === 'pending') throw new Refusal('account_not_active', target.user_id);
          const revoked = (await activeSessions(client, target.user_id)).length;
          await stampRevocation(client, target.user_id, target.status);
          await audit.record(
            event('admin_account_sessions_revoked', 'success', actor, clientAddress, {
              targetUserId: target.user_id,
              revokedSessionCount: revoked,
            }),
            client,
          );
        },
        'cleanup',
      );
    },

    async revokeSession(actor, userId, sessionRef, clientAddress) {
      return change(
        actor,
        userId,
        clientAddress,
        async (client, target) => {
          if (target.status !== 'active') throw new Refusal('account_not_active', target.user_id);
          const session = SESSION_REF.test(sessionRef)
            ? (await activeSessions(client, target.user_id)).find((candidate) => sessionRefOf(candidate.id) === sessionRef)
            : undefined;
          if (session === undefined) throw new Refusal('session_not_found', target.user_id);
          // Deleted while the account is locked; audited only once it happened.
          if (!(await sessions.revokeSession(target.user_id, session.id))) {
            throw new Refusal('session_not_found', target.user_id);
          }
          await audit.record(
            event('admin_account_session_revoked', 'success', actor, clientAddress, {
              targetUserId: target.user_id,
              revokedSessionCount: 1,
            }),
            client,
          );
        },
        'none',
      );
    },
  };
}
