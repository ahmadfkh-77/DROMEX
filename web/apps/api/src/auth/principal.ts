import type { Pool } from 'pg';

/**
 * The DROMEX principal: what DROMEX knows about an authenticated identity,
 * as distinct from what Better Auth knows.
 *
 * Better Auth answers "is this a valid session for a real user". That is not
 * the same question as "may this person use DROMEX", and conflating them is
 * the gap this module exists to close: a Better Auth session is necessary but
 * never sufficient.
 *
 * Deliberately read-only. Creating, disabling, promoting, or demoting a
 * principal are controlled operations that belong to services in later
 * checkpoints, with their own auditing and Owner protection. Exposing them
 * here would make them reachable before those controls exist.
 */

export type PrincipalStatus = 'active' | 'disabled';

export interface Principal {
  /** Stable Better Auth user id. The join key for historical attribution. */
  userId: string;
  status: PrincipalStatus;
  isOwner: boolean;
}

export interface PrincipalRepository {
  /** Returns the principal, or `null` when the user has none. */
  findByUserId(userId: string): Promise<Principal | null>;
}

interface PrincipalRow {
  user_id: string;
  status: PrincipalStatus;
  is_owner: boolean;
}

/**
 * Reads principals from PostgreSQL.
 *
 * The pool is injected rather than created, so tests exercise the real query
 * against a real database instead of a mock that could agree with a mistake.
 */
export function createPrincipalRepository(pool: Pool): PrincipalRepository {
  return {
    async findByUserId(userId: string): Promise<Principal | null> {
      // Parameterised, always. The identifier originates from a session and
      // is never concatenated into SQL (ASVS 1.2.4).
      const { rows } = await pool.query<PrincipalRow>(
        `SELECT user_id, status, is_owner
           FROM dromex_principal
          WHERE user_id = $1`,
        [userId],
      );

      const row = rows[0];
      if (row === undefined) {
        return null;
      }

      return { userId: row.user_id, status: row.status, isOwner: row.is_owner };
    },
  };
}

/**
 * Raised when a principal may not proceed.
 *
 * Carries no detail on purpose. It does not say whether the principal was
 * missing or disabled, does not name the user, and does not quote the
 * database or the query — so the same message serves both cases and neither
 * can be distinguished by an outside observer. Future server code translates
 * this into one uniform unauthorized response.
 */
export class PrincipalAccessDeniedError extends Error {
  constructor() {
    super('Access denied.');
    this.name = 'PrincipalAccessDeniedError';
  }
}

/**
 * Fail-closed gate: returns the principal only when it exists and is active.
 *
 * Everything else — missing, disabled, or any state not recognised as active
 * — is refused with the identical error. Deny is the default, and a state
 * this function does not understand is denied rather than waved through
 * (OWASP A01).
 */
export async function requireActivePrincipal(
  repository: PrincipalRepository,
  userId: string,
): Promise<Principal> {
  const principal = await repository.findByUserId(userId);

  if (principal === null || principal.status !== 'active') {
    throw new PrincipalAccessDeniedError();
  }

  return principal;
}
