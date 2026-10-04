import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { loadRuntimeConfig } from '../../src/config/runtime.ts';
import { settle } from '../helpers/auth-settings.ts';
import {
  enrollSyntheticMfa,
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  type EnrolledUser,
} from '../helpers/auth-fixtures.ts';
import { assertDisposableCiDatabase } from './guard.ts';

/**
 * TEST-ONLY seed for the real end-to-end sign-in tests (batch 4b-2, D5).
 *
 * Runs once per CI job, against the disposable database that job created, and
 * nowhere else: the guard refuses everything but that. It migrates the schema
 * and creates synthetic accounts through the same fixtures the integration
 * tests use. It adds no route, starts no server, and does not touch the Owner
 * activation tooling. It lives under `tests/` and nothing under `src/` may
 * import it (a unit test enforces that).
 *
 * Passwords and TOTP seeds are generated at run time. Each is masked in the
 * job log before it is written to the job environment file, and none is ever
 * printed or written anywhere else.
 */

interface Account {
  prefix: string;
  label: string;
  status: 'active' | 'disabled';
  isOwner: boolean;
}

const ACCOUNTS: readonly Account[] = [
  { prefix: 'OWNER', label: 'owner', status: 'active', isOwner: true },
  { prefix: 'ADMIN_A', label: 'admin-a', status: 'active', isOwner: false },
  { prefix: 'ADMIN_B', label: 'admin-b', status: 'disabled', isOwner: false },
  { prefix: 'ADMIN_C', label: 'admin-c', status: 'active', isOwner: false },
  { prefix: 'ADMIN_D', label: 'admin-d', status: 'active', isOwner: false },
];

function mask(value: string): void {
  process.stdout.write(`::add-mask::${value}\n`);
}

async function main(): Promise<void> {
  assertDisposableCiDatabase(process.env);
  const config = loadRuntimeConfig(process.env);
  const envFile = process.env['GITHUB_ENV']!;

  const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
  try {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    if (rows[0]!.n !== 0) throw new Error('The end-to-end seed refuses to run: the database is not empty.');

    await migrateAuthSchema(pool);

    const lines: string[] = [];
    for (const account of ACCOUNTS) {
      const user = await provisionSyntheticUser(pool, config.auth, account.label);
      await setPrincipal(pool, user.id, account.status, account.isOwner);
      lines.push(`DROMEX_E2E_${account.prefix}_ID=${user.id}`, `DROMEX_E2E_${account.prefix}_EMAIL=${user.email}`);
      mask(user.password);
      // Also the bare random part, so an encoded copy of the password is hidden too.
      mask(user.password.split(" ").pop()!);
      lines.push(`DROMEX_E2E_${account.prefix}_PASSWORD=${user.password}`);
      if (account.status === 'active') {
        const enrolled: EnrolledUser = await enrollSyntheticMfa(pool, config.auth, user);
        mask(enrolled.totpSecret);
        lines.push(`DROMEX_E2E_${account.prefix}_TOTP_SECRET=${enrolled.totpSecret}`);
      }
    }

    // Every value above is already masked; only now is anything written.
    appendFileSync(envFile, `${lines.join('\n')}\n`);
    await settle();
    process.stdout.write(`Seeded ${ACCOUNTS.length} synthetic accounts in the disposable database.\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    // The message of a refusal is fixed text; anything else is reduced to its class.
    const message = error instanceof Error && error.message.startsWith('The end-to-end seed refuses') ? error.message : `The end-to-end seed failed (${error instanceof Error ? error.name : 'unknown error'}).`;
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
