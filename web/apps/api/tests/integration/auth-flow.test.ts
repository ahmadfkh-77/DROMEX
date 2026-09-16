import { Writable } from 'node:stream';

import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Pool, types } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DROMEX_CLIENT_IP_HEADER,
  createAuthOptions,
  createTwoFactorPlugin,
  type AuthSettings,
} from '../../src/auth/config.ts';
import { createAuth } from '../../src/auth/instance.ts';
import { buildServer } from '../../src/server.ts';
import {
  cookiePair,
  enrollSyntheticMfa,
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  twoFactorRowsMissingRuntimeDefaults,
  type EnrolledUser,
} from '../helpers/auth-fixtures.ts';
import {
  TEST_BASE_URL,
  TEST_TRUSTED_ORIGIN,
  settle,
  syntheticAuthSettings,
  syntheticSecret,
} from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';
import { totpCode, waitForFreshStep, wrongCode } from '../helpers/totp.ts';

// Every test gets its own disposable database, so rate-limit, lockout, and
// replay state from one test can never leak into another.

let database: EphemeralDatabase;
let pool: Pool;
let settings: AuthSettings;
let app: FastifyInstance;
const servers: FastifyInstance[] = [];

async function startServer(logStream?: Writable, auth: AuthSettings = settings): Promise<FastifyInstance> {
  const server = await buildServer({ databaseUrl: database.uri, auth, logStream });
  await server.ready();
  servers.push(server);
  return server;
}

function passwordStep(
  server: FastifyInstance,
  email: string,
  password: string,
  headers: Record<string, string> = {},
  remoteAddress?: string,
) {
  return server.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    remoteAddress,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', ...headers },
    payload: { email, password },
  });
}

function totpStep(
  server: FastifyInstance,
  challenge: string,
  code: string,
  headers: Record<string, string> = {},
  remoteAddress?: string,
) {
  return server.inject({
    method: 'POST',
    url: '/api/auth/two-factor/verify-totp',
    remoteAddress,
    headers: {
      origin: TEST_TRUSTED_ORIGIN,
      'content-type': 'application/json',
      cookie: challenge,
      ...headers,
    },
    payload: { code },
  });
}

function setCookies(response: LightMyRequestResponse): string[] {
  const header = response.headers['set-cookie'];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

function namedCookie(response: LightMyRequestResponse, fragment: string): string {
  const cookie = setCookies(response).find(
    (value) => value.split('=')[0]!.includes(fragment) && !/Max-Age=0/i.test(value),
  );
  if (!cookie) throw new Error(`expected a ${fragment} cookie`);
  return cookie.split(';')[0]!;
}

const challengeCookie = (response: LightMyRequestResponse) => namedCookie(response, 'two_factor');
const sessionCookie = (response: LightMyRequestResponse) => namedCookie(response, 'session_token');

async function challengeFor(user: EnrolledUser, remoteAddress?: string, server = app): Promise<string> {
  const response = await passwordStep(server, user.email, user.password, {}, remoteAddress);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ mfaRequired: true });
  return challengeCookie(response);
}

async function signIn(server: FastifyInstance, user: EnrolledUser, remoteAddress?: string) {
  const challenge = await challengeFor(user, remoteAddress, server);
  return totpStep(server, challenge, await user.totp.next(), {}, remoteAddress);
}

function getSession(server: FastifyInstance, cookie?: string) {
  return server.inject({ method: 'GET', url: '/api/session', headers: cookie ? { cookie } : {} });
}

async function countRows(table: string, where = '', values: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "${table}" ${where}`,
    values,
  );
  return rows[0]!.n;
}

async function activeUser(label: string, isOwner = false, auth = settings): Promise<EnrolledUser> {
  const user = await provisionSyntheticUser(pool, auth, label);
  await setPrincipal(pool, user.id, 'active', isOwner);
  return enrollSyntheticMfa(pool, auth, user);
}

describe('authentication flow against PostgreSQL 18.6', () => {
  let migrated = false;

  beforeEach(async () => {
    database = await createEphemeralDatabase();
    pool = new Pool({ connectionString: database.uri, max: 20 });
    await migrateAuthSchema(pool);
    migrated = true;
    settings = syntheticAuthSettings();
    app = await startServer();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await settle();
    let incomplete = 0;
    try {
      while (servers.length > 0) await servers.pop()?.close();
      // Every transport flow here — enrolment fixtures, failures, lockout,
      // success, rotation — may leave only twoFactor rows that Better Auth's
      // adapter wrote with its runtime defaults.
      if (migrated) incomplete = await twoFactorRowsMissingRuntimeDefaults(pool);
    } finally {
      migrated = false;
      await pool?.end().catch(() => undefined);
      await database?.drop().catch(() => undefined);
    }
    expect(incomplete, 'twoFactor rows without runtime defaults').toBe(0);
  });

  describe('password step', () => {
    it('turns a correct password into an MFA challenge and issues no session yet', async () => {
      const user = await activeUser('challenge');

      const response = await passwordStep(app, user.email, user.password);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ mfaRequired: true });
      expect(setCookies(response).map((cookie) => cookie.split('=')[0])).toEqual([
        '__Secure-better-auth.two_factor',
      ]);
      expect(await countRows('session')).toBe(0);
    });

    it('issues a Secure, HttpOnly, SameSite=Lax challenge cookie that lasts five minutes', async () => {
      const user = await activeUser('challenge-cookie');

      const cookie = setCookies(await passwordStep(app, user.email, user.password))[0]!;

      expect(cookie).toMatch(/;\s*Max-Age=300/i);
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
      expect(cookie).toMatch(/;\s*Path=\//i);
    });

    it('issues nothing when the principal is missing or disabled', async () => {
      const orphan = await provisionSyntheticUser(pool, settings, 'orphan');
      const disabled = await activeUser('disabled');
      await setPrincipal(pool, disabled.id, 'disabled');

      for (const user of [orphan, disabled]) {
        const response = await passwordStep(app, user.email, user.password);
        expect(response.statusCode).toBe(401);
        expect(setCookies(response)).toEqual([]);
      }
      expect(await countRows('session')).toBe(0);
    });

    it('makes unknown email, wrong password, missing principal, disabled principal, and incomplete MFA indistinguishable', async () => {
      const active = await activeUser('known');
      const orphan = await provisionSyntheticUser(pool, settings, 'orphan');
      const disabled = await activeUser('off');
      await setPrincipal(pool, disabled.id, 'disabled');
      const unenrolled = await provisionSyntheticUser(pool, settings, 'unenrolled');
      await setPrincipal(pool, unenrolled.id, 'active');

      const outcomes = [
        await passwordStep(app, 'nobody-here@synthetic.invalid', 'a synthetic wrong passphrase'),
        await passwordStep(app, active.email, 'a synthetic wrong passphrase'),
        await passwordStep(app, orphan.email, orphan.password),
        await passwordStep(app, disabled.email, disabled.password),
        await passwordStep(app, unenrolled.email, unenrolled.password),
      ].map((response) => ({ status: response.statusCode, body: response.body, cookies: setCookies(response) }));

      for (const outcome of outcomes) {
        expect(outcome).toEqual({ status: 401, body: JSON.stringify({ error: 'invalid_credentials' }), cookies: [] });
      }
    });

    it('never leaves a usable password-only session for an account without mandatory MFA', async () => {
      const unenrolled = await provisionSyntheticUser(pool, settings, 'password-only');
      await setPrincipal(pool, unenrolled.id, 'active');

      const response = await passwordStep(app, unenrolled.email, unenrolled.password);

      expect(response.statusCode).toBe(401);
      expect(await countRows('session')).toBe(0);
    });

    it('refuses a second sign-in while a fully authenticated session is present', async () => {
      const user = await activeUser('twice');
      const cookie = sessionCookie(await signIn(app, user));

      const second = await passwordStep(app, user.email, user.password, { cookie });

      expect(second.statusCode).toBe(403);
      expect(await countRows('session')).toBe(1);
    });
  });

  describe('TOTP step', () => {
    it('completes sign-in with a valid code, issuing a Secure HttpOnly SameSite=Lax session cookie and no token', async () => {
      const user = await activeUser('complete');

      const response = await signIn(app, user);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ authenticated: true });
      const cookie = setCookies(response).find((value) => value.startsWith('__Secure-better-auth.session_token='))!;
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
      expect(response.body).not.toContain(sessionCookie(response).split('=')[1]!.split('.')[0]!);
      expect(setCookies(response).some((value) => value.includes('trust_device'))).toBe(false);
      expect(await countRows('session')).toBe(1);
      expect(await countRows('dromex_totp_replay')).toBe(1);
    });

    it('refuses a replayed code, leaving no usable second session', async () => {
      const user = await activeUser('replay');
      await waitForFreshStep();
      const code = totpCode(user.totpSecret);

      expect((await totpStep(app, await challengeFor(user), code)).statusCode).toBe(200);
      const replay = await totpStep(app, await challengeFor(user), code);

      expect(replay.statusCode).toBe(401);
      expect(replay.json()).toEqual({ error: 'invalid_code' });
      expect(setCookies(replay).some((value) => value.includes('session_token=') && !/Max-Age=0/i.test(value))).toBe(false);
      expect(await countRows('session')).toBe(1);
    });

    it('lets only one of concurrent submissions of one code succeed', async () => {
      const user = await activeUser('concurrent');
      const challenges = [
        await challengeFor(user, '198.51.100.11'),
        await challengeFor(user, '198.51.100.12'),
        await challengeFor(user, '198.51.100.13'),
      ];
      await waitForFreshStep();
      const code = totpCode(user.totpSecret);

      const responses = await Promise.all(
        challenges.map((challenge, index) => totpStep(app, challenge, code, {}, `198.51.100.${11 + index}`)),
      );

      expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
      expect(responses.filter((response) => response.statusCode === 401)).toHaveLength(2);
      expect(await countRows('session')).toBe(1);
    });

    it('refuses a wrong code, an expired code, and a code from beyond the acceptance window', async () => {
      const user = await activeUser('window');
      const challenge = await challengeFor(user);
      await waitForFreshStep();

      for (const code of [wrongCode(user.totpSecret), totpCode(user.totpSecret, -2), totpCode(user.totpSecret, 2)]) {
        const response = await totpStep(app, challenge, code);
        expect(response.statusCode, code).toBe(401);
        expect(response.json()).toEqual({ error: 'invalid_code' });
      }
      expect(await countRows('session')).toBe(0);
    });

    it('blocks the sixth verification attempt within the window, per client address', async () => {
      const user = await activeUser('limited');
      const challenge = await challengeFor(user);
      const wrong = wrongCode(user.totpSecret);

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect((await totpStep(app, challenge, wrong)).statusCode, `attempt ${attempt}`).toBe(401);
      }
      const blocked = await totpStep(app, challenge, await user.totp.next());

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: 'too_many_requests' });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
      const { rows } = await pool.query<{ key: string; count: number }>(
        `SELECT key, count FROM dromex_rate_limit WHERE key LIKE '%/two-factor/verify-totp'`,
      );
      expect(rows).toEqual([{ key: '127.0.0.1|/two-factor/verify-totp', count: 5 }]);
    });

    it('locks the account for 900 seconds after ten consecutive failures, even for a correct code', async () => {
      const user = await activeUser('lockout');
      const wrong = wrongCode(user.totpSecret);

      for (const address of ['198.51.100.21', '198.51.100.22']) {
        const challenge = await challengeFor(user, address);
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          expect((await totpStep(app, challenge, wrong, {}, address)).statusCode).toBe(401);
        }
      }

      const challenge = await challengeFor(user, '198.51.100.23');
      const locked = await totpStep(app, challenge, await user.totp.next(), {}, '198.51.100.23');

      expect(locked.statusCode).toBe(429);
      expect(locked.json()).toEqual({ error: 'too_many_requests' });
      expect(await countRows('session')).toBe(0);
      const { rows } = await pool.query<{ seconds: number; failures: number }>(
        `SELECT extract(epoch FROM "lockedUntil" - now())::int AS seconds, "failedVerificationCount" AS failures
           FROM "twoFactor" WHERE "userId" = $1`,
        [user.id],
      );
      expect(rows[0]!.failures).toBe(10);
      expect(rows[0]!.seconds).toBeGreaterThan(880);
      expect(rows[0]!.seconds).toBeLessThanOrEqual(900);
      // Every address made one password step and stayed within its TOTP
      // bucket, and the refused attempt came from a fresh address: the 429 is
      // the account lockout, not either five-per-60-second rate limit.
      const buckets = await pool.query<{ key: string; count: number }>(
        `SELECT key, count FROM dromex_rate_limit ORDER BY key COLLATE "C"`,
      );
      expect(buckets.rows).toEqual([
        { key: '198.51.100.21|/sign-in/email', count: 1 },
        { key: '198.51.100.21|/two-factor/verify-totp', count: 5 },
        { key: '198.51.100.22|/sign-in/email', count: 1 },
        { key: '198.51.100.22|/two-factor/verify-totp', count: 5 },
        { key: '198.51.100.23|/sign-in/email', count: 1 },
        { key: '198.51.100.23|/two-factor/verify-totp', count: 1 },
      ]);
    });

    it('refuses the challenge from a missing or untrusted Origin', async () => {
      const user = await activeUser('origin');
      const challenge = await challengeFor(user);

      for (const origin of ['https://attacker.example', 'null']) {
        const response = await totpStep(app, challenge, await user.totp.next(), { origin });
        expect(response.statusCode).toBe(403);
      }
      expect(await countRows('session')).toBe(0);
    });

    it('refuses a completed challenge for a principal disabled in the meantime, leaving no session', async () => {
      const user = await activeUser('disabled-mid');
      const challenge = await challengeFor(user);
      await setPrincipal(pool, user.id, 'disabled');

      const response = await totpStep(app, challenge, await user.totp.next());

      expect(response.statusCode).toBe(401);
      expect(await countRows('session')).toBe(0);
    });

    it('refuses a principal whose DROMEX MFA activation is incomplete, leaving no session', async () => {
      const user = await activeUser('incomplete');
      await pool.query(`UPDATE dromex_principal SET mfa_completed_at = NULL WHERE user_id = $1`, [user.id]);

      const response = await totpStep(app, await challengeFor(user), await user.totp.next());

      expect(response.statusCode).toBe(401);
      expect(await countRows('session')).toBe(0);
    });

    it('cannot be bypassed with a genuine trusted-device cookie', async () => {
      const user = await activeUser('trust');

      // Mint a real trusted-device cookie with Better Auth's own server API,
      // on an instance whose trust lifetime is long enough to be honoured.
      const options = createAuthOptions({ ...settings, database: pool });
      const minting = betterAuth({
        ...options,
        plugins: [twoFactor({ ...createTwoFactorPlugin().options, trustDeviceMaxAge: 3600 })],
      });
      const challenged = await minting.api.signInEmail({
        body: { email: user.email, password: user.password },
        returnHeaders: true,
      });
      const verified = await minting.api.verifyTOTP({
        body: { code: await user.totp.next(), trustDevice: true },
        headers: new Headers({ cookie: cookiePair(challenged.headers, 'two_factor') }),
        returnHeaders: true,
      });
      const trustCookie = cookiePair(verified.headers, 'trust_device');
      await minting.api.revokeSessions({
        headers: new Headers({ cookie: cookiePair(verified.headers, 'session_token') }),
      });
      expect(await countRows('session')).toBe(0);

      const response = await passwordStep(app, user.email, user.password, { cookie: trustCookie });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ mfaRequired: true });
      expect(await countRows('session')).toBe(0);

      // Positive control: the same cookie really does bypass TOTP when sent
      // straight to Better Auth, so the refusal above is the transport's doing.
      const direct = await createAuth({ ...settings, database: pool }).handler(
        new Request(`${TEST_BASE_URL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: TEST_TRUSTED_ORIGIN,
            cookie: trustCookie,
            [DROMEX_CLIENT_IP_HEADER]: '192.0.2.77',
          },
          body: JSON.stringify({ email: user.email, password: user.password }),
        }),
      );
      expect(direct.headers.getSetCookie().some((value) => value.includes('session_token=') && !/Max-Age=0/i.test(value))).toBe(true);
    });
  });

  describe('GET /api/session', () => {
    it('returns only the sanitized shape for a fully authenticated Owner', async () => {
      const user = await activeUser('owner', true);
      const cookie = sessionCookie(await signIn(app, user));

      const response = await getSession(app, cookie);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ user: { id: user.id, name: user.name, email: user.email }, isOwner: true });
    });

    it('rejects missing, malformed, expired, revoked, orphaned, disabled, and MFA-disagreeing sessions identically', async () => {
      const outcomes: Array<{ status: number; body: string }> = [];
      const record = (response: LightMyRequestResponse) =>
        outcomes.push({ status: response.statusCode, body: response.body });
      // Seven sign-ins happen below. Each comes from its own address, so this
      // setup never reaches the separate five-per-60-second password limit.
      let host = 30;
      const nextAddress = () => `198.51.100.${(host += 1)}`;

      record(await getSession(app));
      record(await getSession(app, '__Secure-better-auth.session_token=not-a-real-signed-token'));

      const expired = await activeUser('expired');
      const expiredCookie = sessionCookie(await signIn(app, expired, nextAddress()));
      await pool.query(`UPDATE "session" SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1`, [expired.id]);
      record(await getSession(app, expiredCookie));

      const revoked = await activeUser('revoked');
      const revokedCookie = sessionCookie(await signIn(app, revoked, nextAddress()));
      await app.inject({
        method: 'POST',
        url: '/api/auth/sign-out',
        headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: revokedCookie },
        payload: {},
      });
      record(await getSession(app, revokedCookie));

      const orphaned = await activeUser('orphaned');
      const orphanedCookie = sessionCookie(await signIn(app, orphaned, nextAddress()));
      await pool.query(`DELETE FROM dromex_principal WHERE user_id = $1`, [orphaned.id]);
      record(await getSession(app, orphanedCookie));

      const disabled = await activeUser('disabled-later');
      const disabledCookie = sessionCookie(await signIn(app, disabled, nextAddress()));
      await setPrincipal(pool, disabled.id, 'disabled');
      record(await getSession(app, disabledCookie));

      const reset = await activeUser('mfa-reset');
      const resetCookie = sessionCookie(await signIn(app, reset, nextAddress()));
      await pool.query(`UPDATE dromex_principal SET mfa_completed_at = NULL WHERE user_id = $1`, [reset.id]);
      record(await getSession(app, resetCookie));

      const older = await activeUser('older-than-mfa');
      const olderCookie = sessionCookie(await signIn(app, older, nextAddress()));
      await pool.query(
        `UPDATE dromex_principal SET mfa_completed_at = now() + interval '1 minute' WHERE user_id = $1`,
        [older.id],
      );
      record(await getSession(app, olderCookie));

      const factorless = await activeUser('factor-removed');
      const factorlessCookie = sessionCookie(await signIn(app, factorless, nextAddress()));
      await pool.query(`UPDATE "user" SET "twoFactorEnabled" = false WHERE id = $1`, [factorless.id]);
      record(await getSession(app, factorlessCookie));

      expect(outcomes).toHaveLength(9);
      for (const outcome of outcomes) {
        expect(outcome).toEqual({ status: 401, body: JSON.stringify({ error: 'unauthorized' }) });
      }
    });
  });

  describe('sign-out', () => {
    function signOut(server: FastifyInstance, headers: Record<string, string>) {
      return server.inject({
        method: 'POST',
        url: '/api/auth/sign-out',
        headers: { 'content-type': 'application/json', ...headers },
        payload: {},
      });
    }

    function outcome(response: LightMyRequestResponse) {
      const cookies = setCookies(response);
      return {
        status: response.statusCode,
        body: response.body,
        clearedCookies: cookies.map((cookie) => cookie.split('=')[0]).sort(),
        allExpired: cookies.every((cookie) => /Max-Age=0/i.test(cookie)),
      };
    }

    const EXPIRED_NAMES = [
      '__Secure-better-auth.session_token',
      '__Secure-better-auth.trust_device',
      '__Secure-better-auth.two_factor',
    ];

    it("revokes an active principal's session and clears the session, challenge, and trusted-device cookies", async () => {
      const user = await activeUser('signout');
      const cookie = sessionCookie(await signIn(app, user));

      const response = await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie });

      expect(outcome(response)).toMatchObject({ status: 200, body: JSON.stringify({ signedOut: true }), allExpired: true });
      for (const name of EXPIRED_NAMES) expect(outcome(response).clearedCookies).toContain(name);
      expect(await countRows('session')).toBe(0);
      expect((await getSession(app, cookie)).statusCode).toBe(401);
    });

    it('lets disabled and missing principals sign out, revoking the session', async () => {
      const disabled = await activeUser('disabled-signout');
      const disabledCookie = sessionCookie(await signIn(app, disabled));
      await setPrincipal(pool, disabled.id, 'disabled');
      const orphan = await activeUser('orphan-signout');
      const orphanCookie = sessionCookie(await signIn(app, orphan));
      await pool.query(`DELETE FROM dromex_principal WHERE user_id = $1`, [orphan.id]);

      for (const cookie of [disabledCookie, orphanCookie]) {
        expect((await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie })).statusCode).toBe(200);
        expect((await getSession(app, cookie)).statusCode).toBe(401);
      }
      expect(await countRows('session')).toBe(0);
    });

    it('gives valid, missing, malformed, expired, and already-revoked sessions one identical result', async () => {
      const outcomes: Array<ReturnType<typeof outcome>> = [];

      const valid = await activeUser('valid');
      const validCookie = sessionCookie(await signIn(app, valid));
      outcomes.push(outcome(await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: validCookie })));
      outcomes.push(outcome(await signOut(app, { origin: TEST_TRUSTED_ORIGIN })));
      outcomes.push(outcome(await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: '__Secure-better-auth.session_token=not-a-real-signed-token' })));

      const expired = await activeUser('expired-signout');
      const expiredCookie = sessionCookie(await signIn(app, expired));
      await pool.query(`UPDATE "session" SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1`, [expired.id]);
      outcomes.push(outcome(await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: expiredCookie })));

      outcomes.push(outcome(await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: validCookie })));

      for (const entry of outcomes) expect(entry).toEqual(outcomes[0]);
      for (const name of EXPIRED_NAMES) expect(outcomes[0]!.clearedCookies).toContain(name);
    });

    it('never signs out another user', async () => {
      const first = await activeUser('first');
      const second = await activeUser('second');
      const firstCookie = sessionCookie(await signIn(app, first));
      const secondCookie = sessionCookie(await signIn(app, second));

      await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: firstCookie });

      expect(await countRows('session')).toBe(1);
      expect((await getSession(app, secondCookie)).statusCode).toBe(200);
    });

    it('is not reachable through GET, and refuses a missing or untrusted Origin without revoking anything', async () => {
      const user = await activeUser('csrf');
      const cookie = sessionCookie(await signIn(app, user));

      expect((await app.inject({ method: 'GET', url: '/api/auth/sign-out', headers: { cookie } })).statusCode).toBe(404);
      const attempts: Array<Record<string, string>> = [
        { cookie },
        { cookie, origin: 'https://attacker.example' },
        { cookie, origin: 'null' },
      ];
      for (const headers of attempts) {
        const response = await signOut(app, headers);
        expect(response.statusCode).toBe(403);
        expect(setCookies(response)).toEqual([]);
      }
      expect((await getSession(app, cookie)).statusCode).toBe(200);
    });
  });

  describe('route surface', () => {
    it('keeps sign-up and every other two-factor route unavailable, changing nothing', async () => {
      const user = await activeUser('surface');
      const cookie = sessionCookie(await signIn(app, user));
      const before = await pool.query(`SELECT secret, "backupCodes", verified FROM "twoFactor"`);

      for (const url of [
        '/api/auth/sign-up/email',
        '/api/auth/get-session',
        '/api/auth/two-factor/enable',
        '/api/auth/two-factor/disable',
        '/api/auth/two-factor/get-totp-uri',
        '/api/auth/two-factor/verify-backup-code',
        '/api/auth/two-factor/generate-backup-codes',
        '/api/auth/two-factor/view-backup-codes',
        '/api/auth/two-factor/send-otp',
        '/api/auth/two-factor/verify-otp',
        '/api/auth/revoke-sessions',
      ]) {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie },
          payload: { email: 'uninvited@synthetic.invalid', password: user.password, name: 'Uninvited', code: user.recoveryCodes[0], userId: user.id },
        });
        expect(response.statusCode, url).toBe(404);
        expect(response.json()).toEqual({ error: 'not_found' });
      }

      expect(await countRows('user')).toBe(1);
      expect((await pool.query(`SELECT secret, "backupCodes", verified FROM "twoFactor"`)).rows).toEqual(before.rows);
      expect((await getSession(app, cookie)).statusCode).toBe(200);
    });

    it('leaves unrelated Better Auth and DROMEX data untouched', async () => {
      const user = await activeUser('scope');
      await getSession(app, sessionCookie(await signIn(app, user)));

      expect(await countRows('user')).toBe(1);
      expect(await countRows('account')).toBe(1);
      expect(await countRows('twoFactor')).toBe(1);
      expect(await countRows('verification')).toBe(0);
      expect(await countRows('dromex_principal')).toBe(1);
      expect(await countRows('dromex_totp_replay')).toBe(1);
      expect(await countRows('dromex_migration')).toBe(8);
    });
  });

  describe('versioned secrets', () => {
    it('encrypts TOTP and recovery-code data under the newest DROMEX version, ignoring an ambient BETTER_AUTH_SECRETS', async () => {
      vi.stubEnv('BETTER_AUTH_SECRETS', `9:${syntheticSecret()}`);
      const versioned = syntheticAuthSettings({ secrets: [{ version: 7, value: syntheticSecret() }] });

      const user = await activeUser('envelope', false, versioned);

      const { rows } = await pool.query<{ secret: string; backupCodes: string }>(
        `SELECT secret, "backupCodes" FROM "twoFactor" WHERE "userId" = $1`,
        [user.id],
      );
      expect(rows[0]!.secret.startsWith('$ba$7$')).toBe(true);
      expect(rows[0]!.backupCodes.startsWith('$ba$7$')).toBe(true);
      for (const code of user.recoveryCodes) expect(rows[0]!.backupCodes).not.toContain(code);
    });

    it('still verifies TOTP enrolled under an older version after a newer version is added', async () => {
      const original = syntheticAuthSettings({ secrets: [{ version: 1, value: syntheticSecret() }] });
      const user = await activeUser('rotation', false, original);
      const rotated = await startServer(undefined, {
        ...original,
        secrets: [{ version: 2, value: syntheticSecret() }, ...original.secrets],
      });

      const response = await signIn(rotated, user);

      expect(response.statusCode).toBe(200);
      expect((await getSession(rotated, sessionCookie(response))).statusCode).toBe(200);
    });
  });

  describe('database-backed rate limiting of the password step', () => {
    async function exhaust(server: FastifyInstance, email: string): Promise<void> {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect((await passwordStep(server, email, 'a synthetic wrong passphrase')).statusCode, `attempt ${attempt}`).toBe(401);
      }
    }

    it('blocks the sixth attempt within the window, even with the right password', async () => {
      const user = await activeUser('limited');
      await exhaust(app, user.email);

      const blocked = await passwordStep(app, user.email, user.password);

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: 'too_many_requests' });
      const retryAfter = Number(blocked.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('keeps its state in the DROMEX-owned table, surviving a fresh application and resisting forged headers', async () => {
      const user = await activeUser('stored');
      await exhaust(app, user.email);

      expect((await pool.query(`SELECT key, count FROM dromex_rate_limit`)).rows).toEqual([
        { key: '127.0.0.1|/sign-in/email', count: 5 },
      ]);
      expect((await passwordStep(await startServer(), user.email, user.password)).statusCode).toBe(429);
      const forged: Array<Record<string, string>> = [
        { 'x-forwarded-for': '203.0.113.9' },
        { [DROMEX_CLIENT_IP_HEADER]: '203.0.113.11' },
      ];
      for (const headers of forged) {
        expect((await passwordStep(app, user.email, user.password, headers)).statusCode).toBe(429);
      }
      expect(await countRows('dromex_rate_limit')).toBe(1);
    });

    it('cannot be bypassed by concurrent attempts', async () => {
      const user = await activeUser('burst');

      const statuses = (
        await Promise.all(Array.from({ length: 12 }, () => passwordStep(app, user.email, 'a synthetic wrong passphrase')))
      ).map((response) => response.statusCode);

      expect(statuses.filter((status) => status === 401)).toHaveLength(5);
      expect(statuses.filter((status) => status === 429)).toHaveLength(7);
    });

    it('gives a different socket address its own bucket, and resets after the window', async () => {
      const user = await activeUser('peer');
      await exhaust(app, user.email);

      expect((await passwordStep(app, user.email, user.password, {}, '198.51.100.7')).statusCode).toBe(200);

      await pool.query(`UPDATE dromex_rate_limit SET last_request_ms = $1 WHERE key LIKE '127.0.0.1|%'`, [Date.now() - 61_000]);
      expect((await passwordStep(app, user.email, user.password)).statusCode).toBe(200);
    });

    it("leaves Better Auth's generated rateLimit table unused and the global BIGINT parser untouched", async () => {
      await passwordStep(app, 'nobody-here@synthetic.invalid', 'a synthetic wrong passphrase');

      expect(await countRows('rateLimit')).toBe(0);
      expect(types.getTypeParser(20, 'text')('9007199254740993')).toBe('9007199254740993');
    });
  });

  describe('log redaction', () => {
    it('writes no password, TOTP code or secret, challenge, cookie, or session token to any log', async () => {
      const lines: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          lines.push(String(chunk));
          callback();
        },
      });
      const consoleOutput: string[] = [];
      for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          consoleOutput.push(args.map(String).join(' '));
        });
      }

      const logged = await startServer(stream);
      const user = await activeUser('logging');
      const challenge = await challengeFor(user, undefined, logged);
      const code = await user.totp.next();
      const signedIn = await totpStep(logged, challenge, code);
      const cookie = sessionCookie(signedIn);
      await getSession(logged, cookie);
      await passwordStep(logged, user.email, 'a synthetic wrong passphrase');

      const everything = `${lines.join('')}\n${consoleOutput.join('\n')}`;
      expect(lines.length).toBeGreaterThan(0);
      for (const secret of [
        user.password,
        code,
        user.totpSecret,
        challenge.split('=')[1]!,
        cookie.split('=')[1]!,
        cookie.split('=')[1]!.split('.')[0]!,
        ...user.recoveryCodes,
      ]) {
        expect(everything).not.toContain(secret);
      }
    });
  });
});
