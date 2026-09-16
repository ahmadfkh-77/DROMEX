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
/** The only module DEC-437 permits to write a Better Auth-owned row. */
const DEC_437_MODULE = join(PROVISIONING, 'owner-mfa-reset.ts');

const BETTER_AUTH_WRITE =
  /\b(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop\s+table|copy)\s+"?(user|account|session|verification|rateLimit|twoFactor)"?(\s|$|\(|;)/gi;

/** Every Better Auth-table write statement in a text, normalised as `<verb> <table>`. */
function betterAuthWritesIn(text: string): string[] {
  return [...text.matchAll(BETTER_AUTH_WRITE)].map(
    (match) => `${match[1]!.toLowerCase().replace(/\s+/g, ' ')} ${match[2]}`,
  );
}

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

  it('leaves every Better Auth-owned table to Better Auth except the two DEC-437 statements, in their one allowlisted module', async () => {
    const files = await sourceFiles(SRC);
    expect(files).toContain(DEC_437_MODULE);
    expect(files.some((file) => file.endsWith('owner-recovery.ts'))).toBe(true);

    for (const file of files) {
      const writes = betterAuthWritesIn(await readFile(file, 'utf8'));
      // Exactly W1 and W2, once each, and nothing else anywhere.
      expect(writes, file).toEqual(file === DEC_437_MODULE ? ['update user', 'delete from twoFactor'] : []);
    }
  });

  it('never inserts, updates, or copies a twoFactor row with DROMEX SQL; only DEC-437 deletes the Owner row', async () => {
    // The generated table has no database defaults, so a row written outside
    // Better Auth's adapter could carry a NULL counter that never locks.
    const rewrite = /\b(insert\s+into|update|truncate|alter\s+table|drop\s+table|copy)\s+"?twoFactor"?/i;
    const removal = /\bdelete\s+from\s+"?twoFactor"?/gi;
    const files = await sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(10);

    for (const file of files) {
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toMatch(rewrite);
      expect([...text.matchAll(removal)], file).toHaveLength(file === DEC_437_MODULE ? 1 : 0);
    }
  });

  it('keeps the DEC-437 statements parameterised and scoped to one Owner', async () => {
    const text = await readFile(DEC_437_MODULE, 'utf8');

    expect(text).toMatch(
      /UPDATE "user" SET "twoFactorEnabled" = FALSE, "updatedAt" = CURRENT_TIMESTAMP WHERE id = \$1 AND "twoFactorEnabled" = TRUE/,
    );
    expect(text).toMatch(/DELETE FROM "twoFactor" WHERE "userId" = \$1`/);
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

  it('adds no HTTP route: the complete server route table is exactly the approved surface', async () => {
    const app = await buildServer({
      databaseUrl: UNREACHABLE_DATABASE_URL,
      auth: syntheticAuthSettings(),
    });
    try {
      await app.ready();
      const routes = [...app.routeAccess.entries()].sort(([a], [b]) => a.localeCompare(b));

      // The Owner invitation routes (checkpoint 4B1) are the only addition
      // since provisioning; none of them is a provisioning route.
      expect(routes).toEqual([
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
        ['POST /api/owner/invitations', 'owner'],
        ['POST /api/owner/invitations/:id/cancel', 'owner'],
        ['POST /api/owner/invitations/:id/resend', 'owner'],
      ]);
    } finally {
      await settle();
      await app.close();
    }
  });
});
