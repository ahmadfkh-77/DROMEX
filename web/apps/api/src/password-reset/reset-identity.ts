import { betterAuth } from 'better-auth';
import { isAPIError } from 'better-auth/api';
import type { Pool } from 'pg';

import { createAuthOptions, createTwoFactorPlugin, type AuthSettings } from '../auth/config.ts';
import { checkNewPassword } from '../auth/password-policy.ts';

/**
 * The server-internal Better Auth capability that performs the final password
 * write of a DROMEX password reset (DEC-487 (2)).
 *
 * Better Auth 1.7.4 offers exactly one supported way to set a password
 * without a session or the current password: its reset endpoints. This module
 * uses them only as a write primitive. DROMEX has already verified and
 * claimed its own public token, checked eligibility, and stamped the
 * credential change before {@link ResetIdentityPort.writePassword} runs.
 *
 * **Never routable.** The instance is built inside {@link createResetIdentity}
 * and never leaves it: no handler is referenced and nothing is mounted. A
 * boundary test proves the password-reset service is the only importer and
 * that Better Auth's own reset routes answer 404 on the server.
 *
 * It starts from exactly the runtime options, including the pinned two-factor
 * plugin, and differs only where the write requires it:
 *
 * - `sendResetPassword` hands Better Auth's token to this module's memory and
 *   nowhere else: no email, log, or URL. The token is consumed at once by
 *   `resetPassword` in the same call.
 * - That token expires after {@link RESET_WRITE_TOKEN_SECONDS} and its
 *   verification identifier is stored as a SHA-256 hash (DEC-441 (4)).
 * - `revokeSessionsOnPasswordReset` deletes every session of the user.
 * - The session hook refuses every session: this instance never signs in.
 * - Sign-up stays disabled, and Better Auth's logger is disabled.
 *
 * Nothing here reads the environment or writes a Better Auth-owned row by SQL.
 */

/** Better Auth's internal reset token only has to survive one in-process call. */
const RESET_WRITE_TOKEN_SECONDS = 60;

export type PasswordWriteOutcome = 'written' | 'rejected';

export interface ResetIdentityPort {
  /**
   * Replaces the password of exactly this identity and deletes all its
   * sessions. `rejected` when the password fails the shared policy. Throws on
   * anything else; the caller treats a throw as a failed reset.
   */
  writePassword(input: { userId: string; email: string; newPassword: string }): Promise<PasswordWriteOutcome>;
}

function statusOf(error: unknown): number | null {
  return isAPIError(error) ? error.statusCode : null;
}

export function createResetIdentity(settings: AuthSettings, pool: Pool): ResetIdentityPort {
  const options = createAuthOptions({ ...settings, database: pool });

  /** Tokens Better Auth issued during a call, by user id. Emptied on every exit. */
  const issued = new Map<string, string | null>();

  const auth = betterAuth({
    ...options,
    logger: { disabled: true },
    plugins: [createTwoFactorPlugin()],
    emailAndPassword: {
      ...options.emailAndPassword,
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: RESET_WRITE_TOKEN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      // Only a call already waiting for this exact user receives the token.
      sendResetPassword: async ({ user, token }) => {
        if (issued.has(user.id)) issued.set(user.id, token);
      },
    },
    verification: {
      ...options.verification,
      storeIdentifier: { default: 'plain', overrides: { 'reset-password:': 'hashed' } },
    },
    databaseHooks: {
      session: {
        create: {
          before: async () => false,
        },
      },
    },
  });

  return {
    async writePassword({ userId, email, newPassword }) {
      // DEC-488, enforced at the port as well as by the service.
      if (!checkNewPassword(newPassword).ok) return 'rejected';
      if (issued.has(userId)) throw new Error('A password write for this identity is already running.');

      issued.set(userId, null);
      try {
        await auth.api.requestPasswordReset({ body: { email } });
        const token = issued.get(userId) ?? null;
        if (token === null) throw new Error('Better Auth issued no reset token for this identity.');

        try {
          await auth.api.resetPassword({ body: { newPassword, token } });
        } catch (error) {
          const status = statusOf(error);
          const code = (error as { body?: { code?: unknown } }).body?.code;
          if (status === 400 && (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG')) return 'rejected';
          throw error;
        }
        return 'written';
      } finally {
        issued.delete(userId);
      }
    },
  };
}
