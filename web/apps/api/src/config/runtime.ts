import type { AuthEnvironment, AuthSettings } from '../auth/config.ts';

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
 * Only presence and simple shape are checked here. Secret shape, origin
 * normalisation, and the insecure-cookie rule are enforced by
 * `createAuthOptions`, which is the single place those rules live.
 */

export interface RuntimeConfig {
  databaseUrl: string;
  host: string;
  port: number;
  auth: AuthSettings;
}

type Environment = Readonly<Record<string, string | undefined>>;

const ENVIRONMENTS: readonly AuthEnvironment[] = ['development', 'test', 'production'];

function required(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required and has no default.`);
  }
  return value;
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
  const host = env['API_HOST'];

  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    host: host !== undefined && host.trim() !== '' ? host : '0.0.0.0',
    port: parsePort(env),
    auth: {
      environment: parseEnvironment(env),
      secret: required(env, 'DROMEX_AUTH_SECRET'),
      baseURL: required(env, 'DROMEX_AUTH_BASE_URL'),
      trustedOrigins: required(env, 'DROMEX_AUTH_TRUSTED_ORIGINS')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
      allowInsecureCookies: parseBoolean(env, 'DROMEX_AUTH_ALLOW_INSECURE_COOKIES'),
    },
  };
}
