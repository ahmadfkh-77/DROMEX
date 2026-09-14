import type { BetterAuthOptions } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import type { Pool } from 'pg';

import { hashPassword, verifyPassword } from './hashing.ts';
import { createPrincipalRepository } from './principal.ts';
import { createRateLimitStorage } from './rate-limit-storage.ts';
import { generateRecoveryCodes } from './recovery-codes.ts';

/**
 * The header through which the HTTP transport hands Better Auth the
 * server-observed client address.
 *
 * Better Auth reads the client address from request headers only, and by
 * default from `x-forwarded-for`, which any caller can forge. Configuring it
 * to read this header alone, and having the transport strip every
 * client-supplied forwarding header before setting this one from the socket,
 * means a caller cannot choose the address its rate limit is keyed on.
 */
export const DROMEX_CLIENT_IP_HEADER = 'x-dromex-client-ip';

/** Everything a caller supplies except the database, which the server owns. */
export type AuthSettings = Omit<AuthConfigInput, 'database'>;

/**
 * Better Auth configuration for the DROMEX web application.
 *
 * This module builds and validates the options object. It deliberately does
 * **not** construct a Better Auth instance, mount a route, or touch the
 * database: that keeps it a pure, fully testable function and keeps these
 * tests Docker-free.
 *
 * Every value arrives through explicit parameters. This module never reads
 * `process.env` and never loads a `.env` file, so a test can exercise every
 * branch — including production — without the ambient environment deciding
 * anything, and so no configuration can be smuggled in implicitly.
 */

export type AuthEnvironment = 'development' | 'test' | 'production';

/** One version of the authentication secret (DEC-434). */
export interface AuthSecret {
  /** Positive whole number. The highest version is the current one. */
  version: number;
  value: string;
}

export interface AuthConfigInput {
  /** Chooses the security posture. Never inferred from the environment. */
  environment: AuthEnvironment;
  /**
   * Versioned secrets. The newest version signs cookies and encrypts new TOTP
   * and recovery-code data; older versions stay available to decrypt data
   * written under them, which is what makes rotation non-destructive.
   */
  secrets: readonly AuthSecret[];
  /** The API's own base URL. */
  baseURL: string;
  /** Explicit allowlist. Wildcards are refused (see validateTrustedOrigins). */
  trustedOrigins: readonly string[];
  /** Caller-owned pool. This module never creates or connects one. */
  database: Pool;
  /**
   * Development-only escape hatch for `Secure` cookies over plain HTTP.
   * Requesting it outside development is a startup failure, never a warning.
   */
  allowInsecureCookies?: boolean;
}

/** The cookie names Better Auth issues under this configuration. */
export interface AuthCookieNames {
  sessionToken: string;
  twoFactor: string;
  trustDevice: string;
}

/**
 * Password length policy, measured the way Better Auth measures it (UTF-16
 * code units). Exported so the Owner provisioning validation refuses exactly
 * what Better Auth would, before anything is written.
 */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

/** Shown by authenticator apps and used as the TOTP issuer. */
export const MFA_ISSUER = 'DROMEX';

/** 12 hours. A working day, not a working week. */
const SESSION_EXPIRES_IN_SECONDS = 12 * 60 * 60;
/** 1 hour. How often an active session's expiry is extended. */
const SESSION_UPDATE_AGE_SECONDS = 60 * 60;

/**
 * Better Auth's documented minimum shape for a secret.
 *
 * This is a **shape** check, not an entropy check: a length threshold cannot
 * distinguish 32 random bytes from 32 repetitions of the same character, and
 * nothing here claims otherwise.
 */
const MINIMUM_SECRET_LENGTH = 32;

/**
 * Hosts for which plain HTTP is acceptable outside production.
 *
 * `URL` reports an IPv6 host in bracketed form, so both spellings of the
 * loopback address are listed.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Throws when one secret value is absent or malformed.
 *
 * The offending value is never included in the message, the stack, or
 * anywhere else; only its version is named. Surrounding whitespace is
 * rejected rather than trimmed, so the value validated is the value used.
 */
function validateSecretValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Better Auth secret ${label} is missing. There is no fallback.`);
  }

  if (value !== value.trim()) {
    throw new Error(
      `Better Auth secret ${label} is invalid: it must not begin or end with whitespace. The value itself is not shown.`,
    );
  }

  if (value.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `Better Auth secret ${label} is invalid: it must be at least ${MINIMUM_SECRET_LENGTH} characters. The value itself is not shown.`,
    );
  }

  return value;
}

/**
 * Validates every versioned secret and returns them newest first, which is
 * the order Better Auth treats as "current, then older".
 */
function validateSecrets(secrets: unknown): AuthSecret[] {
  if (!Array.isArray(secrets) || secrets.length === 0) {
    throw new Error(
      'Better Auth secrets are missing. Supply at least one versioned secret through validated runtime configuration; there is no fallback.',
    );
  }

  const seen = new Set<number>();
  const validated = secrets.map((entry: unknown, index) => {
    const version = (entry as { version?: unknown } | null)?.version;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
      throw new Error(
        `Better Auth secret at position ${index + 1} has an invalid version: a version must be a positive whole number. The value itself is not shown.`,
      );
    }
    if (seen.has(version)) {
      throw new Error(`Better Auth secret version ${version} is a duplicate: each version must be unique.`);
    }
    seen.add(version);

    return {
      version,
      value: validateSecretValue((entry as { value?: unknown }).value, `version ${version}`),
    };
  });

  return validated.sort((a, b) => b.version - a.version);
}

/**
 * Validates one origin and returns it in canonical `URL.origin` form: scheme,
 * host, and port only, lower-cased, with no trailing slash.
 *
 * Anything carrying more than an origin is refused rather than silently
 * discarded. The supplied value is never echoed, because a rejected origin
 * can carry credentials.
 */
function normalizeOrigin(value: unknown, environment: AuthEnvironment, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is missing: an absolute http or https URL is required.`);
  }

  if (value.includes('*')) {
    throw new Error(`${label} contains a wildcard. Wildcards are refused: list each origin explicitly.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid absolute URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use the http or https scheme.`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error(`${label} must not embed a username or password.`);
  }
  if (parsed.search !== '') {
    throw new Error(`${label} must not include a query string.`);
  }
  if (parsed.hash !== '') {
    throw new Error(`${label} must not include a fragment.`);
  }
  if (parsed.pathname !== '/') {
    throw new Error(`${label} must not include a path.`);
  }

  if (parsed.protocol === 'http:') {
    if (environment === 'production') {
      throw new Error(`${label} must use https in production.`);
    }
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new Error(
        `${label} may use plain http outside production only for a loopback host (localhost, 127.0.0.1, ::1).`,
      );
    }
  }

  return parsed.origin;
}

/**
 * Validates every trusted origin and returns the canonical list, removing
 * entries that are equal only after normalisation. Wildcards are refused in
 * every environment.
 */
function validateTrustedOrigins(origins: readonly string[], environment: AuthEnvironment): string[] {
  if (origins.length === 0) {
    throw new Error('At least one trusted origin is required. The allowlist must be explicit.');
  }

  const normalized = origins.map((origin, index) =>
    normalizeOrigin(origin, environment, `Trusted origin at index ${index}`),
  );

  return [...new Set(normalized)];
}

/**
 * Decides the `Secure` cookie flag, and refuses to build a configuration that
 * would ship insecure cookies anywhere but a developer's machine.
 */
function resolveUseSecureCookies(environment: AuthEnvironment, allowInsecureCookies: boolean): boolean {
  if (!allowInsecureCookies) {
    return true;
  }

  if (environment !== 'development') {
    throw new Error(
      `Insecure cookies were requested in the "${environment}" environment. That option exists only for local development and is refused here.`,
    );
  }

  return false;
}

/**
 * Better Auth's two-factor plugin with every security-relevant option pinned
 * (DEC-434, DEC-435), rather than inherited from defaults that a future
 * release could change.
 *
 * - `skipVerificationOnEnable: false`: a factor counts only once a code from
 *   it has been verified.
 * - `allowPasswordless: false`: enabling, disabling, and regenerating always
 *   require the account password.
 * - A five-minute challenge cookie between the password and the code.
 * - Account lockout after 10 consecutive failed verifications, for 900 s.
 * - `trustDeviceMaxAge: 1`: Better Auth 1.7.4 has no option that disables
 *   trusted devices. DROMEX never lets `trustDevice` reach it and never
 *   forwards the cookie; the one-second lifetime is defence in depth only.
 * - Ten 120-bit Crockford recovery codes, stored through Better Auth's
 *   explicit encrypted storage. That storage is reversible, not a hash.
 * - No `otpOptions`: no code is ever sent by email or text message.
 */
export function createTwoFactorPlugin() {
  return twoFactor({
    issuer: MFA_ISSUER,
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
}

/**
 * The names Better Auth gives its session, two-factor challenge, and
 * trusted-device cookies: its default `better-auth.` prefix, with the
 * `__Secure-` prefix whenever Secure cookies are in force.
 */
export function authCookieNames(options: Pick<BetterAuthOptions, 'advanced'>): AuthCookieNames {
  const prefix = options.advanced?.useSecureCookies === false ? '' : '__Secure-';
  return {
    sessionToken: `${prefix}better-auth.session_token`,
    twoFactor: `${prefix}better-auth.two_factor`,
    trustDevice: `${prefix}better-auth.trust_device`,
  };
}

/**
 * Builds the validated Better Auth options.
 *
 * Throws on any invalid input rather than falling back to a weaker default:
 * a configuration error must stop the process, not quietly degrade it.
 */
export function createAuthOptions(input: AuthConfigInput): BetterAuthOptions {
  const secrets = validateSecrets(input.secrets);
  const baseURL = normalizeOrigin(input.baseURL, input.environment, 'baseURL');
  const trustedOrigins = validateTrustedOrigins(input.trustedOrigins, input.environment);
  const useSecureCookies = resolveUseSecureCookies(input.environment, input.allowInsecureCookies ?? false);

  return {
    appName: MFA_ISSUER,
    database: input.database,
    // `secrets` is always set explicitly and `secret` never is. Better Auth
    // would otherwise read BETTER_AUTH_SECRETS (or, as a legacy fallback,
    // BETTER_AUTH_SECRET or AUTH_SECRET) from the process environment itself.
    secrets,
    baseURL,
    trustedOrigins,

    // Opt out explicitly. It is already off by default, which is exactly why
    // it is pinned: a future default change must not start reporting.
    telemetry: { enabled: false },

    emailAndPassword: {
      enabled: true,
      // Better Auth's own default is false. Accounts are created only by the
      // local Owner activation command; there is no invitation flow yet
      // (OQ-161) and no public registration ever.
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: {
        hash: hashPassword,
        // Better Auth passes { password, hash }; the DROMEX wrapper takes
        // (password, encodedHash). Adapting here keeps the swap in one place.
        verify: ({ password, hash }) => verifyPassword(password, hash),
      },
    },

    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // DEC-420. With the cache enabled, a revoked session can stay usable on
      // another device until the cache expires, which defeats immediate
      // revocation — and GHSA-xg6x-h9c9-2m83 showed it can also let a session
      // outlive a pending two-factor challenge.
      cookieCache: { enabled: false },
    },

    rateLimit: {
      // Better Auth disables rate limiting in development by default, which
      // would leave the limit unexercised by local tests.
      enabled: true,
      // Kept so Better Auth's generated schema stays exactly as generated.
      // At runtime `customStorage` takes precedence and this is unused.
      storage: 'database',
      // DROMEX-owned PostgreSQL storage, keyed by client address and path.
      customStorage: createRateLimitStorage(input.database),
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
      },
    },

    advanced: {
      useSecureCookies,
      // Better Auth otherwise trusts `x-forwarded-for`, which any caller can
      // forge. The HTTP transport sets this header from the socket address
      // after stripping every client-supplied forwarding header.
      ipAddress: {
        ipAddressHeaders: [DROMEX_CLIENT_IP_HEADER],
      },
    },

    databaseHooks: {
      session: {
        create: {
          // A Better Auth identity is never enough to enter DROMEX. Better
          // Auth runs this before inserting the session row and aborts the
          // insert when it returns false, so a user without an active
          // principal is never issued a session at all. A failed lookup
          // throws, which also aborts the insert.
          before: async (session) => {
            const principal = await createPrincipalRepository(input.database).findByUserId(session.userId);
            if (principal === null || principal.status !== 'active') {
              return false;
            }
          },
        },
      },
    },

    // Only explicitly approved plugins: two-factor, and nothing else — no
    // admin, social, bearer, JWT, Expo, invitation, email verification,
    // password reset, magic link, or email OTP.
    plugins: [createTwoFactorPlugin()],
  };
}
