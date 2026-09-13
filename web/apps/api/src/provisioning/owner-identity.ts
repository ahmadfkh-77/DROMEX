import { betterAuth } from 'better-auth';
import { isAPIError } from 'better-auth/api';
import type { Pool } from 'pg';

import { createAuthOptions, type AuthSettings } from '../auth/config.ts';
import { createPrincipalRepository } from '../auth/principal.ts';
import type { OwnerInput } from './owner-input.ts';

/**
 * The seam between Owner provisioning and Better Auth.
 *
 * Every change to a Better Auth identity goes through Better Auth's own
 * documented server API — `signUpEmail`, `signInEmail`, `signOut` — and never
 * through SQL written here.
 */
export interface OwnerIdentityPort {
  /** Creates the identity. Creates no session. */
  create(input: OwnerInput): Promise<{ userId: string }>;
  /**
   * Proves the operator knows the password of an existing identity by signing
   * in through Better Auth, then revokes the session that sign-in issued
   * before returning. `false` for a wrong password or a different identity.
   */
  verify(input: { email: string; password: string; userId: string }): Promise<boolean>;
}

/**
 * Builds the provisioning-only Better Auth instance.
 *
 * It lives outside `src/auth/`, is imported by nothing the server imports, is
 * never mounted on a route, and reads no environment value: nothing a web
 * request or a deployment setting can do reaches it. It starts from exactly
 * the runtime options and differs only where creating the first Owner
 * requires it:
 *
 * - `disableSignUp: false` — `signUpEmail` is the documented way to create an
 *   email/password identity. `autoSignIn` stays `false`, so creation issues no
 *   session.
 * - The session hook admits one session only: the one `verify` requests for
 *   the identity it is checking, and only while that identity has no
 *   principal. Every other session is refused, including for active
 *   principals, which the runtime would admit.
 * - Better Auth's logger is disabled, so a database error carrying row data
 *   can never be printed to the operator's terminal.
 */
export function createOwnerProvisioningIdentity(
  settings: AuthSettings,
  pool: Pool,
): OwnerIdentityPort {
  const options = createAuthOptions({ ...settings, database: pool });
  const principals = createPrincipalRepository(pool);
  let verifyingUserId: string | null = null;

  const auth = betterAuth({
    ...options,
    logger: { disabled: true },
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
            if (verifyingUserId === null || session.userId !== verifyingUserId) return false;
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

    async verify({ email, password, userId }) {
      verifyingUserId = userId;
      let signedIn;
      try {
        signedIn = await auth.api.signInEmail({
          body: { email, password, rememberMe: false },
          returnHeaders: true,
        });
      } catch (error) {
        // A wrong password, and a session refused by the hook above, are both
        // UNAUTHORIZED. Neither proves anything, so neither claims anything.
        if (isAPIError(error) && error.statusCode === 401) return false;
        throw error;
      } finally {
        verifyingUserId = null;
      }

      // Revoke before deciding anything. The cookie is the signed token
      // Better Auth itself issued; sign-out deletes exactly that session.
      const cookie = signedIn.headers
        .getSetCookie()
        .map((value) => value.split(';')[0] ?? '')
        .filter((value) => value.includes('session_token='))
        .join('; ');
      if (cookie === '') {
        throw new Error('Better Auth issued no session cookie to revoke.');
      }
      await auth.api.signOut({ headers: new Headers({ cookie }) });

      return signedIn.response.user.id === userId;
    },
  };
}
