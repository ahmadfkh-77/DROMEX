import { randomBytes } from 'node:crypto';

import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../../src/auth/hashing.ts';
import * as authConfigModule from '../../src/auth/config.ts';
import { createAuthOptions } from '../../src/auth/config.ts';

// Synthetic, generated in memory, never printed. This is not a credential:
// nothing consumes it, because no Better Auth instance is constructed here.
function syntheticSecret(): string {
  return randomBytes(32).toString('hex');
}

// Port 1 is reserved and closed. `new Pool()` is lazy — pg opens no socket
// until a query runs, and no test here runs one. These stay Docker-free.
function inertPool(): Pool {
  return new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'development' as const,
    secret: syntheticSecret(),
    baseURL: 'http://127.0.0.1:3000',
    trustedOrigins: ['http://127.0.0.1:5173'],
    database: inertPool(),
    ...overrides,
  };
}

describe('authentication configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('email and password', () => {
    it('enables email and password authentication', () => {
      const options = createAuthOptions(baseInput());

      expect(options.emailAndPassword?.enabled).toBe(true);
    });

    it('disables public sign-up explicitly', () => {
      // Better Auth's own default for disableSignUp is false, so this must be
      // set rather than assumed. Phase 2C has no invitation flow (OQ-161), so
      // the only account that may exist is the CLI-provisioned Owner.
      const options = createAuthOptions(baseInput());

      expect(options.emailAndPassword?.disableSignUp).toBe(true);
    });

    it('disables automatic sign-in after account creation', () => {
      const options = createAuthOptions(baseInput());

      expect(options.emailAndPassword?.autoSignIn).toBe(false);
    });

    it('enforces a 15 character minimum and 128 character maximum password', () => {
      const options = createAuthOptions(baseInput());

      expect(options.emailAndPassword?.minPasswordLength).toBe(15);
      expect(options.emailAndPassword?.maxPasswordLength).toBe(128);
    });

    it('uses the existing Argon2id wrapper for hashing', () => {
      const options = createAuthOptions(baseInput());

      expect(options.emailAndPassword?.password?.hash).toBe(hashPassword);
    });

    it('verifies through the Argon2id wrapper, adapting the argument shape', async () => {
      // Better Auth calls verify({ password, hash }); the DROMEX wrapper takes
      // (password, encodedHash). The adapter between them is exactly where an
      // argument swap would silently accept every password, so it is proven
      // end to end rather than by inspection.
      const options = createAuthOptions(baseInput());
      const verify = options.emailAndPassword?.password?.verify;
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
      // DEC-420: with the cookie cache on, a revoked session can survive on
      // another device until the cache expires. Immediate revocation is the
      // requirement, so the cache stays off.
      const options = createAuthOptions(baseInput());

      expect(options.session?.cookieCache?.enabled).toBe(false);
    });

    it('does not configure freshAge, which is not verified for this version', () => {
      const options = createAuthOptions(baseInput());

      expect(options.session).not.toHaveProperty('freshAge');
    });
  });

  describe('telemetry and rate limiting', () => {
    it('disables telemetry explicitly', () => {
      const options = createAuthOptions(baseInput());

      expect(options.telemetry?.enabled).toBe(false);
    });

    it('enables rate limiting even in development', () => {
      // Better Auth disables rate limiting in development by default, which
      // would mean the limit is never exercised by local tests.
      const options = createAuthOptions(baseInput({ environment: 'development' }));

      expect(options.rateLimit?.enabled).toBe(true);
    });

    it('stores rate limit state in the database, not memory', () => {
      const options = createAuthOptions(baseInput());

      expect(options.rateLimit?.storage).toBe('database');
    });

    it('limits /sign-in/email to 5 attempts per 60 seconds', () => {
      const options = createAuthOptions(baseInput());

      expect(options.rateLimit?.customRules?.['/sign-in/email']).toEqual({
        window: 60,
        max: 5,
      });
    });
  });

  describe('trusted origins', () => {
    it('passes through explicit origins', () => {
      const options = createAuthOptions(
        baseInput({ trustedOrigins: ['http://127.0.0.1:5173'] }),
      );

      expect(options.trustedOrigins).toEqual(['http://127.0.0.1:5173']);
    });

    it('rejects an empty trusted origin list', () => {
      expect(() => createAuthOptions(baseInput({ trustedOrigins: [] }))).toThrow(
        /trusted origin/i,
      );
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
      expect(() => createAuthOptions(baseInput({ trustedOrigins: ['*'] }))).toThrow(
        /wildcard/i,
      );
    });

    it('rejects an origin that is not a valid absolute http(s) URL', () => {
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['not-a-url'] })),
      ).toThrow(/origin/i);
    });

    it('normalises a trailing slash away', () => {
      const options = createAuthOptions(
        baseInput({ trustedOrigins: ['http://127.0.0.1:5173/'] }),
      );

      expect(options.trustedOrigins).toEqual(['http://127.0.0.1:5173']);
    });

    it('normalises an uppercase hostname to lower case', () => {
      const options = createAuthOptions(
        baseInput({ trustedOrigins: ['http://LOCALHOST:5173'] }),
      );

      expect(options.trustedOrigins).toEqual(['http://localhost:5173']);
    });

    it('removes duplicates that are equal only after normalisation', () => {
      // Two spellings of one origin are one origin. Rejecting the list over a
      // harmless restatement would be a configuration failure with no
      // security benefit, so equal entries collapse and distinct ones remain.
      const options = createAuthOptions(
        baseInput({
          trustedOrigins: [
            'http://127.0.0.1:5173',
            'http://127.0.0.1:5173/',
            'http://LOCALHOST:5173',
          ],
        }),
      );

      expect(options.trustedOrigins).toEqual([
        'http://127.0.0.1:5173',
        'http://localhost:5173',
      ]);
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
      for (const origin of [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://[::1]:5173',
      ]) {
        const options = createAuthOptions(baseInput({ trustedOrigins: [origin] }));
        expect(options.trustedOrigins).toHaveLength(1);
      }
    });

    it('rejects plain http for a non-loopback host outside production', () => {
      // Loopback is a trustworthy origin; a LAN address reachable by other
      // machines is not, so development convenience stops at the machine.
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['http://192.168.10.25:5173'] })),
      ).toThrow(/loopback/i);
    });

    it('rejects an origin embedding a username or password', () => {
      expect(() =>
        createAuthOptions(
          baseInput({ trustedOrigins: ['http://user:pass@127.0.0.1:5173'] }),
        ),
      ).toThrow(/username or password/i);
    });

    it('rejects an origin carrying a path', () => {
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['http://127.0.0.1:5173/app'] })),
      ).toThrow(/path/i);
    });

    it('rejects an origin carrying a query string', () => {
      expect(() =>
        createAuthOptions(baseInput({ trustedOrigins: ['http://127.0.0.1:5173/?a=1'] })),
      ).toThrow(/query/i);
    });

    it('rejects an origin carrying a fragment', () => {
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
      const secretish = 'http://admin:hunter2@evil.example.com/path?q=1#f';

      try {
        createAuthOptions(baseInput({ trustedOrigins: [secretish] }));
        throw new Error('expected the malformed origin to be rejected');
      } catch (error) {
        const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
        expect(text).not.toContain('hunter2');
        expect(text).not.toContain('admin');
        expect(text).not.toContain('evil.example.com');
      }
    });
  });

  describe('baseURL', () => {
    it('is normalised to a canonical origin with no trailing slash', () => {
      const options = createAuthOptions(baseInput({ baseURL: 'http://127.0.0.1:3000/' }));

      expect(options.baseURL).toBe('http://127.0.0.1:3000');
    });

    it('normalises an uppercase hostname', () => {
      const options = createAuthOptions(baseInput({ baseURL: 'http://LOCALHOST:3000' }));

      expect(options.baseURL).toBe('http://localhost:3000');
    });

    it('rejects a malformed value', () => {
      expect(() => createAuthOptions(baseInput({ baseURL: 'not a url' }))).toThrow(
        /baseURL/,
      );
    });

    it('rejects an empty value', () => {
      expect(() => createAuthOptions(baseInput({ baseURL: '' }))).toThrow(/baseURL/);
    });

    it('rejects an unsupported protocol', () => {
      expect(() =>
        createAuthOptions(baseInput({ baseURL: 'ftp://127.0.0.1:3000' })),
      ).toThrow(/scheme/i);
    });

    it('rejects a path, query, or fragment', () => {
      expect(() =>
        createAuthOptions(baseInput({ baseURL: 'http://127.0.0.1:3000/api' })),
      ).toThrow(/path/i);
      expect(() =>
        createAuthOptions(baseInput({ baseURL: 'http://127.0.0.1:3000/?a=1' })),
      ).toThrow(/query/i);
      expect(() =>
        createAuthOptions(baseInput({ baseURL: 'http://127.0.0.1:3000/#x' })),
      ).toThrow(/fragment/i);
    });

    it('rejects an embedded username or password', () => {
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

    it('rejects plain http for a non-loopback host outside production', () => {
      expect(() =>
        createAuthOptions(baseInput({ baseURL: 'http://192.168.10.25:3000' })),
      ).toThrow(/loopback/i);
    });

    it('never echoes a rejected baseURL', () => {
      const secretish = 'http://admin:hunter2@evil.example.com/path';

      try {
        createAuthOptions(baseInput({ baseURL: secretish }));
        throw new Error('expected the malformed baseURL to be rejected');
      } catch (error) {
        const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
        expect(text).not.toContain('hunter2');
        expect(text).not.toContain('evil.example.com');
      }
    });
  });

  describe('secret handling', () => {
    it('fails closed when the secret is missing', () => {
      expect(() => createAuthOptions(baseInput({ secret: '' }))).toThrow(/secret/i);
    });

    it('fails closed when the secret is too short to be credible', () => {
      expect(() => createAuthOptions(baseInput({ secret: 'short' }))).toThrow(/secret/i);
    });

    it('never reveals the secret value in the thrown error', () => {
      const weak = 'x'.repeat(8);

      try {
        createAuthOptions(baseInput({ secret: weak }));
        throw new Error('expected createAuthOptions to reject the weak secret');
      } catch (error) {
        const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
        expect(text).not.toContain(weak);
      }
    });

    it('has no fallback secret: the value supplied is the value used', () => {
      const secret = syntheticSecret();
      const options = createAuthOptions(baseInput({ secret }));

      expect(options.secret).toBe(secret);
    });

    it('preserves a valid secret byte for byte', () => {
      const secret = syntheticSecret();
      const options = createAuthOptions(baseInput({ secret }));

      expect(options.secret).toBe(secret);
      expect(options.secret).toHaveLength(secret.length);
    });

    it('rejects a secret with leading whitespace rather than trimming it', () => {
      // Trimming for the check and returning the untrimmed value would
      // validate one string and use another, so a secret could pass
      // validation and still not match what the operator configured.
      expect(() =>
        createAuthOptions(baseInput({ secret: ` ${syntheticSecret()}` })),
      ).toThrow(/whitespace/i);
    });

    it('rejects a secret with trailing whitespace', () => {
      expect(() =>
        createAuthOptions(baseInput({ secret: `${syntheticSecret()}\n` })),
      ).toThrow(/whitespace/i);
    });

    it('never reveals a whitespace-padded secret in the message or stack', () => {
      const inner = syntheticSecret();

      try {
        createAuthOptions(baseInput({ secret: `  ${inner}  ` }));
        throw new Error('expected the padded secret to be rejected');
      } catch (error) {
        const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
        expect(text).not.toContain(inner);
      }
    });
  });

  describe('cookie security', () => {
    it('forces Secure cookies in production', () => {
      const options = createAuthOptions(
        baseInput({
          environment: 'production',
          trustedOrigins: ['https://app.fakihbrothers.com'],
          baseURL: 'https://app.fakihbrothers.com',
        }),
      );

      expect(options.advanced?.useSecureCookies).toBe(true);
    });

    it('defaults to Secure cookies in development too', () => {
      const options = createAuthOptions(baseInput());

      expect(options.advanced?.useSecureCookies).toBe(true);
    });

    it('allows insecure cookies only through the explicit development option', () => {
      const options = createAuthOptions(
        baseInput({ environment: 'development', allowInsecureCookies: true }),
      );

      expect(options.advanced?.useSecureCookies).toBe(false);
    });

    it('refuses to start when insecure cookies are requested in production', () => {
      expect(() =>
        createAuthOptions(
          baseInput({
            environment: 'production',
            allowInsecureCookies: true,
            trustedOrigins: ['https://app.fakihbrothers.com'],
            baseURL: 'https://app.fakihbrothers.com',
          }),
        ),
      ).toThrow(/insecure cookies/i);
    });

    it('refuses to start when insecure cookies are requested outside development', () => {
      expect(() =>
        createAuthOptions(baseInput({ environment: 'test', allowInsecureCookies: true })),
      ).toThrow(/insecure cookies/i);
    });
  });

  describe('scope boundaries', () => {
    it('enables no plugin: no admin, MFA, social, bearer, JWT, or Expo feature', () => {
      const options = createAuthOptions(baseInput());

      expect(options.plugins ?? []).toEqual([]);
      expect(options).not.toHaveProperty('socialProviders');
      expect(options.emailAndPassword).not.toHaveProperty('sendResetPassword');
      expect(options.emailAndPassword).not.toHaveProperty('requireEmailVerification');
      expect(options).not.toHaveProperty('emailVerification');
    });

    it('exports no provisioning-mode factory', () => {
      // createProvisioningAuth() belongs to the Owner-bootstrap checkpoint and
      // must not exist yet, so it cannot be reached early by accident.
      expect(authConfigModule).not.toHaveProperty('createProvisioningAuth');
    });
  });

  it('writes nothing to the console, on the success or the failure path', () => {
    const spies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
      info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    };

    createAuthOptions(baseInput());
    expect(() => createAuthOptions(baseInput({ secret: 'short' }))).toThrow();

    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
