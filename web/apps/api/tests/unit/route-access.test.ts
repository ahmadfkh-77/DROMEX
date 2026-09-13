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
    // DEC-428: "undeclared" and "intentionally public" must never be the same
    // state. A forgotten classification has to stop the server, not silently
    // produce an unguarded route that looks fine until it is exploited.
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
        { config: { access: 'authenticatd' } },
        async () => ({ ok: true }),
      );
    }).toThrow(/access/i);
  });

  it('accepts each of the four recognised classifications', async () => {
    app = await build();

    expect(() => {
      app!.get('/a', { config: { access: 'public' } }, async () => ({ ok: true }));
      app!.get('/b', { config: { access: 'guest-only' } }, async () => ({ ok: true }));
      app!.get('/c', { config: { access: 'authenticated' } }, async () => ({ ok: true }));
      app!.post('/d', { config: { access: 'session-cleanup' } }, async () => ({ ok: true }));
    }).not.toThrow();
  });

  it('records /health and /ready as explicitly public', async () => {
    // Asserted against the mechanism's own record, not against a printed
    // route table: a string-parsed table is exactly the fragile post-hoc
    // inspection this design replaced.
    app = await build();
    await app.ready();

    expect(app.routeAccess.get('GET /health')).toBe('public');
    expect(app.routeAccess.get('GET /ready')).toBe('public');
  });

  it('keeps /health and /ready serving their existing responses', async () => {
    // Classification is metadata. It must not change behaviour that Phase 1
    // already proved and shipped.
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
      ['GET /api/session', 'authenticated'],
      ['GET /health', 'public'],
      ['GET /ready', 'public'],
      ['HEAD /api/session', 'authenticated'],
      ['HEAD /health', 'public'],
      ['HEAD /ready', 'public'],
      ['POST /api/auth/sign-in/email', 'guest-only'],
      ['POST /api/auth/sign-out', 'session-cleanup'],
    ]);
  });

  it('refuses to build without authentication configuration', async () => {
    // Once authentication routes exist, starting without their configuration
    // would mean a server that looks healthy but cannot authenticate anyone.
    await expect(
      buildServer({ databaseUrl: UNREACHABLE_DATABASE_URL } as never),
    ).rejects.toThrow(/authentication configuration/i);
  });
});
