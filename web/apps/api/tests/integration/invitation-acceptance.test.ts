import { Writable } from 'node:stream';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthSettings } from '../../src/auth/config.ts';
import { createSecurityAudit } from '../../src/auth/security-audit.ts';
import type { EmailMessage } from '../../src/email/message.ts';
import { createCaptureTransport } from '../../src/email/transport.ts';
import {
  ACCEPTANCE_RATE_LIMITS,
  ACCEPTANCE_INTERRUPTIONS,
  createInvitationAcceptance,
  type AcceptanceInterruption,
  type InvitationAcceptance,
} from '../../src/invitations/invitation-acceptance.ts';
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
import { TotpSequence, wrongCode } from '../helpers/totp.ts';

/**
 * Checkpoint 4B2 (DEC-440 (7)-(9), DEC-442, DEC-444): restricted Admin
 * invitation acceptance against disposable PostgreSQL 18.6.
 *
 * Every identity is synthetic, every address uses a reserved test domain,
 * every invitation email goes to the in-memory capture transport, and every
 * token is taken from that captured message exactly as a browser would take
 * it from the link fragment.
 */

const LINK_ORIGIN = 'https://app.example.test';
const FROM = { address: 'no-reply@notify.example.test', name: 'DROMEX' };
const INSPECT = '/api/invitation/inspect';
const PASSWORD = '/api/invitation/password';
const TOTP = '/api/invitation/totp';
const COMPLETE = '/api/invitation/complete';
const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;

let database: EphemeralDatabase;
let pool: Pool;
let settings: AuthSettings;
let owner: EnrolledUser;
let ownerCookie: string;
let app: FastifyInstance;
const capture = createCaptureTransport({ environment: 'test', linkOrigin: LINK_ORIGIN });
const logs: string[] = [];
const responses: string[] = [];
const servers: FastifyInstance[] = [];
let host = 0;
let emailCounter = 0;

const nextAddress = () => {
  host += 1;
  return `198.18.${Math.floor(host / 250)}.${(host % 250) + 1}`;
};
const freshEmail = (label = 'invitee') => `${label}-${(emailCounter += 1)}@invitee.example.test`;
const freshPassword = () => `synthetic invitee passphrase ${Math.random().toString(36).slice(2, 12)}`;

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
    email: { transport: capture, from: FROM, replyTo: 'support@example.test', linkOrigin: LINK_ORIGIN },
  });
  await server.ready();
  servers.push(server);
  return server;
}

function setCookies(response: LightMyRequestResponse): string[] {
  const header = response.headers['set-cookie'];
  return header === undefined ? [] : Array.isArray(header) ? header : [header];
}

function cookieFrom(response: LightMyRequestResponse | string[], fragment: string): string | null {
  const values = Array.isArray(response) ? response : setCookies(response);
  const cookie = values.find((value) => value.split('=')[0]!.includes(fragment) && !/Max-Age=0/i.test(value) && value.split(';')[0]!.split('=')[1] !== '');
  return cookie === undefined ? null : cookie.split(';')[0]!;
}

function tokenFrom(message: EmailMessage | { text: string }): string {
  const match = /\/invitation#([A-Za-z0-9_-]{43})\b/.exec(message.text);
  if (!match) throw new Error('no invitation token in message');
  return match[1]!;
}

async function acceptance(url: string, payload: unknown, options: { ip: string; cookie?: string | null }) {
  const response = await app.inject({
    method: 'POST',
    url,
    remoteAddress: options.ip,
    headers: {
      origin: TEST_TRUSTED_ORIGIN,
      'content-type': 'application/json',
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    payload: payload as Record<string, unknown>,
  });
  responses.push(response.body, JSON.stringify(response.headers));
  return response;
}

async function ownerPost(url: string, payload: unknown = {}) {
  return app.inject({
    method: 'POST',
    url,
    remoteAddress: '198.51.100.20',
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: ownerCookie },
    payload: payload as Record<string, unknown>,
  });
}

/** Issues an invitation as the Owner and returns its id and the token from the captured email. */
async function invite(email: string): Promise<{ id: string; token: string }> {
  capture.clear();
  const response = await ownerPost('/api/owner/invitations', { email });
  expect(response.statusCode, response.body).toBe(201);
  const message = capture.captured().at(-1)!;
  return { id: response.json().invitation.id as string, token: tokenFrom(message) };
}

/** Moves every invitation for this email back in time, keeping its 24-hour lifetime. DROMEX's own table. */
async function ageInvitations(email: string, seconds: number): Promise<void> {
  await pool.query(
    `UPDATE dromex_admin_invitation
        SET created_at = created_at - make_interval(secs => $2), expires_at = expires_at - make_interval(secs => $2)
      WHERE email = $1`,
    [email, seconds],
  );
}

async function expireInvitation(email: string): Promise<void> {
  await ageInvitations(email, 25 * 60 * 60);
}

/** Cancels the pending invitation and issues a new one, past the 60-second issuance cooldown. */
async function reinvite(email: string): Promise<{ id: string; token: string }> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id::text FROM dromex_admin_invitation WHERE email = $1 AND status = 'pending'`, [email]);
  if (rows[0] !== undefined) expect((await ownerPost(`/api/owner/invitations/${rows[0].id}/cancel`)).statusCode).toBe(200);
  await ageInvitations(email, 61);
  return invite(email);
}

async function one<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T | undefined> {
  return (await pool.query(sql, values)).rows[0] as T | undefined;
}

async function userIds(email: string): Promise<string[]> {
  return (await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])).rows.map((row) => row.id);
}

async function principalOf(userId: string) {
  return one<{ status: string; is_owner: boolean; mfa_completed_at: Date | null }>(
    `SELECT status, is_owner, mfa_completed_at FROM dromex_principal WHERE user_id = $1`,
    [userId],
  );
}

async function enrolmentOf(email: string) {
  return one<{ id: string; step: string; user_id: string | null; invitation_id: string }>(
    `SELECT id::text, step, user_id, invitation_id::text FROM dromex_admin_enrolment WHERE email = $1`,
    [email],
  );
}

async function invitationStatus(id: string): Promise<string | undefined> {
  return (await one<{ status: string }>(`SELECT status FROM dromex_admin_invitation WHERE id = $1`, [id]))?.status;
}

async function sessionCount(userId: string): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [userId]))!.n;
}

async function factorEnabled(userId: string): Promise<boolean> {
  return (await one<{ enabled: boolean | null }>(`SELECT "twoFactorEnabled" AS enabled FROM "user" WHERE id = $1`, [userId]))?.enabled === true;
}

async function passwordHash(userId: string): Promise<string | undefined> {
  return (await one<{ password: string }>(`SELECT password FROM account WHERE "userId" = $1`, [userId]))?.password;
}

async function auditCount(type?: string): Promise<number> {
  return (
    await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM dromex_audit_event WHERE event_type LIKE 'admin_invitation_%' AND ($1::text IS NULL OR event_type = $1)`,
      [type ?? null],
    )
  )!.n;
}

async function acceptanceAudit(invitationId: string) {
  return (
    await pool.query<{ event_type: string; outcome: string; reason: string | null; actor_user_id: string | null }>(
      `SELECT event_type, outcome, reason, actor_user_id FROM dromex_audit_event
        WHERE invitation_id = $1 AND event_type NOT IN ('admin_invitation_created', 'admin_invitation_delivery_accepted')
        ORDER BY id`,
      [invitationId],
    )
  ).rows;
}

interface Invitee {
  email: string;
  password: string;
  name: string;
  userId: string;
  totp: TotpSequence;
  ip: string;
}

/** The new-identity password step. Returns the setup cookie and the enrolment material. */
async function createPassword(email: string, token: string, ip = nextAddress()) {
  const password = freshPassword();
  const response = await acceptance(PASSWORD, { token, name: 'Synthetic Invitee', password }, { ip });
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json();
  expect(body.next).toBe('verify_totp');
  const userId = (await userIds(email))[0]!;
  const secret = new URL(body.totpUri as string).searchParams.get('secret')!;
  return {
    response,
    cookie: cookieFrom(response, 'session_token')!,
    invitee: { email, password, name: 'Synthetic Invitee', userId, totp: new TotpSequence(secret), ip } satisfies Invitee,
  };
}

async function verifyEnrolment(invitee: Invitee, cookie: string) {
  const response = await acceptance(TOTP, { code: await invitee.totp.next() }, { ip: invitee.ip, cookie });
  expect(response.statusCode, response.body).toBe(200);
  return { response, cookie: cookieFrom(response, 'session_token')!, codes: response.json().recoveryCodes as string[] };
}

async function acknowledge(invitee: Invitee, cookie: string) {
  return acceptance(COMPLETE, { recoveryCodesSaved: true }, { ip: invitee.ip, cookie });
}

/** The complete, uninterrupted new-identity acceptance. */
async function acceptFully(email = freshEmail()) {
  const { id, token } = await invite(email);
  const created = await createPassword(email, token);
  const verified = await verifyEnrolment(created.invitee, created.cookie);
  const completed = await acknowledge(created.invitee, verified.cookie);
  expect(completed.statusCode, completed.body).toBe(200);
  return { invitationId: id, token, invitee: created.invitee, codes: verified.codes, setupCookie: verified.cookie };
}

async function signIn(user: { email: string; password: string; totp: TotpSequence }, ip = nextAddress()) {
  const password = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    remoteAddress: ip,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
    payload: { email: user.email, password: user.password },
  });
  if (password.statusCode !== 200) return { status: password.statusCode, cookie: null };
  const challenge = cookieFrom(password, 'two_factor');
  const totp = await app.inject({
    method: 'POST',
    url: '/api/auth/two-factor/verify-totp',
    remoteAddress: ip,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: challenge ?? '' },
    payload: { code: await user.totp.next() },
  });
  return { status: totp.statusCode, cookie: totp.statusCode === 200 ? cookieFrom(totp, 'session_token') : null };
}

async function session(cookie: string) {
  return app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
}

function service(interrupt?: (point: AcceptanceInterruption) => void | Promise<void>): InvitationAcceptance {
  return createInvitationAcceptance({
    pool,
    audit: createSecurityAudit(pool),
    settings,
    ...(interrupt === undefined ? {} : { interrupt }),
  });
}

const pairOf = (setCookie: readonly string[], fragment: string) => cookieFrom([...setCookie], fragment);

beforeAll(async () => {
  database = await createEphemeralDatabase();
  pool = new Pool({ connectionString: database.uri });
  settings = syntheticAuthSettings();
  await migrateAuthSchema(pool);
  const ownerUser = await provisionSyntheticUser(pool, settings, 'owner');
  await setPrincipal(pool, ownerUser.id, 'active', true);
  owner = await enrollSyntheticMfa(pool, settings, ownerUser);
  app = await startServer();
  const signedIn = await signIn(owner);
  expect(signedIn.status).toBe(200);
  ownerCookie = signedIn.cookie!;
}, 300_000);

beforeEach(() => {
  logs.splice(0);
  capture.clear();
});

afterAll(async () => {
  await settle();
  for (const server of servers.splice(0)) await server.close();
  await pool.end();
  await database.drop();
});

describe('new Admin identity: the complete restricted acceptance (DEC-440 (7)-(9))', () => {
  it('inspects a valid token without changing anything and asks for a new password', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const auditBefore = await auditCount();

    const response = await acceptance(INSPECT, { token }, { ip: nextAddress() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ next: 'create_password' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(setCookies(response)).toEqual([]);
    expect(await userIds(email)).toEqual([]);
    expect(await enrolmentOf(email)).toBeUndefined();
    expect(await invitationStatus(id)).toBe('pending');
    expect(await auditCount()).toBe(auditBefore);
  });

  it('creates one pending identity, binds a restricted setup session, and starts TOTP enrolment', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const { response, cookie, invitee } = await createPassword(email, token);

    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(['manualEntrySecret', 'next', 'totpUri']);
    expect(body.totpUri).toMatch(/^otpauth:\/\/totp\//);
    expect(body.manualEntrySecret).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{1,4})+$/);
    expect(response.headers['cache-control']).toBe('no-store');
    const setup = setCookies(response).find((value) => value.includes('session_token'))!;
    expect(setup).toMatch(/HttpOnly/i);
    expect(setup).toMatch(/SameSite=Lax/i);
    expect(setup).toMatch(/Secure/i);

    expect(await userIds(email)).toEqual([invitee.userId]);
    expect(await principalOf(invitee.userId)).toEqual({ status: 'pending', is_owner: false, mfa_completed_at: null });
    expect(await enrolmentOf(email)).toMatchObject({ step: 'totp_enrolling', user_id: invitee.userId, invitation_id: id });
    expect(await invitationStatus(id)).toBe('pending');
    expect(await factorEnabled(invitee.userId)).toBe(false);
    const bound = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM dromex_admin_enrolment_session s JOIN "session" b ON b.id = s.session_id WHERE b."userId" = $1 AND s.invitation_id = $2`,
      [invitee.userId, id],
    );
    expect(bound!.n).toBe(1);
    expect(cookie).toContain('session_token');

    expect(await acceptanceAudit(id)).toEqual([
      { event_type: 'admin_invitation_identity_created', outcome: 'success', reason: null, actor_user_id: invitee.userId },
      { event_type: 'admin_invitation_totp_enrolment_started', outcome: 'success', reason: null, actor_user_id: invitee.userId },
    ]);
  });

  it('verifies TOTP, issues exactly ten recovery codes once, then activates only after acknowledgement', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const created = await createPassword(email, token);
    const verified = await verifyEnrolment(created.invitee, created.cookie);

    expect(Object.keys(verified.response.json()).sort()).toEqual(['next', 'recoveryCodes']);
    expect(verified.response.json().next).toBe('acknowledge_recovery_codes');
    expect(verified.codes).toHaveLength(10);
    expect(new Set(verified.codes).size).toBe(10);
    for (const code of verified.codes) expect(code).toMatch(CANONICAL_CODE);
    expect(verified.response.headers['cache-control']).toBe('no-store');
    expect(verified.cookie).not.toBe(created.cookie);
    expect(await factorEnabled(created.invitee.userId)).toBe(true);
    expect(await enrolmentOf(email)).toMatchObject({ step: 'codes_issued' });
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending', mfa_completed_at: null });
    expect(await invitationStatus(id)).toBe('pending');

    const completed = await acknowledge(created.invitee, verified.cookie);
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ signInRequired: true });
    expect(setCookies(completed).some((value) => value.includes('session_token') && /Max-Age=0/i.test(value))).toBe(true);

    const principal = await principalOf(created.invitee.userId);
    expect(principal).toMatchObject({ status: 'active', is_owner: false });
    expect(principal!.mfa_completed_at).toBeInstanceOf(Date);
    expect(await invitationStatus(id)).toBe('accepted');
    expect(await enrolmentOf(email)).toMatchObject({ step: 'completed' });
    expect(await sessionCount(created.invitee.userId)).toBe(0);

    expect((await acceptanceAudit(id)).map((row) => row.event_type)).toEqual([
      'admin_invitation_identity_created',
      'admin_invitation_totp_enrolment_started',
      'admin_invitation_totp_verified',
      'admin_invitation_recovery_codes_issued',
      'admin_invitation_sessions_revoked',
      'admin_invitation_accepted',
    ]);
  });

  it('revokes every setup session and requires a fresh password-and-TOTP sign-in before any access', async () => {
    const { invitee, setupCookie, invitationId } = await acceptFully();

    expect((await session(setupCookie)).statusCode).toBe(401);
    const reused = await acceptance(COMPLETE, { recoveryCodesSaved: true }, { ip: invitee.ip, cookie: setupCookie });
    expect(reused.statusCode).toBe(401);
    expect(await invitationStatus(invitationId)).toBe('accepted');

    const fresh = await signIn(invitee);
    expect(fresh.status).toBe(200);
    const me = await session(fresh.cookie!);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user: { id: invitee.userId, name: 'Synthetic Invitee', email: invitee.email }, isOwner: false });
    const ownerRoute = await app.inject({ method: 'GET', url: '/api/owner/invitations', headers: { cookie: fresh.cookie! } });
    expect(ownerRoute.statusCode).toBe(403);
  });

  it('never reuses a consumed invitation: every step refuses it generically', async () => {
    const { token, invitee, invitationId } = await acceptFully();
    const ip = nextAddress();
    const auditBefore = await auditCount('admin_invitation_accepted');

    for (const [url, payload] of [
      [INSPECT, { token }],
      [PASSWORD, { token, password: invitee.password }],
      [PASSWORD, { token, name: 'Synthetic Invitee', password: freshPassword() }],
    ] as const) {
      const response = await acceptance(url, payload, { ip });
      expect(response.statusCode, url).toBe(400);
      expect(response.json()).toEqual({ error: 'invitation_invalid' });
    }
    expect(await invitationStatus(invitationId)).toBe('accepted');
    expect(await sessionCount(invitee.userId)).toBe(0);
    expect(await auditCount('admin_invitation_accepted')).toBe(auditBefore);
    const owners = await pool.query(`SELECT user_id FROM dromex_principal WHERE is_owner`);
    expect(owners.rows).toEqual([{ user_id: owner.id }]);
  });
});

describe('activation happens only after every required step', () => {
  it('refuses to complete before TOTP is verified, and before recovery codes are acknowledged', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);

    const early = await acceptance(COMPLETE, { recoveryCodesSaved: true }, { ip: created.invitee.ip, cookie: created.cookie });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: 'setup_incomplete' });
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending' });

    const verified = await verifyEnrolment(created.invitee, created.cookie);
    for (const payload of [{ recoveryCodesSaved: false }, {}, { recoveryCodesSaved: 'true' }, { recoveryCodesSaved: true, extra: 1 }]) {
      const response = await acceptance(COMPLETE, payload, { ip: created.invitee.ip, cookie: verified.cookie });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json()).toEqual({ error: 'acknowledgement_required' });
    }
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending', mfa_completed_at: null });
    expect(await enrolmentOf(email)).toMatchObject({ step: 'codes_issued' });

    expect((await acknowledge(created.invitee, verified.cookie)).statusCode).toBe(200);
  });

  it('refuses TOTP verification without a setup session, with a wrong code, and with a malformed body', async () => {
    const email = freshEmail();
    const { token, id } = await invite(email);
    const created = await createPassword(email, token);

    const noSession = await acceptance(TOTP, { code: await created.invitee.totp.next() }, { ip: created.invitee.ip });
    expect(noSession.statusCode).toBe(401);
    expect(noSession.json()).toEqual({ error: 'unauthorized' });

    const wrong = await acceptance(TOTP, { code: wrongCode(created.invitee.totp.secret) }, { ip: created.invitee.ip, cookie: created.cookie });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'invalid_code' });
    expect(await factorEnabled(created.invitee.userId)).toBe(false);
    expect(await enrolmentOf(email)).toMatchObject({ step: 'totp_enrolling' });
    expect((await acceptanceAudit(id)).at(-1)).toMatchObject({ event_type: 'admin_invitation_totp_rejected', outcome: 'failure', reason: 'invalid_code' });

    for (const payload of [{}, { code: '12345' }, { code: 123456 }, { code: '123456', trustDevice: true }]) {
      const response = await acceptance(TOTP, payload, { ip: created.invitee.ip, cookie: created.cookie });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
    }
    expect(await enrolmentOf(email)).toMatchObject({ step: 'totp_enrolling' });
    await verifyEnrolment(created.invitee, created.cookie);
  });

  it('refuses a session that is not a setup session, including the Owner, at every session step', async () => {
    for (const url of [TOTP, COMPLETE]) {
      const response = await acceptance(url, url === TOTP ? { code: '123456' } : { recoveryCodesSaved: true }, {
        ip: nextAddress(),
        cookie: ownerCookie,
      });
      expect(response.statusCode, url).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
      expect(setCookies(response)).toEqual([]);
    }
    expect((await session(ownerCookie)).statusCode).toBe(200);
  });
});

describe('pending principals fail closed everywhere (DEC-444 (1), (4))', () => {
  it('refuses every protected route to a setup session', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);
    const verified = await verifyEnrolment(created.invitee, created.cookie);

    for (const cookie of [created.cookie, verified.cookie]) {
      expect((await session(cookie)).statusCode).toBe(401);
      const list = await app.inject({ method: 'GET', url: '/api/owner/invitations', headers: { cookie } });
      expect(list.statusCode).toBe(401);
      const create = await app.inject({
        method: 'POST',
        url: '/api/owner/invitations',
        headers: { cookie, origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
        payload: { email: freshEmail() },
      });
      expect(create.statusCode).toBe(401);
    }
  });

  it('refuses ordinary sign-in before and after the factor is verified, creating no ordinary session', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);

    const before = await signIn(created.invitee);
    expect(before.status).toBe(401);
    expect(before.cookie).toBeNull();

    const verified = await verifyEnrolment(created.invitee, created.cookie);
    const sessionsAfterVerify = await sessionCount(created.invitee.userId);
    const after = await signIn(created.invitee);
    expect(after.status).toBe(401);
    expect(after.cookie).toBeNull();
    expect(await sessionCount(created.invitee.userId)).toBe(sessionsAfterVerify);
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending' });

    expect((await acknowledge(created.invitee, verified.cookie)).statusCode).toBe(200);
  });

  it('refuses any session ever bound to invitation setup, even once the principal is active', async () => {
    const { invitee, invitationId } = await acceptFully();
    const fresh = await signIn(invitee);
    expect((await session(fresh.cookie!)).statusCode).toBe(200);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM "session" WHERE "userId" = $1`, [invitee.userId]);
    const enrolment = await enrolmentOf(invitee.email);
    // DROMEX's own table, in a disposable database: simulate a binding that survived.
    await pool.query(`INSERT INTO dromex_admin_enrolment_session (session_id, enrolment_id, invitation_id) VALUES ($1, $2, $3)`, [
      rows[0]!.id,
      enrolment!.id,
      invitationId,
    ]);
    expect((await session(fresh.cookie!)).statusCode).toBe(401);
  });

  it('refuses a pending principal at the principal gate itself, whatever its sessions', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);
    const { requireActivePrincipal, createPrincipalRepository, PrincipalAccessDeniedError } = await import('../../src/auth/principal.ts');
    await expect(requireActivePrincipal(createPrincipalRepository(pool), created.invitee.userId)).rejects.toBeInstanceOf(
      PrincipalAccessDeniedError,
    );
    expect((await createPrincipalRepository(pool).findByUserId(created.invitee.userId))?.status).toBe('pending');
  });
});

describe('invitation validity is re-checked at every state-changing step (DEC-444 (3))', () => {
  it('refuses an expired token at inspection and at password creation, ending the invitation once and creating nothing', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    await expireInvitation(email);
    const ip = nextAddress();

    const inspected = await acceptance(INSPECT, { token }, { ip });
    expect(inspected.statusCode).toBe(400);
    expect(inspected.json()).toEqual({ error: 'invitation_invalid' });
    const created = await acceptance(PASSWORD, { token, name: 'Synthetic Invitee', password: freshPassword() }, { ip });
    expect(created.statusCode).toBe(400);
    expect(created.json()).toEqual({ error: 'invitation_invalid' });

    expect(await invitationStatus(id)).toBe('expired');
    expect(await userIds(email)).toEqual([]);
    expect(await enrolmentOf(email)).toBeUndefined();
    const events = await acceptanceAudit(id);
    expect(events.filter((row) => row.event_type === 'admin_invitation_expired')).toHaveLength(1);
    expect(events.filter((row) => row.event_type === 'admin_invitation_acceptance_refused').map((row) => row.reason)).toEqual([
      'invitation_expired',
      'invitation_expired',
    ]);
  });

  it('stops TOTP enrolment when the invitation expired after the password step, revoking setup sessions', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const created = await createPassword(email, token);
    await expireInvitation(email);

    const response = await acceptance(TOTP, { code: await created.invitee.totp.next() }, { ip: created.invitee.ip, cookie: created.cookie });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invitation_invalid' });
    expect(setCookies(response).some((value) => value.includes('session_token') && /Max-Age=0/i.test(value))).toBe(true);
    expect(await factorEnabled(created.invitee.userId)).toBe(false);
    expect(await enrolmentOf(email)).toMatchObject({ step: 'totp_enrolling' });
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending' });
    expect(await sessionCount(created.invitee.userId)).toBe(0);
    expect(await invitationStatus(id)).toBe('expired');
  });

  it('stops activation when the invitation expired after recovery codes, preserving the verified factor', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const created = await createPassword(email, token);
    const verified = await verifyEnrolment(created.invitee, created.cookie);
    await expireInvitation(email);

    const response = await acknowledge(created.invitee, verified.cookie);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invitation_invalid' });
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending', mfa_completed_at: null });
    expect(await factorEnabled(created.invitee.userId)).toBe(true);
    expect(await enrolmentOf(email)).toMatchObject({ step: 'codes_issued' });
    expect(await invitationStatus(id)).toBe('expired');
    expect(await sessionCount(created.invitee.userId)).toBe(0);
  });

  it.each([
    ['after_identity_created', 'the identity is associated with a pending principal'],
    ['after_totp_enabled', 'TOTP enrolment is recorded'],
    ['after_totp_verified', 'recovery codes are issued'],
    ['after_sessions_revoked', 'the principal is activated'],
  ] as const)('stops without activating when the invitation expires at %s, before %s', async (point, _before) => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const expireAt = (reached: AcceptanceInterruption) => (reached === point ? expireInvitation(email) : undefined);
    const accept = service(expireAt);
    const ip = nextAddress();
    const password = freshPassword();

    const created = await accept.setPassword({ token, name: 'Synthetic Invitee', password }, ip);
    let outcome: { ok: boolean } = created;
    if (created.ok && created.next === 'verify_totp') {
      const userId = (await userIds(email))[0]!;
      const totp = new TotpSequence(new URL(created.totpUri).searchParams.get('secret')!);
      const verified = await accept.verifyTotp(
        { sessionCookie: pairOf(created.setCookies, 'session_token'), challengeCookie: null, code: await totp.next() },
        ip,
      );
      outcome = verified;
      if (verified.ok) {
        outcome = await accept.complete({ sessionCookie: pairOf(verified.setCookies, 'session_token'), acknowledged: true }, ip);
      }
      expect(await principalOf(userId)).toMatchObject({ status: 'pending', mfa_completed_at: null });
      expect(await sessionCount(userId)).toBe(0);
    }

    expect(outcome).toEqual({ ok: false, error: 'invitation_invalid' });
    expect(await invitationStatus(id)).toBe('expired');
    const ids = await userIds(email);
    expect(ids.length).toBeLessThanOrEqual(1);
    if (ids[0] !== undefined) expect((await principalOf(ids[0]))?.status ?? 'none').not.toBe('active');
  });
});

describe('cancelled, superseded, malformed, and replayed invitations', () => {
  it('refuses a cancelled token generically and audits the refusal with its reason', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    expect((await ownerPost(`/api/owner/invitations/${id}/cancel`)).statusCode).toBe(200);

    const response = await acceptance(INSPECT, { token }, { ip: nextAddress() });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invitation_invalid' });
    expect((await acceptanceAudit(id)).at(-1)).toMatchObject({ event_type: 'admin_invitation_acceptance_refused', reason: 'invitation_cancelled' });
  });

  it('refuses a superseded token and accepts only the newest one', async () => {
    const email = freshEmail();
    const first = await invite(email);
    await ageInvitations(email, 61);
    capture.clear();
    const resent = await ownerPost(`/api/owner/invitations/${first.id}/resend`);
    expect(resent.statusCode).toBe(200);
    const second = tokenFrom(capture.captured().at(-1)!);

    const old = await acceptance(PASSWORD, { token: first.token, name: 'Synthetic Invitee', password: freshPassword() }, { ip: nextAddress() });
    expect(old.statusCode).toBe(400);
    expect(old.json()).toEqual({ error: 'invitation_invalid' });
    expect(await userIds(email)).toEqual([]);
    expect((await acceptanceAudit(first.id)).at(-1)).toMatchObject({ reason: 'invitation_superseded' });

    const current = await acceptance(INSPECT, { token: second }, { ip: nextAddress() });
    expect(current.json()).toEqual({ next: 'create_password' });
  });

  it('stops setup when the Owner cancels or resends during it, and the old setup session reaches nothing', async () => {
    for (const action of ['cancel', 'resend'] as const) {
      const email = freshEmail();
      const { id, token } = await invite(email);
      const created = await createPassword(email, token);
      await ageInvitations(email, 61);
      expect((await ownerPost(`/api/owner/invitations/${id}/${action}`)).statusCode).toBe(200);

      const response = await acceptance(TOTP, { code: await created.invitee.totp.next() }, { ip: created.invitee.ip, cookie: created.cookie });
      expect(response.statusCode, action).toBe(400);
      expect(response.json()).toEqual({ error: 'invitation_invalid' });
      expect(await factorEnabled(created.invitee.userId)).toBe(false);
      expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending' });
      expect(await sessionCount(created.invitee.userId)).toBe(0);
    }
  });

  it.each([
    ['a missing token', {}],
    ['an empty token', { token: '' }],
    ['a short token', { token: 'abc' }],
    ['a token with padding', { token: `${'A'.repeat(43)}=` }],
    ['a token of the wrong alphabet', { token: `${'A'.repeat(42)}+` }],
    ['a non-string token', { token: ['x'] }],
    ['an extra field', { token: 'A'.repeat(43), role: 'owner' }],
  ])('refuses %s at inspection without auditing or changing anything', async (_label, payload) => {
    const auditBefore = await auditCount();
    const response = await acceptance(INSPECT, payload, { ip: nextAddress() });
    expect(response.statusCode).toBe(400);
    expect(['invitation_invalid', 'invalid_request']).toContain(response.json().error);
    expect(await auditCount()).toBe(auditBefore);
  });

  it('refuses a well-formed unknown token exactly like an ended one, without auditing it', async () => {
    const auditBefore = await auditCount();
    const response = await acceptance(INSPECT, { token: 'Q'.repeat(43) }, { ip: nextAddress() });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invitation_invalid' });
    expect(await auditCount()).toBe(auditBefore);
  });

  it('treats a replayed password step as a safe retry: the same identity, proven by the same password', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const first = await createPassword(email, token);

    const retried = await acceptance(PASSWORD, { token, password: first.invitee.password }, { ip: first.invitee.ip });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().next).toBe('verify_totp');
    expect(await userIds(email)).toEqual([first.invitee.userId]);
    // The earlier setup session does not survive a new password step.
    const stale = await acceptance(TOTP, { code: '123456' }, { ip: first.invitee.ip, cookie: first.cookie });
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toEqual({ error: 'unauthorized' });
    const newSecret = new URL(retried.json().totpUri).searchParams.get('secret')!;
    const invitee = { ...first.invitee, totp: new TotpSequence(newSecret) };
    const verified = await verifyEnrolment(invitee, cookieFrom(retried, 'session_token')!);
    expect((await acknowledge(invitee, verified.cookie)).statusCode).toBe(200);
  });
});

describe('re-inviting a pending identity resumes it after password proof (DEC-444 (2))', () => {
  it('lets the Owner re-invite a pending identity but not a completed active or disabled account', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    await createPassword(email, token);
    const again = await reinvite(email);
    expect(again.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const { invitee } = await acceptFully();
    await ageInvitations(invitee.email, 61);
    const active = await ownerPost('/api/owner/invitations', { email: invitee.email });
    expect(active.statusCode).toBe(409);
    expect(active.json()).toEqual({ error: 'account_exists' });

    await pool.query(`UPDATE dromex_principal SET status = 'disabled' WHERE user_id = $1`, [invitee.userId]);
    const disabled = await ownerPost('/api/owner/invitations', { email: invitee.email });
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json()).toEqual({ error: 'account_exists' });
  });

  it('still refuses an address whose identity has no principal and no invitation setup', async () => {
    const stray = await provisionSyntheticUser(pool, settings, 'stray');
    const response = await ownerPost('/api/owner/invitations', { email: stray.email });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'account_exists' });
  });

  it('resumes the same identity with the correct password and a new TOTP enrolment', async () => {
    const email = freshEmail();
    const { token, id: oldId } = await invite(email);
    const created = await createPassword(email, token);
    const hashBefore = await passwordHash(created.invitee.userId);
    const next = await reinvite(email);

    const inspected = await acceptance(INSPECT, { token: next.token }, { ip: nextAddress() });
    expect(inspected.json()).toEqual({ next: 'confirm_password' });
    const resumed = await acceptance(PASSWORD, { token: next.token, password: created.invitee.password }, { ip: nextAddress() });
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.json().next).toBe('verify_totp');

    expect(await userIds(email)).toEqual([created.invitee.userId]);
    expect(await passwordHash(created.invitee.userId)).toBe(hashBefore);
    expect(await enrolmentOf(email)).toMatchObject({ invitation_id: next.id, step: 'totp_enrolling' });
    expect(await invitationStatus(oldId)).toBe('cancelled');
    expect((await acceptanceAudit(next.id)).map((row) => row.event_type)).toContain('admin_invitation_identity_resumed');

    const invitee = { ...created.invitee, totp: new TotpSequence(new URL(resumed.json().totpUri).searchParams.get('secret')!) };
    const verified = await verifyEnrolment(invitee, cookieFrom(resumed, 'session_token')!);
    expect((await acknowledge(invitee, verified.cookie)).statusCode).toBe(200);
    expect(await invitationStatus(next.id)).toBe('accepted');
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'active' });
  });

  it('refuses a wrong password without any change, and never lets a new invitation replace the password', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);
    const hashBefore = await passwordHash(created.invitee.userId);
    const next = await reinvite(email);
    const sessionsBefore = await sessionCount(created.invitee.userId);

    const wrong = await acceptance(PASSWORD, { token: next.token, password: freshPassword() }, { ip: nextAddress() });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'invalid_password' });
    expect(setCookies(wrong)).toEqual([]);

    // The forgotten-password case: offering a new name and password is only another failed proof (checkpoint 4C owns reset).
    const replacement = freshPassword();
    const forgotten = await acceptance(PASSWORD, { token: next.token, name: 'Synthetic Invitee', password: replacement }, { ip: nextAddress() });
    expect(forgotten.statusCode).toBe(401);
    expect(forgotten.json()).toEqual({ error: 'invalid_password' });

    expect(await passwordHash(created.invitee.userId)).toBe(hashBefore);
    expect(await userIds(email)).toEqual([created.invitee.userId]);
    // No session was created by a failed proof. The earlier setup session is
    // refused on its next use, because its invitation was cancelled.
    expect(await sessionCount(created.invitee.userId)).toBe(sessionsBefore);
    const stale = await acceptance(TOTP, { code: await created.invitee.totp.next() }, { ip: nextAddress(), cookie: created.cookie });
    expect(stale.statusCode).toBe(400);
    expect(await sessionCount(created.invitee.userId)).toBe(0);
    expect(await enrolmentOf(email)).toMatchObject({ invitation_id: expect.any(String), step: 'totp_enrolling' });
    expect((await acceptanceAudit(next.id)).filter((row) => row.event_type === 'admin_invitation_password_rejected')).toHaveLength(2);

    const stillOld = await acceptance(PASSWORD, { token: next.token, password: created.invitee.password }, { ip: nextAddress() });
    expect(stillOld.statusCode).toBe(200);
  });

  it('resumes an identity whose factor was already verified through a TOTP challenge and a fresh recovery-code set', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);
    const first = await verifyEnrolment(created.invitee, created.cookie);
    const firstCodes = first.codes;
    const next = await reinvite(email);

    const resumed = await acceptance(PASSWORD, { token: next.token, password: created.invitee.password }, { ip: created.invitee.ip });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toEqual({ next: 'verify_existing_totp' });
    const challenge = cookieFrom(resumed, 'two_factor');
    expect(challenge).not.toBeNull();
    expect(cookieFrom(resumed, 'session_token')).toBeNull();
    expect(await enrolmentOf(email)).toMatchObject({ step: 'factor_challenge', invitation_id: next.id });

    // The setup session issued under the older invitation still exists, but reaches nothing now.
    const stale = await acknowledge(created.invitee, first.cookie);
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toEqual({ error: 'unauthorized' });
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending' });

    const wrongCodeResponse = await acceptance(
      TOTP,
      { code: wrongCode(created.invitee.totp.secret), password: created.invitee.password, token: next.token },
      { ip: created.invitee.ip, cookie: challenge },
    );
    expect(wrongCodeResponse.statusCode).toBe(401);
    expect(wrongCodeResponse.json()).toEqual({ error: 'invalid_code' });

    const again = await acceptance(PASSWORD, { token: next.token, password: created.invitee.password }, { ip: created.invitee.ip });
    const verified = await acceptance(
      TOTP,
      { code: await created.invitee.totp.next(), password: created.invitee.password, token: next.token },
      { ip: created.invitee.ip, cookie: cookieFrom(again, 'two_factor') },
    );
    expect(verified.statusCode, verified.body).toBe(200);
    const codes = verified.json().recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(firstCodes).not.toContain(code);
    expect(await enrolmentOf(email)).toMatchObject({ step: 'codes_issued' });

    const completed = await acknowledge(created.invitee, cookieFrom(verified, 'session_token')!);
    expect(completed.statusCode).toBe(200);
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'active' });
    expect((await signIn(created.invitee)).status).toBe(200);
  });

  it('refuses a TOTP code that was already accepted, on the existing-factor path', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);
    const code = await created.invitee.totp.next();
    const enrolled = await acceptance(TOTP, { code }, { ip: created.invitee.ip, cookie: created.cookie });
    expect(enrolled.statusCode).toBe(200);
    const next = await reinvite(email);

    const resumed = await acceptance(PASSWORD, { token: next.token, password: created.invitee.password }, { ip: created.invitee.ip });
    expect(resumed.json()).toEqual({ next: 'verify_existing_totp' });
    const replayed = await acceptance(TOTP, { code, password: created.invitee.password, token: next.token }, { ip: created.invitee.ip, cookie: cookieFrom(resumed, 'two_factor') });
    expect(replayed.statusCode).toBe(401);
    expect(replayed.json()).toEqual({ error: 'invalid_code' });
    expect(await sessionCount(created.invitee.userId)).toBe(0);
    expect(await enrolmentOf(email)).toMatchObject({ step: 'factor_challenge' });
  });

  it('refuses the existing-factor path with a wrong password even after a correct code, revoking the session it produced', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);
    await verifyEnrolment(created.invitee, created.cookie);
    const next = await reinvite(email);

    const resumed = await acceptance(PASSWORD, { token: next.token, password: created.invitee.password }, { ip: created.invitee.ip });
    const response = await acceptance(
      TOTP,
      { code: await created.invitee.totp.next(), password: freshPassword(), token: next.token },
      { ip: created.invitee.ip, cookie: cookieFrom(resumed, 'two_factor') },
    );
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'invalid_password' });
    expect(await sessionCount(created.invitee.userId)).toBe(0);
    expect(await enrolmentOf(email)).toMatchObject({ step: 'factor_challenge' });
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending' });
  });

  it('audits a resume attempt for an invitation with no enrolment, without a secret, and never per rate-limited retry', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const ip = nextAddress();
    const code = '123456';
    const cookie = '__Secure-better-auth.two_factor=synthetic-challenge-value';

    const first = await acceptance(TOTP, { code, password: freshPassword(), token }, { ip, cookie });
    expect(first.statusCode).toBe(401);
    expect(first.json()).toEqual({ error: 'unauthorized' });
    expect(first.headers['set-cookie']).toBeUndefined();
    expect(await acceptanceAudit(id)).toEqual([
      { event_type: 'admin_invitation_acceptance_refused', outcome: 'failure', reason: 'not_eligible', actor_user_id: null },
    ]);

    // The source limit bounds the rows: attempts past it are refused as 429 and record nothing.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < ACCEPTANCE_RATE_LIMITS.totpPerSource.max + 3; attempt += 1) {
      statuses.push((await acceptance(TOTP, { code, password: freshPassword(), token }, { ip, cookie })).statusCode);
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(4);
    const rows = await acceptanceAudit(id);
    expect(rows.length).toBeLessThanOrEqual(ACCEPTANCE_RATE_LIMITS.totpPerSource.max);
    const stored = JSON.stringify(
      (await pool.query(`SELECT * FROM dromex_audit_event WHERE invitation_id = $1`, [id])).rows,
    );
    for (const secret of [token, code, cookie, 'synthetic-challenge-value']) expect(stored).not.toContain(secret);
  });

  it('checks the invitation before Better Auth verifies a code: a cancelled invitation consumes nothing and ends the setup', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);
    await verifyEnrolment(created.invitee, created.cookie);
    const next = await reinvite(email);
    const resumed = await acceptance(PASSWORD, { token: next.token, password: created.invitee.password }, { ip: created.invitee.ip });
    expect(resumed.json()).toEqual({ next: 'verify_existing_totp' });

    // The older setup session still exists but is inert; a refused attempt must add none.
    const sessionsBefore = await sessionCount(created.invitee.userId);
    const replaysBefore = await one<{ n: number }>(`SELECT count(*)::int AS n FROM dromex_totp_replay WHERE user_id = $1`, [created.invitee.userId]);
    expect((await ownerPost(`/api/owner/invitations/${next.id}/cancel`)).statusCode).toBe(200);
    const response = await acceptance(
      TOTP,
      { code: await created.invitee.totp.next(), password: created.invitee.password, token: next.token },
      { ip: created.invitee.ip, cookie: cookieFrom(resumed, 'two_factor') },
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invitation_invalid' });
    expect(setCookies(response).every((value) => /Max-Age=0/i.test(value))).toBe(true);
    expect(await sessionCount(created.invitee.userId)).toBe(sessionsBefore);
    const replaysAfter = await one<{ n: number }>(`SELECT count(*)::int AS n FROM dromex_totp_replay WHERE user_id = $1`, [created.invitee.userId]);
    expect(replaysAfter!.n).toBe(replaysBefore!.n);
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'pending' });
  });

  it('limits codes per enrolment before Better Auth verifies one, so the next attempt is refused even with the right code', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);
    await verifyEnrolment(created.invitee, created.cookie);
    const next = await reinvite(email);
    const resumed = await acceptance(PASSWORD, { token: next.token, password: created.invitee.password }, { ip: created.invitee.ip });
    const challenge = cookieFrom(resumed, 'two_factor');
    const sessionsBefore = await sessionCount(created.invitee.userId);

    const attempt = async (code: string) =>
      acceptance(TOTP, { code, password: created.invitee.password, token: next.token }, { ip: created.invitee.ip, cookie: challenge });
    // The first enrolment's own verification already used one of the enrolment's attempts.
    const remaining = ACCEPTANCE_RATE_LIMITS.totpPerEnrolment.max - 1;
    for (let count = 0; count < remaining; count += 1) {
      expect((await attempt(wrongCode(created.invitee.totp.secret))).statusCode).toBe(401);
    }
    const limited = await attempt(await created.invitee.totp.next());
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'too_many_requests' });
    expect(await sessionCount(created.invitee.userId)).toBe(sessionsBefore);
    expect(await enrolmentOf(email)).toMatchObject({ step: 'factor_challenge' });
    const rejected = (await acceptanceAudit(next.id)).filter((row) => row.event_type === 'admin_invitation_totp_rejected');
    expect(rejected).toHaveLength(remaining);
  });
});

describe('interruption after each major transition is recoverable and never activates', () => {
  it('names every interruption point the workflow exposes', () => {
    expect([...ACCEPTANCE_INTERRUPTIONS]).toEqual([
      'after_intent_recorded',
      'after_identity_created',
      'after_identity_recorded',
      'after_session_bound',
      'after_totp_enabled',
      'after_totp_verified',
      'after_codes_generated',
      'after_sessions_revoked',
    ]);
  });

  it.each(ACCEPTANCE_INTERRUPTIONS.map((point) => [point]))('recovers from a crash at %s with one identity and one activation', async (point) => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const crashing = service((reached) => {
      if (reached === point) throw new Error('synthetic crash');
    });
    const ip = nextAddress();
    const password = freshPassword();
    let totp: TotpSequence | null = null;

    let crashed = false;
    try {
      const created = await crashing.setPassword({ token, name: 'Synthetic Invitee', password }, ip);
      if (created.ok && created.next === 'verify_totp') {
        totp = new TotpSequence(new URL(created.totpUri).searchParams.get('secret')!);
        const verified = await crashing.verifyTotp(
          { sessionCookie: pairOf(created.setCookies, 'session_token'), challengeCookie: null, code: await totp.next() },
          ip,
        );
        if (verified.ok) await crashing.complete({ sessionCookie: pairOf(verified.setCookies, 'session_token'), acknowledged: true }, ip);
      }
    } catch (error) {
      crashed = String(error).includes('synthetic crash');
    }
    expect(crashed).toBe(true);

    const idsAfterCrash = await userIds(email);
    expect(idsAfterCrash.length).toBeLessThanOrEqual(1);
    if (idsAfterCrash[0] !== undefined) expect((await principalOf(idsAfterCrash[0]))?.status ?? 'none').not.toBe('active');
    expect(await invitationStatus(id)).toBe('pending');

    // Resume through the ordinary routes with the same, still valid invitation.
    const inspected = await acceptance(INSPECT, { token }, { ip });
    const resumed =
      inspected.json().next === 'create_password'
        ? await acceptance(PASSWORD, { token, name: 'Synthetic Invitee', password }, { ip })
        : await acceptance(PASSWORD, { token, password }, { ip });
    expect(resumed.statusCode, resumed.body).toBe(200);
    const userId = (await userIds(email))[0]!;

    let finalCookie: string;
    let invitee: Invitee;
    if (resumed.json().next === 'verify_totp') {
      invitee = { email, password, name: 'Synthetic Invitee', userId, ip, totp: new TotpSequence(new URL(resumed.json().totpUri).searchParams.get('secret')!) };
      finalCookie = (await verifyEnrolment(invitee, cookieFrom(resumed, 'session_token')!)).cookie;
    } else {
      // The factor was verified before the crash, so the crashing run's authenticator is the enrolled one.
      expect(resumed.json()).toEqual({ next: 'verify_existing_totp' });
      expect(totp).not.toBeNull();
      invitee = { email, password, name: 'Synthetic Invitee', userId, ip, totp: totp! };
      const verified = await acceptance(TOTP, { code: await totp!.next(), password, token }, { ip, cookie: cookieFrom(resumed, 'two_factor') });
      expect(verified.statusCode, verified.body).toBe(200);
      finalCookie = cookieFrom(verified, 'session_token')!;
    }
    expect((await acknowledge(invitee, finalCookie)).statusCode).toBe(200);
    expect(await userIds(email)).toEqual([userId]);
    expect(await principalOf(userId)).toMatchObject({ status: 'active' });
    expect(await invitationStatus(id)).toBe('accepted');
    expect(await auditCount('admin_invitation_accepted')).toBeGreaterThan(0);
  });
});

describe('concurrency', () => {
  it('creates exactly one identity from concurrent password steps for one invitation', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const password = freshPassword();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => acceptance(PASSWORD, { token, name: 'Synthetic Invitee', password }, { ip: nextAddress() })),
    );
    const statuses = results.map((response) => response.statusCode);
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
    expect(await userIds(email)).toHaveLength(1);
    const principals = await one<{ n: number }>(`SELECT count(*)::int AS n FROM dromex_principal WHERE user_id = $1`, [(await userIds(email))[0]]);
    expect(principals!.n).toBe(1);
  });

  it('activates exactly once when completion is submitted concurrently', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const created = await createPassword(email, token);
    const verified = await verifyEnrolment(created.invitee, created.cookie);
    const before = await auditCount('admin_invitation_accepted');

    const results = await Promise.all(Array.from({ length: 5 }, () => acknowledge(created.invitee, verified.cookie)));
    const statuses = results.map((response) => response.statusCode);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.every((status) => [200, 401, 409].includes(status))).toBe(true);
    expect(await auditCount('admin_invitation_accepted')).toBe(before + 1);
    expect(await invitationStatus(id)).toBe('accepted');
    expect(await principalOf(created.invitee.userId)).toMatchObject({ status: 'active' });
  });
});

describe('rate limits use the database-backed mechanism and add no audit rows when limited', () => {
  it('limits token checks per network source', async () => {
    const ip = nextAddress();
    const email = freshEmail();
    const { token } = await invite(email);
    const auditBefore = await auditCount();
    const statuses: number[] = [];
    for (let index = 0; index < 10; index += 1) statuses.push((await acceptance(INSPECT, { token }, { ip })).statusCode);
    expect(statuses).toEqual(Array(10).fill(200));
    const limited = await acceptance(INSPECT, { token }, { ip });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'too_many_requests' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(await auditCount()).toBe(auditBefore);
    const stored = await one<{ n: number }>(`SELECT count(*)::int AS n FROM dromex_rate_limit WHERE key LIKE $1`, [`%${ip}%`]);
    expect(stored!.n).toBeGreaterThan(0);

    // The limit survives a new server process, because it lives in PostgreSQL.
    const other = await startServer();
    const again = await other.inject({
      method: 'POST',
      url: INSPECT,
      remoteAddress: ip,
      headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
      payload: { token },
    });
    expect(again.statusCode).toBe(429);
  });

  it('limits password proofs per invitation across network sources, auditing only the attempts it allowed', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const created = await createPassword(email, token);
    const next = await reinvite(email);

    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await acceptance(PASSWORD, { token: next.token, password: freshPassword() }, { ip: nextAddress() })).statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect((await acceptanceAudit(next.id)).filter((row) => row.event_type === 'admin_invitation_password_rejected')).toHaveLength(5);
    const correct = await acceptance(PASSWORD, { token: next.token, password: created.invitee.password }, { ip: nextAddress() });
    expect(correct.statusCode).toBe(429);
  });

  it('limits TOTP attempts per enrolment, which Better Auth does not limit on its enrolment path', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    const created = await createPassword(email, token);
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await acceptance(TOTP, { code: wrongCode(created.invitee.totp.secret) }, { ip: nextAddress(), cookie: created.cookie });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect((await acceptanceAudit(id)).filter((row) => row.event_type === 'admin_invitation_totp_rejected')).toHaveLength(5);
    const correct = await acceptance(TOTP, { code: await created.invitee.totp.next() }, { ip: nextAddress(), cookie: created.cookie });
    expect(correct.statusCode).toBe(429);
    expect(await factorEnabled(created.invitee.userId)).toBe(false);
  });
});

describe('Owner protection and duplicate-email protection', () => {
  it('refuses to attach an invitation to an address that became an active account after issuance, creating no session', async () => {
    const email = freshEmail();
    const { id, token } = await invite(email);
    // An identity created outside acceptance after the invitation was issued (for example by a fixture or a later account path).
    const created = await fixtureAuth(pool, settings).api.signUpEmail({
      body: { name: 'Synthetic Other', email, password: freshPassword() },
    });
    await setPrincipal(pool, created.user.id, 'active', false);

    const inspected = await acceptance(INSPECT, { token }, { ip: nextAddress() });
    expect(inspected.statusCode).toBe(400);
    expect(inspected.json()).toEqual({ error: 'invitation_invalid' });
    const response = await acceptance(PASSWORD, { token, password: freshPassword() }, { ip: nextAddress() });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invitation_invalid' });
    expect(await userIds(email)).toEqual([created.user.id]);
    expect(await sessionCount(created.user.id)).toBe(0);
    expect(await principalOf(created.user.id)).toMatchObject({ status: 'active', is_owner: false });
    expect((await acceptanceAudit(id)).at(-1)).toMatchObject({ reason: 'not_eligible' });
    expect(await enrolmentOf(email)).toBeUndefined();
  });

  it('refuses an identity with no principal that invitation setup did not create', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const stray = await fixtureAuth(pool, settings).api.signUpEmail({
      body: { name: 'Synthetic Stray', email, password: freshPassword() },
    });
    const response = await acceptance(PASSWORD, { token, password: freshPassword() }, { ip: nextAddress() });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invitation_invalid' });
    expect(await principalOf(stray.user.id)).toBeUndefined();
    expect(await sessionCount(stray.user.id)).toBe(0);
  });

  it('never touches the Owner: no invitation can target the Owner, and the Owner principal is unchanged by every acceptance', async () => {
    const response = await ownerPost('/api/owner/invitations', { email: owner.email });
    expect(response.json()).toEqual({ error: 'account_exists' });
    expect(await principalOf(owner.id)).toMatchObject({ status: 'active', is_owner: true });
    expect((await session(ownerCookie)).statusCode).toBe(200);
  });

  it('enforces password policy and a plain display name for a new identity before creating anything', async () => {
    const email = freshEmail();
    const { token } = await invite(email);
    const ip = nextAddress();
    for (const [payload, error] of [
      [{ token, name: 'Synthetic Invitee', password: 'too short' }, 'password_rejected'],
      [{ token, name: 'Synthetic Invitee', password: 'x'.repeat(129) }, 'password_rejected'],
      [{ token, name: '', password: freshPassword() }, 'invalid_name'],
      [{ token, name: 'someone@example.test', password: freshPassword() }, 'invalid_name'],
      [{ token, name: 'Line\nBreak', password: freshPassword() }, 'invalid_name'],
      [{ token, password: freshPassword() }, 'invalid_name'],
    ] as const) {
      const result = await acceptance(PASSWORD, payload, { ip });
      expect(result.statusCode, JSON.stringify(payload)).toBe(400);
      expect(result.json()).toEqual({ error });
    }
    expect(await userIds(email)).toEqual([]);
  });
});

describe('redaction: no secret leaves through a response, log, audit row, or DROMEX table', () => {
  it('keeps tokens, passwords, TOTP secrets, recovery codes, cookies, and addresses out of every channel', async () => {
    responses.splice(0);
    logs.splice(0);
    const { invitationId, token, invitee, codes, setupCookie } = await acceptFully();
    const secret = invitee.totp.secret;
    const cookieValue = setupCookie.split('=')[1]!;

    const bodies = responses.filter((_, index) => index % 2 === 0).join('\n');
    const logText = logs.join('\n');
    const audit = JSON.stringify((await pool.query(`SELECT * FROM dromex_audit_event`)).rows);
    const dromex = [
      'dromex_admin_enrolment',
      'dromex_admin_enrolment_session',
      'dromex_admin_invitation',
      'dromex_principal',
      'dromex_rate_limit',
      'dromex_totp_replay',
    ].map((table) => table);
    let dromexText = '';
    for (const table of dromex) dromexText += JSON.stringify((await pool.query(`SELECT * FROM ${table}`)).rows);

    for (const value of [token, invitee.password, cookieValue, secret, ...codes]) {
      expect(logText).not.toContain(value);
      expect(audit).not.toContain(value);
      expect(dromexText).not.toContain(value);
    }
    expect(bodies).not.toContain(token);
    expect(bodies).not.toContain(invitee.password);
    expect(audit).not.toContain(invitee.email);
    expect(logText).not.toContain(invitee.email);
    expect(logText).not.toMatch(/\/invitation#/);
    expect(await invitationStatus(invitationId)).toBe('accepted');
  });
});
