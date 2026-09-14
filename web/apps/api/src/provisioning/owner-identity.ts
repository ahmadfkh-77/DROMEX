import { betterAuth } from 'better-auth';
import { isAPIError } from 'better-auth/api';
import type { Pool } from 'pg';

import { createAuthOptions, createTwoFactorPlugin, type AuthSettings } from '../auth/config.ts';
import { createPrincipalRepository } from '../auth/principal.ts';
import type { OwnerInput } from './owner-input.ts';

/**
 * The seam between Owner activation and Better Auth.
 *
 * Every change to a Better Auth identity, factor, recovery-code set, or
 * session goes through Better Auth's own documented server API —
 * `signUpEmail`, `signInEmail`, `enableTwoFactor`, `verifyTOTP`,
 * `generateBackupCodes`, `revokeSessions` — and never through SQL written
 * here. Cookies passed between operations are Better Auth's own signed
 * cookies, used only inside this process.
 */

export type SignInOutcome =
  /** The account has no verified factor yet: an ordinary session. */
  | { kind: 'session'; cookie: string }
  /** The account has a verified factor: a signed challenge cookie. */
  | { kind: 'challenge'; cookie: string }
  | { kind: 'invalid' };

export type VerifyOutcome =
  | { kind: 'verified'; cookie: string }
  | { kind: 'invalid' }
  | { kind: 'locked' };

export interface EnrollmentMaterial {
  totpUri: string;
  recoveryCodes: string[];
}

export interface OwnerIdentityPort {
  /** Creates the identity. Creates no session. */
  create(input: OwnerInput): Promise<{ userId: string }>;
  /** Proves the password for exactly this identity. */
  signIn(input: { email: string; password: string; userId: string }): Promise<SignInOutcome>;
  /** Starts TOTP enrolment for the signed-in identity. */
  enableTotp(input: { cookie: string; password: string }): Promise<EnrollmentMaterial>;
  /** Verifies a code against either an enrolment session or a challenge cookie. */
  verifyTotp(input: { cookie: string; code: string; userId: string }): Promise<VerifyOutcome>;
  /** Replaces every recovery code; the previous set stops working. */
  regenerateRecoveryCodes(input: { cookie: string; password: string }): Promise<string[]>;
  /** Revokes every session of the signed-in identity. */
  revokeAllSessions(input: { cookie: string }): Promise<void>;
}

function cookieHeaders(cookie: string): Headers {
  return new Headers({ cookie });
}

/** The `name=value` pair of the first non-empty Set-Cookie whose name ends with `suffix`. */
function cookieFrom(headers: Headers, suffix: string): string | null {
  for (const cookie of headers.getSetCookie()) {
    const pair = cookie.split(';')[0]!.trim();
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    if (pair.slice(0, separator).endsWith(suffix) && pair.slice(separator + 1) !== '') return pair;
  }
  return null;
}

function userIdOf(body: unknown): unknown {
  return (body as { user?: { id?: unknown } } | null)?.user?.id;
}

/**
 * Builds the provisioning-only Better Auth instance.
 *
 * It lives outside `src/auth/`, is imported by nothing the server imports, is
 * never mounted on a route, and reads no environment value. It starts from
 * exactly the runtime options, including the pinned two-factor plugin, and
 * differs only where activating the first Owner requires it:
 *
 * - `disableSignUp: false`, so `signUpEmail` can create the identity.
 *   `autoSignIn` stays `false`.
 * - The session hook admits sessions only for the one identity being
 *   activated, and only while it has no principal. Every other session is
 *   refused, including for active principals the runtime would admit.
 * - Better Auth's logger is disabled, so a database error carrying row data
 *   can never be printed to the operator's terminal.
 */
export function createOwnerProvisioningIdentity(settings: AuthSettings, pool: Pool): OwnerIdentityPort {
  const options = createAuthOptions({ ...settings, database: pool });
  const principals = createPrincipalRepository(pool);
  let activatingUserId: string | null = null;

  const auth = betterAuth({
    ...options,
    logger: { disabled: true },
    plugins: [createTwoFactorPlugin()],
    emailAndPassword: {
      ...options.emailAndPassword,
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (activatingUserId === null || session.userId !== activatingUserId) return false;
            if ((await principals.findByUserId(session.userId)) !== null) return false;
          },
        },
      },
    },
  });

  return {
    async create(input) {
      const result = await auth.api.signUpEmail({
        body: { name: input.name, email: input.email, password: input.password },
      });
      return { userId: result.user.id };
    },

    async signIn({ email, password, userId }) {
      activatingUserId = userId;

      let result;
      try {
        result = await auth.api.signInEmail({
          body: { email, password, rememberMe: false },
          returnHeaders: true,
        });
      } catch (error) {
        // A wrong password, and a session refused by the hook above for a
        // different identity, are both UNAUTHORIZED. Neither proves anything.
        if (isAPIError(error) && error.statusCode === 401) return { kind: 'invalid' };
        throw error;
      }

      const body: unknown = result.response;
      if ((body as { twoFactorRedirect?: unknown } | null)?.twoFactorRedirect === true) {
        const challenge = cookieFrom(result.headers, '.two_factor');
        if (challenge === null) throw new Error('Better Auth issued no challenge cookie.');
        return { kind: 'challenge', cookie: challenge };
      }

      const session = cookieFrom(result.headers, '.session_token');
      if (session === null) throw new Error('Better Auth issued no session cookie.');
      if (userIdOf(body) !== userId) {
        await auth.api.signOut({ headers: cookieHeaders(session) });
        return { kind: 'invalid' };
      }
      return { kind: 'session', cookie: session };
    },

    async enableTotp({ cookie, password }) {
      const result = await auth.api.enableTwoFactor({
        body: { password, method: 'totp' },
        headers: cookieHeaders(cookie),
      });
      if (!('totpURI' in result) || typeof result.totpURI !== 'string' || !Array.isArray(result.backupCodes)) {
        throw new Error('Better Auth returned no TOTP enrolment material.');
      }
      return { totpUri: result.totpURI, recoveryCodes: [...result.backupCodes] };
    },

    async verifyTotp({ cookie, code, userId }) {
      let result;
      try {
        result = await auth.api.verifyTOTP({
          body: { code, trustDevice: false },
          headers: cookieHeaders(cookie),
          returnHeaders: true,
        });
      } catch (error) {
        if (isAPIError(error)) {
          if (error.statusCode === 429) return { kind: 'locked' };
          if (error.statusCode === 401 || error.statusCode === 400) return { kind: 'invalid' };
        }
        throw error;
      }

      // An enrolment verification rotates the session; a challenge creates
      // one. Either way the new session cookie replaces the one passed in.
      const session = cookieFrom(result.headers, '.session_token') ?? cookie;
      if (userIdOf(result.response) !== userId) {
        await auth.api.revokeSessions({ headers: cookieHeaders(session) }).catch(() => undefined);
        throw new Error('Better Auth verified a different identity.');
      }
      return { kind: 'verified', cookie: session };
    },

    async regenerateRecoveryCodes({ cookie, password }) {
      const result = await auth.api.generateBackupCodes({
        body: { password },
        headers: cookieHeaders(cookie),
      });
      return [...result.backupCodes];
    },

    async revokeAllSessions({ cookie }) {
      await auth.api.revokeSessions({ headers: cookieHeaders(cookie) });
    },
  };
}
