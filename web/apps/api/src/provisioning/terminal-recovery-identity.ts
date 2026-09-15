import { betterAuth } from 'better-auth';
import { isAPIError } from 'better-auth/api';
import { parseEnvelope } from 'better-auth/crypto';
import type { Pool } from 'pg';

import { createAuthOptions, createTwoFactorPlugin, type AuthSettings } from '../auth/config.ts';
import { createPrincipalRepository } from '../auth/principal.ts';
import { normalizeRecoveryCode } from '../auth/recovery-codes.ts';

/**
 * The seam between terminal Owner recovery (DEC-437) and Better Auth.
 *
 * Every change to a factor, a recovery-code set, or a session goes through
 * Better Auth's documented server API — `signInEmail`, `verifyTOTP`,
 * `getSession`, `viewBackupCodes`, `disableTwoFactor`, `enableTwoFactor`,
 * `generateBackupCodes`, `revokeSessions` — never through SQL written here.
 * The one read-only query below inspects the stored codes' encryption
 * envelope, so a set encrypted under a retired secret version is recognised
 * without attempting to decrypt it.
 *
 * Cookies passed between operations are Better Auth's own signed cookies,
 * held only in this process's memory.
 */

export type RecoverySignIn =
  /** No enabled factor: an ordinary Better Auth session. */
  | { kind: 'session'; cookie: string }
  /** An enabled factor: a signed challenge cookie, proving only the password. */
  | { kind: 'challenge'; cookie: string }
  | { kind: 'invalid' };

export type RecoveryVerify = { kind: 'verified'; cookie: string } | { kind: 'invalid' } | { kind: 'locked' };

export type StoredCodeState =
  | { kind: 'usable'; count: number }
  /** No factor row, or no usable code left in it. */
  | { kind: 'none' }
  /** Encrypted under a secret version that is no longer configured. */
  | { kind: 'unreadable' };

export interface TerminalRecoveryIdentityPort {
  /** Proves the password for exactly this identity. */
  signIn(input: { email: string; password: string; userId: string }): Promise<RecoverySignIn>;
  /** Verifies a code against a challenge cookie or an enrolment session. */
  verifyTotp(input: { cookie: string; code: string; userId: string }): Promise<RecoveryVerify>;
  /** Better Auth's internal identifier of the session this cookie carries. */
  sessionIdOf(input: { cookie: string; userId: string }): Promise<string>;
  storedCodeState(userId: string): Promise<StoredCodeState>;
  /** One unused stored code, and only one. */
  retrieveOneCode(userId: string): Promise<string>;
  /** Removes any factor and every code; returns the rotated session cookie. */
  disableFactor(input: { cookie: string; password: string }): Promise<string>;
  /** Starts TOTP enrolment; returns only the otpauth URI. */
  enableTotp(input: { cookie: string; password: string }): Promise<string>;
  /** Replaces every recovery code; the previous set stops working. */
  regenerateCodes(input: { cookie: string; password: string }): Promise<string[]>;
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

function isUsableCode(code: unknown): code is string {
  return typeof code === 'string' && normalizeRecoveryCode(code) === code;
}

/**
 * Builds the terminal-recovery-only Better Auth instance.
 *
 * It lives outside `src/auth/`, is imported by nothing the server imports, is
 * never mounted on a route, and reads no environment value. It starts from
 * exactly the runtime options, including the pinned two-factor plugin, with
 * public sign-up still disabled, and differs only in two ways:
 *
 * - its session hook admits sessions only for the one Owner being recovered,
 *   and only while that identity is an active Owner principal;
 * - Better Auth's logger is disabled, so no database error carrying row data
 *   can reach the operator's terminal.
 */
export function createTerminalRecoveryIdentity(settings: AuthSettings, pool: Pool): TerminalRecoveryIdentityPort {
  const options = createAuthOptions({ ...settings, database: pool });
  const principals = createPrincipalRepository(pool);
  const configuredVersions = new Set(settings.secrets.map((secret) => secret.version));
  let targetUserId: string | null = null;

  const auth = betterAuth({
    ...options,
    logger: { disabled: true },
    plugins: [createTwoFactorPlugin()],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (targetUserId === null || session.userId !== targetUserId) return false;
            const principal = await principals.findByUserId(session.userId);
            if (principal === null || principal.status !== 'active' || principal.isOwner !== true) return false;
          },
        },
      },
    },
  });

  async function revokeQuietly(cookie: string): Promise<void> {
    await auth.api.revokeSessions({ headers: cookieHeaders(cookie) }).catch(() => undefined);
  }

  return {
    async signIn({ email, password, userId }) {
      targetUserId = userId;

      let result;
      try {
        result = await auth.api.signInEmail({ body: { email, password, rememberMe: false }, returnHeaders: true });
      } catch (error) {
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
        await revokeQuietly(session);
        throw new Error('Better Auth signed in a different identity.');
      }
      return { kind: 'session', cookie: session };
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

      // A challenge creates a session; an enrolment verification rotates it.
      const session = cookieFrom(result.headers, '.session_token') ?? (cookie.includes('.session_token=') ? cookie : null);
      if (session === null) throw new Error('Better Auth issued no session.');
      if (userIdOf(result.response) !== userId) {
        await revokeQuietly(session);
        throw new Error('Better Auth verified a different identity.');
      }
      return { kind: 'verified', cookie: session };
    },

    async sessionIdOf({ cookie, userId }) {
      const result = await auth.api.getSession({ headers: cookieHeaders(cookie) });
      if (result === null || result.user.id !== userId || typeof result.session.id !== 'string') {
        throw new Error('Better Auth reported no session for this identity.');
      }
      return result.session.id;
    },

    async storedCodeState(userId) {
      const { rows } = await pool.query<{ codes: string }>(
        `SELECT "backupCodes" AS codes FROM "twoFactor" WHERE "userId" = $1`,
        [userId],
      );
      if (rows.length === 0) return { kind: 'none' };
      if (rows.length > 1) throw new Error('More than one factor row exists for this identity.');

      const envelope = parseEnvelope(rows[0]!.codes);
      if (envelope !== null && !configuredVersions.has(envelope.version)) return { kind: 'unreadable' };

      let codes: unknown;
      try {
        codes = (await auth.api.viewBackupCodes({ body: { userId } })).backupCodes;
      } catch (error) {
        if (isAPIError(error) && error.statusCode === 400) return { kind: 'none' };
        throw error;
      }
      const usable = Array.isArray(codes) ? codes.filter(isUsableCode).length : 0;
      return usable > 0 ? { kind: 'usable', count: usable } : { kind: 'none' };
    },

    async retrieveOneCode(userId) {
      const { backupCodes } = await auth.api.viewBackupCodes({ body: { userId } });
      const code = backupCodes.find(isUsableCode);
      if (code === undefined) throw new Error('No usable recovery code is stored.');
      return code;
    },

    async disableFactor({ cookie, password }) {
      const result = await auth.api.disableTwoFactor({
        body: { password },
        headers: cookieHeaders(cookie),
        returnHeaders: true,
      });
      const session = cookieFrom(result.headers, '.session_token');
      if (session === null) throw new Error('Better Auth issued no session after disabling the factor.');
      return session;
    },

    async enableTotp({ cookie, password }) {
      const result = await auth.api.enableTwoFactor({
        body: { password, method: 'totp' },
        headers: cookieHeaders(cookie),
      });
      if (!('totpURI' in result) || typeof result.totpURI !== 'string') {
        throw new Error('Better Auth returned no TOTP enrolment material.');
      }
      return result.totpURI;
    },

    async regenerateCodes({ cookie, password }) {
      const result = await auth.api.generateBackupCodes({ body: { password }, headers: cookieHeaders(cookie) });
      return [...result.backupCodes];
    },

    async revokeAllSessions({ cookie }) {
      await auth.api.revokeSessions({ headers: cookieHeaders(cookie) });
    },
  };
}
