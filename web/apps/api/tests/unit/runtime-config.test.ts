import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig } from '../../src/config/runtime.ts';
import { syntheticSecret } from '../helpers/auth-settings.ts';

const REQUIRED = [
  'DATABASE_URL',
  'DROMEX_ENVIRONMENT',
  'DROMEX_AUTH_SECRETS',
  'DROMEX_AUTH_BASE_URL',
  'DROMEX_AUTH_TRUSTED_ORIGINS',
] as const;

function validEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgresql://127.0.0.1:1/unused',
    DROMEX_ENVIRONMENT: 'development',
    DROMEX_AUTH_SECRETS: `1:${syntheticSecret()}`,
    DROMEX_AUTH_BASE_URL: 'http://127.0.0.1:3000',
    DROMEX_AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:5173',
    ...overrides,
  };
}

function rejection(environment: Record<string, string | undefined>): string {
  try {
    loadRuntimeConfig(environment);
  } catch (error) {
    return `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
  }
  throw new Error('expected the environment to be rejected');
}

describe('runtime configuration', () => {
  it('parses a complete environment', () => {
    const [newer, older] = [syntheticSecret(), syntheticSecret()];
    const environment = validEnvironment({
      DROMEX_AUTH_SECRETS: `2:${newer},1:${older}`,
      DROMEX_AUTH_TRUSTED_ORIGINS: ' http://127.0.0.1:5173 , http://localhost:5173 ',
    });

    const config = loadRuntimeConfig(environment);

    expect(config.databaseUrl).toBe('postgresql://127.0.0.1:1/unused');
    expect(config.auth.environment).toBe('development');
    expect(config.auth.secrets).toEqual([
      { version: 2, value: newer },
      { version: 1, value: older },
    ]);
    expect(config.auth).not.toHaveProperty('secret');
    expect(config.auth.baseURL).toBe('http://127.0.0.1:3000');
    expect(config.auth.trustedOrigins).toEqual(['http://127.0.0.1:5173', 'http://localhost:5173']);
    expect(config.auth.allowInsecureCookies).toBe(false);
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
  });

  it('refuses to start when any required variable is missing or empty, naming it without echoing values', () => {
    for (const name of REQUIRED) {
      const environment = validEnvironment();
      for (const absent of [undefined, '', '   ']) {
        const text = rejection({ ...environment, [name]: absent });
        expect(text).toContain(name);
        expect(text).not.toContain(environment.DROMEX_AUTH_SECRETS.slice(2));
        expect(text).not.toContain('127.0.0.1');
      }
    }
  });

  it.each([
    ['no version separator', 'abcdef'],
    ['an empty version', ':value-that-is-long-enough-to-pass-anything'],
    ['a non-numeric version', 'v1:value-that-is-long-enough-to-pass-anything'],
    ['version zero', '0:value-that-is-long-enough-to-pass-anything'],
    ['a leading-zero version', '01:value-that-is-long-enough-to-pass-anything'],
    ['whitespace around an entry', ' 1:value-that-is-long-enough-to-pass-anything'],
    ['whitespace inside a value', '1:value that is long enough to pass anything'],
    ['an empty value', '1:'],
    ['an empty entry', '1:value-that-is-long-enough-to-pass-anything,,2:another-value-long-enough-here'],
  ])('refuses DROMEX_AUTH_SECRETS with %s, without echoing it', (_label, value) => {
    const text = rejection(validEnvironment({ DROMEX_AUTH_SECRETS: value }));

    expect(text).toContain('DROMEX_AUTH_SECRETS');
    expect(text).not.toContain('value-that-is-long-enough');
    expect(text).not.toContain('value that is long');
  });

  it('refuses the retired single-secret variable rather than guessing which to use', () => {
    const legacy = syntheticSecret();
    const text = rejection(validEnvironment({ DROMEX_AUTH_SECRET: legacy }));

    expect(text).toContain('DROMEX_AUTH_SECRET');
    expect(text).not.toContain(legacy);
  });

  it.each(['BETTER_AUTH_SECRETS', 'BETTER_AUTH_SECRET', 'AUTH_SECRET'])(
    'refuses an ambient %s that Better Auth would otherwise read on its own',
    (name) => {
      const ambient = `9:${syntheticSecret()}`;
      const text = rejection(validEnvironment({ [name]: ambient }));

      expect(text).toContain(name);
      expect(text).not.toContain(ambient);
    },
  );

  it('ignores an empty ambient Better Auth variable, which Better Auth itself ignores', () => {
    expect(() => loadRuntimeConfig(validEnvironment({ BETTER_AUTH_SECRETS: '' }))).not.toThrow();
  });

  it('refuses an unrecognised environment name without echoing it', () => {
    const text = rejection(validEnvironment({ DROMEX_ENVIRONMENT: 'staging-bogus' }));

    expect(text).toMatch(/DROMEX_ENVIRONMENT/);
    expect(text.split('\n')[0]).not.toContain('staging-bogus');
  });

  it('accepts only an explicit true or false for the insecure-cookie flag', () => {
    expect(
      loadRuntimeConfig(validEnvironment({ DROMEX_AUTH_ALLOW_INSECURE_COOKIES: 'true' })).auth
        .allowInsecureCookies,
    ).toBe(true);
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
