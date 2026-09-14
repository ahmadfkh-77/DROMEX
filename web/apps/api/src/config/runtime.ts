import type { AuthEnvironment, AuthSecret, AuthSettings } from '../auth/config.ts';

/**
 * Validated process configuration, read once at process start.
 *
 * The environment arrives as a parameter rather than being read from
 * `process.env` here, so only the entry point touches the real environment
 * and tests pass plain objects. This module never loads a `.env` file.
 *
 * Error messages name the offending variable and never include a value,
 * because a misconfigured value may itself be a secret.
 *
 * Only presence and simple shape are checked here. Secret shape, version
 * uniqueness, origin normalisation, and the insecure-cookie rule are enforced
 * by `createAuthOptions`, which is the single place those rules live.
 */

export interface RuntimeConfig {
  databaseUrl: string;
  host: string;
  port: number;
  auth: AuthSettings;
}

type Environment = Readonly<Record<string, string | undefined>>;

const ENVIRONMENTS: readonly AuthEnvironment[] = ['development', 'test', 'production'];

/**
 * Variables Better Auth reads from the process environment by itself when
 * `secrets` is not configured explicitly. DROMEX always configures it, but a
 * leftover value is still refused: two sources for one secret is exactly the
 * ambiguity that ends with data encrypted under a key nobody has recorded.
 */
const AMBIENT_BETTER_AUTH_SECRETS = ['BETTER_AUTH_SECRETS', 'BETTER_AUTH_SECRET', 'AUTH_SECRET'] as const;

/** `<version>:<value>`: a positive version with no leading zero, and no whitespace or comma in the value. */
const SECRET_ENTRY = /^([1-9][0-9]{0,8}):([^\s,]+)$/;

function required(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required and has no default.`);
  }
  return value;
}

function refuseAmbiguousSecrets(env: Environment): void {
  const legacy = env['DROMEX_AUTH_SECRET'];
  if (legacy !== undefined && legacy !== '') {
    throw new Error(
      'DROMEX_AUTH_SECRET is no longer supported: supply versioned secrets through DROMEX_AUTH_SECRETS. The value itself is not shown.',
    );
  }

  for (const name of AMBIENT_BETTER_AUTH_SECRETS) {
    const value = env[name];
    if (value !== undefined && value !== '') {
      throw new Error(
        `${name} is set in the environment. Better Auth can read it on its own, so DROMEX refuses to start rather than risk an ambiguous secret. Remove it and use DROMEX_AUTH_SECRETS. The value itself is not shown.`,
      );
    }
  }
}

/**
 * Parses `DROMEX_AUTH_SECRETS`, a comma-separated list of `<version>:<value>`
 * entries, for example `2:<current>,1:<previous>`.
 */
function parseSecrets(env: Environment): AuthSecret[] {
  const raw = required(env, 'DROMEX_AUTH_SECRETS');

  return raw.split(',').map((entry, index) => {
    const match = SECRET_ENTRY.exec(entry);
    if (!match) {
      throw new Error(
        `DROMEX_AUTH_SECRETS entry ${index + 1} is malformed: each entry must be <version>:<secret>, with a positive whole-number version and no whitespace. Values are not shown.`,
      );
    }
    return { version: Number(match[1]), value: match[2]! };
  });
}

function parseEnvironment(env: Environment): AuthEnvironment {
  const value = required(env, 'DROMEX_ENVIRONMENT');
  if (!ENVIRONMENTS.includes(value as AuthEnvironment)) {
    throw new Error(`DROMEX_ENVIRONMENT must be one of: ${ENVIRONMENTS.join(', ')}.`);
  }
  return value as AuthEnvironment;
}

function parseBoolean(env: Environment, name: string): boolean {
  const value = env[name];
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be exactly "true" or "false".`);
}

function parsePort(env: Environment): number {
  const value = env['API_PORT'];
  if (value === undefined || value === '') return 3000;

  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

export function loadRuntimeConfig(env: Environment): RuntimeConfig {
  refuseAmbiguousSecrets(env);
  const host = env['API_HOST'];

  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    host: host !== undefined && host.trim() !== '' ? host : '0.0.0.0',
    port: parsePort(env),
    auth: {
      environment: parseEnvironment(env),
      secrets: parseSecrets(env),
      baseURL: required(env, 'DROMEX_AUTH_BASE_URL'),
      trustedOrigins: required(env, 'DROMEX_AUTH_TRUSTED_ORIGINS')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
      allowInsecureCookies: parseBoolean(env, 'DROMEX_AUTH_ALLOW_INSECURE_COOKIES'),
    },
  };
}
