import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ADVISORY_LOCK_KEY,
  applyMigrations,
  type DromexMigration,
} from '../../src/db/migrator.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

const BETTER_AUTH_MIGRATION = fileURLToPath(
  new URL('../../migrations/better-auth/0001_better_auth_init.sql', import.meta.url),
);
const DROMEX_MIGRATION = fileURLToPath(
  new URL('../../migrations/dromex/0001_dromex_principal.sql', import.meta.url),
);

const BETTER_AUTH_TABLES = ['user', 'session', 'account', 'verification', 'rateLimit'];

async function loadDromexMigrations(): Promise<DromexMigration[]> {
  return [
    {
      id: '0001',
      name: 'dromex_principal',
      sql: await readFile(DROMEX_MIGRATION, 'utf8'),
    },
  ];
}

describe('DROMEX migration mechanism', () => {
  let database: EphemeralDatabase;
  let pool: Pool;

  beforeEach(async () => {
    database = await createEphemeralDatabase();
    pool = new Pool({ connectionString: database.uri });

    // Better Auth owns its own schema and applies it by its own means. The
    // DROMEX migrator never touches that file; it is applied here only so the
    // foreign key target exists.
    await pool.query(await readFile(BETTER_AUTH_MIGRATION, 'utf8'));
  });

  afterEach(async () => {
    await pool?.end().catch(() => undefined);
    await database?.drop().catch(() => undefined);
  });

  it('creates its own ledger table', async () => {
    await applyMigrations(pool, await loadDromexMigrations());

    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dromex_migration'`,
    );
    const columns = rows.map((row) => row.column_name);

    expect(columns).toContain('id');
    expect(columns).toContain('name');
    expect(columns).toContain('checksum');
    expect(columns).toContain('applied_at');
  });

  it('creates the principal table', async () => {
    await applyMigrations(pool, await loadDromexMigrations());

    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dromex_principal'
        ORDER BY column_name`,
    );
    const byName = new Map(rows.map((row) => [row.column_name, row.data_type]));

    expect(byName.get('user_id')).toBe('text');
    expect(byName.get('status')).toBe('text');
    expect(byName.get('is_owner')).toBe('boolean');
    expect(byName.get('created_at')).toBe('timestamp with time zone');
    expect(byName.get('updated_at')).toBe('timestamp with time zone');
  });

  it('references the Better Auth user table', async () => {
    await applyMigrations(pool, await loadDromexMigrations());

    const { rows } = await pool.query<{ foreign_table: string; delete_rule: string }>(
      `SELECT ccu.table_name AS foreign_table, rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'dromex_principal'
          AND tc.constraint_type = 'FOREIGN KEY'`,
    );

    expect(rows[0]?.foreign_table).toBe('user');
    // RESTRICT, never CASCADE: historical attribution must survive, so a
    // Better Auth user backing a principal cannot be deleted out from under
    // the records that reference it.
    expect(rows[0]?.delete_rule).toBe('RESTRICT');
  });

  it('prevents deleting a Better Auth user that has a principal', async () => {
    await applyMigrations(pool, await loadDromexMigrations());
    await seedUser(pool, 'user_restrict');
    await pool.query(
      `INSERT INTO dromex_principal (user_id, status) VALUES ($1, 'active')`,
      ['user_restrict'],
    );

    // PostgreSQL names RESTRICT explicitly in this message, which is a
    // stronger assertion than the generic foreign-key wording: it proves the
    // delete rule in force is RESTRICT and not CASCADE.
    await expect(
      pool.query(`DELETE FROM "user" WHERE id = $1`, ['user_restrict']),
    ).rejects.toThrow(/violates RESTRICT setting of foreign key constraint/i);
  });

  it('rejects a status outside the approved values', async () => {
    await applyMigrations(pool, await loadDromexMigrations());
    await seedUser(pool, 'user_badstatus');

    await expect(
      pool.query(`INSERT INTO dromex_principal (user_id, status) VALUES ($1, $2)`, [
        'user_badstatus',
        'suspended',
      ]),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it('accepts the approved active and disabled statuses', async () => {
    await applyMigrations(pool, await loadDromexMigrations());
    await seedUser(pool, 'user_active');
    await seedUser(pool, 'user_disabled');

    await pool.query(
      `INSERT INTO dromex_principal (user_id, status) VALUES ($1, 'active'), ($2, 'disabled')`,
      ['user_active', 'user_disabled'],
    );

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dromex_principal`,
    );
    expect(Number(rows[0]?.count)).toBe(2);
  });

  it('allows zero Owners before bootstrap', async () => {
    // The partial unique index guarantees AT MOST one Owner. It cannot and
    // must not require one: before bootstrap there is legitimately none.
    await applyMigrations(pool, await loadDromexMigrations());
    await seedUser(pool, 'user_none');
    await pool.query(
      `INSERT INTO dromex_principal (user_id, status) VALUES ($1, 'active')`,
      ['user_none'],
    );

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dromex_principal WHERE is_owner`,
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('allows exactly one Owner', async () => {
    await applyMigrations(pool, await loadDromexMigrations());
    await seedUser(pool, 'user_owner');

    await pool.query(
      `INSERT INTO dromex_principal (user_id, status, is_owner) VALUES ($1, 'active', TRUE)`,
      ['user_owner'],
    );

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dromex_principal WHERE is_owner`,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('rejects a second Owner at the database level', async () => {
    await applyMigrations(pool, await loadDromexMigrations());
    await seedUser(pool, 'owner_one');
    await seedUser(pool, 'owner_two');
    await pool.query(
      `INSERT INTO dromex_principal (user_id, status, is_owner) VALUES ($1, 'active', TRUE)`,
      ['owner_one'],
    );

    await expect(
      pool.query(
        `INSERT INTO dromex_principal (user_id, status, is_owner) VALUES ($1, 'active', TRUE)`,
        ['owner_two'],
      ),
    ).rejects.toThrow(/unique/i);
  });

  it('allows many non-Owner principals', async () => {
    await applyMigrations(pool, await loadDromexMigrations());
    for (const id of ['p1', 'p2', 'p3']) {
      await seedUser(pool, id);
      await pool.query(
        `INSERT INTO dromex_principal (user_id, status) VALUES ($1, 'active')`,
        [id],
      );
    }

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dromex_principal WHERE NOT is_owner`,
    );
    expect(Number(rows[0]?.count)).toBe(3);
  });

  it('does not replay an unchanged migration', async () => {
    const migrations = await loadDromexMigrations();

    const first = await applyMigrations(pool, migrations);
    const second = await applyMigrations(pool, migrations);

    expect(first.applied).toEqual(['0001']);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001']);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dromex_migration`,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('refuses an applied migration whose checksum changed', async () => {
    const migrations = await loadDromexMigrations();
    await applyMigrations(pool, migrations);

    const tampered: DromexMigration[] = [
      { ...migrations[0]!, sql: `${migrations[0]!.sql}\n-- edited after the fact\n` },
    ];

    await expect(applyMigrations(pool, tampered)).rejects.toThrow(/checksum/i);
  });

  it('fails closed when a recorded migration is no longer present', async () => {
    await applyMigrations(pool, await loadDromexMigrations());

    await expect(applyMigrations(pool, [])).rejects.toThrow(/missing/i);
  });

  it('fails closed on duplicate migration identifiers', async () => {
    const migrations = await loadDromexMigrations();
    const duplicated = [migrations[0]!, { ...migrations[0]! }];

    await expect(applyMigrations(pool, duplicated)).rejects.toThrow(/duplicate/i);
  });

  it('lets only one of two concurrent runs apply the migration', async () => {
    const migrations = await loadDromexMigrations();

    const [a, b] = await Promise.all([
      applyMigrations(pool, migrations),
      applyMigrations(pool, migrations),
    ]);

    // Exactly one applies; the other finds the work already done.
    //
    // Honest caveat: this assertion alone does NOT prove the advisory lock
    // works. It still passes with the lock removed, because two calls in one
    // Node process interleave at await points rather than truly racing. The
    // test below is the one that actually proves mutual exclusion.
    const appliedCount = a.applied.length + b.applied.length;
    expect(appliedCount).toBe(1);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dromex_migration WHERE id = '0001'`,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('waits while another connection holds the migration advisory lock', async () => {
    // The real proof of mutual exclusion, and the case that matters: two API
    // instances starting at once are separate connections, not interleaved
    // promises. A second holder must be made to wait.
    const migrations = await loadDromexMigrations();

    const blocker = await pool.connect();
    await blocker.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    let settled = false;
    const run = applyMigrations(pool, migrations).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled).toBe(false); // still waiting on the lock

    await blocker.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    blocker.release();

    const result = await run;
    expect(settled).toBe(true);
    expect(result.applied).toEqual(['0001']);
  });

  it('rolls a failed migration back completely', async () => {
    const broken: DromexMigration[] = [
      {
        id: '0001',
        name: 'broken',
        sql: `CREATE TABLE dromex_should_not_survive (id text primary key);
              CREATE TABLE dromex_should_not_survive (id text primary key);`,
      },
    ];

    await expect(applyMigrations(pool, broken)).rejects.toThrow();

    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'dromex_should_not_survive'`,
    );
    expect(rows).toEqual([]);

    const ledger = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dromex_migration`,
    );
    expect(Number(ledger.rows[0]?.count)).toBe(0);
  });

  it('leaves Better Auth tables untouched and adds no business table', async () => {
    await applyMigrations(pool, await loadDromexMigrations());

    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const tables = rows.map((row) => row.table_name);

    for (const expected of BETTER_AUTH_TABLES) {
      expect(tables).toContain(expected);
    }

    // Only the two DROMEX-owned objects are added.
    const dromexTables = tables.filter((name) => name.startsWith('dromex_')).sort();
    expect(dromexTables).toEqual(['dromex_migration', 'dromex_principal']);

    for (const table of tables.map((name) => name.toLowerCase())) {
      for (const forbidden of ['project', 'load', 'fuel', 'payment', 'waste', 'wall']) {
        expect(table).not.toContain(forbidden);
      }
    }
  });
});

/** Inserts a synthetic Better Auth user so a principal can reference it. */
async function seedUser(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "updatedAt")
     VALUES ($1, $2, $3, FALSE, CURRENT_TIMESTAMP)`,
    [id, `synthetic ${id}`, `${id}@synthetic.invalid`],
  );
}
