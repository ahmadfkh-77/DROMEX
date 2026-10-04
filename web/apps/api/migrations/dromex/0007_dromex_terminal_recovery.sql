-- DROMEX-owned migration 0007: terminal emergency Owner recovery (DEC-437).
--
-- Better Auth owns the factor, the recovery codes, and the sessions. This
-- migration adds only what Better Auth does not model: a durable record of
-- each terminal recovery run, the Better Auth sessions a run obtained (so the
-- ordinary gate can refuse them permanently), and the audit vocabulary and
-- references a terminal run needs. No secret is stored: there is no column
-- for a password, code, TOTP secret, cookie, or token, and there must never be
-- one. `session_id` is Better Auth's internal session identifier, not the
-- session token. Earlier migrations are unchanged.

CREATE TABLE dromex_terminal_recovery (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- RESTRICT, as for every DROMEX reference to a Better Auth identity.
  user_id            TEXT NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,

  -- identity_verified: the password was proven; no path chosen yet.
  -- factor_reset:      the DEC-437 reset committed.
  -- enrolment_started: authenticator replacement began.
  -- factor_verified:   a code from the new authenticator was accepted.
  -- completed | code_retrieved | failed | abandoned | interrupted: ended.
  state              TEXT NOT NULL CHECK (state IN (
                       'identity_verified', 'factor_reset', 'enrolment_started', 'factor_verified',
                       'completed', 'code_retrieved', 'failed', 'abandoned', 'interrupted'
                     )),

  path               TEXT CHECK (path IS NULL OR path IN ('retrieval', 'replacement', 'reset')),

  -- The operator's dated incident reference, required for every reset.
  incident_reference TEXT CHECK (incident_reference IS NULL OR incident_reference ~ '^INC-[0-9]{8}-[0-9]{2}$'),

  started_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at           TIMESTAMPTZ,

  CONSTRAINT dromex_terminal_recovery_open_states CHECK (
    (state IN ('identity_verified', 'factor_reset', 'enrolment_started', 'factor_verified')) = (ended_at IS NULL)
  ),
  CONSTRAINT dromex_terminal_recovery_path_by_state CHECK (
    (state <> 'identity_verified' OR path IS NULL)
    AND (state <> 'factor_reset' OR path = 'reset')
    AND (state <> 'code_retrieved' OR path = 'retrieval')
  ),
  CONSTRAINT dromex_terminal_recovery_reset_incident CHECK (
    (path IS NOT DISTINCT FROM 'reset') = (incident_reference IS NOT NULL)
  )
);

-- At most one terminal recovery in progress per Owner. The advisory lock is
-- the primary exclusion; this is the durable one a crashed process leaves.
CREATE UNIQUE INDEX dromex_terminal_recovery_one_open_per_user
  ON dromex_terminal_recovery (user_id) WHERE ended_at IS NULL;

-- Every Better Auth session a terminal run ever obtained. The ordinary
-- authentication gate refuses any session listed here, permanently.
CREATE TABLE dromex_terminal_recovery_session (
  session_id           TEXT PRIMARY KEY CHECK (length(session_id) BETWEEN 1 AND 255),
  terminal_recovery_id BIGINT NOT NULL REFERENCES dromex_terminal_recovery (id) ON DELETE RESTRICT,
  bound_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX dromex_terminal_recovery_session_run ON dromex_terminal_recovery_session (terminal_recovery_id);

-- The audit vocabulary grows by the terminal recovery events. The previous
-- list is carried over unchanged; only this one constraint is replaced.
ALTER TABLE dromex_audit_event DROP CONSTRAINT dromex_audit_event_event_type_check;

ALTER TABLE dromex_audit_event ADD CONSTRAINT dromex_audit_event_event_type_check CHECK (event_type IN (
  'recovery_code_accepted',
  'recovery_code_rejected',
  'recovery_session_created',
  'other_sessions_revoked',
  'replacement_started',
  'old_factor_disabled',
  'new_totp_rejected',
  'new_totp_verified',
  'replacement_completed',
  'replacement_failed',
  'recovery_expired',
  'recovery_abandoned',
  'recovery_sessions_revoked',
  'terminal_recovery_required',
  'terminal_recovery_requested',
  'terminal_identity_verified',
  'terminal_password_rejected',
  'terminal_recovery_concurrent_refused',
  'terminal_stale_recovery_cleared',
  'terminal_recovery_refused',
  'recovery_code_retrieved',
  'owner_emergency_mfa_reset',
  'terminal_replacement_started',
  'terminal_old_factor_removed',
  'terminal_new_totp_rejected',
  'terminal_new_totp_verified',
  'terminal_recovery_codes_issued',
  'terminal_sessions_revoked',
  'terminal_recovery_completed',
  'terminal_recovery_failed',
  'terminal_recovery_abandoned'
));

-- Plain references, not foreign keys: the audit trail must never be the
-- reason a recovery row cannot be written. Neither can hold free text.
ALTER TABLE dromex_audit_event
  ADD COLUMN terminal_recovery_id BIGINT CHECK (terminal_recovery_id IS NULL OR terminal_recovery_id > 0),
  ADD COLUMN incident_reference   TEXT CHECK (incident_reference IS NULL OR incident_reference ~ '^INC-[0-9]{8}-[0-9]{2}$');

-- The terminal password throttle counts recent rejections per Owner.
CREATE INDEX dromex_audit_event_type_actor_occurred ON dromex_audit_event (event_type, actor_user_id, occurred_at);
