import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  RecoveryConfigurationError,
  loadRecoveryConfiguration,
  type RecoveryFileSystem,
} from '../../src/provisioning/recovery-config.ts';
import { syntheticSecret } from '../helpers/auth-settings.ts';

// Every value here is synthetic. None may appear in an error.
const SECRET = syntheticSecret();
const URL_SECRET = 'synthetic_url_secret_value';
const DATABASE_URL = `postgresql://synthetic_user:${URL_SECRET}@127.0.0.1:5432/synthetic_db`;
const PATHS = { configFile: '/synthetic/secret-dir/config.json', databaseUrlFile: '/synthetic/secret-dir/database-url' };

function config(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'test',
    baseURL: 'http://127.0.0.1:3000',
    trustedOrigins: ['http://127.0.0.1:5173'],
    secrets: [{ version: 1, value: SECRET }],
    ...overrides,
  };
}

interface MemoryFile {
  text: string;
  mode?: number;
  isFile?: boolean;
}

function memoryFs(files: Record<string, MemoryFile>): RecoveryFileSystem {
  return {
    async stat(path) {
      const file = files[path];
      if (!file) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return { isFile: () => file.isFile ?? true, size: Buffer.byteLength(file.text), mode: file.mode ?? 0o100600 };
    },
    async readFile(path) {
      const file = files[path];
      if (!file) throw new Error(`ENOENT: ${path}`);
      return file.text;
    },
  };
}

function files(overrides: Partial<Record<'config' | 'url', MemoryFile>> = {}): Record<string, MemoryFile> {
  return {
    [PATHS.configFile]: overrides.config ?? { text: JSON.stringify(config()) },
    [PATHS.databaseUrlFile]: overrides.url ?? { text: `${DATABASE_URL}\n` },
  };
}

function load(fileSet: Record<string, MemoryFile>, platform: NodeJS.Platform = 'linux') {
  return loadRecoveryConfiguration(PATHS, { fs: memoryFs(fileSet), platform });
}

async function refusal(promise: Promise<unknown>): Promise<RecoveryConfigurationError> {
  const outcome = await promise.then(
    () => new Error('expected the configuration to be refused'),
    (error: unknown) => error,
  );
  if (!(outcome instanceof RecoveryConfigurationError)) throw outcome;
  const text = `${outcome.message}\n${outcome.stack ?? ''}`;
  for (const leak of [SECRET, URL_SECRET, 'synthetic_user', 'secret-dir', 'ENOENT']) expect(text).not.toContain(leak);
  return outcome;
}

const directories: string[] = [];

describe('terminal recovery configuration files', () => {
  afterEach(async () => {
    while (directories.length > 0) await rm(directories.pop()!, { recursive: true, force: true });
  });

  it('loads validated settings and the connection string from owner-only files', async () => {
    const loaded = await load(files());

    expect(loaded.databaseUrl).toBe(DATABASE_URL);
    expect(loaded.settings).toEqual({
      environment: 'test',
      baseURL: 'http://127.0.0.1:3000',
      trustedOrigins: ['http://127.0.0.1:5173'],
      secrets: [{ version: 1, value: SECRET }],
    });
  });

  it.each([0o100640, 0o100604, 0o100660, 0o100666])(
    'refuses a configuration file with POSIX mode %o readable beyond its owner',
    async (mode) => {
      const error = await refusal(load(files({ config: { text: JSON.stringify(config()), mode } })));
      expect(error.code).toBe('config_permissions');
    },
  );

  it('refuses a database URL file readable beyond its owner', async () => {
    const error = await refusal(load(files({ url: { text: DATABASE_URL, mode: 0o100644 } })));
    expect(error.code).toBe('database_url_permissions');
  });

  it('does not interpret POSIX mode bits on Windows, where the file ACL governs access', async () => {
    const loaded = await load(files({ config: { text: JSON.stringify(config()), mode: 0o100666 } }), 'win32');
    expect(loaded.databaseUrl).toBe(DATABASE_URL);
  });

  it('refuses a missing, non-regular, empty, or oversized configuration file', async () => {
    expect((await refusal(load({ [PATHS.databaseUrlFile]: { text: DATABASE_URL } }))).code).toBe('config_unavailable');
    expect((await refusal(load(files({ config: { text: '{}', isFile: false } })))).code).toBe('config_unavailable');
    expect((await refusal(load(files({ config: { text: '' } })))).code).toBe('config_unavailable');
    expect((await refusal(load(files({ config: { text: ' '.repeat(16_385) } })))).code).toBe('config_unavailable');
  });

  it('refuses a missing, empty, or oversized database URL file', async () => {
    expect((await refusal(load({ [PATHS.configFile]: { text: JSON.stringify(config()) } }))).code).toBe(
      'database_url_unavailable',
    );
    expect((await refusal(load(files({ url: { text: '' } })))).code).toBe('database_url_unavailable');
    expect((await refusal(load(files({ url: { text: `postgresql://${'a'.repeat(4096)}` } })))).code).toBe(
      'database_url_unavailable',
    );
  });

  it.each<[string, string]>([
    ['malformed JSON', `{"secrets": "${SECRET}"`],
    ['a non-object', JSON.stringify([config()])],
    ['an unknown key', JSON.stringify({ ...config(), password: SECRET })],
    ['a missing key', JSON.stringify({ environment: 'test', secrets: [{ version: 1, value: SECRET }] })],
    ['a secret entry with an extra key', JSON.stringify(config({ secrets: [{ version: 1, value: SECRET, note: SECRET }] }))],
    ['a secret entry with a string version', JSON.stringify(config({ secrets: [{ version: '1', value: SECRET }] }))],
    ['an origin that is not a string', JSON.stringify(config({ trustedOrigins: [1] }))],
    ['a non-boolean insecure-cookie flag', JSON.stringify(config({ allowInsecureCookies: 'yes' }))],
    ['a secret Better Auth would refuse', JSON.stringify(config({ secrets: [{ version: 1, value: 'short' }] }))],
    ['an unknown environment', JSON.stringify(config({ environment: 'staging' }))],
  ])('refuses %s without echoing it', async (_label, text) => {
    expect((await refusal(load(files({ config: { text } })))).code).toBe('config_invalid');
  });

  it.each<[string, string]>([
    ['a non-PostgreSQL scheme', `mysql://synthetic_user:${URL_SECRET}@127.0.0.1/db`],
    ['embedded whitespace', `postgresql://synthetic_user:${URL_SECRET} @127.0.0.1/db`],
    ['a second line', `${DATABASE_URL}\n${DATABASE_URL}\n`],
  ])('refuses a database URL with %s without echoing it', async (_label, text) => {
    expect((await refusal(load(files({ url: { text } })))).code).toBe('database_url_invalid');
  });

  it('reads real owner-only files through the default file system', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dromex-recovery-config-'));
    directories.push(directory);
    const configFile = join(directory, 'config.json');
    const databaseUrlFile = join(directory, 'database-url');
    await writeFile(configFile, JSON.stringify(config()), { mode: 0o600 });
    await writeFile(databaseUrlFile, `${DATABASE_URL}\n`, { mode: 0o600 });

    const loaded = await loadRecoveryConfiguration({ configFile, databaseUrlFile });

    expect(loaded.databaseUrl).toBe(DATABASE_URL);
    expect(loaded.settings.secrets).toEqual([{ version: 1, value: SECRET }]);
  });
});
