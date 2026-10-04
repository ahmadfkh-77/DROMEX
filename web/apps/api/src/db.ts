import { Pool } from 'pg';

/** Receives only a short error code, never the error, its message, or the connection string. */
export type PoolErrorReporter = (errorCode: string) => void;

const SAFE_ERROR_CODE = /^[A-Za-z0-9_]{1,32}$/;

function writeFixedLine(errorCode: string): void {
  process.stderr.write(`database pool reported an error (code ${errorCode}); the failed connection was discarded\n`);
}

/**
 * A small pool with a short connection timeout: /ready must answer quickly
 * even when PostgreSQL is unreachable, rather than hanging the caller.
 */
export function createPool(connectionString: string, report: PoolErrorReporter = writeFixedLine): Pool {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  // An idle pooled client is still connected to a live backend, so a database
  // restart, a failover, or an administrator killing it makes it emit an error.
  // pg-pool discards that client and re-emits the error on the pool, and a pool
  // 'error' event with no listener is an uncaught exception that ends the
  // process. The error itself is dropped on purpose (driver errors can carry
  // the connection string or row data): only a short code is reported. Queries
  // are unaffected, since the next checkout opens a fresh connection, and a
  // database that stays down still fails the readiness check.
  pool.on('error', (error: unknown) => {
    const code = (error as { code?: unknown } | null)?.code;
    report(typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : 'unknown');
  });
  return pool;
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
