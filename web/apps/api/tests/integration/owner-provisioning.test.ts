import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyPassword } from '../../src/auth/hashing.ts';
import { createAuth } from '../../src/auth/instance.ts';
import { OwnerProvisioningError } from '../../src/provisioning/errors.ts';
import type { OwnerDraft } from '../../src/provisioning/owner-input.ts';
import {
  createOwnerProvisioningIdentity,
  type OwnerIdentityPort,
} from '../../src/provisioning/owner-identity.ts';
import {
  OWNER_PROVISIONING_LOCK_KEY,
  provisionOwner,
} from '../../src/provisioning/owner-provisioning.ts';
import { buildServer } from '../../src/server.ts';
import { migrateAuthSchema, provisionSyntheticUser, setPrincipal } from '../helpers/auth-fixtures.ts';
import {
  TEST_TRUSTED_ORIGIN,
  settle,
  syntheticAuthSettings,
} from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';
import type { AuthSettings } from '../../src/auth/config.ts';

// Every identity here is synthetic and vanishes with its disposable database.
const PASSPHRASE = 'synthetic owner passphrase one';
const OWNER_EMAIL = 'owner@synthetic.invalid';

const BETTER_AUTH_MUTATION =
  /\b(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop\s+table)\s+"?(user|account|session|verification|rateLimit)"?(\s|$|\()/i;

let database: EphemeralDatabase;
/** Better Auth's connections. Also used by assertions, which are not recorded. */
let authPool: Pool;
/** DROMEX provisioning's own connections. Every statement is recorded. */
let dromexPool: Pool;
let settings: AuthSettings;
let dromexSql: string[];
let authSql: string[];

function recordStatements(pool: Pool, into: string[]): void {
  pool.on('connect', (client) => {
    const original = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args) => {
      const [first] = args;
      into.push(typeof first === 'string' ? first : String((first as { text?: string })?.text ?? ''));
      return original(...args);
    };
  });
}

function draft(overrides: Partial<OwnerDraft> = {}): OwnerDraft {
  return {
    name: 'Synthetic Owner',
    email: OWNER_EMAIL,
    password: PASSPHRASE,
    passwordConfirmation: PASSPHRASE,
    ...overrides,
  };
}

function identity(): OwnerIdentityPort {
  return createOwnerProvisioningIdentity(settings, authPool);
}

function provision(overrides: Partial<OwnerDraft> = {}, port: OwnerIdentityPort = identity()) {
  return provisionOwner({ pool: dromexPool, identity: port }, draft(overrides));
}

async function refusal(promise: Promise<unknown>): Promise<OwnerProvisioningError> {
  const outcome = await promise.then(
    () => new Error('expected provisioning to be refused'),
    (error: unknown) => error,
  );
  if (outcome instanceof OwnerProvisioningError) return outcome;
  throw outcome;
}

async function count(sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await authPool.query<{ n: number }>(sql, values);
  return rows[0]!.n;
}

const users = () => count(`SELECT count(*)::int AS n FROM "user"`);
const sessions = () => count(`SELECT count(*)::int AS n FROM "session"`);
const principals = () => count(`SELECT count(*)::int AS n FROM dromex_principal`);
const owners = () => count(`SELECT count(*)::int AS n FROM dromex_principal WHERE is_owner`);

async function intent() {
  const { rows } = await authPool.query<{ state: string; email: string; user_id: string | null }>(
    `SELECT state, email, user_id FROM dromex_owner_bootstrap`,
  );
  return rows;
}

async function userIdFor(email: string): Promise<string> {
  const { rows } = await authPool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
    email,
  ]);
  return rows[0]!.id;
}

/** A real identity port whose creation is interrupted at a chosen moment. */
function interruptedCreation(moment: 'before' | 'after'): OwnerIdentityPort {
  const real = identity();
  return {
    create: async (input) => {
      if (moment === 'after') await real.create(input);
      throw new Error('synthetic interruption');
    },
    verify: (input) => real.verify(input),
  };
}

/** A real identity port that records whether it was ever asked to act. */
function watchedIdentity() {
  const real = identity();
  const port = {
    create: vi.fn((input: Parameters<OwnerIdentityPort['create']>[0]) => real.create(input)),
    verify: vi.fn((input: Parameters<OwnerIdentityPort['verify']>[0]) => real.verify(input)),
  };
  return port;
}

describe('Owner provisioning against PostgreSQL 18.6', () => {
  beforeEach(async () => {
    database = await createEphemeralDatabase();
    authPool = new Pool({ connectionString: database.uri, max: 10 });
    dromexPool = new Pool({ connectionString: database.uri, max: 10 });
    dromexSql = [];
    authSql = [];
    recordStatements(dromexPool, dromexSql);
    recordStatements(authPool, authSql);
    await migrateAuthSchema(authPool);
    settings = syntheticAuthSettings();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await settle();
    await dromexPool?.end().catch(() => undefined);
    await authPool?.end().catch(() => undefined);
    await database?.drop().catch(() => undefined);
  });

  it('runs only against a disposable test database', () => {
    const uri = new URL(database.uri);
    expect(uri.port).not.toBe('5433');
    expect(uri.pathname).toMatch(/^\/test_[0-9a-f]{32}$/);
  });

  describe('first bootstrap', () => {
    it('creates exactly one Better Auth identity, one active Owner principal, and no session', async () => {
      await expect(provision()).resolves.toEqual({ status: 'owner_created' });

      expect(await users()).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM "account"`)).toBe(1);
      expect(await sessions()).toBe(0);

      const { rows } = await authPool.query(
        `SELECT user_id, status, is_owner FROM dromex_principal`,
      );
      expect(rows).toEqual([{ user_id: await userIdFor(OWNER_EMAIL), status: 'active', is_owner: true }]);
      expect(await intent()).toEqual([]);
    });

    it('stores the Owner password as Argon2id through the DROMEX hash', async () => {
      await provision();

      const { rows } = await authPool.query<{ password: string }>(
        `SELECT password FROM "account" WHERE "userId" = $1`,
        [await userIdFor(OWNER_EMAIL)],
      );
      expect(rows[0]!.password.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
      expect(await verifyPassword(PASSPHRASE, rows[0]!.password)).toBe(true);
    });

    it('is not blocked by existing non-Owner principals', async () => {
      const admin = await provisionSyntheticUser(authPool, settings, 'admin');
      await setPrincipal(authPool, admin.id, 'active', false);

      await expect(provision()).resolves.toEqual({ status: 'owner_created' });
      expect(await owners()).toBe(1);
      expect(await principals()).toBe(2);
    });

    it('rejects invalid input before touching the database or Better Auth', async () => {
      const connect = vi.spyOn(dromexPool, 'connect');
      const port = watchedIdentity();

      const cases: Array<[Partial<OwnerDraft>, string]> = [
        [{ name: '' }, 'invalid_name'],
        [{ email: 'not-an-email' }, 'invalid_email'],
        [{ password: 'too short', passwordConfirmation: 'too short' }, 'invalid_password'],
        [{ passwordConfirmation: `${PASSPHRASE} typo` }, 'confirmation_mismatch'],
      ];
      for (const [overrides, code] of cases) {
        expect((await refusal(provision(overrides, port))).code).toBe(code);
      }

      expect(connect).not.toHaveBeenCalled();
      expect(port.create).not.toHaveBeenCalled();
      expect(port.verify).not.toHaveBeenCalled();
      expect(await users()).toBe(0);
      expect(await intent()).toEqual([]);
    });
  });

  describe('refusal once an Owner exists', () => {
    it('refuses a second bootstrap for a different identity', async () => {
      await provision();

      const error = await refusal(provision({ email: 'second@synthetic.invalid' }));

      expect(error.code).toBe('owner_exists');
      expect(await users()).toBe(1);
      expect(await owners()).toBe(1);
    });

    it('refuses a re-run with the same identity and never creates another', async () => {
      await provision();

      expect((await refusal(provision())).code).toBe('owner_exists');
      expect(await users()).toBe(1);
      expect(await sessions()).toBe(0);
    });

    it('refuses before any Better Auth action when an Owner already exists', async () => {
      const existing = await provisionSyntheticUser(authPool, settings, 'owner');
      await setPrincipal(authPool, existing.id, 'active', true);
      const port = watchedIdentity();

      expect((await refusal(provision({}, port))).code).toBe('owner_exists');
      expect(port.create).not.toHaveBeenCalled();
      expect(port.verify).not.toHaveBeenCalled();
      expect(await users()).toBe(1);
      expect(await intent()).toEqual([]);
    });
  });

  describe('mutual exclusion', () => {
    it('lets only one of two concurrent bootstraps create an Owner', async () => {
      const outcomes = await Promise.allSettled([
        provision({}, identity()),
        provision({ email: 'rival@synthetic.invalid' }, identity()),
      ]);

      const created = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const refused = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );
      expect(created).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]!.reason).toBeInstanceOf(OwnerProvisioningError);
      expect(['in_progress', 'owner_exists']).toContain(refused[0]!.reason.code);

      expect(await owners()).toBe(1);
      expect(await users()).toBe(1);
    });

    it('refuses immediately while another connection holds the provisioning lock, changing nothing', async () => {
      const blocker = await authPool.connect();
      try {
        await blocker.query('SELECT pg_advisory_lock($1)', [OWNER_PROVISIONING_LOCK_KEY]);
        const port = watchedIdentity();

        expect((await refusal(provision({}, port))).code).toBe('in_progress');
        expect(port.create).not.toHaveBeenCalled();
        expect(await users()).toBe(0);
        expect(await intent()).toEqual([]);
      } finally {
        await blocker.query('SELECT pg_advisory_unlock($1)', [OWNER_PROVISIONING_LOCK_KEY]);
        blocker.release();
      }

      await expect(provision()).resolves.toEqual({ status: 'owner_created' });
    });

    it('releases the lock after a refusal, so a later run can proceed', async () => {
      await refusal(provision({ passwordConfirmation: 'no match at all here' }));
      await provision();

      const { rows } = await authPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`,
      );
      expect(rows[0]!.n).toBe(0);
    });
  });

  describe('identities this workflow did not create', () => {
    it('refuses to adopt a pre-existing Better Auth identity with the same email', async () => {
      const stranger = await provisionSyntheticUser(authPool, settings, 'stranger');
      const port = watchedIdentity();

      const error = await refusal(
        provision({ email: stranger.email, password: stranger.password, passwordConfirmation: stranger.password }, port),
      );

      expect(error.code).toBe('identity_conflict');
      expect(port.create).not.toHaveBeenCalled();
      expect(port.verify).not.toHaveBeenCalled();
      expect(await principals()).toBe(0);
      expect(await intent()).toEqual([]);
    });
  });

  describe('interrupted provisioning', () => {
    it('leaves no partial identity when interrupted before Better Auth creation, and retries cleanly', async () => {
      expect((await refusal(provision({}, interruptedCreation('before')))).code).toBe('failed');

      expect(await users()).toBe(0);
      expect(await principals()).toBe(0);

      await expect(provision()).resolves.toEqual({ status: 'owner_created' });
      expect(await users()).toBe(1);
      expect(await intent()).toEqual([]);
    });

    it('leaves a recognisable resumable intent, not a completed Owner, when interrupted after Better Auth creation', async () => {
      expect((await refusal(provision({}, interruptedCreation('after')))).code).toBe('failed');

      expect(await users()).toBe(1);
      expect(await principals()).toBe(0);
      expect(await sessions()).toBe(0);
      expect(await intent()).toEqual([{ state: 'pending_identity', email: OWNER_EMAIL, user_id: null }]);
    });

    it('completes the orphan on retry with the same email and password, creating no second identity', async () => {
      await refusal(provision({}, interruptedCreation('after')));
      const orphanId = await userIdFor(OWNER_EMAIL);
      const port = watchedIdentity();

      await expect(provision({}, port)).resolves.toEqual({ status: 'owner_created' });

      expect(port.create).not.toHaveBeenCalled();
      expect(port.verify).toHaveBeenCalledTimes(1);
      expect(await users()).toBe(1);
      const { rows } = await authPool.query(`SELECT user_id, status, is_owner FROM dromex_principal`);
      expect(rows).toEqual([{ user_id: orphanId, status: 'active', is_owner: true }]);
      expect(await intent()).toEqual([]);
      expect(await sessions()).toBe(0);
    });

    it('revokes the temporary session Better Auth issues to verify the orphan', async () => {
      await refusal(provision({}, interruptedCreation('after')));
      authSql.length = 0;

      await provision();

      const sessionInserts = authSql.filter((sql) => /insert\s+into\s+"session"/i.test(sql));
      const sessionDeletes = authSql.filter((sql) => /delete\s+from\s+"session"/i.test(sql));
      expect(sessionInserts).toHaveLength(1);
      expect(sessionDeletes).toHaveLength(1);
      expect(await sessions()).toBe(0);
    });

    it('refuses to claim the orphan with a wrong password', async () => {
      await refusal(provision({}, interruptedCreation('after')));

      const wrong = 'a synthetic wrong passphrase';
      const error = await refusal(provision({ password: wrong, passwordConfirmation: wrong }));

      expect(error.code).toBe('verification_failed');
      expect(await principals()).toBe(0);
      expect(await sessions()).toBe(0);
      expect(await users()).toBe(1);
      expect(await intent()).toEqual([{ state: 'pending_identity', email: OWNER_EMAIL, user_id: null }]);
    });

    it('refuses to claim the orphan with a different email', async () => {
      await refusal(provision({}, interruptedCreation('after')));
      const port = watchedIdentity();

      const error = await refusal(provision({ email: 'other@synthetic.invalid' }, port));

      expect(error.code).toBe('different_pending_email');
      expect(port.create).not.toHaveBeenCalled();
      expect(port.verify).not.toHaveBeenCalled();
      expect(await users()).toBe(1);
      expect(await principals()).toBe(0);
    });

    it('rolls DROMEX changes back when the principal insert fails, and stays resumable', async () => {
      await authPool.query(`
        CREATE FUNCTION synthetic_refuse_principal() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic principal failure'; END $$;
        CREATE TRIGGER synthetic_refuse_principal BEFORE INSERT ON dromex_principal
        FOR EACH ROW EXECUTE FUNCTION synthetic_refuse_principal();
      `);

      expect((await refusal(provision())).code).toBe('failed');

      const orphanId = await userIdFor(OWNER_EMAIL);
      expect(await principals()).toBe(0);
      expect(await users()).toBe(1);
      expect(await sessions()).toBe(0);
      expect(await intent()).toEqual([
        { state: 'identity_created', email: OWNER_EMAIL, user_id: orphanId },
      ]);

      await authPool.query(`
        DROP TRIGGER synthetic_refuse_principal ON dromex_principal;
        DROP FUNCTION synthetic_refuse_principal();
      `);

      const wrong = 'a synthetic wrong passphrase';
      expect((await refusal(provision({ password: wrong, passwordConfirmation: wrong }))).code).toBe(
        'verification_failed',
      );

      await expect(provision()).resolves.toEqual({ status: 'owner_created' });
      expect(await users()).toBe(1);
      expect(await owners()).toBe(1);
      expect(await intent()).toEqual([]);
    });
  });

  describe('secrecy and ownership of Better Auth data', () => {
    it('never exposes the password in results, errors, or terminal output', async () => {
      const captured: string[] = [];
      const capture = (...args: unknown[]) => {
        captured.push(args.map((arg) => (arg instanceof Error ? `${arg.message}${arg.stack}` : String(arg))).join(' '));
      };
      for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, method).mockImplementation(capture);
      }
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => (capture(chunk), true));
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => (capture(chunk), true));

      const outcomes: unknown[] = [];
      outcomes.push(await provision({}, interruptedCreation('after')).catch((error: unknown) => error));
      const wrong = 'a synthetic wrong passphrase';
      outcomes.push(await provision({ password: wrong, passwordConfirmation: wrong }).catch((error: unknown) => error));
      outcomes.push(await provision({ passwordConfirmation: `${PASSPHRASE}x` }).catch((error: unknown) => error));
      outcomes.push(await provision());
      outcomes.push(await provision().catch((error: unknown) => error));

      vi.restoreAllMocks();

      const exposed = [
        ...captured,
        ...outcomes.map((outcome) =>
          outcome instanceof Error
            ? `${outcome.name}${outcome.message}${outcome.stack}${JSON.stringify(outcome)}`
            : JSON.stringify(outcome),
        ),
      ].join('\n');

      for (const secret of [PASSPHRASE, wrong, '$argon2id$', 'session_token']) {
        expect(exposed).not.toContain(secret);
      }
    });

    it('issues no mutating SQL against Better Auth-owned tables through its own connections', async () => {
      await refusal(provision({}, interruptedCreation('after')));
      await provision();

      expect(dromexSql.some((sql) => /pg_try_advisory_lock/.test(sql))).toBe(true);
      expect(dromexSql.some((sql) => /insert\s+into\s+dromex_principal/i.test(sql))).toBe(true);
      expect(dromexSql.filter((sql) => BETTER_AUTH_MUTATION.test(sql))).toEqual([]);
    });
  });

  describe('runtime authentication is unchanged', () => {
    it('keeps public sign-up disabled on the normal instance sharing the same database', async () => {
      // Constructing the provisioning identity must not change the runtime one.
      identity();
      const runtime = createAuth({ ...settings, database: authPool });

      await expect(
        runtime.api.signUpEmail({
          body: { name: 'Uninvited', email: 'uninvited@synthetic.invalid', password: PASSPHRASE },
        }),
      ).rejects.toThrow();
      expect(await users()).toBe(0);
    });

    it('lets the provisioned Owner sign in through the unchanged transport', async () => {
      await provision();
      const app = await buildServer({ databaseUrl: database.uri, auth: settings });
      try {
        await app.ready();
        const signIn = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
          payload: { email: OWNER_EMAIL, password: PASSPHRASE },
        });
        expect(signIn.statusCode).toBe(200);

        const cookieHeader = signIn.headers['set-cookie'];
        const cookie = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader ?? ''])
          .find((value) => value.includes('session_token='))!
          .split(';')[0]!;
        const session = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });

        expect(session.statusCode).toBe(200);
        expect(session.json()).toMatchObject({ isOwner: true, user: { email: OWNER_EMAIL } });
      } finally {
        await settle();
        await app.close();
      }
    });
  });
});
