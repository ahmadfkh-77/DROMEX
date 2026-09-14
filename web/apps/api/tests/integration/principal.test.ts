import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PrincipalAccessDeniedError,
  createPrincipalRepository,
  requireActivePrincipal,
  type PrincipalRepository,
} from '../../src/auth/principal.ts';
import { loadDromexMigrations } from '../../src/db/dromex-migrations.ts';
import { applyMigrations } from '../../src/db/migrator.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

const BETTER_AUTH_MIGRATION = fileURLToPath(
  new URL('../../migrations/better-auth/0001_better_auth_init.sql', import.meta.url),
);

describe('principal lookup', () => {
  let database: EphemeralDatabase;
  let pool: Pool;
  let repository: PrincipalRepository;

  beforeEach(async () => {
    database = await createEphemeralDatabase();
    pool = new Pool({ connectionString: database.uri });

    await pool.query(await readFile(BETTER_AUTH_MIGRATION, 'utf8'));
    await applyMigrations(pool, await loadDromexMigrations());

    // Synthetic identities only; they vanish with the disposable database.
    await seedPrincipal(pool, 'synthetic_active', 'active', false);
    await seedPrincipal(pool, 'synthetic_disabled', 'disabled', false);
    await seedPrincipal(pool, 'synthetic_owner', 'active', true);

    repository = createPrincipalRepository(pool);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool?.end().catch(() => undefined);
    await database?.drop().catch(() => undefined);
  });

  it('finds an active principal whose MFA activation is incomplete', async () => {
    await expect(repository.findByUserId('synthetic_active')).resolves.toEqual({
      userId: 'synthetic_active',
      status: 'active',
      isOwner: false,
      mfaCompletedAt: null,
    });
  });

  it('reads MFA completion as an authoritative timestamp from the database', async () => {
    await pool.query(
      `UPDATE dromex_principal SET mfa_completed_at = '2026-09-13T09:00:00.123Z' WHERE user_id = $1`,
      ['synthetic_owner'],
    );

    const principal = await repository.findByUserId('synthetic_owner');

    expect(principal?.mfaCompletedAt).toBeInstanceOf(Date);
    expect(principal?.mfaCompletedAt?.toISOString()).toBe('2026-09-13T09:00:00.123Z');
  });

  it('returns null for a user with no principal', async () => {
    await expect(repository.findByUserId('synthetic_absent')).resolves.toBeNull();
  });

  it('reports the Owner marker', async () => {
    const principal = await repository.findByUserId('synthetic_owner');

    expect(principal?.isOwner).toBe(true);
    expect(principal?.userId).toBe('synthetic_owner');
  });

  it('reports a disabled principal as disabled rather than hiding it', async () => {
    expect((await repository.findByUserId('synthetic_disabled'))?.status).toBe('disabled');
  });

  it('uses parameterised SQL, never interpolation', async () => {
    const spy = vi.spyOn(pool, 'query');

    await repository.findByUserId("bobby'; DROP TABLE dromex_principal; --");

    const [text, values] = spy.mock.calls[0] as unknown as [string, unknown[]];
    expect(text).toContain('$1');
    expect(text).not.toContain('bobby');
    expect(values).toEqual(["bobby'; DROP TABLE dromex_principal; --"]);

    const { rows } = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM dromex_principal`);
    expect(Number(rows[0]?.count)).toBe(3);
  });

  describe('requireActivePrincipal (fail closed)', () => {
    it('returns the principal when active', async () => {
      expect((await requireActivePrincipal(repository, 'synthetic_active')).userId).toBe('synthetic_active');
    });

    it('denies disabled and missing principals identically', async () => {
      const missing = await requireActivePrincipal(repository, 'synthetic_absent').catch((error: Error) => error);
      const disabled = await requireActivePrincipal(repository, 'synthetic_disabled').catch((error: Error) => error);

      expect(missing).toBeInstanceOf(PrincipalAccessDeniedError);
      expect(disabled).toBeInstanceOf(PrincipalAccessDeniedError);
      expect((missing as Error).message).toBe((disabled as Error).message);
    });

    it('leaks no identity, credential, database, or SQL detail', async () => {
      const error = (await requireActivePrincipal(repository, 'synthetic_disabled').catch(
        (caught: Error) => caught,
      )) as Error;

      const text = `${error.name}\n${error.message}\n${error.stack ?? ''}`;
      for (const leak of ['synthetic_disabled', 'synthetic.invalid', 'dromex_principal', 'SELECT', 'postgres', 'password', 'disabled']) {
        expect(text).not.toContain(leak);
      }
    });
  });
});

async function seedPrincipal(pool: Pool, id: string, status: string, isOwner: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "updatedAt")
     VALUES ($1, $2, $3, FALSE, CURRENT_TIMESTAMP)`,
    [id, `synthetic ${id}`, `${id}@synthetic.invalid`],
  );
  await pool.query(`INSERT INTO dromex_principal (user_id, status, is_owner) VALUES ($1, $2, $3)`, [
    id,
    status,
    isOwner,
  ]);
}
