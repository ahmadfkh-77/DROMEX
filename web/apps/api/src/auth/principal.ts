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
 * principal are controlled operations that belong to services with their own
 * auditing and Owner protection.
 */

/**
 * `pending` (DEC-444) is an invited Admin whose setup has not completed. It
 * is never active, never the Owner, and never MFA-complete, and every gate
 * refuses it exactly as it refuses a missing or disabled principal.
 */
export type PrincipalStatus = 'pending' | 'active' | 'disabled';

export interface Principal {
  /** Stable Better Auth user id. The join key for historical attribution. */
  userId: string;
  status: PrincipalStatus;
  isOwner: boolean;
  /**
   * When mandatory MFA activation completed (DEC-434), read from the
   * database. `null` means incomplete, and an incomplete principal is never
   * authenticated. An active status alone never implies MFA.
   */
  mfaCompletedAt: Date | null;
}

export interface PrincipalRepository {
  /** Returns the principal, or `null` when the user has none. */
  findByUserId(userId: string): Promise<Principal | null>;
}

interface PrincipalRow {
  user_id: string;
  status: PrincipalStatus;
  is_owner: boolean;
  mfa_completed_at: Date | null;
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
        `SELECT user_id, status, is_owner, mfa_completed_at
           FROM dromex_principal
          WHERE user_id = $1`,
        [userId],
      );

      const row = rows[0];
      if (row === undefined) {
        return null;
      }

      return {
        userId: row.user_id,
        status: row.status,
        isOwner: row.is_owner,
        mfaCompletedAt: row.mfa_completed_at instanceof Date ? row.mfa_completed_at : null,
      };
    },
  };
}

/**
 * Raised when a principal may not proceed.
 *
 * Carries no detail on purpose, so missing, pending, and disabled principals
 * cannot be distinguished by an outside observer.
 */
export class PrincipalAccessDeniedError extends Error {
  constructor() {
    super('Access denied.');
    this.name = 'PrincipalAccessDeniedError';
  }
}

/**
 * Fail-closed gate: returns the principal only when it exists and is active.
 * Everything else, including a pending principal, is refused with the
 * identical error.
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
