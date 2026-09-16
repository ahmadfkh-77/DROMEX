import { constants } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { EmailConfigurationError } from './errors.ts';

/**
 * Secure loader for the Resend API key file (DEC-439).
 *
 * The API receives only a path. The file is opened once, read-only, with
 * `O_NOFOLLOW` (a symbolic link as the final component is refused by the
 * kernel) and `O_NONBLOCK` (a FIFO cannot stall startup), and every check is
 * made on the opened descriptor with `fstat`, so the file inspected is the
 * file read. It must be a regular file of at most `MAX_API_KEY_FILE_BYTES`
 * with no group or other permission bit, and hold exactly one key, optionally
 * followed by one `\n` or `\r\n`. Nothing is copied, cached, or written.
 *
 * Windows is refused outright: POSIX mode bits carry no meaning there and
 * Node offers no no-follow open, so no equivalent guarantee can be claimed.
 *
 * Errors are fixed messages that never contain the path or any content.
 *
 * Memory: the read buffer is zeroed before returning, but the key must become
 * a JavaScript string to be used in a request header, and strings are
 * immutable and garbage-collected. No JavaScript code can reliably erase that
 * string from process memory, so a process-memory disclosure (a core dump, a
 * heap snapshot, an attached inspector) can still reveal the key. Protecting the process
 * itself remains an operational control.
 */

export interface SecretFileStat {
  isFile(): boolean;
  size: number;
  mode: number;
}

export interface SecretFileHandle {
  stat(): Promise<SecretFileStat>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export type SecretFileOpener = (path: string, flags: number) => Promise<SecretFileHandle>;

export interface SecretFileOptions {
  platform?: NodeJS.Platform;
  open?: SecretFileOpener;
}

export const MAX_API_KEY_FILE_BYTES = 512;

const GROUP_OR_OTHER_BITS = 0o077;

/**
 * The key shape Resend's documentation shows (`re_` followed by the key
 * body). Anything else, including internal whitespace, is refused.
 */
const RESEND_API_KEY = /^re_[A-Za-z0-9_-]{8,250}$/;

const nodeOpener: SecretFileOpener = (path, flags) => openFile(path, flags);

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

async function readAll(handle: SecretFileHandle): Promise<Buffer> {
  const buffer = Buffer.alloc(MAX_API_KEY_FILE_BYTES + 1);
  let total = 0;
  // Bounded: every iteration either reads at least one byte toward a fixed
  // capacity or stops.
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  if (total === 0 || total > MAX_API_KEY_FILE_BYTES) {
    buffer.fill(0);
    throw new EmailConfigurationError('api_key_file_size');
  }
  return buffer.subarray(0, total);
}

function decodeKey(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new EmailConfigurationError('api_key_malformed');
  }
  const key = text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text;
  if (!RESEND_API_KEY.test(key)) throw new EmailConfigurationError('api_key_malformed');
  return key;
}

export async function loadResendApiKey(path: string, options: SecretFileOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') throw new EmailConfigurationError('platform_unsupported');
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new EmailConfigurationError('api_key_path_not_absolute');
  }
  if (constants.O_NOFOLLOW === undefined || constants.O_NONBLOCK === undefined) {
    throw new EmailConfigurationError('platform_unsupported');
  }

  let handle: SecretFileHandle;
  try {
    handle = await (options.open ?? nodeOpener)(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    throw new EmailConfigurationError(codeOf(error) === 'ELOOP' ? 'api_key_file_symlink' : 'api_key_file_unavailable');
  }

  let bytes: Buffer | undefined;
  try {
    let info: SecretFileStat;
    try {
      info = await handle.stat();
    } catch {
      throw new EmailConfigurationError('api_key_file_unavailable');
    }
    if (!info.isFile()) throw new EmailConfigurationError('api_key_file_not_regular');
    if ((info.mode & GROUP_OR_OTHER_BITS) !== 0) throw new EmailConfigurationError('api_key_file_permissions');
    if (info.size === 0 || info.size > MAX_API_KEY_FILE_BYTES) throw new EmailConfigurationError('api_key_file_size');

    try {
      bytes = await readAll(handle);
    } catch (error) {
      if (error instanceof EmailConfigurationError) throw error;
      throw new EmailConfigurationError('api_key_file_unavailable');
    }
    return decodeKey(bytes);
  } finally {
    bytes?.fill(0);
    await handle.close().catch(() => undefined);
  }
}
