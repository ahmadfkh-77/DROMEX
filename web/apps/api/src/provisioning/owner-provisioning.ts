import type { Pool, PoolClient } from 'pg';

import { OwnerProvisioningError } from './errors.ts';
import type { OwnerIdentityPort } from './owner-identity.ts';
import { validateOwnerDraft, type OwnerDraft, type OwnerInput } from './owner-input.ts';

/**
 * Activates the first and only DROMEX Owner, entirely from the local
 * terminal (DEC-434, DEC-435).
 *
 * **This is not one transaction, and nothing here claims it is.** Better Auth
 * creates the identity, enables and verifies TOTP, and issues recovery codes
 * in its own transactions on its own connections; the DROMEX Owner principal
 * is created afterwards in one separate DROMEX transaction. The workflow is
 * built around that gap:
 *
 * 1. A fixed PostgreSQL advisory lock is taken before any state is read and
 *    held for the whole run. A second run refuses at once.
 * 2. An existing Owner refuses the run before Better Auth is asked anything.
 * 3. A durable intent row (`dromex_owner_bootstrap`, no secret in it) is
 *    written before the identity is created and records it once created.
 * 4. The password is proven through Better Auth's sign-in. An identity with
 *    no verified factor then enrols TOTP; an identity whose factor was
 *    verified by an interrupted run must pass a TOTP challenge instead, and
 *    receives a freshly regenerated recovery-code set, so no code shown by an
 *    interrupted run stays valid.
 * 5. Recovery codes are shown only after TOTP verification and a typed
 *    two-device acknowledgement, and are followed by a second typed
 *    acknowledgement.
 * 6. Every provisioning session is revoked. Then one DROMEX transaction
 *    confirms no session remains, inserts the active Owner principal with
 *    `mfa_completed_at`, and deletes the intent. That commit alone makes an
 *    Owner.
 *
 * An interrupted run never leaves a usable Owner: without a principal, the
 * runtime session hook refuses every web session. No Better Auth row is ever
 * inserted, updated, or deleted by SQL written here.
 */

/** Distinct from the migrator's key, so the two never contend. */
export const OWNER_PROVISIONING_LOCK_KEY = 4_173_967_202;

/** TOTP attempts accepted in one run (DEC-434). */
export const OWNER_TOTP_MAX_ATTEMPTS = 5;

/** The operator's terminal, as the activation workflow needs it. */
export interface OwnerActivationTerminal {
  /** Shows the secret for manual entry and the otpauth URI, once. */
  presentEnrollment(material: { secret: string; uri: string }): Promise<void>;
  readTotpCode(attempt: number, maxAttempts: number): Promise<string>;
  /** True only when the operator confirms two devices and two sealed copies. */
  confirmAuthenticatorsAndStorage(): Promise<boolean>;
  presentRecoveryCodes(codes: readonly string[]): Promise<void>;
  /** True only when the operator confirms the codes were recorded. */
  confirmRecoveryCodesRecorded(): Promise<boolean>;
  clearScreen(): Promise<void>;
}

export interface OwnerProvisioningDependencies {
  /** DROMEX's connections: the lock, the intent, and the principal. */
  pool: Pool;
  /** Better Auth, reached only through its documented server API. */
  identity: OwnerIdentityPort;
  terminal: OwnerActivationTerminal;
}

export interface OwnerProvisioningResult {
  status: 'owner_created';
}

interface IntentRow {
  state: 'pending_identity' | 'identity_created';
  email: string;
  user_id: string | null;
}

export async function provisionOwner(
  deps: OwnerProvisioningDependencies,
  draft: OwnerDraft,
): Promise<OwnerProvisioningResult> {
  // Everything about the input is settled before a connection exists.
  const input = validateOwnerDraft(draft);

  let client: PoolClient;
  try {
    client = await deps.pool.connect();
  } catch {
    throw new OwnerProvisioningError('failed');
  }

  let locked = false;
  let discardConnection = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
      OWNER_PROVISIONING_LOCK_KEY,
    ]);
    locked = rows[0]?.locked === true;
    if (!locked) throw new OwnerProvisioningError('in_progress');

    const userId = await resolveIdentity(client, deps.identity, input);
    await activateOwner(client, deps.identity, deps.terminal, input, userId);
    return { status: 'owner_created' };
  } catch (error) {
    if (error instanceof OwnerProvisioningError) throw error;
    // The cause is dropped on purpose: driver and Better Auth errors can carry
    // row data, and nothing sensitive may leave through an error.
    throw new OwnerProvisioningError('failed');
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [OWNER_PROVISIONING_LOCK_KEY]).catch(() => {
        discardConnection = true;
      });
    }
    // A connection whose unlock failed is destroyed, which releases the lock.
    client.release(discardConnection);
  }
}

/** Creates the identity, or returns the orphan this workflow may resume. */
async function resolveIdentity(client: PoolClient, identity: OwnerIdentityPort, input: OwnerInput): Promise<string> {
  if (await ownerExists(client)) throw new OwnerProvisioningError('owner_exists');

  const intent = await readIntent(client);
  const existingUserId = await findUserIdByEmail(client, input.email);

  if (intent === null) {
    // Only an identity this workflow creates may become the Owner.
    if (existingUserId !== null) throw new OwnerProvisioningError('identity_conflict');

    await client.query(`INSERT INTO dromex_owner_bootstrap (state, email) VALUES ('pending_identity', $1)`, [
      input.email,
    ]);
    return createIdentity(client, identity, input);
  }

  if (intent.email !== input.email) throw new OwnerProvisioningError('different_pending_email');

  if (intent.user_id === null && existingUserId === null) {
    // Interrupted before Better Auth created anything.
    return createIdentity(client, identity, input);
  }

  // Interrupted after Better Auth created the identity: an orphan. The
  // password is proven by the sign-in that follows.
  const orphanId = intent.user_id ?? existingUserId;
  if (orphanId === null || (intent.user_id !== null && existingUserId !== intent.user_id)) {
    throw new OwnerProvisioningError('identity_conflict');
  }
  if (await principalExists(client, orphanId)) throw new OwnerProvisioningError('identity_conflict');
  return orphanId;
}

async function createIdentity(client: PoolClient, identity: OwnerIdentityPort, input: OwnerInput): Promise<string> {
  const created = await identity.create(input);

  // With autoSignIn off, Better Auth answers a duplicate email with a
  // synthetic user rather than an error. Only a real row with this id counts.
  const confirmedUserId = await findUserIdByEmail(client, input.email);
  if (confirmedUserId === null || confirmedUserId !== created.userId) {
    throw new OwnerProvisioningError('identity_conflict');
  }

  await recordIdentity(client, confirmedUserId, input.email);
  return confirmedUserId;
}

async function recordIdentity(client: PoolClient, userId: string, email: string): Promise<void> {
  await client.query(
    `UPDATE dromex_owner_bootstrap
        SET state = 'identity_created', user_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE singleton AND state = 'pending_identity' AND email = $2`,
    [userId, email],
  );
}

async function activateOwner(
  client: PoolClient,
  identity: OwnerIdentityPort,
  terminal: OwnerActivationTerminal,
  input: OwnerInput,
  userId: string,
): Promise<void> {
  let session: string | null = null;
  let revoked = false;

  try {
    const signedIn = await identity.signIn({ email: input.email, password: input.password, userId });
    if (signedIn.kind === 'invalid') throw new OwnerProvisioningError('verification_failed');
    await recordIdentity(client, userId, input.email);

    let recoveryCodes: string[];
    if (signedIn.kind === 'session') {
      // No verified factor yet. Enabling again replaces any unverified secret
      // and code set from an interrupted run. The codes are held back until
      // the factor is verified and the operator has acknowledged two devices.
      session = signedIn.cookie;
      const material = await identity.enableTotp({ cookie: session, password: input.password });
      await terminal.presentEnrollment(describeEnrollment(material.totpUri));
      session = await verifyWithinAttempts(identity, terminal, session, userId);
      recoveryCodes = material.recoveryCodes;
    } else {
      // The factor was verified by an interrupted run. Pass its challenge,
      // then replace every recovery code that run may have shown.
      session = await verifyWithinAttempts(identity, terminal, signedIn.cookie, userId);
      recoveryCodes = await identity.regenerateRecoveryCodes({ cookie: session, password: input.password });
    }

    if (!(await terminal.confirmAuthenticatorsAndStorage())) throw new OwnerProvisioningError('cancelled');
    await terminal.presentRecoveryCodes(recoveryCodes);
    if (!(await terminal.confirmRecoveryCodesRecorded())) throw new OwnerProvisioningError('cancelled');
    await terminal.clearScreen();

    await identity.revokeAllSessions({ cookie: session });
    revoked = true;
    await completeOwner(client, userId);
  } catch (error) {
    if (session !== null && !revoked) {
      await identity.revokeAllSessions({ cookie: session }).catch(() => undefined);
    }
    throw error;
  }
}

async function verifyWithinAttempts(
  identity: OwnerIdentityPort,
  terminal: OwnerActivationTerminal,
  cookie: string,
  userId: string,
): Promise<string> {
  for (let attempt = 1; attempt <= OWNER_TOTP_MAX_ATTEMPTS; attempt += 1) {
    const code = await terminal.readTotpCode(attempt, OWNER_TOTP_MAX_ATTEMPTS);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) continue;

    const outcome = await identity.verifyTotp({ cookie, code, userId });
    if (outcome.kind === 'verified') return outcome.cookie;
    if (outcome.kind === 'locked') throw new OwnerProvisioningError('totp_locked');
  }
  throw new OwnerProvisioningError('totp_attempts_exhausted');
}

/** The Base32 secret from the otpauth URI, grouped in fours for manual entry. */
function describeEnrollment(uri: string): { secret: string; uri: string } {
  const parsed = new URL(uri);
  const secret = parsed.searchParams.get('secret');
  if (parsed.protocol !== 'otpauth:' || secret === null || !/^[A-Z2-7]+$/.test(secret)) {
    throw new Error('Better Auth returned an unexpected TOTP URI.');
  }
  return { secret: secret.match(/.{1,4}/g)!.join('-'), uri };
}

/** The single commit that makes an Owner. */
async function completeOwner(client: PoolClient, userId: string): Promise<void> {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`,
      [userId],
    );
    if (rows[0]?.n !== 0) throw new OwnerProvisioningError('session_remains');

    await client.query(
      `INSERT INTO dromex_principal (user_id, status, is_owner, mfa_completed_at)
       VALUES ($1, 'active', TRUE, CURRENT_TIMESTAMP)`,
      [userId],
    );
    const removed = await client.query(`DELETE FROM dromex_owner_bootstrap WHERE singleton`);
    if (removed.rowCount !== 1) throw new OwnerProvisioningError('failed');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function ownerExists(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM dromex_principal WHERE is_owner LIMIT 1`);
  return rows.length > 0;
}

async function principalExists(client: PoolClient, userId: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM dromex_principal WHERE user_id = $1`, [userId]);
  return rows.length > 0;
}

async function readIntent(client: PoolClient): Promise<IntentRow | null> {
  const { rows } = await client.query<IntentRow>(
    `SELECT state, email, user_id FROM dromex_owner_bootstrap WHERE singleton`,
  );
  return rows[0] ?? null;
}

/** Read-only. Better Auth stores emails lower-cased; input is normalised alike. */
async function findUserIdByEmail(client: PoolClient, email: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
  return rows[0]?.id ?? null;
}
