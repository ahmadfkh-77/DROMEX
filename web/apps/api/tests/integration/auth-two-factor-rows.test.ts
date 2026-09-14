import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTwoFactorPlugin, type AuthSettings } from '../../src/auth/config.ts';
import { buildServer } from '../../src/server.ts';
import {
  cookiePair,
  enrollSyntheticMfa,
  fixtureAuth,
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  type EnrolledUser,
} from '../helpers/auth-fixtures.ts';
import { TEST_TRUSTED_ORIGIN, settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';
import { totpCode, waitForFreshStep, wrongCode } from '../helpers/totp.ts';

/**
 * Why Better Auth's runtime defaults, not PostgreSQL defaults, are
 * authoritative for the `twoFactor` table.
 *
 * The pinned `auth@1.7.4` CLI generated `verified` and
 * `failedVerificationCount` with no database default, and that migration is
 * kept unedited (DEC-431). Better Auth's adapter fills both from the plugin
 * schema on every insert it performs, and it is the only writer of the table.
 *
 * The counter is security-relevant. The pinned Kysely adapter increments it
 * as `"failedVerificationCount" + 1`; on PostgreSQL a NULL stays NULL, the
 * plugin reads it as 0, and the ten-failure lockout never triggers. So every
 * flow DROMEX supports is exercised here, and each must leave a non-null
 * counter and an explicit `verified`. The last test is a negative control
 * showing what a NULL counter would do. Every address below is distinct per
 * password step, so no result here comes from DROMEX's rate limits.
 */

let database: EphemeralDatabase;
let pool: Pool;
let settings: AuthSettings;
let server: FastifyInstance;

interface FactorRow {
  verified: boolean | null;
  count: number | null;
  locked: boolean;
}

async function factorRow(userId: string): Promise<FactorRow> {
  const { rows } = await pool.query<FactorRow>(
    `SELECT verified, "failedVerificationCount" AS count, "lockedUntil" IS NOT NULL AS locked
       FROM "twoFactor" WHERE "userId" = $1`,
    [userId],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function passwordStep(user: EnrolledUser, remoteAddress: string) {
  return server.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    remoteAddress,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
    payload: { email: user.email, password: user.password },
  });
}

function totpStep(challenge: string, code: string, remoteAddress: string) {
  return server.inject({
    method: 'POST',
    url: '/api/auth/two-factor/verify-totp',
    remoteAddress,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: challenge },
    payload: { code },
  });
}

async function challengeFor(user: EnrolledUser, remoteAddress: string): Promise<string> {
  const response = await passwordStep(user, remoteAddress);
  expect(response.json()).toEqual({ mfaRequired: true });
  const header = response.headers['set-cookie'];
  return String(Array.isArray(header) ? header[0] : header).split(';')[0]!;
}

async function failFiveTimes(user: EnrolledUser, remoteAddress: string): Promise<void> {
  const challenge = await challengeFor(user, remoteAddress);
  const wrong = wrongCode(user.totpSecret);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    expect((await totpStep(challenge, wrong, remoteAddress)).statusCode, `attempt ${attempt}`).toBe(401);
  }
}

async function activeUser(label: string): Promise<EnrolledUser> {
  const user = await provisionSyntheticUser(pool, settings, label);
  await setPrincipal(pool, user.id, 'active');
  return enrollSyntheticMfa(pool, settings, user);
}

function totpSecretOf(result: unknown): string {
  const uri = (result as { totpURI?: unknown }).totpURI;
  if (typeof uri !== 'string') throw new Error('expected a TOTP URI');
  return new URL(uri).searchParams.get('secret')!;
}

describe('Better Auth twoFactor rows written through supported flows', () => {
  beforeEach(async () => {
    database = await createEphemeralDatabase();
    pool = new Pool({ connectionString: database.uri, max: 20 });
    await migrateAuthSchema(pool);
    settings = syntheticAuthSettings();
    server = await buildServer({ databaseUrl: database.uri, auth: settings });
    await server.ready();
  });

  afterEach(async () => {
    await settle();
    await server?.close();
    await pool?.end().catch(() => undefined);
    await database?.drop().catch(() => undefined);
  });

  it('depends on defaults the pinned plugin schema declares, because the table itself has none', async () => {
    const fields = createTwoFactorPlugin().schema.twoFactor.fields;

    expect(fields.failedVerificationCount).toMatchObject({ type: 'number', defaultValue: 0, input: false });
    expect(fields.verified).toMatchObject({ type: 'boolean', defaultValue: true, input: false });
    const { rows } = await pool.query(
      `SELECT column_name, column_default FROM information_schema.columns
        WHERE table_name = 'twoFactor' AND column_name IN ('failedVerificationCount', 'verified')
        ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'failedVerificationCount', column_default: null },
      { column_name: 'verified', column_default: null },
    ]);
  });

  it('enrolment writes an explicit unverified row with a zero counter, re-enrolment keeps it, and verification keeps it at zero', async () => {
    const user = await provisionSyntheticUser(pool, settings, 'enrol');
    await setPrincipal(pool, user.id, 'active');
    const auth = fixtureAuth(pool, settings);
    const signedIn = await auth.api.signInEmail({
      body: { email: user.email, password: user.password },
      returnHeaders: true,
    });
    const session = new Headers({ cookie: cookiePair(signedIn.headers, 'session_token') });

    await auth.api.enableTwoFactor({ body: { password: user.password }, headers: session });
    expect(await factorRow(user.id)).toEqual({ verified: false, count: 0, locked: false });

    // Enabling again before verification takes Better Auth's update path,
    // the one an interrupted Owner activation resumes through.
    const again = await auth.api.enableTwoFactor({ body: { password: user.password }, headers: session });
    expect(await factorRow(user.id)).toEqual({ verified: false, count: 0, locked: false });

    await waitForFreshStep();
    await auth.api.verifyTOTP({ body: { code: totpCode(totpSecretOf(again)) }, headers: session });
    expect(await factorRow(user.id)).toEqual({ verified: true, count: 0, locked: false });
  });

  it('counts sign-in failures up from zero, and resets the counter to zero on success', async () => {
    const user = await activeUser('counting');
    const address = '198.51.100.41';
    const challenge = await challengeFor(user, address);
    const wrong = wrongCode(user.totpSecret);

    for (let failures = 1; failures <= 3; failures += 1) {
      expect((await totpStep(challenge, wrong, address)).statusCode).toBe(401);
      expect(await factorRow(user.id)).toEqual({ verified: true, count: failures, locked: false });
    }

    expect((await totpStep(challenge, await user.totp.next(), address)).statusCode).toBe(200);
    expect(await factorRow(user.id)).toEqual({ verified: true, count: 0, locked: false });
  });

  it('locks at ten on a non-null counter, and clears an expired lock back to a counter that counts again', async () => {
    const user = await activeUser('lock-cycle');

    await failFiveTimes(user, '198.51.100.51');
    await failFiveTimes(user, '198.51.100.52');
    expect(await factorRow(user.id)).toEqual({ verified: true, count: 10, locked: true });

    await pool.query(`UPDATE "twoFactor" SET "lockedUntil" = now() - interval '1 second' WHERE "userId" = $1`, [user.id]);
    const challenge = await challengeFor(user, '198.51.100.53');
    expect((await totpStep(challenge, wrongCode(user.totpSecret), '198.51.100.53')).statusCode).toBe(401);

    expect(await factorRow(user.id)).toEqual({ verified: true, count: 1, locked: false });
  });

  it('leaves the counter and verification untouched when recovery codes are regenerated or retrieved', async () => {
    const user = await activeUser('regenerate');
    const auth = fixtureAuth(pool, settings);
    const challenged = await auth.api.signInEmail({
      body: { email: user.email, password: user.password },
      returnHeaders: true,
    });
    const verified = await auth.api.verifyTOTP({
      body: { code: await user.totp.next() },
      headers: new Headers({ cookie: cookiePair(challenged.headers, 'two_factor') }),
      returnHeaders: true,
    });
    const session = new Headers({ cookie: cookiePair(verified.headers, 'session_token') });

    const challenge = await challengeFor(user, '198.51.100.61');
    const wrong = wrongCode(user.totpSecret);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      expect((await totpStep(challenge, wrong, '198.51.100.61')).statusCode).toBe(401);
    }
    expect(await factorRow(user.id)).toEqual({ verified: true, count: 2, locked: false });

    await auth.api.generateBackupCodes({ body: { password: user.password }, headers: session });
    await auth.api.viewBackupCodes({ body: { userId: user.id } });

    expect(await factorRow(user.id)).toEqual({ verified: true, count: 2, locked: false });
  });

  it('negative control: a NULL counter, which only a write outside Better Auth could produce, never locks', async () => {
    const user = await activeUser('null-counter');
    // Deliberately corrupted, in a disposable database only.
    await pool.query(`UPDATE "twoFactor" SET "failedVerificationCount" = NULL WHERE "userId" = $1`, [user.id]);

    await failFiveTimes(user, '198.51.100.71');
    await failFiveTimes(user, '198.51.100.72');
    expect(await factorRow(user.id)).toEqual({ verified: true, count: null, locked: false });

    const challenge = await challengeFor(user, '198.51.100.73');
    expect((await totpStep(challenge, await user.totp.next(), '198.51.100.73')).statusCode).toBe(200);
  });
});
