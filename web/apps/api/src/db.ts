import { Pool } from 'pg';

/**
 * A small pool with a short connection timeout: /ready must answer quickly
 * even when PostgreSQL is unreachable, rather than hanging the caller.
 */
export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
}

/** Throws when the database cannot be reached or does not answer. */
export async function checkDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
