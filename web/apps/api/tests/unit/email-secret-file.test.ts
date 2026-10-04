import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EmailConfigurationError, type EmailConfigurationCode } from '../../src/email/errors.ts';
import { MAX_API_KEY_FILE_BYTES, loadResendApiKey, type SecretFileOpener } from '../../src/email/secret-file.ts';
import { syntheticApiKey, watchConsole } from '../helpers/email.ts';

// Real-file behaviour (O_NOFOLLOW, fstat, POSIX modes) exists only on POSIX.
// These run in the disposable Node 24.20.0 Linux container; on Windows the
// loader refuses outright, which the first block proves on every platform.
const POSIX = process.platform !== 'win32';

async function codeOf(promise: Promise<unknown>): Promise<EmailConfigurationCode | 'resolved'> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    expect(error).toBeInstanceOf(EmailConfigurationError);
    return (error as EmailConfigurationError).code;
  }
}

function neverOpen(): { open: SecretFileOpener; opened: () => number } {
  let count = 0;
  return {
    open: async () => {
      count += 1;
      throw new Error('must not open');
    },
    opened: () => count,
  };
}

describe('Resend API key file: refusals before any file is opened', () => {
  it('refuses the Windows platform without opening the file', async () => {
    const opener = neverOpen();
    expect(await codeOf(loadResendApiKey('C:\\secrets\\resend', { platform: 'win32', open: opener.open }))).toBe(
      'platform_unsupported',
    );
    expect(opener.opened()).toBe(0);
  });

  it('refuses a relative path without opening the file', async () => {
    const opener = neverOpen();
    for (const path of ['resend-key', './resend-key', '../secrets/resend-key', '']) {
      expect(await codeOf(loadResendApiKey(path, { platform: 'linux', open: opener.open })), path).toBe(
        'api_key_path_not_absolute',
      );
    }
    expect(opener.opened()).toBe(0);
  });
});

describe.runIf(POSIX)('Resend API key file on POSIX (synthetic temporary files only)', () => {
  let directory: string;
  let key: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dromex-email-key-'));
    key = syntheticApiKey();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function keyFile(content: string | Buffer, mode = 0o600, name = 'resend-key'): Promise<string> {
    const path = join(directory, name);
    await writeFile(path, content, { mode });
    await chmod(path, mode);
    return path;
  }

  function expectNoLeak(error: unknown, path: string): void {
    const text = `${String(error)}\n${(error as Error).stack ?? ''}\n${JSON.stringify(error)}`;
    expect(text).not.toContain(key);
    expect(text).not.toContain(path);
    expect(text).not.toContain(directory);
  }

  it('accepts an owner-only regular file and removes one terminal newline only', async () => {
    expect(await loadResendApiKey(await keyFile(`${key}\n`, 0o600, 'a'))).toBe(key);
    expect(await loadResendApiKey(await keyFile(`${key}\r\n`, 0o400, 'b'))).toBe(key);
    expect(await loadResendApiKey(await keyFile(key, 0o600, 'c'))).toBe(key);
  });

  it('opens with no-follow and non-blocking flags and inspects the opened descriptor', async () => {
    const path = await keyFile(`${key}\n`);
    const { constants, open } = await import('node:fs/promises').then(async (fs) => ({
      constants: (await import('node:fs')).constants,
      open: fs.open,
    }));
    const flagsSeen: number[] = [];
    const spyOpen: SecretFileOpener = async (target, flags) => {
      flagsSeen.push(flags);
      return open(target, flags);
    };

    expect(await loadResendApiKey(path, { open: spyOpen })).toBe(key);
    expect(flagsSeen).toHaveLength(1);
    expect(flagsSeen[0]! & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    expect(flagsSeen[0]! & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    expect(flagsSeen[0]! & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC)).toBe(0);
  });

  it('refuses a symbolic link, even to a valid owner-only key file', async () => {
    const target = await keyFile(`${key}\n`);
    const link = join(directory, 'link');
    await symlink(target, link);

    let caught: unknown;
    await loadResendApiKey(link).catch((error: unknown) => {
      caught = error;
    });
    expect((caught as EmailConfigurationError).code).toBe('api_key_file_symlink');
    expectNoLeak(caught, link);
  });

  it('refuses a directory and a FIFO without blocking', async () => {
    const dir = join(directory, 'dir');
    await mkdir(dir, { mode: 0o700 });
    expect(await codeOf(loadResendApiKey(dir))).toBe('api_key_file_not_regular');

    const fifo = join(directory, 'fifo');
    execFileSync('mkfifo', ['-m', '600', fifo]);
    expect(await codeOf(loadResendApiKey(fifo))).toBe('api_key_file_not_regular');
  });

  it('refuses a missing file without naming it', async () => {
    const missing = join(directory, 'missing');
    let caught: unknown;
    await loadResendApiKey(missing).catch((error: unknown) => {
      caught = error;
    });
    expect((caught as EmailConfigurationError).code).toBe('api_key_file_unavailable');
    expectNoLeak(caught, missing);
  });

  it('refuses an empty file and a file larger than the limit', async () => {
    expect(await codeOf(loadResendApiKey(await keyFile('', 0o600, 'empty')))).toBe('api_key_file_size');
    const oversized = `re_${'a'.repeat(MAX_API_KEY_FILE_BYTES)}`;
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(MAX_API_KEY_FILE_BYTES);
    expect(await codeOf(loadResendApiKey(await keyFile(oversized, 0o600, 'big')))).toBe('api_key_file_size');
  });

  it('refuses any group or other permission bit', async () => {
    for (const mode of [0o640, 0o620, 0o610, 0o604, 0o602, 0o601, 0o644, 0o666]) {
      const path = await keyFile(`${key}\n`, mode, `mode-${mode.toString(8)}`);
      let caught: unknown;
      await loadResendApiKey(path).catch((error: unknown) => {
        caught = error;
      });
      expect((caught as EmailConfigurationError).code, mode.toString(8)).toBe('api_key_file_permissions');
      expectNoLeak(caught, path);
    }
  });

  it('refuses malformed content without repeating it', async () => {
    const cases: Array<string | Buffer> = [
      '\n',
      'not-a-resend-key\n',
      `${key}\n\n`,
      `${key}\nsecond-line\n`,
      ` ${key}\n`,
      `${key} \n`,
      `${key.slice(0, 10)} ${key.slice(10)}\n`,
      `sk_${key.slice(3)}\n`,
      're_short\n',
      Buffer.from([0x72, 0x65, 0x5f, 0xff, 0xfe, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61]),
    ];
    for (const [index, content] of cases.entries()) {
      const path = await keyFile(content, 0o600, `malformed-${index}`);
      let caught: unknown;
      await loadResendApiKey(path).catch((error: unknown) => {
        caught = error;
      });
      expect((caught as EmailConfigurationError).code, String(index)).toBe('api_key_malformed');
      expectNoLeak(caught, path);
    }
  });

  it('writes nothing to the console on success or failure', async () => {
    const consoleCalls = watchConsole();
    await loadResendApiKey(await keyFile(`${key}\n`, 0o600, 'ok'));
    await loadResendApiKey(await keyFile(`${key}\n`, 0o644, 'bad')).catch(() => undefined);
    await loadResendApiKey(join(directory, 'missing')).catch(() => undefined);
    expect(consoleCalls()).toEqual([]);
  });

  it('closes the descriptor even when validation fails', async () => {
    const { open } = await import('node:fs/promises');
    let closed = 0;
    const trackingOpen: SecretFileOpener = async (target, flags) => {
      const handle = await open(target, flags);
      return {
        stat: () => handle.stat(),
        read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
        close: async () => {
          closed += 1;
          await handle.close();
        },
      };
    };
    await loadResendApiKey(await keyFile(`${key}\n`, 0o644, 'perm'), { open: trackingOpen }).catch(() => undefined);
    await loadResendApiKey(await keyFile('junk\n', 0o600, 'junk'), { open: trackingOpen }).catch(() => undefined);
    await loadResendApiKey(await keyFile(`${key}\n`, 0o600, 'good'), { open: trackingOpen });
    expect(closed).toBe(3);
  });
});
