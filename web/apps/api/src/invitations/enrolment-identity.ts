import { betterAuth } from 'better-auth';
import { isAPIError } from 'better-auth/api';
import type { Pool } from 'pg';

import { createAuthOptions, createTwoFactorPlugin, type AuthSettings } from '../auth/config.ts';

/**
 * The server-internal Better Auth capability that creates and enrols an
 * invited Admin identity (DEC-444 (5)).
 *
 * **Never routable.** The instance is built inside {@link createEnrolmentIdentity}
 * and never leaves it: no handler is referenced, nothing is mounted, and only
 * the port below is returned. A boundary test proves that the invitation
 * acceptance service is the only importer of this module, and that the server
 * exposes no sign-up route.
 *
 * It starts from exactly the runtime options, including the pinned two-factor
 * plugin, and differs only where invited enrolment requires it:
 *
 * - `disableSignUp: false`, so `signUpEmail` can create the identity.
 *   `autoSignIn` stays `false`.
 * - The session hook admits a session only for an identity that invitation
 *   setup is enrolling right now: its address has an open enrolment and a
 *   pending, unexpired invitation (at most one exists per address), and it has
 *   either no principal yet
 *   (an identity created but not yet recorded) or a `pending` one. Every other
 *   session is refused, including for active principals the runtime would
 *   admit, the Owner, and any identity whose invitation ended.
 * - Better Auth's logger is disabled, so no error carrying row data, a cookie,
 *   or a secret is ever printed.
 *
 * Every change to an identity, factor, recovery-code set, or session goes
 * through Better Auth's own server API. No Better Auth-owned row is written by
 * SQL here; the hook only reads.
 */

export type EnrolmentSignIn =
  /** No verified factor: an enrolment session. */
  | { kind: 'session'; pair: string; setCookies: string[] }
  /** A verified factor from an interrupted setup: a signed challenge. */
  | { kind: 'challenge'; pair: string; setCookies: string[] }
  | { kind: 'invalid' };

export type EnrolmentVerify =
  | { kind: 'verified'; pair: string; setCookies: string[]; userId: string }
  | { kind: 'invalid' }
  | { kind: 'locked' }
  /** The code was right but the session hook refused the identity. */
  | { kind: 'refused' };

export interface EnrolmentSession {
  sessionId: string;
  userId: string;
  name: string;
}

export interface EnrolmentIdentityPort {
  /** Creates the identity. Creates no session. `rejected` when Better Auth refuses the input. */
  create(input: { name: string; email: string; password: string }): Promise<{ userId: string } | 'rejected'>;
  /** Proves the password for exactly this identity. */
  signIn(input: { email: string; password: string; userId: string }): Promise<EnrolmentSignIn>;
  /** The session a cookie pair names, or null. */
  session(pair: string): Promise<EnrolmentSession | null>;
  /** Starts, or restarts, TOTP enrolment. Returns only the otpauth URI. */
  enableTotp(input: { pair: string; password: string }): Promise<{ totpUri: string } | 'invalid_password'>;
  /** Verifies a code against an enrolment session or a challenge. */
  verifyTotp(input: { pair: string; code: string }): Promise<EnrolmentVerify>;
  /** The recovery codes Better Auth generated at enrolment, read server-side. */
  viewRecoveryCodes(userId: string): Promise<string[]>;
  /** Replaces every recovery code; the previous set stops working. */
  regenerateRecoveryCodes(input: { pair: string; password: string }): Promise<string[] | 'invalid_password'>;
  /** Revokes every session of the identity the pair names. */
  revokeAllSessions(pair: string): Promise<void>;
  /** Revokes every other session of the identity the pair names. */
  revokeOtherSessions(pair: string): Promise<void>;
}

const ADMISSION = `
  SELECT EXISTS (
    SELECT 1
      FROM "user" u
      JOIN dromex_admin_enrolment e ON e.email = u.email
      JOIN dromex_admin_invitation i ON i.email = u.email
      LEFT JOIN dromex_principal p ON p.user_id = u.id
     WHERE u.id = $1
       AND e.step <> 'completed'
       AND i.status = 'pending'
       AND i.expires_at > CURRENT_TIMESTAMP
       AND (
             (p.user_id IS NULL AND e.user_id IS NULL)
          OR (p.status = 'pending' AND NOT p.is_owner AND e.user_id = u.id)
           )
  ) AS admitted`;

function headersFor(pair: string): Headers {
  return new Headers({ cookie: pair });
}

/** The `name=value` pair of the first live Set-Cookie whose name ends with `suffix`. */
function liveCookie(setCookies: readonly string[], suffix: string): string | null {
  for (const cookie of setCookies) {
    if (/;\s*Max-Age=0(\s*;|\s*$)/i.test(cookie)) continue;
    const pair = cookie.split(';')[0]!.trim();
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    if (pair.slice(0, separator).endsWith(suffix) && pair.slice(separator + 1) !== '') return pair;
  }
  return null;
}

/** Only the session and challenge cookies ever leave this module. */
function authCookies(headers: Headers): string[] {
  return headers.getSetCookie().filter((cookie) => {
    const name = cookie.slice(0, Math.max(0, cookie.indexOf('='))).trim();
    return name.endsWith('.session_token') || name.endsWith('.two_factor');
  });
}

function statusOf(error: unknown): number | null {
  return isAPIError(error) ? error.statusCode : null;
}

export function createEnrolmentIdentity(settings: AuthSettings, pool: Pool): EnrolmentIdentityPort {
  const options = createAuthOptions({ ...settings, database: pool });

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
          // A failed lookup throws, which also refuses the session.
          before: async (session) => {
            const { rows } = await pool.query<{ admitted: boolean }>(ADMISSION, [session.userId]);
            if (rows[0]?.admitted !== true) return false;
          },
        },
      },
    },
  });

  return {
    async create({ name, email, password }) {
      try {
        const result = await auth.api.signUpEmail({ body: { name, email, password } });
        return { userId: result.user.id };
      } catch (error) {
        const status = statusOf(error);
        if (status !== null && status >= 400 && status < 500) return 'rejected';
        throw error;
      }
    },

    async signIn({ email, password, userId }) {
      let result;
      try {
        result = await auth.api.signInEmail({ body: { email, password, rememberMe: false }, returnHeaders: true });
      } catch (error) {
        // A wrong password and a refused session are both a failed proof.
        const status = statusOf(error);
        if (status === 401 || status === 403 || status === 400) return { kind: 'invalid' };
        if (status === 500 && (error as { body?: { code?: unknown } }).body?.code === 'FAILED_TO_CREATE_SESSION') {
          return { kind: 'invalid' };
        }
        throw error;
      }

      const setCookies = authCookies(result.headers);
      const body = result.response as { twoFactorRedirect?: unknown; user?: { id?: unknown } } | null;
      if (body?.twoFactorRedirect === true) {
        const challenge = liveCookie(setCookies, '.two_factor');
        if (challenge === null) throw new Error('Better Auth issued no challenge cookie.');
        return { kind: 'challenge', pair: challenge, setCookies };
      }

      const session = liveCookie(setCookies, '.session_token');
      if (session === null) throw new Error('Better Auth issued no session cookie.');
      if (body?.user?.id !== userId) {
        await auth.api.revokeSessions({ headers: headersFor(session) }).catch(() => undefined);
        return { kind: 'invalid' };
      }
      return { kind: 'session', pair: session, setCookies };
    },

    async session(pair) {
      const result = await auth.api.getSession({ headers: headersFor(pair) });
      if (result === null || typeof result.session?.id !== 'string' || typeof result.user?.id !== 'string') return null;
      return { sessionId: result.session.id, userId: result.user.id, name: result.user.name };
    },

    async enableTotp({ pair, password }) {
      let result;
      try {
        result = await auth.api.enableTwoFactor({ body: { password, method: 'totp' }, headers: headersFor(pair) });
      } catch (error) {
        if (statusOf(error) === 400) return 'invalid_password';
        throw error;
      }
      if (!('totpURI' in result) || typeof result.totpURI !== 'string') {
        throw new Error('Better Auth returned no TOTP enrolment material.');
      }
      // The recovery codes in this response are deliberately dropped. Codes
      // are shown only after the factor verifies.
      return { totpUri: result.totpURI };
    },

    async verifyTotp({ pair, code }) {
      let result;
      try {
        result = await auth.api.verifyTOTP({
          body: { code, trustDevice: false },
          headers: headersFor(pair),
          returnHeaders: true,
        });
      } catch (error) {
        const status = statusOf(error);
        if (status === 429) return { kind: 'locked' };
        if (status === 401 || status === 400) return { kind: 'invalid' };
        if (status === 500 && (error as { body?: { code?: unknown } }).body?.code === 'FAILED_TO_CREATE_SESSION') {
          return { kind: 'refused' };
        }
        throw error;
      }

      const setCookies = authCookies(result.headers);
      // An enrolment verification rotates the session; a challenge creates one.
      const session = liveCookie(setCookies, '.session_token') ?? (pair.includes('.session_token=') ? pair : null);
      const userId = (result.response as { user?: { id?: unknown } } | null)?.user?.id;
      if (session === null || typeof userId !== 'string') throw new Error('Better Auth verified no usable session.');
      return { kind: 'verified', pair: session, setCookies, userId };
    },

    async viewRecoveryCodes(userId) {
      const result = await auth.api.viewBackupCodes({ body: { userId } });
      return [...result.backupCodes];
    },

    async regenerateRecoveryCodes({ pair, password }) {
      try {
        const result = await auth.api.generateBackupCodes({ body: { password }, headers: headersFor(pair) });
        return [...result.backupCodes];
      } catch (error) {
        if (statusOf(error) === 400) return 'invalid_password';
        throw error;
      }
    },

    async revokeAllSessions(pair) {
      await auth.api.revokeSessions({ headers: headersFor(pair) });
    },

    async revokeOtherSessions(pair) {
      await auth.api.revokeOtherSessions({ headers: headersFor(pair) });
    },
  };
}
