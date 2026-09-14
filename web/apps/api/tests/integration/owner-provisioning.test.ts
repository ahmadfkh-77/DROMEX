import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthSettings } from '../../src/auth/config.ts';
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
  type OwnerActivationTerminal,
} from '../../src/provisioning/owner-provisioning.ts';
import { buildServer } from '../../src/server.ts';
import {
  fixtureAuth,
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  twoFactorRowsMissingRuntimeDefaults,
} from '../helpers/auth-fixtures.ts';
import { TEST_TRUSTED_ORIGIN, settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';
import { TotpSequence, wrongCode } from '../helpers/totp.ts';

// Every identity here is synthetic and vanishes with its disposable database.
const PASSPHRASE = 'synthetic owner passphrase one';
const OWNER_EMAIL = 'owner@synthetic.invalid';
const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;

const BETTER_AUTH_MUTATION =
  /\b(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop\s+table)\s+"?(user|account|session|verification|rateLimit|twoFactor)"?(\s|$|\()/i;

let database: EphemeralDatabase;
let authPool: Pool;
let dromexPool: Pool;
let settings: AuthSettings;
let dromexSql: string[];
const servers: FastifyInstance[] = [];

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

type Step = 'enrollment' | 'totp' | 'devices' | 'codes' | 'codes-ack' | 'clear';

interface ScriptOptions {
  /** A base32 secret enrolled by an earlier, interrupted run. */
  knownSecret?: string;
  code?: (attempt: number, secret: string) => string;
  devices?: boolean;
  codesRecorded?: boolean;
  throwAt?: Step;
}

/** A scripted operator who reads the displayed secret into a fresh authenticator. */
function scriptedTerminal(options: ScriptOptions = {}) {
  const record = {
    events: [] as string[],
    enrollments: [] as Array<{ secret: string; uri: string }>,
    recoveryCodes: [] as string[][],
    totpPrompts: [] as Array<[number, number]>,
  };
  let sequence: TotpSequence | undefined = options.knownSecret ? new TotpSequence(options.knownSecret) : undefined;

  const step = (name: Step) => {
    record.events.push(name);
    if (options.throwAt === name) throw new Error(`synthetic interruption at ${name}`);
  };

  const terminal: OwnerActivationTerminal = {
    async presentEnrollment(material) {
      record.enrollments.push({ ...material });
      sequence = new TotpSequence(material.secret.replaceAll('-', ''));
      step('enrollment');
    },
    async readTotpCode(attempt, maxAttempts) {
      record.totpPrompts.push([attempt, maxAttempts]);
      step('totp');
      if (!sequence) throw new Error('no authenticator enrolled');
      return options.code ? options.code(attempt, sequence.secret) : sequence.next();
    },
    async confirmAuthenticatorsAndStorage() {
      step('devices');
      return options.devices ?? true;
    },
    async presentRecoveryCodes(codes) {
      record.recoveryCodes.push([...codes]);
      step('codes');
    },
    async confirmRecoveryCodesRecorded() {
      step('codes-ack');
      return options.codesRecorded ?? true;
    },
    async clearScreen() {
      step('clear');
    },
  };

  return { terminal, record, secret: () => sequence?.secret };
}

function provision(
  overrides: Partial<OwnerDraft> = {},
  port: OwnerIdentityPort = identity(),
  terminal: OwnerActivationTerminal = scriptedTerminal().terminal,
) {
  return provisionOwner({ pool: dromexPool, identity: port, terminal }, draft(overrides));
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
/**
 * Better Auth's two-factor plugin writes one `verification` row per trusted
 * device it is asked to trust (`trust-device-<random>`, from
 * `verify-two-factor.mjs`). DEC-434 (3) requires DROMEX never to request one
 * during Owner activation, in either the enrollment-verification path or the
 * resumed-challenge path a later run can take. This is the only durable trace
 * a wrongly-requested trust device leaves, since `owner-identity.ts` reads
 * only the session cookie out of Better Auth's response and drops the rest.
 */
const trustDeviceRecords = () =>
  count(`SELECT count(*)::int AS n FROM verification WHERE identifier LIKE 'trust-device-%'`);

async function intent() {
  const { rows } = await authPool.query(`SELECT state, email, user_id FROM dromex_owner_bootstrap`);
  return rows;
}

async function userIdFor(email: string): Promise<string> {
  const { rows } = await authPool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
  return rows[0]!.id;
}

async function factorState(userId: string) {
  const { rows } = await authPool.query<{ enabled: boolean | null; verified: boolean | null }>(
    `SELECT u."twoFactorEnabled" AS enabled, t.verified
       FROM "user" u LEFT JOIN "twoFactor" t ON t."userId" = u.id WHERE u.id = $1`,
    [userId],
  );
  return rows[0];
}

async function storedRecoveryCodes(userId: string): Promise<string[]> {
  const result = await fixtureAuth(authPool, settings).api.viewBackupCodes({ body: { userId } });
  return result.backupCodes;
}

/** Wraps the real port so a test can interrupt one operation at a chosen moment. */
function interrupted(
  operation: keyof OwnerIdentityPort,
  moment: 'before' | 'after',
  times = 1,
): OwnerIdentityPort {
  const real = identity();
  let remaining = times;
  const wrapped = { ...real } as Record<string, (...args: unknown[]) => Promise<unknown>>;
  wrapped[operation] = async (...args: unknown[]) => {
    if (remaining > 0 && moment === 'before') {
      remaining -= 1;
      throw new Error(`synthetic interruption before ${operation}`);
    }
    const result = await (real[operation] as (...a: unknown[]) => Promise<unknown>)(...args);
    if (remaining > 0 && moment === 'after') {
      remaining -= 1;
      throw new Error(`synthetic interruption after ${operation}`);
    }
    return result;
  };
  return wrapped as unknown as OwnerIdentityPort;
}

/** A real port whose every operation is recorded. */
function watchedIdentity() {
  const real = identity();
  const port = {} as Record<keyof OwnerIdentityPort, ReturnType<typeof vi.fn>>;
  for (const key of Object.keys(real) as Array<keyof OwnerIdentityPort>) {
    port[key] = vi.fn((...args: unknown[]) => (real[key] as (...a: unknown[]) => Promise<unknown>)(...args));
  }
  return port as unknown as OwnerIdentityPort & Record<keyof OwnerIdentityPort, ReturnType<typeof vi.fn>>;
}

async function webPasswordStep(email = OWNER_EMAIL, password = PASSPHRASE) {
  const server = await buildServer({ databaseUrl: database.uri, auth: settings });
  servers.push(server);
  await server.ready();
  return server.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
    payload: { email, password },
  });
}

describe('Owner activation against PostgreSQL 18.6', () => {
  let migrated = false;

  beforeEach(async () => {
    database = await createEphemeralDatabase();
    authPool = new Pool({ connectionString: database.uri, max: 10 });
    dromexPool = new Pool({ connectionString: database.uri, max: 10 });
    dromexSql = [];
    recordStatements(dromexPool, dromexSql);
    await migrateAuthSchema(authPool);
    migrated = true;
    settings = syntheticAuthSettings();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await settle();
    let incomplete = 0;
    let trusted = 0;
    try {
      while (servers.length > 0) await servers.pop()?.close();
      // Every scenario here — completion, refusal, interruption, resumption,
      // exhausted attempts — may leave only twoFactor rows that Better Auth's
      // adapter wrote with its runtime defaults.
      if (migrated) incomplete = await twoFactorRowsMissingRuntimeDefaults(authPool);
      // No scenario, including a run resumed through a TOTP challenge, may
      // ever have asked Better Auth to trust a device (DEC-434 (3)).
      if (migrated) trusted = await trustDeviceRecords();
    } finally {
      migrated = false;
      await dromexPool?.end().catch(() => undefined);
      await authPool?.end().catch(() => undefined);
      await database?.drop().catch(() => undefined);
    }
    expect(incomplete, 'twoFactor rows without runtime defaults').toBe(0);
    expect(trusted, 'trust-device verification records').toBe(0);
  });

  it('runs only against a disposable test database', () => {
    const uri = new URL(database.uri);
    expect(uri.port).not.toBe('5433');
    expect(uri.pathname).toMatch(/^\/test_[0-9a-f]{32}$/);
  });

  describe('complete terminal activation', () => {
    it('creates one identity, one active MFA-complete Owner, a verified factor, no session, and no intent', async () => {
      await expect(provision()).resolves.toEqual({ status: 'owner_created' });

      const userId = await userIdFor(OWNER_EMAIL);
      expect(await users()).toBe(1);
      expect(await sessions()).toBe(0);
      expect(await intent()).toEqual([]);
      expect(await factorState(userId)).toEqual({ enabled: true, verified: true });

      const { rows } = await authPool.query(
        `SELECT user_id, status, is_owner, mfa_completed_at IS NOT NULL AS mfa_complete FROM dromex_principal`,
      );
      expect(rows).toEqual([{ user_id: userId, status: 'active', is_owner: true, mfa_complete: true }]);
    });

    it('verifies TOTP before any recovery code is shown, and shows codes only after the device acknowledgement', async () => {
      const script = scriptedTerminal();

      await provision({}, identity(), script.terminal);

      expect(script.record.events).toEqual(['enrollment', 'totp', 'devices', 'codes', 'codes-ack', 'clear']);
      expect(script.record.totpPrompts[0]).toEqual([1, 5]);
    });

    it('shows the canonical secret and the DROMEX otpauth URI for manual entry', async () => {
      const script = scriptedTerminal();

      await provision({}, identity(), script.terminal);

      const [{ secret, uri }] = script.record.enrollments as [{ secret: string; uri: string }];
      expect(secret).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{1,4})+$/);
      const parsed = new URL(uri);
      expect(parsed.protocol).toBe('otpauth:');
      // WHATWG URL parsing treats the "totp" in otpauth://totp/... as the
      // host of this non-special scheme, so the label is the whole pathname.
      expect(parsed.host).toBe('totp');
      expect(decodeURIComponent(parsed.pathname)).toBe(`/DROMEX:${OWNER_EMAIL}`);
      expect(parsed.searchParams.get('issuer')).toBe('DROMEX');
      expect(parsed.searchParams.get('digits')).toBe('6');
      expect(parsed.searchParams.get('period')).toBe('30');
      expect(parsed.searchParams.get('secret')).toBe(secret.replaceAll('-', ''));
    });

    it('shows exactly the ten 120-bit codes Better Auth stores, once', async () => {
      const script = scriptedTerminal();

      await provision({}, identity(), script.terminal);

      expect(script.record.recoveryCodes).toHaveLength(1);
      const [codes] = script.record.recoveryCodes as [string[]];
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      for (const code of codes) expect(code).toMatch(CANONICAL_CODE);
      expect(await storedRecoveryCodes(await userIdFor(OWNER_EMAIL))).toEqual(codes);
    });

    it('stores the TOTP secret and the codes encrypted under the current secret version, and the password as Argon2id', async () => {
      const script = scriptedTerminal();
      await provision({}, identity(), script.terminal);
      const userId = await userIdFor(OWNER_EMAIL);

      const { rows } = await authPool.query<{ secret: string; backupCodes: string }>(
        `SELECT secret, "backupCodes" FROM "twoFactor" WHERE "userId" = $1`,
        [userId],
      );
      expect(rows[0]!.secret.startsWith('$ba$1$')).toBe(true);
      expect(rows[0]!.backupCodes.startsWith('$ba$1$')).toBe(true);
      expect(rows[0]!.secret).not.toContain(script.secret()!);
      for (const code of script.record.recoveryCodes[0]!) expect(rows[0]!.backupCodes).not.toContain(code);

      const account = await authPool.query<{ password: string }>(`SELECT password FROM "account" WHERE "userId" = $1`, [userId]);
      expect(account.rows[0]!.password.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
      expect(await verifyPassword(PASSPHRASE, account.rows[0]!.password)).toBe(true);
    });

    it('lets the activated Owner sign in through the unchanged transport with password and TOTP', async () => {
      const script = scriptedTerminal();
      await provision({}, identity(), script.terminal);
      const server = await buildServer({ databaseUrl: database.uri, auth: settings });
      servers.push(server);
      await server.ready();

      const password = await server.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
        payload: { email: OWNER_EMAIL, password: PASSPHRASE },
      });
      expect(password.json()).toEqual({ mfaRequired: true });
      const challenge = String(password.headers['set-cookie']).split(';')[0]!;

      const verified = await server.inject({
        method: 'POST',
        url: '/api/auth/two-factor/verify-totp',
        headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: challenge },
        payload: { code: await new TotpSequence(script.secret()!).next() },
      });
      expect(verified.json()).toEqual({ authenticated: true });
      const cookie = ([] as string[])
        .concat(verified.headers['set-cookie'] ?? [])
        .find((value) => value.includes('session_token=') && !/Max-Age=0/i.test(value))!
        .split(';')[0]!;

      const session = await server.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
      expect(session.json()).toMatchObject({ isOwner: true, user: { email: OWNER_EMAIL } });
    });

    it('accepts at most five TOTP attempts in one run, then stops with nothing activated and resumes cleanly', async () => {
      const first = scriptedTerminal({ code: (_attempt, secret) => wrongCode(secret) });

      expect((await refusal(provision({}, identity(), first.terminal))).code).toBe('totp_attempts_exhausted');
      expect(first.record.totpPrompts.map(([attempt]) => attempt)).toEqual([1, 2, 3, 4, 5]);
      expect(first.record.recoveryCodes).toEqual([]);
      expect(await principals()).toBe(0);
      expect(await sessions()).toBe(0);
      expect(await factorState(await userIdFor(OWNER_EMAIL))).toEqual({ enabled: false, verified: false });

      const second = scriptedTerminal();
      await expect(provision({}, identity(), second.terminal)).resolves.toEqual({ status: 'owner_created' });
      expect(second.record.enrollments[0]!.secret).not.toBe(first.record.enrollments[0]!.secret);
      expect(await users()).toBe(1);
    });

    it('stops without showing codes when the operator refuses the device acknowledgement', async () => {
      const script = scriptedTerminal({ devices: false });

      expect((await refusal(provision({}, identity(), script.terminal))).code).toBe('cancelled');
      expect(script.record.recoveryCodes).toEqual([]);
      expect(await principals()).toBe(0);
      expect(await sessions()).toBe(0);
    });

    it('stops without activating when the operator does not confirm the codes were recorded, and rotates them on resume', async () => {
      const first = scriptedTerminal({ codesRecorded: false });
      expect((await refusal(provision({}, identity(), first.terminal))).code).toBe('cancelled');
      expect(first.record.recoveryCodes).toHaveLength(1);
      expect(await principals()).toBe(0);
      expect(await sessions()).toBe(0);

      const second = scriptedTerminal({ knownSecret: first.secret() });
      await provision({}, identity(), second.terminal);

      const shownBefore = new Set(first.record.recoveryCodes[0]);
      const shownNow = second.record.recoveryCodes[0]!;
      expect(second.record.enrollments).toEqual([]);
      expect(shownNow.filter((code) => shownBefore.has(code))).toEqual([]);
      expect(await storedRecoveryCodes(await userIdFor(OWNER_EMAIL))).toEqual(shownNow);
    });

    it('is not blocked by existing non-Owner principals', async () => {
      const admin = await provisionSyntheticUser(authPool, settings, 'admin');
      await setPrincipal(authPool, admin.id, 'active', false);

      await expect(provision()).resolves.toEqual({ status: 'owner_created' });
      expect(await owners()).toBe(1);
      expect(await principals()).toBe(2);
    });

    it('rejects invalid input before touching the database, Better Auth, or the terminal', async () => {
      const connect = vi.spyOn(dromexPool, 'connect');
      const port = watchedIdentity();
      const script = scriptedTerminal();

      for (const [overrides, code] of [
        [{ name: '' }, 'invalid_name'],
        [{ email: 'not-an-email' }, 'invalid_email'],
        [{ password: 'too short', passwordConfirmation: 'too short' }, 'invalid_password'],
        [{ passwordConfirmation: `${PASSPHRASE} typo` }, 'confirmation_mismatch'],
      ] as Array<[Partial<OwnerDraft>, string]>) {
        expect((await refusal(provision(overrides, port, script.terminal))).code).toBe(code);
      }

      expect(connect).not.toHaveBeenCalled();
      for (const operation of Object.values(port)) expect(operation).not.toHaveBeenCalled();
      expect(script.record.events).toEqual([]);
    });
  });

  describe('refusal once an Owner exists', () => {
    it('refuses a second bootstrap and a re-run, creating no further identity', async () => {
      await provision();

      expect((await refusal(provision({ email: 'second@synthetic.invalid' }))).code).toBe('owner_exists');
      expect((await refusal(provision())).code).toBe('owner_exists');
      expect(await users()).toBe(1);
      expect(await sessions()).toBe(0);
    });

    it('refuses before any Better Auth action or terminal prompt when an Owner already exists', async () => {
      const existing = await provisionSyntheticUser(authPool, settings, 'owner');
      await setPrincipal(authPool, existing.id, 'active', true);
      const port = watchedIdentity();
      const script = scriptedTerminal();

      expect((await refusal(provision({}, port, script.terminal))).code).toBe('owner_exists');
      for (const operation of Object.values(port)) expect(operation).not.toHaveBeenCalled();
      expect(script.record.events).toEqual([]);
    });
  });

  describe('mutual exclusion', () => {
    it('lets only one of two concurrent activations create an Owner', async () => {
      const outcomes = await Promise.allSettled([
        provision({}, identity(), scriptedTerminal().terminal),
        provision({ email: 'rival@synthetic.invalid' }, identity(), scriptedTerminal().terminal),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const [refused] = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      expect(['in_progress', 'owner_exists']).toContain((refused!.reason as OwnerProvisioningError).code);
      expect(await owners()).toBe(1);
      expect(await users()).toBe(1);
    });

    it('refuses immediately while another connection holds the provisioning lock, changing nothing', async () => {
      const blocker = await authPool.connect();
      try {
        await blocker.query('SELECT pg_advisory_lock($1)', [OWNER_PROVISIONING_LOCK_KEY]);
        const port = watchedIdentity();

        expect((await refusal(provision({}, port))).code).toBe('in_progress');
        for (const operation of Object.values(port)) expect(operation).not.toHaveBeenCalled();
        expect(await users()).toBe(0);
      } finally {
        await blocker.query('SELECT pg_advisory_unlock($1)', [OWNER_PROVISIONING_LOCK_KEY]);
        blocker.release();
      }

      await expect(provision()).resolves.toEqual({ status: 'owner_created' });
      // pg_locks is cluster-wide, and other test files migrate their own
      // disposable databases concurrently; count only this database's locks.
      const { rows } = await authPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks
          WHERE locktype = 'advisory'
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
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
      for (const operation of Object.values(port)) expect(operation).not.toHaveBeenCalled();
      expect(await principals()).toBe(0);
      expect(await intent()).toEqual([]);
    });
  });

  describe('interruption and resumption', () => {
    it('before identity creation: leaves no identity and resumes cleanly', async () => {
      expect((await refusal(provision({}, interrupted('create', 'before')))).code).toBe('failed');
      expect(await users()).toBe(0);

      await expect(provision()).resolves.toEqual({ status: 'owner_created' });
      expect(await users()).toBe(1);
    });

    it('after identity creation: leaves an orphan with no principal or session, which only the right email and password can resume', async () => {
      expect((await refusal(provision({}, interrupted('create', 'after')))).code).toBe('failed');
      const orphanId = await userIdFor(OWNER_EMAIL);
      expect(await principals()).toBe(0);
      expect(await sessions()).toBe(0);
      expect(await intent()).toEqual([{ state: 'pending_identity', email: OWNER_EMAIL, user_id: null }]);

      const wrong = 'a synthetic wrong passphrase';
      expect((await refusal(provision({ password: wrong, passwordConfirmation: wrong }))).code).toBe('verification_failed');
      expect((await refusal(provision({ email: 'other@synthetic.invalid' }))).code).toBe('different_pending_email');
      expect(await sessions()).toBe(0);

      await expect(provision()).resolves.toEqual({ status: 'owner_created' });
      expect(await users()).toBe(1);
      expect((await authPool.query(`SELECT user_id FROM dromex_principal`)).rows).toEqual([{ user_id: orphanId }]);
    });

    it('after enabling TOTP but before verification: grants no web access and replaces the stale secret on resume', async () => {
      const first = scriptedTerminal({ throwAt: 'totp' });
      expect((await refusal(provision({}, identity(), first.terminal))).code).toBe('failed');
      const userId = await userIdFor(OWNER_EMAIL);
      expect(await factorState(userId)).toEqual({ enabled: false, verified: false });
      expect(await sessions()).toBe(0);
      expect((await webPasswordStep()).statusCode).toBe(401);
      expect(await sessions()).toBe(0);

      const second = scriptedTerminal();
      await provision({}, identity(), second.terminal);

      expect(second.record.enrollments[0]!.secret).not.toBe(first.record.enrollments[0]!.secret);
      expect(await factorState(userId)).toEqual({ enabled: true, verified: true });
    });

    it('after verification but before the device acknowledgement: grants no web access and resumes through a TOTP challenge', async () => {
      const first = scriptedTerminal({ throwAt: 'devices' });
      expect((await refusal(provision({}, identity(), first.terminal))).code).toBe('failed');
      expect(await factorState(await userIdFor(OWNER_EMAIL))).toEqual({ enabled: true, verified: true });
      expect(first.record.recoveryCodes).toEqual([]);
      expect(await sessions()).toBe(0);
      expect(await principals()).toBe(0);
      expect((await webPasswordStep()).statusCode).toBe(401);

      const second = scriptedTerminal({ knownSecret: first.secret() });
      await expect(provision({}, identity(), second.terminal)).resolves.toEqual({ status: 'owner_created' });
      expect(second.record.enrollments).toEqual([]);
      expect(await storedRecoveryCodes(await userIdFor(OWNER_EMAIL))).toEqual(second.record.recoveryCodes[0]);
    });

    it('after showing codes but before their acknowledgement: invalidates every code shown in the interrupted run', async () => {
      const first = scriptedTerminal({ throwAt: 'codes-ack' });
      expect((await refusal(provision({}, identity(), first.terminal))).code).toBe('failed');
      expect(await sessions()).toBe(0);

      const second = scriptedTerminal({ knownSecret: first.secret() });
      await provision({}, identity(), second.terminal);

      const stored = await storedRecoveryCodes(await userIdFor(OWNER_EMAIL));
      for (const code of first.record.recoveryCodes[0]!) expect(stored).not.toContain(code);
      expect(stored).toEqual(second.record.recoveryCodes[0]);
    });

    it('during session revocation: grants no web access, and leaves no session once resumed', async () => {
      // Both the planned revocation and the best-effort cleanup fail, so a
      // provisioning session genuinely survives the interrupted run.
      const first = scriptedTerminal();
      expect(
        (await refusal(provision({}, interrupted('revokeAllSessions', 'before', 2), first.terminal))).code,
      ).toBe('failed');
      expect(await principals()).toBe(0);
      expect(await sessions()).toBeGreaterThan(0);
      expect((await webPasswordStep()).statusCode).toBe(401);

      const second = scriptedTerminal({ knownSecret: first.secret() });
      await expect(provision({}, identity(), second.terminal)).resolves.toEqual({ status: 'owner_created' });

      expect(await sessions()).toBe(0);
      expect(await owners()).toBe(1);
      const stored = await storedRecoveryCodes(await userIdFor(OWNER_EMAIL));
      for (const code of first.record.recoveryCodes[0]!) expect(stored).not.toContain(code);
    });

    it('during the final DROMEX transaction: rolls back, leaves no session, and rotates codes on resume', async () => {
      await authPool.query(`
        CREATE FUNCTION synthetic_refuse_principal() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic principal failure'; END $$;
        CREATE TRIGGER synthetic_refuse_principal BEFORE INSERT ON dromex_principal
        FOR EACH ROW EXECUTE FUNCTION synthetic_refuse_principal();
      `);
      const first = scriptedTerminal();

      expect((await refusal(provision({}, identity(), first.terminal))).code).toBe('failed');
      const userId = await userIdFor(OWNER_EMAIL);
      expect(await principals()).toBe(0);
      expect(await sessions()).toBe(0);
      expect(await intent()).toEqual([{ state: 'identity_created', email: OWNER_EMAIL, user_id: userId }]);

      await authPool.query(`
        DROP TRIGGER synthetic_refuse_principal ON dromex_principal;
        DROP FUNCTION synthetic_refuse_principal();
      `);

      const second = scriptedTerminal({ knownSecret: first.secret() });
      await expect(provision({}, identity(), second.terminal)).resolves.toEqual({ status: 'owner_created' });
      expect(await users()).toBe(1);
      expect(await owners()).toBe(1);
      expect(await sessions()).toBe(0);
      const stored = await storedRecoveryCodes(userId);
      for (const code of first.record.recoveryCodes[0]!) expect(stored).not.toContain(code);
    });
  });

  describe('secrecy and ownership of Better Auth data', () => {
    it('never exposes the password, TOTP secret, or codes outside the one terminal display', async () => {
      const captured: string[] = [];
      const capture = (...args: unknown[]) => {
        captured.push(args.map((arg) => (arg instanceof Error ? `${arg.message}${arg.stack}` : String(arg))).join(' '));
      };
      for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, method).mockImplementation(capture);
      }
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => (capture(chunk), true));
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => (capture(chunk), true));

      const interruptedRun = scriptedTerminal({ throwAt: 'codes-ack' });
      const outcomes: unknown[] = [];
      outcomes.push(await provision({}, identity(), interruptedRun.terminal).catch((error: unknown) => error));
      const wrong = 'a synthetic wrong passphrase';
      outcomes.push(await provision({ password: wrong, passwordConfirmation: wrong }).catch((error: unknown) => error));
      const completed = scriptedTerminal({ knownSecret: interruptedRun.secret() });
      outcomes.push(await provision({}, identity(), completed.terminal));
      outcomes.push(await provision().catch((error: unknown) => error));

      vi.restoreAllMocks();

      const exposed = [
        ...captured,
        ...outcomes.map((outcome) =>
          outcome instanceof Error ? `${outcome.name}${outcome.message}${outcome.stack}${JSON.stringify(outcome)}` : JSON.stringify(outcome),
        ),
      ].join('\n');

      for (const secret of [
        PASSPHRASE,
        wrong,
        '$argon2id$',
        '$ba$',
        'session_token',
        interruptedRun.secret()!,
        ...interruptedRun.record.recoveryCodes[0]!,
        ...completed.record.recoveryCodes[0]!,
      ]) {
        expect(exposed).not.toContain(secret);
      }
    });

    it('issues no mutating SQL against Better Auth-owned tables through its own connections', async () => {
      await refusal(provision({}, interrupted('create', 'after')));
      await provision();

      expect(dromexSql.some((sql) => /pg_try_advisory_lock/.test(sql))).toBe(true);
      expect(dromexSql.some((sql) => /insert\s+into\s+dromex_principal/i.test(sql))).toBe(true);
      expect(dromexSql.filter((sql) => BETTER_AUTH_MUTATION.test(sql))).toEqual([]);
    });

    it('keeps public sign-up disabled on the normal instance sharing the same database', async () => {
      identity();
      const runtime = createAuth({ ...settings, database: authPool });

      await expect(
        runtime.api.signUpEmail({ body: { name: 'Uninvited', email: 'uninvited@synthetic.invalid', password: PASSPHRASE } }),
      ).rejects.toThrow();
      expect(await users()).toBe(0);
    });
  });
});
