import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { DromexMigration } from './migrator.ts';

/**
 * The complete, ordered DROMEX migration set. Better Auth's generated SQL is
 * deliberately absent: it is a separate sequence applied by its own means
 * (DEC-431).
 */
const MIGRATIONS: ReadonlyArray<{ id: string; name: string; file: string }> = [
  { id: '0001', name: 'dromex_principal', file: '0001_dromex_principal.sql' },
  { id: '0002', name: 'dromex_rate_limit', file: '0002_dromex_rate_limit.sql' },
  { id: '0003', name: 'dromex_owner_bootstrap', file: '0003_dromex_owner_bootstrap.sql' },
];

export async function loadDromexMigrations(): Promise<DromexMigration[]> {
  return Promise.all(
    MIGRATIONS.map(async ({ id, name, file }) => ({
      id,
      name,
      sql: await readFile(
        fileURLToPath(new URL(`../../migrations/dromex/${file}`, import.meta.url)),
        'utf8',
      ),
    })),
  );
}
