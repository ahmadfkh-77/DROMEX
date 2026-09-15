import { Writable } from 'node:stream';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthSettings } from '../../src/auth/config.ts';
import {
  SECURITY_AUDIT_EVENT_TYPES,
  createSecurityAudit,
  securityEvent,
} from '../../src/auth/security-audit.ts';
import { createTotpReplayGuard } from '../../src/auth/totp-replay.ts';
import { OwnerProvisioningError } from '../../src/provisioning/errors.ts';
import {
  AUTHENTICATOR_ACKNOWLEDGEMENT,
  RECOVERY_CODE_ACKNOWLEDGEMENT,
} from '../../src/provisioning/terminal-prompt.ts';
import { TerminalRecoveryError } from '../../src/provisioning/terminal-recovery-errors.ts';
import {
  createTerminalRecoveryIdentity,
  type TerminalRecoveryIdentityPort,
} from '../../src/provisioning/terminal-recovery-identity.ts';
import {
  AUTHENTICATOR_AVAILABLE,
  NO_AUTHENTICATOR_AVAILABLE,
  OWNER_TERMINAL_RECOVERY_LOCK_KEY,
  RESET_CONFIRMATION,
  SHOW_ONE_CODE,
  recoverOwnerFromTerminal,
  type OwnerRecoveryTerminal,
  type TerminalRecoveryDependencies,
  type TerminalRecoveryResult,
} from '../../src/provisioning/terminal-recovery.ts';
import { buildServer } from '../../src/server.ts';
import {
  cookiePair,
  enrollSyntheticMfa,
  fixtureAuth,
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  twoFactorRowsMissingRuntimeDefaults,
  type EnrolledUser,
  type SyntheticUser,
} from '../helpers/auth-fixtures.ts';
import { TEST_TRUSTED_ORIGIN, settle, syntheticAuthSettings, syntheticSecret } from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';
import { TotpSequence, wrongCode } from '../helpers/totp.ts';

/**
 * Checkpoint 3F-D (DEC-437): terminal emergency Owner recovery against
 * disposable PostgreSQL 18.6. Three paths — supported retrieval of one code,
 * supported authenticator replacement, and the narrowly scoped DEC-437 reset —
 * plus concurrency, interruption, reruns, session revocation, the audit trail,
 * secret redaction, and the web recovery protections of checkpoint 3F-C.
 *
 * The real command is never executed: every run here injects a scripted
 * terminal and a disposable database. Every identity is synthetic.
 */

const INCIDENT = 'INC-20260915-01';
const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;
const BETTER_AUTH_WRITE =
  /\b(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop\s+table|copy)\s+"?(user|account|session|verification|rateLimit|twoFactor)"?(\s|$|\(|;)/gi;

let database: EphemeralDatabase;
let authPool: Pool;
let dromexPool: Pool;
let settings: AuthSettings;
let dromexSql: string[];
let migrated = false;
let address = 0;
const servers: FastifyInstance[] = [];

const nextAddress = () => `198.51.100.${(address += 1)}`;

/** Records every statement text the DROMEX pool sends; values travel separately. */
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function ownerWithoutFactor(label = 'owner'): Promise<SyntheticUser> {
  const user = await provisionSyntheticUser(authPool, settings, label);
  await setPrincipal(authPool, user.id, 'active', true);
  return user;
}

async function ownerWithFactor(label = 'owner'): Promise<EnrolledUser> {
  return enrollSyntheticMfa(authPool, settings, await ownerWithoutFactor(label));
}

async function nonOwnerWithFactor(label: string): Promise<EnrolledUser> {
  const user = await provisionSyntheticUser(authPool, settings, label);
  await setPrincipal(authPool, user.id, 'active', false);
  return enrollSyntheticMfa(authPool, settings, user);
}

/** Uses every stored recovery code through Better Auth's own sign-in flow. */
async function consumeEveryRecoveryCode(user: EnrolledUser): Promise<void> {
  const auth = fixtureAuth(authPool, settings);
  for (const code of user.recoveryCodes) {
    const signedIn = await auth.api.signInEmail({
      body: { email: user.email, password: user.password },
      returnHeaders: true,
    });
    const verified = await auth.api.verifyBackupCode({
      body: { code, trustDevice: false },
      headers: new Headers({ cookie: cookiePair(signedIn.headers, 'two_factor') }),
      returnHeaders: true,
    });
    await auth.api.revokeSessions({
      headers: new Headers({ cookie: cookiePair(verified.headers, 'session_token') }),
    });
  }
  expect(await storedCodes(user.id)).toEqual([]);
}

/** Regenerates the stored codes through Better Auth, proving the authenticator. */
async function regenerateWithAuthenticator(user: EnrolledUser): Promise<void> {
  const auth = fixtureAuth(authPool, settings);
  const signedIn = await auth.api.signInEmail({
    body: { email: user.email, password: user.password },
    returnHeaders: true,
  });
  const verified = await auth.api.verifyTOTP({
    body: { code: await user.totp.next(), trustDevice: false },
    headers: new Headers({ cookie: cookiePair(signedIn.headers, 'two_factor') }),
    returnHeaders: true,
  });
  const headers = new Headers({ cookie: cookiePair(verified.headers, 'session_token') });
  await auth.api.generateBackupCodes({ body: { password: user.password }, headers });
  await auth.api.revokeSessions({ headers });
}

function identity(authSettings: AuthSettings = settings): TerminalRecoveryIdentityPort {
  return createTerminalRecoveryIdentity(authSettings, authPool);
}

/** Wraps the real port to keep every cookie it hands the service. */
function capturing(port: TerminalRecoveryIdentityPort) {
  const cookies: string[] = [];
  const verifiedCodes: string[] = [];
  const wrapped: TerminalRecoveryIdentityPort = {
    ...port,
    async signIn(input) {
      const outcome = await port.signIn(input);
      if (outcome.kind !== 'invalid') cookies.push(outcome.cookie);
      return outcome;
    },
    async verifyTotp(input) {
      verifiedCodes.push(input.code);
      const outcome = await port.verifyTotp(input);
      if (outcome.kind === 'verified') cookies.push(outcome.cookie);
      return outcome;
    },
    async disableFactor(input) {
      const cookie = await port.disableFactor(input);
      cookies.push(cookie);
      return cookie;
    },
  };
  return { port: wrapped, cookies, verifiedCodes };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// ---------------------------------------------------------------------------
// A scripted operator
// ---------------------------------------------------------------------------

type Step =
  | 'target'
  | 'email'
  | 'password'
  | 'availability'
  | 'existing-code'
  | 'retrieval'
  | 'retrieved'
  | 'reset-warning'
  | 'reset'
  | 'incident'
  | 'enrollment'
  | 'new-code'
  | 'devices'
  | 'codes'
  | 'codes-ack'
  | 'clear';

interface Script {
  email?: string;
  password?: string;
  availability?: string;
  retrieval?: string;
  reset?: string;
  incident?: string;
  devices?: string;
  codesAck?: string;
  /** The authenticator the operator still holds, if any. */
  existing?: TotpSequence;
  newCode?: (attempt: number, sequence: TotpSequence) => Promise<string> | string;
  /** Throws an ordinary error, carrying the password, at this step. */
  throwAt?: Step;
  /** The operator presses Ctrl+C at this step. */
  cancelAt?: Step;
  at?: Partial<Record<Step, () => Promise<void>>>;
}

function scripted(user: SyntheticUser, script: Script = {}) {
  const record = {
    steps: [] as Step[],
    targets: [] as Array<{ maskedEmail: string; environment: string }>,
    retrieved: [] as string[],
    enrollments: [] as Array<{ secret: string; uri: string }>,
    codes: [] as string[][],
    newCodePrompts: [] as number[],
  };
  let sequence: TotpSequence | undefined;

  const step = async (name: Step) => {
    record.steps.push(name);
    await script.at?.[name]?.();
    if (script.throwAt === name) throw new Error(`synthetic interruption at ${name}: ${user.password}`);
    if (script.cancelAt === name) throw new OwnerProvisioningError('cancelled');
  };

  const terminal: OwnerRecoveryTerminal = {
    async presentTarget(target) {
      record.targets.push({ ...target });
      await step('target');
    },
    async readOwnerEmail() {
      await step('email');
      return script.email ?? user.email;
    },
    async readPassword() {
      await step('password');
      return script.password ?? user.password;
    },
    async readAuthenticatorAvailability() {
      await step('availability');
      return script.availability ?? NO_AUTHENTICATOR_AVAILABLE;
    },
    async readTotpCode({ attempt, authenticator }) {
      if (authenticator === 'existing') {
        await step('existing-code');
        const existing = script.existing ?? (user as Partial<EnrolledUser>).totp;
        if (!existing) throw new Error('no existing authenticator');
        return existing.next();
      }
      record.newCodePrompts.push(attempt);
      await step('new-code');
      if (!sequence) throw new Error('no authenticator enrolled');
      return script.newCode ? script.newCode(attempt, sequence) : sequence.next();
    },
    async readRetrievalConfirmation() {
      await step('retrieval');
      return script.retrieval ?? SHOW_ONE_CODE;
    },
    async presentRetrievedCode(code) {
      record.retrieved.push(code);
      await step('retrieved');
    },
    async presentResetWarning() {
      await step('reset-warning');
    },
    async readResetConfirmation() {
      await step('reset');
      return script.reset ?? RESET_CONFIRMATION;
    },
    async readIncidentReference() {
      await step('incident');
      return script.incident ?? INCIDENT;
    },
    async presentEnrollment(material) {
      record.enrollments.push({ ...material });
      sequence = new TotpSequence(material.secret.replaceAll('-', ''));
      await step('enrollment');
    },
    async readAuthenticatorAcknowledgement() {
      await step('devices');
      return script.devices ?? AUTHENTICATOR_ACKNOWLEDGEMENT;
    },
    async presentRecoveryCodes(codes) {
      record.codes.push([...codes]);
      await step('codes');
    },
    async readRecoveryCodeAcknowledgement() {
      await step('codes-ack');
      return script.codesAck ?? RECOVERY_CODE_ACKNOWLEDGEMENT;
    },
    async clearScreen() {
      await step('clear');
    },
  };

  return { terminal, record, sequence: () => sequence };
}

async function recover(
  user: SyntheticUser,
  script: Script = {},
  overrides: Partial<TerminalRecoveryDependencies> = {},
) {
  const session = scripted(user, script);
  const outcome: { result: TerminalRecoveryResult | null; error: unknown } = await recoverOwnerFromTerminal({
    pool: dromexPool,
    identity: identity(),
    terminal: session.terminal,
    environment: 'test',
    ...overrides,
  }).then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error }),
  );
  return { ...outcome, ...session };
}

function codeOf(error: unknown): string {
  if (error instanceof TerminalRecoveryError) return error.code;
  if (error === null) throw new Error('expected the run to be refused');
  throw error instanceof Error ? error : new Error('expected a terminal recovery refusal');
}

// ---------------------------------------------------------------------------
// Database readers
// ---------------------------------------------------------------------------

async function rows<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  return (await authPool.query(sql, values)).rows as T[];
}

async function mfaCompletedAt(userId: string): Promise<Date | null> {
  const [row] = await rows<{ mfa_completed_at: Date | null }>(
    `SELECT mfa_completed_at FROM dromex_principal WHERE user_id = $1`,
    [userId],
  );
  return row!.mfa_completed_at;
}

async function sessionCount(userId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [userId]);
  return row!.n;
}

async function factorState(userId: string) {
  const [row] = await rows<{ enabled: boolean | null; factor_rows: number; verified: boolean | null }>(
    `SELECT u."twoFactorEnabled" AS enabled, count(t.id)::int AS factor_rows, bool_and(t.verified) AS verified
       FROM "user" u LEFT JOIN "twoFactor" t ON t."userId" = u.id
      WHERE u.id = $1 GROUP BY u.id`,
    [userId],
  );
  return row!;
}

async function betterAuthRowsOf(userId: string) {
  return rows(
    `SELECT (SELECT to_jsonb(u) FROM "user" u WHERE u.id = $1) AS user_row,
            (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM "twoFactor" t WHERE t."userId" = $1) AS factor_rows,
            (SELECT count(*)::int FROM "session" s WHERE s."userId" = $1) AS sessions`,
    [userId],
  );
}

async function storedCodes(userId: string, authSettings: AuthSettings = settings): Promise<string[]> {
  return (await fixtureAuth(authPool, authSettings).api.viewBackupCodes({ body: { userId } })).backupCodes;
}

interface RunRow {
  id: string;
  state: string;
  path: string | null;
  incident_reference: string | null;
  ended: boolean;
}

async function runs(userId: string): Promise<RunRow[]> {
  return rows<RunRow>(
    `SELECT id::text AS id, state, path, incident_reference, ended_at IS NOT NULL AS ended
       FROM dromex_terminal_recovery WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
}

interface AuditRow {
  event_type: string;
  outcome: string;
  actor_user_id: string | null;
  reason: string | null;
  revoked_session_count: number | null;
  recovery_id: string | null;
  terminal_recovery_id: string | null;
  incident_reference: string | null;
}

async function audit(): Promise<AuditRow[]> {
  return rows<AuditRow>(
    `SELECT event_type, outcome, actor_user_id, reason, revoked_session_count, recovery_id::text AS recovery_id,
            terminal_recovery_id::text AS terminal_recovery_id, incident_reference
       FROM dromex_audit_event ORDER BY id`,
  );
}

async function eventTypes(): Promise<string[]> {
  return (await audit()).map((row) => row.event_type);
}

async function terminalSessions(): Promise<string[]> {
  return (await rows<{ session_id: string }>(`SELECT session_id FROM dromex_terminal_recovery_session`)).map(
    (row) => row.session_id,
  );
}

// ---------------------------------------------------------------------------
// The web application, for 3F-C interplay and business-access checks
// ---------------------------------------------------------------------------

async function startServer(authSettings: AuthSettings = settings): Promise<FastifyInstance> {
  const logStream = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const app = await buildServer({ databaseUrl: database.uri, auth: authSettings, logStream });
  app.get('/api/projects', { config: { access: 'authenticated' } }, async () => ({ business: true }));
  await app.ready();
  servers.push(app);
  return app;
}

function post(app: FastifyInstance, url: string, payload: unknown, cookie?: string, remoteAddress = nextAddress()) {
  return app.inject({
    method: 'POST',
    url,
    remoteAddress,
    headers: {
      origin: TEST_TRUSTED_ORIGIN,
      'content-type': 'application/json',
      ...(cookie === undefined ? {} : { cookie }),
    },
    payload: payload as Record<string, unknown>,
  });
}

function namedCookie(response: LightMyRequestResponse, fragment: string): string {
  const header = response.headers['set-cookie'];
  const all = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const cookie = all.find((value) => value.split('=')[0]!.includes(fragment) && !/Max-Age=0/i.test(value));
  if (!cookie) throw new Error(`expected a ${fragment} cookie`);
  return cookie.split(';')[0]!;
}

async function webChallenge(app: FastifyInstance, user: SyntheticUser, remoteAddress: string): Promise<string> {
  const response = await post(app, '/api/auth/sign-in/email', { email: user.email, password: user.password }, undefined, remoteAddress);
  expect(response.json()).toEqual({ mfaRequired: true });
  return namedCookie(response, 'two_factor');
}

async function webSignIn(app: FastifyInstance, user: SyntheticUser, sequence: TotpSequence): Promise<string> {
  const remote = nextAddress();
  const challenge = await webChallenge(app, user, remote);
  const response = await post(app, '/api/auth/two-factor/verify-totp', { code: await sequence.next() }, challenge, remote);
  expect(response.statusCode).toBe(200);
  return namedCookie(response, 'session_token');
}

async function businessStatus(app: FastifyInstance, cookie: string): Promise<number[]> {
  const session = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
  const project = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
  return [session.statusCode, project.statusCode];
}

// ---------------------------------------------------------------------------

describe('Terminal Owner recovery against PostgreSQL 18.6', () => {
  beforeEach(async () => {
    database = await createEphemeralDatabase();
    authPool = new Pool({ connectionString: database.uri, max: 10 });
    dromexPool = new Pool({ connectionString: database.uri, max: 10 });
    dromexSql = [];
    recordStatements(dromexPool, dromexSql);
    await migrateAuthSchema(authPool);
    migrated = true;
    settings = syntheticAuthSettings();
    address = 0;
  });

  afterEach(async () => {
    await settle();
    let incomplete = 0;
    let trusted = 0;
    try {
      while (servers.length > 0) await servers.pop()?.close();
      if (migrated) {
        incomplete = await twoFactorRowsMissingRuntimeDefaults(authPool);
        const [row] = await rows<{ n: number }>(
          `SELECT count(*)::int AS n FROM verification WHERE identifier LIKE 'trust-device-%'`,
        );
        trusted = row!.n;
      }
    } finally {
      migrated = false;
      await dromexPool?.end().catch(() => undefined);
      await authPool?.end().catch(() => undefined);
      await database?.drop().catch(() => undefined);
    }
    expect(incomplete, 'twoFactor rows without runtime defaults').toBe(0);
    expect(trusted, 'trust-device verification records').toBe(0);
  });

  describe('who may be recovered', () => {
    it('refuses when no Owner exists, before asking for anything', async () => {
      const user = await provisionSyntheticUser(authPool, settings, 'nobody');

      const run = await recover(user);

      expect(codeOf(run.error)).toBe('not_eligible');
      expect(run.record.steps).toEqual([]);
      expect((await audit()).map((row) => [row.event_type, row.reason])).toEqual([
        ['terminal_recovery_refused', 'not_eligible'],
      ]);
      expect(await rows(`SELECT 1 FROM dromex_terminal_recovery`)).toEqual([]);
    });

    it('refuses when more than one Owner is detected', async () => {
      await authPool.query(`DROP INDEX dromex_principal_single_owner`);
      const first = await ownerWithFactor('first');
      const second = await ownerWithFactor('second');

      const run = await recover(first);

      expect(codeOf(run.error)).toBe('not_eligible');
      expect(run.record.steps).toEqual([]);
      expect(await mfaCompletedAt(first.id)).not.toBeNull();
      expect(await mfaCompletedAt(second.id)).not.toBeNull();
      expect(await rows(`SELECT 1 FROM dromex_terminal_recovery`)).toEqual([]);
    });

    it('refuses a disabled Owner and leaves the factor untouched', async () => {
      const owner = await ownerWithFactor();
      await setPrincipal(authPool, owner.id, 'disabled', true);

      const run = await recover(owner);

      expect(codeOf(run.error)).toBe('not_eligible');
      expect(run.record.steps).toEqual([]);
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect((await audit()).map((row) => row.reason)).toEqual(['not_eligible']);
    });

    it('refuses when the typed email does not name the Owner, before asking for the password', async () => {
      const owner = await ownerWithFactor();

      const run = await recover(owner, { email: 'someone-else@synthetic.invalid' });

      expect(codeOf(run.error)).toBe('not_confirmed');
      expect(run.record.steps).toEqual(['target', 'email']);
      expect(run.record.targets).toHaveLength(1);
      expect(run.record.targets[0]!.environment).toBe('test');
      expect(run.record.targets[0]!.maskedEmail).not.toBe(owner.email);
      expect(run.record.targets[0]!.maskedEmail).toContain('@synthetic.invalid');
      expect(await mfaCompletedAt(owner.id)).not.toBeNull();
      expect(await runs(owner.id)).toEqual([]);
      expect(await eventTypes()).toEqual(['terminal_recovery_requested', 'terminal_recovery_refused']);
    });
  });

  describe('password proof', () => {
    it('refuses an incorrect password after one attempt and changes nothing but the audit trail', async () => {
      const owner = await ownerWithFactor();
      const completedAt = await mfaCompletedAt(owner.id);

      const run = await recover(owner, { password: 'an incorrect synthetic passphrase' });

      expect(codeOf(run.error)).toBe('verification_failed');
      expect(run.record.steps).toEqual(['target', 'email', 'password']);
      expect(await mfaCompletedAt(owner.id)).toEqual(completedAt);
      expect(await runs(owner.id)).toEqual([]);
      expect(await sessionCount(owner.id)).toBe(0);
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect(await storedCodes(owner.id)).toEqual(owner.recoveryCodes);
      const events = await audit();
      expect(events.map((row) => row.event_type)).toEqual(['terminal_recovery_requested', 'terminal_password_rejected']);
      expect(events[1]).toMatchObject({ outcome: 'failure', actor_user_id: owner.id });
    });

    it('throttles after five audited password rejections within fifteen minutes', async () => {
      const owner = await ownerWithFactor();
      const writer = createSecurityAudit(authPool);
      for (let index = 0; index < 5; index += 1) {
        await writer.record(
          securityEvent('terminal_password_rejected', 'failure', { userId: owner.id, name: owner.name }, null, null),
        );
      }

      const run = await recover(owner);

      expect(codeOf(run.error)).toBe('throttled');
      expect(run.record.steps).toEqual([]);
      expect((await audit()).at(-1)).toMatchObject({ event_type: 'terminal_recovery_refused', reason: 'throttled' });
      expect(await mfaCompletedAt(owner.id)).not.toBeNull();
    });

    it('does not count rejections older than fifteen minutes', async () => {
      const owner = await ownerWithFactor();
      for (let index = 0; index < 5; index += 1) {
        await authPool.query(
          `INSERT INTO dromex_audit_event (event_type, outcome, actor_user_id, occurred_at)
           VALUES ('terminal_password_rejected', 'failure', $1, CURRENT_TIMESTAMP - interval '16 minutes')`,
          [owner.id],
        );
      }

      const run = await recover(owner, { password: 'an incorrect synthetic passphrase' });

      expect(codeOf(run.error)).toBe('verification_failed');
      expect(run.record.steps).toContain('password');
    });
  });

  describe('version and schema pinning', () => {
    it('refuses a Better Auth version other than 1.7.4 before touching the Owner', async () => {
      const owner = await ownerWithFactor();

      const run = await recover(owner, {}, { betterAuthVersion: '1.7.5' });

      expect(codeOf(run.error)).toBe('version_mismatch');
      expect(run.record.steps).toEqual([]);
      expect((await audit()).map((row) => row.reason)).toEqual(['version_mismatch']);
      expect(await mfaCompletedAt(owner.id)).not.toBeNull();
    });

    it('refuses a Better Auth schema that differs from the verified one', async () => {
      const owner = await ownerWithFactor();
      await authPool.query(`ALTER TABLE "twoFactor" ADD COLUMN "syntheticExtra" text`);

      const run = await recover(owner);

      expect(codeOf(run.error)).toBe('schema_mismatch');
      expect(run.record.steps).toEqual([]);
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
    });

    it('refuses a Better Auth schema that is missing a verified column', async () => {
      const owner = await ownerWithFactor();
      await authPool.query(`ALTER TABLE "session" DROP COLUMN "userAgent"`);

      const run = await recover(owner);

      expect(codeOf(run.error)).toBe('schema_mismatch');
      expect(run.record.steps).toEqual([]);
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
    });
  });

  describe('supported retrieval of one existing code', () => {
    it('shows exactly one unused code once, audits only its retrieval, and hands off to web recovery', async () => {
      const owner = await ownerWithFactor();
      const app = await startServer();

      const run = await recover(owner);

      expect(run.result).toEqual({ status: 'code_retrieved' });
      expect(run.record.steps).toEqual(['target', 'email', 'password', 'availability', 'retrieval', 'retrieved']);
      expect(run.record.retrieved).toHaveLength(1);
      const code = run.record.retrieved[0]!;
      expect(owner.recoveryCodes).toContain(code);
      expect(run.record.enrollments).toEqual([]);
      expect(await storedCodes(owner.id)).toEqual(owner.recoveryCodes);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await runs(owner.id)).toMatchObject([{ state: 'code_retrieved', path: 'retrieval', ended: true }]);
      expect(await eventTypes()).toEqual([
        'terminal_recovery_requested',
        'terminal_identity_verified',
        'recovery_code_retrieved',
      ]);
      const everyAuditValue = JSON.stringify(await rows(`SELECT * FROM dromex_audit_event`));
      for (const stored of owner.recoveryCodes) expect(everyAuditValue).not.toContain(stored);

      // The code enters the restricted web recovery of checkpoint 3F-C.
      const remote = nextAddress();
      const response = await post(app, '/api/auth/recovery/verify-code', { code }, await webChallenge(app, owner, remote), remote);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ recovery: 'authenticator_replacement_required', expiresInSeconds: 300 });
    });

    it('shows nothing and ends the run as abandoned without the exact confirmation', async () => {
      const owner = await ownerWithFactor();

      const run = await recover(owner, { retrieval: 'show one code' });

      expect(codeOf(run.error)).toBe('not_confirmed');
      expect(run.record.retrieved).toEqual([]);
      expect(await runs(owner.id)).toMatchObject([{ state: 'abandoned', ended: true }]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await storedCodes(owner.id)).toEqual(owner.recoveryCodes);
      expect(await eventTypes()).toContain('terminal_recovery_abandoned');
      expect(await eventTypes()).not.toContain('recovery_code_retrieved');
    });
  });

  describe('supported replacement', () => {
    it('enrols a new authenticator for an Owner with no factor, issues new codes, and requires normal sign-in', async () => {
      const owner = await ownerWithoutFactor();

      const run = await recover(owner);

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(run.record.steps).toEqual([
        'target',
        'email',
        'password',
        'enrollment',
        'new-code',
        'devices',
        'codes',
        'codes-ack',
        'clear',
      ]);
      expect(run.record.enrollments).toHaveLength(1);
      expect(run.record.codes).toHaveLength(1);
      const [codes] = run.record.codes;
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      for (const code of codes!) expect(code).toMatch(CANONICAL_CODE);
      expect(await storedCodes(owner.id)).toEqual(codes);
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect(await mfaCompletedAt(owner.id)).not.toBeNull();
      expect(await sessionCount(owner.id)).toBe(0);
      expect(await runs(owner.id)).toMatchObject([{ state: 'completed', path: 'replacement', ended: true }]);
      expect(await terminalSessions()).toHaveLength(3);
      const events = await audit();
      expect(events.map((row) => row.event_type)).toEqual([
        'terminal_recovery_requested',
        'terminal_identity_verified',
        'terminal_replacement_started',
        'terminal_old_factor_removed',
        'terminal_new_totp_verified',
        'terminal_recovery_codes_issued',
        'terminal_sessions_revoked',
        'terminal_recovery_completed',
      ]);
      expect(events.find((row) => row.event_type === 'terminal_old_factor_removed')?.reason).toBe('absent');
      expect(events.find((row) => row.event_type === 'terminal_sessions_revoked')?.revoked_session_count).toBe(1);

      const app = await startServer();
      const cookie = await webSignIn(app, owner, run.sequence()!);
      expect(await businessStatus(app, cookie)).toEqual([200, 200]);
    });

    it('recovers a factor disabled by an abandoned web recovery', async () => {
      const owner = await ownerWithFactor();
      const app = await startServer();
      const remote = nextAddress();
      const entered = await post(
        app,
        '/api/auth/recovery/verify-code',
        { code: owner.recoveryCodes[0] },
        await webChallenge(app, owner, remote),
        remote,
      );
      const started = await post(
        app,
        '/api/auth/recovery/authenticator/start',
        { password: owner.password },
        namedCookie(entered, 'session_token'),
      );
      expect(started.statusCode).toBe(200);
      await post(app, '/api/auth/sign-out', {}, namedCookie(started, 'session_token'));
      expect(await factorState(owner.id)).toMatchObject({ enabled: false });
      expect(await eventTypes()).toContain('terminal_recovery_required');

      const run = await recover(owner);

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(run.record.steps).not.toContain('availability');
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect(await storedCodes(owner.id)).toEqual(run.record.codes[0]);
      expect((await audit()).find((row) => row.event_type === 'terminal_old_factor_removed')?.reason).toBe('removed');

      const retry = nextAddress();
      const oldCode = await post(
        app,
        '/api/auth/recovery/verify-code',
        { code: owner.recoveryCodes[1] },
        await webChallenge(app, owner, retry),
        retry,
      );
      expect(oldCode.statusCode).toBe(401);
    });

    it('replaces an unverified factor', async () => {
      const owner = await ownerWithoutFactor();
      const auth = fixtureAuth(authPool, settings);
      const signedIn = await auth.api.signInEmail({
        body: { email: owner.email, password: owner.password },
        returnHeaders: true,
      });
      const headers = new Headers({ cookie: cookiePair(signedIn.headers, 'session_token') });
      await auth.api.enableTwoFactor({ body: { password: owner.password }, headers });
      await auth.api.revokeSessions({ headers });
      expect(await factorState(owner.id)).toEqual({ enabled: false, factor_rows: 1, verified: false });

      const run = await recover(owner);

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect((await audit()).find((row) => row.event_type === 'terminal_old_factor_removed')?.reason).toBe('removed');
    });

    it('replaces a partially disabled factor and the old authenticator stops working', async () => {
      const owner = await ownerWithFactor();
      // Test-only corruption of a disposable database: the state an
      // interrupted Better Auth disable can leave behind.
      await authPool.query(`UPDATE "user" SET "twoFactorEnabled" = false WHERE id = $1`, [owner.id]);

      const run = await recover(owner);

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(run.record.steps).not.toContain('availability');
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      const app = await startServer();
      const remote = nextAddress();
      const challenge = await webChallenge(app, owner, remote);
      const old = await post(app, '/api/auth/two-factor/verify-totp', { code: await owner.totp.next() }, challenge, remote);
      expect(old.statusCode).toBe(401);
    });

    it('accepts the existing authenticator instead of a code and replaces it', async () => {
      const owner = await ownerWithFactor();
      const app = await startServer();

      const run = await recover(owner, { availability: AUTHENTICATOR_AVAILABLE });

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(run.record.steps.filter((step) => step === 'existing-code')).toHaveLength(1);
      expect(run.record.steps).not.toContain('retrieval');
      expect(run.record.steps).not.toContain('reset');
      for (const old of owner.recoveryCodes) expect(await storedCodes(owner.id)).not.toContain(old);
      expect(await eventTypes()).not.toContain('owner_emergency_mfa_reset');

      const remote = nextAddress();
      const challenge = await webChallenge(app, owner, remote);
      const old = await post(app, '/api/auth/two-factor/verify-totp', { code: await owner.totp.next() }, challenge, remote);
      expect(old.statusCode).toBe(401);
      expect(await businessStatus(app, await webSignIn(app, owner, run.sequence()!))).toEqual([200, 200]);
    });

    it('rejects incorrect and replayed new codes without enabling the factor', async () => {
      const owner = await ownerWithoutFactor();
      const captured = capturing(identity());
      let replayed = '';

      const run = await recover(
        owner,
        {
          newCode: async (attempt, sequence) => {
            if (attempt === 1) return wrongCode(sequence.secret);
            if (attempt === 2) {
              replayed = await sequence.next();
              await createTotpReplayGuard(authPool).record(owner.id, replayed);
              return replayed;
            }
            expect(await factorState(owner.id)).toMatchObject({ enabled: false });
            return sequence.next();
          },
        },
        { identity: captured.port },
      );

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(run.record.newCodePrompts).toEqual([1, 2, 3]);
      expect(replayed).toMatch(/^\d{6}$/);
      expect(captured.verifiedCodes).not.toContain(replayed);
      expect(captured.verifiedCodes).toHaveLength(2);
      expect(
        (await audit()).filter((row) => row.event_type === 'terminal_new_totp_rejected').map((row) => row.reason),
      ).toEqual(['invalid_code', 'replayed']);
    });

    it('fails closed after five incorrect new codes, revokes every session, and can be rerun', async () => {
      const owner = await ownerWithoutFactor();

      const run = await recover(owner, { newCode: (_attempt, sequence) => wrongCode(sequence.secret) });

      expect(codeOf(run.error)).toBe('totp_attempts_exhausted');
      expect(run.record.newCodePrompts).toEqual([1, 2, 3, 4, 5]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await sessionCount(owner.id)).toBe(0);
      expect(await factorState(owner.id)).toMatchObject({ enabled: false });
      expect(await runs(owner.id)).toMatchObject([{ state: 'failed', ended: true }]);
      expect(await eventTypes()).toContain('terminal_recovery_failed');

      const rerun = await recover(owner);

      expect(rerun.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(await mfaCompletedAt(owner.id)).not.toBeNull();
    });

    it('revokes every Owner session, including web sessions created before the run', async () => {
      const owner = await ownerWithFactor();
      const app = await startServer();
      const first = await webSignIn(app, owner, owner.totp);
      const second = await webSignIn(app, owner, owner.totp);
      expect(await businessStatus(app, first)).toEqual([200, 200]);
      const captured = capturing(identity());

      const run = await recover(owner, { availability: AUTHENTICATOR_AVAILABLE }, { identity: captured.port });

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(await sessionCount(owner.id)).toBe(0);
      for (const cookie of [first, second, ...captured.cookies]) {
        expect(await businessStatus(app, cookie)).toEqual([401, 401]);
      }
      expect(await terminalSessions()).toHaveLength(3);
      expect((await audit()).find((row) => row.event_type === 'terminal_sessions_revoked')).toMatchObject({
        outcome: 'success',
        revoked_session_count: 3,
      });
    });

    it('keeps business access blocked at every step until the completion transaction commits', async () => {
      const owner = await ownerWithFactor();
      const app = await startServer();
      const web = await webSignIn(app, owner, owner.totp);
      const captured = capturing(identity());
      const checks: Array<{ step: string; statuses: number[]; completedAt: Date | null }> = [];
      const probed: Step[] = ['availability', 'existing-code', 'enrollment', 'new-code', 'devices', 'codes', 'codes-ack', 'clear'];
      const at: Partial<Record<Step, () => Promise<void>>> = {};
      for (const step of probed) {
        at[step] = async () => {
          for (const cookie of [web, ...captured.cookies]) {
            checks.push({ step, statuses: await businessStatus(app, cookie), completedAt: await mfaCompletedAt(owner.id) });
          }
        };
      }

      const run = await recover(owner, { availability: AUTHENTICATOR_AVAILABLE, at }, { identity: captured.port });

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(new Set(checks.map((check) => check.step)).size).toBe(probed.length);
      for (const check of checks) {
        expect(check.statuses, check.step).toEqual([401, 401]);
        expect(check.completedAt, check.step).toBeNull();
      }
      expect(await businessStatus(app, web)).toEqual([401, 401]);
      expect(await businessStatus(app, await webSignIn(app, owner, run.sequence()!))).toEqual([200, 200]);
    });

    it('refuses to issue codes without the exact two-device acknowledgement', async () => {
      const owner = await ownerWithoutFactor();

      const run = await recover(owner, { devices: 'two devices enrolled' });

      expect(codeOf(run.error)).toBe('not_confirmed');
      expect(run.record.codes).toEqual([]);
      expect(await runs(owner.id)).toMatchObject([{ state: 'abandoned', ended: true }]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await sessionCount(owner.id)).toBe(0);
    });

    it('does not complete without the exact recovery-code acknowledgement', async () => {
      const owner = await ownerWithoutFactor();

      const run = await recover(owner, { codesAck: 'codes' });

      expect(codeOf(run.error)).toBe('not_confirmed');
      expect(run.record.steps).not.toContain('clear');
      expect(await runs(owner.id)).toMatchObject([{ state: 'abandoned', ended: true }]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await sessionCount(owner.id)).toBe(0);
      expect(await eventTypes()).not.toContain('terminal_recovery_completed');
    });

    it('refuses completion unless exactly one verified factor exists', async () => {
      const owner = await ownerWithoutFactor();

      const run = await recover(owner, {
        at: {
          // Test-only corruption of a disposable database just before completion.
          clear: async () => {
            await authPool.query(`UPDATE "user" SET "twoFactorEnabled" = false WHERE id = $1`, [owner.id]);
          },
        },
      });

      expect(codeOf(run.error)).toBe('failed');
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await runs(owner.id)).toMatchObject([{ state: 'failed', ended: true }]);
      expect(await eventTypes()).not.toContain('terminal_recovery_completed');
    });

    it('ends the run as abandoned when the operator cancels', async () => {
      const owner = await ownerWithoutFactor();

      const run = await recover(owner, { cancelAt: 'devices' });

      expect(codeOf(run.error)).toBe('cancelled');
      expect(await runs(owner.id)).toMatchObject([{ state: 'abandoned', ended: true }]);
      expect(await eventTypes()).toContain('terminal_recovery_abandoned');
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await sessionCount(owner.id)).toBe(0);
    });
  });

  describe('DEC-437 last-resort reset', () => {
    it('resets only when every recovery code is used and no authenticator is available, then re-enrols', async () => {
      const owner = await ownerWithFactor();
      await consumeEveryRecoveryCode(owner);
      const bystander = await nonOwnerWithFactor('bystander');
      const bystanderBefore = await betterAuthRowsOf(bystander.id);
      const app = await startServer();

      const run = await recover(owner);

      expect(run.result).toEqual({ status: 'completed', path: 'reset' });
      expect(run.record.steps).toEqual([
        'target',
        'email',
        'password',
        'availability',
        'reset-warning',
        'reset',
        'incident',
        'enrollment',
        'new-code',
        'devices',
        'codes',
        'codes-ack',
        'clear',
      ]);
      expect(run.record.retrieved).toEqual([]);
      const [recorded] = await runs(owner.id);
      expect(recorded).toMatchObject({ state: 'completed', path: 'reset', incident_reference: INCIDENT, ended: true });
      const events = await audit();
      expect(events.map((row) => row.event_type)).toEqual([
        'terminal_recovery_requested',
        'terminal_identity_verified',
        'owner_emergency_mfa_reset',
        'terminal_old_factor_removed',
        'terminal_replacement_started',
        'terminal_new_totp_verified',
        'terminal_recovery_codes_issued',
        'terminal_sessions_revoked',
        'terminal_recovery_completed',
      ]);
      expect(events[2]).toMatchObject({
        outcome: 'success',
        actor_user_id: owner.id,
        incident_reference: INCIDENT,
        terminal_recovery_id: recorded!.id,
      });
      expect(events[3]!.reason).toBe('removed');
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect(await storedCodes(owner.id)).toEqual(run.record.codes[0]);
      expect(await mfaCompletedAt(owner.id)).not.toBeNull();
      expect(await sessionCount(owner.id)).toBe(0);
      expect(await betterAuthRowsOf(bystander.id)).toEqual(bystanderBefore);
      expect(await mfaCompletedAt(bystander.id)).not.toBeNull();
      expect(await businessStatus(app, await webSignIn(app, owner, run.sequence()!))).toEqual([200, 200]);
    });

    it('writes Better Auth rows only through W1 and W2, once each, with parameterised values', async () => {
      const owner = await ownerWithFactor();
      await consumeEveryRecoveryCode(owner);
      dromexSql.length = 0;

      const run = await recover(owner);

      expect(run.result).toEqual({ status: 'completed', path: 'reset' });
      const writes = dromexSql.flatMap((sql) =>
        [...sql.matchAll(BETTER_AUTH_WRITE)].map((match) => `${match[1]!.toLowerCase().replace(/\s+/g, ' ')} ${match[2]}`),
      );
      expect(writes).toEqual(['update user', 'delete from twoFactor']);
      expect(dromexSql.join('\n')).not.toContain(owner.id);
      expect(dromexSql.join('\n')).not.toContain(owner.email);
    });

    it('resets when the stored codes are encrypted under a retired secret version', async () => {
      const owner = await ownerWithFactor();
      const rotated: AuthSettings = { ...settings, secrets: [{ version: 2, value: syntheticSecret() }] };

      const run = await recover(owner, {}, { identity: identity(rotated) });

      expect(run.result).toEqual({ status: 'completed', path: 'reset' });
      expect(run.record.retrieved).toEqual([]);
      expect(await storedCodes(owner.id, rotated)).toEqual(run.record.codes[0]);
    });

    it('resets an enabled flag that has no factor row', async () => {
      const owner = await ownerWithFactor();
      // Test-only corruption of a disposable database.
      await authPool.query(`DELETE FROM "twoFactor" WHERE "userId" = $1`, [owner.id]);

      const run = await recover(owner);

      expect(run.result).toEqual({ status: 'completed', path: 'reset' });
      expect((await audit()).find((row) => row.event_type === 'terminal_old_factor_removed')?.reason).toBe('absent');
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
    });

    it('refuses the reset without the exact typed confirmation, leaving the factor intact', async () => {
      const owner = await ownerWithFactor();
      await consumeEveryRecoveryCode(owner);

      const run = await recover(owner, { reset: 'reset owner mfa' });

      expect(codeOf(run.error)).toBe('not_confirmed');
      expect(run.record.steps).not.toContain('incident');
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect(await runs(owner.id)).toMatchObject([{ state: 'abandoned', ended: true }]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await eventTypes()).not.toContain('owner_emergency_mfa_reset');
      expect(await eventTypes()).toContain('terminal_recovery_abandoned');
    });

    it('refuses the reset with a malformed incident reference', async () => {
      const owner = await ownerWithFactor();
      await consumeEveryRecoveryCode(owner);

      const run = await recover(owner, { incident: 'incident 42' });

      expect(codeOf(run.error)).toBe('not_confirmed');
      expect(run.record.steps).not.toContain('enrollment');
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect(await eventTypes()).not.toContain('owner_emergency_mfa_reset');
    });

    it('refuses the reset when the factor changed after it was classified', async () => {
      const owner = await ownerWithFactor();
      await consumeEveryRecoveryCode(owner);

      const run = await recover(owner, { at: { reset: () => regenerateWithAuthenticator(owner) } });

      expect(codeOf(run.error)).toBe('factor_changed');
      expect(run.record.steps).not.toContain('enrollment');
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect(await storedCodes(owner.id)).toHaveLength(10);
      expect(await runs(owner.id)).toMatchObject([{ state: 'failed', ended: true }]);
      expect(await eventTypes()).not.toContain('owner_emergency_mfa_reset');
    });

    it('refuses the reset when the Owner is disabled after the factor was classified', async () => {
      const owner = await ownerWithFactor();
      await consumeEveryRecoveryCode(owner);

      const run = await recover(owner, {
        at: {
          reset: async () => {
            await setPrincipal(authPool, owner.id, 'disabled', true);
          },
        },
      });

      expect(codeOf(run.error)).toBe('not_eligible');
      expect(run.record.steps).not.toContain('enrollment');
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect(await eventTypes()).not.toContain('owner_emergency_mfa_reset');
    });

    it('rolls the whole reset back when its transaction fails', async () => {
      const owner = await ownerWithFactor();
      await consumeEveryRecoveryCode(owner);
      await authPool.query(`
        CREATE FUNCTION synthetic_refuse_reset() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.event_type = 'owner_emergency_mfa_reset' THEN RAISE EXCEPTION 'synthetic failure'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER synthetic_refuse_reset BEFORE INSERT ON dromex_audit_event
        FOR EACH ROW EXECUTE FUNCTION synthetic_refuse_reset();
      `);

      const run = await recover(owner);

      expect(codeOf(run.error)).toBe('failed');
      expect(await factorState(owner.id)).toEqual({ enabled: true, factor_rows: 1, verified: true });
      expect(await runs(owner.id)).toMatchObject([{ state: 'failed', path: null, incident_reference: null, ended: true }]);
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      const types = await eventTypes();
      expect(types).not.toContain('terminal_old_factor_removed');
      expect(types).toContain('terminal_recovery_failed');
    });

    it('never resets twice: an interrupted reset is completed by a supported rerun', async () => {
      const owner = await ownerWithFactor();
      await consumeEveryRecoveryCode(owner);

      const first = await recover(owner, { throwAt: 'enrollment' });

      expect(codeOf(first.error)).toBe('failed');
      expect(await factorState(owner.id)).toMatchObject({ enabled: false });
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await sessionCount(owner.id)).toBe(0);

      const rerun = await recover(owner);

      expect(rerun.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(rerun.record.steps).not.toContain('reset');
      expect((await eventTypes()).filter((type) => type === 'owner_emergency_mfa_reset')).toHaveLength(1);
    });
  });

  describe('concurrency, crashes, and reruns', () => {
    it('lets exactly one of two concurrent runs proceed', async () => {
      const owner = await ownerWithoutFactor();
      const reached = deferred();
      const release = deferred();

      const first = recover(owner, {
        at: {
          password: async () => {
            reached.release();
            await release.promise;
          },
        },
      });
      await reached.promise;
      const second = await recover(owner);
      release.release();
      const finished = await first;

      expect(codeOf(second.error)).toBe('in_progress');
      expect(second.record.steps).toEqual([]);
      expect(finished.result).toEqual({ status: 'completed', path: 'replacement' });
      expect((await eventTypes()).filter((type) => type === 'terminal_recovery_concurrent_refused')).toHaveLength(1);
      expect(await runs(owner.id)).toHaveLength(1);
    });

    it('refuses while any other process holds the recovery lock', async () => {
      const owner = await ownerWithFactor();
      const holder = await authPool.connect();
      await holder.query('SELECT pg_advisory_lock($1)', [OWNER_TERMINAL_RECOVERY_LOCK_KEY]);
      try {
        const run = await recover(owner);

        expect(codeOf(run.error)).toBe('in_progress');
        expect(run.record.steps).toEqual([]);
        expect(await mfaCompletedAt(owner.id)).not.toBeNull();
      } finally {
        await holder.query('SELECT pg_advisory_unlock($1)', [OWNER_TERMINAL_RECOVERY_LOCK_KEY]);
        holder.release();
      }
    });

    it('clears and audits a stale run left by a crashed process', async () => {
      const owner = await ownerWithoutFactor();
      const [stale] = await rows<{ id: string }>(
        `INSERT INTO dromex_terminal_recovery (user_id, state) VALUES ($1, 'enrolment_started') RETURNING id::text AS id`,
        [owner.id],
      );

      const run = await recover(owner);

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(await runs(owner.id)).toMatchObject([
        { id: stale!.id, state: 'interrupted', ended: true },
        { state: 'completed', ended: true },
      ]);
      expect((await audit()).find((row) => row.event_type === 'terminal_stale_recovery_cleared')).toMatchObject({
        actor_user_id: owner.id,
        terminal_recovery_id: stale!.id,
      });
    });

    it.each(['enrollment', 'new-code', 'devices', 'codes', 'codes-ack', 'clear'] as const)(
      'stays fail-closed after an interruption at %s and completes on a rerun',
      async (step) => {
        const owner = await ownerWithoutFactor();

        const first = await recover(owner, { throwAt: step });

        expect(codeOf(first.error)).toBe('failed');
        expect(`${String(first.error)}${(first.error as Error).stack ?? ''}`).not.toContain(owner.password);
        expect(await mfaCompletedAt(owner.id)).toBeNull();
        expect(await sessionCount(owner.id)).toBe(0);
        expect(await runs(owner.id)).toMatchObject([{ state: 'failed', ended: true }]);

        const enabled = (await factorState(owner.id)).enabled === true;
        const rerun = await recover(
          owner,
          enabled ? { availability: AUTHENTICATOR_AVAILABLE, existing: first.sequence()! } : {},
        );

        expect(rerun.result).toEqual({ status: 'completed', path: 'replacement' });
        const stored = await storedCodes(owner.id);
        for (const shown of first.record.codes.flat()) expect(stored).not.toContain(shown);
        expect(await mfaCompletedAt(owner.id)).not.toBeNull();
        expect(await sessionCount(owner.id)).toBe(0);
      },
    );

    it('refuses completion while any Owner session remains', async () => {
      const owner = await ownerWithoutFactor();
      const real = identity();
      const captured = capturing({ ...real, revokeAllSessions: async () => undefined });
      const app = await startServer();

      const run = await recover(owner, {}, { identity: captured.port });

      expect(codeOf(run.error)).toBe('session_remains');
      expect(await mfaCompletedAt(owner.id)).toBeNull();
      expect(await runs(owner.id)).toMatchObject([{ state: 'failed', ended: true }]);
      expect(await sessionCount(owner.id)).toBeGreaterThan(0);
      for (const cookie of captured.cookies) expect(await businessStatus(app, cookie)).toEqual([401, 401]);
    });
  });

  describe('secrets', () => {
    it('never leaks a password, TOTP secret, recovery code, or session token into errors or DROMEX tables', async () => {
      const owner = await ownerWithFactor();
      await consumeEveryRecoveryCode(owner);
      const failures: unknown[] = [];
      failures.push((await recover(owner, { password: `${owner.password} but wrong` })).error);
      failures.push((await recover(owner, { throwAt: 'reset-warning' })).error);
      const captured = capturing(identity());

      const run = await recover(owner, {}, { identity: captured.port });

      expect(run.result).toEqual({ status: 'completed', path: 'reset' });
      expect(failures.map(codeOf)).toEqual(['verification_failed', 'failed']);
      const canaries = [
        owner.password,
        owner.totpSecret,
        ...owner.recoveryCodes,
        ...run.record.codes.flat(),
        ...run.record.enrollments.flatMap((enrolment) => [enrolment.secret, enrolment.secret.replaceAll('-', ''), enrolment.uri]),
        ...captured.cookies.map((cookie) => cookie.slice(cookie.indexOf('=') + 1).split('.')[0]!),
      ];
      const tables = await rows<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name LIKE 'dromex\\_%' ORDER BY table_name`,
      );
      expect(tables.length).toBeGreaterThanOrEqual(10);
      let dump = '';
      for (const { table_name } of tables) {
        const [row] = await rows<{ data: string | null }>(`SELECT json_agg(t)::text AS data FROM ${table_name} t`);
        dump += row!.data ?? '';
      }
      const errors = failures.map((error) => `${String(error)}\n${(error as Error).stack ?? ''}`).join('\n');
      for (const canary of canaries) {
        expect(canary.length).toBeGreaterThan(5);
        expect(dump).not.toContain(canary);
        expect(errors).not.toContain(canary);
      }
    });
  });

  describe('web recovery interplay (checkpoint 3F-C protections)', () => {
    it('refuses to begin web recovery while a terminal run is open', async () => {
      const owner = await ownerWithFactor();
      const app = await startServer();
      const reached = deferred();
      const release = deferred();
      const pending = recover(owner, {
        at: {
          availability: async () => {
            reached.release();
            await release.promise;
          },
        },
      });
      await reached.promise;

      const remote = nextAddress();
      const response = await post(
        app,
        '/api/auth/recovery/verify-code',
        { code: owner.recoveryCodes[0] },
        await webChallenge(app, owner, remote),
        remote,
      );
      const webRecoveries = await rows(`SELECT 1 FROM dromex_owner_recovery`);
      release.release();
      const run = await pending;

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_code' });
      expect(webRecoveries).toEqual([]);
      expect(run.result).toEqual({ status: 'code_retrieved' });
    });

    it('ends an open web recovery when a terminal run begins', async () => {
      const owner = await ownerWithFactor();
      const app = await startServer();
      const remote = nextAddress();
      const entered = await post(
        app,
        '/api/auth/recovery/verify-code',
        { code: owner.recoveryCodes[0] },
        await webChallenge(app, owner, remote),
        remote,
      );
      expect(entered.statusCode).toBe(200);

      const run = await recover(owner, { availability: AUTHENTICATOR_AVAILABLE });

      expect(run.result).toEqual({ status: 'completed', path: 'replacement' });
      expect(await rows(`SELECT step, ended_at IS NOT NULL AS ended FROM dromex_owner_recovery`)).toEqual([
        { step: 'abandoned', ended: true },
      ]);
      const started = await post(
        app,
        '/api/auth/recovery/authenticator/start',
        { password: owner.password },
        namedCookie(entered, 'session_token'),
      );
      expect(started.statusCode).toBe(401);
    });

    it('refuses ordinary access for any session recorded as a terminal recovery session', async () => {
      const owner = await ownerWithFactor();
      const app = await startServer();
      const cookie = await webSignIn(app, owner, owner.totp);
      expect(await businessStatus(app, cookie)).toEqual([200, 200]);
      const [session] = await rows<{ id: string }>(`SELECT id FROM "session" WHERE "userId" = $1`, [owner.id]);
      const [run] = await rows<{ id: string }>(
        `INSERT INTO dromex_terminal_recovery (user_id, state, ended_at)
         VALUES ($1, 'completed', CURRENT_TIMESTAMP) RETURNING id::text AS id`,
        [owner.id],
      );
      await authPool.query(
        `INSERT INTO dromex_terminal_recovery_session (session_id, terminal_recovery_id) VALUES ($1, $2)`,
        [session!.id, run!.id],
      );

      expect(await businessStatus(app, cookie)).toEqual([401, 401]);
    });
  });

  describe('migration 0007 constraints', () => {
    it('allows at most one open terminal recovery per Owner', async () => {
      const owner = await ownerWithoutFactor();
      await authPool.query(`INSERT INTO dromex_terminal_recovery (user_id, state) VALUES ($1, 'identity_verified')`, [owner.id]);

      await expect(
        authPool.query(`INSERT INTO dromex_terminal_recovery (user_id, state) VALUES ($1, 'identity_verified')`, [owner.id]),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('keeps the state and the end time consistent', async () => {
      const owner = await ownerWithoutFactor();

      await expect(
        authPool.query(
          `INSERT INTO dromex_terminal_recovery (user_id, state, ended_at) VALUES ($1, 'enrolment_started', CURRENT_TIMESTAMP)`,
          [owner.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        authPool.query(`INSERT INTO dromex_terminal_recovery (user_id, state) VALUES ($1, 'completed')`, [owner.id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        authPool.query(`INSERT INTO dromex_terminal_recovery (user_id, state) VALUES ($1, 'unknown_state')`, [owner.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('requires a well-formed incident reference for a reset', async () => {
      const owner = await ownerWithoutFactor();

      await expect(
        authPool.query(`INSERT INTO dromex_terminal_recovery (user_id, state, path) VALUES ($1, 'factor_reset', 'reset')`, [
          owner.id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        authPool.query(
          `INSERT INTO dromex_terminal_recovery (user_id, state, path, incident_reference) VALUES ($1, 'factor_reset', 'reset', 'INC-1')`,
          [owner.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        authPool.query(`INSERT INTO dromex_terminal_recovery (user_id, state, path) VALUES ($1, 'identity_verified', 'retrieval')`, [
          owner.id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await authPool.query(
        `INSERT INTO dromex_terminal_recovery (user_id, state, path, incident_reference) VALUES ($1, 'factor_reset', 'reset', $2)`,
        [owner.id, INCIDENT],
      );
    });

    it('accepts every audit event type, and still refuses unknown types, malformed references, and changes', async () => {
      const owner = await ownerWithoutFactor();
      const writer = createSecurityAudit(authPool);
      for (const type of SECURITY_AUDIT_EVENT_TYPES) {
        await writer.record(
          securityEvent(type, 'success', { userId: owner.id, name: owner.name }, null, null, {
            terminalRecoveryId: '1',
            incidentReference: INCIDENT,
          }),
        );
      }

      await expect(
        authPool.query(`INSERT INTO dromex_audit_event (event_type, outcome) VALUES ('owner_password_reset', 'success')`),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        authPool.query(
          `INSERT INTO dromex_audit_event (event_type, outcome, incident_reference) VALUES ('owner_emergency_mfa_reset', 'success', 'free text')`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        authPool.query(
          `INSERT INTO dromex_audit_event (event_type, outcome, terminal_recovery_id) VALUES ('owner_emergency_mfa_reset', 'success', 0)`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(authPool.query(`UPDATE dromex_audit_event SET reason = 'changed'`)).rejects.toThrow(/append-only/);
    });
  });
});
