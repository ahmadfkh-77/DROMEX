import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EmailMessage } from '../../src/email/message.ts';
import { RESEND_EMAILS_ENDPOINT, RESEND_RETRY_POLICY, createResendTransport } from '../../src/email/resend.ts';
import type { EmailSendResult } from '../../src/email/result.ts';
import {
  LINK_ORIGIN,
  acceptedResponse,
  fakeResendEnvironment,
  jsonResponse,
  networkError,
  syntheticApiKey,
  syntheticMessage,
  timeoutError,
  watchConsole,
  type FakeResendEnvironment,
} from '../helpers/email.ts';

const POLICY = { linkOrigin: LINK_ORIGIN };

function transportFor(env: FakeResendEnvironment, apiKey = syntheticApiKey()) {
  return { apiKey, transport: createResendTransport({ apiKey, policy: POLICY, dependencies: env.dependencies }) };
}

function header(call: { init: RequestInit }, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

function expectNothingSensitive(result: EmailSendResult, message: EmailMessage, apiKey: string): void {
  const text = JSON.stringify(result);
  for (const value of [apiKey, message.to, message.subject, message.text, message.html, message.idempotencyKey, 'Bearer']) {
    expect(text).not.toContain(value);
  }
  expect(Object.keys(result).sort()).toEqual(
    result.status === 'accepted'
      ? ['attempts', 'providerMessageId', 'status']
      : result.status === 'disabled'
        ? ['status']
        : ['attempts', 'reason', 'status'],
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Resend request', () => {
  it('posts exactly the approved JSON to the fixed official endpoint', async () => {
    const env = fakeResendEnvironment([acceptedResponse('4ef3a1c2-aaaa-4bbb-8ccc-dddd00001111')]);
    const { apiKey, transport } = transportFor(env);
    const message = syntheticMessage();

    const result = await transport.send(message);

    expect(result).toEqual({ status: 'accepted', providerMessageId: '4ef3a1c2-aaaa-4bbb-8ccc-dddd00001111', attempts: 1 });
    expect(env.calls).toHaveLength(1);
    const [call] = env.calls;
    expect(RESEND_EMAILS_ENDPOINT).toBe('https://api.resend.com/emails');
    expect(call!.url).toBe('https://api.resend.com/emails');
    expect(call!.init.method).toBe('POST');
    expect(call!.init.redirect).toBe('error');
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);

    expect(header(call!, 'authorization')).toBe(`Bearer ${apiKey}`);
    expect(header(call!, 'content-type')).toBe('application/json');
    expect(header(call!, 'accept')).toBe('application/json');
    expect(header(call!, 'idempotency-key')).toBe(message.idempotencyKey);
    expect(header(call!, 'user-agent')).toMatch(/^dromex-api\/[0-9.]+$/);
    expect([...new Headers(call!.init.headers).keys()].sort()).toEqual([
      'accept',
      'authorization',
      'content-type',
      'idempotency-key',
      'user-agent',
    ]);

    const body = JSON.parse(String(call!.init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      from: 'DROMEX Test <no-reply@notify.example.test>',
      to: 'recipient@example.test',
      reply_to: 'support@example.test',
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    expect(String(call!.init.body)).not.toContain(apiKey);
    expect(call!.url).not.toContain(apiKey);
  });

  it('omits Reply-To when absent and formats a sender without a name as the bare address', async () => {
    const env = fakeResendEnvironment([acceptedResponse()]);
    const { transport } = transportFor(env);
    const message = syntheticMessage({ from: { address: 'no-reply@notify.example.test' } });
    delete message.replyTo;

    await transport.send(message);

    expect(JSON.parse(String(env.calls[0]!.init.body))).toEqual({
      from: 'no-reply@notify.example.test',
      to: 'recipient@example.test',
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it('adds no tracking, tag, header, attachment, scheduling, or webhook field', async () => {
    const env = fakeResendEnvironment([acceptedResponse()]);
    const { transport } = transportFor(env);
    await transport.send(syntheticMessage());

    const body = String(env.calls[0]!.init.body);
    expect(body).not.toMatch(/track|tags|headers|attachments|scheduled|webhook|cc|bcc/i);
  });

  it('refuses an invalid message, or one carrying the key, without any request', async () => {
    const env = fakeResendEnvironment([]);
    const { apiKey, transport } = transportFor(env);

    expect(await transport.send(syntheticMessage({ to: 'a@example.test,b@example.test' }))).toEqual({
      status: 'permanent_failure',
      reason: 'invalid_message',
      issue: 'recipient_invalid',
      attempts: 0,
    });
    const leaking = syntheticMessage({ text: `SYNTHETIC ${LINK_ORIGIN}/x ${apiKey}` });
    const result = await transport.send(leaking);
    expect(result).toEqual({ status: 'permanent_failure', reason: 'invalid_message', issue: 'secret_like_value', attempts: 0 });
    expect(env.calls).toHaveLength(0);
  });

  it('extracts only a strictly valid provider message id', async () => {
    for (const id of ['4ef3a1c2-aaaa-4bbb-8ccc-dddd00001111', 'A1', 'x'.repeat(128)]) {
      const env = fakeResendEnvironment([acceptedResponse(id)]);
      expect(await transportFor(env).transport.send(syntheticMessage())).toEqual({
        status: 'accepted',
        providerMessageId: id,
        attempts: 1,
      });
    }
  });

  it('treats a malformed success response as a permanent, non-retried failure', async () => {
    const malformed: Array<() => Response> = [
      () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
      () => jsonResponse(200, {}),
      () => jsonResponse(200, { id: '' }),
      () => jsonResponse(200, { id: 42 }),
      () => jsonResponse(200, { id: 'has space' }),
      () => jsonResponse(200, { id: 'x'.repeat(129) }),
      () => jsonResponse(200, { id: '-leading-dash' }),
      () => jsonResponse(200, ['4ef3a1c2']),
      () => new Response(JSON.stringify({ id: 'abc' }), { status: 200, headers: { 'content-type': 'text/html' } }),
      () => jsonResponse(200, { id: 'abc', padding: 'p'.repeat(RESEND_RETRY_POLICY.maxResponseBytes) }),
    ];
    for (const [index, make] of malformed.entries()) {
      const env = fakeResendEnvironment([make()]);
      const { apiKey, transport } = transportFor(env);
      const message = syntheticMessage();
      const result = await transport.send(message);
      expect(result, String(index)).toEqual({ status: 'permanent_failure', reason: 'provider_response_invalid', attempts: 1 });
      expect(env.calls, String(index)).toHaveLength(1);
      expectNothingSensitive(result, message, apiKey);
    }
  });

  it('does not expose the key through the transport object', () => {
    const env = fakeResendEnvironment([]);
    const { apiKey, transport } = transportFor(env);
    expect(inspect(transport, { depth: 10, showHidden: true })).not.toContain(apiKey);
    expect(JSON.stringify(transport)).not.toContain(apiKey);
    expect(Object.keys(transport).sort()).toEqual(['kind', 'send']);
  });
});

describe('Resend retries (DEC-439)', () => {
  it('succeeds on the first attempt without sleeping', async () => {
    const env = fakeResendEnvironment([acceptedResponse()]);
    const result = await transportFor(env).transport.send(syntheticMessage());
    expect(result).toMatchObject({ status: 'accepted', attempts: 1 });
    expect(env.sleeps).toEqual([]);
  });

  it.each([
    ['429', () => jsonResponse(429, { name: 'rate_limit_exceeded' })],
    ['500', () => jsonResponse(500, { name: 'application_error' })],
    ['502', () => new Response('bad gateway', { status: 502 })],
    ['503', () => jsonResponse(503, { name: 'service_unavailable' })],
    ['timeout', () => timeoutError()],
    ['ECONNRESET', () => networkError('ECONNRESET')],
    ['UND_ERR_SOCKET', () => networkError('UND_ERR_SOCKET')],
    ['EAI_AGAIN', () => networkError('EAI_AGAIN')],
  ])('retries after %s and then succeeds, reusing the same idempotency key and body', async (_label, failure) => {
    const env = fakeResendEnvironment([failure(), acceptedResponse('4ef3a1c2-aaaa-4bbb-8ccc-dddd00001111')]);
    const message = syntheticMessage();
    const result = await transportFor(env).transport.send(message);

    expect(result).toEqual({ status: 'accepted', providerMessageId: '4ef3a1c2-aaaa-4bbb-8ccc-dddd00001111', attempts: 2 });
    expect(env.calls).toHaveLength(2);
    expect(env.calls.map((call) => header(call, 'idempotency-key'))).toEqual([message.idempotencyKey, message.idempotencyKey]);
    expect(env.calls[1]!.init.body).toBe(env.calls[0]!.init.body);
    expect(env.sleeps).toEqual([RESEND_RETRY_POLICY.backoffMs[0]]);
  });

  it('classifies a real attempt timeout through the abort signal', async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const env = fakeResendEnvironment([hang, acceptedResponse()], { fireTimeouts: true });
    const result = await transportFor(env).transport.send(syntheticMessage());

    expect(result).toMatchObject({ status: 'accepted', attempts: 2 });
    expect(env.timeouts[0]).toBe(RESEND_RETRY_POLICY.attemptTimeoutMs);
  });

  it('keeps the same idempotency key when a delivered request loses its response', async () => {
    const bodies: string[] = [];
    const lost = async (init: RequestInit) => {
      bodies.push(String(init.body));
      throw networkError('ECONNRESET');
    };
    const env = fakeResendEnvironment([lost, acceptedResponse()]);
    const message = syntheticMessage();
    await transportFor(env).transport.send(message);

    expect(env.calls.map((call) => header(call, 'idempotency-key'))).toEqual([message.idempotencyKey, message.idempotencyKey]);
    expect(String(env.calls[1]!.init.body)).toBe(bodies[0]);
  });

  it.each([
    [400, 'provider_rejected'],
    [404, 'provider_rejected'],
    [405, 'provider_rejected'],
    [409, 'provider_rejected'],
    [422, 'provider_rejected'],
    [401, 'provider_authentication'],
    [403, 'provider_authentication'],
  ] as const)('does not retry a permanent %i response', async (status, reason) => {
    const env = fakeResendEnvironment([jsonResponse(status, { name: 'synthetic_error', message: 'SYNTHETIC-PROVIDER-CANARY' })]);
    const message = syntheticMessage();
    const { apiKey, transport } = transportFor(env);
    const result = await transport.send(message);

    expect(result).toEqual({ status: 'permanent_failure', reason, attempts: 1 });
    expect(env.calls).toHaveLength(1);
    expect(env.sleeps).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-PROVIDER-CANARY');
    expectNothingSensitive(result, message, apiKey);
  });

  it('does not retry a redirect, an unexpected status, or an unknown thrown error', async () => {
    for (const step of [
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.test/' } }),
      new Response(null, { status: 204 }),
      Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') }),
      new Error('synthetic unknown failure'),
      networkError('ENOTFOUND'),
    ]) {
      const env = fakeResendEnvironment([step]);
      const result = await transportFor(env).transport.send(syntheticMessage());
      expect(result.status).toBe('permanent_failure');
      expect(env.calls).toHaveLength(1);
    }
  });

  it('makes at most three attempts and returns a safe retryable failure', async () => {
    for (const [make, reason] of [
      [() => jsonResponse(500, { message: 'SYNTHETIC-PROVIDER-CANARY' }), 'provider_unavailable'],
      [() => jsonResponse(429, {}), 'rate_limited'],
      [() => timeoutError(), 'timeout'],
      [() => networkError('ECONNREFUSED'), 'network_unavailable'],
    ] as const) {
      const env = fakeResendEnvironment([make(), make(), make(), acceptedResponse()]);
      const message = syntheticMessage();
      const { apiKey, transport } = transportFor(env);
      const result = await transport.send(message);

      expect(result).toEqual({ status: 'retryable_failure', reason, attempts: 3 });
      expect(env.calls).toHaveLength(3);
      expect(RESEND_RETRY_POLICY.maxAttempts).toBe(3);
      expect(new Set(env.calls.map((call) => header(call, 'idempotency-key')))).toEqual(new Set([message.idempotencyKey]));
      expect(env.sleeps).toEqual([1_000, 2_000]);
      expectNothingSensitive(result, message, apiKey);
    }
  });

  it('bounds jitter', async () => {
    const env = fakeResendEnvironment([jsonResponse(500, {}), jsonResponse(500, {}), acceptedResponse()], { random: 0.999999 });
    await transportFor(env).transport.send(syntheticMessage());
    expect(env.sleeps).toHaveLength(2);
    expect(env.sleeps[0]).toBeGreaterThanOrEqual(1_000);
    expect(env.sleeps[0]).toBeLessThan(1_000 + RESEND_RETRY_POLICY.jitterMs);
    expect(env.sleeps[1]).toBeLessThan(2_000 + RESEND_RETRY_POLICY.jitterMs);
  });

  it('respects a bounded Retry-After and ignores an unusable one', async () => {
    const honoured = fakeResendEnvironment([jsonResponse(429, {}, { 'retry-after': '7' }), acceptedResponse()]);
    expect(await transportFor(honoured).transport.send(syntheticMessage())).toMatchObject({ status: 'accepted', attempts: 2 });
    expect(honoured.sleeps).toEqual([7_000]);

    const shorter = fakeResendEnvironment([jsonResponse(503, {}, { 'retry-after': '0' }), acceptedResponse()]);
    await transportFor(shorter).transport.send(syntheticMessage());
    expect(shorter.sleeps).toEqual([1_000]);

    for (const value of ['soon', '-5', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT', '', '1234567']) {
      const ignored = fakeResendEnvironment([jsonResponse(429, {}, { 'retry-after': value }), acceptedResponse()]);
      await transportFor(ignored).transport.send(syntheticMessage());
      expect(ignored.sleeps, value).toEqual([1_000]);
    }
  });

  it('stops instead of retrying early when Retry-After exceeds the bound', async () => {
    for (const value of ['31', '120', '999999']) {
      const env = fakeResendEnvironment([jsonResponse(429, {}, { 'retry-after': value }), acceptedResponse()]);
      const result = await transportFor(env).transport.send(syntheticMessage());

      expect(result, value).toEqual({ status: 'retryable_failure', reason: 'rate_limited', attempts: 1 });
      expect(env.calls, value).toHaveLength(1);
      expect(env.sleeps, value).toEqual([]);
    }
    const atBound = fakeResendEnvironment([jsonResponse(429, {}, { 'retry-after': '30' }), acceptedResponse()]);
    expect(await transportFor(atBound).transport.send(syntheticMessage())).toMatchObject({ status: 'accepted', attempts: 2 });
    expect(atBound.sleeps).toEqual([30_000]);
  });

  it('completes every attempt within the two-minute deadline', async () => {
    const slow500 = async (_init: RequestInit, env: FakeResendEnvironment) => {
      env.advance(30_000);
      return jsonResponse(500, {});
    };
    const env = fakeResendEnvironment([slow500, slow500, slow500]);
    const result = await transportFor(env).transport.send(syntheticMessage());

    expect(result).toEqual({ status: 'retryable_failure', reason: 'provider_unavailable', attempts: 3 });
    expect(env.now() - env.start).toBeLessThanOrEqual(RESEND_RETRY_POLICY.deadlineMs);
    expect(RESEND_RETRY_POLICY.deadlineMs).toBe(120_000);
  });

  it('never starts or sleeps into an attempt that cannot fit before the deadline', async () => {
    const verySlow500 = async (_init: RequestInit, env: FakeResendEnvironment) => {
      env.advance(59_000);
      return jsonResponse(500, {});
    };
    const env = fakeResendEnvironment([verySlow500, verySlow500, acceptedResponse()]);
    const result = await transportFor(env).transport.send(syntheticMessage());

    expect(result).toEqual({ status: 'retryable_failure', reason: 'deadline_exhausted', attempts: 2 });
    expect(env.calls).toHaveLength(2);
    expect(env.now() - env.start).toBeLessThanOrEqual(RESEND_RETRY_POLICY.deadlineMs);
  });

  it('re-checks the deadline after a sleep that overran, and makes no further attempt', async () => {
    const env = fakeResendEnvironment([jsonResponse(500, {}), acceptedResponse()]);
    const overrunningSleep = async (ms: number) => {
      env.sleeps.push(ms);
      env.advance(119_500); // a suspended process or a clock jump, not the requested delay
    };
    const transport = createResendTransport({
      apiKey: syntheticApiKey(),
      policy: POLICY,
      dependencies: { ...env.dependencies, sleep: overrunningSleep },
    });

    const result = await transport.send(syntheticMessage());

    expect(result).toEqual({ status: 'retryable_failure', reason: 'deadline_exhausted', attempts: 1 });
    expect(env.calls).toHaveLength(1);
  });

  it('gives a later attempt no more time than remains before the deadline', async () => {
    const slow500 = async (_init: RequestInit, env: FakeResendEnvironment) => {
      env.advance(45_000);
      return jsonResponse(500, {});
    };
    const env = fakeResendEnvironment([slow500, slow500, acceptedResponse()]);
    await transportFor(env).transport.send(syntheticMessage());

    expect(env.timeouts[0]).toBe(30_000);
    const elapsedBeforeThird = 45_000 + 1_000 + 45_000 + 2_000;
    expect(env.timeouts[2]).toBe(Math.min(30_000, 120_000 - elapsedBeforeThird));
  });

  it('does not write to the console during retries or failures', async () => {
    const consoleCalls = watchConsole();
    const env = fakeResendEnvironment([networkError('ECONNRESET'), jsonResponse(500, {}), jsonResponse(400, {})]);
    await transportFor(env).transport.send(syntheticMessage({ idempotencyKey: `delivery_test/${randomUUID()}` }));
    expect(consoleCalls()).toEqual([]);
  });
});

describe('Resend HTTP 409 idempotency responses (DEC-439)', () => {
  // Resend documents three 409 error types, carried in the error body's
  // `name` field: `concurrent_idempotent_requests` (another request with the
  // same key is still in progress; safe to retry later),
  // `invalid_idempotent_request` (the key was used with a different payload;
  // retrying is useless), and `resource_locked` (resource updates, not sends).
  const IN_PROGRESS = 'concurrent_idempotent_requests';
  const CONFLICT = 'invalid_idempotent_request';
  const CANARY = 'SYNTHETIC-PROVIDER-409-CANARY';

  const inProgress = () => jsonResponse(409, { statusCode: 409, name: IN_PROGRESS, message: CANARY });
  const conflict = () => jsonResponse(409, { statusCode: 409, name: CONFLICT, message: CANARY });

  it('retries an in-progress 409 with the same key and byte-identical body, then accepts once', async () => {
    const env = fakeResendEnvironment([inProgress(), acceptedResponse('4ef3a1c2-aaaa-4bbb-8ccc-dddd00001111')]);
    const message = syntheticMessage();
    const { apiKey, transport } = transportFor(env);
    const result = await transport.send(message);

    expect(result).toEqual({ status: 'accepted', providerMessageId: '4ef3a1c2-aaaa-4bbb-8ccc-dddd00001111', attempts: 2 });
    expect(env.calls).toHaveLength(2);
    expect(env.calls.map((call) => header(call, 'idempotency-key'))).toEqual([message.idempotencyKey, message.idempotencyKey]);
    expect(env.calls[1]!.init.body).toBe(env.calls[0]!.init.body);
    expect(env.sleeps).toEqual([RESEND_RETRY_POLICY.backoffMs[0]]);
    expectNothingSensitive(result, message, apiKey);
  });

  it('stops after three in-progress 409s with a safe retryable reason and never a second logical send', async () => {
    const env = fakeResendEnvironment([inProgress(), inProgress(), inProgress(), acceptedResponse()]);
    const message = syntheticMessage();
    const { apiKey, transport } = transportFor(env);
    const result = await transport.send(message);

    expect(result).toEqual({ status: 'retryable_failure', reason: 'idempotency_in_progress', attempts: 3 });
    expect(env.calls).toHaveLength(RESEND_RETRY_POLICY.maxAttempts);
    expect(new Set(env.calls.map((call) => header(call, 'idempotency-key')))).toEqual(new Set([message.idempotencyKey]));
    expect(new Set(env.calls.map((call) => call.init.body)).size).toBe(1);
    expect(env.sleeps).toEqual([1_000, 2_000]);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expectNothingSensitive(result, message, apiKey);
  });

  it('keeps in-progress retries inside the two-minute deadline and the Retry-After bound', async () => {
    const slowInProgress = async (_init: RequestInit, env: FakeResendEnvironment) => {
      env.advance(59_000);
      return inProgress();
    };
    const env = fakeResendEnvironment([slowInProgress, slowInProgress, acceptedResponse()]);
    expect(await transportFor(env).transport.send(syntheticMessage())).toEqual({
      status: 'retryable_failure',
      reason: 'deadline_exhausted',
      attempts: 2,
    });
    expect(env.now() - env.start).toBeLessThanOrEqual(RESEND_RETRY_POLICY.deadlineMs);

    const tooLong = fakeResendEnvironment([
      jsonResponse(409, { name: IN_PROGRESS }, { 'retry-after': '31' }),
      acceptedResponse(),
    ]);
    expect(await transportFor(tooLong).transport.send(syntheticMessage())).toEqual({
      status: 'retryable_failure',
      reason: 'idempotency_in_progress',
      attempts: 1,
    });
    expect(tooLong.sleeps).toEqual([]);
  });

  it('never retries a conflict 409 and returns only a safe reason code', async () => {
    const env = fakeResendEnvironment([conflict(), acceptedResponse()]);
    const message = syntheticMessage();
    const { apiKey, transport } = transportFor(env);
    const result = await transport.send(message);

    expect(result).toEqual({ status: 'permanent_failure', reason: 'idempotency_conflict', attempts: 1 });
    expect(env.calls).toHaveLength(1);
    expect(env.sleeps).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expectNothingSensitive(result, message, apiKey);
  });

  it('does not retry a conflict that follows an in-progress response', async () => {
    const env = fakeResendEnvironment([inProgress(), conflict(), acceptedResponse()]);
    const result = await transportFor(env).transport.send(syntheticMessage());
    expect(result).toEqual({ status: 'permanent_failure', reason: 'idempotency_conflict', attempts: 2 });
    expect(env.calls).toHaveLength(2);
  });

  it('fails closed without retry on an unclassifiable, malformed, or oversized 409 body', async () => {
    const limit = RESEND_RETRY_POLICY.maxErrorResponseBytes;
    const oversized = (name: string) => {
      const prefix = JSON.stringify({ name, message: '' });
      return jsonResponse(409, { name, message: 'p'.repeat(limit - prefix.length + 1) });
    };
    const withType = (body: string | null, contentType?: string) =>
      new Response(body, { status: 409, headers: contentType === undefined ? {} : { 'content-type': contentType } });
    const cases: Array<[string, () => Response]> = [
      ['resource_locked', () => jsonResponse(409, { name: 'resource_locked', message: CANARY })],
      ['unknown name', () => jsonResponse(409, { name: 'synthetic_unknown', message: CANARY })],
      ['case variant', () => jsonResponse(409, { name: 'Concurrent_Idempotent_Requests' })],
      ['padded name', () => jsonResponse(409, { name: ` ${IN_PROGRESS}` })],
      ['name not a string', () => jsonResponse(409, { name: [IN_PROGRESS] })],
      ['nested name only', () => jsonResponse(409, { error: { name: IN_PROGRESS } })],
      ['message only', () => jsonResponse(409, { message: IN_PROGRESS })],
      ['array body', () => jsonResponse(409, [IN_PROGRESS])],
      ['null body', () => jsonResponse(409, null)],
      ['invalid json', () => withType(`{"name":"${IN_PROGRESS}"`, 'application/json')],
      ['empty body', () => withType(null, 'application/json')],
      ['not json content type', () => withType(JSON.stringify({ name: IN_PROGRESS }), 'text/html')],
      ['no content type', () => withType(JSON.stringify({ name: IN_PROGRESS }))],
      ['oversized in-progress', () => oversized(IN_PROGRESS)],
      ['oversized conflict', () => oversized(CONFLICT)],
    ];
    for (const [label, make] of cases) {
      const env = fakeResendEnvironment([make(), acceptedResponse()]);
      const message = syntheticMessage();
      const { apiKey, transport } = transportFor(env);
      const result = await transport.send(message);

      expect(result, label).toEqual({ status: 'permanent_failure', reason: 'provider_rejected', attempts: 1 });
      expect(env.calls, label).toHaveLength(1);
      expect(env.sleeps, label).toEqual([]);
      expect(JSON.stringify(result), label).not.toContain(CANARY);
      expectNothingSensitive(result, message, apiKey);
    }
  });

  it('classifies a well-formed 409 body that exactly fills the size bound', async () => {
    const limit = RESEND_RETRY_POLICY.maxErrorResponseBytes;
    expect(limit).toBe(4_096);
    const prefix = JSON.stringify({ name: CONFLICT, message: '' });
    const body = JSON.stringify({ name: CONFLICT, message: 'p'.repeat(limit - prefix.length) });
    expect(Buffer.byteLength(body)).toBe(limit);
    const env = fakeResendEnvironment([
      new Response(body, { status: 409, headers: { 'content-type': 'application/json; charset=utf-8' } }),
    ]);
    expect(await transportFor(env).transport.send(syntheticMessage())).toEqual({
      status: 'permanent_failure',
      reason: 'idempotency_conflict',
      attempts: 1,
    });
  });

  it('reads no other error status body and writes nothing to the console', async () => {
    const consoleCalls = watchConsole();
    const response = jsonResponse(422, { name: IN_PROGRESS, message: CANARY });
    const readSpy = vi.spyOn(response, 'text');
    const jsonSpy = vi.spyOn(response, 'json');
    const readerSpy = vi.spyOn(response.body!, 'getReader');
    const env = fakeResendEnvironment([response]);
    const result = await transportFor(env).transport.send(syntheticMessage());

    expect(result).toEqual({ status: 'permanent_failure', reason: 'provider_rejected', attempts: 1 });
    expect(readerSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();

    const retried = fakeResendEnvironment([inProgress(), conflict()]);
    await transportFor(retried).transport.send(syntheticMessage());
    expect(consoleCalls()).toEqual([]);
  });
});
