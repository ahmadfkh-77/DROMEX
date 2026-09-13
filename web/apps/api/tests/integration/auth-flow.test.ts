import { Writable } from 'node:stream';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Pool, types } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DROMEX_CLIENT_IP_HEADER, type AuthSettings } from '../../src/auth/config.ts';
import { createAuth } from '../../src/auth/instance.ts';
import { buildServer } from '../../src/server.ts';
import {
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  type SyntheticUser,
} from '../helpers/auth-fixtures.ts';
import {
  TEST_BASE_URL,
  TEST_TRUSTED_ORIGIN,
  settle,
  syntheticAuthSettings,
} from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

// Every test gets its own disposable database, so database-backed rate-limit
// state from one test can never leak into another.

let database: EphemeralDatabase;
let pool: Pool;
let settings: AuthSettings;
let app: FastifyInstance;
const servers: FastifyInstance[] = [];

async function startServer(logStream?: Writable): Promise<FastifyInstance> {
  const server = await buildServer({ databaseUrl: database.uri, auth: settings, logStream });
  await server.ready();
  servers.push(server);
  return server;
}

function signIn(
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

function setCookies(response: LightMyRequestResponse): string[] {
  const header = response.headers['set-cookie'];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

function sessionCookie(response: LightMyRequestResponse): string {
  const cookie = setCookies(response).find((value) => value.includes('session_token='));
  if (!cookie) throw new Error('expected a session cookie');
  return cookie.split(';')[0]!;
}

function getSession(server: FastifyInstance, cookie?: string) {
  return server.inject({
    method: 'GET',
    url: '/api/session',
    headers: cookie ? { cookie } : {},
  });
}

async function countRows(table: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0]!.n;
}

async function activeUser(label: string, isOwner = false): Promise<SyntheticUser> {
  const user = await provisionSyntheticUser(pool, settings, label);
  await setPrincipal(pool, user.id, 'active', isOwner);
  return user;
}

describe('authentication flow against PostgreSQL 18.6', () => {
  beforeEach(async () => {
    database = await createEphemeralDatabase();
    pool = new Pool({ connectionString: database.uri });
    await migrateAuthSchema(pool);
    settings = syntheticAuthSettings();
    app = await startServer();
  });

  afterEach(async () => {
    await settle();
    while (servers.length > 0) await servers.pop()?.close();
    await pool?.end().catch(() => undefined);
    await database?.drop().catch(() => undefined);
    vi.restoreAllMocks();
  });

  describe('sign-in', () => {
    it('signs in a user whose principal is active', async () => {
      const user = await activeUser('active');

      const response = await signIn(app, user.email, user.password);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ authenticated: true });
      expect(await countRows('session')).toBe(1);
    });

    it('issues a Secure, HttpOnly, SameSite=Lax session cookie', async () => {
      const user = await activeUser('cookie');

      const response = await signIn(app, user.email, user.password);
      const cookie = setCookies(response).find((value) => value.includes('session_token='))!;

      expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
      expect(cookie).toMatch(/;\s*Path=\//i);
    });

    it('never returns the session token in the response body', async () => {
      const user = await activeUser('body');

      const response = await signIn(app, user.email, user.password);
      const token = sessionCookie(response).split('=')[1]!.split('.')[0]!;

      expect(response.body).not.toContain(token);
    });

    it('issues no session at all when the principal is missing', async () => {
      const user = await provisionSyntheticUser(pool, settings, 'orphan');

      const response = await signIn(app, user.email, user.password);

      expect(response.statusCode).toBe(401);
      expect(setCookies(response)).toEqual([]);
      // The row count is the proof of prevention: the session was never
      // written, rather than written and then hidden.
      expect(await countRows('session')).toBe(0);
    });

    it('issues no session at all when the principal is disabled', async () => {
      const user = await provisionSyntheticUser(pool, settings, 'disabled');
      await setPrincipal(pool, user.id, 'disabled');

      const response = await signIn(app, user.email, user.password);

      expect(response.statusCode).toBe(401);
      expect(setCookies(response)).toEqual([]);
      expect(await countRows('session')).toBe(0);
    });

    it('makes unknown email, wrong password, missing principal, and disabled principal indistinguishable', async () => {
      const active = await activeUser('known');
      const orphan = await provisionSyntheticUser(pool, settings, 'orphan');
      const disabled = await provisionSyntheticUser(pool, settings, 'off');
      await setPrincipal(pool, disabled.id, 'disabled');

      const outcomes = [
        await signIn(app, 'nobody-here@synthetic.invalid', 'a synthetic wrong passphrase'),
        await signIn(app, active.email, 'a synthetic wrong passphrase'),
        await signIn(app, orphan.email, orphan.password),
        await signIn(app, disabled.email, disabled.password),
      ].map((response) => ({
        status: response.statusCode,
        body: response.body,
        cookies: setCookies(response),
      }));

      for (const outcome of outcomes) {
        expect(outcome).toEqual(outcomes[0]);
      }
      expect(outcomes[0]).toEqual({
        status: 401,
        body: JSON.stringify({ error: 'invalid_credentials' }),
        cookies: [],
      });
    });

    it('refuses a second sign-in while an active session is present', async () => {
      const user = await activeUser('twice');
      const first = await signIn(app, user.email, user.password);

      const second = await signIn(app, user.email, user.password, {
        cookie: sessionCookie(first),
      });

      expect(second.statusCode).toBe(403);
      expect(await countRows('session')).toBe(1);
    });
  });

  describe('GET /api/session', () => {
    it('returns only the sanitized shape for a valid session', async () => {
      const user = await activeUser('owner', true);
      const cookie = sessionCookie(await signIn(app, user.email, user.password));

      const response = await getSession(app, cookie);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        user: { id: user.id, name: user.name, email: user.email },
        isOwner: true,
      });
      expect(response.body).not.toContain(cookie.split('=')[1]!.split('.')[0]!);
    });

    it('rejects missing, malformed, expired, revoked, orphaned, and disabled sessions identically', async () => {
      const outcomes: Array<{ status: number; body: string }> = [];
      const record = (response: LightMyRequestResponse) =>
        outcomes.push({ status: response.statusCode, body: response.body });

      record(await getSession(app));
      record(await getSession(app, '__Secure-better-auth.session_token=not-a-real-signed-token'));

      const expired = await activeUser('expired');
      const expiredCookie = sessionCookie(await signIn(app, expired.email, expired.password));
      await pool.query(
        `UPDATE "session" SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1`,
        [expired.id],
      );
      record(await getSession(app, expiredCookie));

      const revoked = await activeUser('revoked');
      const revokedCookie = sessionCookie(await signIn(app, revoked.email, revoked.password));
      await app.inject({
        method: 'POST',
        url: '/api/auth/sign-out',
        headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: revokedCookie },
        payload: {},
      });
      record(await getSession(app, revokedCookie));

      const orphaned = await activeUser('orphaned');
      const orphanedCookie = sessionCookie(await signIn(app, orphaned.email, orphaned.password));
      await pool.query(`DELETE FROM dromex_principal WHERE user_id = $1`, [orphaned.id]);
      record(await getSession(app, orphanedCookie));

      const disabled = await activeUser('disabled-later');
      const disabledCookie = sessionCookie(await signIn(app, disabled.email, disabled.password));
      await setPrincipal(pool, disabled.id, 'disabled');
      record(await getSession(app, disabledCookie));

      expect(outcomes).toHaveLength(6);
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

    /** The one generic outcome, reduced to what may legitimately vary: nothing. */
    function outcome(response: LightMyRequestResponse) {
      const cookies = setCookies(response);
      return {
        status: response.statusCode,
        body: response.body,
        clearedCookies: cookies.map((cookie) => cookie.split('=')[0]).sort(),
        allExpired: cookies.every((cookie) => /Max-Age=0/i.test(cookie)),
      };
    }

    const GENERIC = {
      status: 200,
      body: JSON.stringify({ signedOut: true }),
      allExpired: true,
    };

    async function signedInCookie(label: string): Promise<{ user: SyntheticUser; cookie: string }> {
      const user = await activeUser(label);
      return { user, cookie: sessionCookie(await signIn(app, user.email, user.password)) };
    }

    it('revokes an active principal\'s session and clears the cookie', async () => {
      const { cookie } = await signedInCookie('signout');
      expect(await countRows('session')).toBe(1);

      const response = await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie });

      expect(outcome(response)).toMatchObject(GENERIC);
      expect(outcome(response).clearedCookies).toContain('__Secure-better-auth.session_token');
      expect(await countRows('session')).toBe(0);
      expect((await getSession(app, cookie)).statusCode).toBe(401);
    });

    it('lets a disabled principal sign out, revoking the session', async () => {
      const { user, cookie } = await signedInCookie('disabled-signout');
      await setPrincipal(pool, user.id, 'disabled');

      const response = await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie });

      expect(outcome(response)).toMatchObject(GENERIC);
      expect(outcome(response).clearedCookies).toContain('__Secure-better-auth.session_token');
      expect(await countRows('session')).toBe(0);
      expect((await getSession(app, cookie)).statusCode).toBe(401);
    });

    it('lets a user whose principal is missing sign out, revoking the session', async () => {
      const { user, cookie } = await signedInCookie('orphan-signout');
      await pool.query(`DELETE FROM dromex_principal WHERE user_id = $1`, [user.id]);

      const response = await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie });

      expect(outcome(response)).toMatchObject(GENERIC);
      expect(await countRows('session')).toBe(0);
      expect((await getSession(app, cookie)).statusCode).toBe(401);
    });

    it('gives valid, missing, malformed, expired, and already-revoked sessions one identical result', async () => {
      const outcomes: Array<ReturnType<typeof outcome>> = [];

      const valid = await signedInCookie('valid');
      outcomes.push(outcome(await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: valid.cookie })));

      outcomes.push(outcome(await signOut(app, { origin: TEST_TRUSTED_ORIGIN })));
      outcomes.push(
        outcome(
          await signOut(app, {
            origin: TEST_TRUSTED_ORIGIN,
            cookie: '__Secure-better-auth.session_token=not-a-real-signed-token',
          }),
        ),
      );

      const expired = await signedInCookie('expired-signout');
      await pool.query(
        `UPDATE "session" SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1`,
        [expired.user.id],
      );
      outcomes.push(outcome(await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: expired.cookie })));

      outcomes.push(outcome(await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: valid.cookie })));

      expect(outcomes).toHaveLength(5);
      for (const entry of outcomes) {
        expect(entry).toEqual(outcomes[0]);
      }
      expect(outcomes[0]).toMatchObject(GENERIC);
      expect(outcomes[0]!.clearedCookies).toContain('__Secure-better-auth.session_token');
    });

    it('never signs out another user', async () => {
      const first = await signedInCookie('first');
      const second = await signedInCookie('second');

      await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: first.cookie });

      expect(await countRows('session')).toBe(1);
      expect((await getSession(app, second.cookie)).statusCode).toBe(200);
    });

    it('is not reachable through GET', async () => {
      const { cookie } = await signedInCookie('get-signout');

      const response = await app.inject({ method: 'GET', url: '/api/auth/sign-out', headers: { cookie } });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
      expect(await countRows('session')).toBe(1);
    });

    it('rejects a missing or untrusted Origin without revoking or clearing anything', async () => {
      const { cookie } = await signedInCookie('csrf');

      const attempts: Array<Record<string, string>> = [
        { cookie },
        { cookie, origin: 'https://attacker.example' },
        { cookie, origin: 'null' },
      ];
      for (const headers of attempts) {
        const response = await signOut(app, headers);
        expect(response.statusCode, JSON.stringify(headers.origin)).toBe(403);
        expect(response.json()).toEqual({ error: 'forbidden' });
        expect(setCookies(response)).toEqual([]);
      }

      expect(await countRows('session')).toBe(1);
      expect((await getSession(app, cookie)).statusCode).toBe(200);
    });
  });

  describe('route surface', () => {
    it('keeps sign-up unavailable and creates no user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
        payload: {
          email: 'uninvited@synthetic.invalid',
          password: 'a synthetic uninvited passphrase',
          name: 'Uninvited',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
      expect(await countRows('user')).toBe(0);
    });

    it('does not expose raw Better Auth session output', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/auth/get-session' });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it('leaves unrelated Better Auth and DROMEX data untouched', async () => {
      const user = await activeUser('scope');
      const cookie = sessionCookie(await signIn(app, user.email, user.password));
      await getSession(app, cookie);

      expect(await countRows('user')).toBe(1);
      expect(await countRows('account')).toBe(1);
      expect(await countRows('verification')).toBe(0);
      expect(await countRows('dromex_principal')).toBe(1);
      expect(await countRows('dromex_migration')).toBe(2);
    });
  });

  describe('database-backed rate limiting', () => {
    async function exhaust(server: FastifyInstance, email: string): Promise<void> {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await signIn(server, email, 'a synthetic wrong passphrase');
        expect(response.statusCode, `attempt ${attempt}`).toBe(401);
      }
    }

    it('blocks the sixth sign-in attempt within the window, even with the right password', async () => {
      const user = await activeUser('limited');
      await exhaust(app, user.email);

      const blocked = await signIn(app, user.email, user.password);

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: 'too_many_requests' });
      expect(await countRows('session')).toBe(0);

      const retryAfter = Number(blocked.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('keeps its state in the DROMEX-owned PostgreSQL table, keyed by the socket address and path', async () => {
      const user = await activeUser('stored');
      await exhaust(app, user.email);

      const { rows } = await pool.query<{ key: string; count: number }>(
        `SELECT key, count FROM dromex_rate_limit`,
      );

      expect(rows).toEqual([{ key: '127.0.0.1|/sign-in/email', count: 5 }]);
    });

    it('cannot be bypassed by concurrent sign-in attempts', async () => {
      const user = await activeUser('burst');

      const responses = await Promise.all(
        Array.from({ length: 12 }, () => signIn(app, user.email, 'a synthetic wrong passphrase')),
      );
      const statuses = responses.map((response) => response.statusCode);

      expect(statuses.filter((status) => status === 401)).toHaveLength(5);
      expect(statuses.filter((status) => status === 429)).toHaveLength(7);
      const { rows } = await pool.query<{ count: number }>(`SELECT count FROM dromex_rate_limit`);
      expect(rows).toEqual([{ count: 5 }]);
    });

    it('still blocks from a freshly constructed application against the same database', async () => {
      const user = await activeUser('restart');
      await exhaust(app, user.email);

      const fresh = await startServer();
      const blocked = await signIn(fresh, user.email, user.password);

      expect(blocked.statusCode).toBe(429);
    });

    it('cannot be bypassed with client-supplied forwarding headers', async () => {
      const user = await activeUser('spoof');
      await exhaust(app, user.email);

      const spoofs: Array<Record<string, string>> = [
        { 'x-forwarded-for': '203.0.113.9' },
        { 'x-real-ip': '203.0.113.10' },
        { [DROMEX_CLIENT_IP_HEADER]: '203.0.113.11' },
      ];
      for (const headers of spoofs) {
        const attempt = await signIn(app, user.email, user.password, headers);
        expect(attempt.statusCode, JSON.stringify(headers)).toBe(429);
        expect(attempt.headers['x-retry-after']).toBeUndefined();
        expect(Number(attempt.headers['retry-after'])).toBeLessThanOrEqual(60);
      }

      // No spoofed address created a bucket of its own.
      const { rows } = await pool.query<{ key: string; count: number }>(
        `SELECT key, count FROM dromex_rate_limit`,
      );
      expect(rows).toEqual([{ key: '127.0.0.1|/sign-in/email', count: 5 }]);
    });

    it('gives a genuinely different socket address its own bucket', async () => {
      // Without this, the spoofing test above could pass merely because every
      // request is blocked. A real different peer must not share the limit.
      const user = await activeUser('peer');
      await exhaust(app, user.email);

      const otherPeer = await signIn(app, user.email, user.password, {}, '198.51.100.7');

      expect(otherPeer.statusCode).toBe(200);
    });

    it('resets correctly once the window has elapsed', async () => {
      const user = await activeUser('reset');
      await exhaust(app, user.email);
      expect((await signIn(app, user.email, user.password)).statusCode).toBe(429);

      // Simulates elapsed time by moving the stored timestamp outside the
      // 60-second window, in the disposable database only.
      await pool.query(`UPDATE dromex_rate_limit SET last_request_ms = $1`, [Date.now() - 61_000]);

      const afterWindow = await signIn(app, user.email, user.password);

      expect(afterWindow.statusCode).toBe(200);
      const { rows } = await pool.query<{ count: number }>(`SELECT count FROM dromex_rate_limit`);
      expect(rows[0]?.count).toBe(1);
    });

    it('leaves Better Auth\'s generated rateLimit table unused and the global BIGINT parser untouched', async () => {
      await signIn(app, 'nobody-here@synthetic.invalid', 'a synthetic wrong passphrase');

      expect(await countRows('rateLimit')).toBe(0);
      expect(await countRows('dromex_rate_limit')).toBe(1);

      // node-postgres still returns BIGINT as text: DROMEX converts its own
      // column explicitly instead of changing the process-wide parser.
      expect(types.getTypeParser(20, 'text')('9007199254740993')).toBe('9007199254740993');
      const { rows } = await pool.query<{ last_request_ms: unknown }>(
        `SELECT last_request_ms FROM dromex_rate_limit`,
      );
      expect(typeof rows[0]?.last_request_ms).toBe('string');
    });

    it('reports a sane retry-after value from Better Auth itself', async () => {
      const auth = createAuth({ ...settings, database: pool });
      const attempt = () =>
        auth.handler(
          new Request(`${TEST_BASE_URL}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: TEST_TRUSTED_ORIGIN,
              [DROMEX_CLIENT_IP_HEADER]: '192.0.2.50',
            },
            body: JSON.stringify({
              email: 'nobody-here@synthetic.invalid',
              password: 'a synthetic wrong passphrase',
            }),
          }),
        );

      for (let i = 0; i < 5; i += 1) {
        expect((await attempt()).status).toBe(401);
      }
      const blocked = await attempt();
      const retryAfter = Number(blocked.headers.get('x-retry-after'));

      expect(blocked.status).toBe(429);
      expect(Number.isFinite(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
  });

  describe('log redaction', () => {
    it('writes no password, cookie, or session token to any log', async () => {
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
      const signedIn = await signIn(logged, user.email, user.password);
      const cookie = sessionCookie(signedIn);
      await getSession(logged, cookie);
      await signIn(logged, user.email, 'a synthetic wrong passphrase');

      const everything = `${lines.join('')}\n${consoleOutput.join('\n')}`;
      const token = cookie.split('=')[1]!;

      expect(lines.length).toBeGreaterThan(0);
      for (const secret of [user.password, token, token.split('.')[0]!]) {
        expect(everything).not.toContain(secret);
      }
    });
  });
});
