import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthSettings } from '../../src/auth/config.ts';
import { createSecurityAudit } from '../../src/auth/security-audit.ts';
import type { EmailMessage } from '../../src/email/message.ts';
import type { EmailSendResult, EmailTransport } from '../../src/email/result.ts';
import { createCaptureTransport, createDisabledTransport, type CaptureTransport } from '../../src/email/transport.ts';
import { createAdminInvitationService } from '../../src/invitations/admin-invitations.ts';
import { buildServer } from '../../src/server.ts';
import {
  enrollSyntheticMfa,
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  type EnrolledUser,
} from '../helpers/auth-fixtures.ts';
import { TEST_TRUSTED_ORIGIN, settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';

/**
 * Checkpoint 4B1 (DEC-440): Owner-managed Admin invitation issuance —
 * creation, resend, supersession, cancellation, expiry, delivery handoff, and
 * audit — against disposable PostgreSQL 18.6. Acceptance is not implemented.
 *
 * Every identity is synthetic, every address uses a reserved test domain,
 * every email goes to the in-memory capture transport or a scripted fake, and
 * nothing reaches a real provider.
 */

const LIST = '/api/owner/invitations';
const CREATE = '/api/owner/invitations';
const resendUrl = (id: string) => `/api/owner/invitations/${id}/resend`;
const cancelUrl = (id: string) => `/api/owner/invitations/${id}/cancel`;

const LINK_ORIGIN = 'https://app.example.test';
const FROM = { address: 'no-reply@notify.example.test', name: 'DROMEX' };
const TOKEN_LABEL = 'dromex/admin-invitation/v1\0';
const INVITATION_KEYS = ['createdAt', 'delivery', 'email', 'endedAt', 'expiresAt', 'id', 'status'];
const DELIVERY_KEYS = ['reason', 'status'];

/** A transport whose behaviour a test can change between sends. */
interface ScriptedTransport extends EmailTransport {
  capture: CaptureTransport;
  sent: EmailMessage[];
  failWith(result: EmailSendResult | 'throw' | null): void;
  reset(): void;
}

function scriptedTransport(): ScriptedTransport {
  const capture = createCaptureTransport({ environment: 'test', linkOrigin: LINK_ORIGIN });
  const sent: EmailMessage[] = [];
  let failure: EmailSendResult | 'throw' | null = null;
  return {
    kind: 'capture',
    capture,
    sent,
    failWith(result) {
      failure = result;
    },
    reset() {
      capture.clear();
      sent.splice(0);
      failure = null;
    },
    async send(message) {
      sent.push(message);
      if (failure === 'throw') throw new Error('synthetic transport crash');
      if (failure !== null) return failure;
      return capture.send(message);
    },
  };
}

let database: EphemeralDatabase;
let pool: Pool;
let settings: AuthSettings;
let owner: EnrolledUser;
let admin: EnrolledUser;
let ownerCookie: string;
let adminCookie: string;
const transport = scriptedTransport();
let app: FastifyInstance;
const logs: string[] = [];
let host = 0;
const servers: FastifyInstance[] = [];
const nextAddress = () => `203.0.113.${(host += 1)}`;

async function startServer(email: 'scripted' | 'disabled' | 'none' = 'scripted'): Promise<FastifyInstance> {
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
    ...(email === 'none'
      ? {}
      : {
          email: {
            transport: email === 'scripted' ? transport : createDisabledTransport({ environment: 'test', linkOrigin: LINK_ORIGIN }),
            from: FROM,
            replyTo: 'support@example.test',
            linkOrigin: LINK_ORIGIN,
          },
        }),
  });
  await server.ready();
  servers.push(server);
  return server;
}

function cookieFrom(response: LightMyRequestResponse, fragment: string): string {
  const header = response.headers['set-cookie'];
  const values = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const cookie = values.find((value) => value.split('=')[0]!.includes(fragment) && !/Max-Age=0/i.test(value));
  if (!cookie) throw new Error(`expected a ${fragment} cookie`);
  return cookie.split(';')[0]!;
}

async function signIn(server: FastifyInstance, user: EnrolledUser): Promise<string> {
  const address = nextAddress();
  const password = await server.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    remoteAddress: address,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json' },
    payload: { email: user.email, password: user.password },
  });
  expect(password.json()).toEqual({ mfaRequired: true });
  const totp = await server.inject({
    method: 'POST',
    url: '/api/auth/two-factor/verify-totp',
    remoteAddress: address,
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', cookie: cookieFrom(password, 'two_factor') },
    payload: { code: await user.totp.next() },
  });
  expect(totp.statusCode).toBe(200);
  return cookieFrom(totp, 'session_token');
}

function post(url: string, payload: unknown, cookie: string | null = ownerCookie, server = app) {
  return server.inject({
    method: 'POST',
    url,
    remoteAddress: '198.51.100.20',
    headers: {
      origin: TEST_TRUSTED_ORIGIN,
      'content-type': 'application/json',
      ...(cookie === null ? {} : { cookie }),
    },
    payload: payload as Record<string, unknown>,
  });
}

function list(cookie: string | null = ownerCookie, server = app) {
  return server.inject({ method: 'GET', url: LIST, headers: cookie === null ? {} : { cookie } });
}

async function rows(sql: string, values: unknown[] = []) {
  return (await pool.query(sql, values)).rows;
}

async function invitationRows(email: string) {
  return rows(
    `SELECT id::text, email, token_hash, status, supersedes_id::text, created_at, expires_at, ended_at,
            delivery_id::text, delivery_status, delivery_reason, delivery_attempts
       FROM dromex_admin_invitation WHERE email = $1 ORDER BY id`,
    [email],
  );
}

async function auditRows(invitationId?: string) {
  return rows(
    `SELECT event_type, outcome, actor_user_id, reason, invitation_id::text, client_address
       FROM dromex_audit_event
      WHERE event_type LIKE 'admin_invitation_%' ${invitationId === undefined ? '' : 'AND invitation_id = $1'}
      ORDER BY id`,
    invitationId === undefined ? [] : [invitationId],
  );
}

/** Moves an invitation's clock back, preserving its 24-hour lifetime. DROMEX's own table, disposable database. */
async function ageInvitations(email: string, seconds: number): Promise<void> {
  await pool.query(
    `UPDATE dromex_admin_invitation
        SET created_at = created_at - make_interval(secs => $2),
            expires_at = expires_at - make_interval(secs => $2)
      WHERE email = $1`,
    [email, seconds],
  );
}

function tokenFrom(message: EmailMessage): string {
  const match = /\/invitation#([A-Za-z0-9_-]{43})\b/.exec(message.text);
  if (!match) throw new Error('no invitation token in message');
  return match[1]!;
}

function hashOf(token: string): Buffer {
  return createHash('sha256').update(TOKEN_LABEL).update(token, 'utf8').digest();
}

let emailCounter = 0;
const freshEmail = (label = 'invitee') => `${label}-${(emailCounter += 1)}@invitee.example.test`;

// One disposable database, one server, and one sign-in per user for the whole
// file: TOTP replay protection allows only a few sign-ins per 30-second step.
// Sessions live in the database, so extra servers accept the same cookies.
beforeAll(async () => {
  database = await createEphemeralDatabase();
  pool = new Pool({ connectionString: database.uri });
  settings = syntheticAuthSettings();
  await migrateAuthSchema(pool);
  const ownerUser = await provisionSyntheticUser(pool, settings, 'owner');
  await setPrincipal(pool, ownerUser.id, 'active', true);
  owner = await enrollSyntheticMfa(pool, settings, ownerUser);
  const adminUser = await provisionSyntheticUser(pool, settings, 'admin');
  await setPrincipal(pool, adminUser.id, 'active', false);
  admin = await enrollSyntheticMfa(pool, settings, adminUser);
  app = await startServer();
  ownerCookie = await signIn(app, owner);
  adminCookie = await signIn(app, admin);
}, 300_000);

beforeEach(() => {
  logs.splice(0);
  transport.reset();
});

afterAll(async () => {
  await settle();
  for (const server of servers.splice(0)) await server.close();
  await pool.end();
  await database.drop();
});

describe('Owner invitation routes: authorization (DEC-428, DEC-440)', () => {
  it('refuses unauthenticated callers on every route with no database change', async () => {
    const email = freshEmail();
    for (const response of [
      await list(null),
      await post(CREATE, { email }, null),
      await post(resendUrl('1'), {}, null),
      await post(cancelUrl('1'), {}, null),
    ]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    }
    expect(await invitationRows(email)).toEqual([]);
  });

  it('refuses an active, MFA-complete Admin on every route', async () => {
    const email = freshEmail();
    const created = await post(CREATE, { email });
    const id = created.json().invitation.id as string;
    for (const response of [
      await list(adminCookie),
      await post(CREATE, { email: freshEmail() }, adminCookie),
      await post(resendUrl(id), {}, adminCookie),
      await post(cancelUrl(id), {}, adminCookie),
    ]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
    }
    expect((await invitationRows(email)).map((row) => row.status)).toEqual(['pending']);
    expect(transport.sent).toHaveLength(1);
  });

  it('refuses a state-changing request from an untrusted Origin even with an Owner session', async () => {
    const email = freshEmail();
    const response = await app.inject({
      method: 'POST',
      url: CREATE,
      headers: { origin: 'https://evil.example.test', cookie: ownerCookie, 'content-type': 'application/json' },
      payload: { email },
    });
    expect(response.statusCode).toBe(403);
    expect(await invitationRows(email)).toEqual([]);
  });

  it('refuses a disabled Owner principal at the route and at the service boundary', async () => {
    await pool.query(`UPDATE dromex_principal SET status = 'disabled' WHERE user_id = $1`, [owner.id]);
    try {
      const response = await post(CREATE, { email: freshEmail() });
      expect(response.statusCode).toBe(401);
      const service = createAdminInvitationService({ pool, audit: createSecurityAudit(pool), delivery: null });
      expect(await service.create({ userId: owner.id, name: owner.name }, freshEmail(), null)).toEqual({
        ok: false,
        error: 'forbidden',
      });
    } finally {
      await pool.query(`UPDATE dromex_principal SET status = 'active' WHERE user_id = $1`, [owner.id]);
    }
  });

  it('re-checks the Owner inside the use case, so a non-Owner caller is refused without any route', async () => {
    const service = createAdminInvitationService({ pool, audit: createSecurityAudit(pool), delivery: null });
    const email = freshEmail();
    const actor = { userId: admin.id, name: admin.name };
    expect(await service.create(actor, email, null)).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.list(actor)).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.resend(actor, '1', null)).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.cancel(actor, '1', null)).toEqual({ ok: false, error: 'forbidden' });
    expect(await invitationRows(email)).toEqual([]);
    const refusals = (await auditRows()).filter((row) => row.actor_user_id === admin.id);
    expect(refusals.every((row) => row.event_type === 'admin_invitation_refused' && row.reason === 'forbidden')).toBe(true);
    expect(refusals).toHaveLength(4);
  });

  it('refuses an Owner whose MFA completion is missing at the service boundary', async () => {
    const service = createAdminInvitationService({ pool, audit: createSecurityAudit(pool), delivery: null });
    const { rows: before } = await pool.query(`SELECT mfa_completed_at FROM dromex_principal WHERE user_id = $1`, [owner.id]);
    await pool.query(`UPDATE dromex_principal SET mfa_completed_at = NULL WHERE user_id = $1`, [owner.id]);
    try {
      expect(await service.create({ userId: owner.id, name: owner.name }, freshEmail(), null)).toEqual({
        ok: false,
        error: 'forbidden',
      });
    } finally {
      await pool.query(`UPDATE dromex_principal SET mfa_completed_at = $2 WHERE user_id = $1`, [owner.id, before[0]!.mfa_completed_at]);
    }
  });
});

describe('creating an invitation', () => {
  it('stores only the token hash, expires in 24 hours of database time, and hands one email to the transport', async () => {
    const email = freshEmail();
    const response = await post(CREATE, { email: `  ${email.toUpperCase()} ` });

    expect(response.statusCode).toBe(201);
    const { invitation } = response.json();
    expect(Object.keys(response.json())).toEqual(['invitation']);
    expect(Object.keys(invitation).sort()).toEqual(INVITATION_KEYS);
    expect(Object.keys(invitation.delivery).sort()).toEqual(DELIVERY_KEYS);
    expect(invitation).toMatchObject({
      email,
      status: 'pending',
      endedAt: null,
      delivery: { status: 'provider_accepted', reason: null },
    });
    expect(invitation.id).toMatch(/^[1-9][0-9]*$/);

    const [row] = await invitationRows(email);
    expect(row).toMatchObject({ id: invitation.id, email, status: 'pending', supersedes_id: null, delivery_status: 'provider_accepted' });
    expect(row!.token_hash).toHaveLength(32);
    expect(row!.expires_at.getTime() - row!.created_at.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(new Date(invitation.expiresAt).getTime()).toBe(row!.expires_at.getTime());
    expect(row!.delivery_attempts).toBe(1);

    expect(transport.capture.captured()).toHaveLength(1);
    const message = transport.capture.captured()[0]!;
    expect(message.to).toBe(email);
    expect(message.purpose).toBe('admin_invitation');
    expect(message.idempotencyKey).toBe(`admin_invitation/${row!.delivery_id}`);
    const token = tokenFrom(message);
    expect(hashOf(token).equals(row!.token_hash)).toBe(true);

    const body = response.body;
    for (const secret of [token, row!.token_hash.toString('hex'), row!.token_hash.toString('base64'), row!.token_hash.toString('base64url'), '/invitation#', row!.delivery_id, 'capture-']) {
      expect(body).not.toContain(secret);
    }
    const stored = JSON.stringify(await rows(`SELECT * FROM dromex_admin_invitation WHERE id = $1`, [invitation.id]));
    expect(stored).not.toContain(token);
  });

  it('audits creation and provider acceptance with a reference, never the address, token, hash, or link', async () => {
    const email = freshEmail();
    const response = await post(CREATE, { email });
    const id = response.json().invitation.id as string;
    const token = tokenFrom(transport.capture.captured()[0]!);

    expect(await auditRows(id)).toEqual([
      { event_type: 'admin_invitation_created', outcome: 'success', actor_user_id: owner.id, reason: null, invitation_id: id, client_address: '198.51.100.20' },
      { event_type: 'admin_invitation_delivery_accepted', outcome: 'success', actor_user_id: owner.id, reason: null, invitation_id: id, client_address: '198.51.100.20' },
    ]);
    const everything = JSON.stringify(await rows(`SELECT * FROM dromex_audit_event`));
    const [row] = await invitationRows(email);
    for (const secret of [email, token, row!.token_hash.toString('hex'), '/invitation#', LINK_ORIGIN]) {
      expect(everything).not.toContain(secret);
    }
    expect(logs.join('\n')).not.toContain(token);
    expect(logs.join('\n')).not.toContain(email);
  });

  it('generates a different token and hash for every invitation', async () => {
    const hashes = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      await post(CREATE, { email: freshEmail() });
    }
    for (const message of transport.capture.captured()) hashes.add(hashOf(tokenFrom(message)).toString('hex'));
    expect(hashes.size).toBe(5);
    const stored = await rows(`SELECT count(DISTINCT token_hash)::int AS n FROM dromex_admin_invitation`);
    expect(stored[0]!.n).toBe(await rows(`SELECT count(*)::int AS n FROM dromex_admin_invitation`).then((r) => r[0]!.n));
  });

  it.each([
    ['a missing email', {}],
    ['an empty email', { email: '' }],
    ['two addresses', { email: 'a@example.test,b@example.test' }],
    ['a display name', { email: 'Someone <a@example.test>' }],
    ['a header injection', { email: 'a@example.test\r\nBcc: b@example.test' }],
    ['a non-string', { email: ['a@example.test'] }],
    ['an extra field', { email: 'extra@example.test', role: 'owner' }],
  ])('refuses %s with a generic invalid_email and no row or email', async (_label, payload) => {
    const before = (await rows(`SELECT count(*)::int AS n FROM dromex_admin_invitation`))[0]!.n;
    const response = await post(CREATE, payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_email' });
    expect((await rows(`SELECT count(*)::int AS n FROM dromex_admin_invitation`))[0]!.n).toBe(before);
    expect(transport.sent).toHaveLength(0);
  });

  it('refuses an address that already belongs to an account, whatever its case', async () => {
    for (const email of [admin.email, owner.email.toUpperCase()]) {
      const response = await post(CREATE, { email });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: 'account_exists' });
    }
    expect(transport.sent).toHaveLength(0);
    const refusals = (await auditRows()).filter((row) => row.reason === 'account_exists');
    expect(refusals.length).toBeGreaterThanOrEqual(2);
    expect(refusals.every((row) => row.invitation_id === null && row.outcome === 'failure')).toBe(true);
  });

  it('allows at most one pending invitation per normalized email', async () => {
    const email = freshEmail();
    expect((await post(CREATE, { email })).statusCode).toBe(201);
    const second = await post(CREATE, { email: email.toUpperCase() });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'invitation_pending' });
    expect(await invitationRows(email)).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
  });

  it('lets exactly one of many concurrent creations for one email win', async () => {
    const email = freshEmail();
    const responses = await Promise.all(Array.from({ length: 8 }, () => post(CREATE, { email })));
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.every((status) => status === 201 || status === 409 || status === 429)).toBe(true);
    expect((await invitationRows(email)).filter((row) => row.status === 'pending')).toHaveLength(1);
    expect(await invitationRows(email)).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
  });
});

describe('delivery handoff and failure', () => {
  it('records a retryable provider failure truthfully, leaving a pending invitation that can be resent', async () => {
    const email = freshEmail();
    transport.failWith({ status: 'retryable_failure', reason: 'provider_unavailable', attempts: 3 });
    const response = await post(CREATE, { email });

    expect(response.statusCode).toBe(201);
    expect(response.json().invitation).toMatchObject({ status: 'pending', delivery: { status: 'failed', reason: 'provider_unavailable' } });
    const [row] = await invitationRows(email);
    expect(row).toMatchObject({ status: 'pending', delivery_status: 'failed', delivery_reason: 'provider_unavailable', delivery_attempts: 3 });
    expect((await auditRows(row!.id)).map((event) => [event.event_type, event.outcome, event.reason])).toEqual([
      ['admin_invitation_created', 'success', null],
      ['admin_invitation_delivery_failed', 'failure', 'provider_unavailable'],
    ]);

    transport.failWith(null);
    await ageInvitations(email, 61);
    const resent = await post(resendUrl(row!.id), {});
    expect(resent.statusCode).toBe(200);
    expect(resent.json().invitation.delivery).toEqual({ status: 'provider_accepted', reason: null });
  });

  it('records a permanent provider failure, an idempotency conflict, and a thrown transport error as failed, never delivered', async () => {
    for (const failure of [
      { status: 'permanent_failure', reason: 'provider_rejected', attempts: 1 } as const,
      { status: 'permanent_failure', reason: 'idempotency_conflict', attempts: 1 } as const,
      'throw' as const,
    ]) {
      const email = freshEmail();
      transport.failWith(failure);
      const response = await post(CREATE, { email });
      const expectedReason = failure === 'throw' ? 'unexpected_failure' : failure.reason;
      expect(response.statusCode).toBe(201);
      expect(response.json().invitation.delivery).toEqual({ status: 'failed', reason: expectedReason });
      expect(response.body).not.toContain('synthetic transport crash');
      expect((await invitationRows(email))[0]).toMatchObject({ delivery_status: 'failed', delivery_reason: expectedReason });
    }
    expect(logs.join('\n')).not.toContain('synthetic transport crash');
  });

  it('never claims delivery with the disabled transport or with no email configuration', async () => {
    for (const mode of ['disabled', 'none'] as const) {
      const server = await startServer(mode);
      const email = freshEmail(mode);
      const response = await post(CREATE, { email }, ownerCookie, server);
      expect(response.statusCode).toBe(201);
      expect(response.json().invitation.delivery).toEqual({ status: 'not_sent', reason: 'email_disabled' });
      const [row] = await invitationRows(email);
      expect(row).toMatchObject({ status: 'pending', delivery_status: 'not_sent', delivery_reason: 'email_disabled' });
      expect((await auditRows(row!.id)).at(-1)).toMatchObject({ event_type: 'admin_invitation_delivery_failed', reason: 'email_disabled' });
    }
    expect(transport.sent).toHaveLength(0);
  });

  it('uses one stable idempotency key per logical delivery and a new one for every resend', async () => {
    const email = freshEmail();
    const created = await post(CREATE, { email });
    await ageInvitations(email, 61);
    await post(resendUrl(created.json().invitation.id), {});
    const keys = transport.sent.map((message) => message.idempotencyKey);
    const deliveryIds = (await invitationRows(email)).map((row) => `admin_invitation/${row.delivery_id}`);
    expect(keys).toEqual(deliveryIds);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('resending an invitation', () => {
  it('issues a new token and immediately supersedes the previous invitation', async () => {
    const email = freshEmail();
    const created = await post(CREATE, { email });
    const oldId = created.json().invitation.id as string;
    await ageInvitations(email, 61);

    const response = await post(resendUrl(oldId), {});
    expect(response.statusCode).toBe(200);
    const { invitation } = response.json();
    expect(Object.keys(invitation).sort()).toEqual(INVITATION_KEYS);
    expect(invitation.id).not.toBe(oldId);
    expect(invitation.status).toBe('pending');

    const [oldRow, newRow] = await invitationRows(email);
    expect(oldRow).toMatchObject({ id: oldId, status: 'superseded' });
    expect(oldRow!.ended_at).toBeInstanceOf(Date);
    expect(newRow).toMatchObject({ id: invitation.id, status: 'pending', supersedes_id: oldId });
    expect(newRow!.token_hash.equals(oldRow!.token_hash)).toBe(false);
    expect(newRow!.expires_at.getTime() - newRow!.created_at.getTime()).toBe(24 * 60 * 60 * 1000);

    const [first, second] = transport.capture.captured();
    expect(hashOf(tokenFrom(first!)).equals(oldRow!.token_hash)).toBe(true);
    expect(hashOf(tokenFrom(second!)).equals(newRow!.token_hash)).toBe(true);
    expect(response.body).not.toContain(tokenFrom(second!));

    expect((await auditRows(oldId)).map((event) => event.event_type)).toEqual([
      'admin_invitation_created',
      'admin_invitation_delivery_accepted',
      'admin_invitation_superseded',
    ]);
    expect((await auditRows(invitation.id)).map((event) => event.event_type)).toEqual([
      'admin_invitation_resent',
      'admin_invitation_delivery_accepted',
    ]);
  });

  it('allows at most one issuance per 60 seconds per email, with a bounded Retry-After', async () => {
    const email = freshEmail();
    const created = await post(CREATE, { email });
    const response = await post(resendUrl(created.json().invitation.id), {});
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: 'too_many_requests' });
    const retryAfter = Number(response.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(await invitationRows(email)).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);

    await ageInvitations(email, 58);
    expect((await post(resendUrl(created.json().invitation.id), {})).statusCode).toBe(429);
    await ageInvitations(email, 3);
    expect((await post(resendUrl(created.json().invitation.id), {})).statusCode).toBe(200);
  });

  it('allows the initial invitation plus five resends per email in any 24 hours, including across cancellation', async () => {
    const email = freshEmail();
    let id = (await post(CREATE, { email })).json().invitation.id as string;
    for (let resend = 1; resend <= 5; resend += 1) {
      await ageInvitations(email, 61);
      const response = await post(resendUrl(id), {});
      expect(response.statusCode, `resend ${resend}`).toBe(200);
      id = response.json().invitation.id;
    }
    await ageInvitations(email, 61);
    const sixth = await post(resendUrl(id), {});
    expect(sixth.statusCode).toBe(429);
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(60);

    expect((await post(cancelUrl(id), {})).statusCode).toBe(200);
    await ageInvitations(email, 61);
    expect((await post(CREATE, { email })).statusCode).toBe(429);
    expect(transport.sent).toHaveLength(6);

    await ageInvitations(email, 24 * 60 * 60);
    expect((await post(CREATE, { email })).statusCode).toBe(201);
  });

  it('refuses to resend an invitation that is not pending, and hides unknown or malformed ids', async () => {
    const email = freshEmail();
    const id = (await post(CREATE, { email })).json().invitation.id as string;
    await ageInvitations(email, 61);
    const next = (await post(resendUrl(id), {})).json().invitation.id as string;
    await ageInvitations(email, 61);

    const superseded = await post(resendUrl(id), {});
    expect(superseded.statusCode).toBe(409);
    expect(superseded.json()).toEqual({ error: 'invitation_not_pending' });

    await post(cancelUrl(next), {});
    expect((await post(resendUrl(next), {})).json()).toEqual({ error: 'invitation_not_pending' });

    for (const bad of ['999999999', '0', '-1', 'abc', '1e3', '01', '9'.repeat(20)]) {
      const response = await post(resendUrl(bad), {});
      expect(response.statusCode, bad).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    }
  });

  it('serializes concurrent resends of one invitation: one new pending invitation, the rest refused', async () => {
    const email = freshEmail();
    const id = (await post(CREATE, { email })).json().invitation.id as string;
    await ageInvitations(email, 61);
    const responses = await Promise.all(Array.from({ length: 6 }, () => post(resendUrl(id), {})));
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.every((response) => [200, 409, 429].includes(response.statusCode))).toBe(true);
    const all = await invitationRows(email);
    expect(all.filter((row) => row.status === 'pending')).toHaveLength(1);
    expect(all).toHaveLength(2);
    expect(transport.sent).toHaveLength(2);
  });

  it('keeps one consistent end state when a resend races a cancellation', async () => {
    for (let round = 0; round < 4; round += 1) {
      const email = freshEmail('race');
      const id = (await post(CREATE, { email })).json().invitation.id as string;
      await ageInvitations(email, 61);
      const [resend, cancel] = await Promise.all([post(resendUrl(id), {}), post(cancelUrl(id), {})]);
      const all = await invitationRows(email);
      if (resend.statusCode === 200) {
        expect(cancel.statusCode).toBe(409);
        expect(all.map((row) => row.status)).toEqual(['superseded', 'pending']);
      } else {
        expect(cancel.statusCode).toBe(200);
        expect(resend.statusCode).toBe(409);
        expect(all.map((row) => row.status)).toEqual(['cancelled']);
      }
    }
  });
});

describe('cancelling an invitation', () => {
  it('makes the invitation permanently non-pending and audits it once', async () => {
    const email = freshEmail();
    const id = (await post(CREATE, { email })).json().invitation.id as string;
    const response = await post(cancelUrl(id), {});
    expect(response.statusCode).toBe(200);
    expect(response.json().invitation).toMatchObject({ id, status: 'cancelled' });
    expect(response.json().invitation.endedAt).not.toBeNull();

    const again = await post(cancelUrl(id), {});
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'invitation_not_pending' });
    expect((await auditRows(id)).filter((event) => event.event_type === 'admin_invitation_cancelled')).toHaveLength(1);

    await expect(
      pool.query(`UPDATE dromex_admin_invitation SET status = 'pending', ended_at = NULL WHERE id = $1`, [id]),
    ).rejects.toThrow();
  });

  it('lets a new invitation be created for the email once the cooldown has passed', async () => {
    const email = freshEmail();
    const id = (await post(CREATE, { email })).json().invitation.id as string;
    await post(cancelUrl(id), {});
    expect((await post(CREATE, { email })).statusCode).toBe(429);
    await ageInvitations(email, 61);
    expect((await post(CREATE, { email })).statusCode).toBe(201);
  });
});

describe('expiry', () => {
  it('expires a pending invitation after 24 hours of database time, audited exactly once', async () => {
    const email = freshEmail();
    const id = (await post(CREATE, { email })).json().invitation.id as string;
    await ageInvitations(email, 24 * 60 * 60 - 5);
    let listed = (await list()).json().invitations.find((invitation: { id: string }) => invitation.id === id);
    expect(listed.status).toBe('pending');

    await ageInvitations(email, 10);
    listed = (await list()).json().invitations.find((invitation: { id: string }) => invitation.id === id);
    expect(listed.status).toBe('expired');
    await list();
    expect((await invitationRows(email))[0]).toMatchObject({ status: 'expired' });
    expect((await auditRows(id)).filter((event) => event.event_type === 'admin_invitation_expired')).toHaveLength(1);

    expect((await post(resendUrl(id), {})).json()).toEqual({ error: 'invitation_not_pending' });
    expect((await post(cancelUrl(id), {})).json()).toEqual({ error: 'invitation_not_pending' });
    expect((await post(CREATE, { email })).statusCode).toBe(201);
  });

  it('reports a due invitation as expired even while another transaction holds its row', async () => {
    const email = freshEmail();
    const id = (await post(CREATE, { email })).json().invitation.id as string;
    await ageInvitations(email, 24 * 60 * 60 + 1);

    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT id FROM dromex_admin_invitation WHERE id = $1 FOR UPDATE`, [id]);
      const listed = (await list()).json().invitations.find((invitation: { id: string }) => invitation.id === id);
      expect(listed.status).toBe('expired');
      expect((await invitationRows(email))[0]).toMatchObject({ status: 'pending' });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    await list();
    expect((await invitationRows(email))[0]).toMatchObject({ status: 'expired' });
  });

  it('expires a due invitation found by resend or cancel without any list call', async () => {
    const email = freshEmail();
    const id = (await post(CREATE, { email })).json().invitation.id as string;
    await ageInvitations(email, 24 * 60 * 60 + 1);
    expect((await post(resendUrl(id), {})).statusCode).toBe(409);
    expect((await invitationRows(email))[0]).toMatchObject({ status: 'expired' });
    expect((await auditRows(id)).filter((event) => event.event_type === 'admin_invitation_expired')).toHaveLength(1);
  });
});

describe('listing invitations', () => {
  it('returns a bounded, newest-first list of safe summaries only', async () => {
    const emails = [freshEmail(), freshEmail(), freshEmail()];
    for (const email of emails) await post(CREATE, { email });
    const response = await list();
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json())).toEqual(['invitations']);
    const invitations = response.json().invitations as Array<Record<string, unknown>>;
    expect(invitations.length).toBeLessThanOrEqual(200);
    for (const invitation of invitations) {
      expect(Object.keys(invitation).sort()).toEqual(INVITATION_KEYS);
    }
    // Newest first by database creation time, ties broken by id.
    const order = invitations.map((invitation) => [Date.parse(String(invitation.createdAt)), Number(invitation.id)] as const);
    const sorted = [...order].sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    expect(order).toEqual(sorted);
    const newest = invitations.slice(0, 3).map((invitation) => invitation.email);
    expect(newest).toEqual([...emails].reverse());
    const tokens = transport.capture.captured().map(tokenFrom);
    for (const token of tokens) expect(response.body).not.toContain(token);
    // Safe delivery reason codes such as idempotency_conflict may appear; no
    // secret-bearing field or value may.
    expect(response.body).not.toMatch(/token|hash|href|invitation#|capture-|idempotencyKey|delivery_?id|admin_invitation\//i);
  });
});

describe('database constraints (migration 0008)', () => {
  async function insert(overrides: Record<string, string>) {
    const values = {
      email: `'${freshEmail('constraint')}'`,
      token_hash: `'\\x${'ab'.repeat(32)}'::bytea`,
      status: `'pending'`,
      invited_by_user_id: `'${owner.id}'`,
      expires_at: `CURRENT_TIMESTAMP + interval '24 hours'`,
      delivery_id: 'gen_random_uuid()',
      delivery_status: `'sending'`,
      ...overrides,
    };
    return pool.query(
      `INSERT INTO dromex_admin_invitation (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`,
    );
  }

  it('accepts a well-formed pending row and rejects a second pending row for its email', async () => {
    const email = `'${freshEmail('constraint')}'`;
    await insert({ email, token_hash: `'\\x${'01'.repeat(32)}'::bytea` });
    await expect(insert({ email, token_hash: `'\\x${'02'.repeat(32)}'::bytea` })).rejects.toThrow(/unique|duplicate/i);
  });

  it.each([
    ['a lifetime other than 24 hours', { expires_at: `CURRENT_TIMESTAMP + interval '25 hours'` }],
    ['a short token hash', { token_hash: `'\\x${'ab'.repeat(31)}'::bytea` }],
    ['an unknown status', { status: `'accepted_maybe'` }],
    ['an ended status without an end time', { status: `'cancelled'` }],
    ['a non-normalized email', { email: `'Upper@Example.TEST'` }],
    ['an unknown delivery status', { delivery_status: `'delivered'` }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(insert({ token_hash: `'\\x${'cd'.repeat(32)}'::bytea`, ...overrides })).rejects.toThrow();
  });

  it('rejects a reused token hash', async () => {
    await insert({ token_hash: `'\\x${'ee'.repeat(32)}'::bytea` });
    await expect(insert({ token_hash: `'\\x${'ee'.repeat(32)}'::bytea` })).rejects.toThrow(/unique|duplicate/i);
  });

  it('has no column that could hold a token, link, provider id, or message body', async () => {
    const columns = (
      await rows(`SELECT column_name FROM information_schema.columns WHERE table_name = 'dromex_admin_invitation' ORDER BY column_name`)
    ).map((row) => row.column_name as string);
    expect(columns).toEqual([
      'created_at',
      'delivery_attempts',
      'delivery_id',
      'delivery_reason',
      'delivery_status',
      'delivery_updated_at',
      'email',
      'ended_at',
      'expires_at',
      'id',
      'invited_by_user_id',
      'status',
      'supersedes_id',
      'token_hash',
    ]);
  });
});
