import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkDatabase, createPool } from '../../src/db.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

/**
 * F9 against a real PostgreSQL 18.6: an administrator killing an idle pooled
 * connection (what a restart or failover does to every idle connection) must
 * not end the process, and the next use of the pool must work.
 */
describe('the production database pool when an idle connection is killed', () => {
  let database: EphemeralDatabase;

  beforeEach(async () => {
    database = await createEphemeralDatabase();
  });

  afterEach(async () => {
    await database?.drop().catch(() => undefined);
  });

  it('reports one short code, stays alive, and serves the next request on a fresh connection', async () => {
    const reports: string[] = [];
    const pool = createPool(database.uri, (code) => reports.push(code));
    try {
      const idle = await pool.connect();
      const { rows } = await idle.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      idle.release();
      expect(pool.idleCount).toBe(1);

      const killer = new Client({ connectionString: database.uri });
      await killer.connect();
      try {
        await killer.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]);
      } finally {
        await killer.end();
      }

      // The server's termination reaches the idle client asynchronously.
      const deadline = Date.now() + 5_000;
      while (reports.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(reports).toEqual(['57P01']);
      expect(pool.idleCount).toBe(0);
      await expect(checkDatabase(pool)).resolves.toBeUndefined();
    } finally {
      await pool.end().catch(() => undefined);
    }
  });
});
