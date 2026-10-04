import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open as openFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EmailSettings } from '../../src/email/config.ts';
import { EmailConfigurationError } from '../../src/email/errors.ts';
import type { SecretFileOpener } from '../../src/email/secret-file.ts';
import {
  createCaptureTransport,
  createDisabledTransport,
  createEmailDelivery,
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

/**
 * The running server's delivery (checkpoint 4D, DEC-489): built once at
 * startup from validated settings. Disabled builds nothing; Resend reads its
 * key only through the secure secret-file loader.
 */
describe('email delivery built from running-server settings', () => {
  const FROM = { address: 'no-reply@notify.example.test', name: 'DROMEX' };
  const REPLY_TO = 'support@example.test';

  function resendSettings(apiKeyFile: string): EmailSettings {
    return { kind: 'resend', apiKeyFile, from: FROM, replyTo: REPLY_TO, linkOrigin: LINK_ORIGIN };
  }

  function recordingOpener(delegate?: SecretFileOpener) {
    const calls: Array<{ path: string; flags: number }> = [];
    const open: SecretFileOpener = async (path, flags) => {
      calls.push({ path, flags });
      if (delegate === undefined) throw new Error('must not open');
      return delegate(path, flags);
    };
    return { open, calls };
  }

  it('builds nothing when disabled: no transport, no secret file, no network', async () => {
    const network = watchNetwork();
    const opener = recordingOpener();
    for (const environment of ['development', 'test', 'production'] as const) {
      const delivery = await createEmailDelivery({ kind: 'disabled' }, { environment, secretFile: { open: opener.open } });
      expect(delivery).toBeNull();
    }
    expect(opener.calls).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  });

  it('fails closed for Resend on a platform that cannot protect the key file, without opening it', async () => {
    const opener = recordingOpener();
    await expect(
      createEmailDelivery(resendSettings('/run/secrets/synthetic'), {
        environment: 'production',
        secretFile: { platform: 'win32', open: opener.open },
      }),
    ).rejects.toMatchObject({ code: 'platform_unsupported' });
    expect(opener.calls).toEqual([]);
  });

  it('refuses the capture kind even if it reaches the builder', async () => {
    await expect(
      createEmailDelivery({ kind: 'capture' } as never, { environment: 'test' }),
    ).rejects.toMatchObject({ code: 'transport_unsupported' });
  });

  describe.runIf(process.platform !== 'win32')('with synthetic key files', () => {
    let directory: string | undefined;

    afterEach(async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
      directory = undefined;
    });

    async function keyFile(content: string | Buffer, mode = 0o600): Promise<string> {
      directory ??= await mkdtemp(join(tmpdir(), 'dromex-email-delivery-'));
      const path = join(directory, `key-${Math.random().toString(16).slice(2)}`);
      await writeFile(path, content, { mode });
      await chmod(path, mode);
      return path;
    }

    it('reads the key once through the secure loader and returns the configured identity', async () => {
      const key = syntheticApiKey();
      const path = await keyFile(`${key}\n`);
      const opener = recordingOpener((file, flags) => openFile(file, flags));
      const env = fakeResendEnvironment([acceptedResponse('0b7c3f1e-1111-4222-8333-944455556666')]);

      const delivery = await createEmailDelivery(resendSettings(path), {
        environment: 'production',
        secretFile: { open: opener.open },
        resend: env.dependencies,
      });

      expect(opener.calls).toHaveLength(1);
      expect(opener.calls[0]!.path).toBe(path);
      expect(opener.calls[0]!.flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
      expect(opener.calls[0]!.flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
      expect(env.calls).toEqual([]);

      expect(delivery).not.toBeNull();
      expect(delivery!.transport.kind).toBe('resend');
      expect({ from: delivery!.from, replyTo: delivery!.replyTo, linkOrigin: delivery!.linkOrigin }).toEqual({
        from: FROM,
        replyTo: REPLY_TO,
        linkOrigin: LINK_ORIGIN,
      });
      expect(inspect(delivery, { depth: 10, showHidden: true })).not.toContain(key);
      expect(JSON.stringify(delivery)).not.toContain(key);

      expect(await delivery!.transport.send(syntheticMessage())).toMatchObject({ status: 'accepted' });
      expect(new Headers(env.calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${key}`);
      expect(opener.calls).toHaveLength(1);
    });

    it('refuses every unsafe key file with a fixed message that names neither the path nor the content', async () => {
      const key = syntheticApiKey();
      directory = await mkdtemp(join(tmpdir(), 'dromex-email-delivery-'));
      const target = await keyFile(`${key}\n`);
      const link = join(directory, 'link');
      await symlink(target, link);
      const folder = join(directory, 'folder');
      await mkdir(folder, { mode: 0o700 });
      const fifo = join(directory, 'fifo');
      execFileSync('mkfifo', ['-m', '600', fifo]);
      const unreadable = await keyFile(`${key}\n`, 0o000);

      const cases: Array<[string, string, string[]]> = [
        ['missing', join(directory, 'absent'), ['api_key_file_unavailable']],
        ['empty', await keyFile(''), ['api_key_file_size']],
        ['oversized', await keyFile(`re_${'a'.repeat(600)}`), ['api_key_file_size']],
        ['group-readable', await keyFile(`${key}\n`, 0o640), ['api_key_file_permissions']],
        ['world-readable', await keyFile(`${key}\n`, 0o604), ['api_key_file_permissions']],
        ['symbolic link', link, ['api_key_file_symlink']],
        ['directory', folder, ['api_key_file_not_regular', 'api_key_file_unavailable']],
        ['fifo', fifo, ['api_key_file_not_regular']],
        ['two keys', await keyFile(`${key}\n${key}\n`), ['api_key_malformed']],
        ['not UTF-8', await keyFile(Buffer.from([0x72, 0x65, 0x5f, 0xff, 0xfe, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41])), ['api_key_malformed']],
        // Root reads any file regardless of mode, so only a non-root run can observe this refusal.
        ...(process.getuid?.() === 0 ? [] : [['unreadable', unreadable, ['api_key_file_unavailable', 'api_key_file_permissions']] as [string, string, string[]]]),
      ];

      const consoleCalls = watchConsole();
      for (const [label, path, codes] of cases) {
        let caught: unknown;
        try {
          await createEmailDelivery(resendSettings(path), { environment: 'production' });
        } catch (error) {
          caught = error;
        }
        expect(caught, label).toBeInstanceOf(EmailConfigurationError);
        expect(codes, label).toContain((caught as EmailConfigurationError).code);
        const text = `${String(caught)}\n${(caught as Error).stack ?? ''}`;
        expect(text, label).not.toContain(path);
        expect(text, label).not.toContain(directory);
        expect(text, label).not.toContain(key);
      }
      expect(consoleCalls()).toEqual([]);
    });
  });
});
