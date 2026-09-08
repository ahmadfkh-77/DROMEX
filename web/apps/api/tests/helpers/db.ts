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
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
