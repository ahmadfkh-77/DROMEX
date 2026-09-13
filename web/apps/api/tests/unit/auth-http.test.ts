import { Writable } from 'node:stream';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DROMEX_CLIENT_IP_HEADER } from '../../src/auth/config.ts';
import {
  registerAuthenticationGuard,
  registerAuthRoutes,
  type AuthBackend,
  type AuthRoutesDependencies,
} from '../../src/auth/http.ts';
import type { Principal, PrincipalRepository } from '../../src/auth/principal.ts';
import { registerRouteAccessGuard } from '../../src/routeAccess.ts';
import { TEST_BASE_URL, TEST_TRUSTED_ORIGIN } from '../helpers/auth-settings.ts';

// These tests exercise the transport against a fake Better Auth backend, so
// every bridge property is provable with no database and no Docker.

const ACTIVE_SESSION_BODY = {
  session: { id: 'session_internal_id', token: 'raw-session-token-value' },
  user: {
    id: 'user_synthetic',
    name: 'Synthetic Person',
    email: 'person@synthetic.invalid',
    emailVerified: false,
    image: null,
  },
};

function jsonResponse(status: number, body: unknown, setCookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function fakeBackend(overrides: Partial<AuthBackend> = {}) {
  const backend = {
    handle: vi.fn(async (_request: Request) =>
      jsonResponse(200, { token: 'raw-session-token-value', user: { id: 'user_synthetic' } }, [
        'first=1; Path=/; HttpOnly',
        'second=2; Path=/; HttpOnly',
      ]),
    ),
    getSession: vi.fn(async (_headers: Headers) => jsonResponse(200, null)),
    ...overrides,
  };
  return backend;
}

function principalRepository(principal: Principal | null): PrincipalRepository {
  return { findByUserId: vi.fn(async () => principal) };
}

const ACTIVE: Principal = { userId: 'user_synthetic', status: 'active', isOwner: false };
const DISABLED: Principal = { userId: 'user_synthetic', status: 'disabled', isOwner: false };

const apps: FastifyInstance[] = [];

async function buildApp(
  deps: AuthRoutesDependencies,
  logStream?: Writable,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logStream ? { level: 'trace', stream: logStream } : false,
  });
  registerRouteAccessGuard(app);
  registerAuthenticationGuard(app, deps);
  registerAuthRoutes(app, deps);
  await app.ready();
  apps.push(app);
  return app;
}

function deps(
  backend: AuthBackend,
  principals: PrincipalRepository = principalRepository(ACTIVE),
): AuthRoutesDependencies {
  return { backend, principals, baseURL: TEST_BASE_URL, trustedOrigins: [TEST_TRUSTED_ORIGIN] };
}

function signOut(app: FastifyInstance, headers: Record<string, string> = { origin: TEST_TRUSTED_ORIGIN }) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-out',
    headers: { 'content-type': 'application/json', ...headers },
    payload: {},
  });
}

function signIn(app: FastifyInstance, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', ...headers },
    payload: { email: 'person@synthetic.invalid', password: 'a synthetic passphrase value' },
  });
}

function cookiesOf(header: string | string[] | undefined): string[] {
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
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
    ]);
  });

  it('answers unapproved authentication paths with a generic 404 that never reaches Better Auth', async () => {
    const backend = fakeBackend();
    const app = await buildApp(deps(backend));

    const unapproved: Array<[string, string]> = [
      ['POST', '/api/auth/sign-up/email'],
      ['GET', '/api/auth/get-session'],
      ['POST', '/api/auth/get-session'],
      ['GET', '/api/auth/sign-in/email'],
      ['DELETE', '/api/auth/sign-out'],
      ['POST', '/api/auth/request-password-reset'],
      ['POST', '/api/auth/update-user'],
      ['POST', '/api/auth/delete-user'],
      ['GET', '/api/auth/list-accounts'],
      ['POST', '/api/auth/sign-in/social'],
      ['POST', '/api/auth/sign-in/email/extra'],
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
      expect(response.body).not.toContain(url);
    }

    expect(backend.handle).not.toHaveBeenCalled();
    expect(backend.getSession).not.toHaveBeenCalled();
  });

  it('preserves every Set-Cookie header from a successful sign-in, unmerged', async () => {
    const app = await buildApp(deps(fakeBackend()));

    const response = await signIn(app);

    expect(response.statusCode).toBe(200);
    expect(cookiesOf(response.headers['set-cookie'])).toEqual([
      'first=1; Path=/; HttpOnly',
      'second=2; Path=/; HttpOnly',
    ]);
  });

  it('never returns the raw Better Auth sign-in body, which contains the session token', async () => {
    const app = await buildApp(deps(fakeBackend()));

    const response = await signIn(app);

    expect(response.json()).toEqual({ authenticated: true });
    expect(response.body).not.toContain('raw-session-token-value');
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
        'cf-connecting-ip': '5.5.5.5',
        'true-client-ip': '4.4.4.4',
        [DROMEX_CLIENT_IP_HEADER]: '6.6.6.6',
      },
      payload: { email: 'person@synthetic.invalid', password: 'a synthetic passphrase value' },
    });

    const forwarded = vi.mocked(backend.handle).mock.calls[0]![0];
    for (const spoofable of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip']) {
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

    expect(vi.mocked(backend.handle).mock.calls[0]![0].url).toBe(`${TEST_BASE_URL}/api/auth/sign-in/email`);
  });

  it('normalises every sign-in failure to one indistinguishable response', async () => {
    const failures: Array<[number, unknown]> = [
      [401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }],
      [401, { code: 'FAILED_TO_CREATE_SESSION', message: 'Failed to create session' }],
      [400, { code: 'INVALID_EMAIL', message: 'Invalid email' }],
      [403, { code: 'INVALID_ORIGIN', message: 'Invalid origin' }],
      [422, { code: 'VALIDATION_ERROR', message: 'Invalid body' }],
    ];

    const seen: Array<{ status: number; body: string; cookies: string[] }> = [];
    for (const [status, body] of failures) {
      const app = await buildApp(
        deps(
          fakeBackend({
            handle: vi.fn(async () => jsonResponse(status, body, ['leak=1; Path=/'])),
          }),
        ),
      );
      const response = await signIn(app);
      seen.push({
        status: response.statusCode,
        body: response.body,
        cookies: cookiesOf(response.headers['set-cookie']),
      });
    }

    for (const outcome of seen) {
      expect(outcome).toEqual({
        status: 401,
        body: JSON.stringify({ error: 'invalid_credentials' }),
        cookies: [],
      });
    }
  });

  it('returns a generic 429 when Better Auth rate-limits sign-in', async () => {
    const app = await buildApp(
      deps(
        fakeBackend({
          handle: vi.fn(async () => {
            const response = jsonResponse(429, { message: 'Too many requests. Please try again later.' });
            response.headers.set('x-retry-after', '42');
            return response;
          }),
        }),
      ),
    );

    const response = await signIn(app);

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: 'too_many_requests' });
    expect(response.headers['retry-after']).toBe('42');
    expect(response.headers['x-retry-after']).toBeUndefined();
  });

  it('drops an implausible retry time rather than passing it to the client', async () => {
    for (const value of ['178928979670571', '0', '-5', '1.5', 'soon']) {
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
      expect(response.headers['retry-after'], value).toBeUndefined();
    }
  });

  it('answers a thrown backend failure with a generic 500 on sign-in and sign-out', async () => {
    const app = await buildApp(
      deps(
        fakeBackend({
          handle: vi.fn(async () => {
            throw new Error('internal detail that must not leak');
          }),
        }),
      ),
    );

    for (const response of [await signIn(app), await signOut(app)]) {
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(response.body).not.toContain('internal detail');
    }
  });

  it('lets sign-out through without resolving a session or a principal', async () => {
    const backend = fakeBackend({
      handle: vi.fn(async () => jsonResponse(200, { success: true }, ['session=; Max-Age=0; Path=/'])),
      getSession: vi.fn(async () => jsonResponse(200, ACTIVE_SESSION_BODY)),
    });
    const principals = principalRepository(null);
    const app = await buildApp(deps(backend, principals));

    const response = await signOut(app, { origin: TEST_TRUSTED_ORIGIN, cookie: 'session=present' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ signedOut: true });
    expect(backend.handle).toHaveBeenCalledTimes(1);
    expect(backend.getSession).not.toHaveBeenCalled();
    expect(principals.findByUserId).not.toHaveBeenCalled();
  });

  it('refuses sign-out from a missing, untrusted, or opaque Origin before reaching Better Auth', async () => {
    const backend = fakeBackend();
    const app = await buildApp(deps(backend));

    const attempts: Array<Record<string, string>> = [
      { cookie: 'session=present' },
      { origin: 'https://attacker.example', cookie: 'session=present' },
      { origin: 'null', cookie: 'session=present' },
      { origin: `${TEST_TRUSTED_ORIGIN}.attacker.example` },
    ];
    for (const headers of attempts) {
      const response = await signOut(app, headers);
      expect(response.statusCode, JSON.stringify(headers)).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(backend.handle).not.toHaveBeenCalled();
  });

  it('reports a failed revocation as an internal error, never as success', async () => {
    const app = await buildApp(
      deps(fakeBackend({ handle: vi.fn(async () => jsonResponse(500, { message: 'db down' })) })),
    );

    const response = await signOut(app);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
  });

  it('refuses sign-in while a valid active-principal session already exists', async () => {
    const backend = fakeBackend({
      getSession: vi.fn(async () => jsonResponse(200, ACTIVE_SESSION_BODY)),
    });
    const app = await buildApp(deps(backend, principalRepository(ACTIVE)));

    const response = await signIn(app, { cookie: 'session=present' });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    expect(backend.handle).not.toHaveBeenCalled();
  });

  it('allows sign-in when the existing session belongs to a disabled principal', async () => {
    const backend = fakeBackend({
      getSession: vi.fn(async () => jsonResponse(200, ACTIVE_SESSION_BODY)),
    });
    const app = await buildApp(deps(backend, principalRepository(DISABLED)));

    await signIn(app, { cookie: 'session=present' });

    expect(backend.handle).toHaveBeenCalledTimes(1);
  });

  it('returns only the sanitized session shape', async () => {
    const app = await buildApp(
      deps(
        fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, ACTIVE_SESSION_BODY)) }),
        principalRepository({ userId: 'user_synthetic', status: 'active', isOwner: true }),
      ),
    );

    const response = await app.inject({ method: 'GET', url: '/api/session' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: 'user_synthetic', name: 'Synthetic Person', email: 'person@synthetic.invalid' },
      isOwner: true,
    });
    for (const leak of ['raw-session-token-value', 'session_internal_id', 'emailVerified']) {
      expect(response.body).not.toContain(leak);
    }
  });

  it('denies unauthenticated, missing-principal, and disabled-principal requests identically', async () => {
    const outcomes = [];
    for (const [session, principal] of [
      [null, ACTIVE],
      [ACTIVE_SESSION_BODY, null],
      [ACTIVE_SESSION_BODY, DISABLED],
    ] as const) {
      const app = await buildApp(
        deps(
          fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, session)) }),
          principalRepository(principal),
        ),
      );
      const response = await app.inject({ method: 'GET', url: '/api/session' });
      outcomes.push({ status: response.statusCode, body: response.body });
    }

    for (const outcome of outcomes) {
      expect(outcome).toEqual({ status: 401, body: JSON.stringify({ error: 'unauthorized' }) });
    }
  });

  it('fails closed when session resolution throws', async () => {
    const app = await buildApp(
      deps(
        fakeBackend({
          getSession: vi.fn(async () => {
            throw new Error('database detail that must not leak');
          }),
        }),
      ),
    );

    const response = await app.inject({ method: 'GET', url: '/api/session' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    expect(response.body).not.toContain('database detail');
  });

  it('fails closed when the principal lookup throws', async () => {
    const app = await buildApp(
      deps(fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, ACTIVE_SESSION_BODY)) }), {
        findByUserId: vi.fn(async () => {
          throw new Error('principal lookup failure detail');
        }),
      }),
    );

    const response = await app.inject({ method: 'GET', url: '/api/session' });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('principal lookup failure detail');
  });

  it('forwards session-refresh cookies on authenticated routes', async () => {
    const app = await buildApp(
      deps(
        fakeBackend({
          getSession: vi.fn(async () =>
            jsonResponse(200, ACTIVE_SESSION_BODY, ['refreshed=1; Path=/; HttpOnly']),
          ),
        }),
      ),
    );

    const response = await app.inject({ method: 'GET', url: '/api/session' });

    expect(cookiesOf(response.headers['set-cookie'])).toContain('refreshed=1; Path=/; HttpOnly');
  });

  it('sign-out forwards cookie-clearing headers but never the raw body', async () => {
    const app = await buildApp(
      deps(
        fakeBackend({
          getSession: vi.fn(async () => jsonResponse(200, ACTIVE_SESSION_BODY)),
          handle: vi.fn(async () =>
            jsonResponse(200, { success: true, url: 'https://provider.example' }, [
              'session=; Max-Age=0; Path=/',
            ]),
          ),
        }),
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: 'session=present' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ signedOut: true });
    expect(cookiesOf(response.headers['set-cookie'])).toContain('session=; Max-Age=0; Path=/');
  });

  it('rejects an oversized sign-in body before it reaches Better Auth', async () => {
    const backend = fakeBackend();
    const app = await buildApp(deps(backend));

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
      payload: { email: 'person@synthetic.invalid', password: 'x'.repeat(64 * 1024) },
    });

    expect(response.statusCode).toBe(413);
    expect(backend.handle).not.toHaveBeenCalled();
  });

  it('refuses to register without its dependencies', () => {
    const app = Fastify();
    registerRouteAccessGuard(app);
    apps.push(app);

    expect(() =>
      registerAuthRoutes(app, { ...deps(fakeBackend()), backend: undefined as never }),
    ).toThrow(/backend/i);
    expect(() =>
      registerAuthenticationGuard(app, { ...deps(fakeBackend()), principals: undefined as never }),
    ).toThrow(/principal/i);
    expect(() =>
      registerAuthRoutes(app, { ...deps(fakeBackend()), trustedOrigins: [] }),
    ).toThrow(/origin/i);
  });

  it('writes no password, cookie, or session token to the log', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const app = await buildApp(
      deps(fakeBackend({ getSession: vi.fn(async () => jsonResponse(200, null)) })),
      stream,
    );

    const password = 'distinct synthetic passphrase marker';
    const cookieValue = 'distinct-cookie-value-marker';
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: {
        origin: TEST_TRUSTED_ORIGIN,
        'content-type': 'application/json',
        cookie: `better-auth.session_token=${cookieValue}`,
        authorization: 'Bearer distinct-authorization-marker',
      },
      payload: { email: 'person@synthetic.invalid', password },
    });
    await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: `better-auth.session_token=${cookieValue}` },
    });

    const log = lines.join('');
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [password, cookieValue, 'distinct-authorization-marker', 'raw-session-token-value']) {
      expect(log).not.toContain(secret);
    }
  });
});
