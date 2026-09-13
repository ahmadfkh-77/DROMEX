import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig } from '../../src/config/runtime.ts';

const REQUIRED = [
  'DATABASE_URL',
  'DROMEX_ENVIRONMENT',
  'DROMEX_AUTH_SECRET',
  'DROMEX_AUTH_BASE_URL',
  'DROMEX_AUTH_TRUSTED_ORIGINS',
] as const;

function validEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgresql://127.0.0.1:1/unused',
    DROMEX_ENVIRONMENT: 'development',
    DROMEX_AUTH_SECRET: randomBytes(32).toString('hex'),
    DROMEX_AUTH_BASE_URL: 'http://127.0.0.1:3000',
    DROMEX_AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:5173',
    ...overrides,
  };
}

describe('runtime configuration', () => {
  it('parses a complete environment', () => {
    const environment = validEnvironment({
      DROMEX_AUTH_TRUSTED_ORIGINS: ' http://127.0.0.1:5173 , http://localhost:5173 ',
    });

    const config = loadRuntimeConfig(environment);

    expect(config.databaseUrl).toBe('postgresql://127.0.0.1:1/unused');
    expect(config.auth.environment).toBe('development');
    expect(config.auth.secret).toBe(environment.DROMEX_AUTH_SECRET);
    expect(config.auth.baseURL).toBe('http://127.0.0.1:3000');
    expect(config.auth.trustedOrigins).toEqual(['http://127.0.0.1:5173', 'http://localhost:5173']);
    expect(config.auth.allowInsecureCookies).toBe(false);
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
  });

  it('refuses to start when any required variable is missing or empty, naming it without echoing values', () => {
    for (const name of REQUIRED) {
      const environment = validEnvironment();
      const secret = environment.DROMEX_AUTH_SECRET;

      for (const absent of [undefined, '', '   ']) {
        try {
          loadRuntimeConfig({ ...environment, [name]: absent });
          throw new Error(`expected ${name}=${String(absent)} to be rejected`);
        } catch (error) {
          const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
          expect(text).toContain(name);
          expect(text).not.toContain(secret);
          expect(text).not.toContain('127.0.0.1');
        }
      }
    }
  });

  it('refuses an unrecognised environment name without echoing it', () => {
    expect(() => loadRuntimeConfig(validEnvironment({ DROMEX_ENVIRONMENT: 'staging-bogus' }))).toThrow(
      /DROMEX_ENVIRONMENT/,
    );

    try {
      loadRuntimeConfig(validEnvironment({ DROMEX_ENVIRONMENT: 'staging-bogus' }));
    } catch (error) {
      expect((error as Error).message).not.toContain('staging-bogus');
    }
  });

  it('accepts only an explicit true or false for the insecure-cookie flag', () => {
    expect(
      loadRuntimeConfig(validEnvironment({ DROMEX_AUTH_ALLOW_INSECURE_COOKIES: 'true' })).auth
        .allowInsecureCookies,
    ).toBe(true);
    expect(
      loadRuntimeConfig(validEnvironment({ DROMEX_AUTH_ALLOW_INSECURE_COOKIES: 'false' })).auth
        .allowInsecureCookies,
    ).toBe(false);
    expect(() =>
      loadRuntimeConfig(validEnvironment({ DROMEX_AUTH_ALLOW_INSECURE_COOKIES: 'yes' })),
    ).toThrow(/DROMEX_AUTH_ALLOW_INSECURE_COOKIES/);
  });

  it('refuses an invalid listening port', () => {
    for (const port of ['abc', '0', '70000', '3000.5']) {
      expect(() => loadRuntimeConfig(validEnvironment({ API_PORT: port }))).toThrow(/API_PORT/);
    }
  });
});
