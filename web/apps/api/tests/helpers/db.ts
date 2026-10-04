import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { inject } from 'vitest';

export interface EphemeralDatabase {
  /** Connection string for a database private to one test file. */
  uri: string;
  drop: () => Promise<void>;
}

/**
 * Creates a database private to the calling test file so parallel workers
 * cannot collide, and so no test depends on another's leftover state.
 *
 * When a schema exists, this is where migrations will be applied before the
 * database is handed back.
 */
export async function createEphemeralDatabase(): Promise<EphemeralDatabase> {
  const baseUri = inject('testDatabaseUri');
  const name = `test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({ connectionString: baseUri });
  await admin.connect();
  try {
    // Identifier is a generated UUID, never external input.
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const uri = new URL(baseUri);
  uri.pathname = `/${name}`;

  return {
    uri: uri.toString(),
    drop: async () => {
      const cleanup = new Client({ connectionString: baseUri });
      await cleanup.connect();
      try {
        // pg-pool resolves `pool.end()` as soon as it has removed its clients
        // from its list, before their sockets have closed. Forcing the drop
        // straight away kills those still-closing sessions, and the server's
        // 57P01 ("terminating connection due to administrator command") then
        // reaches a pool that has no error listener: an uncaught exception that
        // fails the whole run although every test passed. Wait (briefly) for
        // the sessions to go; FORCE stays as the fallback for a session a test
        // keeps on purpose.
        const deadline = Date.now() + 5_000;
        let remaining = 0;
        for (;;) {
          const { rows } = await cleanup.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [name],
          );
          remaining = rows[0]!.n;
          if (remaining === 0 || Date.now() >= deadline) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (remaining > 0) {
          // Not hidden: a fixed message and a count, never a connection string
          // or a database name. The forced drop below still runs.
          process.stderr.write(
            `test teardown: ${remaining} session(s) still connected after 5 s; forcing the database drop\n`,
          );
        }
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
