import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../src/server.ts';
import { settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';

// Port 1 is reserved and closed. Route classification is a startup-time
// concern and must be provable with Docker stopped, so these stay unit tests.
const UNREACHABLE_DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';

function build(): Promise<FastifyInstance> {
  return buildServer({ databaseUrl: UNREACHABLE_DATABASE_URL, auth: syntheticAuthSettings() });
}

describe('route access classification (default-deny registration)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await settle();
    await app?.close();
    app = undefined;
  });

  it('refuses to register a route that declares no access classification', async () => {
    app = await build();

    expect(() => {
      app!.get('/forgot-to-classify', async () => ({ ok: true }));
    }).toThrow(/access/i);
  });

  it('refuses to register a route whose access classification is not recognised', async () => {
    app = await build();

    expect(() => {
      app!.get(
        '/typo',
        // @ts-expect-error deliberately invalid: the guard must reject
        // unknown values at runtime, not just in the type system.
        { config: { access: 'mfa-challange' } },
        async () => ({ ok: true }),
      );
    }).toThrow(/access/i);
  });

  it('accepts each of the eight recognised classifications', async () => {
    app = await build();

    expect(() => {
      app!.get('/a', { config: { access: 'public' } }, async () => ({ ok: true }));
      app!.get('/b', { config: { access: 'guest-only' } }, async () => ({ ok: true }));
      app!.get('/c', { config: { access: 'authenticated' } }, async () => ({ ok: true }));
      app!.post('/d', { config: { access: 'session-cleanup' } }, async () => ({ ok: true }));
      app!.post('/e', { config: { access: 'mfa-challenge' } }, async () => ({ ok: true }));
      app!.post('/f', { config: { access: 'recovery' } }, async () => ({ ok: true }));
      app!.get('/g', { config: { access: 'owner' } }, async () => ({ ok: true }));
      app!.post('/h', { config: { access: 'invitation' } }, async () => ({ ok: true }));
    }).not.toThrow();
  });

  it('refuses a recovery-classified route that brings no recovery gate of its own', async () => {
    app = await build();
    app.post('/unguarded-recovery', { config: { access: 'recovery' } }, async () => ({ reached: true }));
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/unguarded-recovery', payload: {} });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('records /health and /ready as explicitly public', async () => {
    app = await build();
    await app.ready();

    expect(app.routeAccess.get('GET /health')).toBe('public');
    expect(app.routeAccess.get('GET /ready')).toBe('public');
  });

  it('keeps /health and /ready serving their existing responses', async () => {
    app = await build();
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'not_ready' });
  });

  it('exposes exactly the approved route surface and nothing else', async () => {
    app = await build();
    await app.ready();

    expect([...app.routeAccess.entries()].sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ['GET /api/owner/invitations', 'owner'],
      ['GET /api/session', 'authenticated'],
      ['GET /health', 'public'],
      ['GET /ready', 'public'],
      ['HEAD /api/owner/invitations', 'owner'],
      ['HEAD /api/session', 'authenticated'],
      ['HEAD /health', 'public'],
      ['HEAD /ready', 'public'],
      ['POST /api/auth/recovery/authenticator/start', 'recovery'],
      ['POST /api/auth/recovery/authenticator/verify', 'recovery'],
      ['POST /api/auth/recovery/verify-code', 'mfa-challenge'],
      ['POST /api/auth/sign-in/email', 'guest-only'],
      ['POST /api/auth/sign-out', 'session-cleanup'],
      ['POST /api/auth/two-factor/verify-totp', 'mfa-challenge'],
      ['POST /api/invitation/complete', 'invitation'],
      ['POST /api/invitation/inspect', 'invitation'],
      ['POST /api/invitation/password', 'invitation'],
      ['POST /api/invitation/totp', 'invitation'],
      ['POST /api/owner/invitations', 'owner'],
      ['POST /api/owner/invitations/:id/cancel', 'owner'],
      ['POST /api/owner/invitations/:id/resend', 'owner'],
    ]);
  });

  it('refuses every Owner invitation route without a session, before any database work', async () => {
    app = await build();
    await app.ready();

    for (const [method, url] of [
      ['GET', '/api/owner/invitations'],
      ['POST', '/api/owner/invitations'],
      ['POST', '/api/owner/invitations/1/resend'],
      ['POST', '/api/owner/invitations/1/cancel'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
        ...(method === 'POST' ? { payload: { email: 'new.admin@example.test' } } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('refuses a state-changing Owner route without a trusted Origin, even before resolving a session', async () => {
    app = await build();
    app.post('/owner-probe', { config: { access: 'owner' } }, async () => ({ reached: true }));
    await app.ready();

    for (const headers of [{}, { origin: 'https://evil.example.test' }, { origin: 'null' }]) {
      const response = await app.inject({ method: 'POST', url: '/owner-probe', headers, payload: {} });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
    }
  });

  it('refuses every invitation-classified request without a trusted Origin, before its handler runs (DEC-444)', async () => {
    app = await build();
    let reached = 0;
    app.post('/invitation-probe', { config: { access: 'invitation' } }, async () => {
      reached += 1;
      return { reached: true };
    });
    await app.ready();

    for (const headers of [{}, { origin: 'https://evil.example.test' }, { origin: 'null' }, { origin: 'http://127.0.0.1:5173/extra' }]) {
      const response = await app.inject({ method: 'POST', url: '/invitation-probe', headers, payload: {} });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
    }
    expect(reached).toBe(0);

    const trusted = await app.inject({ method: 'POST', url: '/invitation-probe', headers: { origin: 'http://127.0.0.1:5173' }, payload: {} });
    expect(trusted.statusCode).toBe(200);
    expect(reached).toBe(1);
  });

  it('refuses every acceptance route from an untrusted Origin or without JSON, before any database work', async () => {
    app = await build();
    await app.ready();

    for (const url of ['/api/invitation/inspect', '/api/invitation/password', '/api/invitation/totp', '/api/invitation/complete']) {
      const hostile = await app.inject({
        method: 'POST',
        url,
        headers: { origin: 'https://evil.example.test', 'content-type': 'application/json' },
        payload: { token: 'x' },
      });
      expect(hostile.statusCode, url).toBe(403);
      expect(hostile.json()).toEqual({ error: 'forbidden' });

      const form = await app.inject({
        method: 'POST',
        url,
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'text/plain' },
        payload: '{"token":"x"}',
      });
      expect(form.statusCode, url).toBe(415);
      expect(form.json()).toEqual({ error: 'unsupported_media_type' });
      expect(form.headers['cache-control']).toBe('no-store');
      expect(form.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('refuses to build without authentication configuration', async () => {
    await expect(buildServer({ databaseUrl: UNREACHABLE_DATABASE_URL } as never)).rejects.toThrow(
      /authentication configuration/i,
    );
  });
});
