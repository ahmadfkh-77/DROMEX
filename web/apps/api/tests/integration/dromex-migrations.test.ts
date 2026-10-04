import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDromexMigrations } from '../../src/db/dromex-migrations.ts';
import {
  ADVISORY_LOCK_KEY,
  applyMigrations,
  type DromexMigration,
} from '../../src/db/migrator.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

const BETTER_AUTH_MIGRATION = fileURLToPath(
  new URL('../../migrations/better-auth/0001_better_auth_init.sql', import.meta.url),
);

const BETTER_AUTH_TABLES = ['user', 'session', 'account', 'verification', 'rateLimit'];
const ALL_DROMEX_MIGRATIONS = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012'];

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

  describe('pending principal lifecycle and invited Admin enrolment (0009, DEC-444)', () => {
    async function seedInvitation(email: string, inviter: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO dromex_admin_invitation
           (email, token_hash, status, invited_by_user_id, expires_at, delivery_id, delivery_status)
         VALUES ($1, decode(md5(random()::text) || md5(random()::text), 'hex'), 'pending', $2,
                 CURRENT_TIMESTAMP + interval '24 hours', gen_random_uuid(), 'sending')
         RETURNING id::text`,
        [email, inviter],
      );
      return rows[0]!.id;
    }

    async function seedEnrolment(values: Record<string, unknown>) {
      const columns = Object.keys(values);
      return pool.query<{ id: string }>(
        `INSERT INTO dromex_admin_enrolment (${columns.join(', ')})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING id::text`,
        Object.values(values),
      );
    }

    beforeEach(async () => {
      await applyMigrations(pool, await loadDromexMigrations());
      await seedUser(pool, 'inviter');
    });

    it('accepts a pending, non-Owner principal with no MFA completion', async () => {
      await seedUser(pool, 'pending_one');
      await pool.query(`INSERT INTO dromex_principal (user_id, status) VALUES ('pending_one', 'pending')`);
      const { rows } = await pool.query(`SELECT status, is_owner, mfa_completed_at FROM dromex_principal WHERE user_id = 'pending_one'`);
      expect(rows).toEqual([{ status: 'pending', is_owner: false, mfa_completed_at: null }]);
    });

    it('refuses a pending Owner and a pending principal that claims MFA completion', async () => {
      await seedUser(pool, 'pending_owner');
      await expect(
        pool.query(`INSERT INTO dromex_principal (user_id, status, is_owner) VALUES ('pending_owner', 'pending', TRUE)`),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        pool.query(`INSERT INTO dromex_principal (user_id, status, mfa_completed_at) VALUES ('pending_owner', 'pending', CURRENT_TIMESTAMP)`),
      ).rejects.toThrow(/check constraint/i);
    });

    it('allows pending to become active only with MFA completion, and nothing to become pending again', async () => {
      await seedUser(pool, 'lifecycle');
      await pool.query(`INSERT INTO dromex_principal (user_id, status) VALUES ('lifecycle', 'pending')`);
      const update = (sql: string) => pool.query(`UPDATE dromex_principal SET ${sql} WHERE user_id = 'lifecycle'`);

      await expect(update(`status = 'active'`)).rejects.toThrow(/principal lifecycle/i);
      await expect(update(`status = 'disabled'`)).rejects.toThrow(/principal lifecycle/i);
      await expect(update(`is_owner = TRUE`)).rejects.toThrow(/check constraint/i);

      await update(`status = 'active', mfa_completed_at = CURRENT_TIMESTAMP`);
      await expect(update(`status = 'pending', mfa_completed_at = NULL`)).rejects.toThrow(/principal lifecycle/i);
      await update(`status = 'disabled'`);
      await expect(update(`status = 'pending', mfa_completed_at = NULL`)).rejects.toThrow(/principal lifecycle/i);
      await update(`status = 'active'`);
      // An existing active Owner's recovery still clears MFA completion (DEC-436).
      await update(`mfa_completed_at = NULL`);
    });

    it('holds no column for a password, code, secret, token, or cookie', async () => {
      const columns = async (table: string) =>
        (
          await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
            [table],
          )
        ).rows.map((row) => row.column_name);

      expect(await columns('dromex_admin_enrolment')).toEqual([
        'completed_at',
        'created_at',
        'email',
        'id',
        'invitation_id',
        'step',
        'updated_at',
        'user_id',
      ]);
      expect(await columns('dromex_admin_enrolment_session')).toEqual(['bound_at', 'enrolment_id', 'invitation_id', 'session_id']);
    });

    it('constrains the step, ties it to the identity and to completion, and stores one normalised email once', async () => {
      const invitation = await seedInvitation('enrol@synthetic.invalid', 'inviter');
      await seedUser(pool, 'enrolled');
      const email = 'enrol@synthetic.invalid';

      await expect(seedEnrolment({ email, invitation_id: invitation, step: 'activated' })).rejects.toThrow(/check constraint/i);
      await expect(seedEnrolment({ email, invitation_id: invitation, step: 'identity_pending', user_id: 'enrolled' })).rejects.toThrow(
        /check constraint/i,
      );
      await expect(seedEnrolment({ email, invitation_id: invitation, step: 'password_verified' })).rejects.toThrow(/check constraint/i);
      await expect(seedEnrolment({ email, invitation_id: invitation, step: 'completed', user_id: 'enrolled' })).rejects.toThrow(
        /check constraint/i,
      );
      await expect(seedEnrolment({ email: 'Enrol@Synthetic.invalid', invitation_id: invitation, step: 'identity_pending' })).rejects.toThrow(
        /check constraint/i,
      );

      await seedEnrolment({ email, invitation_id: invitation, step: 'identity_pending' });
      await expect(seedEnrolment({ email, invitation_id: invitation, step: 'identity_pending' })).rejects.toThrow(/duplicate key|unique/i);
    });

    it('enforces the state machine, keeps identity columns immutable, ends only once, and never deletes', async () => {
      const invitation = await seedInvitation('machine@synthetic.invalid', 'inviter');
      await seedUser(pool, 'machine');
      await seedUser(pool, 'other_machine');
      const { rows } = await seedEnrolment({ email: 'machine@synthetic.invalid', invitation_id: invitation, step: 'identity_pending' });
      const id = rows[0]!.id;
      const set = (sql: string) => pool.query(`UPDATE dromex_admin_enrolment SET ${sql} WHERE id = $1`, [id]);

      await expect(set(`step = 'codes_issued', user_id = 'machine'`)).rejects.toThrow(/enrolment transition/i);
      await set(`step = 'password_verified', user_id = 'machine'`);
      await expect(set(`user_id = 'other_machine'`)).rejects.toThrow(/immutable/i);
      await expect(set(`email = 'changed@synthetic.invalid'`)).rejects.toThrow(/immutable/i);
      await expect(set(`step = 'completed', completed_at = CURRENT_TIMESTAMP`)).rejects.toThrow(/enrolment transition/i);
      await set(`step = 'totp_enrolling'`);
      await set(`step = 'codes_issued'`);
      await set(`step = 'completed', completed_at = CURRENT_TIMESTAMP`);
      await expect(set(`step = 'factor_challenge', completed_at = NULL`)).rejects.toThrow(/enrolment transition/i);
      await expect(pool.query(`DELETE FROM dromex_admin_enrolment WHERE id = $1`, [id])).rejects.toThrow(/never deleted/i);
      await expect(pool.query(`DELETE FROM "user" WHERE id = 'machine'`)).rejects.toThrow(/RESTRICT|foreign key/i);
    });

    it('binds sessions to one enrolment and invitation, refusing an empty session id, duplicates, and deletes', async () => {
      const invitation = await seedInvitation('bound@synthetic.invalid', 'inviter');
      const { rows } = await seedEnrolment({ email: 'bound@synthetic.invalid', invitation_id: invitation, step: 'identity_pending' });
      const enrolment = rows[0]!.id;
      const bind = (session: string) =>
        pool.query(`INSERT INTO dromex_admin_enrolment_session (session_id, enrolment_id, invitation_id) VALUES ($1, $2, $3)`, [
          session,
          enrolment,
          invitation,
        ]);

      await expect(bind('')).rejects.toThrow(/check constraint/i);
      await bind('s1');
      await expect(bind('s1')).rejects.toThrow(/duplicate key|unique/i);
      await expect(pool.query(`DELETE FROM dromex_admin_enrolment_session`)).rejects.toThrow(/never deleted/i);
    });

    it('accepts the invitation acceptance audit vocabulary and still refuses unknown events', async () => {
      for (const type of [
        'admin_invitation_acceptance_refused',
        'admin_invitation_identity_created',
        'admin_invitation_identity_resumed',
        'admin_invitation_password_rejected',
        'admin_invitation_totp_enrolment_started',
        'admin_invitation_totp_rejected',
        'admin_invitation_totp_verified',
        'admin_invitation_recovery_codes_issued',
        'admin_invitation_sessions_revoked',
        'admin_invitation_accepted',
        'admin_invitation_created',
        'recovery_code_accepted',
        'terminal_recovery_completed',
      ]) {
        await pool.query(`INSERT INTO dromex_audit_event (event_type, outcome) VALUES ($1, 'success')`, [type]);
      }
      await expect(
        pool.query(`INSERT INTO dromex_audit_event (event_type, outcome) VALUES ('admin_invitation_password_reset', 'success')`),
      ).rejects.toThrow(/check constraint/i);
    });
  });

  describe('password reset and the credential-change session rule (0010, DEC-441, DEC-487)', () => {
    async function seedReset(values: Record<string, unknown>) {
      const row = {
        token_hash: Buffer.alloc(32, Math.floor(Math.random() * 255)),
        status: 'issued',
        expires_at: null,
        delivery_id: crypto.randomUUID(),
        delivery_status: 'sending',
        ...values,
      };
      const columns = Object.keys(row).filter((column) => column !== 'expires_at');
      return pool.query<{ id: string }>(
        `INSERT INTO dromex_password_reset (${columns.join(', ')}, expires_at)
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')},
                 COALESCE($${columns.length + 1}::timestamptz, CURRENT_TIMESTAMP + interval '30 minutes'))
         RETURNING id::text`,
        [...columns.map((column) => row[column as keyof typeof row]), row.expires_at],
      );
    }

    beforeEach(async () => {
      await applyMigrations(pool, await loadDromexMigrations());
      await seedUser(pool, 'resetter');
      await pool.query(`INSERT INTO dromex_principal (user_id, status) VALUES ('resetter', 'active')`);
    });

    it('holds only a token hash: no column for a token, address, link, password, or message', async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'dromex_password_reset' ORDER BY column_name`,
      );
      expect(rows.map((row) => row.column_name)).toEqual([
        'claimed_at',
        'created_at',
        'delivery_attempts',
        'delivery_id',
        'delivery_reason',
        'delivery_status',
        'delivery_updated_at',
        'end_reason',
        'ended_at',
        'expires_at',
        'id',
        'status',
        'supersedes_id',
        'token_hash',
        'user_id',
      ]);
    });

    it('requires a unique 32-byte hash and exactly a 30-minute lifetime', async () => {
      await expect(seedReset({ user_id: 'resetter', token_hash: Buffer.alloc(31, 1) })).rejects.toThrow(/check constraint/i);
      await expect(
        seedReset({ user_id: 'resetter', expires_at: new Date(Date.now() + 31 * 60_000) }),
      ).rejects.toThrow(/check constraint/i);
      await seedReset({ user_id: 'resetter', token_hash: Buffer.alloc(32, 7) });
      await seedUser(pool, 'other_resetter');
      await expect(seedReset({ user_id: 'other_resetter', token_hash: Buffer.alloc(32, 7) })).rejects.toThrow(/duplicate key|unique/i);
    });

    it('allows at most one open (issued or claimed) reset per account', async () => {
      await seedReset({ user_id: 'resetter' });
      await expect(seedReset({ user_id: 'resetter' })).rejects.toThrow(/duplicate key|unique/i);
    });

    it('enforces the lifecycle, keeps identifying columns immutable, and never deletes', async () => {
      const { rows } = await seedReset({ user_id: 'resetter' });
      const id = rows[0]!.id;
      const set = (sql: string) => pool.query(`UPDATE dromex_password_reset SET ${sql} WHERE id = $1`, [id]);

      await expect(set(`status = 'completed', ended_at = CURRENT_TIMESTAMP, claimed_at = CURRENT_TIMESTAMP`)).rejects.toThrow(
        /password reset transition/i,
      );
      await expect(set(`token_hash = $2`.replace('$2', `'\\x${'ab'.repeat(32)}'`))).rejects.toThrow(/immutable/i);
      await expect(set(`expires_at = expires_at + interval '1 hour'`)).rejects.toThrow(/immutable|check constraint/i);
      await expect(set(`status = 'claimed'`)).rejects.toThrow(/check constraint/i);
      await set(`status = 'claimed', claimed_at = CURRENT_TIMESTAMP`);
      await expect(set(`status = 'issued', claimed_at = NULL`)).rejects.toThrow(/password reset transition/i);
      await set(`status = 'completed', ended_at = CURRENT_TIMESTAMP`);
      await expect(set(`status = 'failed', end_reason = 'unexpected_failure'`)).rejects.toThrow(/password reset transition/i);
      await expect(pool.query(`DELETE FROM dromex_password_reset WHERE id = $1`, [id])).rejects.toThrow(/never deleted/i);
      await expect(pool.query(`DELETE FROM "user" WHERE id = 'resetter'`)).rejects.toThrow(/RESTRICT|foreign key/i);
    });

    it('requires a reason exactly when a reset failed, and ties the end time to the open states', async () => {
      const { rows } = await seedReset({ user_id: 'resetter' });
      const id = rows[0]!.id;
      const set = (sql: string) => pool.query(`UPDATE dromex_password_reset SET ${sql} WHERE id = $1`, [id]);
      await expect(set(`status = 'failed', ended_at = CURRENT_TIMESTAMP`)).rejects.toThrow(/check constraint/i);
      await expect(set(`status = 'expired'`)).rejects.toThrow(/check constraint/i);
      await set(`status = 'failed', ended_at = CURRENT_TIMESTAMP, end_reason = 'not_eligible'`);
    });

    it('lets delivery status leave sending once and never return', async () => {
      const { rows } = await seedReset({ user_id: 'resetter' });
      const id = rows[0]!.id;
      const set = (sql: string) => pool.query(`UPDATE dromex_password_reset SET ${sql} WHERE id = $1`, [id]);
      await expect(set(`delivery_status = 'failed'`)).rejects.toThrow(/check constraint/i);
      await set(`delivery_status = 'provider_accepted', delivery_attempts = 1`);
      await expect(set(`delivery_status = 'failed', delivery_reason = 'timeout'`)).rejects.toThrow(/delivery/i);
    });

    it('adds a nullable credentials_changed_at to principals that only ever moves forward', async () => {
      const read = async () =>
        (await pool.query(`SELECT credentials_changed_at FROM dromex_principal WHERE user_id = 'resetter'`)).rows[0]!
          .credentials_changed_at as Date | null;
      const set = (sql: string) => pool.query(`UPDATE dromex_principal SET ${sql} WHERE user_id = 'resetter'`);

      expect(await read()).toBeNull();
      await set(`credentials_changed_at = '2026-09-26T10:00:00Z'`);
      await set(`credentials_changed_at = '2026-09-26T10:00:00Z'`);
      await set(`credentials_changed_at = '2026-09-26T11:00:00Z'`);
      await expect(set(`credentials_changed_at = '2026-09-26T10:30:00Z'`)).rejects.toThrow(/credentials_changed_at/i);
      await expect(set(`credentials_changed_at = NULL`)).rejects.toThrow(/credentials_changed_at/i);
      // A pending principal may carry it: a pending invitee may reset (DEC-487 (4)).
      await seedUser(pool, 'pending_resetter');
      await pool.query(
        `INSERT INTO dromex_principal (user_id, status, credentials_changed_at) VALUES ('pending_resetter', 'pending', CURRENT_TIMESTAMP)`,
      );
    });

    it('accepts the password-reset audit vocabulary and reference, and still refuses unknown events', async () => {
      for (const type of [
        'password_reset_requested',
        'password_reset_request_suppressed',
        'password_reset_superseded',
        'password_reset_expired',
        'password_reset_delivery_accepted',
        'password_reset_delivery_failed',
        'password_reset_rejected',
        'password_reset_claimed',
        'password_reset_failed',
        'password_reset_sessions_revoked',
        'password_reset_session_revocation_incomplete',
        'password_reset_completed',
        'password_changed_notification_accepted',
        'password_changed_notification_failed',
        'admin_invitation_accepted',
        'recovery_code_accepted',
      ]) {
        await pool.query(`INSERT INTO dromex_audit_event (event_type, outcome, password_reset_id) VALUES ($1, 'success', 5)`, [type]);
      }
      await expect(
        pool.query(`INSERT INTO dromex_audit_event (event_type, outcome) VALUES ('password_reset_token', 'success')`),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        pool.query(`INSERT INTO dromex_audit_event (event_type, outcome, password_reset_id) VALUES ('password_reset_requested', 'success', 0)`),
      ).rejects.toThrow(/check constraint/i);
    });
  });

  describe('Owner account and session management (0011, checkpoint 4E)', () => {
    beforeEach(async () => {
      await applyMigrations(pool, await loadDromexMigrations());
      await seedUser(pool, 'acct_owner');
      await seedUser(pool, 'acct_admin');
      await pool.query(
        `INSERT INTO dromex_principal (user_id, status, is_owner, mfa_completed_at) VALUES
           ('acct_owner', 'active', TRUE, CURRENT_TIMESTAMP), ('acct_admin', 'active', FALSE, CURRENT_TIMESTAMP)`,
      );
    });

    const change = (values: { user?: string; by?: string; action?: string; reason?: string }) =>
      pool.query<{ id: string }>(
        `INSERT INTO dromex_account_status_change (user_id, action, reason, changed_by_user_id)
         VALUES ($1, $2, $3, $4) RETURNING id::text`,
        [values.user ?? 'acct_admin', values.action ?? 'disabled', values.reason ?? 'Left the company', values.by ?? 'acct_owner'],
      );

    it('adds a nullable sessions_revoked_at to principals that only ever moves forward', async () => {
      const read = async () =>
        (await pool.query(`SELECT sessions_revoked_at FROM dromex_principal WHERE user_id = 'acct_admin'`)).rows[0]!
          .sessions_revoked_at as Date | null;
      const set = (sql: string) => pool.query(`UPDATE dromex_principal SET ${sql} WHERE user_id = 'acct_admin'`);

      expect(await read()).toBeNull();
      await set(`sessions_revoked_at = '2026-09-29T10:00:00Z'`);
      await set(`sessions_revoked_at = '2026-09-29T10:00:00Z'`);
      await set(`sessions_revoked_at = '2026-09-29T11:00:00Z'`);
      expect((await read())!.toISOString()).toBe('2026-09-29T11:00:00.000Z');
      await expect(set(`sessions_revoked_at = '2026-09-29T10:30:00Z'`)).rejects.toThrow(/sessions_revoked_at/i);
      await expect(set(`sessions_revoked_at = NULL`)).rejects.toThrow(/sessions_revoked_at/i);
    });

    it('holds a status change with exactly an account, an action, a reason, an actor, and a time', async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'dromex_account_status_change' ORDER BY column_name`,
      );
      expect(rows.map((row) => row.column_name)).toEqual(['action', 'changed_at', 'changed_by_user_id', 'id', 'reason', 'user_id']);
      await change({});
      await change({ action: 'enabled', reason: 'غادر ثم عاد — returned to Site 4' });
    });

    it.each([
      ['an unknown action', { action: 'deleted' }],
      ['a reason that is too short', { reason: 'ab' }],
      ['a reason that is too long', { reason: 'a'.repeat(501) }],
      ['a reason with surrounding whitespace', { reason: ' Left the company ' }],
      ['a reason with a line break', { reason: 'Left\nthe company' }],
      ['a reason with a tab', { reason: 'Left\tthe company' }],
      ['a reason with a right-to-left override', { reason: 'Left \u202Eynapmoc' }],
      ['a reason with a directional isolate', { reason: 'Left \u2066the company\u2069' }],
      ['an account changing its own status', { user: 'acct_owner', by: 'acct_owner' }],
    ])('refuses %s', async (_label, values) => {
      await expect(change(values)).rejects.toThrow(/check constraint/i);
    });

    it('measures the reason in characters, accepting 500 astral characters', async () => {
      await change({ reason: '🏗'.repeat(500) });
      await expect(change({ reason: '🏗'.repeat(501) })).rejects.toThrow(/check constraint/i);
    });

    it('keeps status changes as history: never updated, never deleted, and never orphaned', async () => {
      const { rows } = await change({});
      const id = rows[0]!.id;
      await expect(
        pool.query(`UPDATE dromex_account_status_change SET reason = 'Rewritten reason' WHERE id = $1`, [id]),
      ).rejects.toThrow(/never changed or deleted/i);
      await expect(pool.query(`DELETE FROM dromex_account_status_change WHERE id = $1`, [id])).rejects.toThrow(
        /never changed or deleted/i,
      );
      await expect(pool.query(`TRUNCATE dromex_account_status_change`)).rejects.toThrow(/never changed or deleted/i);
      await expect(pool.query(`DELETE FROM "user" WHERE id = 'acct_admin'`)).rejects.toThrow(/RESTRICT|foreign key/i);
    });

    it('accepts the account-management audit vocabulary, target, and change reference, and still refuses unknown events', async () => {
      const { rows } = await change({});
      for (const type of [
        'admin_account_disabled',
        'admin_account_enabled',
        'admin_account_sessions_revoked',
        'admin_account_session_revoked',
        'admin_account_session_cleanup_incomplete',
        'admin_account_action_refused',
        'owner_route_refused',
        'password_changed_notification_failed',
        'recovery_code_accepted',
      ]) {
        await pool.query(
          `INSERT INTO dromex_audit_event (event_type, outcome, target_user_id, account_change_id) VALUES ($1, 'success', 'acct_admin', $2)`,
          [type, rows[0]!.id],
        );
      }
      await expect(
        pool.query(`INSERT INTO dromex_audit_event (event_type, outcome) VALUES ('admin_account_deleted', 'success')`),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        pool.query(`INSERT INTO dromex_audit_event (event_type, outcome, account_change_id) VALUES ('admin_account_disabled', 'success', 0)`),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        pool.query(`INSERT INTO dromex_audit_event (event_type, outcome, target_user_id) VALUES ('admin_account_disabled', 'success', 'nobody')`),
      ).rejects.toThrow(/foreign key/i);
    });
  });

  it('preserves existing principals exactly when 0011 is applied over 0010', async () => {
    const migrations = await loadDromexMigrations();
    await applyMigrations(pool, migrations.filter((migration) => migration.id <= '0010'));
    await seedUser(pool, 'kept_owner');
    await seedUser(pool, 'kept_disabled');
    await pool.query(
      `INSERT INTO dromex_principal (user_id, status, is_owner, mfa_completed_at, credentials_changed_at, created_at, updated_at) VALUES
         ('kept_owner', 'active', TRUE, '2026-09-01T10:00:00Z', NULL, '2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z'),
         ('kept_disabled', 'disabled', FALSE, '2026-09-03T10:00:00Z', '2026-09-04T10:00:00Z', '2026-09-03T09:00:00Z', '2026-09-04T11:00:00Z')`,
    );
    const snapshot = async () =>
      (
        await pool.query(
          `SELECT user_id, status, is_owner, mfa_completed_at, credentials_changed_at, created_at, updated_at
             FROM dromex_principal ORDER BY user_id`,
        )
      ).rows;
    const before = await snapshot();

    const result = await applyMigrations(pool, migrations.filter((migration) => migration.id <= '0011'));
    expect(result.applied).toEqual(['0011']);
    expect(await snapshot()).toEqual(before);
    const stamped = await pool.query(`SELECT count(*)::int AS n FROM dromex_principal WHERE sessions_revoked_at IS NOT NULL`);
    expect(stamped.rows[0]!.n).toBe(0);
  });

  it('applies 0011 idempotently: running its SQL again changes nothing', async () => {
    const migrations = await loadDromexMigrations();
    await applyMigrations(pool, migrations);
    const sql = migrations.find((migration) => migration.id === '0011')!.sql;
    const shape = async () =>
      (
        await pool.query(
          `SELECT conrelid::regclass::text AS relation, conname::text AS name, pg_get_constraintdef(oid) AS definition
             FROM pg_constraint WHERE connamespace = 'public'::regnamespace
           UNION ALL
           SELECT tgrelid::regclass::text, tgname::text, pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
           UNION ALL
           SELECT tablename::text, indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public'
           ORDER BY 1, 2, 3`,
        )
      ).rows;
    const before = await shape();
    await pool.query(sql);
    await pool.query(sql);
    expect(await shape()).toEqual(before);
  });

  // SEC-1b proposal (DEC-492, pending Owner review).
  it('preserves existing rate-limit rows exactly when 0012 is applied over 0011, and only adds an index', async () => {
    const migrations = await loadDromexMigrations();
    await applyMigrations(pool, migrations.filter((migration) => migration.id <= '0011'));
    await pool.query(
      `INSERT INTO dromex_rate_limit (key, count, last_request_ms) VALUES
         ('192.0.2.1|/sign-in/email', 5, 1789289796705), ('198.51.100.7|/api/invitation/password', 1, 0)`,
    );
    const rows = async () => (await pool.query('SELECT key, count, last_request_ms FROM dromex_rate_limit ORDER BY key')).rows;
    const columns = async () =>
      (await pool.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'dromex_rate_limit' ORDER BY column_name`)).rows;
    const before = { rows: await rows(), columns: await columns() };

    const result = await applyMigrations(pool, migrations);
    expect(result.applied).toEqual(['0012']);

    expect({ rows: await rows(), columns: await columns() }).toEqual(before);
    const index = await pool.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'dromex_rate_limit' AND indexname = 'dromex_rate_limit_last_request'`);
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]!.indexdef).toMatch(/USING btree (last_request_ms)/);
  });

  it('applies 0012 idempotently: running its SQL again changes nothing', async () => {
    const migrations = await loadDromexMigrations();
    await applyMigrations(pool, migrations);
    const sql = migrations.find((migration) => migration.id === '0012')!.sql;
    const indexes = async () =>
      (await pool.query(`SELECT tablename::text, indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`)).rows;
    const before = await indexes();
    await pool.query(sql);
    await pool.query(sql);
    expect(await indexes()).toEqual(before);
  });

  it('preserves existing principals exactly when 0010 is applied over 0009', async () => {
    const migrations = await loadDromexMigrations();
    await applyMigrations(pool, migrations.filter((migration) => migration.id <= '0009'));
    await seedUser(pool, 'kept_owner');
    await seedUser(pool, 'kept_pending');
    await pool.query(
      `INSERT INTO dromex_principal (user_id, status, is_owner, mfa_completed_at, created_at, updated_at) VALUES
         ('kept_owner', 'active', TRUE, '2026-09-01T10:00:00Z', '2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z'),
         ('kept_pending', 'pending', FALSE, NULL, '2026-09-02T09:00:00Z', '2026-09-02T09:00:00Z')`,
    );
    const snapshot = async () =>
      (await pool.query(`SELECT user_id, status, is_owner, mfa_completed_at, created_at, updated_at FROM dromex_principal ORDER BY user_id`))
        .rows;
    const before = await snapshot();

    const result = await applyMigrations(pool, migrations.filter((migration) => migration.id <= '0010'));
    expect(result.applied).toEqual(['0010']);
    expect(await snapshot()).toEqual(before);
    const added = await pool.query(`SELECT count(*)::int AS n FROM dromex_principal WHERE credentials_changed_at IS NOT NULL`);
    expect(added.rows[0]!.n).toBe(0);
  });

  it('applies 0010 idempotently: running its SQL again changes nothing', async () => {
    const migrations = await loadDromexMigrations();
    // Up to 0010 only: 0011 legitimately replaces the audit vocabulary that
    // 0010 would restore.
    await applyMigrations(pool, migrations.filter((migration) => migration.id <= '0010'));
    const sql = migrations.find((migration) => migration.id === '0010')!.sql;
    const shape = async () =>
      (
        await pool.query(
          `SELECT conrelid::regclass::text AS relation, conname::text AS name, pg_get_constraintdef(oid) AS definition
             FROM pg_constraint WHERE connamespace = 'public'::regnamespace
           UNION ALL
           SELECT tgrelid::regclass::text, tgname::text, pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
           UNION ALL
           SELECT tablename::text, indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public'
           ORDER BY 1, 2, 3`,
        )
      ).rows;
    const before = await shape();
    await pool.query(sql);
    await pool.query(sql);
    expect(await shape()).toEqual(before);
  });

  it('preserves existing principals exactly when 0009 is applied over 0008 (DEC-444 (4))', async () => {
    const migrations = await loadDromexMigrations();
    await applyMigrations(pool, migrations.filter((migration) => migration.id <= '0008'));
    await seedUser(pool, 'kept_owner');
    await seedUser(pool, 'kept_admin');
    await seedUser(pool, 'kept_disabled');
    await pool.query(
      `INSERT INTO dromex_principal (user_id, status, is_owner, mfa_completed_at, created_at, updated_at) VALUES
         ('kept_owner', 'active', TRUE, '2026-09-01T10:00:00Z', '2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z'),
         ('kept_admin', 'active', FALSE, NULL, '2026-09-02T09:00:00Z', '2026-09-02T09:00:00Z'),
         ('kept_disabled', 'disabled', FALSE, '2026-09-03T10:00:00Z', '2026-09-03T09:00:00Z', '2026-09-03T11:00:00Z')`,
    );
    const snapshot = async () => (await pool.query(`SELECT * FROM dromex_principal ORDER BY user_id`)).rows;
    const before = await snapshot();

    const result = await applyMigrations(pool, migrations.filter((migration) => migration.id <= '0009'));
    expect(result.applied).toEqual(['0009']);
    expect(await snapshot()).toEqual(before);
  });

  it('applies 0009 idempotently: running its SQL again changes nothing', async () => {
    const migrations = await loadDromexMigrations();
    // Up to 0009 only: a later migration legitimately replaces the audit
    // vocabulary that 0009 would restore.
    await applyMigrations(pool, migrations.filter((migration) => migration.id <= '0009'));
    const sql = migrations.find((migration) => migration.id === '0009')!.sql;
    const shape = async () =>
      (
        await pool.query(
          `SELECT conrelid::regclass::text AS relation, conname::text AS name, pg_get_constraintdef(oid) AS definition
             FROM pg_constraint WHERE connamespace = 'public'::regnamespace
           UNION ALL
           SELECT tgrelid::regclass::text, tgname::text, pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
           UNION ALL
           SELECT tablename::text, indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public'
           ORDER BY 1, 2, 3`,
        )
      ).rows;
    const before = await shape();
    await pool.query(sql);
    await pool.query(sql);
    expect(await shape()).toEqual(before);
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

  describe('Owner bootstrap intent (0003)', () => {
    async function insertIntent(values: Record<string, unknown>) {
      const columns = Object.keys(values);
      return pool.query(
        `INSERT INTO dromex_owner_bootstrap (${columns.join(', ')})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values(values),
      );
    }

    beforeEach(async () => {
      await applyMigrations(pool, await loadDromexMigrations());
    });

    it('holds no column for a password, hash, token, or cookie', async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'dromex_owner_bootstrap'
          ORDER BY column_name`,
      );

      expect(rows.map((row) => row.column_name)).toEqual([
        'created_at',
        'email',
        'singleton',
        'state',
        'updated_at',
        'user_id',
      ]);
    });

    it('permits at most one intent', async () => {
      await insertIntent({ state: 'pending_identity', email: 'one@synthetic.invalid' });

      await expect(
        insertIntent({ state: 'pending_identity', email: 'two@synthetic.invalid' }),
      ).rejects.toThrow(/duplicate key|unique/i);
      await expect(
        insertIntent({ singleton: false, state: 'pending_identity', email: 'two@synthetic.invalid' }),
      ).rejects.toThrow(/check constraint/i);
    });

    it('rejects a state outside the approved values', async () => {
      await expect(
        insertIntent({ state: 'completed', email: 'one@synthetic.invalid' }),
      ).rejects.toThrow(/check constraint/i);
    });

    it('ties the state to the presence of the identity', async () => {
      await seedUser(pool, 'intent_user');

      await expect(
        insertIntent({ state: 'pending_identity', email: 'one@synthetic.invalid', user_id: 'intent_user' }),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        insertIntent({ state: 'identity_created', email: 'one@synthetic.invalid' }),
      ).rejects.toThrow(/check constraint/i);

      await insertIntent({
        state: 'identity_created',
        email: 'one@synthetic.invalid',
        user_id: 'intent_user',
      });
    });

    it('stores only a normalised email', async () => {
      await expect(
        insertIntent({ state: 'pending_identity', email: 'Owner@Synthetic.invalid' }),
      ).rejects.toThrow(/check constraint/i);
      await expect(insertIntent({ state: 'pending_identity', email: '' })).rejects.toThrow(
        /check constraint/i,
      );
    });

    it('prevents deleting the Better Auth identity an intent refers to', async () => {
      await seedUser(pool, 'intent_restrict');
      await insertIntent({
        state: 'identity_created',
        email: 'intent_restrict@synthetic.invalid',
        user_id: 'intent_restrict',
      });

      await expect(
        pool.query(`DELETE FROM "user" WHERE id = $1`, ['intent_restrict']),
      ).rejects.toThrow(/violates RESTRICT setting of foreign key constraint/i);
    });
  });

  describe('MFA completion and TOTP replay state (0004)', () => {
    beforeEach(async () => {
      await applyMigrations(pool, await loadDromexMigrations());
    });

    it('adds a nullable, default-less mfa_completed_at to dromex_principal, with no backfill', async () => {
      await seedUser(pool, 'mfa_principal');
      await pool.query(`INSERT INTO dromex_principal (user_id, status) VALUES ($1, 'active')`, ['mfa_principal']);

      const { rows } = await pool.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'dromex_principal' AND column_name = 'mfa_completed_at'`,
      );
      expect(rows).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null }]);

      const principal = await pool.query<{ mfa_completed_at: Date | null }>(
        `SELECT mfa_completed_at FROM dromex_principal WHERE user_id = $1`,
        ['mfa_principal'],
      );
      expect(principal.rows[0]?.mfa_completed_at).toBeNull();
    });

    it('creates dromex_totp_replay with exactly a user, a digest, and an acceptance time', async () => {
      const { rows } = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'dromex_totp_replay' ORDER BY column_name`,
      );

      expect(rows).toEqual([
        { column_name: 'accepted_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
        { column_name: 'code_digest', data_type: 'bytea', is_nullable: 'NO' },
        { column_name: 'user_id', data_type: 'text', is_nullable: 'NO' },
      ]);
    });

    it('makes a user and digest pair unique, and requires a 32-byte digest', async () => {
      await seedUser(pool, 'replay_user');
      const digest = Buffer.alloc(32, 7);
      await pool.query(`INSERT INTO dromex_totp_replay (user_id, code_digest) VALUES ($1, $2)`, ['replay_user', digest]);

      await expect(
        pool.query(`INSERT INTO dromex_totp_replay (user_id, code_digest) VALUES ($1, $2)`, ['replay_user', digest]),
      ).rejects.toThrow(/duplicate key|unique/i);
      await expect(
        pool.query(`INSERT INTO dromex_totp_replay (user_id, code_digest) VALUES ($1, $2)`, ['replay_user', Buffer.alloc(33)]),
      ).rejects.toThrow(/check constraint/i);
    });

    it('restricts deleting a Better Auth user that has a replay marker', async () => {
      await seedUser(pool, 'replay_restrict');
      await pool.query(`INSERT INTO dromex_totp_replay (user_id, code_digest) VALUES ($1, $2)`, [
        'replay_restrict',
        Buffer.alloc(32, 1),
      ]);

      await expect(pool.query(`DELETE FROM "user" WHERE id = $1`, ['replay_restrict'])).rejects.toThrow(
        /violates RESTRICT setting of foreign key constraint/i,
      );
    });

    it('indexes the acceptance time for pruning', async () => {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'dromex_totp_replay'`,
      );

      expect(rows.some((row) => /\(accepted_at\)/.test(row.indexdef))).toBe(true);
    });
  });

  it('does not replay an unchanged migration', async () => {
    const migrations = await loadDromexMigrations();

    const first = await applyMigrations(pool, migrations);
    const second = await applyMigrations(pool, migrations);

    expect(first.applied).toEqual(ALL_DROMEX_MIGRATIONS);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(ALL_DROMEX_MIGRATIONS);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM dromex_migration`,
    );
    expect(Number(rows[0]?.count)).toBe(ALL_DROMEX_MIGRATIONS.length);
  });

  it('refuses an applied migration whose checksum changed', async () => {
    const migrations = await loadDromexMigrations();
    await applyMigrations(pool, migrations);

    const tampered: DromexMigration[] = [
      { ...migrations[0]!, sql: `${migrations[0]!.sql}\n-- edited after the fact\n` },
      ...migrations.slice(1),
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
    expect(appliedCount).toBe(ALL_DROMEX_MIGRATIONS.length);

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
    expect(result.applied).toEqual(ALL_DROMEX_MIGRATIONS);
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

    // Only the DROMEX-owned objects are added.
    const dromexTables = tables.filter((name) => name.startsWith('dromex_')).sort();
    expect(dromexTables).toEqual([
      'dromex_account_status_change',
      'dromex_admin_enrolment',
      'dromex_admin_enrolment_session',
      'dromex_admin_invitation',
      'dromex_audit_event',
      'dromex_migration',
      'dromex_owner_bootstrap',
      'dromex_owner_recovery',
      'dromex_password_reset',
      'dromex_principal',
      'dromex_rate_limit',
      'dromex_recovery_session',
      'dromex_terminal_recovery',
      'dromex_terminal_recovery_session',
      'dromex_totp_replay',
    ]);

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
