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
  { id: '0004', name: 'dromex_mfa', file: '0004_dromex_mfa.sql' },
  { id: '0005', name: 'dromex_security_audit', file: '0005_dromex_security_audit.sql' },
  { id: '0006', name: 'dromex_owner_recovery', file: '0006_dromex_owner_recovery.sql' },
  { id: '0007', name: 'dromex_terminal_recovery', file: '0007_dromex_terminal_recovery.sql' },
  { id: '0008', name: 'dromex_admin_invitation', file: '0008_dromex_admin_invitation.sql' },
  { id: '0009', name: 'dromex_admin_enrolment', file: '0009_dromex_admin_enrolment.sql' },
  { id: '0010', name: 'dromex_password_reset', file: '0010_dromex_password_reset.sql' },
  { id: '0011', name: 'dromex_account_management', file: '0011_dromex_account_management.sql' },
  { id: '0012', name: 'dromex_rate_limit_prune_index', file: '0012_dromex_rate_limit_prune_index.sql' },
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
