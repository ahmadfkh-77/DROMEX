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
import { applyMigrations } from '../../src/db/migrator.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

const BETTER_AUTH_MIGRATION = fileURLToPath(
  new URL('../../migrations/better-auth/0001_better_auth_init.sql', import.meta.url),
);
const DROMEX_MIGRATION = fileURLToPath(
  new URL('../../migrations/dromex/0001_dromex_principal.sql', import.meta.url),
);

describe('principal lookup', () => {
  let database: EphemeralDatabase;
  let pool: Pool;
  let repository: PrincipalRepository;

  beforeEach(async () => {
    database = await createEphemeralDatabase();
    pool = new Pool({ connectionString: database.uri });

    await pool.query(await readFile(BETTER_AUTH_MIGRATION, 'utf8'));
    await applyMigrations(pool, [
      { id: '0001', name: 'dromex_principal', sql: await readFile(DROMEX_MIGRATION, 'utf8') },
    ]);

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

  it('finds an active principal', async () => {
    const principal = await repository.findByUserId('synthetic_active');

    expect(principal).toEqual({
      userId: 'synthetic_active',
      status: 'active',
      isOwner: false,
    });
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
    const principal = await repository.findByUserId('synthetic_disabled');

    expect(principal?.status).toBe('disabled');
  });

  it('uses parameterised SQL, never interpolation', async () => {
    const spy = vi.spyOn(pool, 'query');

    await repository.findByUserId("bobby'; DROP TABLE dromex_principal; --");

    // pool.query is overloaded (it also accepts a callback), so the recorded
    // arguments are read through `unknown` rather than asserted into a shape
    // the overload set does not actually guarantee.
    const call = spy.mock.calls[0] as unknown as [string, unknown[]];
    const [text, values] = call;
    expect(text).toContain('$1');
    expect(text).not.toContain('bobby');
    expect(values).toEqual(["bobby'; DROP TABLE dromex_principal; --"]);

    // The table is still there, which is the point.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dromex_principal`,
    );
    expect(Number(rows[0]?.count)).toBe(3);
  });

  describe('requireActivePrincipal (fail closed)', () => {
    it('returns the principal when active', async () => {
      const principal = await requireActivePrincipal(repository, 'synthetic_active');

      expect(principal.userId).toBe('synthetic_active');
    });

    it('denies a disabled principal', async () => {
      await expect(
        requireActivePrincipal(repository, 'synthetic_disabled'),
      ).rejects.toBeInstanceOf(PrincipalAccessDeniedError);
    });

    it('denies a missing principal', async () => {
      await expect(
        requireActivePrincipal(repository, 'synthetic_absent'),
      ).rejects.toBeInstanceOf(PrincipalAccessDeniedError);
    });

    it('denies missing and disabled identically, so neither can be probed', async () => {
      // If the two cases produced different errors, an attacker could learn
      // whether an account exists by reading the difference.
      const missing = await requireActivePrincipal(repository, 'synthetic_absent').catch(
        (error: Error) => error,
      );
      const disabled = await requireActivePrincipal(
        repository,
        'synthetic_disabled',
      ).catch((error: Error) => error);

      expect((missing as Error).message).toBe((disabled as Error).message);
      expect((missing as Error).name).toBe((disabled as Error).name);
    });

    it('leaks no identity, credential, database, or SQL detail', async () => {
      const error = (await requireActivePrincipal(
        repository,
        'synthetic_disabled',
      ).catch((caught: Error) => caught)) as Error;

      const text = `${error.name}\n${error.message}\n${error.stack ?? ''}`;
      for (const leak of [
        'synthetic_disabled',
        'synthetic.invalid',
        'dromex_principal',
        'SELECT',
        'postgres',
        'password',
        'disabled',
      ]) {
        expect(text).not.toContain(leak);
      }
    });
  });
});

async function seedPrincipal(
  pool: Pool,
  id: string,
  status: string,
  isOwner: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "updatedAt")
     VALUES ($1, $2, $3, FALSE, CURRENT_TIMESTAMP)`,
    [id, `synthetic ${id}`, `${id}@synthetic.invalid`],
  );
  await pool.query(
    `INSERT INTO dromex_principal (user_id, status, is_owner) VALUES ($1, $2, $3)`,
    [id, status, isOwner],
  );
}
