import { readFile, stat } from 'node:fs/promises';

import { Pool } from 'pg';

import { createAuthOptions, type AuthEnvironment, type AuthSecret, type AuthSettings } from '../auth/config.ts';

/**
 * Loads terminal Owner recovery configuration from two operator-supplied file
 * paths (DEC-437): one holding the authentication configuration as JSON, one
 * holding the database connection string. Nothing is read from the
 * environment, the command line, or a `.env` file.
 *
 * Each file must be a small regular file. On POSIX systems it must also be
 * readable by its owner only (no group or other permission bits); on Windows
 * POSIX mode bits carry no meaning, so the file's ACL governs access and is
 * the operator's responsibility.
 *
 * The configuration is checked for exactly the expected shape and then run
 * through the same validation the API applies at startup. Every error is a
 * fixed message: no path, value, or underlying error is ever repeated,
 * because any of them may carry a secret.
 *
 * Not yet wired to the command, which refuses every run until a separate
 * reviewed decision enables it.
 */

export interface RecoveryFileSystem {
  stat(path: string): Promise<{ isFile(): boolean; size: number; mode: number }>;
  readFile(path: string): Promise<string>;
}

export type RecoveryConfigurationCode =
  | 'config_unavailable'
  | 'config_permissions'
  | 'config_invalid'
  | 'database_url_unavailable'
  | 'database_url_permissions'
  | 'database_url_invalid';

const MESSAGES: Record<RecoveryConfigurationCode, string> = {
  config_unavailable: 'The configuration file could not be read as a small, non-empty regular file. Its path and contents are not shown.',
  config_permissions: 'The configuration file must be readable only by its owner. Its path and contents are not shown.',
  config_invalid: 'The configuration file is not a valid recovery configuration. Its contents are not shown.',
  database_url_unavailable:
    'The database URL file could not be read as a small, non-empty regular file. Its path and contents are not shown.',
  database_url_permissions: 'The database URL file must be readable only by its owner. Its path and contents are not shown.',
  database_url_invalid: 'The database URL file does not hold one PostgreSQL connection string. Its contents are not shown.',
};

export class RecoveryConfigurationError extends Error {
  readonly code: RecoveryConfigurationCode;

  constructor(code: RecoveryConfigurationCode) {
    super(MESSAGES[code]);
    this.name = 'RecoveryConfigurationError';
    this.code = code;
  }
}

export interface RecoveryConfiguration {
  settings: AuthSettings;
  databaseUrl: string;
}

const MAX_CONFIG_BYTES = 16_384;
const MAX_DATABASE_URL_BYTES = 4_096;
const GROUP_OR_OTHER_BITS = 0o077;

const CONFIG_KEYS = new Set(['environment', 'baseURL', 'trustedOrigins', 'secrets', 'allowInsecureCookies']);
const REQUIRED_CONFIG_KEYS = ['environment', 'baseURL', 'trustedOrigins', 'secrets'];
const ENVIRONMENTS: readonly AuthEnvironment[] = ['development', 'test', 'production'];
const DATABASE_URL = /^postgres(?:ql)?:\/\/\S+$/;

const nodeFileSystem: RecoveryFileSystem = {
  stat: (path) => stat(path),
  readFile: (path) => readFile(path, 'utf8'),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readProtectedFile(
  fs: RecoveryFileSystem,
  path: string,
  maxBytes: number,
  platform: NodeJS.Platform,
  codes: { unavailable: RecoveryConfigurationCode; permissions: RecoveryConfigurationCode },
): Promise<string> {
  let info: Awaited<ReturnType<RecoveryFileSystem['stat']>>;
  try {
    info = await fs.stat(path);
  } catch {
    throw new RecoveryConfigurationError(codes.unavailable);
  }
  if (!info.isFile() || info.size === 0 || info.size > maxBytes) throw new RecoveryConfigurationError(codes.unavailable);
  if (platform !== 'win32' && (info.mode & GROUP_OR_OTHER_BITS) !== 0) {
    throw new RecoveryConfigurationError(codes.permissions);
  }

  let text: string;
  try {
    text = await fs.readFile(path);
  } catch {
    throw new RecoveryConfigurationError(codes.unavailable);
  }
  if (text.length === 0 || Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new RecoveryConfigurationError(codes.unavailable);
  }
  return text;
}

function isSecretEntry(value: unknown): value is AuthSecret {
  return (
    isPlainObject(value) &&
    Object.keys(value).sort().join(',') === 'value,version' &&
    typeof value['version'] === 'number' &&
    typeof value['value'] === 'string'
  );
}

function parseSettings(text: string): AuthSettings {
  const invalid = () => new RecoveryConfigurationError('config_invalid');

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (!isPlainObject(value)) throw invalid();
  if (Object.keys(value).some((key) => !CONFIG_KEYS.has(key))) throw invalid();
  if (REQUIRED_CONFIG_KEYS.some((key) => !(key in value))) throw invalid();

  const { environment, baseURL, trustedOrigins, secrets, allowInsecureCookies } = value;
  if (typeof environment !== 'string' || !ENVIRONMENTS.includes(environment as AuthEnvironment)) throw invalid();
  if (typeof baseURL !== 'string') throw invalid();
  if (!Array.isArray(trustedOrigins) || !trustedOrigins.every((origin) => typeof origin === 'string')) throw invalid();
  if (!Array.isArray(secrets) || !secrets.every(isSecretEntry)) throw invalid();
  if (allowInsecureCookies !== undefined && typeof allowInsecureCookies !== 'boolean') throw invalid();

  return {
    environment: environment as AuthEnvironment,
    baseURL,
    trustedOrigins: [...(trustedOrigins as string[])],
    secrets: secrets.map((secret) => ({ version: secret.version, value: secret.value })),
    ...(allowInsecureCookies === undefined ? {} : { allowInsecureCookies }),
  };
}

/** Applies the API's own startup validation, against a pool that never connects. */
async function validateSettings(settings: AuthSettings): Promise<void> {
  const inert = new Pool({ max: 1 });
  try {
    createAuthOptions({ ...settings, database: inert });
  } catch {
    throw new RecoveryConfigurationError('config_invalid');
  } finally {
    await inert.end().catch(() => undefined);
  }
}

function parseDatabaseUrl(text: string): string {
  const line = text.endsWith('\n') ? text.slice(0, -1).replace(/\r$/, '') : text;
  if (!DATABASE_URL.test(line)) throw new RecoveryConfigurationError('database_url_invalid');
  return line;
}

export async function loadRecoveryConfiguration(
  files: { configFile: string; databaseUrlFile: string },
  options: { fs?: RecoveryFileSystem; platform?: NodeJS.Platform } = {},
): Promise<RecoveryConfiguration> {
  const fs = options.fs ?? nodeFileSystem;
  const platform = options.platform ?? process.platform;

  const configText = await readProtectedFile(fs, files.configFile, MAX_CONFIG_BYTES, platform, {
    unavailable: 'config_unavailable',
    permissions: 'config_permissions',
  });
  const databaseUrlText = await readProtectedFile(fs, files.databaseUrlFile, MAX_DATABASE_URL_BYTES, platform, {
    unavailable: 'database_url_unavailable',
    permissions: 'database_url_permissions',
  });

  const settings = parseSettings(configText);
  await validateSettings(settings);
  return { settings, databaseUrl: parseDatabaseUrl(databaseUrlText) };
}
