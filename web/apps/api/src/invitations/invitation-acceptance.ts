import type { Pool, PoolClient } from 'pg';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type AuthSettings } from '../auth/config.ts';
import { createRateLimitStorage, type RateLimitRule } from '../auth/rate-limit-storage.ts';
import { RECOVERY_CODE_COUNT } from '../auth/recovery-codes.ts';
import { securityEvent, type SecurityAudit, type SecurityAuditActor, type SecurityAuditEventType } from '../auth/security-audit.ts';
import { createTotpReplayGuard } from '../auth/totp-replay.ts';
import { createEnrolmentIdentity, type EnrolmentIdentityPort } from './enrolment-identity.ts';
import { stepsLeadingTo, type EnrolmentStep } from './enrolment-state.ts';
import { hashInvitationToken, isWellFormedInvitationToken } from './invitation-token.ts';

/**
 * Restricted Admin invitation acceptance (DEC-440 (7)-(9), DEC-442, DEC-444).
 *
 * The workflow, as the browser drives it:
 *
 * 1. `inspect`     the token (from the link fragment, sent in a POST body) is
 *                  hashed and looked up. The answer is only whether a new
 *                  password is needed or an existing one must be proven.
 * 2. `setPassword` a new invitee creates the identity (a `pending` principal)
 *                  with a password; a pending identity resuming under a newer
 *                  invitation proves its existing password instead. A
 *                  restricted setup session is bound to the enrolment and TOTP
 *                  enrolment starts, or, when an interrupted setup already
 *                  verified the factor, a TOTP challenge is issued.
 * 3. `verifyTotp`  a code verifies the factor (or passes the challenge), and a
 *                  fresh set of exactly ten recovery codes is shown once.
 * 4. `complete`    after the invitee acknowledges saving the codes, every
 *                  session is revoked and one DROMEX transaction activates the
 *                  principal and consumes the invitation. Ordinary access then
 *                  requires a fresh password-and-TOTP sign-in.
 *
 * **Transaction boundaries, stated honestly.** Better Auth changes identities,
 * factors, codes, and sessions in its own transactions; DROMEX records each
 * step in a separate transaction afterwards. The gaps are closed this way:
 *
 * - The address's enrolment intent is written *before* Better Auth creates the
 *   identity, so an identity created by a run that then stopped is found and
 *   resumed (after password proof), never duplicated. Better Auth's unique
 *   email is the final guard.
 * - A session-level advisory lock per address serialises every state-changing
 *   step, so concurrent attempts are refused (`setup_in_progress`), never
 *   interleaved.
 * - Every DROMEX step re-reads and locks the invitation (expiring it if due),
 *   so a cancelled, superseded, or expired invitation stops the next step
 *   whatever Better Auth already did. Better Auth work already done (a
 *   password, a verified factor) is preserved and resumed through a new
 *   invitation, never undone.
 * - A session never reaches the browser before it is bound to the enrolment,
 *   and the ordinary gate refuses every bound session permanently.
 * - Activation revokes every session first, then commits only if none
 *   remains, the invitation is still valid, the factor is enabled, and the
 *   recovery codes were shown and acknowledged.
 *
 * A crash at any point therefore leaves either nothing, or a `pending`
 * identity that no gate admits, and the next valid invitation resumes it.
 *
 * Nothing here writes a Better Auth-owned row. No token, password, TOTP secret,
 * recovery code, cookie, or session token is logged, stored by DROMEX, or
 * audited; an audit row carries only an invitation reference, the invitee's
 * user id and name snapshot, a reason code, and the client address.
 */

export const ACCEPTANCE_INTERRUPTIONS = [
  'after_intent_recorded',
  'after_identity_created',
  'after_identity_recorded',
  'after_session_bound',
  'after_totp_enabled',
  'after_totp_verified',
  'after_codes_generated',
  'after_sessions_revoked',
] as const;

export type AcceptanceInterruption = (typeof ACCEPTANCE_INTERRUPTIONS)[number];

/** Implementation detail under DEC-440 (10) and DEC-444, all in PostgreSQL. */
export const ACCEPTANCE_RATE_LIMITS = {
  /** Token checks (inspection and password steps) per network source. */
  tokenPerSource: { window: 60, max: 10 },
  /** Password creations and proofs per invitation, from any source. */
  passwordPerInvitation: { window: 900, max: 5 },
  /** TOTP submissions per network source. */
  totpPerSource: { window: 60, max: 10 },
  /** TOTP codes per enrolment. Better Auth does not limit its enrolment path. */
  totpPerEnrolment: { window: 300, max: 5 },
  /** Completion attempts per network source. */
  completePerSource: { window: 60, max: 10 },
} as const satisfies Record<string, RateLimitRule>;

export const INVITEE_NAME_MAX_LENGTH = 100;

export type AcceptanceError =
  | 'invitation_invalid'
  | 'invalid_request'
  | 'invalid_name'
  | 'password_rejected'
  | 'invalid_password'
  | 'invalid_code'
  | 'unauthorized'
  | 'setup_in_progress'
  | 'setup_incomplete';

export type AcceptanceRefusal =
  | { ok: false; error: AcceptanceError }
  | { ok: false; error: 'rate_limited'; retryAfterSeconds: number };

export type InspectResult = { ok: true; next: 'create_password' | 'confirm_password' } | AcceptanceRefusal;

export type PasswordResult =
  | { ok: true; next: 'verify_totp'; totpUri: string; manualEntrySecret: string; setCookies: string[] }
  | { ok: true; next: 'verify_existing_totp'; setCookies: string[] }
  | AcceptanceRefusal;

export type TotpResult = { ok: true; recoveryCodes: string[]; setCookies: string[] } | AcceptanceRefusal;

export type CompleteResult = { ok: true } | AcceptanceRefusal;

export interface InvitationAcceptance {
  inspect(input: { token: unknown }, clientAddress: string): Promise<InspectResult>;
  setPassword(input: { token: unknown; name?: unknown; password: unknown }, clientAddress: string): Promise<PasswordResult>;
  verifyTotp(
    input: { sessionCookie: string | null; challengeCookie: string | null; code: string; token?: unknown; password?: unknown },
    clientAddress: string,
  ): Promise<TotpResult>;
  complete(input: { sessionCookie: string | null; acknowledged: boolean }, clientAddress: string): Promise<CompleteResult>;
}

export interface InvitationAcceptanceDependencies {
  pool: Pool;
  audit: SecurityAudit;
  /** The runtime authentication settings; the internal identity is built from exactly these. */
  settings: AuthSettings;
  /** Test seam: called after each major transition. Production passes nothing. */
  interrupt?: (point: AcceptanceInterruption) => void | Promise<void>;
}

type InvitationEnd = 'invitation_expired' | 'invitation_cancelled' | 'invitation_superseded' | 'invitation_accepted';

interface InvitationRef {
  id: string;
  email: string;
}

interface EnrolmentRow {
  id: string;
  email: string;
  user_id: string | null;
  invitation_id: string;
  step: EnrolmentStep;
}

type Identity =
  | { kind: 'new' }
  | { kind: 'orphan'; userId: string; name: string }
  | { kind: 'pending'; userId: string; name: string }
  | { kind: 'not_eligible' };

const INVALID = { ok: false, error: 'invitation_invalid' } as const;
const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;
const BASE32 = /^[A-Z2-7]+$/;
const CONTROL_CHARACTER = /\p{Cc}/u;

function refuse(error: AcceptanceError): { ok: false; error: AcceptanceError } {
  return { ok: false, error };
}

function limited(retryAfterSeconds: number): AcceptanceRefusal {
  return { ok: false, error: 'rate_limited', retryAfterSeconds: Math.max(1, retryAfterSeconds) };
}

/** Trimmed display name, or null. No address-like or control characters, so an address never becomes an audit name snapshot. */
function inviteeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name.length === 0 || name.length > INVITEE_NAME_MAX_LENGTH || CONTROL_CHARACTER.test(name) || name.includes('@')) return null;
  return name;
}

function isPasswordShaped(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PASSWORD_MAX_LENGTH;
}

function meetsPasswordPolicy(value: unknown): value is string {
  return typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

function isCanonicalCodeSet(codes: unknown): codes is string[] {
  return (
    Array.isArray(codes) &&
    codes.length === RECOVERY_CODE_COUNT &&
    new Set(codes).size === RECOVERY_CODE_COUNT &&
    codes.every((code) => typeof code === 'string' && CANONICAL_CODE.test(code))
  );
}

/** The Base32 secret from an otpauth URI, grouped in fours for manual entry. */
function manualEntrySecretOf(uri: string): string {
  const parsed = new URL(uri);
  const secret = parsed.searchParams.get('secret');
  if (parsed.protocol !== 'otpauth:' || parsed.host !== 'totp' || secret === null || !BASE32.test(secret)) {
    throw new Error('Better Auth returned an unexpected TOTP URI.');
  }
  return secret.match(/.{1,4}/g)!.join('-');
}

export function createInvitationAcceptance(deps: InvitationAcceptanceDependencies): InvitationAcceptance {
  const { pool, audit, settings } = deps;
  if (typeof audit?.record !== 'function') throw new Error('Invitation acceptance requires the security audit.');
  const identity: EnrolmentIdentityPort = createEnrolmentIdentity(settings, pool);
  const limits = createRateLimitStorage(pool);
  const replay = createTotpReplayGuard(pool);
  const interrupt = async (point: AcceptanceInterruption) => {
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

  async function consume(key: string, rule: RateLimitRule): Promise<AcceptanceRefusal | null> {
    const decision = await limits.consume(key, rule);
    return decision.allowed ? null : limited(decision.retryAfter ?? rule.window);
  }

  async function record(
    client: PoolClient | null,
    type: SecurityAuditEventType,
    outcome: 'success' | 'failure',
    actor: SecurityAuditActor | null,
    clientAddress: string,
    invitationId: string | null,
    extra: { reason?: string; revokedSessionCount?: number } = {},
  ): Promise<void> {
    const event = securityEvent(type, outcome, actor, null, clientAddress, { invitationId, ...extra });
    if (client === null) await audit.record(event);
    else await audit.record(event, client);
  }

  /**
   * Serialises every state-changing step for one address across processes.
   * Returns a release function, or null when another step holds the lock.
   */
  async function lockAddress(email: string): Promise<(() => Promise<void>) | null> {
    const client = await pool.connect();
    let locked = false;
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended('dromex_admin_enrolment:' || $1, 0)) AS locked`,
        [email],
      );
      locked = rows[0]?.locked === true;
    } finally {
      if (!locked) client.release();
    }
    if (!locked) return null;
    return async () => {
      let discard = false;
      await client
        .query(`SELECT pg_advisory_unlock(hashtextextended('dromex_admin_enrolment:' || $1, 0))`, [email])
        .catch(() => {
          discard = true;
        });
      // A connection whose unlock failed is destroyed, which releases the lock.
      client.release(discard);
    };
  }

  async function withAddressLock<T>(email: string, work: () => Promise<T>): Promise<T | AcceptanceRefusal> {
    const release = await lockAddress(email);
    if (release === null) return refuse('setup_in_progress');
    try {
      return await work();
    } finally {
      await release();
    }
  }

  /**
   * Locks the invitation as the Owner's operations do (the address advisory
   * lock, then the row), ends it if it is due, and reports whether it is
   * still usable. Refusals are audited in the same transaction.
   */
  async function checkInvitation(
    client: PoolClient,
    invitationId: string,
    actor: SecurityAuditActor | null,
    clientAddress: string,
  ): Promise<InvitationRef | null> {
    const found = await client.query<{ email: string }>(`SELECT email FROM dromex_admin_invitation WHERE id = $1`, [invitationId]);
    const email = found.rows[0]?.email;
    if (email === undefined) return null;
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('dromex_admin_invitation:' || $1, 0))`, [email]);
    const { rows } = await client.query<{ status: string; due: boolean }>(
      `SELECT status, expires_at <= CURRENT_TIMESTAMP AS due FROM dromex_admin_invitation WHERE id = $1 FOR UPDATE`,
      [invitationId],
    );
    const row = rows[0]!;
    let end: InvitationEnd | null = null;
    if (row.status === 'pending' && row.due) {
      await client.query(
        `UPDATE dromex_admin_invitation SET status = 'expired', ended_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'pending'`,
        [invitationId],
      );
      await record(client, 'admin_invitation_expired', 'success', null, clientAddress, invitationId);
      end = 'invitation_expired';
    } else if (row.status !== 'pending') {
      end = `invitation_${row.status}` as InvitationEnd;
    }
    if (end !== null) {
      await record(client, 'admin_invitation_acceptance_refused', 'failure', actor, clientAddress, invitationId, { reason: end });
      return null;
    }
    return { id: invitationId, email };
  }

  /** Runs `work` only while the invitation is valid. A refusal still commits its expiry and audit rows. */
  async function whileValid<T>(
    invitationId: string,
    actor: SecurityAuditActor | null,
    clientAddress: string,
    work: (client: PoolClient, invitation: InvitationRef) => Promise<T>,
  ): Promise<{ valid: true; value: T } | { valid: false }> {
    return transaction(async (client) => {
      const invitation = await checkInvitation(client, invitationId, actor, clientAddress);
      if (invitation === null) return { valid: false as const };
      return { valid: true as const, value: await work(client, invitation) };
    });
  }

  async function classify(client: PoolClient, email: string): Promise<Identity> {
    const { rows } = await client.query<{
      user_id: string | null;
      user_name: string | null;
      principal_status: string | null;
      enrolment_user_id: string | null;
      enrolment_step: EnrolmentStep | null;
    }>(
      `SELECT u.id AS user_id, u.name AS user_name, p.status AS principal_status,
              e.user_id AS enrolment_user_id, e.step AS enrolment_step
         FROM (SELECT $1::text AS email) address
         LEFT JOIN "user" u ON u.email = address.email
         LEFT JOIN dromex_principal p ON p.user_id = u.id
         LEFT JOIN dromex_admin_enrolment e ON e.email = address.email`,
      [email],
    );
    const row = rows[0]!;
    if (row.user_id === null) return { kind: 'new' };
    const name = row.user_name ?? '';
    if (row.principal_status === null && row.enrolment_step === 'identity_pending' && row.enrolment_user_id === null) {
      return { kind: 'orphan', userId: row.user_id, name };
    }
    if (row.principal_status === 'pending' && row.enrolment_user_id === row.user_id && row.enrolment_step !== 'completed') {
      return { kind: 'pending', userId: row.user_id, name };
    }
    return { kind: 'not_eligible' };
  }

  async function invitationForToken(token: unknown): Promise<InvitationRef | null> {
    if (!isWellFormedInvitationToken(token)) return null;
    const { rows } = await pool.query<{ id: string; email: string }>(
      `SELECT id::text, email FROM dromex_admin_invitation WHERE token_hash = $1`,
      [hashInvitationToken(token)],
    );
    return rows[0] ?? null;
  }

  async function lockEnrolment(client: PoolClient, email: string): Promise<EnrolmentRow | undefined> {
    const { rows } = await client.query<EnrolmentRow>(
      `SELECT id::text, email, user_id, invitation_id::text, step FROM dromex_admin_enrolment WHERE email = $1 FOR UPDATE`,
      [email],
    );
    return rows[0];
  }

  /** Moves the enrolment to `to` under `invitationId` only from a step that may lead there. */
  async function advance(client: PoolClient, enrolmentId: string, to: EnrolmentStep, invitationId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE dromex_admin_enrolment
          SET step = $2, invitation_id = $3, updated_at = CURRENT_TIMESTAMP,
              completed_at = CASE WHEN $2 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id = $1 AND step = ANY($4::text[])`,
      [enrolmentId, to, invitationId, stepsLeadingTo(to)],
    );
    return rowCount === 1;
  }

  async function bindSession(client: PoolClient, sessionId: string, enrolmentId: string, invitationId: string): Promise<void> {
    await client.query(
      `INSERT INTO dromex_admin_enrolment_session (session_id, enrolment_id, invitation_id) VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, enrolmentId, invitationId],
    );
  }

  async function revokeQuietly(pair: string | null, others = false): Promise<void> {
    if (pair === null) return;
    await (others ? identity.revokeOtherSessions(pair) : identity.revokeAllSessions(pair)).catch(() => undefined);
  }

  /**
   * The setup session a cookie names: a live Better Auth session bound to an
   * open enrolment under that enrolment's current invitation. Anything else,
   * including an ordinary or an Owner session, is not a setup session.
   */
  async function setupSession(pair: string | null): Promise<{ enrolment: EnrolmentRow; actor: SecurityAuditActor } | null> {
    if (pair === null) return null;
    const session = await identity.session(pair);
    if (session === null) return null;
    const { rows } = await pool.query<EnrolmentRow & { bound_invitation_id: string }>(
      `SELECT e.id::text, e.email, e.user_id, e.invitation_id::text, e.step, s.invitation_id::text AS bound_invitation_id
         FROM dromex_admin_enrolment_session s
         JOIN dromex_admin_enrolment e ON e.id = s.enrolment_id
        WHERE s.session_id = $1`,
      [session.sessionId],
    );
    const row = rows[0];
    if (row === undefined || row.user_id !== session.userId || row.bound_invitation_id !== row.invitation_id || row.step === 'completed') {
      return null;
    }
    const { bound_invitation_id: _bound, ...enrolment } = row;
    return { enrolment, actor: { userId: session.userId, name: session.name } };
  }

  // -------------------------------------------------------------------------
  // Password step
  // -------------------------------------------------------------------------

  async function createIdentity(
    invitation: InvitationRef,
    name: string,
    password: string,
    clientAddress: string,
  ): Promise<{ userId: string; actor: SecurityAuditActor } | AcceptanceRefusal> {
    const intent = await whileValid(invitation.id, null, clientAddress, async (client) => {
      if ((await classify(client, invitation.email)).kind !== 'new') return false;
      const { rowCount } = await client.query(
        `INSERT INTO dromex_admin_enrolment (email, invitation_id, step) VALUES ($1, $2, 'identity_pending')
         ON CONFLICT (email) DO UPDATE SET invitation_id = EXCLUDED.invitation_id, updated_at = CURRENT_TIMESTAMP
          WHERE dromex_admin_enrolment.step = 'identity_pending'`,
        [invitation.email, invitation.id],
      );
      return rowCount === 1;
    });
    if (!intent.valid) return INVALID;
    if (!intent.value) return refuse('setup_in_progress');
    await interrupt('after_intent_recorded');

    const created = await identity.create({ name, email: invitation.email, password });
    if (created === 'rejected') {
      await record(null, 'admin_invitation_acceptance_refused', 'failure', null, clientAddress, invitation.id, { reason: 'identity_rejected' });
      return INVALID;
    }
    await interrupt('after_identity_created');

    const actor = { userId: created.userId, name };
    const attached = await attachIdentity(invitation, actor, clientAddress, 'admin_invitation_identity_created');
    if (attached !== null) return attached;
    await interrupt('after_identity_recorded');
    return { userId: created.userId, actor };
  }

  /** Associates a confirmed identity with a new pending principal, in one transaction. */
  async function attachIdentity(
    invitation: InvitationRef,
    actor: SecurityAuditActor,
    clientAddress: string,
    event: 'admin_invitation_identity_created',
  ): Promise<AcceptanceRefusal | null> {
    const attached = await whileValid(invitation.id, actor, clientAddress, async (client) => {
      // With autoSignIn off, Better Auth answers a duplicate address with a
      // synthetic user. Only a real row with this id and address counts.
      const confirmed = await client.query(`SELECT 1 FROM "user" WHERE id = $1 AND email = $2`, [actor.userId, invitation.email]);
      const enrolment = await lockEnrolment(client, invitation.email);
      if (confirmed.rows.length !== 1 || enrolment === undefined || enrolment.step !== 'identity_pending') return false;
      await client.query(`INSERT INTO dromex_principal (user_id, status, is_owner) VALUES ($1, 'pending', FALSE)`, [actor.userId]);
      const { rowCount } = await client.query(
        `UPDATE dromex_admin_enrolment
            SET user_id = $2, step = 'password_verified', invitation_id = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND step = 'identity_pending'`,
        [enrolment.id, actor.userId, invitation.id],
      );
      if (rowCount !== 1) throw new Error('The enrolment could not record its identity.');
      await record(client, event, 'success', actor, clientAddress, invitation.id);
      return true;
    });
    if (!attached.valid) return INVALID;
    if (!attached.value) {
      await record(null, 'admin_invitation_acceptance_refused', 'failure', actor, clientAddress, invitation.id, { reason: 'not_eligible' });
      return INVALID;
    }
    return null;
  }

  async function passwordStep(
    invitation: InvitationRef,
    input: { name?: unknown; password: unknown },
    clientAddress: string,
  ): Promise<PasswordResult> {
    const classified = await whileValid(invitation.id, null, clientAddress, (client) => classify(client, invitation.email));
    if (!classified.valid) return INVALID;
    const found = classified.value;

    if (found.kind === 'not_eligible') {
      await record(null, 'admin_invitation_acceptance_refused', 'failure', null, clientAddress, invitation.id, { reason: 'not_eligible' });
      return INVALID;
    }

    let userId: string;
    let actor: SecurityAuditActor;
    let resumed = false;

    if (found.kind === 'new') {
      const name = inviteeName(input.name);
      if (name === null) return refuse('invalid_name');
      if (!meetsPasswordPolicy(input.password)) return refuse('password_rejected');
      const limit = await consume(`invitation-password|${invitation.id}`, ACCEPTANCE_RATE_LIMITS.passwordPerInvitation);
      if (limit !== null) return limit;
      const created = await createIdentity(invitation, name, input.password, clientAddress);
      if ('ok' in created) return created;
      ({ userId, actor } = created);
    } else {
      // A pending or unrecorded identity: the password must be proven. A new
      // invitation never authorizes replacing it (DEC-444 (2)).
      if (!isPasswordShaped(input.password)) return refuse('invalid_password');
      const limit = await consume(`invitation-password|${invitation.id}`, ACCEPTANCE_RATE_LIMITS.passwordPerInvitation);
      if (limit !== null) return limit;
      userId = found.userId;
      actor = { userId, name: found.name };
      resumed = found.kind === 'pending';
    }

    const password = input.password as string;
    const signedIn = await identity.signIn({ email: invitation.email, password, userId });
    if (signedIn.kind === 'invalid') {
      await record(null, 'admin_invitation_password_rejected', 'failure', actor, clientAddress, invitation.id, { reason: 'invalid_password' });
      return refuse('invalid_password');
    }

    if (found.kind === 'orphan') {
      // An identity that never had a session cannot have a verified factor.
      if (signedIn.kind !== 'session') return INVALID;
      const attached = await attachIdentity(invitation, actor, clientAddress, 'admin_invitation_identity_created');
      if (attached !== null) {
        await revokeQuietly(signedIn.pair);
        return attached;
      }
      await interrupt('after_identity_recorded');
    }

    if (signedIn.kind === 'challenge') {
      const challenged = await whileValid(invitation.id, actor, clientAddress, async (client) => {
        const enrolment = await lockEnrolment(client, invitation.email);
        if (enrolment === undefined || enrolment.user_id !== userId) return false;
        if (!(await advance(client, enrolment.id, 'factor_challenge', invitation.id))) return false;
        await record(client, 'admin_invitation_identity_resumed', 'success', actor, clientAddress, invitation.id);
        return true;
      });
      if (!challenged.valid) return INVALID;
      if (!challenged.value) {
        await record(null, 'admin_invitation_acceptance_refused', 'failure', actor, clientAddress, invitation.id, { reason: 'invalid_state' });
        return INVALID;
      }
      return { ok: true, next: 'verify_existing_totp', setCookies: signedIn.setCookies };
    }

    // An enrolment session. No older setup session survives a new password step.
    const session = await identity.session(signedIn.pair);
    if (session === null || session.userId !== userId) {
      await revokeQuietly(signedIn.pair);
      throw new Error('The enrolment session could not be resolved.');
    }
    await identity.revokeOtherSessions(signedIn.pair);

    const bound = await whileValid(invitation.id, actor, clientAddress, async (client) => {
      const enrolment = await lockEnrolment(client, invitation.email);
      if (enrolment === undefined || enrolment.user_id !== userId) return null;
      if (!(await advance(client, enrolment.id, 'password_verified', invitation.id))) return null;
      await bindSession(client, session.sessionId, enrolment.id, invitation.id);
      if (resumed) await record(client, 'admin_invitation_identity_resumed', 'success', actor, clientAddress, invitation.id);
      return enrolment.id;
    });
    if (!bound.valid || bound.value === null) {
      await revokeQuietly(signedIn.pair);
      if (bound.valid) {
        await record(null, 'admin_invitation_acceptance_refused', 'failure', actor, clientAddress, invitation.id, { reason: 'invalid_state' });
      }
      return INVALID;
    }
    const enrolmentId = bound.value;
    await interrupt('after_session_bound');

    const enabled = await identity.enableTotp({ pair: signedIn.pair, password });
    if (enabled === 'invalid_password') {
      await revokeQuietly(signedIn.pair);
      return refuse('invalid_password');
    }
    const manualEntrySecret = manualEntrySecretOf(enabled.totpUri);
    await interrupt('after_totp_enabled');

    const started = await whileValid(invitation.id, actor, clientAddress, async (client) => {
      if (!(await advance(client, enrolmentId, 'totp_enrolling', invitation.id))) return false;
      await record(client, 'admin_invitation_totp_enrolment_started', 'success', actor, clientAddress, invitation.id);
      return true;
    });
    if (!started.valid || !started.value) {
      await revokeQuietly(signedIn.pair);
      return INVALID;
    }

    return { ok: true, next: 'verify_totp', totpUri: enabled.totpUri, manualEntrySecret, setCookies: signedIn.setCookies };
  }

  // -------------------------------------------------------------------------
  // TOTP step
  // -------------------------------------------------------------------------

  async function issueCodes(
    enrolment: EnrolmentRow,
    actor: SecurityAuditActor,
    from: 'totp_enrolling' | 'factor_challenge',
    sessionPair: string,
    sessionId: string,
    codes: () => Promise<string[] | 'invalid_password'>,
    clientAddress: string,
  ): Promise<TotpResult | { codes: string[] }> {
    const bound = await whileValid(enrolment.invitation_id, actor, clientAddress, async (client) => {
      const current = await lockEnrolment(client, enrolment.email);
      if (current === undefined || current.id !== enrolment.id || current.step !== from || current.invitation_id !== enrolment.invitation_id) {
        return false;
      }
      await bindSession(client, sessionId, enrolment.id, enrolment.invitation_id);
      await record(client, 'admin_invitation_totp_verified', 'success', actor, clientAddress, enrolment.invitation_id);
      return true;
    });
    if (!bound.valid || !bound.value) {
      await revokeQuietly(sessionPair);
      return bound.valid ? refuse('unauthorized') : INVALID;
    }
    // Setup sessions from older attempts never survive a verified factor.
    await identity.revokeOtherSessions(sessionPair);

    const issued = await codes();
    if (issued === 'invalid_password') {
      await revokeQuietly(sessionPair);
      await record(null, 'admin_invitation_password_rejected', 'failure', actor, clientAddress, enrolment.invitation_id, { reason: 'invalid_password' });
      return refuse('invalid_password');
    }
    if (!isCanonicalCodeSet(issued)) {
      await revokeQuietly(sessionPair);
      throw new Error('Better Auth returned an unexpected recovery-code set.');
    }
    await interrupt('after_codes_generated');

    const recorded = await whileValid(enrolment.invitation_id, actor, clientAddress, async (client) => {
      if (!(await advance(client, enrolment.id, 'codes_issued', enrolment.invitation_id))) return false;
      await record(client, 'admin_invitation_recovery_codes_issued', 'success', actor, clientAddress, enrolment.invitation_id);
      return true;
    });
    if (!recorded.valid || !recorded.value) {
      await revokeQuietly(sessionPair);
      return recorded.valid ? refuse('unauthorized') : INVALID;
    }
    return { codes: issued };
  }

  async function verifyEnrolmentCode(sessionCookie: string, code: string, clientAddress: string): Promise<TotpResult> {
    const setup = await setupSession(sessionCookie);
    if (setup === null) return refuse('unauthorized');
    const { enrolment, actor } = setup;

    const outcome = await withAddressLock(enrolment.email, async (): Promise<TotpResult> => {
      const state = await whileValid(enrolment.invitation_id, actor, clientAddress, async (client) => (await lockEnrolment(client, enrolment.email))?.step);
      if (!state.valid) {
        await revokeQuietly(sessionCookie);
        return INVALID;
      }
      if (state.value !== 'totp_enrolling') return refuse('setup_incomplete');

      const limit = await consume(`invitation-totp|${enrolment.id}`, ACCEPTANCE_RATE_LIMITS.totpPerEnrolment);
      if (limit !== null) return limit;

      const verified = await identity.verifyTotp({ pair: sessionCookie, code });
      if (verified.kind === 'invalid' || verified.kind === 'locked') {
        await record(null, 'admin_invitation_totp_rejected', 'failure', actor, clientAddress, enrolment.invitation_id, { reason: 'invalid_code' });
        return refuse('invalid_code');
      }
      if (verified.kind === 'refused' || verified.userId !== actor.userId) {
        await revokeQuietly(sessionCookie);
        return INVALID;
      }
      await interrupt('after_totp_verified');

      if ((await replay.record(actor.userId, code)) !== 'accepted') {
        await revokeQuietly(verified.pair);
        return refuse('invalid_code');
      }
      const session = await identity.session(verified.pair);
      if (session === null || session.userId !== actor.userId) {
        await revokeQuietly(verified.pair);
        throw new Error('The verified session could not be resolved.');
      }

      const issued = await issueCodes(
        enrolment,
        actor,
        'totp_enrolling',
        verified.pair,
        session.sessionId,
        () => identity.viewRecoveryCodes(actor.userId),
        clientAddress,
      );
      return 'codes' in issued ? { ok: true, recoveryCodes: issued.codes, setCookies: verified.setCookies } : issued;
    });
    return outcome;
  }

  /**
   * The existing-factor path. Better Auth's challenge cookie names the
   * identity only to Better Auth, so this step carries the invitation token
   * again (the page holds it in memory). That lets DROMEX re-check and audit
   * the invitation, and count the attempt against the enrolment, **before**
   * Better Auth verifies anything.
   */
  async function verifyExistingFactor(
    token: unknown,
    challengeCookie: string,
    code: string,
    password: unknown,
    clientAddress: string,
  ): Promise<TotpResult> {
    if (!isPasswordShaped(password)) return refuse('invalid_request');
    const invitation = await invitationForToken(token);
    if (invitation === null) return INVALID;

    return withAddressLock(invitation.email, async (): Promise<TotpResult> => {
      const state = await whileValid(invitation.id, null, clientAddress, (client) => lockEnrolment(client, invitation.email));
      if (!state.valid) return INVALID;
      const enrolment = state.value;
      if (enrolment === undefined || enrolment.user_id === null || enrolment.invitation_id !== invitation.id) {
        // Before Better Auth sees anything. Bounded by the per-source TOTP limit, as inspection is.
        await record(null, 'admin_invitation_acceptance_refused', 'failure', null, clientAddress, invitation.id, { reason: 'not_eligible' });
        return refuse('unauthorized');
      }
      if (enrolment.step !== 'factor_challenge') return refuse('setup_incomplete');

      const limit = await consume(`invitation-totp|${enrolment.id}`, ACCEPTANCE_RATE_LIMITS.totpPerEnrolment);
      if (limit !== null) return limit;

      const name = await pool.query<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [enrolment.user_id]);
      const actor = { userId: enrolment.user_id, name: name.rows[0]?.name ?? '' };

      const verified = await identity.verifyTotp({ pair: challengeCookie, code });
      if (verified.kind === 'invalid' || verified.kind === 'locked') {
        await record(null, 'admin_invitation_totp_rejected', 'failure', actor, clientAddress, invitation.id, { reason: 'invalid_code' });
        return refuse('invalid_code');
      }
      // The session hook refuses an identity this setup is not enrolling.
      if (verified.kind === 'refused') return INVALID;
      const session = await identity.session(verified.pair);
      if (session === null || verified.userId !== actor.userId || session.userId !== actor.userId) {
        await revokeQuietly(verified.pair);
        return refuse('unauthorized');
      }
      await interrupt('after_totp_verified');

      if ((await replay.record(actor.userId, code)) !== 'accepted') {
        await revokeQuietly(verified.pair);
        return refuse('invalid_code');
      }
      const issued = await issueCodes(
        enrolment,
        actor,
        'factor_challenge',
        verified.pair,
        session.sessionId,
        () => identity.regenerateRecoveryCodes({ pair: verified.pair, password }),
        clientAddress,
      );
      return 'codes' in issued ? { ok: true, recoveryCodes: issued.codes, setCookies: verified.setCookies } : issued;
    });
  }

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  async function activate(sessionCookie: string, clientAddress: string): Promise<CompleteResult> {
    const setup = await setupSession(sessionCookie);
    if (setup === null) return refuse('unauthorized');
    const { enrolment, actor } = setup;

    return withAddressLock(enrolment.email, async (): Promise<CompleteResult> => {
      const ready = await whileValid(enrolment.invitation_id, actor, clientAddress, async (client) => {
        const current = await lockEnrolment(client, enrolment.email);
        const { rows } = await client.query<{ status: string; enabled: boolean | null }>(
          `SELECT p.status, u."twoFactorEnabled" AS enabled
             FROM dromex_principal p JOIN "user" u ON u.id = p.user_id WHERE p.user_id = $1`,
          [actor.userId],
        );
        return (
          current?.step === 'codes_issued' &&
          current.invitation_id === enrolment.invitation_id &&
          rows[0]?.status === 'pending' &&
          rows[0].enabled === true
        );
      });
      if (!ready.valid) {
        await revokeQuietly(sessionCookie);
        return INVALID;
      }
      if (!ready.value) return refuse('setup_incomplete');

      const { rows: counted } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [actor.userId]);
      const revokedSessionCount = counted[0]?.n ?? 0;
      // Every session ends before activation; ordinary access requires a fresh sign-in.
      await identity.revokeAllSessions(sessionCookie);
      await interrupt('after_sessions_revoked');

      const activated = await whileValid(enrolment.invitation_id, actor, clientAddress, async (client) => {
        const current = await lockEnrolment(client, enrolment.email);
        if (current?.step !== 'codes_issued' || current.invitation_id !== enrolment.invitation_id || current.user_id !== actor.userId) {
          return 'setup_incomplete' as const;
        }
        const principal = await client.query<{ status: string }>(
          `SELECT status FROM dromex_principal WHERE user_id = $1 FOR UPDATE`,
          [actor.userId],
        );
        const factor = await client.query<{ enabled: boolean | null }>(`SELECT "twoFactorEnabled" AS enabled FROM "user" WHERE id = $1`, [actor.userId]);
        if (principal.rows[0]?.status !== 'pending' || factor.rows[0]?.enabled !== true) return 'setup_incomplete' as const;
        const remaining = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [actor.userId]);
        if (remaining.rows[0]?.n !== 0) return 'setup_in_progress' as const;

        await client.query(
          `UPDATE dromex_principal SET status = 'active', mfa_completed_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE user_id = $1 AND status = 'pending'`,
          [actor.userId],
        );
        const consumed = await client.query(
          `UPDATE dromex_admin_invitation SET status = 'accepted', ended_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'pending'`,
          [enrolment.invitation_id],
        );
        if (consumed.rowCount !== 1 || !(await advance(client, enrolment.id, 'completed', enrolment.invitation_id))) {
          throw new Error('The invitation could not be consumed.');
        }
        await record(client, 'admin_invitation_sessions_revoked', 'success', actor, clientAddress, enrolment.invitation_id, { revokedSessionCount });
        await record(client, 'admin_invitation_accepted', 'success', actor, clientAddress, enrolment.invitation_id);
        return 'activated' as const;
      });
      if (!activated.valid) return INVALID;
      return activated.value === 'activated' ? { ok: true } : refuse(activated.value);
    });
  }

  return {
    async inspect({ token }, clientAddress) {
      const limit = await consume(`invitation-token|${clientAddress}`, ACCEPTANCE_RATE_LIMITS.tokenPerSource);
      if (limit !== null) return limit;
      const invitation = await invitationForToken(token);
      if (invitation === null) return INVALID;

      const classified = await whileValid(invitation.id, null, clientAddress, (client) => classify(client, invitation.email));
      if (!classified.valid) return INVALID;
      if (classified.value.kind === 'not_eligible') {
        await record(null, 'admin_invitation_acceptance_refused', 'failure', null, clientAddress, invitation.id, { reason: 'not_eligible' });
        return INVALID;
      }
      return { ok: true, next: classified.value.kind === 'new' ? 'create_password' : 'confirm_password' };
    },

    async setPassword(input, clientAddress) {
      const limit = await consume(`invitation-token|${clientAddress}`, ACCEPTANCE_RATE_LIMITS.tokenPerSource);
      if (limit !== null) return limit;
      const invitation = await invitationForToken(input.token);
      if (invitation === null) return INVALID;
      return withAddressLock(invitation.email, () => passwordStep(invitation, input, clientAddress));
    },

    async verifyTotp({ sessionCookie, challengeCookie, code, token, password }, clientAddress) {
      const limit = await consume(`invitation-totp|${clientAddress}`, ACCEPTANCE_RATE_LIMITS.totpPerSource);
      if (limit !== null) return limit;
      if (challengeCookie !== null && token !== undefined) {
        return verifyExistingFactor(token, challengeCookie, code, password, clientAddress);
      }
      if (sessionCookie === null) return refuse('unauthorized');
      return verifyEnrolmentCode(sessionCookie, code, clientAddress);
    },

    async complete({ sessionCookie, acknowledged }, clientAddress) {
      const limit = await consume(`invitation-complete|${clientAddress}`, ACCEPTANCE_RATE_LIMITS.completePerSource);
      if (limit !== null) return limit;
      if (sessionCookie === null) return refuse('unauthorized');
      if (acknowledged !== true) return refuse('invalid_request');
      return activate(sessionCookie, clientAddress);
    },
  };
}
