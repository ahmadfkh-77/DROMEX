/**
 * The Owner's session-revocation capability (checkpoint 4E): deletes another
 * person's Better Auth sessions through Better Auth's own session store.
 *
 * Why this route into Better Auth. Its public session endpoints revoke only
 * the caller's own sessions; revoking another user's needs the admin plugin,
 * which DROMEX excludes (DEC-422) and which would also require Better Auth
 * schema changes. DEC-431 forbids DROMEX SQL writing Better Auth-owned rows.
 * The internal adapter Better Auth exposes on `auth.$context` deletes the rows
 * through Better Auth's own adapter and hooks, which is what remains.
 *
 * **Deletion is cleanup, never the security boundary.** Before this runs, the
 * account service has already committed, in one DROMEX transaction, the change
 * every gate reads: the principal is disabled, or `sessions_revoked_at` has
 * moved forward. A deletion that fails or is interrupted therefore leaves only
 * rows the gate already refuses.
 *
 * Limited to three operations: list one user's sessions, delete one session of
 * that user, and delete all of that user's sessions. A session is chosen by
 * Better Auth's internal identifier within the named user's own sessions; its
 * token is read from Better Auth, used once to delete it, and never returned,
 * logged, or stored. Imported only by the server, which hands the account
 * service this port; a boundary test enforces that.
 */

interface SessionRecord {
  id: string;
  token: string;
  userId: string;
}

interface SessionStore {
  listSessions(userId: string): Promise<SessionRecord[]>;
  deleteSession(token: string): Promise<void>;
  deleteUserSessions(userId: string): Promise<void>;
}

/** The part of a Better Auth instance this module needs. */
interface SessionStoreOwner {
  $context: Promise<{ internalAdapter: SessionStore }>;
}

interface SessionControlPort {
  /** Deletes one session, only if it belongs to `userId`. `false` when there is no such session. */
  revokeSession(userId: string, sessionId: string): Promise<boolean>;
  /** Deletes every session of `userId`, then reports how many are still stored. */
  revokeAllSessions(userId: string): Promise<{ remaining: number }>;
}

export function createSessionControl(auth: SessionStoreOwner): SessionControlPort {
  const store = async () => (await auth.$context).internalAdapter;

  return {
    async revokeSession(userId, sessionId) {
      const internalAdapter = await store();
      const session = (await internalAdapter.listSessions(userId)).find(
        (candidate) => candidate.id === sessionId && candidate.userId === userId,
      );
      if (session === undefined) return false;
      await internalAdapter.deleteSession(session.token);
      return true;
    },

    async revokeAllSessions(userId) {
      const internalAdapter = await store();
      await internalAdapter.deleteUserSessions(userId);
      const remaining = (await internalAdapter.listSessions(userId)).filter((session) => session.userId === userId);
      return { remaining: remaining.length };
    },
  };
}
