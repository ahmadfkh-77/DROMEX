import { Writable } from 'node:stream';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthSettings } from '../../src/auth/config.ts';
import { generateRecoveryCodes } from '../../src/auth/recovery-codes.ts';
import { createTotpReplayGuard } from '../../src/auth/totp-replay.ts';
import { buildServer } from '../../src/server.ts';
import {
  enrollSyntheticMfa,
  fixtureAuth,
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  twoFactorRowsMissingRuntimeDefaults,
  type EnrolledUser,
} from '../helpers/auth-fixtures.ts';
import { TEST_TRUSTED_ORIGIN, settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';
import { TotpSequence, waitForFreshStep, wrongCode } from '../helpers/totp.ts';

/**
 * Checkpoint 3F-C (DEC-435 precision correction, DEC-436): Owner recovery-code
 * sign-in, the restricted recovery state, supported authenticator
 * replacement, and the security audit, against disposable PostgreSQL 18.6.
 *
 * Every identity is synthetic and vanishes with its disposable database.
 * Every password step and every TOTP or recovery-code step uses its own
 * client address unless a test is deliberately exercising a rate limit.
 */

const SIGN_IN = '/api/auth/sign-in/email';
const VERIFY_TOTP = '/api/auth/two-factor/verify-totp';
const SIGN_OUT = '/api/auth/sign-out';
const VERIFY_CODE = '/api/auth/recovery/verify-code';
const START = '/api/auth/recovery/authenticator/start';
const VERIFY_NEW = '/api/auth/recovery/authenticator/verify';

/**
 * Stand-ins for every future business route. They carry the `authenticated`
 * classification a real project, report, financial, settings, backup, or
 * account-management route will carry, so they prove what the gate does for
 * that classification rather than for one particular handler.
 */
const BUSINESS_PROBES = [
  '/api/projects',
  '/api/reports/daily',
  '/api/finance/payments',
  '/api/settings',
  '/api/backups',
  '/api/accounts',
];

const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;
const UNAUTHORIZED = { error: 'unauthorized' };

let database: EphemeralDatabase;
let pool: Pool;
let settings: AuthSettings;
let app: FastifyInstance;
let logs: string[];
let migrated = false;
let host = 0;
const servers: FastifyInstance[] = [];

const nextAddress = () => `198.51.100.${(host += 1)}`;

async function startServer(): Promise<FastifyInstance> {
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      logs.push(String(chunk));
      callback();
    },
  });
  const server = await buildServer({ databaseUrl: database.uri, auth: settings, logStream });
  for (const url of BUSINESS_PROBES) {
    server.get(url, { config: { access: 'authenticated' } }, async () => ({ business: true }));
    server.post(url, { config: { access: 'authenticated' } }, async () => ({ business: true }));
  }
  await server.ready();
  servers.push(server);
  return server;
}

function post(url: string, payload: unknown, headers: Record<string, string> = {}, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url,
    remoteAddress,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', ...headers },
    payload: payload as Record<string, unknown>,
  });
}

function get(url: string, cookie?: string) {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
}

function setCookies(response: LightMyRequestResponse): string[] {
  const header = response.headers['set-cookie'];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

function liveCookie(response: LightMyRequestResponse, fragment: string): string | undefined {
  return setCookies(response).find(
    (value) => value.split('=')[0]!.includes(fragment) && !/Max-Age=0/i.test(value),
  );
}

function namedCookie(response: LightMyRequestResponse, fragment: string): string {
  const cookie = liveCookie(response, fragment);
  if (!cookie) throw new Error(`expected a ${fragment} cookie`);
  return cookie.split(';')[0]!;
}

async function enrolled(label: string, isOwner = true): Promise<EnrolledUser> {
  const user = await provisionSyntheticUser(pool, settings, label);
  await setPrincipal(pool, user.id, 'active', isOwner);
  return enrollSyntheticMfa(pool, settings, user);
}

async function challengeFor(user: EnrolledUser, address: string): Promise<string> {
  const response = await post(SIGN_IN, { email: user.email, password: user.password }, {}, address);
  expect(response.json()).toEqual({ mfaRequired: true });
  return namedCookie(response, 'two_factor');
}

async function recoveryCodeStep(user: EnrolledUser, code: string, address = nextAddress()) {
  return post(VERIFY_CODE, { code }, { cookie: await challengeFor(user, address) }, address);
}

async function enterRecovery(user: EnrolledUser, code = user.recoveryCodes[0]!): Promise<string> {
  const response = await recoveryCodeStep(user, code);
  expect(response.statusCode).toBe(200);
  return namedCookie(response, 'session_token');
}

function startReplacementWith(cookie: string, password: string) {
  return post(START, { password }, { cookie });
}

async function startReplacement(user: EnrolledUser) {
  const recoveryCookie = await enterRecovery(user);
  const response = await startReplacementWith(recoveryCookie, user.password);
  expect(response.statusCode).toBe(200);
  const body = response.json() as { totpUri: string; manualEntrySecret: string };
  const secret = new URL(body.totpUri).searchParams.get('secret')!;
  return {
    recoveryCookie,
    enrolmentCookie: namedCookie(response, 'session_token'),
    body,
    sequence: new TotpSequence(secret),
  };
}

function verifyNew(cookie: string, code: string, address = nextAddress()) {
  return post(VERIFY_NEW, { code }, { cookie }, address);
}

async function signInWith(user: EnrolledUser, sequence: TotpSequence, address = nextAddress()) {
  const challenge = await challengeFor(user, address);
  return post(VERIFY_TOTP, { code: await sequence.next() }, { cookie: challenge }, address);
}

async function sessionsOf(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM "session" WHERE "userId" = $1`, [userId]);
  return rows.map((row) => row.id);
}

async function mfaCompletedAt(userId: string): Promise<Date | null> {
  const { rows } = await pool.query<{ mfa_completed_at: Date | null }>(
    `SELECT mfa_completed_at FROM dromex_principal WHERE user_id = $1`,
    [userId],
  );
  return rows[0]!.mfa_completed_at;
}

interface RecoveryRow {
  id: string;
  step: string;
  factor_disabled: boolean;
  verify_attempts: number;
  ended: boolean;
  session_id: string;
  lifetime: number;
}

async function recoveries(userId: string): Promise<RecoveryRow[]> {
  const { rows } = await pool.query<RecoveryRow>(
    `SELECT id::text AS id, step, factor_disabled, verify_attempts, ended_at IS NOT NULL AS ended, session_id,
            extract(epoch FROM expires_at - created_at)::float8 AS lifetime
       FROM dromex_owner_recovery WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
}

interface AuditRow {
  event_type: string;
  outcome: string;
  actor_user_id: string | null;
  actor_name: string | null;
  recovery_id: string | null;
  reason: string | null;
  revoked_session_count: number | null;
  client_address: string | null;
}

async function auditEvents(): Promise<AuditRow[]> {
  const { rows } = await pool.query<AuditRow>(
    `SELECT event_type, outcome, actor_user_id, actor_name, recovery_id::text AS recovery_id, reason,
            revoked_session_count, client_address
       FROM dromex_audit_event ORDER BY id`,
  );
  return rows;
}

async function storedCodes(userId: string): Promise<string[]> {
  const result = await fixtureAuth(pool, settings).api.viewBackupCodes({ body: { userId } });
  return result.backupCodes;
}

async function factorState(userId: string) {
  const { rows } = await pool.query<{ enabled: boolean | null; verified: boolean | null; secret: string | null }>(
    `SELECT u."twoFactorEnabled" AS enabled, t.verified, t.secret
       FROM "user" u LEFT JOIN "twoFactor" t ON t."userId" = u.id WHERE u.id = $1`,
    [userId],
  );
  return rows[0]!;
}

async function refuseWith(table: string, timing: 'INSERT' | 'UPDATE'): Promise<() => Promise<void>> {
  await pool.query(`
    CREATE FUNCTION synthetic_refuse() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
    CREATE TRIGGER synthetic_refuse BEFORE ${timing} ON ${table}
    FOR EACH ROW EXECUTE FUNCTION synthetic_refuse();
  `);
  return async () => {
    await pool.query(`DROP TRIGGER synthetic_refuse ON ${table}; DROP FUNCTION synthetic_refuse();`);
  };
}

async function expectNoBusinessAccess(cookie: string): Promise<void> {
  const outcomes: LightMyRequestResponse[] = [await get('/api/session', cookie)];
  for (const url of BUSINESS_PROBES) {
    outcomes.push(await get(url, cookie));
    outcomes.push(await post(url, {}, { cookie }));
  }
  for (const response of outcomes) {
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(UNAUTHORIZED);
  }
}

describe('Owner recovery against PostgreSQL 18.6', () => {
  beforeEach(async () => {
    database = await createEphemeralDatabase();
    pool = new Pool({ connectionString: database.uri, max: 20 });
    await migrateAuthSchema(pool);
    migrated = true;
    settings = syntheticAuthSettings();
    logs = [];
    host = 0;
    app = await startServer();
  });

  afterEach(async () => {
    await settle();
    let incomplete = 0;
    let trusted = 0;
    try {
      while (servers.length > 0) await servers.pop()?.close();
      if (migrated) {
        incomplete = await twoFactorRowsMissingRuntimeDefaults(pool);
        const { rows } = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM verification WHERE identifier LIKE 'trust-device-%'`,
        );
        trusted = rows[0]!.n;
      }
    } finally {
      migrated = false;
      await pool?.end().catch(() => undefined);
      await database?.drop().catch(() => undefined);
    }
    expect(incomplete, 'twoFactor rows without runtime defaults').toBe(0);
    expect(trusted, 'trust-device verification records').toBe(0);
  });

  describe('entering recovery with a recovery code', () => {
    it('turns a valid password and an unused recovery code into a restricted recovery state only', async () => {
      const owner = await enrolled('owner');
      const [used, ...unused] = owner.recoveryCodes;

      const response = await recoveryCodeStep(owner, used!);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ recovery: 'authenticator_replacement_required', expiresInSeconds: 300 });
      const cookie = liveCookie(response, 'session_token')!;
      expect(cookie.startsWith('__Secure-better-auth.session_token=')).toBe(true);
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
      expect(liveCookie(response, 'trust_device')).toBeUndefined();
      expect(response.body).not.toContain(cookie.split(';')[0]!.split('=')[1]!.split('.')[0]!);

      expect(await mfaCompletedAt(owner.id)).toBeNull();
      const sessions = await sessionsOf(owner.id);
      expect(sessions).toHaveLength(1);
      const rows = await recoveries(owner.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        step: 'code_accepted',
        factor_disabled: false,
        verify_attempts: 0,
        ended: false,
        session_id: sessions[0],
        lifetime: 300,
      });
      expect((await pool.query(`SELECT session_id FROM dromex_recovery_session`)).rows).toEqual([
        { session_id: sessions[0] },
      ]);
      expect(await storedCodes(owner.id)).toEqual(unused);
    });

    it('gives the recovery session no business access at all', async () => {
      const owner = await enrolled('owner');

      await expectNoBusinessAccess(await enterRecovery(owner));
    });

    it('lets the recovery session reach only the replacement steps, in order, and sign-out', async () => {
      const owner = await enrolled('owner');
      const cookie = await enterRecovery(owner);

      const outOfOrder = await verifyNew(cookie, '123456');
      expect(outOfOrder.statusCode).toBe(401);
      expect(outOfOrder.json()).toEqual(UNAUTHORIZED);

      const started = await startReplacementWith(cookie, owner.password);
      expect(started.statusCode).toBe(200);

      const signedOut = await post(SIGN_OUT, {}, { cookie: namedCookie(started, 'session_token') });
      expect(signedOut.statusCode).toBe(200);
      expect(await sessionsOf(owner.id)).toEqual([]);
    });

    it('refuses an unknown, a malformed, and an already used recovery code, issuing no session', async () => {
      const owner = await enrolled('owner');
      const [unknown] = generateRecoveryCodes();

      for (const code of [unknown!, 'not-a-recovery-code']) {
        const response = await recoveryCodeStep(owner, code);
        expect(response.statusCode, code).toBe(401);
        expect(response.json()).toEqual({ error: 'invalid_code' });
        expect(liveCookie(response, 'session_token')).toBeUndefined();
      }
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await recoveries(owner.id)).toEqual([]);
      expect(await mfaCompletedAt(owner.id)).not.toBeNull();

      const cookie = await enterRecovery(owner, owner.recoveryCodes[0]!);
      expect((await post(SIGN_OUT, {}, { cookie })).statusCode).toBe(200);

      const reused = await recoveryCodeStep(owner, owner.recoveryCodes[0]!);
      expect(reused.statusCode).toBe(401);
      expect(reused.json()).toEqual({ error: 'invalid_code' });
      expect(await sessionsOf(owner.id)).toEqual([]);

      const rejected = (await auditEvents()).filter((event) => event.event_type === 'recovery_code_rejected');
      expect(rejected.length).toBeGreaterThanOrEqual(3);
      for (const event of rejected) expect(event.outcome).toBe('failure');
    });

    it('limits recovery-code attempts to five per 60 seconds per client address', async () => {
      const owner = await enrolled('owner');
      const address = nextAddress();
      const challenge = await challengeFor(owner, address);
      const [unknown] = generateRecoveryCodes();

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect((await post(VERIFY_CODE, { code: unknown }, { cookie: challenge }, address)).statusCode).toBe(401);
      }
      const blocked = await post(
        VERIFY_CODE,
        { code: owner.recoveryCodes[0] },
        { cookie: await challengeFor(owner, nextAddress()) },
        address,
      );

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: 'too_many_requests' });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
      const { rows } = await pool.query(`SELECT count FROM dromex_rate_limit WHERE key = $1`, [
        `${address}|/two-factor/verify-backup-code`,
      ]);
      expect(rows).toEqual([{ count: 5 }]);
      expect(await recoveries(owner.id)).toEqual([]);
      expect(await sessionsOf(owner.id)).toEqual([]);
    });

    it('counts recovery-code failures toward the shared ten-failure account lockout', async () => {
      const owner = await enrolled('owner');
      const [unknown] = generateRecoveryCodes();

      const codeAddress = nextAddress();
      const codeChallenge = await challengeFor(owner, codeAddress);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect((await post(VERIFY_CODE, { code: unknown }, { cookie: codeChallenge }, codeAddress)).statusCode).toBe(401);
      }
      const totpAddress = nextAddress();
      const totpChallenge = await challengeFor(owner, totpAddress);
      const wrong = wrongCode(owner.totpSecret);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect((await post(VERIFY_TOTP, { code: wrong }, { cookie: totpChallenge }, totpAddress)).statusCode).toBe(401);
      }

      const locked = await recoveryCodeStep(owner, owner.recoveryCodes[0]!);

      expect(locked.statusCode).toBe(429);
      expect(locked.json()).toEqual({ error: 'too_many_requests' });
      const { rows } = await pool.query(
        `SELECT "failedVerificationCount" AS failures, "lockedUntil" IS NOT NULL AS locked FROM "twoFactor" WHERE "userId" = $1`,
        [owner.id],
      );
      expect(rows).toEqual([{ failures: 10, locked: true }]);
      expect(await recoveries(owner.id)).toEqual([]);
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await storedCodes(owner.id)).toEqual(owner.recoveryCodes);
    });

    it('revokes every other Owner session and records how many', async () => {
      const owner = await enrolled('owner');
      const first = namedCookie(await signInWith(owner, owner.totp), 'session_token');
      const second = namedCookie(await signInWith(owner, owner.totp), 'session_token');
      expect((await get('/api/session', first)).statusCode).toBe(200);
      expect((await get('/api/session', second)).statusCode).toBe(200);

      const recoveryCookie = await enterRecovery(owner);

      expect(await sessionsOf(owner.id)).toHaveLength(1);
      for (const cookie of [first, second]) {
        expect((await get('/api/session', cookie)).statusCode).toBe(401);
      }
      expect((await get('/api/session', recoveryCookie)).statusCode).toBe(401);
      const revoked = (await auditEvents()).find((event) => event.event_type === 'other_sessions_revoked');
      expect(revoked).toMatchObject({ outcome: 'success', actor_user_id: owner.id, revoked_session_count: 2 });
    });

    it('refuses a non-Owner principal, and a disabled Owner, before any recovery state exists', async () => {
      const admin = await enrolled('admin', false);

      const refused = await recoveryCodeStep(admin, admin.recoveryCodes[0]!);

      expect(refused.statusCode).toBe(401);
      expect(refused.json()).toEqual({ error: 'invalid_code' });
      expect(liveCookie(refused, 'session_token')).toBeUndefined();
      expect(await sessionsOf(admin.id)).toEqual([]);
      expect(await recoveries(admin.id)).toEqual([]);
      expect(await mfaCompletedAt(admin.id)).not.toBeNull();
      expect(await auditEvents()).toEqual([
        expect.objectContaining({
          event_type: 'recovery_code_rejected',
          outcome: 'failure',
          actor_user_id: admin.id,
          reason: 'not_eligible',
        }),
      ]);

      const owner = await enrolled('owner');
      const address = nextAddress();
      const challenge = await challengeFor(owner, address);
      await setPrincipal(pool, owner.id, 'disabled', true);

      const disabled = await post(VERIFY_CODE, { code: owner.recoveryCodes[0] }, { cookie: challenge }, address);

      expect(disabled.statusCode).toBe(401);
      expect(liveCookie(disabled, 'session_token')).toBeUndefined();
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await recoveries(owner.id)).toEqual([]);
    });

    it('admits at most one concurrent recovery for the Owner, and neither session reaches business routes', async () => {
      const owner = await enrolled('owner');
      const firstAddress = nextAddress();
      const secondAddress = nextAddress();
      const firstChallenge = await challengeFor(owner, firstAddress);
      const secondChallenge = await challengeFor(owner, secondAddress);

      const responses = await Promise.all([
        post(VERIFY_CODE, { code: owner.recoveryCodes[0] }, { cookie: firstChallenge }, firstAddress),
        post(VERIFY_CODE, { code: owner.recoveryCodes[1] }, { cookie: secondChallenge }, secondAddress),
      ]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
      const active = (await recoveries(owner.id)).filter((row) => !row.ended);
      expect(active).toHaveLength(1);
      expect(await sessionsOf(owner.id)).toEqual([active[0]!.session_id]);
      for (const response of responses) {
        const cookie = liveCookie(response, 'session_token');
        if (cookie) await expectNoBusinessAccess(cookie.split(';')[0]!);
      }
    });
  });

  describe('recovery-code rate limiting before any audit record', () => {
    const BUCKET = '/two-factor/verify-backup-code';
    const MALFORMED: unknown[] = [
      'ABCD-EFGH-JKMN',
      '0123456789ABCDEFGHJKMNPQRSTV',
      'Z'.repeat(65),
      'UUUU-UUUU-UUUU-UUUU-UUUU-UUUU',
      '!!!!-####-$$$$-%%%%-&&&&-****',
      12_345,
      '',
    ];

    async function bucketCount(address: string): Promise<number | null> {
      const { rows } = await pool.query<{ count: number }>(`SELECT count FROM dromex_rate_limit WHERE key = $1`, [
        `${address}|${BUCKET}`,
      ]);
      return rows[0]?.count ?? null;
    }

    async function rejectedFrom(address: string): Promise<AuditRow[]> {
      return (await auditEvents()).filter(
        (event) => event.event_type === 'recovery_code_rejected' && event.client_address === address,
      );
    }

    async function failedVerifications(userId: string): Promise<number> {
      const { rows } = await pool.query<{ failures: number }>(
        `SELECT "failedVerificationCount" AS failures FROM "twoFactor" WHERE "userId" = $1`,
        [userId],
      );
      return rows[0]!.failures;
    }

    function submittedSecrets(values: unknown[]): string[] {
      return values.filter((value): value is string => typeof value === 'string' && value.length >= 9);
    }

    it('refuses a sixth malformed recovery code at the limiter, so malformed codes add at most five audit rows', async () => {
      const owner = await enrolled('owner');
      const address = nextAddress();
      const challenge = await challengeFor(owner, address);

      const responses: LightMyRequestResponse[] = [];
      for (const code of MALFORMED) responses.push(await post(VERIFY_CODE, { code }, { cookie: challenge }, address));

      expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401, 401, 429, 429]);
      for (const response of responses.slice(0, 5)) expect(response.json()).toEqual({ error: 'invalid_code' });
      for (const response of responses.slice(5)) {
        expect(response.json()).toEqual({ error: 'too_many_requests' });
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
        expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(60);
      }
      expect(await bucketCount(address)).toBe(5);
      const rejected = await rejectedFrom(address);
      expect(rejected).toHaveLength(5);
      for (const event of rejected) {
        expect(event).toMatchObject({ outcome: 'failure', actor_user_id: null, recovery_id: null, reason: 'invalid_code' });
      }
      expect(await failedVerifications(owner.id)).toBe(0);
      const everything = `${JSON.stringify(await auditEvents())}\n${logs.join('')}`;
      for (const secret of submittedSecrets(MALFORMED)) expect(everything).not.toContain(secret);
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await recoveries(owner.id)).toEqual([]);
    });

    it('shares one bucket across malformed, invalid, incorrect, and reused codes, and writes no audit row once limited', async () => {
      const owner = await enrolled('owner');
      const [reused, unused] = owner.recoveryCodes;
      const signedOut = await post(SIGN_OUT, {}, { cookie: await enterRecovery(owner, reused!) });
      expect(signedOut.statusCode).toBe(200);
      const before = (await auditEvents()).length;

      const address = nextAddress();
      const challenge = await challengeFor(owner, address);
      const [unknown] = generateRecoveryCodes();
      const attempts: unknown[] = [
        MALFORMED[0],
        MALFORMED[3],
        unknown,
        reused,
        MALFORMED[5],
        unknown,
        reused,
        MALFORMED[4],
        unknown,
        MALFORMED[2],
        reused,
        unknown,
      ];

      const statuses: number[] = [];
      for (const code of attempts) {
        statuses.push((await post(VERIFY_CODE, { code }, { cookie: challenge }, address)).statusCode);
      }
      const blockedValid = await post(
        VERIFY_CODE,
        { code: unused },
        { cookie: await challengeFor(owner, nextAddress()) },
        address,
      );

      expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429, 429, 429, 429, 429, 429]);
      expect(blockedValid.statusCode).toBe(429);
      expect(await bucketCount(address)).toBe(5);
      expect(await rejectedFrom(address)).toHaveLength(5);
      expect((await auditEvents()).length - before).toBe(5);
      expect((await auditEvents()).map((event) => event.reason)).not.toContain('rate_limited');
      expect((await recoveries(owner.id)).filter((row) => !row.ended)).toEqual([]);
      expect(await storedCodes(owner.id)).toContain(unused);
      const everything = `${JSON.stringify(await auditEvents())}\n${logs.join('')}`;
      for (const secret of [unknown!, reused!, unused!, ...submittedSecrets(attempts)]) {
        expect(everything).not.toContain(secret);
      }
    });

    it('admits exactly five of many concurrent rejected attempts from one address, and audits only those five', async () => {
      const owner = await enrolled('owner');
      const address = nextAddress();
      const challenge = await challengeFor(owner, address);
      const [unknown] = generateRecoveryCodes();
      const attempts = Array.from({ length: 24 }, (_, index) =>
        index % 2 === 0 ? MALFORMED[index % MALFORMED.length] : unknown,
      );

      const responses = await Promise.all(
        attempts.map((code) => post(VERIFY_CODE, { code }, { cookie: challenge }, address)),
      );

      const statuses = responses.map((response) => response.statusCode);
      expect(statuses.filter((status) => status === 401)).toHaveLength(5);
      expect(statuses.filter((status) => status === 429)).toHaveLength(19);
      expect(await bucketCount(address)).toBe(5);
      expect(await rejectedFrom(address)).toHaveLength(5);
      expect(await auditEvents()).toHaveLength(5);
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await recoveries(owner.id)).toEqual([]);
    });

    it('keeps the bucket closed until the full 60-second window has passed, then admits only five more', async () => {
      const owner = await enrolled('owner');
      const address = nextAddress();
      const challenge = await challengeFor(owner, address);
      const malformed = () => post(VERIFY_CODE, { code: MALFORMED[0] }, { cookie: challenge }, address);
      const key = `${address}|${BUCKET}`;

      for (let attempt = 1; attempt <= 5; attempt += 1) expect((await malformed()).statusCode).toBe(401);
      expect((await malformed()).statusCode).toBe(429);

      await pool.query(`UPDATE dromex_rate_limit SET last_request_ms = last_request_ms - 58000 WHERE key = $1`, [key]);
      const nearlyElapsed = await malformed();
      expect(nearlyElapsed.statusCode).toBe(429);
      expect(Number(nearlyElapsed.headers['retry-after'])).toBeLessThanOrEqual(2);
      expect(await rejectedFrom(address)).toHaveLength(5);

      await pool.query(`UPDATE dromex_rate_limit SET last_request_ms = last_request_ms - 2000 WHERE key = $1`, [key]);
      expect((await malformed()).statusCode).toBe(401);
      expect(await bucketCount(address)).toBe(1);
      for (let attempt = 2; attempt <= 5; attempt += 1) expect((await malformed()).statusCode).toBe(401);
      expect((await malformed()).statusCode).toBe(429);

      expect(await bucketCount(address)).toBe(5);
      expect(await rejectedFrom(address)).toHaveLength(10);
    });

    it('never counts a malformed code toward the account lockout or the challenge attempt budget', async () => {
      const owner = await enrolled('owner');
      const address = nextAddress();
      const challenge = await challengeFor(owner, address);

      for (const code of MALFORMED.slice(0, 4)) {
        expect((await post(VERIFY_CODE, { code }, { cookie: challenge }, address)).statusCode).toBe(401);
      }
      expect(await failedVerifications(owner.id)).toBe(0);

      const accepted = await post(VERIFY_CODE, { code: owner.recoveryCodes[0] }, { cookie: challenge }, address);

      expect(accepted.statusCode).toBe(200);
      expect(await bucketCount(address)).toBe(5);
    });

    it('limits requests without a challenge without auditing them, and fails closed when the limiter cannot record', async () => {
      const owner = await enrolled('owner');
      const [unknown] = generateRecoveryCodes();
      const address = nextAddress();

      const foreign = await post(VERIFY_CODE, { code: MALFORMED[0] }, { origin: 'https://attacker.example' }, address);
      expect(foreign.statusCode).toBe(403);
      expect(await bucketCount(address)).toBeNull();

      const statuses: number[] = [];
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const code = attempt % 2 === 0 ? unknown : MALFORMED[attempt];
        statuses.push((await post(VERIFY_CODE, { code }, {}, address)).statusCode);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
      expect(await bucketCount(address)).toBe(5);
      expect(await auditEvents()).toEqual([]);

      const failing = nextAddress();
      const challenge = await challengeFor(owner, failing);
      const restore = await refuseWith('dromex_rate_limit', 'INSERT');
      let refused: LightMyRequestResponse[];
      try {
        refused = [
          await post(VERIFY_CODE, { code: MALFORMED[3] }, { cookie: challenge }, failing),
          await post(VERIFY_CODE, { code: unknown }, { cookie: challenge }, failing),
          await post(VERIFY_CODE, { code: owner.recoveryCodes[0] }, { cookie: challenge }, failing),
        ];
      } finally {
        await restore();
      }

      for (const response of refused) {
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: 'internal_error' });
        expect(liveCookie(response, 'session_token')).toBeUndefined();
      }
      expect(await auditEvents()).toEqual([]);
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await recoveries(owner.id)).toEqual([]);
      expect(await storedCodes(owner.id)).toEqual(owner.recoveryCodes);
    });

    it('treats a server fault inside verification as a 500, auditing nothing, after the attempt was counted', async () => {
      const owner = await enrolled('owner');
      const address = nextAddress();
      const challenge = await challengeFor(owner, address);
      const [unknown] = generateRecoveryCodes();
      const restore = await refuseWith('"twoFactor"', 'UPDATE');

      let response: LightMyRequestResponse;
      try {
        response = await post(VERIFY_CODE, { code: unknown }, { cookie: challenge }, address);
      } finally {
        await restore();
      }

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(liveCookie(response, 'session_token')).toBeUndefined();
      expect(await bucketCount(address)).toBe(1);
      expect(await auditEvents()).toEqual([]);
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await recoveries(owner.id)).toEqual([]);
    });
  });

  describe('one recovery at a time', () => {
    it('refuses a second valid recovery code while a recovery is already in progress for the Owner', async () => {
      // Sequential on purpose: Better Auth's own compare-and-swap on the code
      // list can reject a truly concurrent second code before DROMEX runs, so
      // only a second code submitted after the first recovery exists proves
      // the database's one-open-recovery rule.
      const owner = await enrolled('owner');
      const firstCookie = await enterRecovery(owner, owner.recoveryCodes[0]!);
      const [firstSession] = await sessionsOf(owner.id);

      const second = await recoveryCodeStep(owner, owner.recoveryCodes[1]!);

      expect(second.statusCode).toBe(401);
      expect(second.json()).toEqual({ error: 'invalid_code' });
      expect(liveCookie(second, 'session_token')).toBeUndefined();
      const open = (await recoveries(owner.id)).filter((row) => !row.ended);
      expect(open).toEqual([expect.objectContaining({ step: 'code_accepted', session_id: firstSession })]);
      expect(await sessionsOf(owner.id)).toEqual([firstSession]);
      const rejected = (await auditEvents()).filter((event) => event.event_type === 'recovery_code_rejected');
      expect(rejected).toEqual([
        expect.objectContaining({ outcome: 'failure', actor_user_id: owner.id, reason: 'recovery_in_progress' }),
      ]);
      expect((await startReplacementWith(firstCookie, owner.password)).statusCode).toBe(200);
    });
  });

  describe('the restricted recovery state', () => {
    it('expires within five minutes, then fails closed, ends the recovery, and revokes its session', async () => {
      const owner = await enrolled('owner');
      const cookie = await enterRecovery(owner);
      await pool.query(
        `UPDATE dromex_owner_recovery
            SET created_at = created_at - interval '301 seconds', expires_at = expires_at - interval '301 seconds'
          WHERE user_id = $1`,
        [owner.id],
      );

      const response = await startReplacementWith(cookie, owner.password);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual(UNAUTHORIZED);
      expect(await recoveries(owner.id)).toEqual([expect.objectContaining({ step: 'expired', ended: true })]);
      expect(await sessionsOf(owner.id)).toEqual([]);
      const events = (await auditEvents()).map((event) => event.event_type);
      expect(events).toContain('recovery_expired');
      expect(events).not.toContain('terminal_recovery_required');
      expect(await factorState(owner.id)).toMatchObject({ enabled: true, verified: true });

      await expect(
        pool.query(`UPDATE dromex_owner_recovery SET expires_at = created_at + interval '301 seconds'`),
      ).rejects.toThrow();
    });

    it('fails closed for a missing, malformed, ordinary, or unbound session', async () => {
      const owner = await enrolled('owner');
      const admin = await enrolled('admin', false);
      const adminCookie = namedCookie(await signInWith(admin, admin.totp), 'session_token');
      const recoveryCookie = await enterRecovery(owner);

      const outcomes = [
        await post(START, { password: owner.password }),
        await startReplacementWith('__Secure-better-auth.session_token=not-a-real-signed-token', owner.password),
        await startReplacementWith(adminCookie, admin.password),
      ];
      await pool.query(`UPDATE dromex_owner_recovery SET session_id = 'not-this-session' WHERE user_id = $1`, [owner.id]);
      outcomes.push(await startReplacementWith(recoveryCookie, owner.password));

      for (const response of outcomes) {
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual(UNAUTHORIZED);
      }
      expect(await factorState(owner.id)).toMatchObject({ enabled: true, verified: true });
    });

    it('fails closed, and ends the recovery, when the Owner principal is disabled mid-recovery', async () => {
      const owner = await enrolled('owner');
      const cookie = await enterRecovery(owner);
      await setPrincipal(pool, owner.id, 'disabled', true);

      const response = await startReplacementWith(cookie, owner.password);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual(UNAUTHORIZED);
      expect(await recoveries(owner.id)).toEqual([expect.objectContaining({ ended: true })]);
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await factorState(owner.id)).toMatchObject({ enabled: true, verified: true });
    });

    it('accepts the start step only once, even when it is submitted concurrently', async () => {
      const owner = await enrolled('owner');
      const cookie = await enterRecovery(owner);

      const responses = await Promise.all([
        startReplacementWith(cookie, owner.password),
        startReplacementWith(cookie, owner.password),
      ]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
      const winner = responses.find((response) => response.statusCode === 200)!;
      const again = await startReplacementWith(namedCookie(winner, 'session_token'), owner.password);
      expect(again.statusCode).toBe(401);
      expect(again.json()).toEqual(UNAUTHORIZED);
    });

    it('claims the start step atomically when two starts have both already passed the recovery gate', async () => {
      const owner = await enrolled('owner');
      const cookie = await enterRecovery(owner);

      // Hold the recovery row so both requests pass the gate and then queue at
      // the claim. From there, only an atomic, step-checked claim lets exactly
      // one of them go on to disable the factor.
      const holder = await pool.connect();
      let responses: LightMyRequestResponse[];
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT id FROM dromex_owner_recovery WHERE user_id = $1 FOR UPDATE`, [owner.id]);
        const pending = Promise.all([
          startReplacementWith(cookie, owner.password),
          startReplacementWith(cookie, owner.password),
        ]);
        pending.catch(() => undefined);

        const deadline = Date.now() + 15_000;
        for (;;) {
          const { rows } = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query ILIKE '%update dromex_owner_recovery%'`,
          );
          if (rows[0]!.n >= 2) break;
          if (Date.now() > deadline) throw new Error('both start requests never reached the claim');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }

        await holder.query('COMMIT');
        responses = await pending;
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
      expect(responses.find((response) => response.statusCode === 401)!.json()).toEqual(UNAUTHORIZED);
      expect(await recoveries(owner.id)).toEqual([
        expect.objectContaining({ step: 'enrolment_started', ended: false, factor_disabled: true }),
      ]);
      const types = (await auditEvents()).map((event) => event.event_type);
      expect(types.filter((type) => type === 'replacement_started')).toHaveLength(1);
      expect(types.filter((type) => type === 'old_factor_disabled')).toHaveLength(1);
      expect(types).not.toContain('replacement_failed');
    });

    it('refuses the claim when the recovery expires after the gate admitted the start', async () => {
      const owner = await enrolled('owner');
      const cookie = await enterRecovery(owner);

      // Hold the recovery row so the start passes the gate and then queues at
      // the claim; expire the recovery in that same transaction, then release.
      const holder = await pool.connect();
      let response: LightMyRequestResponse;
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT id FROM dromex_owner_recovery WHERE user_id = $1 FOR UPDATE`, [owner.id]);
        const pending = startReplacementWith(cookie, owner.password);
        pending.catch(() => undefined);

        const deadline = Date.now() + 15_000;
        for (;;) {
          const { rows } = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query ILIKE '%update dromex_owner_recovery%'`,
          );
          if (rows[0]!.n >= 1) break;
          if (Date.now() > deadline) throw new Error('the start request never reached the claim');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }

        await holder.query(
          `UPDATE dromex_owner_recovery
              SET created_at = created_at - interval '301 seconds', expires_at = expires_at - interval '301 seconds'
            WHERE user_id = $1`,
          [owner.id],
        );
        await holder.query('COMMIT');
        response = await pending;
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual(UNAUTHORIZED);
      expect(await factorState(owner.id)).toMatchObject({ enabled: true, verified: true });
      const types = (await auditEvents()).map((event) => event.event_type);
      expect(types).not.toContain('replacement_started');
      expect(types).not.toContain('old_factor_disabled');
    });

    it('ends the recovery on a wrong password, leaving the old factor in place but ordinary access closed', async () => {
      const owner = await enrolled('owner');
      const cookie = await enterRecovery(owner);

      const response = await startReplacementWith(cookie, 'a synthetic wrong passphrase');

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'recovery_failed' });
      expect(await recoveries(owner.id)).toEqual([expect.objectContaining({ step: 'failed', ended: true })]);
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await factorState(owner.id)).toMatchObject({ enabled: true, verified: true });
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect((await signInWith(owner, owner.totp)).statusCode).toBe(401);
      expect(await sessionsOf(owner.id)).toEqual([]);
    });
  });

  describe('authenticator replacement', () => {
    it('replaces the factor through Better Auth while every route but recovery stays closed', async () => {
      const owner = await enrolled('owner');
      const recoveryCookie = await enterRecovery(owner);
      const before = await factorState(owner.id);

      const [response, ...probes] = await Promise.all([
        startReplacementWith(recoveryCookie, owner.password),
        ...BUSINESS_PROBES.map((url) => get(url, recoveryCookie)),
      ]);

      for (const probe of probes) expect(probe.statusCode).toBe(401);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.json() as { totpUri: string; manualEntrySecret: string };
      expect(Object.keys(body).sort()).toEqual(['manualEntrySecret', 'totpUri']);
      const uri = new URL(body.totpUri);
      expect(uri.protocol).toBe('otpauth:');
      expect(uri.host).toBe('totp');
      expect(decodeURIComponent(uri.pathname)).toBe(`/DROMEX:${owner.email}`);
      expect(uri.searchParams.get('issuer')).toBe('DROMEX');
      expect(uri.searchParams.get('digits')).toBe('6');
      expect(uri.searchParams.get('period')).toBe('30');
      expect(body.manualEntrySecret).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{1,4})+$/);
      expect(body.manualEntrySecret.replaceAll('-', '')).toBe(uri.searchParams.get('secret'));

      const enrolmentCookie = namedCookie(response, 'session_token');
      expect(enrolmentCookie).not.toBe(recoveryCookie);
      const after = await factorState(owner.id);
      expect(after).toMatchObject({ enabled: false, verified: false });
      expect(after.secret).not.toBe(before.secret);
      for (const code of await storedCodes(owner.id)) expect(owner.recoveryCodes).not.toContain(code);
      const sessions = await sessionsOf(owner.id);
      expect(sessions).toHaveLength(1);
      expect(await recoveries(owner.id)).toEqual([
        expect.objectContaining({ step: 'enrolment_started', factor_disabled: true, ended: false, session_id: sessions[0] }),
      ]);
      expect((await pool.query(`SELECT count(*)::int AS n FROM dromex_recovery_session`)).rows).toEqual([{ n: 2 }]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();

      expect((await startReplacementWith(recoveryCookie, owner.password)).statusCode).toBe(401);
      await expectNoBusinessAccess(enrolmentCookie);
      const passwordOnly = await post(SIGN_IN, { email: owner.email, password: owner.password }, {}, nextAddress());
      expect(passwordOnly.statusCode).toBe(401);
      expect(await sessionsOf(owner.id)).toEqual(sessions);
    });

    it('completes only with a valid new code, invalidates the old factor and codes, and requires a fresh sign-in', async () => {
      const owner = await enrolled('owner');
      const replacement = await startReplacement(owner);
      const address = nextAddress();

      const rejected = await verifyNew(replacement.enrolmentCookie, wrongCode(replacement.sequence.secret), address);
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json()).toEqual({ error: 'invalid_code' });
      expect(await recoveries(owner.id)).toEqual([expect.objectContaining({ verify_attempts: 1, ended: false })]);

      await waitForFreshStep();
      const newCode = await replacement.sequence.next();
      const [done, ...probes] = await Promise.all([
        verifyNew(replacement.enrolmentCookie, newCode, address),
        ...BUSINESS_PROBES.map((url) => get(url, replacement.enrolmentCookie)),
      ]);

      for (const probe of probes) expect(probe.statusCode).toBe(401);
      expect(done.statusCode).toBe(200);
      expect(done.headers['cache-control']).toBe('no-store');
      const body = done.json() as { recoveryCodes: string[]; signInRequired: boolean };
      expect(Object.keys(body).sort()).toEqual(['recoveryCodes', 'signInRequired']);
      expect(body.signInRequired).toBe(true);
      expect(body.recoveryCodes).toHaveLength(10);
      expect(new Set(body.recoveryCodes).size).toBe(10);
      for (const code of body.recoveryCodes) {
        expect(code).toMatch(CANONICAL_CODE);
        expect(owner.recoveryCodes).not.toContain(code);
      }
      expect(await storedCodes(owner.id)).toEqual(body.recoveryCodes);
      expect(liveCookie(done, 'session_token')).toBeUndefined();

      expect(await mfaCompletedAt(owner.id)).not.toBeNull();
      expect(await factorState(owner.id)).toMatchObject({ enabled: true, verified: true });
      expect(await recoveries(owner.id)).toEqual([expect.objectContaining({ step: 'completed', ended: true })]);
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect((await get('/api/session', replacement.enrolmentCookie)).statusCode).toBe(401);

      const replayAddress = nextAddress();
      const replay = await post(VERIFY_TOTP, { code: newCode }, { cookie: await challengeFor(owner, replayAddress) }, replayAddress);
      expect(replay.statusCode).toBe(401);
      expect(await sessionsOf(owner.id)).toEqual([]);

      const signedIn = await signInWith(owner, replacement.sequence);
      expect(signedIn.statusCode).toBe(200);
      expect(signedIn.json()).toEqual({ authenticated: true });
      const session = await get('/api/session', namedCookie(signedIn, 'session_token'));
      expect(session.json()).toMatchObject({ isOwner: true, user: { id: owner.id } });

      expect((await signInWith(owner, owner.totp)).statusCode).toBe(401);
      expect((await recoveryCodeStep(owner, owner.recoveryCodes[1]!)).statusCode).toBe(401);

      const [firstNew] = body.recoveryCodes;
      expect((await recoveryCodeStep(owner, firstNew!)).statusCode).toBe(200);
      expect(await storedCodes(owner.id)).toEqual(body.recoveryCodes.slice(1));
      expect((await recoveryCodeStep(owner, firstNew!)).statusCode).toBe(401);
    });

    it('fails closed after five wrong new codes, requiring terminal recovery', async () => {
      const owner = await enrolled('owner');
      const replacement = await startReplacement(owner);
      const address = nextAddress();
      const wrong = wrongCode(replacement.sequence.secret);

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const response = await verifyNew(replacement.enrolmentCookie, wrong, address);
        expect(response.statusCode, `attempt ${attempt}`).toBe(401);
        expect(response.json()).toEqual({ error: 'invalid_code' });
      }
      const fifth = await verifyNew(replacement.enrolmentCookie, wrong, address);

      expect(fifth.statusCode).toBe(401);
      expect(fifth.json()).toEqual({ error: 'recovery_failed' });
      expect(await recoveries(owner.id)).toEqual([
        expect.objectContaining({ step: 'failed', ended: true, verify_attempts: 5, factor_disabled: true }),
      ]);
      expect(await sessionsOf(owner.id)).toEqual([]);
      const late = await verifyNew(replacement.enrolmentCookie, await replacement.sequence.next());
      expect(late.statusCode).toBe(401);
      expect(late.json()).toEqual(UNAUTHORIZED);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect((await post(SIGN_IN, { email: owner.email, password: owner.password }, {}, nextAddress())).statusCode).toBe(401);
      expect(await sessionsOf(owner.id)).toEqual([]);
      const events = await auditEvents();
      expect(events.find((event) => event.event_type === 'replacement_failed')).toMatchObject({ reason: 'attempts_exhausted' });
      expect(events.map((event) => event.event_type)).toContain('terminal_recovery_required');
    });

    it('never completes the recovery with a new code the replay guard has already seen', async () => {
      const owner = await enrolled('owner');
      const replacement = await startReplacement(owner);
      const code = await replacement.sequence.next();
      expect(await createTotpReplayGuard(pool).record(owner.id, code)).toBe('accepted');

      const response = await verifyNew(replacement.enrolmentCookie, code);

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(liveCookie(response, 'session_token')).toBeUndefined();
      expect(await recoveries(owner.id)).toEqual([
        expect.objectContaining({ step: 'failed', ended: true, factor_disabled: true }),
      ]);
      const events = await auditEvents();
      expect(events.find((event) => event.event_type === 'replacement_failed')).toMatchObject({ reason: 'code_not_recorded' });
      expect(events.map((event) => event.event_type)).not.toContain('replacement_completed');
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await sessionsOf(owner.id)).toEqual([]);
    });

    it('keeps business access blocked when replacement is abandoned after the old factor is disabled', async () => {
      const owner = await enrolled('owner');
      const replacement = await startReplacement(owner);

      const signedOut = await post(SIGN_OUT, {}, { cookie: replacement.enrolmentCookie });

      expect(signedOut.statusCode).toBe(200);
      expect(signedOut.json()).toEqual({ signedOut: true });
      expect(await recoveries(owner.id)).toEqual([expect.objectContaining({ step: 'abandoned', ended: true })]);
      const events = (await auditEvents()).map((event) => event.event_type);
      expect(events).toContain('recovery_abandoned');
      expect(events).toContain('terminal_recovery_required');
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await factorState(owner.id)).toMatchObject({ enabled: false });

      const passwordOnly = await post(SIGN_IN, { email: owner.email, password: owner.password }, {}, nextAddress());
      expect(passwordOnly.statusCode).toBe(401);
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect((await verifyNew(replacement.enrolmentCookie, await replacement.sequence.next())).statusCode).toBe(401);
    });

    it('keeps business access blocked when replacement expires after the old factor is disabled', async () => {
      const owner = await enrolled('owner');
      const replacement = await startReplacement(owner);
      await pool.query(
        `UPDATE dromex_owner_recovery
            SET created_at = created_at - interval '301 seconds', expires_at = expires_at - interval '301 seconds'
          WHERE user_id = $1`,
        [owner.id],
      );

      const response = await verifyNew(replacement.enrolmentCookie, await replacement.sequence.next());

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual(UNAUTHORIZED);
      expect(await recoveries(owner.id)).toEqual([expect.objectContaining({ step: 'expired', ended: true })]);
      const events = (await auditEvents()).map((event) => event.event_type);
      expect(events).toContain('recovery_expired');
      expect(events).toContain('terminal_recovery_required');
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await factorState(owner.id)).toMatchObject({ enabled: false });
    });
  });

  describe('partial failure', () => {
    it('releases no session and changes nothing when the recovery state cannot be recorded', async () => {
      const owner = await enrolled('owner');
      const restore = await refuseWith('dromex_owner_recovery', 'INSERT');

      let response: LightMyRequestResponse;
      try {
        response = await recoveryCodeStep(owner, owner.recoveryCodes[0]!);
      } finally {
        await restore();
      }

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(liveCookie(response, 'session_token')).toBeUndefined();
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await recoveries(owner.id)).toEqual([]);
      expect(await mfaCompletedAt(owner.id)).not.toBeNull();
      expect((await signInWith(owner, owner.totp)).statusCode).toBe(200);
    });

    it('never restores ordinary access when completion cannot be recorded', async () => {
      const owner = await enrolled('owner');
      const replacement = await startReplacement(owner);
      const restore = await refuseWith('dromex_principal', 'UPDATE');

      let response: LightMyRequestResponse;
      try {
        response = await verifyNew(replacement.enrolmentCookie, await replacement.sequence.next());
      } finally {
        await restore();
      }

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(liveCookie(response, 'session_token')).toBeUndefined();
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await recoveries(owner.id)).toEqual([expect.objectContaining({ step: 'failed', ended: true })]);
      const events = await auditEvents();
      expect(events.find((event) => event.event_type === 'replacement_failed')).toMatchObject({ reason: 'completion_failed' });
      expect(events.map((event) => event.event_type)).toContain('terminal_recovery_required');
      expect((await signInWith(owner, replacement.sequence)).statusCode).toBe(401);
      expect(await sessionsOf(owner.id)).toEqual([]);
    });

    it('refuses completion when the Owner is disabled after the gate admitted the new code', async () => {
      const owner = await enrolled('owner');
      const replacement = await startReplacement(owner);
      const code = await replacement.sequence.next();

      // Hold the principal row so the verification passes the gate and then
      // queues at completion; disable the Owner in that transaction, then release.
      const holder = await pool.connect();
      let response: LightMyRequestResponse;
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT user_id FROM dromex_principal WHERE user_id = $1 FOR UPDATE`, [owner.id]);
        const pending = verifyNew(replacement.enrolmentCookie, code);
        pending.catch(() => undefined);

        const deadline = Date.now() + 15_000;
        for (;;) {
          const { rows } = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query ILIKE '%update dromex_principal set mfa_completed_at%'`,
          );
          if (rows[0]!.n >= 1) break;
          if (Date.now() > deadline) throw new Error('the verification never reached completion');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }

        await holder.query(`UPDATE dromex_principal SET status = 'disabled' WHERE user_id = $1`, [owner.id]);
        await holder.query('COMMIT');
        response = await pending;
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(response.body).not.toMatch(/[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}/);
      expect(await recoveries(owner.id)).toEqual([expect.objectContaining({ step: 'failed', ended: true })]);
      const events = await auditEvents();
      expect(events.find((event) => event.event_type === 'replacement_failed')).toMatchObject({ reason: 'completion_failed' });
      expect(events.map((event) => event.event_type)).not.toContain('replacement_completed');
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await sessionsOf(owner.id)).toEqual([]);
    });

    it('treats a factor Better Auth removed before failing as disabled, requiring terminal recovery', async () => {
      const owner = await enrolled('owner');
      const cookie = await enterRecovery(owner);
      const restore = await refuseWith('"session"', 'INSERT');

      let response: LightMyRequestResponse;
      try {
        response = await startReplacementWith(cookie, owner.password);
      } finally {
        await restore();
      }

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(liveCookie(response, 'session_token')).toBeUndefined();
      expect(await factorState(owner.id)).toMatchObject({ enabled: false });
      expect(await recoveries(owner.id)).toEqual([
        expect.objectContaining({ step: 'failed', ended: true, factor_disabled: true }),
      ]);
      expect((await auditEvents()).map((event) => event.event_type)).toContain('terminal_recovery_required');
      expect(await sessionsOf(owner.id)).toEqual([]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
    });
  });

  describe('security audit', () => {
    it('records every step of a completed recovery, in order, and no secret anywhere', async () => {
      const owner = await enrolled('owner');
      const replacement = await startReplacement(owner);
      const wrong = wrongCode(replacement.sequence.secret);
      expect((await verifyNew(replacement.enrolmentCookie, wrong)).statusCode).toBe(401);
      await waitForFreshStep();
      const newCode = await replacement.sequence.next();
      const done = await verifyNew(replacement.enrolmentCookie, newCode);
      expect(done.statusCode).toBe(200);
      const newCodes = (done.json() as { recoveryCodes: string[] }).recoveryCodes;

      const events = await auditEvents();

      expect(events.map((event) => [event.event_type, event.outcome])).toEqual([
        ['recovery_code_accepted', 'success'],
        ['recovery_session_created', 'success'],
        ['other_sessions_revoked', 'success'],
        ['replacement_started', 'success'],
        ['old_factor_disabled', 'success'],
        ['new_totp_rejected', 'failure'],
        ['new_totp_verified', 'success'],
        ['replacement_completed', 'success'],
        ['recovery_sessions_revoked', 'success'],
      ]);
      const [recovery] = await recoveries(owner.id);
      for (const event of events) {
        expect(event.actor_user_id).toBe(owner.id);
        expect(event.actor_name).toBe(owner.name);
        expect(event.recovery_id).toBe(recovery!.id);
        expect(event.client_address).toMatch(/^[0-9a-f:.]+$/);
      }
      expect(events.find((event) => event.event_type === 'other_sessions_revoked')!.revoked_session_count).toBe(0);
      expect(events.find((event) => event.event_type === 'recovery_sessions_revoked')!.revoked_session_count).toBe(1);
      expect(events.find((event) => event.event_type === 'new_totp_rejected')!.reason).toBe('invalid_code');

      const audited = JSON.stringify(events);
      for (const value of [wrong, newCode]) expect(audited).not.toContain(value);
      const everything = `${audited}\n${logs.join('')}`;
      expect(logs.length).toBeGreaterThan(0);
      for (const secret of [
        owner.password,
        owner.totpSecret,
        replacement.sequence.secret,
        replacement.body.manualEntrySecret,
        ...owner.recoveryCodes,
        ...newCodes,
        replacement.recoveryCookie.split('=')[1]!,
        replacement.enrolmentCookie.split('=')[1]!,
        replacement.enrolmentCookie.split('=')[1]!.split('.')[0]!,
      ]) {
        expect(everything).not.toContain(secret);
      }
    });

    it('records a rejected recovery code without the code or any identity it cannot prove', async () => {
      const owner = await enrolled('owner');
      const [unknown] = generateRecoveryCodes();

      const response = await recoveryCodeStep(owner, unknown!);

      expect(response.statusCode).toBe(401);
      const events = await auditEvents();
      expect(events).toEqual([
        {
          event_type: 'recovery_code_rejected',
          outcome: 'failure',
          actor_user_id: null,
          actor_name: null,
          recovery_id: null,
          reason: 'invalid_code',
          revoked_session_count: null,
          client_address: expect.stringMatching(/^[0-9a-f:.]+$/),
        },
      ]);
      expect(JSON.stringify(events)).not.toContain(unknown!);
      expect(logs.join('')).not.toContain(unknown!);
    });

    it('is append-only for ordinary application SQL, with no free-form column', async () => {
      await pool.query(`INSERT INTO dromex_audit_event (event_type, outcome) VALUES ('recovery_code_rejected', 'failure')`);

      for (const sql of [
        `UPDATE dromex_audit_event SET reason = 'tampered'`,
        `DELETE FROM dromex_audit_event`,
        `TRUNCATE dromex_audit_event`,
      ]) {
        await expect(pool.query(sql), sql).rejects.toThrow(/append-only/);
      }
      expect((await pool.query(`SELECT reason FROM dromex_audit_event`)).rows).toEqual([{ reason: null }]);

      const { rows: privileges } = await pool.query(
        `SELECT has_table_privilege('public', 'dromex_audit_event', 'UPDATE') AS update_allowed,
                has_table_privilege('public', 'dromex_audit_event', 'DELETE') AS delete_allowed,
                has_table_privilege('public', 'dromex_audit_event', 'TRUNCATE') AS truncate_allowed`,
      );
      expect(privileges).toEqual([{ update_allowed: false, delete_allowed: false, truncate_allowed: false }]);

      const { rows: columns } = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'dromex_audit_event' ORDER BY column_name`,
      );
      expect(columns).toEqual([
        { column_name: 'actor_name', data_type: 'text' },
        { column_name: 'actor_user_id', data_type: 'text' },
        { column_name: 'client_address', data_type: 'text' },
        { column_name: 'event_type', data_type: 'text' },
        { column_name: 'id', data_type: 'bigint' },
        // DEC-437 (migration 0007): both pattern-constrained, neither free-form.
        { column_name: 'incident_reference', data_type: 'text' },
        { column_name: 'occurred_at', data_type: 'timestamp with time zone' },
        { column_name: 'outcome', data_type: 'text' },
        { column_name: 'reason', data_type: 'text' },
        { column_name: 'recovery_id', data_type: 'bigint' },
        { column_name: 'revoked_session_count', data_type: 'integer' },
        { column_name: 'terminal_recovery_id', data_type: 'bigint' },
      ]);

      for (const sql of [
        `INSERT INTO dromex_audit_event (event_type, outcome) VALUES ('anything_else', 'failure')`,
        `INSERT INTO dromex_audit_event (event_type, outcome) VALUES ('recovery_code_rejected', 'maybe')`,
        `INSERT INTO dromex_audit_event (event_type, outcome, reason) VALUES ('recovery_code_rejected', 'failure', 'ABCD-EFGH-JKMN')`,
        `INSERT INTO dromex_audit_event (event_type, outcome, revoked_session_count) VALUES ('other_sessions_revoked', 'success', -1)`,
        `INSERT INTO dromex_audit_event (event_type, outcome, client_address) VALUES ('recovery_code_rejected', 'failure', '198.51.100.1; select 1')`,
      ]) {
        await expect(pool.query(sql), sql).rejects.toThrow();
      }
    });
  });
});
