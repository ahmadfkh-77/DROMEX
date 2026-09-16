import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailConfigurationError } from '../../src/email/errors.ts';
import {
  createCaptureTransport,
  createDisabledTransport,
  createEmailTransport,
} from '../../src/email/transport.ts';
import {
  LINK_ORIGIN,
  acceptedResponse,
  fakeResendEnvironment,
  syntheticApiKey,
  syntheticMessage,
  watchConsole,
} from '../helpers/email.ts';

const TEST_OPTIONS = { environment: 'test' as const, linkOrigin: LINK_ORIGIN };

function watchNetwork() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('network must not be used');
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('disabled email transport', () => {
  it('reports disabled, never success, and uses no network or console', async () => {
    const network = watchNetwork();
    const consoleCalls = watchConsole();
    const transport = createDisabledTransport(TEST_OPTIONS);

    expect(transport.kind).toBe('disabled');
    const result = await transport.send(syntheticMessage());

    expect(result).toEqual({ status: 'disabled' });
    expect(network).not.toHaveBeenCalled();
    expect(consoleCalls()).toEqual([]);
  });

  it('still refuses an invalid message rather than hiding it', async () => {
    const transport = createDisabledTransport(TEST_OPTIONS);
    expect(await transport.send(syntheticMessage({ to: 'not-an-address' }))).toEqual({
      status: 'permanent_failure',
      reason: 'invalid_message',
      issue: 'recipient_invalid',
      attempts: 0,
    });
  });

  it('is available in production and refuses an invalid link origin', () => {
    expect(createDisabledTransport({ environment: 'production', linkOrigin: LINK_ORIGIN }).kind).toBe('disabled');
    expect(() => createDisabledTransport({ environment: 'production', linkOrigin: 'http://app.example.test' })).toThrow(
      EmailConfigurationError,
    );
  });
});

describe('capture email transport', () => {
  it('cannot be created in production', () => {
    expect(() => createCaptureTransport({ environment: 'production', linkOrigin: LINK_ORIGIN })).toThrow(
      expect.objectContaining({ code: 'capture_not_allowed_in_production' }),
    );
  });

  it('captures deterministically in memory, with no network or console output', async () => {
    const network = watchNetwork();
    const consoleCalls = watchConsole();
    const transport = createCaptureTransport(TEST_OPTIONS);
    const first = syntheticMessage();
    const second = syntheticMessage({ purpose: 'password_changed', idempotencyKey: 'password_changed/0123456789abcdef' });

    expect(await transport.send(first)).toEqual({ status: 'accepted', providerMessageId: 'capture-000001', attempts: 1 });
    expect(await transport.send(second)).toEqual({ status: 'accepted', providerMessageId: 'capture-000002', attempts: 1 });

    expect(transport.captured()).toEqual([
      { ...first, providerMessageId: 'capture-000001' },
      { ...second, providerMessageId: 'capture-000002' },
    ]);
    expect(network).not.toHaveBeenCalled();
    expect(consoleCalls()).toEqual([]);
  });

  it('stores copies that callers cannot alter', async () => {
    const transport = createCaptureTransport(TEST_OPTIONS);
    const message = syntheticMessage();
    await transport.send(message);

    message.subject = 'changed after send';
    message.from.name = 'Changed';
    const [stored] = transport.captured();
    expect(stored!.subject).toBe('SYNTHETIC TEST ONLY - DROMEX delivery check');
    expect(stored!.from.name).toBe('DROMEX Test');
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored!.from)).toBe(true);
    expect(() => (transport.captured() as unknown[]).push({})).toThrow();
  });

  it('isolates each instance and clears completely', async () => {
    const a = createCaptureTransport(TEST_OPTIONS);
    const b = createCaptureTransport(TEST_OPTIONS);
    await a.send(syntheticMessage());

    expect(a.captured()).toHaveLength(1);
    expect(b.captured()).toEqual([]);

    a.clear();
    expect(a.captured()).toEqual([]);
    expect(await a.send(syntheticMessage())).toMatchObject({ providerMessageId: 'capture-000001' });
  });

  it('mirrors provider idempotency: same key and payload is one message, a changed payload is a conflict', async () => {
    const transport = createCaptureTransport(TEST_OPTIONS);
    const message = syntheticMessage();

    const first = await transport.send(message);
    const repeat = await transport.send({ ...message, from: { ...message.from } });
    expect(repeat).toEqual(first);
    expect(transport.captured()).toHaveLength(1);

    expect(await transport.send({ ...message, subject: 'SYNTHETIC different payload' })).toEqual({
      status: 'permanent_failure',
      reason: 'idempotency_conflict',
      attempts: 1,
    });
    expect(transport.captured()).toHaveLength(1);
  });

  it('refuses invalid messages without capturing them', async () => {
    const transport = createCaptureTransport(TEST_OPTIONS);
    expect(await transport.send(syntheticMessage({ html: '<img src="https://app.example.test/p.gif">' }))).toEqual({
      status: 'permanent_failure',
      reason: 'invalid_message',
      issue: 'unsafe_content',
      attempts: 0,
    });
    expect(transport.captured()).toEqual([]);
  });
});

describe('email transport factory', () => {
  it('creates the disabled transport by default in every environment', async () => {
    for (const environment of ['development', 'test', 'production'] as const) {
      const transport = await createEmailTransport({ kind: 'disabled' }, { environment, linkOrigin: LINK_ORIGIN });
      expect(transport.kind).toBe('disabled');
    }
  });

  it('refuses the capture transport in production and creates it elsewhere', async () => {
    await expect(
      createEmailTransport({ kind: 'capture' }, { environment: 'production', linkOrigin: LINK_ORIGIN }),
    ).rejects.toMatchObject({ code: 'capture_not_allowed_in_production' });
    expect((await createEmailTransport({ kind: 'capture' }, TEST_OPTIONS)).kind).toBe('capture');
  });

  it('refuses an unknown transport kind', async () => {
    await expect(createEmailTransport({ kind: 'smtp' } as never, TEST_OPTIONS)).rejects.toMatchObject({
      code: 'transport_unsupported',
    });
  });

  it('fails closed for Resend on a platform that cannot protect the key file', async () => {
    let opened = 0;
    await expect(
      createEmailTransport(
        { kind: 'resend', apiKeyFile: '/run/secrets/synthetic' },
        {
          environment: 'production',
          linkOrigin: LINK_ORIGIN,
          secretFile: {
            platform: 'win32',
            open: async () => {
              opened += 1;
              throw new Error('must not open');
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'platform_unsupported' });
    expect(opened).toBe(0);
  });

  it('fails closed for Resend when the key file is missing', async () => {
    await expect(
      createEmailTransport(
        { kind: 'resend', apiKeyFile: '/nonexistent-dromex-synthetic/resend-key' },
        { environment: 'production', linkOrigin: LINK_ORIGIN, secretFile: { platform: 'linux' } },
      ),
    ).rejects.toBeInstanceOf(EmailConfigurationError);
  });

  describe.runIf(process.platform !== 'win32')('with a synthetic key file', () => {
    let directory: string | undefined;

    afterEach(async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
      directory = undefined;
    });

    it('loads the key from the file, sends through the injected fetch, and never exposes the key', async () => {
      directory = await mkdtemp(join(tmpdir(), 'dromex-email-factory-'));
      const key = syntheticApiKey();
      const path = join(directory, 'resend-key');
      await writeFile(path, `${key}\n`, { mode: 0o600 });
      await chmod(path, 0o600);

      const env = fakeResendEnvironment([acceptedResponse('0b7c3f1e-1111-4222-8333-944455556666')]);
      const transport = await createEmailTransport(
        { kind: 'resend', apiKeyFile: path },
        { environment: 'production', linkOrigin: LINK_ORIGIN, resend: env.dependencies },
      );

      expect(transport.kind).toBe('resend');
      expect(inspect(transport, { depth: 10, showHidden: true })).not.toContain(key);
      expect(JSON.stringify(transport)).not.toContain(key);

      const result = await transport.send(syntheticMessage());
      expect(result).toEqual({
        status: 'accepted',
        providerMessageId: '0b7c3f1e-1111-4222-8333-944455556666',
        attempts: 1,
      });
      expect(new Headers(env.calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${key}`);
    });
  });
});
