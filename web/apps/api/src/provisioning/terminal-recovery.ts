import type { Pool, PoolClient } from 'pg';

import { PASSWORD_MAX_LENGTH } from '../auth/config.ts';
import { RECOVERY_CODE_COUNT } from '../auth/recovery-codes.ts';
import {
  createSecurityAudit,
  securityEvent,
  type SecurityAudit,
  type SecurityAuditActor,
  type SecurityAuditEvent,
  type SecurityAuditEventType,
  type SecurityAuditOutcome,
} from '../auth/security-audit.ts';
import { createTotpReplayGuard, type TotpReplayGuard } from '../auth/totp-replay.ts';
import { loadDromexMigrations } from '../db/dromex-migrations.ts';
import { OwnerProvisioningError } from './errors.ts';
import {
  FactorResetRefused,
  checkBetterAuthCompatibility,
  installedBetterAuthVersion,
  readFactorSnapshot,
  resetOwnerFactor,
} from './owner-mfa-reset.ts';
import { AUTHENTICATOR_ACKNOWLEDGEMENT, RECOVERY_CODE_ACKNOWLEDGEMENT } from './terminal-prompt.ts';
import { TerminalRecoveryError } from './terminal-recovery-errors.ts';
import type { RecoverySignIn, TerminalRecoveryIdentityPort } from './terminal-recovery-identity.ts';

/**
 * Terminal emergency Owner recovery (DEC-437), for an existing Owner who knows
 * the current password but cannot complete MFA.
 *
 * This is break-glass tooling, not password reset: nothing here proceeds
 * without the current password, verified by Better Auth. It runs only from a
 * local interactive terminal with injected dependencies; there is no HTTP
 * surface. One run, holding a PostgreSQL advisory lock for its whole life:
 *
 * 1. Refuses unless Better Auth is the verified version and schema, the DROMEX
 *    ledger is complete, exactly one active Owner exists, and recent password
 *    rejections are under the throttle. Clears and audits any stale run.
 * 2. Asks the operator to type the Owner's email, then the password, once.
 *    Nothing changes before the password is verified.
 * 3. In one transaction: ends any open web recovery, clears
 *    `mfa_completed_at`, and records the run. From here until the checked
 *    completion transaction, ordinary business access is refused.
 * 4. Takes exactly one path:
 *    - supported replacement, when Better Auth reports no enabled factor or
 *      the operator proves the existing authenticator;
 *    - supported retrieval of one stored code, shown once, for web recovery;
 *    - the DEC-437 reset (`owner-mfa-reset.ts`) only when neither can work,
 *      followed immediately by supported replacement.
 * 5. Replacement disables any old factor, enrols a new one, verifies a code
 *    from it with replay protection, issues ten new codes shown once, revokes
 *    every Owner session, and then completes in one transaction that refuses
 *    unless no session remains and the new factor is verified.
 *
 * Every session the run obtains is recorded so the ordinary gate refuses it
 * permanently. A failure or cancellation after step 3 restores nothing: the
 * run ends as failed or abandoned, its live session is revoked, business
 * access stays blocked, and the command can simply be run again.
 */

/** Distinct from the migrator's and the provisioning command's keys. */
export const OWNER_TERMINAL_RECOVERY_LOCK_KEY = 4_173_967_203;

export const TERMINAL_RECOVERY_TOTP_MAX_ATTEMPTS = 5;
export const PASSWORD_REJECTION_LIMIT = 5;
export const PASSWORD_REJECTION_WINDOW_SECONDS = 900;

/** Typed answers the operator must give exactly. */
export const AUTHENTICATOR_AVAILABLE = 'AUTHENTICATOR AVAILABLE';
export const NO_AUTHENTICATOR_AVAILABLE = 'NO AUTHENTICATOR AVAILABLE';
export const SHOW_ONE_CODE = 'SHOW ONE CODE';
export const RESET_CONFIRMATION = 'RESET OWNER MFA';

const INCIDENT_REFERENCE = /^INC-[0-9]{8}-[0-9]{2}$/;
const SIX_DIGITS = /^\d{6}$/;
const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;
const BASE32 = /^[A-Z2-7]+$/;
const UNIQUE_VIOLATION = '23505';

/** The operator's terminal. It displays and reads; every decision is made here. */
export interface OwnerRecoveryTerminal {
  presentTarget(target: { maskedEmail: string; environment: string }): Promise<void>;
  readOwnerEmail(): Promise<string>;
  readPassword(): Promise<string>;
  readAuthenticatorAvailability(): Promise<string>;
  readTotpCode(input: { attempt: number; maxAttempts: number; authenticator: 'existing' | 'new' }): Promise<string>;
  readRetrievalConfirmation(): Promise<string>;
  /** Shows the one retrieved code, once. */
  presentRetrievedCode(code: string): Promise<void>;
  presentResetWarning(): Promise<void>;
  readResetConfirmation(): Promise<string>;
  readIncidentReference(): Promise<string>;
  /** Shows the new secret for manual entry and the otpauth URI, once. */
  presentEnrollment(material: { secret: string; uri: string }): Promise<void>;
  readAuthenticatorAcknowledgement(): Promise<string>;
  /** Shows the new recovery codes, once. */
  presentRecoveryCodes(codes: readonly string[]): Promise<void>;
  readRecoveryCodeAcknowledgement(): Promise<string>;
  clearScreen(): Promise<void>;
}

export interface TerminalRecoveryDependencies {
  /** DROMEX's connections: the lock, the run, the audit, and the replay guard. */
  pool: Pool;
  /** Better Auth, reached only through its documented server API. */
  identity: TerminalRecoveryIdentityPort;
  terminal: OwnerRecoveryTerminal;
  /** Shown to the operator so the target environment is unmistakable. */
  environment: string;
  /** Overrides the installed Better Auth version; for tests of the version pin. */
  betterAuthVersion?: string;
}

export type TerminalRecoveryResult =
  | { status: 'code_retrieved' }
  | { status: 'completed'; path: 'replacement' | 'reset' };

interface Owner {
  userId: string;
  email: string;
  name: string;
}

interface Run {
  deps: TerminalRecoveryDependencies;
  client: PoolClient;
  audit: SecurityAudit;
  replay: TotpReplayGuard;
  owner: Owner;
  actor: SecurityAuditActor;
  password: string;
  runId: string;
  /** The newest Better Auth session this run holds, revoked on any failure. */
  session: string | null;
}

export async function recoverOwnerFromTerminal(deps: TerminalRecoveryDependencies): Promise<TerminalRecoveryResult> {
  const audit = createSecurityAudit(deps.pool);

  let client: PoolClient;
  try {
    client = await deps.pool.connect();
  } catch {
    throw new TerminalRecoveryError('failed');
  }

  let locked = false;
  let discardConnection = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
      OWNER_TERMINAL_RECOVERY_LOCK_KEY,
    ]);
    locked = rows[0]?.locked === true;
    if (!locked) {
      await recordQuietly(audit, event('terminal_recovery_concurrent_refused', 'failure', null));
      throw new TerminalRecoveryError('in_progress');
    }
    return await recoverWhileLocked(deps, client, audit);
  } catch (error) {
    throw toRecoveryError(error);
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [OWNER_TERMINAL_RECOVERY_LOCK_KEY]).catch(() => {
        discardConnection = true;
      });
    }
    // A connection whose unlock failed is destroyed, which releases the lock.
    client.release(discardConnection);
  }
}

/** Only fixed messages leave: every other cause is dropped, since it may carry a secret. */
function toRecoveryError(error: unknown): TerminalRecoveryError {
  if (error instanceof TerminalRecoveryError) return error;
  if (error instanceof OwnerProvisioningError && (error.code === 'cancelled' || error.code === 'not_interactive')) {
    return new TerminalRecoveryError(error.code);
  }
  return new TerminalRecoveryError('failed');
}

function event(
  type: SecurityAuditEventType,
  outcome: SecurityAuditOutcome,
  actor: SecurityAuditActor | null,
  extra: Parameters<typeof securityEvent>[5] = {},
): SecurityAuditEvent {
  return securityEvent(type, outcome, actor, null, null, extra);
}

async function recordQuietly(audit: SecurityAudit, auditEvent: SecurityAuditEvent): Promise<void> {
  await audit.record(auditEvent).catch(() => undefined);
}

async function transaction<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function typed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at <= 0 ? '***' : `${email.slice(0, 1)}***${email.slice(at)}`;
}

async function refuse(
  audit: SecurityAudit,
  actor: SecurityAuditActor | null,
  code: 'not_eligible' | 'version_mismatch' | 'schema_mismatch' | 'throttled' | 'not_confirmed',
): Promise<never> {
  await recordQuietly(audit, event('terminal_recovery_refused', 'failure', actor, { reason: code }));
  throw new TerminalRecoveryError(code);
}

// ---------------------------------------------------------------------------
// Before the password: checks that change nothing but the audit trail
// ---------------------------------------------------------------------------

async function recoverWhileLocked(
  deps: TerminalRecoveryDependencies,
  client: PoolClient,
  audit: SecurityAudit,
): Promise<TerminalRecoveryResult> {
  const compatibility = await checkBetterAuthCompatibility(client, deps.betterAuthVersion ?? installedBetterAuthVersion());
  if (compatibility !== 'compatible') await refuse(audit, null, compatibility);
  if (!(await ledgerIsComplete(client))) await refuse(audit, null, 'schema_mismatch');

  const owner = await singleActiveOwner(client);
  if (owner === null) return refuse(audit, null, 'not_eligible');
  const actor: SecurityAuditActor = { userId: owner.userId, name: owner.name.slice(0, 200) };

  if ((await recentPasswordRejections(client, owner.userId)) >= PASSWORD_REJECTION_LIMIT) {
    await refuse(audit, actor, 'throttled');
  }

  await clearStaleRuns(client, audit, actor);
  await audit.record(event('terminal_recovery_requested', 'success', actor));

  await deps.terminal.presentTarget({ maskedEmail: maskEmail(owner.email), environment: deps.environment });
  if (typed(await deps.terminal.readOwnerEmail()).toLowerCase() !== owner.email) {
    await refuse(audit, actor, 'not_confirmed');
  }

  // One password attempt per run.
  const password = await deps.terminal.readPassword();
  const signedIn: RecoverySignIn =
    typeof password === 'string' && password.length > 0 && password.length <= PASSWORD_MAX_LENGTH
      ? await deps.identity.signIn({ email: owner.email, password, userId: owner.userId })
      : { kind: 'invalid' };
  if (signedIn.kind === 'invalid') {
    await audit.record(event('terminal_password_rejected', 'failure', actor));
    throw new TerminalRecoveryError('verification_failed');
  }

  let runId: string;
  try {
    runId = await beginRun(client, audit, actor);
  } catch (error) {
    if (signedIn.kind === 'session') {
      await deps.identity.revokeAllSessions({ cookie: signedIn.cookie }).catch(() => undefined);
    }
    throw error;
  }

  const run: Run = {
    deps,
    client,
    audit,
    replay: createTotpReplayGuard(deps.pool),
    owner,
    actor,
    password: password as string,
    runId,
    session: signedIn.kind === 'session' ? signedIn.cookie : null,
  };

  try {
    return await recoverVerifiedOwner(run, signedIn);
  } catch (error) {
    await endFailedRun(run, error);
    throw error;
  }
}

async function ledgerIsComplete(client: PoolClient): Promise<boolean> {
  const expected = (await loadDromexMigrations()).map((migration) => migration.id);
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM dromex_migration ORDER BY id`);
  return rows.length === expected.length && rows.every((row, index) => row.id === expected[index]);
}

/** The single active Owner, or null for none, several, or a disabled one. */
async function singleActiveOwner(client: PoolClient): Promise<Owner | null> {
  const { rows } = await client.query<{ user_id: string; status: string; email: string; name: string }>(
    `SELECT p.user_id, p.status, u.email, u.name
       FROM dromex_principal p JOIN "user" u ON u.id = p.user_id
      WHERE p.is_owner
      LIMIT 2`,
  );
  if (rows.length !== 1 || rows[0]!.status !== 'active') return null;
  return { userId: rows[0]!.user_id, email: rows[0]!.email, name: rows[0]!.name };
}

async function recentPasswordRejections(client: PoolClient, userId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM dromex_audit_event
      WHERE event_type = 'terminal_password_rejected' AND actor_user_id = $1
        AND occurred_at > CURRENT_TIMESTAMP - make_interval(secs => $2)`,
    [userId, PASSWORD_REJECTION_WINDOW_SECONDS],
  );
  return rows[0]?.n ?? 0;
}

/** An open run found while this process holds the lock belongs to a process that died. */
async function clearStaleRuns(client: PoolClient, audit: SecurityAudit, actor: SecurityAuditActor): Promise<void> {
  await transaction(client, async () => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE dromex_terminal_recovery
          SET state = 'interrupted', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND ended_at IS NULL
        RETURNING id::text AS id`,
      [actor.userId],
    );
    for (const row of rows) {
      await audit.record(event('terminal_stale_recovery_cleared', 'success', actor, { terminalRecoveryId: row.id }), client);
    }
  });
}

/** The password is proven: end web recovery, block business access, and record the run. */
async function beginRun(client: PoolClient, audit: SecurityAudit, actor: SecurityAuditActor): Promise<string> {
  return transaction(client, async () => {
    const { rows: principals } = await client.query<{ status: string; is_owner: boolean }>(
      `SELECT status, is_owner FROM dromex_principal WHERE user_id = $1 FOR UPDATE`,
      [actor.userId],
    );
    if (principals[0]?.status !== 'active' || principals[0]?.is_owner !== true) {
      throw new TerminalRecoveryError('not_eligible');
    }

    const { rows: superseded } = await client.query<{ id: string }>(
      `UPDATE dromex_owner_recovery SET step = 'abandoned', ended_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND ended_at IS NULL
        RETURNING id::text AS id`,
      [actor.userId],
    );

    await client.query(
      `UPDATE dromex_principal SET mfa_completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [actor.userId],
    );

    let runId: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO dromex_terminal_recovery (user_id, state) VALUES ($1, 'identity_verified') RETURNING id::text AS id`,
        [actor.userId],
      );
      runId = rows[0]!.id;
    } catch (error) {
      if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) throw new TerminalRecoveryError('in_progress');
      throw error;
    }

    for (const row of superseded) {
      await audit.record(
        securityEvent('recovery_abandoned', 'failure', actor, row.id, null, {
          reason: 'terminal_recovery_superseded',
          terminalRecoveryId: runId,
        }),
        client,
      );
    }
    await audit.record(event('terminal_identity_verified', 'success', actor, { terminalRecoveryId: runId }), client);
    return runId;
  });
}

// ---------------------------------------------------------------------------
// After the password: exactly one path
// ---------------------------------------------------------------------------

async function recoverVerifiedOwner(run: Run, signedIn: Exclude<RecoverySignIn, { kind: 'invalid' }>): Promise<TerminalRecoveryResult> {
  if (signedIn.kind === 'session') return replaceAuthenticator(run, 'replacement', signedIn.cookie);

  const availability = typed(await run.deps.terminal.readAuthenticatorAvailability());
  if (availability === AUTHENTICATOR_AVAILABLE) {
    return replaceAuthenticator(run, 'replacement', await verifyExistingAuthenticator(run, signedIn.cookie));
  }
  if (availability !== NO_AUTHENTICATOR_AVAILABLE) throw new TerminalRecoveryError('not_confirmed');

  const snapshot = await readFactorSnapshot(run.client, run.owner.userId);
  const stored = await run.deps.identity.storedCodeState(run.owner.userId);
  if (stored.kind === 'usable') return retrieveOneCode(run);

  // Supported retrieval and replacement are both impossible: DEC-437.
  if (!snapshot.enabled || snapshot.factorRows > 1) throw new TerminalRecoveryError('failed');
  return resetAndReplace(run, snapshot.fingerprint);
}

async function verifyExistingAuthenticator(run: Run, challenge: string): Promise<string> {
  const { terminal, identity } = run.deps;
  for (let attempt = 1; attempt <= TERMINAL_RECOVERY_TOTP_MAX_ATTEMPTS; attempt += 1) {
    const code = typed(await terminal.readTotpCode({ attempt, maxAttempts: TERMINAL_RECOVERY_TOTP_MAX_ATTEMPTS, authenticator: 'existing' }));
    if (!SIX_DIGITS.test(code)) continue;
    // Claimed before Better Auth sees it, so a replayed code is never accepted.
    if ((await run.replay.record(run.owner.userId, code)) === 'replayed') continue;

    const outcome = await identity.verifyTotp({ cookie: challenge, code, userId: run.owner.userId });
    if (outcome.kind === 'locked') throw new TerminalRecoveryError('totp_locked');
    if (outcome.kind === 'verified') {
      run.session = outcome.cookie;
      await denySession(run, outcome.cookie);
      return outcome.cookie;
    }
  }
  throw new TerminalRecoveryError('totp_attempts_exhausted');
}

async function retrieveOneCode(run: Run): Promise<TerminalRecoveryResult> {
  const { terminal, identity } = run.deps;
  if (typed(await terminal.readRetrievalConfirmation()) !== SHOW_ONE_CODE) throw new TerminalRecoveryError('not_confirmed');

  const code = await identity.retrieveOneCode(run.owner.userId);
  if (!CANONICAL_CODE.test(code)) throw new TerminalRecoveryError('failed');

  // Recorded before it is shown; the value itself is never recorded.
  await transaction(run.client, async () => {
    const { rowCount } = await run.client.query(
      `UPDATE dromex_terminal_recovery
          SET state = 'code_retrieved', path = 'retrieval', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND state = 'identity_verified' AND ended_at IS NULL`,
      [run.runId],
    );
    if (rowCount !== 1) throw new TerminalRecoveryError('failed');
    await run.audit.record(
      event('recovery_code_retrieved', 'success', run.actor, { terminalRecoveryId: run.runId }),
      run.client,
    );
  });

  await terminal.presentRetrievedCode(code);
  return { status: 'code_retrieved' };
}

async function resetAndReplace(run: Run, fingerprint: string): Promise<TerminalRecoveryResult> {
  const { terminal, identity } = run.deps;
  await terminal.presentResetWarning();
  if (typed(await terminal.readResetConfirmation()) !== RESET_CONFIRMATION) throw new TerminalRecoveryError('not_confirmed');
  const incident = typed(await terminal.readIncidentReference());
  if (!INCIDENT_REFERENCE.test(incident)) throw new TerminalRecoveryError('not_confirmed');

  try {
    await resetOwnerFactor(run.client, {
      userId: run.owner.userId,
      fingerprint,
      record: async ({ removedFactorRows }) => {
        const { rowCount } = await run.client.query(
          `UPDATE dromex_terminal_recovery
              SET state = 'factor_reset', path = 'reset', incident_reference = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND state = 'identity_verified' AND ended_at IS NULL`,
          [run.runId, incident],
        );
        if (rowCount !== 1) throw new TerminalRecoveryError('failed');
        await run.audit.record(
          event('owner_emergency_mfa_reset', 'success', run.actor, {
            terminalRecoveryId: run.runId,
            incidentReference: incident,
          }),
          run.client,
        );
        await run.audit.record(
          event('terminal_old_factor_removed', 'success', run.actor, {
            terminalRecoveryId: run.runId,
            reason: removedFactorRows > 0 ? 'removed' : 'absent',
          }),
          run.client,
        );
      },
    });
  } catch (error) {
    if (error instanceof FactorResetRefused) {
      throw new TerminalRecoveryError(error.reason === 'factor_changed' ? 'factor_changed' : 'not_eligible');
    }
    throw error;
  }

  // With the factor gone, the password step yields an ordinary session.
  const signedIn = await identity.signIn({ email: run.owner.email, password: run.password, userId: run.owner.userId });
  if (signedIn.kind !== 'session') throw new TerminalRecoveryError('failed');
  run.session = signedIn.cookie;
  return replaceAuthenticator(run, 'reset', signedIn.cookie);
}

// ---------------------------------------------------------------------------
// Supported replacement and completion
// ---------------------------------------------------------------------------

async function replaceAuthenticator(
  run: Run,
  path: 'replacement' | 'reset',
  session: string,
): Promise<TerminalRecoveryResult> {
  const { terminal, identity } = run.deps;
  const { userId } = run.owner;

  await denySession(run, session);
  const factorWasPresent = path === 'reset' ? false : await factorIsPresent(run.client, userId);

  await transaction(run.client, async () => {
    const { rowCount } = await run.client.query(
      `UPDATE dromex_terminal_recovery
          SET state = 'enrolment_started', path = COALESCE(path, 'replacement'), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND state IN ('identity_verified', 'factor_reset') AND ended_at IS NULL`,
      [run.runId],
    );
    if (rowCount !== 1) throw new TerminalRecoveryError('failed');
    await run.audit.record(
      event('terminal_replacement_started', 'success', run.actor, { terminalRecoveryId: run.runId }),
      run.client,
    );
  });

  const enrolment = await identity.disableFactor({ cookie: session, password: run.password });
  run.session = enrolment;
  await denySession(run, enrolment);
  if (path === 'replacement') {
    await run.audit.record(
      event('terminal_old_factor_removed', 'success', run.actor, {
        terminalRecoveryId: run.runId,
        reason: factorWasPresent ? 'removed' : 'absent',
      }),
    );
  }

  await terminal.presentEnrollment(describeEnrollment(await identity.enableTotp({ cookie: enrolment, password: run.password })));
  const verified = await verifyNewAuthenticator(run, enrolment);
  run.session = verified;
  await denySession(run, verified);

  await transaction(run.client, async () => {
    const { rowCount } = await run.client.query(
      `UPDATE dromex_terminal_recovery SET state = 'factor_verified', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND state = 'enrolment_started' AND ended_at IS NULL`,
      [run.runId],
    );
    if (rowCount !== 1) throw new TerminalRecoveryError('failed');
    await run.audit.record(event('terminal_new_totp_verified', 'success', run.actor, { terminalRecoveryId: run.runId }), run.client);
  });

  if (typed(await terminal.readAuthenticatorAcknowledgement()) !== AUTHENTICATOR_ACKNOWLEDGEMENT) {
    throw new TerminalRecoveryError('not_confirmed');
  }

  // Codes exist only once the new authenticator is proven, and each run
  // rotates them, so no set an interrupted run showed stays valid.
  const codes = await identity.regenerateCodes({ cookie: verified, password: run.password });
  if (!isCanonicalCodeSet(codes)) throw new TerminalRecoveryError('failed');
  await run.audit.record(event('terminal_recovery_codes_issued', 'success', run.actor, { terminalRecoveryId: run.runId }));
  await terminal.presentRecoveryCodes(codes);
  if (typed(await terminal.readRecoveryCodeAcknowledgement()) !== RECOVERY_CODE_ACKNOWLEDGEMENT) {
    throw new TerminalRecoveryError('not_confirmed');
  }
  await terminal.clearScreen();

  const before = await sessionCount(run.client, userId);
  await identity.revokeAllSessions({ cookie: verified });
  const after = await sessionCount(run.client, userId);
  await run.audit.record(
    event('terminal_sessions_revoked', after === 0 ? 'success' : 'failure', run.actor, {
      terminalRecoveryId: run.runId,
      revokedSessionCount: Math.max(before - after, 0),
    }),
  );

  await completeRun(run);
  run.session = null;
  return { status: 'completed', path };
}

async function verifyNewAuthenticator(run: Run, enrolment: string): Promise<string> {
  const { terminal, identity } = run.deps;
  const rejected = (reason: string) =>
    run.audit.record(event('terminal_new_totp_rejected', 'failure', run.actor, { terminalRecoveryId: run.runId, reason }));

  for (let attempt = 1; attempt <= TERMINAL_RECOVERY_TOTP_MAX_ATTEMPTS; attempt += 1) {
    const code = typed(await terminal.readTotpCode({ attempt, maxAttempts: TERMINAL_RECOVERY_TOTP_MAX_ATTEMPTS, authenticator: 'new' }));
    if (!SIX_DIGITS.test(code)) {
      await rejected('malformed_code');
      continue;
    }
    // Claimed before Better Auth sees it, so a replayed code never enables the factor.
    if ((await run.replay.record(run.owner.userId, code)) === 'replayed') {
      await rejected('replayed');
      continue;
    }

    const outcome = await identity.verifyTotp({ cookie: enrolment, code, userId: run.owner.userId });
    if (outcome.kind === 'verified') return outcome.cookie;
    if (outcome.kind === 'locked') throw new TerminalRecoveryError('totp_locked');
    await rejected('invalid_code');
  }
  throw new TerminalRecoveryError('totp_attempts_exhausted');
}

/** The only commit that restores business access. */
async function completeRun(run: Run): Promise<void> {
  const { client, owner } = run;
  await transaction(client, async () => {
    const { rows: principals } = await client.query<{ status: string; is_owner: boolean; mfa_completed_at: Date | null }>(
      `SELECT status, is_owner, mfa_completed_at FROM dromex_principal WHERE user_id = $1 FOR UPDATE`,
      [owner.userId],
    );
    const principal = principals[0];
    if (principal?.status !== 'active' || principal.is_owner !== true || principal.mfa_completed_at !== null) {
      throw new TerminalRecoveryError('failed');
    }

    const { rows: runs } = await client.query<{ state: string }>(
      `SELECT state FROM dromex_terminal_recovery WHERE id = $1 AND ended_at IS NULL FOR UPDATE`,
      [run.runId],
    );
    if (runs[0]?.state !== 'factor_verified') throw new TerminalRecoveryError('failed');

    if ((await sessionCount(client, owner.userId)) !== 0) throw new TerminalRecoveryError('session_remains');

    const { rows: factors } = await client.query<{ enabled: boolean | null; factor_rows: number; verified: boolean | null }>(
      `SELECT u."twoFactorEnabled" AS enabled, count(t.id)::int AS factor_rows, bool_and(t.verified) AS verified
         FROM "user" u LEFT JOIN "twoFactor" t ON t."userId" = u.id
        WHERE u.id = $1 GROUP BY u.id`,
      [owner.userId],
    );
    const factor = factors[0];
    if (factor?.enabled !== true || factor.factor_rows !== 1 || factor.verified !== true) {
      throw new TerminalRecoveryError('failed');
    }

    const { rows: webRecoveries } = await client.query(
      `SELECT 1 FROM dromex_owner_recovery WHERE user_id = $1 AND ended_at IS NULL`,
      [owner.userId],
    );
    if (webRecoveries.length > 0) throw new TerminalRecoveryError('failed');

    const completed = await client.query(
      `UPDATE dromex_principal SET mfa_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND mfa_completed_at IS NULL`,
      [owner.userId],
    );
    if (completed.rowCount !== 1) throw new TerminalRecoveryError('failed');

    await client.query(
      `UPDATE dromex_terminal_recovery SET state = 'completed', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [run.runId],
    );
    await run.audit.record(event('terminal_recovery_completed', 'success', run.actor, { terminalRecoveryId: run.runId }), client);
  });
}

/** Ends the run after a failure. Never throws, and restores nothing. */
async function endFailedRun(run: Run, error: unknown): Promise<void> {
  const code = toRecoveryError(error).code;
  const abandoned = code === 'not_confirmed' || code === 'cancelled' || code === 'not_interactive';

  if (run.session !== null) {
    await run.deps.identity.revokeAllSessions({ cookie: run.session }).catch(() => undefined);
  }

  await transaction(run.client, async () => {
    const { rowCount } = await run.client.query(
      `UPDATE dromex_terminal_recovery SET state = $2, ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND ended_at IS NULL`,
      [run.runId, abandoned ? 'abandoned' : 'failed'],
    );
    if (rowCount === 1) {
      await run.audit.record(
        event(abandoned ? 'terminal_recovery_abandoned' : 'terminal_recovery_failed', 'failure', run.actor, {
          terminalRecoveryId: run.runId,
          reason: code,
        }),
        run.client,
      );
    }
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Records a session this run obtained, so the ordinary gate refuses it forever. */
async function denySession(run: Run, cookie: string): Promise<void> {
  const sessionId = await run.deps.identity.sessionIdOf({ cookie, userId: run.owner.userId });
  await run.client.query(
    `INSERT INTO dromex_terminal_recovery_session (session_id, terminal_recovery_id) VALUES ($1, $2)
     ON CONFLICT (session_id) DO NOTHING`,
    [sessionId, run.runId],
  );
}

async function factorIsPresent(client: PoolClient, userId: string): Promise<boolean> {
  const { rows } = await client.query<{ present: boolean }>(
    `SELECT coalesce(u."twoFactorEnabled", FALSE) OR EXISTS (SELECT 1 FROM "twoFactor" t WHERE t."userId" = u.id) AS present
       FROM "user" u WHERE u.id = $1`,
    [userId],
  );
  return rows[0]?.present === true;
}

async function sessionCount(client: PoolClient, userId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [userId]);
  return rows[0]?.n ?? 0;
}

function isCanonicalCodeSet(codes: unknown): codes is string[] {
  return (
    Array.isArray(codes) &&
    codes.length === RECOVERY_CODE_COUNT &&
    new Set(codes).size === RECOVERY_CODE_COUNT &&
    codes.every((code) => typeof code === 'string' && CANONICAL_CODE.test(code))
  );
}

/** The Base32 secret from the otpauth URI, grouped in fours, and the URI itself. */
function describeEnrollment(uri: string): { secret: string; uri: string } {
  const parsed = new URL(uri);
  const secret = parsed.searchParams.get('secret');
  if (parsed.protocol !== 'otpauth:' || secret === null || !BASE32.test(secret)) {
    throw new TerminalRecoveryError('failed');
  }
  return { secret: secret.match(/.{1,4}/g)!.join('-'), uri };
}
