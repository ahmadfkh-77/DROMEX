import { chmod, mkdtemp, open as openFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthSettings } from '../../src/auth/config.ts';
import { loadRuntimeConfig, type RuntimeConfig } from '../../src/config/runtime.ts';
import { RESEND_EMAILS_ENDPOINT, type ResendDependencies } from '../../src/email/resend.ts';
import type { SecretFileOpener } from '../../src/email/secret-file.ts';
import type { PasswordResetService } from '../../src/password-reset/password-reset.ts';
import { buildServerFromConfig } from '../../src/server.ts';
import {
  enrollSyntheticMfa,
  migrateAuthSchema,
  provisionSyntheticUser,
  setPrincipal,
  type EnrolledUser,
} from '../helpers/auth-fixtures.ts';
import { TEST_BASE_URL, TEST_TRUSTED_ORIGIN, settle, syntheticSecret } from '../helpers/auth-settings.ts';
import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/db.ts';
import { LINK_ORIGIN, fakeResendEnvironment, jsonResponse, syntheticApiKey, timeoutError } from '../helpers/email.ts';

/**
 * Checkpoint 4D (DEC-489): the email configuration path of the running server,
 * end to end against disposable PostgreSQL 18.6. Configuration is parsed from
 * an explicit environment object exactly as the entry point parses
 * `process.env`, the delivery is built once by `buildServerFromConfig`, and
 * the Resend transport talks only to a scripted in-memory `fetch`. Every key,
 * address, and identity is synthetic; nothing reaches a real provider.
 *
 * The Resend cases read a real synthetic key file through the secure loader,
 * which refuses Windows by design, so they run on POSIX (the disposable
 * Node 24.20.0 Linux container).
 */

const POSIX = process.platform !== 'win32';
const SENDER = 'no-reply@notify.example.test';
const REPLY_TO = 'support@example.test';
const NEW_PASSWORD = 'a brand new synthetic passphrase';

interface ProviderCall {
  url: string;
  headers: Headers;
  rawBody: string;
  body: { from: string; to: string; reply_to?: string; subject: string; text: string; html: string };
}

type Reply = (call: ProviderCall, index: number) => Response | Error;

let database: EphemeralDatabase;
let pool: Pool;
let settings: AuthSettings;
let directory: string | undefined;
let service: PasswordResetService | undefined;
const servers: FastifyInstance[] = [];
let addressCounter = 0;

function nextAddress(): string {
  addressCounter += 1;
  return `198.51.100.${(addressCounter % 250) + 1}`;
}

function environment(extra: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: database.uri,
    DROMEX_ENVIRONMENT: 'test',
    DROMEX_AUTH_SECRETS: `1:${settings.secrets[0]!.value}`,
    DROMEX_AUTH_BASE_URL: TEST_BASE_URL,
    DROMEX_AUTH_TRUSTED_ORIGINS: `${TEST_TRUSTED_ORIGIN},${LINK_ORIGIN}`,
    ...extra,
  };
}

async function keyFile(key: string): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), 'dromex-email-runtime-'));
  const path = join(directory, `resend-key-${servers.length}`);
  await writeFile(path, `${key}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

function resendEnvironment(path: string): Record<string, string> {
  return environment({
    DROMEX_EMAIL_TRANSPORT: 'resend',
    DROMEX_EMAIL_RESEND_API_KEY_FILE: path,
    DROMEX_EMAIL_FROM_ADDRESS: SENDER,
    DROMEX_EMAIL_FROM_NAME: 'DROMEX',
    DROMEX_EMAIL_REPLY_TO: REPLY_TO,
    DROMEX_EMAIL_LINK_ORIGIN: LINK_ORIGIN,
  });
}

/** A scripted provider: every request is recorded; `reply` decides each response. */
function scriptedProvider(reply: Reply = () => jsonResponse(200, { id: crypto.randomUUID() })) {
  const base = fakeResendEnvironment([]);
  const calls: ProviderCall[] = [];
  const dependencies: ResendDependencies = {
    ...base.dependencies,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const rawBody = String(init?.body ?? '');
      const call: ProviderCall = { url: String(input), headers: new Headers(init?.headers), rawBody, body: JSON.parse(rawBody) };
      calls.push(call);
      const outcome = reply(call, calls.length - 1);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }) as typeof fetch,
  };
  return { dependencies, calls, sleeps: base.sleeps };
}

function logCollector() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => lines.join('') };
}

interface Started {
  app: FastifyInstance;
  opened: string[];
  logs: () => string;
}

async function start(config: RuntimeConfig, resend?: Partial<ResendDependencies>): Promise<Started> {
  const opened: string[] = [];
  const open: SecretFileOpener = async (path, flags) => {
    opened.push(path);
    return openFile(path, flags);
  };
  const logs = logCollector();
  const app = await buildServerFromConfig(config, {
    logStream: logs.stream,
    secretFile: { open },
    ...(resend === undefined ? {} : { resend }),
    passwordResetTestSeams: {
      expose: (exposed) => {
        service = exposed;
      },
    },
  });
  await app.ready();
  servers.push(app);
  return { app, opened, logs: logs.text };
}

function post(app: FastifyInstance, url: string, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url,
    remoteAddress: nextAddress(),
    headers: { origin: TEST_TRUSTED_ORIGIN, 'content-type': 'application/json', ...headers },
    payload: payload as Record<string, unknown>,
  });
}

function liveCookie(response: LightMyRequestResponse, fragment: string): string {
  const header = response.headers['set-cookie'];
  const values = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const cookie = values.find((value) => value.split('=')[0]!.includes(fragment) && !/Max-Age=0/i.test(value));
  if (!cookie) throw new Error(`expected a ${fragment} cookie`);
  return cookie.split(';')[0]!;
}

async function signIn(app: FastifyInstance, user: EnrolledUser): Promise<string> {
  const first = await post(app, '/api/auth/sign-in/email', { email: user.email, password: user.password });
  expect(first.json()).toEqual({ mfaRequired: true });
  const verified = await post(app, '/api/auth/two-factor/verify-totp', { code: await user.totp.next() }, {
    cookie: liveCookie(first, 'two_factor'),
  });
  expect(verified.statusCode).toBe(200);
  return liveCookie(verified, 'session_token');
}

async function activeUser(label: string, isOwner = false): Promise<EnrolledUser> {
  const user = await provisionSyntheticUser(pool, settings, label);
  await setPrincipal(pool, user.id, 'active', isOwner);
  return enrollSyntheticMfa(pool, settings, user);
}

function freshEmail(label: string): string {
  return `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;
}

async function invitationRow(email: string) {
  const { rows } = await pool.query<{ status: string; delivery_status: string; delivery_reason: string | null; delivery_attempts: number; delivery_id: string }>(
    `SELECT status, delivery_status, delivery_reason, delivery_attempts, delivery_id::text
       FROM dromex_admin_invitation WHERE email = $1 ORDER BY id DESC LIMIT 1`,
    [email],
  );
  return rows[0]!;
}

async function resetRow(userId: string) {
  const { rows } = await pool.query<{ status: string; delivery_status: string; delivery_reason: string | null; delivery_attempts: number }>(
    `SELECT status, delivery_status, delivery_reason, delivery_attempts
       FROM dromex_password_reset WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  return rows[0];
}

async function auditReasons(prefix: string): Promise<Array<{ event_type: string; reason: string | null }>> {
  const { rows } = await pool.query<{ event_type: string; reason: string | null }>(
    `SELECT event_type, reason FROM dromex_audit_event WHERE event_type LIKE $1 ORDER BY id`,
    [`${prefix}%`],
  );
  return rows;
}

beforeEach(async () => {
  database = await createEphemeralDatabase();
  pool = new Pool({ connectionString: database.uri });
  settings = { environment: 'test', secrets: [{ version: 1, value: syntheticSecret() }], baseURL: TEST_BASE_URL, trustedOrigins: [TEST_TRUSTED_ORIGIN, LINK_ORIGIN], allowInsecureCookies: false };
  await migrateAuthSchema(pool);
  service = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settle();
  while (servers.length > 0) await servers.pop()!.close();
  await pool?.end().catch(() => undefined);
  await database?.drop().catch(() => undefined);
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('email disabled through the running configuration (DEC-489)', () => {
  it('records invitations and resets honestly as not sent, contacts nothing, and grants nothing', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network must not be used');
    });
    const config = loadRuntimeConfig(environment());
    expect(config.email).toEqual({ kind: 'disabled' });
    const { app, opened, logs } = await start(config);
    expect(opened).toEqual([]);

    const owner = await activeUser('disabled-owner', true);
    const cookie = await signIn(app, owner);
    const invitee = freshEmail('disabled-invitee');
    const created = await post(app, '/api/owner/invitations', { email: invitee }, { cookie });
    expect(created.statusCode).toBe(201);
    expect(created.json().invitation).toMatchObject({ status: 'pending', delivery: { status: 'not_sent', reason: 'email_disabled' } });
    expect(await invitationRow(invitee)).toMatchObject({ status: 'pending', delivery_status: 'not_sent', delivery_reason: 'email_disabled', delivery_attempts: 0 });
    expect((await pool.query(`SELECT 1 FROM "user" WHERE lower(email) = $1`, [invitee])).rowCount).toBe(0);

    const member = await activeUser('disabled-member');
    const reset = await post(app, '/api/password-reset/request', { email: member.email });
    expect(reset.statusCode).toBe(202);
    await service!.drain();
    expect(await resetRow(member.id)).toMatchObject({ status: 'issued', delivery_status: 'not_sent', delivery_reason: 'email_disabled', delivery_attempts: 0 });
    expect(await auditReasons('password_reset_delivery')).toEqual([{ event_type: 'password_reset_delivery_failed', reason: 'email_disabled' }]);

    expect(network).not.toHaveBeenCalled();
    expect(logs()).toContain('"emailDelivery":"disabled"');
    expect(logs()).not.toMatch(/\b(?:was|were|has been|have been) sent\b|\bdelivered\b/i);
  });
});

describe.runIf(POSIX)('Resend configured through the running configuration (DEC-489, synthetic key file)', () => {
  it('sends invitation, reset, and password-changed emails through the one configured transport and identity', async () => {
    const key = syntheticApiKey();
    const path = await keyFile(key);
    const provider = scriptedProvider();
    const { app, opened, logs } = await start(loadRuntimeConfig(resendEnvironment(path)), provider.dependencies);
    expect(opened).toEqual([path]);
    expect(provider.calls).toEqual([]);

    const owner = await activeUser('resend-owner', true);
    const cookie = await signIn(app, owner);
    const invitee = freshEmail('resend-invitee');
    // A hostile Host header must never shape a link (DEC-442).
    const created = await post(app, '/api/owner/invitations', { email: invitee }, { cookie, host: 'evil.example' });
    expect(created.json().invitation).toMatchObject({ status: 'pending', delivery: { status: 'provider_accepted', reason: null } });

    const member = await activeUser('resend-member');
    expect((await post(app, '/api/password-reset/request', { email: member.email }, { host: 'evil.example' })).statusCode).toBe(202);
    await service!.drain();
    const resetCall = provider.calls.at(-1)!;
    const token = /\/reset-password#([A-Za-z0-9_-]{43})/.exec(resetCall.body.text)?.[1];
    expect(token).toBeDefined();
    expect((await post(app, '/api/password-reset/complete', { token, newPassword: NEW_PASSWORD })).statusCode).toBe(200);
    await service!.drain();

    expect(provider.calls).toHaveLength(3);
    const [invitation, resetEmail, changed] = provider.calls;
    for (const call of provider.calls) {
      expect(call.url).toBe(RESEND_EMAILS_ENDPOINT);
      expect(call.headers.get('authorization')).toBe(`Bearer ${key}`);
      expect(call.body.from).toBe(`DROMEX <${SENDER}>`);
      expect(call.body.reply_to).toBe(REPLY_TO);
      expect(`${call.body.text}\n${call.body.html}`).not.toContain('evil.example');
    }
    expect(invitation!.body.to).toBe(invitee);
    expect(invitation!.body.text).toContain(`${LINK_ORIGIN}/invitation#`);
    expect(invitation!.headers.get('idempotency-key')).toBe(`admin_invitation/${(await invitationRow(invitee)).delivery_id}`);
    expect(resetEmail!.body.to).toBe(member.email);
    expect(resetEmail!.body.text).toContain(`${LINK_ORIGIN}/reset-password#`);
    expect(resetEmail!.headers.get('idempotency-key')).toMatch(/^password_reset\//);
    expect(changed!.body.to).toBe(member.email);
    expect(changed!.headers.get('idempotency-key')).toMatch(/^password_changed\//);

    expect(await invitationRow(invitee)).toMatchObject({ status: 'pending', delivery_status: 'provider_accepted', delivery_attempts: 1 });
    expect(await resetRow(member.id)).toMatchObject({ status: 'completed', delivery_status: 'provider_accepted' });
    expect(await auditReasons('password_changed_notification')).toEqual([
      { event_type: 'password_changed_notification_accepted', reason: null },
    ]);
    // Acceptance by the provider grants nothing: no identity exists for the invitee.
    expect((await pool.query(`SELECT 1 FROM "user" WHERE lower(email) = $1`, [invitee])).rowCount).toBe(0);

    // The key file was read once, at startup, however many emails were sent.
    expect(opened).toEqual([path]);

    const text = logs();
    for (const secret of [key, path, token!, invitation!.body.text, resetEmail!.body.html, NEW_PASSWORD, owner.password, 'Bearer']) {
      expect(text).not.toContain(secret);
    }
    for (const call of provider.calls) {
      const link = /#([A-Za-z0-9_-]{43})/.exec(call.body.text)?.[1];
      if (link !== undefined) expect(text).not.toContain(link);
    }
  });

  const scenarios: Array<{ label: string; reply: Reply; status: string; reason: string | null; attempts: number }> = [
    { label: 'unavailable', reply: () => jsonResponse(503, { name: 'x' }), status: 'failed', reason: 'provider_unavailable', attempts: 3 },
    { label: 'timeout', reply: () => timeoutError(), status: 'failed', reason: 'timeout', attempts: 3 },
    { label: 'rejected', reply: () => jsonResponse(422, { name: 'validation_error' }), status: 'failed', reason: 'provider_rejected', attempts: 1 },
    { label: 'unauthorised', reply: () => jsonResponse(401, { name: 'x' }), status: 'failed', reason: 'provider_authentication', attempts: 1 },
    {
      label: 'in progress then accepted',
      reply: (_call, index) =>
        index === 0 ? jsonResponse(409, { name: 'concurrent_idempotent_requests' }) : jsonResponse(200, { id: crypto.randomUUID() }),
      status: 'provider_accepted',
      reason: null,
      attempts: 2,
    },
    { label: 'conflict', reply: () => jsonResponse(409, { name: 'invalid_idempotent_request' }), status: 'failed', reason: 'idempotency_conflict', attempts: 1 },
  ];

  // One test per scenario, so each has its own time budget and failure report.
  it.each(scenarios)('keeps the $label provider outcome truthful and bounded, with one idempotency key', async (scenario) => {
    const path = await keyFile(syntheticApiKey());
    const owner = await activeUser('failure-owner', true);
    const provider = scriptedProvider(scenario.reply);
    const { app } = await start(loadRuntimeConfig(resendEnvironment(path)), provider.dependencies);
    const cookie = await signIn(app, owner);
    const invitee = freshEmail(scenario.label.replaceAll(' ', '-'));

    const created = await post(app, '/api/owner/invitations', { email: invitee }, { cookie });
    expect(created.statusCode).toBe(201);
    expect(created.json().invitation).toMatchObject({
      status: 'pending',
      delivery: { status: scenario.status, reason: scenario.reason },
    });
    expect(await invitationRow(invitee)).toMatchObject({
      status: 'pending',
      delivery_status: scenario.status,
      delivery_attempts: scenario.attempts,
    });
    expect(provider.calls).toHaveLength(scenario.attempts);
    // Every attempt of one logical email carries one key and a byte-identical body.
    expect(new Set(provider.calls.map((call) => call.headers.get('idempotency-key'))).size).toBe(1);
    expect(new Set(provider.calls.map((call) => call.rawBody)).size).toBe(1);
    expect(created.body).not.toMatch(/validation_error|concurrent_idempotent|invalid_idempotent|Bearer/);
  });

  it('keeps the public reset response identical for known, unknown, and disabled addresses, and fails closed on provider failure', async () => {
    const path = await keyFile(syntheticApiKey());
    const provider = scriptedProvider(() => jsonResponse(503, { name: 'x' }));
    const { app } = await start(loadRuntimeConfig(resendEnvironment(path)), provider.dependencies);

    const known = await activeUser('neutral-known');
    const disabled = await activeUser('neutral-disabled');
    await setPrincipal(pool, disabled.id, 'disabled', false);

    const responses = [];
    for (const email of [known.email, freshEmail('neutral-unknown'), disabled.email]) {
      responses.push(await post(app, '/api/password-reset/request', { email }));
    }
    await service!.drain();

    const shapes = responses.map((response) => {
      const headers = { ...response.headers };
      delete headers['date'];
      return { status: response.statusCode, body: response.body, headers };
    });
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
    expect(shapes[0]!.status).toBe(202);

    // Only the known, enabled account was handed to the provider, and its failure is recorded, not hidden.
    expect(new Set(provider.calls.map((call) => call.body.to))).toEqual(new Set([known.email]));
    expect(await resetRow(known.id)).toMatchObject({ status: 'issued', delivery_status: 'failed', delivery_reason: 'provider_unavailable', delivery_attempts: 3 });
    expect(await resetRow(disabled.id)).toBeUndefined();
  });

  it('answers /health and /ready from the process and database alone', async () => {
    const path = await keyFile(syntheticApiKey());
    const provider = scriptedProvider();
    const { app } = await start(loadRuntimeConfig(resendEnvironment(path)), provider.dependencies);

    const health = await app.inject({ method: 'GET', url: '/health' });
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect([health.statusCode, health.json()]).toEqual([200, { status: 'ok' }]);
    expect([ready.statusCode, ready.json()]).toEqual([200, { status: 'ready' }]);
    expect(provider.calls).toEqual([]);
  });
});
