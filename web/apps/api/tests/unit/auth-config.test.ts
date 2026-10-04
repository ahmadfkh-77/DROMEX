import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../../src/auth/hashing.ts';
import * as authConfigModule from '../../src/auth/config.ts';
import {
  DROMEX_CLIENT_IP_HEADER,
  authCookieNames,
  createAuthOptions,
} from '../../src/auth/config.ts';
import { generateRecoveryCodes } from '../../src/auth/recovery-codes.ts';
import { syntheticSecret } from '../helpers/auth-settings.ts';

// Port 1 is reserved and closed. `new Pool()` is lazy — pg opens no socket
// until a query runs, and no test here runs one. These stay Docker-free.
function inertPool(): Pool {
  return new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'development' as const,
    secrets: [{ version: 1, value: syntheticSecret() }],
    baseURL: 'http://127.0.0.1:3000',
    trustedOrigins: ['http://127.0.0.1:5173'],
    database: inertPool(),
    ...overrides,
  };
}

function errorText(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
  }
  throw new Error('expected the configuration to be rejected');
}

describe('authentication configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('email and password', () => {
    it('enables email and password authentication', () => {
      expect(createAuthOptions(baseInput()).emailAndPassword?.enabled).toBe(true);
    });

    it('disables public sign-up explicitly', () => {
      expect(createAuthOptions(baseInput()).emailAndPassword?.disableSignUp).toBe(true);
    });

    it('disables automatic sign-in after account creation', () => {
      expect(createAuthOptions(baseInput()).emailAndPassword?.autoSignIn).toBe(false);
    });

    it('enforces a 15 character minimum and 128 character maximum password', () => {
      const options = createAuthOptions(baseInput());

      expect(options.emailAndPassword?.minPasswordLength).toBe(15);
      expect(options.emailAndPassword?.maxPasswordLength).toBe(128);
    });

    it('uses the existing Argon2id wrapper for hashing', () => {
      expect(createAuthOptions(baseInput()).emailAndPassword?.password?.hash).toBe(hashPassword);
    });

    it('verifies through the Argon2id wrapper, adapting the argument shape', async () => {
      const verify = createAuthOptions(baseInput()).emailAndPassword?.password?.verify;
      expect(verify).toBeTypeOf('function');

      const password = 'a sufficiently long passphrase';
      const encoded = await hashPassword(password);

      await expect(verify!({ password, hash: encoded })).resolves.toBe(true);
      await expect(verify!({ password: 'wrong password here', hash: encoded })).resolves.toBe(
        false,
      );
    });
  });

  describe('sessions', () => {
    it('sets a 12 hour lifetime and a 1 hour update age', () => {
      const options = createAuthOptions(baseInput());

      expect(options.session?.expiresIn).toBe(12 * 60 * 60);
      expect(options.session?.updateAge).toBe(60 * 60);
    });

    it('disables session cookie caching', () => {
      expect(createAuthOptions(baseInput()).session?.cookieCache?.enabled).toBe(false);
    });

    it('does not configure freshAge, which is not verified for this version', () => {
      expect(createAuthOptions(baseInput()).session).not.toHaveProperty('freshAge');
    });
  });

  describe('telemetry and rate limiting', () => {
    it('disables telemetry explicitly', () => {
      expect(createAuthOptions(baseInput()).telemetry?.enabled).toBe(false);
    });

    it('enables rate limiting even in development', () => {
      expect(createAuthOptions(baseInput({ environment: 'development' })).rateLimit?.enabled).toBe(
        true,
      );
    });

    it('stores rate limit state in the database, not memory', () => {
      expect(createAuthOptions(baseInput()).rateLimit?.storage).toBe('database');
    });

    it("keeps rate-limit state in DROMEX-owned PostgreSQL storage, not Better Auth's table", () => {
      expect(typeof createAuthOptions(baseInput()).rateLimit?.customStorage?.consume).toBe(
        'function',
      );
    });

    it('limits password sign-in, TOTP verification, and recovery-code verification to 5 attempts per 60 seconds', () => {
      const rules = createAuthOptions(baseInput()).rateLimit?.customRules;

      expect(rules).toEqual({
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      });
    });
  });

  describe('mandatory TOTP two-factor authentication', () => {
    function twoFactorPlugin() {
      const plugins = createAuthOptions(baseInput()).plugins ?? [];
      expect(plugins.map((plugin) => plugin.id)).toEqual(['two-factor']);
      return plugins[0]!;
    }

    it('names the application DROMEX, which authenticator apps display', () => {
      expect(createAuthOptions(baseInput()).appName).toBe('DROMEX');
    });

    it('pins every security-relevant two-factor option explicitly', () => {
      expect(twoFactorPlugin().options).toEqual({
        issuer: 'DROMEX',
        skipVerificationOnEnable: false,
        allowPasswordless: false,
        twoFactorCookieMaxAge: 300,
        trustDeviceMaxAge: 1,
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: {
          amount: 10,
          customBackupCodesGenerate: generateRecoveryCodes,
          storeBackupCodes: 'encrypted',
          allowPasswordless: false,
        },
      });
    });

    it('configures no OTP delivery method, so no code is ever emailed or texted', () => {
      expect(twoFactorPlugin().options).not.toHaveProperty('otpOptions');
    });
  });

  describe('trusted origins', () => {
    it('passes through explicit origins', () => {
      const options = createAuthOptions(baseInput({ trustedOrigins: ['http://127.0.0.1:5173'] }));

      expect(options.trustedOrigins).toEqual(['http://127.0.0.1:5173']);
    });

    it('rejects an empty trusted origin list', () => {
      expect(() => createAuthOptions(baseInput({ trustedOrigins: [] }))).toThrow(/trusted origin/i);
    });

    it('rejects a wildcard origin in production', () => {
      expect(() =>
        createAuthOptions(
          baseInput({
            environment: 'production',
            trustedOrigins: ['https://*.fakihbrothers.com'],
            baseURL: 'https://app.fakihbrothers.com',
          }),
        ),
      ).toThrow(/wildcard/i);
    });

    it('rejects a bare wildcard anywhere', () => {
      expect(() => createAuthOptions(baseInput({ trustedOrigins: ['*'] }))).toThrow(/wildcard/i);
    });

    it('rejects an origin that is not a valid absolute http(s) URL', () => {
      expect(() => createAuthOptions(baseInput({ trustedOrigins: ['not-a-url'] }))).toThrow(
        /origin/i,
      );
    });

    it('normalises a trailing slash away', () => {
      const options = createAuthOptions(baseInput({ trustedOrigins: ['http://127.0.0.1:5173/'] }));

      expect(options.trustedOrigins).toEqual(['http://127.0.0.1:5173']);
    });

    it('normalises an uppercase hostname to lower case', () => {
      const options = createAuthOptions(baseInput({ trustedOrigins: ['http://LOCALHOST:5173'] }));

      expect(options.trustedOrigins).toEqual(['http://localhost:5173']);
    });

    it('removes duplicates that are equal only after normalisation', () => {
      const options = createAuthOptions(
        baseInput({
          trustedOrigins: ['http://127.0.0.1:5173', 'http://127.0.0.1:5173/', 'http://LOCALHOST:5173'],
        }),
      );

      expect(options.trustedOrigins).toEqual(['http://127.0.0.1:5173', 'http://localhost:5173']);
    });

    it('requires https for every production trusted origin', () => {
      expect(() =>
        createAuthOptions(
          baseInput({
            environment: 'production',
            baseURL: 'https://app.fakihbrothers.com',
            trustedOrigins: ['http://app.fakihbrothers.com'],
          }),
        ),
      ).toThrow(/https in production/i);
    });

    it('accepts plain http for a loopback host outside production', () => {
      for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
        expect(createAuthOptions(baseInput({ trustedOrigins: [origin] })).trustedOrigins).toHaveLength(
          1,
        );
      }
    });

    it('rejects plain http for a non-loopback host outside production', () => {
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['http://192.168.10.25:5173'] })),
      ).toThrow(/loopback/i);
    });

    it('rejects an origin embedding a username or password', () => {
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['http://user:pass@127.0.0.1:5173'] })),
      ).toThrow(/username or password/i);
    });

    it('rejects an origin carrying a path, query, or fragment', () => {
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['http://127.0.0.1:5173/app'] })),
      ).toThrow(/path/i);
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['http://127.0.0.1:5173/?a=1'] })),
      ).toThrow(/query/i);
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['http://127.0.0.1:5173/#x'] })),
      ).toThrow(/fragment/i);
    });

    it('rejects an unsupported protocol', () => {
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['ftp://127.0.0.1:5173'] })),
      ).toThrow(/scheme/i);
    });

    it('never echoes a rejected origin, which may carry credentials', () => {
      const text = errorText(() =>
        createAuthOptions(
          baseInput({ trustedOrigins: ['http://admin:hunter2@evil.example.com/path?q=1#f'] }),
        ),
      );
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('admin');
      expect(text).not.toContain('evil.example.com');
    });
  });

  describe('baseURL', () => {
    it('is normalised to a canonical origin with no trailing slash', () => {
      expect(createAuthOptions(baseInput({ baseURL: 'http://127.0.0.1:3000/' })).baseURL).toBe(
        'http://127.0.0.1:3000',
      );
    });

    it('rejects a malformed or empty value', () => {
      expect(() => createAuthOptions(baseInput({ baseURL: 'not a url' }))).toThrow(/baseURL/);
      expect(() => createAuthOptions(baseInput({ baseURL: '' }))).toThrow(/baseURL/);
    });

    it('rejects a path, query, fragment, or embedded credential', () => {
      expect(() => createAuthOptions(baseInput({ baseURL: 'http://127.0.0.1:3000/api' }))).toThrow(
        /path/i,
      );
      expect(() => createAuthOptions(baseInput({ baseURL: 'http://127.0.0.1:3000/?a=1' }))).toThrow(
        /query/i,
      );
      expect(() => createAuthOptions(baseInput({ baseURL: 'http://127.0.0.1:3000/#x' }))).toThrow(
        /fragment/i,
      );
      expect(() =>
        createAuthOptions(baseInput({ baseURL: 'http://user:pass@127.0.0.1:3000' })),
      ).toThrow(/username or password/i);
    });

    it('requires https in production', () => {
      expect(() =>
        createAuthOptions(
          baseInput({
            environment: 'production',
            baseURL: 'http://app.fakihbrothers.com',
            trustedOrigins: ['https://app.fakihbrothers.com'],
          }),
        ),
      ).toThrow(/https in production/i);
    });

    it('never echoes a rejected baseURL', () => {
      const text = errorText(() =>
        createAuthOptions(baseInput({ baseURL: 'http://admin:hunter2@evil.example.com/path' })),
      );
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('evil.example.com');
    });
  });

  describe('versioned secrets', () => {
    it('fails closed when secrets are missing or empty', () => {
      expect(() => createAuthOptions(baseInput({ secrets: undefined }))).toThrow(/secret/i);
      expect(() => createAuthOptions(baseInput({ secrets: [] }))).toThrow(/secret/i);
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['fractional', 1.5],
      ['a string', '1'],
      ['not a number', Number.NaN],
      ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects a %s version', (_label, version) => {
      expect(() =>
        createAuthOptions(baseInput({ secrets: [{ version, value: syntheticSecret() }] })),
      ).toThrow(/version/i);
    });

    it('rejects a duplicate version', () => {
      expect(() =>
        createAuthOptions(
          baseInput({
            secrets: [
              { version: 2, value: syntheticSecret() },
              { version: 2, value: syntheticSecret() },
            ],
          }),
        ),
      ).toThrow(/duplicate/i);
    });

    it.each([
      ['empty', ''],
      ['short', 'x'.repeat(31)],
      ['padded with leading whitespace', ` ${'a'.repeat(40)}`],
      ['padded with trailing whitespace', `${'a'.repeat(40)}\n`],
    ])('rejects an %s value without ever echoing it, naming only its version', (_label, value) => {
      const text = errorText(() =>
        createAuthOptions(
          baseInput({
            secrets: [
              { version: 3, value: syntheticSecret() },
              { version: 2, value },
            ],
          }),
        ),
      );

      expect(text).toMatch(/secret/i);
      expect(text).toMatch(/version 2/i);
      if (value.trim() !== '') expect(text).not.toContain(value.trim());
    });

    it('orders the newest version first, whatever order it was supplied in', () => {
      const [one, two, three] = [syntheticSecret(), syntheticSecret(), syntheticSecret()];

      const options = createAuthOptions(
        baseInput({
          secrets: [
            { version: 1, value: one },
            { version: 3, value: three },
            { version: 2, value: two },
          ],
        }),
      );

      expect(options.secrets).toEqual([
        { version: 3, value: three },
        { version: 2, value: two },
        { version: 1, value: one },
      ]);
    });

    it('sets secrets explicitly and no single secret, so no ambient variable can take over', () => {
      const options = createAuthOptions(baseInput());

      expect(options.secrets).toHaveLength(1);
      expect(options).not.toHaveProperty('secret');
    });
  });

  describe('cookie security', () => {
    it('forces Secure cookies in production and by default in development', () => {
      expect(
        createAuthOptions(
          baseInput({
            environment: 'production',
            trustedOrigins: ['https://app.fakihbrothers.com'],
            baseURL: 'https://app.fakihbrothers.com',
          }),
        ).advanced?.useSecureCookies,
      ).toBe(true);
      expect(createAuthOptions(baseInput()).advanced?.useSecureCookies).toBe(true);
    });

    it('allows insecure cookies only through the explicit development option', () => {
      expect(
        createAuthOptions(baseInput({ environment: 'development', allowInsecureCookies: true }))
          .advanced?.useSecureCookies,
      ).toBe(false);
      expect(() =>
        createAuthOptions(baseInput({ environment: 'test', allowInsecureCookies: true })),
      ).toThrow(/insecure cookies/i);
    });

    it('names the session, challenge, and trusted-device cookies as Better Auth issues them', () => {
      expect(authCookieNames(createAuthOptions(baseInput()))).toEqual({
        sessionToken: '__Secure-better-auth.session_token',
        twoFactor: '__Secure-better-auth.two_factor',
        trustDevice: '__Secure-better-auth.trust_device',
      });
      expect(
        authCookieNames(createAuthOptions(baseInput({ allowInsecureCookies: true }))),
      ).toEqual({
        sessionToken: 'better-auth.session_token',
        twoFactor: 'better-auth.two_factor',
        trustDevice: 'better-auth.trust_device',
      });
    });
  });

  describe('scope boundaries', () => {
    it('enables only the two-factor plugin: no admin, social, bearer, JWT, email, or reset feature', () => {
      const options = createAuthOptions(baseInput());

      expect((options.plugins ?? []).map((plugin) => plugin.id)).toEqual(['two-factor']);
      expect(options).not.toHaveProperty('socialProviders');
      expect(options.emailAndPassword).not.toHaveProperty('sendResetPassword');
      expect(options.emailAndPassword).not.toHaveProperty('requireEmailVerification');
      expect(options).not.toHaveProperty('emailVerification');
    });

    it('exports no provisioning-mode factory', () => {
      expect(authConfigModule).not.toHaveProperty('createProvisioningAuth');
    });
  });

  it('writes nothing to the console, on the success or the failure path', () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined),
    );

    createAuthOptions(baseInput());
    expect(() =>
      createAuthOptions(baseInput({ secrets: [{ version: 1, value: 'short' }] })),
    ).toThrow();

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('principal gate at session issuance', () => {
  function poolReturning(result: unknown[] | Error): Pool {
    return {
      query: vi.fn(async () => {
        if (result instanceof Error) throw result;
        return { rows: result };
      }),
    } as unknown as Pool;
  }

  function sessionCreateHook(database: Pool) {
    const before = createAuthOptions(baseInput({ database })).databaseHooks?.session?.create
      ?.before;
    expect(before).toBeTypeOf('function');
    return before!;
  }

  const row = (status: string) => ({
    user_id: 'user_x',
    status,
    is_owner: false,
    mfa_completed_at: null,
  });

  it('allows session creation for an active principal', async () => {
    const hook = sessionCreateHook(poolReturning([row('active')]));
    await expect(hook({ userId: 'user_x' } as never, null as never)).resolves.not.toBe(false);
  });

  it('aborts session creation when the principal is missing or disabled', async () => {
    await expect(
      sessionCreateHook(poolReturning([]))({ userId: 'user_x' } as never, null as never),
    ).resolves.toBe(false);
    await expect(
      sessionCreateHook(poolReturning([row('disabled')]))({ userId: 'user_x' } as never, null as never),
    ).resolves.toBe(false);
  });

  it('fails closed when the principal lookup throws', async () => {
    const hook = sessionCreateHook(poolReturning(new Error('lookup failed')));
    await expect(hook({ userId: 'user_x' } as never, null as never)).rejects.toThrow();
  });
});

describe('client address resolution', () => {
  it('reads the client address only from the DROMEX-internal header, trusting no proxy', () => {
    const options = createAuthOptions(baseInput());

    expect(options.advanced?.ipAddress?.ipAddressHeaders).toEqual([DROMEX_CLIENT_IP_HEADER]);
    expect(options.advanced?.ipAddress?.trustedProxies ?? []).toEqual([]);
  });
});
