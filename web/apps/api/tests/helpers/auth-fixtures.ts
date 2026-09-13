import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';

import { createAuthOptions, type AuthSettings } from '../../src/auth/config.ts';
import { loadDromexMigrations } from '../../src/db/dromex-migrations.ts';
import { applyMigrations } from '../../src/db/migrator.ts';

/**
 * TEST-ONLY fixtures for disposable integration databases.
 *
 * Nothing here is imported by production code, and nothing here reads the
 * environment. The sign-up-enabled Better Auth instance below is constructed
 * inside a function, only in the test tree, only against the pool it is
 * handed — so it cannot be exported to the server, mounted on a route, or
 * switched on by any flag.
 */

const BETTER_AUTH_SQL = fileURLToPath(
  new URL('../../migrations/better-auth/0001_better_auth_init.sql', import.meta.url),
);
export async function migrateAuthSchema(pool: Pool): Promise<void> {
  await pool.query(await readFile(BETTER_AUTH_SQL, 'utf8'));
  await applyMigrations(pool, await loadDromexMigrations());
}

export interface SyntheticUser {
  id: string;
  email: string;
  password: string;
  name: string;
}

/**
 * Creates a synthetic user through Better Auth's supported server API, rather
 * than inserting password and account rows by hand. `autoSignIn` stays off,
 * so no session is created here.
 */
export async function provisionSyntheticUser(
  pool: Pool,
  settings: AuthSettings,
  label: string,
): Promise<SyntheticUser> {
  const options = createAuthOptions({ ...settings, database: pool });
  const provisioning = betterAuth({
    ...options,
    emailAndPassword: {
      ...options.emailAndPassword,
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
    },
  });

  const suffix = randomBytes(4).toString('hex');
  const draft = {
    email: `${label}-${suffix}@synthetic.invalid`,
    password: `synthetic passphrase ${randomBytes(8).toString('hex')}`,
    name: `Synthetic ${label}`,
  };

  const result = await provisioning.api.signUpEmail({ body: draft });

  return { id: result.user.id, ...draft };
}

/** DROMEX's own table; a legitimate fixture inside a disposable database. */
export async function setPrincipal(
  pool: Pool,
  userId: string,
  status: 'active' | 'disabled',
  isOwner = false,
): Promise<void> {
  await pool.query(
    `INSERT INTO dromex_principal (user_id, status, is_owner)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id)
     DO UPDATE SET status = EXCLUDED.status,
                   is_owner = EXCLUDED.is_owner,
                   updated_at = CURRENT_TIMESTAMP`,
    [userId, status, isOwner],
  );
}
