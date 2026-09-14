import { Writable } from 'node:stream';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DROMEX_CLIENT_IP_HEADER } from '../../src/auth/config.ts';
import {
  registerAuthenticationGuard,
  registerAuthRoutes,
  type AuthBackend,
  type AuthRoutesDependencies,
  type RecoverySessionGate,
} from '../../src/auth/http.ts';
import type { Principal, PrincipalRepository } from '../../src/auth/principal.ts';
import type { TotpReplayGuard } from '../../src/auth/totp-replay.ts';
import { registerRouteAccessGuard } from '../../src/routeAccess.ts';
import { TEST_BASE_URL, TEST_COOKIE_NAMES, TEST_TRUSTED_ORIGIN } from '../helpers/auth-settings.ts';

// These tests exercise the transport against a fake Better Auth backend, so
// every bridge property is provable with no database and no Docker.

const COOKIES = TEST_COOKIE_NAMES;
const MFA_COMPLETED_AT = new Date('2026-09-13T09:00:00.000Z');
const SESSION_CREATED_AT = '2026-09-13T10:00:00.000Z';

const CHALLENGE_SET_COOKIE = `${COOKIES.twoFactor}=signed-challenge-value; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax`;
const CHALLENGE_CLEAR_COOKIE = `${COOKIES.twoFactor}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
const NEW_SESSION_SET_COOKIE = `${COOKIES.sessionToken}=new-signed-session; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Lax`;
const TRUST_SET_COOKIE = `${COOKIES.trustDevice}=forged-trust; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`;

function sessionBody(
  overrides: { id?: unknown; createdAt?: unknown; twoFactorEnabled?: unknown } = {},
): Record<string, unknown> {
  return {
    session: {
      id: 'id' in overrides ? overrides.id : 'session_internal_id',
      token: 'raw-session-token-value',
      createdAt: 'createdAt' in overrides ? overrides.createdAt : SESSION_CREATED_AT,
    },
    user: {
      id: 'user_synthetic',
      name: 'Synthetic Person',
      email: 'person@synthetic.invalid',
      emailVerified: false,
      image: null,
      twoFactorEnabled: 'twoFactorEnabled' in overrides ? overrides.twoFactorEnabled : true,
    },
  };
}

function jsonResponse(status: number, body: unknown, setCookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function challengeResponse(): Response {
  return jsonResponse(200, { twoFactorRedirect: true, twoFactorMethods: ['totp'] }, [
    `${COOKIES.sessionToken}=; Max-Age=0; Path=/`,
    CHALLENGE_SET_COOKIE,
    'unrelated=1; Path=/',
  ]);
}

function verifiedResponse(): Response {
  return jsonResponse(200, { token: 'raw-session-token-value', user: { id: 'user_synthetic' } }, [
    NEW_SESSION_SET_COOKIE,
    CHALLENGE_CLEAR_COOKIE,
    TRUST_SET_COOKIE,
  ]);
}

function isVerifyPath(request: Request): boolean {
  return new URL(request.url).pathname === '/api/auth/two-factor/verify-totp';
}

function fakeBackend(overrides: Partial<AuthBackend> = {}) {
  return {
    handle: vi.fn(async (request: Request) =>
      isVerifyPath(request) ? verifiedResponse() : challengeResponse(),
    ),
    getSession: vi.fn(async (_headers: Headers) => jsonResponse(200, null)),
    signOut: vi.fn(async (_headers: Headers) =>
      jsonResponse(200, { success: true }, [`${COOKIES.sessionToken}=; Max-Age=0; Path=/`]),
    ),
    ...overrides,
  };
}

function principalRepository(principal: Principal | null): PrincipalRepository {
  return { findByUserId: vi.fn(async () => principal) };
}

function replayGuard(outcome: 'accepted' | 'replayed' | Error = 'accepted') {
  return {
    record: vi.fn(async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }),
  } satisfies TotpReplayGuard;
}

const ACTIVE: Principal = {
  userId: 'user_synthetic',
  status: 'active',
  isOwner: false,
  mfaCompletedAt: MFA_COMPLETED_AT,
};
const DISABLED: Principal = { ...ACTIVE, status: 'disabled' };
const MFA_INCOMPLETE: Principal = { ...ACTIVE, mfaCompletedAt: null };

const apps: FastifyInstance[] = [];

async function buildApp(deps: AuthRoutesDependencies, logStream?: Writable): Promise<FastifyInstance> {
  const app = Fastify({ logger: logStream ? { level: 'trace', stream: logStream } : false });
  registerRouteAccessGuard(app);
  registerAuthenticationGuard(app, deps);
  registerAuthRoutes(app, deps);
  await app.ready();
  apps.push(app);
  return app;
}

/** A recovery-session lookup that answers the same for every session. */
function recoveryGate(isRecovery: boolean) {
  return { isRecoverySession: vi.fn(async (_sessionId: string) => isRecovery) } satisfies RecoverySessionGate;
}

function deps(
  backend: AuthBackend,
  principals: PrincipalRepository = principalRepository(ACTIVE),
  replay: TotpReplayGuard = replayGuard(),
  recoverySessions: RecoverySessionGate = recoveryGate(false),
): AuthRoutesDependencies {
  return {
    backend,
    principals,
    replay,
    recoverySessions,
    cookies: COOKIES,
    baseURL: TEST_BASE_URL,
    trustedOrigins: [TEST_TRUSTED_ORIGIN],
  };
}

function signIn(app: FastifyInstance, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', ...headers },
    payload: { email: 'person@synthetic.invalid', password: 'a synthetic passphrase value' },
  });
}

function verifyTotp(
  app: FastifyInstance,
  options: { headers?: Record<string, string>; payload?: unknown } = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/two-factor/verify-totp',
    headers: {
      origin: TEST_TRUSTED_ORIGIN,
      'content-type': 'application/json',
      cookie: `${COOKIES.twoFactor}=signed-challenge-value`,
      ...options.headers,
    },
    payload: (options.payload ?? { code: '123456' }) as object,
  });
}

function signOut(app: FastifyInstance, headers: Record<string, string> = { origin: TEST_TRUSTED_ORIGIN }) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-out',
    headers: { 'content-type': 'application/json', ...headers },
    payload: {},
  });
}

function cookiesOf(header: string | string[] | undefined): string[] {
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

function cookieNames(header: string | string[] | undefined): string[] {
  return cookiesOf(header).map((cookie) => cookie.split('=')[0]!);
}

function forwardedRequest(backend: ReturnType<typeof fakeBackend>, index = 0): Request {
  return vi.mocked(backend.handle).mock.calls[index]![0];
}

describe('authentication transport', () => {
  afterEach(async () => {
    while (apps.length > 0) await apps.pop()?.close();
    vi.restoreAllMocks();
  });

  it('registers exactly the approved authentication routes with their classifications', async () => {
    const app = await buildApp(deps(fakeBackend()));

    const surface = [...app.routeAccess.entries()]
      .filter(([route]) => route.includes('/api/'))
      .sort(([a], [b]) => a.localeCompare(b));

    expect(surface).toEqual([
      ['GET /api/session', 'authenticated'],
      ['HEAD /api/session', 'authenticated'],
      ['POST /api/auth/sign-in/email', 'guest-only'],
      ['POST /api/auth/sign-out', 'session-cleanup'],
      ['POST /api/auth/two-factor/verify-totp', 'mfa-challenge'],
    ]);
  });

  it('answers every unapproved authentication path, including the other two-factor routes, with a generic 404', async () => {
    const backend = fakeBackend();
    const app = await buildApp(deps(backend));

    const unapproved: Array<[string, string]> = [
      ['POST', '/api/auth/sign-up/email'],
      ['GET', '/api/auth/get-session'],
      ['POST', '/api/auth/request-password-reset'],
      ['POST', '/api/auth/update-user'],
      ['POST', '/api/auth/sign-in/social'],
      ['POST', '/api/auth/sign-in/email/extra'],
      ['POST', '/api/auth/revoke-sessions'],
      ['POST', '/api/auth/two-factor/enable'],
      ['POST', '/api/auth/two-factor/disable'],
      ['POST', '/api/auth/two-factor/get-totp-uri'],
      ['POST', '/api/auth/two-factor/verify-backup-code'],
      ['POST', '/api/auth/two-factor/generate-backup-codes'],
      ['POST', '/api/auth/two-factor/view-backup-codes'],
      ['POST', '/api/auth/two-factor/send-otp'],
      ['POST', '/api/auth/two-factor/verify-otp'],
      ['GET', '/api/auth/two-factor/verify-totp'],
      ['POST', '/api/auth/two-factor/verify-totp/extra'],
    ];

    for (const [method, url] of unapproved) {
      const response = await app.inject({
        method: method as 'GET',
        url,
        headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
        payload: method === 'GET' ? undefined : {},
      });

      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    }

    expect(backend.handle).not.toHaveBeenCalled();
    expect(backend.getSession).not.toHaveBeenCalled();
    expect(backend.signOut).not.toHaveBeenCalled();
  });

  describe('password sign-in', () => {
    it('turns an accepted password into an MFA challenge, forwarding only the challenge cookie', async () => {
      const app = await buildApp(deps(fakeBackend()));

      const response = await signIn(app);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ mfaRequired: true });
      expect(cookiesOf(response.headers['set-cookie'])).toEqual([CHALLENGE_SET_COOKIE]);
      expect(response.body).not.toContain('twoFactorRedirect');
    });

    it('revokes a session issued without the MFA challenge and refuses generically', async () => {
      const backend = fakeBackend({
        handle: vi.fn(async () =>
          jsonResponse(200, { redirect: false, token: 'raw-session-token-value', user: { id: 'user_synthetic' } }, [
            NEW_SESSION_SET_COOKIE,
          ]),
        ),
      });
      const app = await buildApp(deps(backend));

      const response = await signIn(app);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_credentials' });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body).not.toContain('raw-session-token-value');
      expect(backend.signOut).toHaveBeenCalledTimes(1);
      expect(vi.mocked(backend.signOut).mock.calls[0]![0].get('cookie')).toBe(
        `${COOKIES.sessionToken}=new-signed-session`,
      );
    });

    it('reports a failure to revoke that session as an internal error, never as success', async () => {
      const backend = fakeBackend({
        handle: vi.fn(async () => jsonResponse(200, { token: 'raw-session-token-value' }, [NEW_SESSION_SET_COOKIE])),
        signOut: vi.fn(async () => jsonResponse(500, {})),
      });
      const app = await buildApp(deps(backend));

      const response = await signIn(app);

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('never forwards a trusted-device cookie to Better Auth', async () => {
      const backend = fakeBackend();
      const app = await buildApp(deps(backend));

      await signIn(app, { cookie: `${COOKIES.trustDevice}=forged-trust; other=kept` });

      expect(forwardedRequest(backend).headers.get('cookie')).toBe('other=kept');
    });

    it('strips client-supplied proxy headers and substitutes the socket address', async () => {
      const backend = fakeBackend();
      const app = await buildApp(deps(backend));

      await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        remoteAddress: '10.1.2.3',
        headers: {
          origin: TEST_TRUSTED_ORIGIN,
          'content-type': 'application/json',
          'x-forwarded-for': '9.9.9.9',
          'x-real-ip': '8.8.8.8',
          forwarded: 'for=7.7.7.7',
          [DROMEX_CLIENT_IP_HEADER]: '6.6.6.6',
        },
        payload: { email: 'person@synthetic.invalid', password: 'a synthetic passphrase value' },
      });

      const forwarded = forwardedRequest(backend);
      for (const spoofable of ['x-forwarded-for', 'x-real-ip', 'forwarded']) {
        expect(forwarded.headers.has(spoofable), spoofable).toBe(false);
      }
      expect(forwarded.headers.get(DROMEX_CLIENT_IP_HEADER)).toBe('10.1.2.3');
    });

    it('forwards only the fixed approved path, discarding client query strings', async () => {
      const backend = fakeBackend();
      const app = await buildApp(deps(backend));

      await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email?callbackURL=https://evil.example/steal',
        headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
        payload: { email: 'person@synthetic.invalid', password: 'a synthetic passphrase value' },
      });

      expect(forwardedRequest(backend).url).toBe(`${TEST_BASE_URL}/api/auth/sign-in/email`);
    });

    it('normalises every sign-in failure to one indistinguishable response', async () => {
      const failures: Array<[number, unknown]> = [
        [401, { code: 'INVALID_EMAIL_OR_PASSWORD' }],
        [401, { code: 'FAILED_TO_CREATE_SESSION' }],
        [400, { code: 'INVALID_EMAIL' }],
        [403, { code: 'INVALID_ORIGIN' }],
        [422, { code: 'VALIDATION_ERROR' }],
      ];

      for (const [status, body] of failures) {
        const app = await buildApp(
          deps(fakeBackend({ handle: vi.fn(async () => jsonResponse(status, body, ['leak=1; Path=/'])) })),
        );
        const response = await signIn(app);
        expect({ status: response.statusCode, body: response.body, cookies: cookiesOf(response.headers['set-cookie']) }).toEqual({
          status: 401,
          body: JSON.stringify({ error: 'invalid_credentials' }),
          cookies: [],
        });
      }
    });

    it('refuses a challenge response that carries no challenge cookie', async () => {
      const app = await buildApp(
        deps(fakeBackend({ handle: vi.fn(async () => jsonResponse(200, { twoFactorRedirect: true })) })),
      );

      const response = await signIn(app);

      expect(response.statusCode).toBe(401);
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('returns a generic 429 when Better Auth rate-limits sign-in, keeping only a plausible retry time', async () => {
      for (const [value, expected] of [
        ['42', '42'],
        ['178928979670571', undefined],
        ['0', undefined],
        ['soon', undefined],
      ] as const) {
        const app = await buildApp(
          deps(
            fakeBackend({
              handle: vi.fn(async () => {
                const response = jsonResponse(429, {});
                response.headers.set('x-retry-after', value);
                return response;
              }),
            }),
          ),
        );

        const response = await signIn(app);

        expect(response.statusCode, value).toBe(429);
        expect(response.json()).toEqual({ error: 'too_many_requests' });
        expect(response.headers['retry-after'], value).toBe(expected);
        expect(response.headers['x-retry-after']).toBeUndefined();
      }
    });

    it('refuses sign-in while a fully authenticated session already exists', async () => {
      const backend = fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) });
      const app = await buildApp(deps(backend));

      const response = await signIn(app, { cookie: 'session=present' });

      expect(response.statusCode).toBe(403);
      expect(backend.handle).not.toHaveBeenCalled();
    });

    it('allows sign-in when the existing session does not satisfy the MFA gate', async () => {
      const backend = fakeBackend({
        getSession: vi.fn(async () => jsonResponse(200, sessionBody({ twoFactorEnabled: false }))),
      });
      const app = await buildApp(deps(backend));

      await signIn(app, { cookie: 'session=present' });

      expect(backend.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/auth/two-factor/verify-totp', () => {
    it('completes sign-in only after recording the code, forwarding the session cookie but never a trust cookie or token', async () => {
      const backend = fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) });
      const replay = replayGuard();
      const app = await buildApp(deps(backend, principalRepository(ACTIVE), replay));

      const response = await verifyTotp(app);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ authenticated: true });
      expect(response.body).not.toContain('raw-session-token-value');
      expect(cookieNames(response.headers['set-cookie']).sort()).toEqual(
        [COOKIES.sessionToken, COOKIES.twoFactor].sort(),
      );
      expect(cookiesOf(response.headers['set-cookie'])).toContain(NEW_SESSION_SET_COOKIE);
      expect(replay.record).toHaveBeenCalledWith('user_synthetic', '123456');
      expect(vi.mocked(backend.getSession).mock.calls[0]![0].get('cookie')).toBe(
        `${COOKIES.sessionToken}=new-signed-session`,
      );
      expect(backend.signOut).not.toHaveBeenCalled();
    });

    it('forwards only the challenge cookie and exactly {code, trustDevice:false} to the fixed path', async () => {
      const backend = fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) });
      const app = await buildApp(deps(backend));

      await verifyTotp(app, {
        headers: {
          cookie: `${COOKIES.sessionToken}=someone-elses; ${COOKIES.trustDevice}=forged; ${COOKIES.twoFactor}=signed-challenge-value; other=1`,
        },
      });

      const forwarded = forwardedRequest(backend);
      expect(forwarded.url).toBe(`${TEST_BASE_URL}/api/auth/two-factor/verify-totp`);
      expect(forwarded.headers.get('cookie')).toBe(`${COOKIES.twoFactor}=signed-challenge-value`);
      expect(await forwarded.json()).toEqual({ code: '123456', trustDevice: false });
    });

    it('refuses a missing, untrusted, or opaque Origin before reaching Better Auth', async () => {
      const backend = fakeBackend();
      const app = await buildApp(deps(backend));

      for (const origin of [undefined, 'https://attacker.example', 'null']) {
        const headers: Record<string, string> = origin === undefined ? {} : { origin };
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/two-factor/verify-totp',
          headers: { 'content-type': 'application/json', cookie: `${COOKIES.twoFactor}=v`, ...headers },
          payload: { code: '123456' },
        });
        expect(response.statusCode, String(origin)).toBe(403);
        expect(response.json()).toEqual({ error: 'forbidden' });
      }
      expect(backend.handle).not.toHaveBeenCalled();
    });

    it('refuses a request with no challenge cookie before reaching Better Auth', async () => {
      const backend = fakeBackend();
      const app = await buildApp(deps(backend));

      const response = await verifyTotp(app, { headers: { cookie: `${COOKIES.sessionToken}=x` } });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_code' });
      expect(backend.handle).not.toHaveBeenCalled();
    });

    it.each([
      ['an empty body', {}],
      ['five digits', { code: '12345' }],
      ['seven digits', { code: '1234567' }],
      ['a number', { code: 123456 }],
      ['a letter', { code: '12345a' }],
      ['surrounding whitespace', { code: ' 123456' }],
      ['trustDevice', { code: '123456', trustDevice: true }],
      ['trustDevice false', { code: '123456', trustDevice: false }],
      ['disableSession', { code: '123456', disableSession: true }],
      ['a user id', { code: '123456', userId: 'user_other' }],
      ['an email', { code: '123456', email: 'x@synthetic.invalid' }],
      ['a role', { code: '123456', role: 'owner' }],
    ])('refuses a body with %s before reaching Better Auth', async (_label, payload) => {
      const backend = fakeBackend();
      const app = await buildApp(deps(backend));

      const response = await verifyTotp(app, { payload });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_code' });
      expect(backend.handle).not.toHaveBeenCalled();
    });

    it('revokes the new session and refuses when the code was already used', async () => {
      const backend = fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) });
      const app = await buildApp(deps(backend, principalRepository(ACTIVE), replayGuard('replayed')));

      const response = await verifyTotp(app);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_code' });
      expect(cookieNames(response.headers['set-cookie'])).not.toContain(COOKIES.sessionToken);
      expect(backend.signOut).toHaveBeenCalledTimes(1);
      expect(vi.mocked(backend.signOut).mock.calls[0]![0].get('cookie')).toBe(
        `${COOKIES.sessionToken}=new-signed-session`,
      );
    });

    it('revokes the new session when the code cannot be recorded, and never reports success', async () => {
      const backend = fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) });
      const app = await buildApp(
        deps(backend, principalRepository(ACTIVE), replayGuard(new Error('replay table detail'))),
      );

      const response = await verifyTotp(app);

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(response.body).not.toContain('replay table detail');
      expect(cookieNames(response.headers['set-cookie'])).not.toContain(COOKIES.sessionToken);
      expect(backend.signOut).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a disabled principal', DISABLED, sessionBody()],
      ['a missing principal', null, sessionBody()],
      ['incomplete DROMEX MFA', MFA_INCOMPLETE, sessionBody()],
      ['Better Auth reporting no enrolled factor', ACTIVE, sessionBody({ twoFactorEnabled: false })],
      ['a session created before MFA completion', ACTIVE, sessionBody({ createdAt: '2026-09-13T08:59:59.999Z' })],
    ] as const)('revokes the new session and refuses for %s', async (_label, principal, body) => {
      const backend = fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, body)) });
      const app = await buildApp(deps(backend, principalRepository(principal)));

      const response = await verifyTotp(app);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_code' });
      expect(cookieNames(response.headers['set-cookie'])).not.toContain(COOKIES.sessionToken);
      expect(backend.signOut).toHaveBeenCalledTimes(1);
    });

    it('refuses an invalid code generically, forwarding only a challenge-cookie change', async () => {
      const backend = fakeBackend({
        handle: vi.fn(async () =>
          jsonResponse(401, { code: 'INVALID_CODE' }, [CHALLENGE_CLEAR_COOKIE, TRUST_SET_COOKIE]),
        ),
      });
      const app = await buildApp(deps(backend));

      const response = await verifyTotp(app);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_code' });
      expect(cookiesOf(response.headers['set-cookie'])).toEqual([CHALLENGE_CLEAR_COOKIE]);
      expect(backend.getSession).not.toHaveBeenCalled();
    });

    it('maps too many attempts on one challenge, and a session refused by the principal hook, to the same refusal', async () => {
      for (const [status, code] of [
        [400, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE'],
        [401, 'INVALID_TWO_FACTOR_COOKIE'],
        [500, 'FAILED_TO_CREATE_SESSION'],
      ] as const) {
        const app = await buildApp(deps(fakeBackend({ handle: vi.fn(async () => jsonResponse(status, { code })) })));
        const response = await verifyTotp(app);
        expect(response.statusCode, code).toBe(401);
        expect(response.json()).toEqual({ error: 'invalid_code' });
      }
    });

    it('passes rate limiting and account lockout through as a generic 429', async () => {
      const app = await buildApp(
        deps(
          fakeBackend({
            handle: vi.fn(async () => jsonResponse(429, { code: 'ACCOUNT_TEMPORARILY_LOCKED', message: 'locked' })),
          }),
        ),
      );

      const response = await verifyTotp(app);

      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual({ error: 'too_many_requests' });
      expect(response.body).not.toContain('locked');
    });

    it('reports any other Better Auth server failure as an internal error', async () => {
      const app = await buildApp(
        deps(fakeBackend({ handle: vi.fn(async () => jsonResponse(500, { code: 'INTERNAL_SERVER_ERROR' })) })),
      );

      expect((await verifyTotp(app)).statusCode).toBe(500);
    });

    it('refuses a verified response that carries no session cookie', async () => {
      const backend = fakeBackend({
        handle: vi.fn(async () => jsonResponse(200, { token: 'raw-session-token-value' }, [CHALLENGE_CLEAR_COOKIE])),
      });
      const app = await buildApp(deps(backend));

      const response = await verifyTotp(app);

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('raw-session-token-value');
      expect(backend.getSession).not.toHaveBeenCalled();
    });
  });

  describe('sign-out', () => {
    it('lets sign-out through without resolving a session or a principal', async () => {
      const backend = fakeBackend({
        handle: vi.fn(async () => jsonResponse(200, { success: true }, [`${COOKIES.sessionToken}=; Max-Age=0; Path=/`])),
      });
      const principals = principalRepository(null);
      const app = await buildApp(deps(backend, principals));

      const response = await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: 'session=present' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ signedOut: true });
      expect(backend.getSession).not.toHaveBeenCalled();
      expect(principals.findByUserId).not.toHaveBeenCalled();
    });

    it('also expires the MFA challenge and trusted-device cookies, never forwarding the raw body', async () => {
      const app = await buildApp(
        deps(
          fakeBackend({
            handle: vi.fn(async () =>
              jsonResponse(200, { success: true, url: 'https://provider.example' }, [
                `${COOKIES.sessionToken}=; Max-Age=0; Path=/`,
              ]),
            ),
          }),
        ),
      );

      const response = await signOut(app, { origin: TEST_TRUSTED_ORIGIN });

      expect(response.json()).toEqual({ signedOut: true });
      const cookies = cookiesOf(response.headers['set-cookie']);
      for (const name of [COOKIES.sessionToken, COOKIES.twoFactor, COOKIES.trustDevice]) {
        const cookie = cookies.find((value) => value.startsWith(`${name}=`));
        expect(cookie, name).toBeDefined();
        expect(cookie).toMatch(/Max-Age=0/);
        expect(cookie).toMatch(/Path=\//);
      }
      for (const name of [COOKIES.twoFactor, COOKIES.trustDevice]) {
        const cookie = cookies.find((value) => value.startsWith(`${name}=`))!;
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/Secure/);
        expect(cookie).toMatch(/SameSite=Lax/);
      }
    });

    it('refuses a missing, untrusted, or opaque Origin before reaching Better Auth', async () => {
      const backend = fakeBackend();
      const app = await buildApp(deps(backend));

      const attempts: Array<Record<string, string>> = [
        { cookie: 'session=present' },
        { origin: 'https://attacker.example' },
        { origin: 'null' },
        { origin: `${TEST_TRUSTED_ORIGIN}.attacker.example` },
      ];
      for (const headers of attempts) {
        const response = await signOut(app, headers);
        expect(response.statusCode).toBe(403);
        expect(response.headers['set-cookie']).toBeUndefined();
      }
      expect(backend.handle).not.toHaveBeenCalled();
    });

    it('reports a failed revocation, or a thrown backend, as an internal error', async () => {
      for (const handle of [
        vi.fn(async () => jsonResponse(500, { message: 'db down' })),
        vi.fn(async () => {
          throw new Error('internal detail that must not leak');
        }),
      ]) {
        const app = await buildApp(deps(fakeBackend({ handle })));
        const response = await signOut(app);
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: 'internal_error' });
        expect(response.body).not.toContain('internal detail');
      }
    });
  });

  describe('GET /api/session and the mandatory MFA gate', () => {
    it('returns only the sanitized shape for a fully authenticated active principal', async () => {
      const app = await buildApp(
        deps(
          fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) }),
          principalRepository({ ...ACTIVE, isOwner: true }),
        ),
      );

      const response = await app.inject({ method: 'GET', url: '/api/session' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        user: { id: 'user_synthetic', name: 'Synthetic Person', email: 'person@synthetic.invalid' },
        isOwner: true,
      });
      for (const leak of ['raw-session-token-value', 'session_internal_id', 'twoFactorEnabled', 'createdAt', 'mfa']) {
        expect(response.body).not.toContain(leak);
      }
    });

    it('accepts a session created exactly at MFA completion', async () => {
      const app = await buildApp(
        deps(fakeBackend({
          getSession: vi.fn(async () => jsonResponse(200, sessionBody({ createdAt: MFA_COMPLETED_AT.toISOString() }))),
        })),
      );

      expect((await app.inject({ method: 'GET', url: '/api/session' })).statusCode).toBe(200);
    });

    it('denies every incomplete, disagreeing, or malformed state with one identical response', async () => {
      const cases: Array<[Record<string, unknown> | null, Principal | null]> = [
        [null, ACTIVE],
        [sessionBody(), null],
        [sessionBody(), DISABLED],
        [sessionBody(), MFA_INCOMPLETE],
        [sessionBody({ twoFactorEnabled: false }), ACTIVE],
        [sessionBody({ twoFactorEnabled: undefined }), ACTIVE],
        [sessionBody({ twoFactorEnabled: 'true' }), ACTIVE],
        [sessionBody({ createdAt: '2026-09-13T08:59:59.999Z' }), ACTIVE],
        [sessionBody({ createdAt: 'not-a-date' }), ACTIVE],
        [sessionBody({ createdAt: undefined }), ACTIVE],
      ];

      for (const [body, principal] of cases) {
        const app = await buildApp(
          deps(fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, body)) }), principalRepository(principal)),
        );
        const response = await app.inject({ method: 'GET', url: '/api/session' });
        expect({ status: response.statusCode, body: response.body }).toEqual({
          status: 401,
          body: JSON.stringify({ error: 'unauthorized' }),
        });
      }
    });

    it('ignores any MFA claim a client sends', async () => {
      const app = await buildApp(
        deps(fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody({ twoFactorEnabled: false }))) })),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/session',
        headers: { 'x-two-factor-enabled': 'true', 'x-mfa-completed': 'true', cookie: 'mfa=done' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('denies a session ever bound to an Owner recovery, even when every MFA condition passes (DEC-436)', async () => {
      const recoverySessions = recoveryGate(true);
      const app = await buildApp(
        deps(
          fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) }),
          principalRepository({ ...ACTIVE, isOwner: true }),
          replayGuard(),
          recoverySessions,
        ),
      );

      const response = await app.inject({ method: 'GET', url: '/api/session' });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
      expect(recoverySessions.isRecoverySession).toHaveBeenCalledWith('session_internal_id');
    });

    it('denies a session without a session id, and fails closed when the recovery lookup throws', async () => {
      const missingId = await buildApp(
        deps(fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody({ id: undefined }))) })),
      );
      const emptyId = await buildApp(
        deps(fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody({ id: '' }))) })),
      );
      const throwingLookup = await buildApp(
        deps(
          fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) }),
          principalRepository(ACTIVE),
          replayGuard(),
          { isRecoverySession: vi.fn(async () => { throw new Error('recovery lookup failure detail'); }) },
        ),
      );

      for (const app of [missingId, emptyId, throwingLookup]) {
        const response = await app.inject({ method: 'GET', url: '/api/session' });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'unauthorized' });
        expect(response.body).not.toContain('detail');
      }
    });

    it('fails closed when session resolution or the principal lookup throws', async () => {
      const throwingSession = await buildApp(
        deps(fakeBackend({ getSession: vi.fn(async () => { throw new Error('database detail that must not leak'); }) })),
      );
      const throwingPrincipal = await buildApp(
        deps(fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) }), {
          findByUserId: vi.fn(async () => { throw new Error('principal lookup failure detail'); }),
        }),
      );

      for (const app of [throwingSession, throwingPrincipal]) {
        const response = await app.inject({ method: 'GET', url: '/api/session' });
        expect(response.statusCode).toBe(401);
        expect(response.body).not.toContain('detail');
      }
    });

    it('forwards session-refresh cookies on authenticated routes', async () => {
      const app = await buildApp(
        deps(fakeBackend({
          getSession: vi.fn(async () => jsonResponse(200, sessionBody(), ['refreshed=1; Path=/; HttpOnly'])),
        })),
      );

      const response = await app.inject({ method: 'GET', url: '/api/session' });

      expect(cookiesOf(response.headers['set-cookie'])).toContain('refreshed=1; Path=/; HttpOnly');
    });
  });

  it('rejects an oversized body before it reaches Better Auth', async () => {
    const backend = fakeBackend();
    const app = await buildApp(deps(backend));

    for (const url of ['/api/auth/sign-in/email', '/api/auth/two-factor/verify-totp']) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: `${COOKIES.twoFactor}=v` },
        payload: { email: 'person@synthetic.invalid', password: 'x'.repeat(64 * 1024), code: '123456' },
      });
      expect(response.statusCode, url).toBe(413);
    }
    expect(backend.handle).not.toHaveBeenCalled();
  });

  it('refuses to register without its dependencies', () => {
    const app = Fastify();
    registerRouteAccessGuard(app);
    apps.push(app);

    expect(() => registerAuthRoutes(app, { ...deps(fakeBackend()), backend: undefined as never })).toThrow(/backend/i);
    expect(() => registerAuthenticationGuard(app, { ...deps(fakeBackend()), principals: undefined as never })).toThrow(/principal/i);
    expect(() => registerAuthRoutes(app, { ...deps(fakeBackend()), trustedOrigins: [] })).toThrow(/origin/i);
    expect(() => registerAuthRoutes(app, { ...deps(fakeBackend()), replay: undefined as never })).toThrow(/replay/i);
    expect(() => registerAuthRoutes(app, { ...deps(fakeBackend()), cookies: undefined as never })).toThrow(/cookie/i);
    expect(() =>
      registerAuthenticationGuard(app, { ...deps(fakeBackend()), recoverySessions: undefined as never }),
    ).toThrow(/recovery/i);
  });

  it('writes no password, TOTP code, cookie, or session token to the log', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const app = await buildApp(
      deps(fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, sessionBody())) }), principalRepository(ACTIVE), replayGuard('replayed')),
      stream,
    );

    const password = 'distinct synthetic passphrase marker';
    const cookieValue = 'distinct-cookie-value-marker';
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: `${COOKIES.sessionToken}=${cookieValue}` },
      payload: { email: 'person@synthetic.invalid', password },
    });
    await verifyTotp(app, { payload: { code: '975310' }, headers: { cookie: `${COOKIES.twoFactor}=${cookieValue}` } });
    await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `${COOKIES.sessionToken}=${cookieValue}` } });

    const log = lines.join('');
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [password, cookieValue, '975310', 'raw-session-token-value', 'new-signed-session', 'signed-challenge-value']) {
      expect(log).not.toContain(secret);
    }
  });
});
