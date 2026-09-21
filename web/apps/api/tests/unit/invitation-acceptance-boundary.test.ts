import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import * as enrolmentIdentityModule from '../../src/invitations/enrolment-identity.ts';
import { buildServer } from '../../src/server.ts';
import { UNREACHABLE_DATABASE_URL, settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';

/**
 * Checkpoint 4B2 (DEC-444 (5)): the server-internal Better Auth instance that
 * can create an invited identity is reachable only from the invitation
 * acceptance service, is never mounted on a route, and adds no sign-up
 * surface. These are architectural tests over the source tree and the built
 * server; none needs a database.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const ENROLMENT_IDENTITY = join(SRC, 'invitations', 'enrolment-identity.ts');
const ACCEPTANCE_SERVICE = join(SRC, 'invitations', 'invitation-acceptance.ts');
const OWNER_IDENTITY = join(SRC, 'provisioning', 'owner-identity.ts');
const RUNTIME_INSTANCE = join(SRC, 'auth', 'instance.ts');

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

async function importsOf(file: string): Promise<string[]> {
  const text = await readFile(file, 'utf8');
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]!)
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => resolve(dirname(file), specifier));
}

/** Source text with comments removed, so documentation never counts as use. */
async function codeOf(file: string): Promise<string> {
  const text = await readFile(file, 'utf8');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const label = (file: string) => relative(SRC, file).replaceAll('\\', '/');

describe('internal invitation sign-up capability boundary (DEC-444 (5))', () => {
  const servers: Array<{ close(): Promise<unknown> }> = [];

  afterEach(async () => {
    await settle();
    while (servers.length > 0) await servers.pop()!.close();
  });

  it('is imported by the invitation acceptance service and by nothing else', async () => {
    const importers: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if ((await importsOf(file)).includes(ENROLMENT_IDENTITY)) importers.push(label(file));
    }
    expect(importers).toEqual([label(ACCEPTANCE_SERVICE)]);
  });

  it('exports only its constructor: no instance, handler, or options object', () => {
    expect(Object.keys(enrolmentIdentityModule)).toEqual(['createEnrolmentIdentity']);
  });

  it('never exposes, forwards, or mounts a Better Auth request handler', async () => {
    const code = await codeOf(ENROLMENT_IDENTITY);
    expect(code).not.toMatch(/\.handler\b/);
    expect(code).not.toMatch(/fastify/i);
    expect(code).not.toMatch(/toNodeHandler|app\.(get|post|route|all|register)\b/);
    expect(code).not.toMatch(/process\.env|dotenv|['"]\.env['"]/);
    // The instance never escapes the closure that uses it.
    expect(code).not.toMatch(/return\s+auth\b|export\s+(const|let)\s+auth\b|auth\s*,\s*\}/);
  });

  it('keeps sign-up-capable Better Auth construction to exactly the two approved internal modules', async () => {
    const signUp: string[] = [];
    const enabledSignUp: string[] = [];
    const constructions: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const code = await codeOf(file);
      if (/\bsignUpEmail\b/.test(code)) signUp.push(label(file));
      if (/disableSignUp:\s*false/.test(code)) enabledSignUp.push(label(file));
      if (/\bbetterAuth\s*\(/.test(code)) constructions.push(label(file));
    }
    expect(signUp.sort()).toEqual([label(ENROLMENT_IDENTITY), label(OWNER_IDENTITY)].sort());
    expect(enabledSignUp.sort()).toEqual([label(ENROLMENT_IDENTITY), label(OWNER_IDENTITY)].sort());
    // The terminal recovery identity (DEC-437) builds an instance too, with sign-up still disabled.
    expect(constructions.sort()).toEqual(
      [label(RUNTIME_INSTANCE), label(ENROLMENT_IDENTITY), label(OWNER_IDENTITY), 'provisioning/terminal-recovery-identity.ts'].sort(),
    );
  });

  it('keeps the runtime instance free of sign-up and the acceptance routes free of Better Auth handlers', async () => {
    const runtime = await codeOf(join(SRC, 'auth', 'config.ts'));
    expect(runtime).toMatch(/disableSignUp:\s*true/);
    const http = await codeOf(join(SRC, 'invitations', 'acceptance-http.ts'));
    expect(http).not.toMatch(/\.handler\b|betterAuth|signUpEmail|enrolment-identity/);
  });

  it('adds no sign-up route to the built server, and every sign-up path is a plain 404', async () => {
    const app = await buildServer({ databaseUrl: UNREACHABLE_DATABASE_URL, auth: syntheticAuthSettings() });
    servers.push(app);
    await app.ready();

    const routes = [...app.routeAccess.keys()];
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.filter((route) => /sign-?up|register|signup/i.test(route))).toEqual([]);

    for (const url of [
      '/api/auth/sign-up/email',
      '/api/auth/sign-up',
      '/sign-up/email',
      '/sign-up',
      '/api/sign-up',
      '/api/invitation/sign-up',
      '/api/invitation/sign-up/email',
      '/api/auth/two-factor/enable',
      '/api/auth/two-factor/generate-backup-codes',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
        payload: { name: 'Synthetic', email: 'synthetic@example.test', password: 'synthetic passphrase only' },
      });
      expect(response.statusCode, url).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    }
  });
});
