import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TOTP_REPLAY_RETENTION_SECONDS,
  createTotpReplayGuard,
  type TotpReplayGuard,
} from '../../src/auth/totp-replay.ts';
import { migrateAuthSchema, provisionSyntheticUser, type SyntheticUser } from '../helpers/auth-fixtures.ts';
import { settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

let database: EphemeralDatabase;
let pool: Pool;
let guard: TotpReplayGuard;
let alice: SyntheticUser;
let bob: SyntheticUser;

async function markers(userId?: string) {
  const { rows } = await pool.query<{ user_id: string; code_digest: Buffer; accepted_at: Date }>(
    `SELECT user_id, code_digest, accepted_at FROM dromex_totp_replay
      ${userId ? 'WHERE user_id = $1' : ''} ORDER BY accepted_at`,
    userId ? [userId] : [],
  );
  return rows;
}

async function age(userId: string, seconds: number): Promise<void> {
  await pool.query(
    `UPDATE dromex_totp_replay SET accepted_at = now() - make_interval(secs => $2) WHERE user_id = $1`,
    [userId, seconds],
  );
}

describe('DROMEX TOTP replay protection on PostgreSQL 18.6', () => {
  beforeEach(async () => {
    database = await createEphemeralDatabase();
    pool = new Pool({ connectionString: database.uri, max: 20 });
    await migrateAuthSchema(pool);
    const settings = syntheticAuthSettings();
    alice = await provisionSyntheticUser(pool, settings, 'alice');
    bob = await provisionSyntheticUser(pool, settings, 'bob');
    guard = createTotpReplayGuard(pool);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await settle();
    await pool?.end().catch(() => undefined);
    await database?.drop().catch(() => undefined);
  });

  it('keeps each marker for longer than the whole Better Auth acceptance window', () => {
    // Better Auth accepts a code for its own step and one step either side:
    // up to 90 seconds from the first moment it is valid.
    expect(TOTP_REPLAY_RETENTION_SECONDS).toBeGreaterThan(90);
  });

  it('accepts a code once and refuses the same code for the same user again', async () => {
    await expect(guard.record(alice.id, '123456')).resolves.toBe('accepted');
    await expect(guard.record(alice.id, '123456')).resolves.toBe('replayed');
  });

  it('keeps users apart: the same code is independent for different users', async () => {
    await expect(guard.record(alice.id, '123456')).resolves.toBe('accepted');
    await expect(guard.record(bob.id, '123456')).resolves.toBe('accepted');
  });

  it('lets exactly one of many concurrent submissions of one code succeed', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () => guard.record(alice.id, '654321')),
    );

    expect(outcomes.filter((outcome) => outcome === 'accepted')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'replayed')).toHaveLength(11);
    expect(await markers(alice.id)).toHaveLength(1);
  });

  it('stores a 32-byte digest and never the code itself', async () => {
    await guard.record(alice.id, '123456');

    const [row] = await markers(alice.id);
    expect(row!.code_digest).toHaveLength(32);
    expect(row!.code_digest.toString('hex')).not.toContain('123456');
    expect(row!.code_digest.toString('latin1')).not.toContain('123456');

    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'dromex_totp_replay' ORDER BY column_name`,
    );
    expect(rows.map((column) => column.column_name)).toEqual(['accepted_at', 'code_digest', 'user_id']);
  });

  it('still refuses a replay while the code could still be accepted', async () => {
    await guard.record(alice.id, '123456');

    await age(alice.id, 89);
    await expect(guard.record(alice.id, '123456')).resolves.toBe('replayed');

    await age(alice.id, TOTP_REPLAY_RETENTION_SECONDS - 1);
    await expect(guard.record(alice.id, '123456')).resolves.toBe('replayed');
  });

  it('treats a marker older than the retention as a new, legitimate recurrence of that code', async () => {
    await guard.record(alice.id, '123456');
    await age(alice.id, TOTP_REPLAY_RETENTION_SECONDS + 1);

    await expect(guard.record(alice.id, '123456')).resolves.toBe('accepted');
    const [row] = await markers(alice.id);
    expect(Date.now() - row!.accepted_at.getTime()).toBeLessThan(10_000);
  });

  it('prunes only markers past the retention', async () => {
    await guard.record(alice.id, '111111');
    await age(alice.id, TOTP_REPLAY_RETENTION_SECONDS + 5);
    await guard.record(bob.id, '222222');

    await guard.record(bob.id, '333333');

    expect(await markers(alice.id)).toEqual([]);
    expect(await markers(bob.id)).toHaveLength(2);
  });

  it.each([
    ['a short code', 'alice', '12345'],
    ['a long code', 'alice', '1234567'],
    ['a non-digit code', 'alice', '12345a'],
    ['an empty user', '', '123456'],
  ])('fails closed on %s without touching the database', async (_label, who, code) => {
    const connect = vi.spyOn(pool, 'connect');
    const query = vi.spyOn(pool, 'query');
    const userId = who === 'alice' ? alice.id : who;

    await expect(guard.record(userId, code)).rejects.toThrow(/TOTP replay/i);
    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when the database refuses the marker', async () => {
    await pool.query(`
      CREATE FUNCTION synthetic_refuse_replay() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic replay failure'; END $$;
      CREATE TRIGGER synthetic_refuse_replay BEFORE INSERT ON dromex_totp_replay
      FOR EACH ROW EXECUTE FUNCTION synthetic_refuse_replay();
    `);

    await expect(guard.record(alice.id, '123456')).rejects.toThrow();
  });

  it('refuses a malformed digest at the database', async () => {
    await expect(
      pool.query(`INSERT INTO dromex_totp_replay (user_id, code_digest) VALUES ($1, $2)`, [
        alice.id,
        Buffer.alloc(31),
      ]),
    ).rejects.toThrow(/check constraint/i);
  });

  it('prevents deleting a user that still has a replay marker', async () => {
    await guard.record(alice.id, '123456');

    await expect(pool.query(`DELETE FROM "user" WHERE id = $1`, [alice.id])).rejects.toThrow(
      /violates RESTRICT setting of foreign key constraint/i,
    );
  });
});
