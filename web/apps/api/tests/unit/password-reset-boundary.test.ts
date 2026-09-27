import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import * as resetIdentityModule from '../../src/password-reset/reset-identity.ts';
import { buildServer } from '../../src/server.ts';
import { TEST_TRUSTED_ORIGIN, UNREACHABLE_DATABASE_URL, settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';

/**
 * Checkpoint 4C (DEC-487 (2)): the server-internal Better Auth instance that
 * performs the final password write is reachable only from the password-reset
 * service, is never mounted, never creates a session, and Better Auth's own
 * reset routes stay unreachable. Architectural tests; none needs a database.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const RESET_IDENTITY = join(SRC, 'password-reset', 'reset-identity.ts');
const RESET_SERVICE = join(SRC, 'password-reset', 'password-reset.ts');

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

async function codeOf(file: string): Promise<string> {
  const text = await readFile(file, 'utf8');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const label = (file: string) => relative(SRC, file).replaceAll('\\', '/');

describe('internal password-write capability boundary (DEC-487 (2))', () => {
  const servers: Array<{ close(): Promise<unknown> }> = [];

  afterEach(async () => {
    await settle();
    while (servers.length > 0) await servers.pop()!.close();
  });

  it('is imported by the password-reset service and by nothing else', async () => {
    const importers: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if ((await importsOf(file)).includes(RESET_IDENTITY)) importers.push(label(file));
    }
    expect(importers).toEqual([label(RESET_SERVICE)]);
  });

  it('exports only its constructor', () => {
    expect(Object.keys(resetIdentityModule)).toEqual(['createResetIdentity']);
  });

  it('never exposes or mounts a handler, reads no environment, and never lets the instance escape', async () => {
    const code = await codeOf(RESET_IDENTITY);
    expect(code).not.toMatch(/\.handler\b/);
    expect(code).not.toMatch(/fastify/i);
    expect(code).not.toMatch(/toNodeHandler|app\.(get|post|route|all|register)\b/);
    expect(code).not.toMatch(/process\.env|dotenv|['"]\.env['"]/);
    expect(code).not.toMatch(/return\s+auth\b|export\s+(const|let)\s+auth\b|auth\s*,\s*\}/);
  });

  it('pins the reset settings: hashed identifiers, a short token, session revocation, no sign-up, and no session ever created', async () => {
    const code = await codeOf(RESET_IDENTITY);
    expect(code).toMatch(/revokeSessionsOnPasswordReset:\s*true/);
    expect(code).toMatch(/resetPasswordTokenExpiresIn:\s*RESET_WRITE_TOKEN_SECONDS/);
    expect(code).toMatch(/'reset-password:':\s*'hashed'/);
    expect(code).toMatch(/disableSignUp:\s*true/);
    expect(code).toMatch(/before:\s*async\s*\(\)\s*=>\s*false/);
    expect(code).toMatch(/logger:\s*\{\s*disabled:\s*true\s*\}/);
  });

  it('keeps every Better Auth construction to the approved modules', async () => {
    const constructions: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if (/\bbetterAuth\s*\(/.test(await codeOf(file))) constructions.push(label(file));
    }
    expect(constructions.sort()).toEqual(
      [
        'auth/instance.ts',
        'invitations/enrolment-identity.ts',
        'password-reset/reset-identity.ts',
        'provisioning/owner-identity.ts',
        'provisioning/terminal-recovery-identity.ts',
      ].sort(),
    );
  });

  it('stores reset identifiers hashed in the runtime configuration as well', async () => {
    expect(await codeOf(join(SRC, 'auth', 'config.ts'))).toMatch(/'reset-password:':\s*'hashed'/);
  });

  it('leaves every Better Auth reset route a plain 404 on the built server', async () => {
    const app = await buildServer({ databaseUrl: UNREACHABLE_DATABASE_URL, auth: syntheticAuthSettings() });
    servers.push(app);
    await app.ready();

    for (const url of [
      '/api/auth/request-password-reset',
      '/api/auth/reset-password',
      '/api/auth/reset-password/synthetic-token',
      '/api/auth/forget-password',
      '/api/auth/change-password',
      '/api/auth/set-password',
    ]) {
      for (const method of ['GET', 'POST'] as const) {
        const response = await app.inject({ method, url, headers: { origin: TEST_TRUSTED_ORIGIN }, payload: method === 'POST' ? {} : undefined });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
    }
  });
});
