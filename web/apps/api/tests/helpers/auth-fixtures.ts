import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';

import {
  createAuthOptions,
  createTwoFactorPlugin,
  type AuthSettings,
} from '../../src/auth/config.ts';
import { loadDromexMigrations } from '../../src/db/dromex-migrations.ts';
import { applyMigrations } from '../../src/db/migrator.ts';
import { TotpSequence } from './totp.ts';

/**
 * TEST-ONLY fixtures for disposable integration databases.
 *
 * Nothing here is imported by production code, and nothing here reads the
 * environment. The sign-up-enabled Better Auth instance below is constructed
 * inside a function, only in the test tree, only against the pool it is
 * handed — so it cannot be exported to the server, mounted on a route, or
 * switched on by any flag.
 */

const BETTER_AUTH_MIGRATIONS = ['0001_better_auth_init.sql', '0002_two_factor.sql'].map((file) =>
  fileURLToPath(new URL(`../../migrations/better-auth/${file}`, import.meta.url)),
);

/** Better Auth's generated sequence first, then the DROMEX ledger. */
export async function migrateAuthSchema(pool: Pool): Promise<void> {
  for (const file of BETTER_AUTH_MIGRATIONS) {
    await pool.query(await readFile(file, 'utf8'));
  }
  await applyMigrations(pool, await loadDromexMigrations());
}

/** A Better Auth instance with sign-up enabled, for fixtures only. */
export function fixtureAuth(pool: Pool, settings: AuthSettings) {
  const options = createAuthOptions({ ...settings, database: pool });
  return betterAuth({
    ...options,
    plugins: [createTwoFactorPlugin()],
    emailAndPassword: {
      ...options.emailAndPassword,
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
    },
  });
}

export interface SyntheticUser {
  id: string;
  email: string;
  password: string;
  name: string;
}

export interface EnrolledUser extends SyntheticUser {
  /** Base32 TOTP secret, exactly as the otpauth URI carries it. */
  totpSecret: string;
  recoveryCodes: string[];
  totp: TotpSequence;
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
  const suffix = randomBytes(4).toString('hex');
  const draft = {
    email: `${label}-${suffix}@synthetic.invalid`,
    password: `synthetic passphrase ${randomBytes(8).toString('hex')}`,
    name: `Synthetic ${label}`,
  };

  const result = await fixtureAuth(pool, settings).api.signUpEmail({ body: draft });

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

/**
 * Counts Better Auth `twoFactor` rows that lack a value Better Auth's adapter
 * supplies at runtime.
 *
 * The generated table (`migrations/better-auth/0002`) gives neither `verified`
 * nor `failedVerificationCount` a database default; Better Auth's adapter
 * writes them from its plugin schema. A NULL here therefore means a row was
 * written outside that adapter — and on PostgreSQL a NULL counter never
 * reaches the lockout threshold.
 */
export async function twoFactorRowsMissingRuntimeDefaults(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "twoFactor"
      WHERE "failedVerificationCount" IS NULL OR verified IS NULL`,
  );
  return rows[0]!.n;
}

/** The `name=value` pair of the first Set-Cookie whose name contains `fragment`. */
export function cookiePair(headers: Headers, fragment: string): string {
  const cookie = headers
    .getSetCookie()
    .map((value) => value.split(';')[0] ?? '')
    .find((pair) => pair.split('=')[0]!.includes(fragment) && pair.split('=')[1] !== '');
  if (!cookie) throw new Error(`expected a ${fragment} cookie`);
  return cookie;
}

/**
 * Enrols TOTP for a synthetic user that already has an active principal,
 * through Better Auth's documented server API only, then marks DROMEX MFA
 * completion. Every fixture session is revoked before it returns.
 */
export async function enrollSyntheticMfa(
  pool: Pool,
  settings: AuthSettings,
  user: SyntheticUser,
): Promise<EnrolledUser> {
  const auth = fixtureAuth(pool, settings);

  const signedIn = await auth.api.signInEmail({
    body: { email: user.email, password: user.password },
    returnHeaders: true,
  });
  const session = new Headers({ cookie: cookiePair(signedIn.headers, 'session_token') });

  const enabled = await auth.api.enableTwoFactor({
    body: { password: user.password },
    headers: session,
  });
  if (!('totpURI' in enabled) || typeof enabled.totpURI !== 'string') {
    throw new Error('expected a TOTP URI');
  }
  const totpSecret = new URL(enabled.totpURI).searchParams.get('secret');
  if (!totpSecret) throw new Error('expected a TOTP secret');

  const totp = new TotpSequence(totpSecret);
  const verified = await auth.api.verifyTOTP({
    body: { code: await totp.next() },
    headers: session,
    returnHeaders: true,
  });
  await auth.api.revokeSessions({
    headers: new Headers({ cookie: cookiePair(verified.headers, 'session_token') }),
  });

  await pool.query(
    `UPDATE dromex_principal SET mfa_completed_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
    [user.id],
  );

  return { ...user, totpSecret, recoveryCodes: enabled.backupCodes ?? [], totp };
}
