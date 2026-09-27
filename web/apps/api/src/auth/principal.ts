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
  /**
   * When the password last changed through password reset (DEC-487 (3)),
   * read from the database. Every session gate refuses a session created
   * before it. `null` means the password never changed that way.
   */
  credentialsChangedAt: Date | null;
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
  credentials_changed_at: Date | null;
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
        `SELECT user_id, status, is_owner, mfa_completed_at, credentials_changed_at
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
        credentialsChangedAt: row.credentials_changed_at instanceof Date ? row.credentials_changed_at : null,
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

/**
 * The credential-change session rule (DEC-487 (3)): whether a session created
 * at `createdAt` began before the principal's last password change, and so
 * must be refused. A session with no usable creation time counts as older.
 */
export function sessionPredatesCredentialChange(
  principal: Pick<Principal, 'credentialsChangedAt'>,
  createdAt: Date | null,
): boolean {
  if (principal.credentialsChangedAt === null) return false;
  if (createdAt === null || !Number.isFinite(createdAt.getTime())) return true;
  return createdAt.getTime() < principal.credentialsChangedAt.getTime();
}

/**
 * How long a claimed password reset blocks new sessions. The password write
 * takes well under this; a claim older than it is treated as crashed, swept to
 * `failed`, and no longer blocks sign-in (DEC-487 (3)).
 */
export const PASSWORD_RESET_CLAIM_WINDOW_SECONDS = 120;

/** Anything that runs a parameterised query: a pool or a transaction client. */
interface QueryRunner {
  query<R extends object>(text: string, values: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * Whether a password reset for this user is being written right now. Every
 * session-creation hook refuses a new session while it is, so no session can
 * begin between the claim and the password change and outlive it.
 */
export async function passwordResetInProgress(db: QueryRunner, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ busy: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM dromex_password_reset
        WHERE user_id = $1 AND status = 'claimed'
          AND claimed_at > CURRENT_TIMESTAMP - make_interval(secs => $2)
     ) AS busy`,
    [userId, PASSWORD_RESET_CLAIM_WINDOW_SECONDS],
  );
  return rows[0]?.busy === true;
}
