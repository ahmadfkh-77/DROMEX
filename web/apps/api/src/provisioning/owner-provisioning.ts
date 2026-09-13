import type { Pool, PoolClient } from 'pg';

import { OwnerProvisioningError } from './errors.ts';
import type { OwnerIdentityPort } from './owner-identity.ts';
import { validateOwnerDraft, type OwnerDraft, type OwnerInput } from './owner-input.ts';

/**
 * Creates the first and only DROMEX Owner.
 *
 * **This is not one transaction, and nothing here claims it is.** Better Auth
 * 1.7.4 creates an identity inside its own transaction on its own connection
 * and documents no way to join a transaction the caller controls. The Better
 * Auth identity and the DROMEX Owner principal are therefore created in two
 * separate commits, and a process can stop between them. The workflow is
 * built around that gap:
 *
 * 1. A fixed PostgreSQL advisory lock is taken before any state is read, and
 *    held on one connection until the run ends. A second run refuses at once.
 * 2. An existing Owner refuses the run before Better Auth is asked anything.
 * 3. A durable intent row (`dromex_owner_bootstrap`, no secret in it) is
 *    written before the identity is created, and records the identity once
 *    Better Auth has created it.
 * 4. The Owner principal is inserted and the intent deleted in one DROMEX
 *    transaction. That commit is the only thing that makes an Owner.
 *
 * An interrupted run leaves an intent and, perhaps, an orphaned identity with
 * no principal — never a partial Owner. Re-running with the same email
 * resumes it; an orphan is claimed only after Better Auth verifies the
 * password, and the session that verification issues is revoked before the
 * Owner is committed. A different email is refused. No Better Auth row is
 * ever inserted, updated, or deleted by SQL written here: identities are
 * created and verified only through `OwnerIdentityPort`.
 */

/** Distinct from the migrator's key, so the two never contend. */
export const OWNER_PROVISIONING_LOCK_KEY = 4_173_967_202;

export interface OwnerProvisioningDependencies {
  /** DROMEX's connections: the lock, the intent, and the principal. */
  pool: Pool;
  /** Better Auth, reached only through its documented server API. */
  identity: OwnerIdentityPort;
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
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [OWNER_PROVISIONING_LOCK_KEY],
    );
    locked = rows[0]?.locked === true;
    if (!locked) throw new OwnerProvisioningError('in_progress');

    await provisionWhileLocked(client, deps.identity, input);
    return { status: 'owner_created' };
  } catch (error) {
    if (error instanceof OwnerProvisioningError) throw error;
    // The cause is dropped on purpose: driver and Better Auth errors can carry
    // row data, and nothing sensitive may leave through an error.
    throw new OwnerProvisioningError('failed');
  } finally {
    if (locked) {
      await client
        .query('SELECT pg_advisory_unlock($1)', [OWNER_PROVISIONING_LOCK_KEY])
        .catch(() => {
          discardConnection = true;
        });
    }
    // A connection whose unlock failed is destroyed, which releases the lock.
    client.release(discardConnection);
  }
}

async function provisionWhileLocked(
  client: PoolClient,
  identity: OwnerIdentityPort,
  input: OwnerInput,
): Promise<void> {
  if (await ownerExists(client)) throw new OwnerProvisioningError('owner_exists');

  const intent = await readIntent(client);
  const existingUserId = await findUserIdByEmail(client, input.email);

  if (intent === null) {
    // Only an identity this workflow creates may become the Owner.
    if (existingUserId !== null) throw new OwnerProvisioningError('identity_conflict');

    await client.query(
      `INSERT INTO dromex_owner_bootstrap (state, email) VALUES ('pending_identity', $1)`,
      [input.email],
    );
    await createIdentity(client, identity, input);
    return;
  }

  if (intent.email !== input.email) throw new OwnerProvisioningError('different_pending_email');

  if (intent.user_id === null && existingUserId === null) {
    // Interrupted before Better Auth created anything.
    await createIdentity(client, identity, input);
    return;
  }

  // Interrupted after Better Auth created the identity: an orphan.
  const orphanId = intent.user_id ?? existingUserId;
  if (orphanId === null || (intent.user_id !== null && existingUserId !== intent.user_id)) {
    throw new OwnerProvisioningError('identity_conflict');
  }
  if (await principalExists(client, orphanId)) {
    throw new OwnerProvisioningError('identity_conflict');
  }

  const verified = await identity.verify({
    email: input.email,
    password: input.password,
    userId: orphanId,
  });
  if (!verified) throw new OwnerProvisioningError('verification_failed');

  await completeOwner(client, orphanId);
}

async function createIdentity(
  client: PoolClient,
  identity: OwnerIdentityPort,
  input: OwnerInput,
): Promise<void> {
  const created = await identity.create(input);

  // With autoSignIn off, Better Auth answers a duplicate email with a
  // synthetic user rather than an error. Only a real row with this id counts.
  const confirmedUserId = await findUserIdByEmail(client, input.email);
  if (confirmedUserId === null || confirmedUserId !== created.userId) {
    throw new OwnerProvisioningError('identity_conflict');
  }

  const recorded = await client.query(
    `UPDATE dromex_owner_bootstrap
        SET state = 'identity_created', user_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE singleton AND state = 'pending_identity' AND email = $2`,
    [confirmedUserId, input.email],
  );
  if (recorded.rowCount !== 1) throw new OwnerProvisioningError('failed');

  await completeOwner(client, confirmedUserId);
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
      `INSERT INTO dromex_principal (user_id, status, is_owner) VALUES ($1, 'active', TRUE)`,
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
  const { rows } = await client.query(`SELECT 1 FROM dromex_principal WHERE user_id = $1`, [
    userId,
  ]);
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
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
    email,
  ]);
  return rows[0]?.id ?? null;
}
