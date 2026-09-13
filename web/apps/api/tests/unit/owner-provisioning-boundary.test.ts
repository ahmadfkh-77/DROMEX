import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { createAuthOptions, type AuthEnvironment } from '../../src/auth/config.ts';
import { buildServer } from '../../src/server.ts';
import {
  UNREACHABLE_DATABASE_URL,
  settle,
  syntheticAuthSettings,
} from '../helpers/auth-settings.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const PROVISIONING = join(SRC, 'provisioning');

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

/** Resolved relative import targets of one source file. */
async function importsOf(file: string): Promise<string[]> {
  const text = await readFile(file, 'utf8');
  const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  );
  return specifiers
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => resolve(dirname(file), specifier));
}

/** Every source file reachable from an entry through relative imports. */
async function reachableFrom(entry: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...(await importsOf(file)));
  }
  return seen;
}

const inertPools: Pool[] = [];

describe('Owner provisioning isolation from the running server', () => {
  afterEach(async () => {
    await settle();
    while (inertPools.length > 0) await inertPools.pop()?.end().catch(() => undefined);
  });

  it('is unreachable from the server entry point through any import chain', async () => {
    const reachable = await reachableFrom(join(SRC, 'server.ts'));

    expect(reachable.size).toBeGreaterThan(3); // the walk really followed imports
    const provisioning = [...reachable].filter((file) =>
      relative(PROVISIONING, file).split(/[\\/]/)[0] !== '..',
    );
    expect(provisioning).toEqual([]);
  });

  it('never reads the process environment or a .env file in any provisioning module', async () => {
    const files = await sourceFiles(PROVISIONING);
    expect(files.length).toBeGreaterThanOrEqual(5);

    for (const file of files) {
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toMatch(/process\.env|--env-file|dotenv|['"]\.env['"]/);
    }
  });

  it('issues no mutating SQL against Better Auth-owned tables from any provisioning module', async () => {
    const mutation =
      /\b(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop\s+table)\s+"?(user|account|session|verification|rateLimit)"?(\s|$|\()/i;

    for (const file of await sourceFiles(PROVISIONING)) {
      expect(await readFile(file, 'utf8'), file).not.toMatch(mutation);
    }
  });

  it('keeps public sign-up disabled in the runtime configuration for every environment and cookie setting', () => {
    const environments: AuthEnvironment[] = ['development', 'test', 'production'];

    for (const environment of environments) {
      for (const allowInsecureCookies of [false, true]) {
        if (allowInsecureCookies && environment !== 'development') continue;
        const pool = new Pool({ connectionString: UNREACHABLE_DATABASE_URL });
        inertPools.push(pool);
        const production = environment === 'production';

        const options = createAuthOptions({
          ...syntheticAuthSettings({
            environment,
            allowInsecureCookies,
            ...(production
              ? { baseURL: 'https://app.synthetic.invalid', trustedOrigins: ['https://app.synthetic.invalid'] }
              : {}),
          }),
          database: pool,
        });

        expect(options.emailAndPassword?.disableSignUp).toBe(true);
        expect(options.emailAndPassword?.autoSignIn).toBe(false);
      }
    }
  });

  it('adds no HTTP route: the complete server route table is unchanged', async () => {
    const app = await buildServer({
      databaseUrl: UNREACHABLE_DATABASE_URL,
      auth: syntheticAuthSettings(),
    });
    try {
      await app.ready();
      const routes = [...app.routeAccess.entries()].sort(([a], [b]) => a.localeCompare(b));

      expect(routes).toEqual([
        ['GET /api/session', 'authenticated'],
        ['GET /health', 'public'],
        ['GET /ready', 'public'],
        ['HEAD /api/session', 'authenticated'],
        ['HEAD /health', 'public'],
        ['HEAD /ready', 'public'],
        ['POST /api/auth/sign-in/email', 'guest-only'],
        ['POST /api/auth/sign-out', 'session-cleanup'],
      ]);
    } finally {
      await settle();
      await app.close();
    }
  });
});
