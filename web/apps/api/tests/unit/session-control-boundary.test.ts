import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import * as sessionControlModule from '../../src/accounts/session-control.ts';
import { createSessionControl } from '../../src/accounts/session-control.ts';

/**
 * Checkpoint 4E: the Owner revokes another person's sessions through Better
 * Auth's own session store, never by DROMEX SQL (DEC-431) and never through
 * the excluded admin plugin (DEC-422). The one module allowed to reach that
 * store is small, never routed, and limited to three session operations.
 * Architectural and behavioural tests; none needs a database.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const SESSION_CONTROL = join(SRC, 'accounts', 'session-control.ts');
const SERVER = join(SRC, 'server.ts');

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

interface FakeSession {
  id: string;
  token: string;
  userId: string;
}

function fakeAuth(sessions: FakeSession[]) {
  const internalAdapter = {
    listSessions: vi.fn(async (userId: string) => sessions.filter((session) => session.userId === userId)),
    deleteSession: vi.fn(async (token: string) => {
      const index = sessions.findIndex((session) => session.token === token);
      if (index >= 0) sessions.splice(index, 1);
    }),
    deleteUserSessions: vi.fn(async (userId: string) => {
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (sessions[index]!.userId === userId) sessions.splice(index, 1);
      }
    }),
  };
  return { auth: { $context: Promise.resolve({ internalAdapter }) }, internalAdapter };
}

describe('Owner session-revocation capability boundary (checkpoint 4E)', () => {
  it('is imported by the server alone, which hands it to the account service as a port', async () => {
    const importers: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if ((await importsOf(file)).includes(SESSION_CONTROL)) importers.push(label(file));
    }
    expect(importers).toEqual([label(SERVER)]);
  });

  it('exports only its constructor', () => {
    expect(Object.keys(sessionControlModule)).toEqual(['createSessionControl']);
  });

  it('is the only module that reaches Better Auth’s internal session store', async () => {
    const reaching: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if (/\$context|internalAdapter/.test(await codeOf(file))) reaching.push(label(file));
    }
    expect(reaching).toEqual(['accounts/session-control.ts']);
  });

  it('uses exactly three session operations, and no user, account, or session-creating call', async () => {
    const code = await codeOf(SESSION_CONTROL);
    const used = [...code.matchAll(/internalAdapter\.(\w+)/g)].map((match) => match[1]).sort();
    expect([...new Set(used)]).toEqual(['deleteSession', 'deleteUserSessions', 'listSessions']);
    expect(code).not.toMatch(/\.handler\b|fastify|toNodeHandler|process\.env|dotenv|betterAuth\s*\(/i);
    expect(code).not.toMatch(/\bquery\s*\(/);
  });

  it('revokes only the named session of the named user, by Better Auth identifier, never trusting a token from outside', async () => {
    const sessions: FakeSession[] = [
      { id: 's1', token: 'token-one', userId: 'admin' },
      { id: 's2', token: 'token-two', userId: 'admin' },
      { id: 's3', token: 'token-three', userId: 'other' },
    ];
    const { auth, internalAdapter } = fakeAuth(sessions);
    const control = createSessionControl(auth);

    expect(await control.revokeSession('admin', 's2')).toBe(true);
    expect(sessions.map((session) => session.id)).toEqual(['s1', 's3']);
    expect(internalAdapter.deleteSession).toHaveBeenCalledWith('token-two');

    // Another user's session, a missing one, or a token passed as an id is never deleted.
    expect(await control.revokeSession('admin', 's3')).toBe(false);
    expect(await control.revokeSession('admin', 'missing')).toBe(false);
    expect(await control.revokeSession('admin', 'token-one')).toBe(false);
    expect(sessions.map((session) => session.id)).toEqual(['s1', 's3']);
  });

  it('revokes every session of one user and reports how many remain', async () => {
    const sessions: FakeSession[] = [
      { id: 's1', token: 'token-one', userId: 'admin' },
      { id: 's2', token: 'token-two', userId: 'admin' },
      { id: 's3', token: 'token-three', userId: 'other' },
    ];
    const { auth, internalAdapter } = fakeAuth(sessions);

    expect(await createSessionControl(auth).revokeAllSessions('admin')).toEqual({ remaining: 0 });
    expect(internalAdapter.deleteUserSessions).toHaveBeenCalledWith('admin');
    expect(sessions.map((session) => session.id)).toEqual(['s3']);
  });

  it('reports sessions a failed deletion left behind, and never returns a token', async () => {
    const sessions: FakeSession[] = [{ id: 's1', token: 'token-one', userId: 'admin' }];
    const { auth, internalAdapter } = fakeAuth(sessions);
    internalAdapter.deleteUserSessions.mockImplementationOnce(async () => undefined);

    const result = await createSessionControl(auth).revokeAllSessions('admin');

    expect(result).toEqual({ remaining: 1 });
    expect(JSON.stringify(result)).not.toContain('token');
  });
});
