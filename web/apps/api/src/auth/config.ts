import type { BetterAuthOptions } from 'better-auth';
import type { Pool } from 'pg';

import { hashPassword, verifyPassword } from './hashing.ts';

/**
 * Better Auth configuration for the DROMEX web application.
 *
 * This module builds and validates the options object. It deliberately does
 * **not** construct a Better Auth instance, mount a route, or touch the
 * database: that keeps it a pure, fully testable function and keeps these
 * tests Docker-free. Wiring belongs to a later checkpoint.
 *
 * Every value arrives through explicit parameters. This module never reads
 * `process.env` and never loads a `.env` file, so a test can exercise every
 * branch — including production — without the ambient environment deciding
 * anything, and so no configuration can be smuggled in implicitly.
 */

export type AuthEnvironment = 'development' | 'test' | 'production';

export interface AuthConfigInput {
  /** Chooses the security posture. Never inferred from the environment. */
  environment: AuthEnvironment;
  /** Better Auth signing secret, supplied by validated runtime config. */
  secret: string;
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

/** 12 hours. A working day, not a working week. */
const SESSION_EXPIRES_IN_SECONDS = 12 * 60 * 60;
/** 1 hour. How often an active session's expiry is extended. */
const SESSION_UPDATE_AGE_SECONDS = 60 * 60;

/**
 * Better Auth's documented minimum shape for a secret.
 *
 * This is a **shape** check, not an entropy check: a length threshold cannot
 * distinguish 32 random bytes from 32 repetitions of the same character, and
 * nothing here claims otherwise. It catches an empty value, a placeholder, or
 * a hand-typed string. Producing a genuinely random secret remains an
 * operational secret-generation requirement outside this module.
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
 * Throws when the secret is absent or malformed.
 *
 * The offending value is never included in the message, the stack, or
 * anywhere else. A validation error that echoes the secret writes it into
 * logs, terminal scrollback, and CI output — exactly where it must not be.
 *
 * Surrounding whitespace is rejected rather than trimmed. Trimming for the
 * check and then returning the untrimmed value would validate one string and
 * use a different one, so a secret that passes validation could still fail to
 * match the value an operator believes they configured.
 */
function validateSecret(secret: unknown): string {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error(
      'Better Auth secret is missing. Supply it through validated runtime configuration; there is no fallback.',
    );
  }

  if (secret !== secret.trim()) {
    throw new Error(
      'Better Auth secret is invalid: it must not begin or end with whitespace. The value itself is not shown.',
    );
  }

  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `Better Auth secret is invalid: it must be at least ${MINIMUM_SECRET_LENGTH} characters. The value itself is not shown.`,
    );
  }

  return secret;
}

/**
 * Validates one origin and returns it in canonical `URL.origin` form: scheme,
 * host, and port only, lower-cased, with no trailing slash.
 *
 * Shared by `baseURL` and every trusted origin so the two can never drift
 * apart — a `baseURL` accepted under looser rules than the origins it is
 * compared against is precisely the kind of mismatch that produces a
 * CSRF check which passes when it should not.
 *
 * Anything carrying more than an origin is refused rather than silently
 * discarded: a path, query, fragment, or embedded credential in a value that
 * is only ever used as an origin means the caller believes it configured
 * something this module would quietly ignore.
 *
 * `label` names the field for the error message. The supplied value is never
 * echoed, because a rejected origin can carry credentials.
 */
function normalizeOrigin(
  value: unknown,
  environment: AuthEnvironment,
  label: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is missing: an absolute http or https URL is required.`);
  }

  if (value.includes('*')) {
    throw new Error(
      `${label} contains a wildcard. Wildcards are refused: list each origin explicitly.`,
    );
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
 * Validates every trusted origin through {@link normalizeOrigin} and returns
 * the canonical list.
 *
 * Duplicates are **removed** after normalisation rather than rejected: two
 * spellings of one origin (a trailing slash, a mixed-case host) are the same
 * origin, and refusing the list over a harmless restatement would be a
 * configuration failure with no security benefit. Distinct origins are of
 * course preserved.
 *
 * Wildcards are refused in every environment, not only production: a wildcard
 * turns the Origin check that Better Auth's CSRF defence rests on into one
 * that passes for any subdomain, including one an attacker controls after a
 * subdomain takeover.
 */
function validateTrustedOrigins(
  origins: readonly string[],
  environment: AuthEnvironment,
): string[] {
  if (origins.length === 0) {
    throw new Error(
      'At least one trusted origin is required. The allowlist must be explicit.',
    );
  }

  const normalized = origins.map((origin, index) =>
    normalizeOrigin(origin, environment, `Trusted origin at index ${index}`),
  );

  return [...new Set(normalized)];
}

/**
 * Decides the `Secure` cookie flag, and refuses to build a configuration that
 * would ship insecure cookies anywhere but a developer's machine.
 *
 * Production does not merely default to secure — it cannot be talked out of
 * it. Asking for insecure cookies outside development throws rather than
 * being ignored, so the mistake surfaces at startup instead of silently
 * producing a weaker cookie than the operator believes they configured.
 */
function resolveUseSecureCookies(
  environment: AuthEnvironment,
  allowInsecureCookies: boolean,
): boolean {
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
 * Builds the validated Better Auth options.
 *
 * Throws on any invalid input rather than falling back to a weaker default:
 * a configuration error must stop the process, not quietly degrade it.
 */
export function createAuthOptions(input: AuthConfigInput): BetterAuthOptions {
  const secret = validateSecret(input.secret);
  const baseURL = normalizeOrigin(input.baseURL, input.environment, 'baseURL');
  const trustedOrigins = validateTrustedOrigins(input.trustedOrigins, input.environment);
  const useSecureCookies = resolveUseSecureCookies(
    input.environment,
    input.allowInsecureCookies ?? false,
  );

  return {
    database: input.database,
    secret,
    baseURL,
    trustedOrigins,

    // Opt out explicitly. It is already off by default, which is exactly why
    // it is pinned: a future default change must not start reporting.
    telemetry: { enabled: false },

    emailAndPassword: {
      enabled: true,
      // Better Auth's own default is false. The only account Phase 2C may
      // have is the CLI-provisioned Owner; there is no invitation flow yet
      // (OQ-161) and no public registration ever.
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: 15,
      maxPasswordLength: 128,
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
      // revocation. `freshAge` is deliberately absent: its support in this
      // version is unverified, and the 5-minute threshold stays deferred.
      cookieCache: { enabled: false },
    },

    rateLimit: {
      // Better Auth disables rate limiting in development by default, which
      // would leave the limit unexercised by local tests.
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
      },
    },

    advanced: {
      useSecureCookies,
    },

    // Only explicitly approved plugins and authentication methods are
    // enabled, to keep the attack surface as small as the product allows.
    // Nothing is switched on until a checkpoint deliberately opens it: no
    // admin, MFA, social, bearer, JWT, Expo, invitation, email verification,
    // or password reset.
    plugins: [],
  };
}
