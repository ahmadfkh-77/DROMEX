import { Writable } from 'node:stream';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminAccountService } from '../../src/accounts/admin-accounts.ts';
import type { AuthSettings } from '../../src/auth/config.ts';
import { createSecurityAudit } from '../../src/auth/security-audit.ts';
import { createCaptureTransport } from '../../src/email/transport.ts';
import { buildServer } from '../../src/server.ts';
import {
  enrollSyntheticMfa,
  fixtureAuth,
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  type EnrolledUser,
} from '../helpers/auth-fixtures.ts';
import { TEST_TRUSTED_ORIGIN, settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

/**
 * Checkpoint 4E: Owner account and session management against disposable
 * PostgreSQL 18.6, through the real server, real Better Auth sessions, and
 * real password-plus-TOTP sign-ins. Every identity is synthetic, every address
 * uses a reserved test domain, and email goes only to the capture transport.
 */

const ACCOUNTS = '/api/owner/accounts';
const accountUrl = (id: string) => `${ACCOUNTS}/${id}`;
const disableUrl = (id: string) => `${ACCOUNTS}/${id}/disable`;
const enableUrl = (id: string) => `${ACCOUNTS}/${id}/enable`;
const revokeAllUrl = (id: string) => `${ACCOUNTS}/${id}/sessions/revoke-all`;
const revokeUrl = (id: string, ref: string) => `${ACCOUNTS}/${id}/sessions/${ref}/revoke`;

const LINK_ORIGIN = 'https://app.example.test';
const REASON = 'Synthetic reason: left the company';
const SUMMARY_KEYS = ['activeSessions', 'email', 'invitation', 'name', 'state', 'userId'];
const INVITATION_ENTRY_KEYS = ['createdAt', 'delivery', 'email', 'endedAt', 'expiresAt', 'invitationId', 'state'];
const SNAPSHOT_KEYS = ['createdAt', 'delivery', 'endedAt', 'expiresAt', 'id', 'status'];
const DETAIL_KEYS = [
  'actions',
  'email',
  'identityCreatedAt',
  'invitation',
  'lastStatusChange',
  'name',
  'sessions',
  'setupCompletedAt',
  'state',
  'userId',
];
const SESSION_KEYS = ['expiresAt', 'ref', 'signedInAt'];

let database: EphemeralDatabase;
let pool: Pool;
let settings: AuthSettings;
let app: FastifyInstance;
let owner: EnrolledUser;
let ownerCookie: string;
const logs: string[] = [];
const capture = createCaptureTransport({ environment: 'test', linkOrigin: LINK_ORIGIN });
let host = 0;
const nextAddress = () => `203.0.113.${(host += 1)}`;

/** When set, the next Better Auth session cleanup throws, as if it failed after the DROMEX commit. */
let failNextCleanup = false;

async function startServer(): Promise<FastifyInstance> {
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      logs.push(String(chunk));
      callback();
    },
  });
  const server = await buildServer({
    databaseUrl: database.uri,
    auth: settings,
    logStream,
    email: { transport: capture, from: { address: 'no-reply@notify.example.test', name: 'DROMEX' }, linkOrigin: LINK_ORIGIN },
    accountTestSeams: {
      wrapSessionControl: (control) => ({
        revokeSession: (userId, sessionId) => control.revokeSession(userId, sessionId),
        async revokeAllSessions(userId) {
          if (failNextCleanup) {
            failNextCleanup = false;
            throw new Error('synthetic cleanup failure');
          }
          return control.revokeAllSessions(userId);
        },
      }),
    },
  });
  await server.ready();
  return server;
}

function cookieFrom(response: LightMyRequestResponse, fragment: string): string {
  const header = response.headers['set-cookie'];
  const values = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const cookie = values.find((value) => value.split('=')[0]!.includes(fragment) && !/Max-Age=0/i.test(value));
  if (!cookie) throw new Error(`expected a ${fragment} cookie`);
  return cookie.split(';')[0]!;
}

function passwordStep(user: { email: string; password: string }, address: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    remoteAddress: address,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
    payload: { email: user.email, password: user.password },
  });
}

async function signIn(user: EnrolledUser): Promise<string> {
  const address = nextAddress();
  const password = await passwordStep(user, address);
  expect(password.json()).toEqual({ mfaRequired: true });
  const totp = await app.inject({
    method: 'POST',
    url: '/api/auth/two-factor/verify-totp',
    remoteAddress: address,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: cookieFrom(password, 'two_factor') },
    payload: { code: await user.totp.next() },
  });
  // On failure, name the logged error classes (names only; never messages or values).
  expect(totp.statusCode, logs.join('').match(/"errorName":"[A-Za-z]+"/g)?.slice(-5).join(' ') ?? 'no error logged').toBe(200);
  return cookieFrom(totp, 'session_token');
}

async function enrolledAdmin(label: string): Promise<EnrolledUser> {
  const user = await provisionSyntheticUser(pool, settings, label);
  await setPrincipal(pool, user.id, 'active');
  return enrollSyntheticMfa(pool, settings, user);
}

function get(url: string, cookie: string | null = ownerCookie) {
  return app.inject({ method: 'GET', url, headers: cookie === null ? {} : { cookie } });
}

function post(url: string, payload: unknown = {}, cookie: string | null = ownerCookie) {
  return app.inject({
    method: 'POST',
    url,
    remoteAddress: '198.51.100.20',
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', ...(cookie === null ? {} : { cookie }) },
    payload: payload as Record<string, unknown>,
  });
}

async function session(cookie: string): Promise<number> {
  return (await get('/api/session', cookie)).statusCode;
}

async function rows(sql: string, values: unknown[] = []) {
  return (await pool.query(sql, values)).rows;
}

async function status(userId: string): Promise<string> {
  return (await rows(`SELECT status FROM dromex_principal WHERE user_id = $1`, [userId]))[0]!.status as string;
}

async function storedSessions(userId: string): Promise<number> {
  return (await rows(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [userId]))[0]!.n as number;
}

async function accountAudit(targetUserId?: string) {
  return rows(
    `SELECT event_type, outcome, actor_user_id, reason, revoked_session_count, target_user_id, account_change_id::text
       FROM dromex_audit_event
      WHERE (event_type LIKE 'admin_account_%' OR event_type = 'owner_route_refused')
        ${targetUserId === undefined ? '' : 'AND target_user_id = $1'}
      ORDER BY id`,
    targetUserId === undefined ? [] : [targetUserId],
  );
}

async function sessionRefs(userId: string): Promise<string[]> {
  const response = await get(accountUrl(userId));
  expect(response.statusCode).toBe(200);
  return (response.json().account.sessions as Array<{ ref: string }>).map((entry) => entry.ref);
}

beforeAll(async () => {
  database = await createEphemeralDatabase();
  pool = new Pool({ connectionString: database.uri });
  await migrateAuthSchema(pool);
  settings = syntheticAuthSettings();

  const ownerUser = await provisionSyntheticUser(pool, settings, 'owner');
  await setPrincipal(pool, ownerUser.id, 'active', true);
  owner = await enrollSyntheticMfa(pool, settings, ownerUser);

  app = await startServer();
  ownerCookie = await signIn(owner);
});

afterAll(async () => {
  await settle();
  await app?.close();
  await pool?.end().catch(() => undefined);
  await database?.drop().catch(() => undefined);
});

describe('the Owner account list and detail (checkpoint 4E)', () => {
  it('lists every Admin state with safe fields only, and never the Owner', async () => {
    const active = await enrolledAdmin('list-active');
    const disabled = await enrolledAdmin('list-disabled');
    await setPrincipal(pool, disabled.id, 'disabled');

    // An invitation still pending, one expired, one cancelled, and one whose identity is mid-setup.
    const invite = async (email: string) => {
      const response = await post('/api/owner/invitations', { email });
      expect(response.statusCode).toBe(201);
      return response.json().invitation.id as string;
    };
    const pendingEmail = 'list-pending@example.test';
    await invite(pendingEmail);
    const expiredId = await invite('list-expired@example.test');
    await pool.query(
      `UPDATE dromex_admin_invitation SET created_at = created_at - interval '25 hours', expires_at = expires_at - interval '25 hours' WHERE id = $1`,
      [expiredId],
    );
    const cancelledId = await invite('list-cancelled@example.test');
    expect((await post(`/api/owner/invitations/${cancelledId}/cancel`)).statusCode).toBe(200);

    const setupEmail = 'list-setup@example.test';
    const setupInvitation = await invite(setupEmail);
    // The identity setup created, through Better Auth's own API, at the invited address.
    const created = await fixtureAuth(pool, settings).api.signUpEmail({
      body: { email: setupEmail, password: 'synthetic setup passphrase value', name: 'Synthetic Setup' },
    });
    const setupUser = { id: created.user.id };
    await pool.query(`INSERT INTO dromex_principal (user_id, status) VALUES ($1, 'pending')`, [setupUser.id]);
    await pool.query(
      `INSERT INTO dromex_admin_enrolment (email, user_id, invitation_id, step) VALUES ($1, $2, $3, 'password_verified')`,
      [setupEmail, setupUser.id, setupInvitation],
    );

    const response = await get(ACCOUNTS);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json() as { accounts: Array<Record<string, unknown>>; invitations: Array<Record<string, unknown>> };
    expect(Object.keys(body).sort()).toEqual(['accounts', 'invitations']);

    const byUser = new Map(body.accounts.map((entry) => [entry.userId, entry]));
    expect(byUser.has(owner.id)).toBe(false);
    for (const entry of body.accounts) expect(Object.keys(entry).sort()).toEqual(SUMMARY_KEYS);
    expect(byUser.get(active.id)).toMatchObject({ state: 'active', name: active.name, email: active.email, activeSessions: 0 });
    expect(byUser.get(disabled.id)).toMatchObject({ state: 'disabled', activeSessions: null });
    expect(byUser.get(setupUser.id)).toMatchObject({ state: 'enrolment_in_progress', activeSessions: null });
    const setupSnapshot = byUser.get(setupUser.id)!.invitation as Record<string, unknown>;
    expect(Object.keys(setupSnapshot).sort()).toEqual(SNAPSHOT_KEYS);
    expect(setupSnapshot).toMatchObject({ id: setupInvitation, status: 'pending' });

    const byEmail = new Map(body.invitations.map((entry) => [entry.email, entry]));
    for (const entry of body.invitations) expect(Object.keys(entry).sort()).toEqual(INVITATION_ENTRY_KEYS);
    expect(byEmail.get(pendingEmail)).toMatchObject({ state: 'invitation_pending' });
    expect(byEmail.get('list-expired@example.test')).toMatchObject({ state: 'invitation_expired' });
    expect(byEmail.get('list-cancelled@example.test')).toMatchObject({ state: 'invitation_cancelled' });
    // An address with an account appears once, as the account.
    expect(byEmail.has(setupEmail)).toBe(false);

    for (const forbidden of ['token', 'hash', 'password', 'secret', 'ipAddress', 'userAgent', 'sessionId', 'delivery_id', owner.password]) {
      expect(response.body).not.toContain(forbidden);
    }
    // Viewing is not audited.
    expect(await accountAudit()).toEqual([]);
  });

  it('shows one account in detail with a safe session summary, opaque session references, and honest timestamps', async () => {
    const admin = await enrolledAdmin('detail');
    const first = await signIn(admin);
    await signIn(admin);

    const response = await get(accountUrl(admin.id));
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const account = response.json().account as Record<string, unknown>;
    expect(Object.keys(account).sort()).toEqual(DETAIL_KEYS);
    expect(account).toMatchObject({ userId: admin.id, name: admin.name, email: admin.email, state: 'active' });
    expect(typeof account.identityCreatedAt).toBe('string');
    // No enrolment row: setup completion is honestly unknown, never invented.
    expect(account.setupCompletedAt).toBeNull();
    expect(account.invitation).toBeNull();
    expect(account.lastStatusChange).toBeNull();
    expect(account.actions).toEqual({
      disable: { available: true, reason: null },
      enable: { available: false, reason: 'account_not_disabled' },
      revokeAllSessions: { available: true, reason: null },
    });

    const sessions = account.sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(2);
    for (const entry of sessions) {
      expect(Object.keys(entry).sort()).toEqual(SESSION_KEYS);
      expect(entry.ref).toMatch(/^[0-9a-f]{32}$/);
    }
    const stored = await rows(`SELECT id, token, "ipAddress", "userAgent" FROM "session" WHERE "userId" = $1`, [admin.id]);
    for (const row of stored) {
      for (const value of [row.id, row.token, row.ipAddress, row.userAgent].filter((item) => typeof item === 'string' && item !== '')) {
        expect(response.body).not.toContain(value as string);
      }
    }
    expect(response.body).not.toContain(first.split('=')[1]!);
  });

  it('answers a missing, malformed, or Owner target without revealing anything else', async () => {
    for (const id of ['user_does_not_exist', 'bad%20id', owner.id]) {
      const response = await get(accountUrl(id));
      expect(response.statusCode, id).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    }
    // Fastify refuses an overlong path parameter before any route or account
    // lookup runs. (Its default 414 body echoes the caller's own path; that
    // server-wide behaviour predates checkpoint 4E and is recorded as deferred.)
    const overlong = await get(accountUrl('x'.repeat(300)));
    expect(overlong.statusCode).toBe(414);
  });
});

describe('who may reach account management', () => {
  it('refuses every use case to anyone but the MFA-complete Owner, even when called without the HTTP guard (DEC-428)', async () => {
    const admin = await enrolledAdmin('direct-caller');
    const target = await enrolledAdmin('direct-target');
    const targetCookie = await signIn(target);
    const service = createAdminAccountService({
      pool,
      audit: createSecurityAudit(pool),
      sessions: {
        revokeSession: async () => {
          throw new Error('must not be reached');
        },
        revokeAllSessions: async () => {
          throw new Error('must not be reached');
        },
      },
    });
    const actor = { userId: admin.id, name: admin.name };

    expect(await service.list(actor)).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.detail(actor, target.id)).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.disable(actor, target.id, REASON, null)).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.enable(actor, target.id, REASON, null)).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.revokeAllSessions(actor, target.id, null)).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.revokeSession(actor, target.id, 'a'.repeat(32), null)).toEqual({ ok: false, error: 'forbidden' });

    // An Owner whose MFA is incomplete, or a disabled Owner, is refused the same way.
    await pool.query(`UPDATE dromex_principal SET mfa_completed_at = NULL WHERE user_id = $1`, [owner.id]);
    try {
      expect(await service.disable({ userId: owner.id, name: owner.name }, target.id, REASON, null)).toEqual({
        ok: false,
        error: 'forbidden',
      });
    } finally {
      await pool.query(`UPDATE dromex_principal SET mfa_completed_at = CURRENT_TIMESTAMP - interval '1 hour' WHERE user_id = $1`, [owner.id]);
    }

    expect(await status(target.id)).toBe('active');
    expect(await session(targetCookie)).toBe(200);
    const refusals = (await accountAudit()).filter((row) => row.actor_user_id === admin.id);
    expect(refusals).toHaveLength(6);
    for (const row of refusals) expect(row).toMatchObject({ event_type: 'admin_account_action_refused', reason: 'forbidden' });
  });


  it('refuses an Admin on every account route, audits the attempt, and changes nothing', async () => {
    const admin = await enrolledAdmin('intruder');
    const victim = await enrolledAdmin('intruder-target');
    const adminCookie = await signIn(admin);
    const victimCookie = await signIn(victim);

    for (const [method, url] of [
      ['GET', ACCOUNTS],
      ['GET', accountUrl(victim.id)],
      ['POST', disableUrl(victim.id)],
      ['POST', enableUrl(victim.id)],
      ['POST', revokeAllUrl(victim.id)],
      ['POST', revokeUrl(victim.id, '0'.repeat(32))],
      ['POST', disableUrl(owner.id)],
    ] as const) {
      const response = method === 'GET' ? await get(url, adminCookie) : await post(url, { reason: REASON }, adminCookie);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
    }

    const refusals = (await accountAudit()).filter((row) => row.actor_user_id === admin.id);
    expect(refusals).toHaveLength(7);
    for (const row of refusals) {
      expect(row).toMatchObject({ event_type: 'owner_route_refused', outcome: 'failure', target_user_id: null });
    }
    expect(await status(victim.id)).toBe('active');
    expect(await session(victimCookie)).toBe(200);
    expect(await session(ownerCookie)).toBe(200);
  });

  it('refuses a missing, malformed, or foreign session, and a cross-origin write, before any account work', async () => {
    const admin = await enrolledAdmin('no-session-target');
    for (const cookie of [null, '__Secure-better-auth.session_token=forged.value', 'garbage']) {
      expect((await get(ACCOUNTS, cookie)).statusCode).toBe(401);
      expect((await post(disableUrl(admin.id), { reason: REASON }, cookie)).statusCode).toBe(401);
    }
    const foreign = await app.inject({
      method: 'POST',
      url: disableUrl(admin.id),
      headers: { origin: 'https://evil.example.test', 'content-type': 'application/json', cookie: ownerCookie },
      payload: { reason: REASON },
    });
    expect(foreign.statusCode).toBe(403);
    expect(await status(admin.id)).toBe('active');
  });
});

describe('disabling and re-enabling an Admin', () => {
  it('refuses a missing, blank, oversized, or unsafe reason, audits the refusal, and changes nothing', async () => {
    const admin = await enrolledAdmin('reason');
    const cookie = await signIn(admin);

    for (const payload of [
      {},
      { reason: '' },
      { reason: '  ' },
      { reason: 'no' },
      { reason: 'a'.repeat(501) },
      { reason: 'Left\nevent=admin_account_enabled' },
      { reason: 'Left \u202Eynapmoc' },
      { reason: REASON, extra: true },
      { reason: 42 },
    ]) {
      const response = await post(disableUrl(admin.id), payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_reason' });
    }
    expect(await status(admin.id)).toBe('active');
    expect(await session(cookie)).toBe(200);
    const audit = await accountAudit(admin.id);
    expect(audit).toHaveLength(9);
    for (const row of audit) expect(row).toMatchObject({ event_type: 'admin_account_action_refused', reason: 'invalid_reason' });
    expect(await rows(`SELECT 1 FROM dromex_account_status_change WHERE user_id = $1`, [admin.id])).toEqual([]);
  });

  it('disables in one step: status, reason, sessions, and audit together, and the Admin is locked out everywhere', async () => {
    const admin = await enrolledAdmin('disable');
    const first = await signIn(admin);
    const second = await signIn(admin);
    expect(await storedSessions(admin.id)).toBe(2);

    const response = await post(disableUrl(admin.id), { reason: `  ${REASON}  ` });
    expect(response.statusCode).toBe(200);
    expect(response.json().account).toMatchObject({
      state: 'disabled',
      sessions: [],
      lastStatusChange: { action: 'disabled', reason: REASON, changedByName: owner.name },
      actions: {
        disable: { available: false, reason: 'account_not_active' },
        enable: { available: true, reason: null },
        revokeAllSessions: { available: true, reason: null },
      },
    });

    expect(await status(admin.id)).toBe('disabled');
    expect(await storedSessions(admin.id)).toBe(0);
    expect(await session(first)).toBe(401);
    expect(await session(second)).toBe(401);

    const change = await rows(`SELECT id::text, action, reason, changed_by_user_id FROM dromex_account_status_change WHERE user_id = $1`, [
      admin.id,
    ]);
    expect(change).toEqual([{ id: expect.any(String), action: 'disabled', reason: REASON, changed_by_user_id: owner.id }]);
    expect(await accountAudit(admin.id)).toEqual([
      {
        event_type: 'admin_account_disabled',
        outcome: 'success',
        actor_user_id: owner.id,
        reason: null,
        revoked_session_count: 2,
        target_user_id: admin.id,
        account_change_id: change[0]!.id,
      },
    ]);

    // Signing in, resetting a password into access, or being invited again all stay closed.
    const refused = await passwordStep(admin, nextAddress());
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({ error: 'invalid_credentials' });
    const invitation = await post('/api/owner/invitations', { email: admin.email });
    expect(invitation.statusCode).toBe(409);
    expect(invitation.json()).toEqual({ error: 'account_exists' });
    const before = capture.captured().length;
    const reset = await app.inject({
      method: 'POST',
      url: '/api/password-reset/request',
      remoteAddress: nextAddress(),
      headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
      payload: { email: admin.email },
    });
    expect(reset.statusCode).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(capture.captured().length).toBe(before);
    expect(await rows(`SELECT 1 FROM dromex_password_reset WHERE user_id = $1`, [admin.id])).toEqual([]);

    // A second disable is refused and audited, and changes nothing.
    const again = await post(disableUrl(admin.id), { reason: REASON });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'account_not_active' });
  });

  it('re-enables with a reason, never revives an old session even when Better Auth cleanup failed, and requires a new sign-in', async () => {
    const admin = await enrolledAdmin('reenable');
    const old = await signIn(admin);

    failNextCleanup = true;
    expect((await post(disableUrl(admin.id), { reason: REASON })).statusCode).toBe(200);
    // Cleanup failed: Better Auth still stores the session, and the gate still refuses it.
    expect(await storedSessions(admin.id)).toBe(1);
    expect(await session(old)).toBe(401);
    expect((await accountAudit(admin.id)).map((row) => [row.event_type, row.outcome])).toEqual([
      ['admin_account_disabled', 'success'],
      ['admin_account_session_cleanup_incomplete', 'failure'],
    ]);

    expect((await post(enableUrl(admin.id), {})).statusCode).toBe(400);
    const enabled = await post(enableUrl(admin.id), { reason: 'Synthetic reason: returned from leave' });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().account).toMatchObject({
      state: 'active',
      lastStatusChange: { action: 'enabled', reason: 'Synthetic reason: returned from leave' },
    });
    expect(await status(admin.id)).toBe('active');
    // The old session row still exists, and re-enabling does not bring it back,
    // not even into the Owner's list of usable sessions.
    expect(await storedSessions(admin.id)).toBe(1);
    expect(await session(old)).toBe(401);
    expect(enabled.json().account.sessions).toEqual([]);

    const fresh = await signIn(admin);
    expect(await session(fresh)).toBe(200);
    expect(await session(old)).toBe(401);

    const again = await post(enableUrl(admin.id), { reason: REASON });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'account_not_disabled' });
  });

  it('never lets the Owner disable, re-enable, or sign out themselves, and audits each attempt', async () => {
    for (const [url, payload] of [
      [disableUrl(owner.id), { reason: REASON }],
      [enableUrl(owner.id), { reason: REASON }],
      [revokeAllUrl(owner.id), {}],
      [revokeUrl(owner.id, 'a'.repeat(32)), {}],
    ] as const) {
      const response = await post(url, payload);
      expect(response.statusCode, url).toBe(409);
      expect(response.json()).toEqual({ error: 'owner_protected' });
    }
    expect(await status(owner.id)).toBe('active');
    expect(await session(ownerCookie)).toBe(200);
    const audit = await accountAudit(owner.id);
    expect(audit).toHaveLength(4);
    for (const row of audit) {
      expect(row).toMatchObject({ event_type: 'admin_account_action_refused', reason: 'owner_protected', actor_user_id: owner.id });
    }
  });

  it('refuses to act on a pending identity, a missing account, or a malformed target', async () => {
    const pending = await provisionSyntheticUser(pool, settings, 'pending-target');
    await pool.query(`INSERT INTO dromex_principal (user_id, status) VALUES ($1, 'pending')`, [pending.id]);

    for (const [url, payload] of [
      [disableUrl(pending.id), { reason: REASON }],
      [revokeAllUrl(pending.id), {}],
    ] as const) {
      const response = await post(url, payload);
      expect(response.statusCode, url).toBe(409);
      expect(response.json()).toEqual({ error: 'account_not_active' });
    }
    expect((await post(enableUrl(pending.id), { reason: REASON })).json()).toEqual({ error: 'account_not_disabled' });
    expect(await status(pending.id)).toBe('pending');
    expect((await get(accountUrl(pending.id))).json().account).toMatchObject({
      state: 'enrolment_in_progress',
      sessions: [],
      actions: {
        disable: { available: false, reason: 'account_not_active' },
        enable: { available: false, reason: 'account_not_disabled' },
        revokeAllSessions: { available: false, reason: 'account_not_active' },
      },
    });

    for (const id of ['user_does_not_exist', 'bad%20id']) {
      const response = await post(disableUrl(id), { reason: REASON });
      expect(response.statusCode, id).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    }
  });
});

describe('Owner session revocation', () => {
  it('revokes exactly one selected session and leaves the others signed in', async () => {
    const admin = await enrolledAdmin('revoke-one');
    const kept = await signIn(admin);
    const before = new Set(await sessionRefs(admin.id));
    const target = await signIn(admin);
    const targetRef = (await sessionRefs(admin.id)).find((ref) => !before.has(ref))!;

    const response = await post(revokeUrl(admin.id, targetRef));
    expect(response.statusCode).toBe(200);
    expect((response.json().account.sessions as Array<{ ref: string }>).map((entry) => entry.ref)).toEqual([...before]);

    expect(await session(target)).toBe(401);
    expect(await session(kept)).toBe(200);
    expect(await storedSessions(admin.id)).toBe(1);
    expect(await accountAudit(admin.id)).toEqual([
      expect.objectContaining({ event_type: 'admin_account_session_revoked', outcome: 'success', revoked_session_count: 1 }),
    ]);

    // The same reference again, an unknown one, or a malformed one is refused.
    for (const ref of [targetRef, 'f'.repeat(32)]) {
      const again = await post(revokeUrl(admin.id, ref));
      expect(again.statusCode).toBe(404);
      expect(again.json()).toEqual({ error: 'session_not_found' });
    }
    expect((await post(revokeUrl(admin.id, 'NOT-A-REF'))).statusCode).toBe(404);
    expect(await session(kept)).toBe(200);
  });

  it('never revokes another Admin’s session through the wrong account', async () => {
    const first = await enrolledAdmin('cross-one');
    const second = await enrolledAdmin('cross-two');
    const secondCookie = await signIn(second);
    const [secondRef] = await sessionRefs(second.id);

    const response = await post(revokeUrl(first.id, secondRef!));
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'session_not_found' });
    expect(await session(secondCookie)).toBe(200);
  });

  it('revokes every session of one Admin, leaves other people alone, and allows a fresh sign-in', async () => {
    const admin = await enrolledAdmin('revoke-all');
    const bystander = await enrolledAdmin('revoke-bystander');
    const one = await signIn(admin);
    const two = await signIn(admin);
    const bystanderCookie = await signIn(bystander);

    const response = await post(revokeAllUrl(admin.id));
    expect(response.statusCode).toBe(200);
    expect(response.json().account).toMatchObject({ state: 'active', sessions: [] });
    expect(await session(one)).toBe(401);
    expect(await session(two)).toBe(401);
    expect(await session(bystanderCookie)).toBe(200);
    expect(await session(ownerCookie)).toBe(200);
    expect(await storedSessions(admin.id)).toBe(0);
    expect(await status(admin.id)).toBe('active');
    expect(await accountAudit(admin.id)).toEqual([
      expect.objectContaining({ event_type: 'admin_account_sessions_revoked', outcome: 'success', revoked_session_count: 2 }),
    ]);

    const fresh = await signIn(admin);
    expect(await session(fresh)).toBe(200);
  });
});

describe('concurrency, audit content, and logs', () => {
  it('resolves concurrent disables, re-enables, and revocations to one consistent state with no partial change', async () => {
    const admin = await enrolledAdmin('race');
    const cookie = await signIn(admin);

    const results = await Promise.all([
      post(disableUrl(admin.id), { reason: 'Synthetic race one' }),
      post(disableUrl(admin.id), { reason: 'Synthetic race two' }),
      post(revokeAllUrl(admin.id)),
      post(disableUrl(admin.id), { reason: 'Synthetic race three' }),
    ]);
    const disables = [results[0]!, results[1]!, results[3]!];
    expect(disables.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(disables.filter((response) => response.statusCode === 409)).toHaveLength(2);
    expect(results[2]!.statusCode).toBe(200);
    expect(await status(admin.id)).toBe('disabled');
    expect(await session(cookie)).toBe(401);
    const changes = await rows(`SELECT action FROM dromex_account_status_change WHERE user_id = $1`, [admin.id]);
    expect(changes).toEqual([{ action: 'disabled' }]);

    const enables = await Promise.all([
      post(enableUrl(admin.id), { reason: 'Synthetic race four' }),
      post(enableUrl(admin.id), { reason: 'Synthetic race five' }),
    ]);
    expect(enables.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(await status(admin.id)).toBe('active');
    const successes = (await accountAudit(admin.id)).filter((row) => row.outcome === 'success').map((row) => row.event_type);
    expect(successes.filter((type) => type === 'admin_account_disabled')).toHaveLength(1);
    expect(successes.filter((type) => type === 'admin_account_enabled')).toHaveLength(1);
    expect(await session(cookie)).toBe(401);
  });

  it('keeps every reason, session value, password, and code out of the audit trail and the logs', async () => {
    const admin = await enrolledAdmin('secrets');
    const cookie = await signIn(admin);
    const secretReason = 'Synthetic distinctive reason marker 7F3A';
    expect((await post(disableUrl(admin.id), { reason: secretReason })).statusCode).toBe(200);

    const audit = JSON.stringify(await rows(`SELECT * FROM dromex_audit_event`));
    const log = logs.join('');
    const sessionValue = cookie.split('=')[1]!;
    for (const secret of [secretReason, sessionValue, admin.password, owner.password, admin.email, ownerCookie.split('=')[1]!]) {
      expect(audit).not.toContain(secret);
      expect(log).not.toContain(secret);
    }
  });
});
