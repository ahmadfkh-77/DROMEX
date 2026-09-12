import { randomBytes } from 'node:crypto';

import { Pool } from 'pg';

import { createAuth } from './instance.ts';

/**
 * Configuration entry point used **only** by the pinned `auth@1.7.4` CLI to
 * generate Better Auth's schema. It is never imported by the server, never
 * mounted on a route, and never used at runtime.
 *
 * Schema generation is pure code generation: the CLI reads this configuration
 * to learn which tables Better Auth needs and writes SQL. It does not need a
 * reachable database, and this file makes sure it cannot find one.
 *
 * Three deliberate properties:
 *
 * 1. **Nothing is read from the environment.** No `.env` file is loaded, no
 *    `process.env` lookup happens, and there is no fallback value anywhere in
 *    the chain. Every input is an explicit literal below, so running the
 *    generator cannot pick up a real credential by accident.
 *
 * 2. **The secret is synthetic and ephemeral.** It is generated in memory for
 *    this process only, never printed, never persisted, and never reused. It
 *    exists because the configuration validator requires a well-formed
 *    secret; it protects nothing and unlocks nothing.
 *
 * 3. **The database URL must be supplied explicitly, and is expected to be a
 *    disposable database.** The Kysely/PostgreSQL adapter introspects the
 *    live schema to compute what is missing, so generation genuinely needs a
 *    reachable server — it is not pure offline code generation, whatever the
 *    `--adapter` flag's help text suggests. The URL therefore arrives through
 *    a single, checkpoint-specific variable with **no default and no
 *    fallback**: if it is absent the generator refuses to run rather than
 *    quietly reaching for `DATABASE_URL` and finding a real database.
 *
 * The variable is deliberately *not* named `DATABASE_URL`, so that an
 * ambient value meant for the development or production database can never
 * be picked up by accident.
 */
const SCHEMA_GENERATION_DATABASE_URL = process.env['DROMEX_SCHEMA_GEN_DATABASE_URL'];

if (!SCHEMA_GENERATION_DATABASE_URL) {
  throw new Error(
    'DROMEX_SCHEMA_GEN_DATABASE_URL is required and has no default. ' +
      'Point it at a disposable PostgreSQL database created for schema generation. ' +
      'Never point it at the development or production database.',
  );
}

export const auth = createAuth({
  environment: 'development',
  secret: randomBytes(32).toString('hex'),
  baseURL: 'http://127.0.0.1:3000',
  trustedOrigins: ['http://127.0.0.1:5173'],
  database: new Pool({ connectionString: SCHEMA_GENERATION_DATABASE_URL }),
});
