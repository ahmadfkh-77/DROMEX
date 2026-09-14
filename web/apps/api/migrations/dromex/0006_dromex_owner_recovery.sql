-- DROMEX-owned migration 0006: Owner recovery state (DEC-436).
--
-- Better Auth owns the factor, the recovery codes, and the sessions. This
-- migration adds only what Better Auth does not model: that one Better Auth
-- session is an Owner recovery session, which step of authenticator
-- replacement it has reached, and when it expires. No secret is stored: there
-- is no column for a password, code, cookie, or token, and there must never be
-- one. `session_id` is Better Auth's internal session identifier, not the
-- session token.

CREATE TABLE dromex_owner_recovery (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- RESTRICT, as for principals: an identity with recovery history must not
  -- disappear from under it.
  user_id         TEXT NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,

  -- The one Better Auth session currently bound to this recovery. Better Auth
  -- rotates the session when the old factor is disabled, so the binding moves
  -- with it; every session ever bound is kept in dromex_recovery_session.
  session_id      TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 255),

  -- code_accepted:       a recovery code was accepted; nothing replaced yet.
  -- replacement_started: the start step was claimed; the old factor is being
  --                      disabled.
  -- enrolment_started:   the old factor is disabled and a new one enrolled,
  --                      awaiting verification.
  -- completed | failed | expired | abandoned: ended.
  step            TEXT NOT NULL CHECK (step IN (
                    'code_accepted', 'replacement_started', 'enrolment_started',
                    'completed', 'failed', 'expired', 'abandoned'
                  )),

  -- Once true, never false again: the old factor no longer exists, so any end
  -- other than completion requires terminal recovery.
  factor_disabled BOOLEAN NOT NULL DEFAULT FALSE,

  verify_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (verify_attempts BETWEEN 0 AND 5),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,

  -- A recovery state never lives longer than five minutes, whatever the
  -- application asks for.
  CONSTRAINT dromex_owner_recovery_lifetime CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '5 minutes'
  ),
  CONSTRAINT dromex_owner_recovery_open_steps CHECK (
    (step IN ('code_accepted', 'replacement_started', 'enrolment_started')) = (ended_at IS NULL)
  ),
  CONSTRAINT dromex_owner_recovery_enrolment_after_disable CHECK (
    step <> 'enrolment_started' OR factor_disabled
  )
);

-- At most one recovery in progress per user, and at most one per session.
CREATE UNIQUE INDEX dromex_owner_recovery_one_open_per_user
  ON dromex_owner_recovery (user_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX dromex_owner_recovery_one_open_per_session
  ON dromex_owner_recovery (session_id) WHERE ended_at IS NULL;

-- Every Better Auth session ever bound to a recovery. The ordinary
-- authentication gate refuses any session listed here, permanently, so a
-- recovery session can never become an ordinary session.
CREATE TABLE dromex_recovery_session (
  session_id  TEXT PRIMARY KEY CHECK (length(session_id) BETWEEN 1 AND 255),
  recovery_id BIGINT NOT NULL REFERENCES dromex_owner_recovery (id) ON DELETE RESTRICT,
  bound_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX dromex_recovery_session_recovery ON dromex_recovery_session (recovery_id);
