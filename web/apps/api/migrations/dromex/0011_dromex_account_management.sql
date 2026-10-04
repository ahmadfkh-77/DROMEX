-- DROMEX-owned migration 0011: Owner account and session management
-- (checkpoint 4E, DEC-427).
--
-- Written to be idempotent: every object is created with IF NOT EXISTS or
-- CREATE OR REPLACE, and every replaced constraint or trigger is dropped
-- first, so running this file again leaves the schema exactly as it was.
-- Existing principals are not rewritten. Better Auth's generated migrations
-- and earlier DROMEX migrations are unchanged.
--
-- No secret is stored. There is no column for a password, TOTP secret or
-- code, recovery code, token, cookie, session identifier, IP address, or user
-- agent, and there must never be one. The one free-text value is the reason
-- the Owner gives for a status change, kept out of the audit trail.

-- ---------------------------------------------------------------------------
-- 1. The Owner session rule.
-- ---------------------------------------------------------------------------

-- The ordinary gate refuses a session created before this moment. The Owner
-- sets it when disabling, re-enabling, or ending every session of an account,
-- so re-enabling never revives a session from before the account was
-- disabled, whether or not Better Auth's own deletion completed. Nullable with
-- no default and no backfill: existing principals are not rewritten.
ALTER TABLE dromex_principal ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;

-- It only moves forward, so a later defect can never re-admit a session the
-- Owner ended.
CREATE OR REPLACE FUNCTION dromex_principal_sessions_revoked_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sessions_revoked_at IS NOT NULL
     AND (NEW.sessions_revoked_at IS NULL OR NEW.sessions_revoked_at < OLD.sessions_revoked_at) THEN
    RAISE EXCEPTION 'dromex_principal sessions_revoked_at only moves forward'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dromex_principal_sessions_revoked_forward ON dromex_principal;
CREATE TRIGGER dromex_principal_sessions_revoked_forward
  BEFORE UPDATE ON dromex_principal
  FOR EACH ROW EXECUTE FUNCTION dromex_principal_sessions_revoked_forward();

-- ---------------------------------------------------------------------------
-- 2. Every disable and re-enable, with the Owner's reason.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dromex_account_status_change (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- RESTRICT, as for every DROMEX reference to a Better Auth identity.
  user_id            TEXT NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,

  -- An account is disabled or enabled; it is never deleted.
  action             TEXT NOT NULL CHECK (action IN ('disabled', 'enabled')),

  -- One line of 3 to 500 characters, already trimmed, with no control
  -- character and no bidirectional embedding, override, or isolate, which
  -- could forge a line or disguise the text. Mirrors account-reason.ts.
  reason             TEXT NOT NULL CHECK (
                       char_length(reason) BETWEEN 3 AND 500
                       AND reason !~ '^\s|\s$'
                       AND reason !~ U&'[\0001-\001F\007F-\009F\202A-\202E\2066-\2069]'
                     ),

  changed_by_user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Nobody changes their own status, the Owner included.
  CONSTRAINT dromex_account_status_change_not_self CHECK (user_id <> changed_by_user_id)
);

-- An account's latest change is read newest first.
CREATE INDEX IF NOT EXISTS dromex_account_status_change_user_changed
  ON dromex_account_status_change (user_id, changed_at DESC, id DESC);

-- Status changes are history. As for the audit table, this stops ordinary
-- application defects, not the table owner or a database administrator.
CREATE OR REPLACE FUNCTION dromex_account_status_change_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'dromex_account_status_change rows are never changed or deleted'
    USING ERRCODE = 'insufficient_privilege';
END
$$;

DROP TRIGGER IF EXISTS dromex_account_status_change_no_row_change ON dromex_account_status_change;
CREATE TRIGGER dromex_account_status_change_no_row_change
  BEFORE UPDATE OR DELETE ON dromex_account_status_change
  FOR EACH ROW EXECUTE FUNCTION dromex_account_status_change_refuse_change();

DROP TRIGGER IF EXISTS dromex_account_status_change_no_truncate ON dromex_account_status_change;
CREATE TRIGGER dromex_account_status_change_no_truncate
  BEFORE TRUNCATE ON dromex_account_status_change
  FOR EACH STATEMENT EXECUTE FUNCTION dromex_account_status_change_refuse_change();

REVOKE UPDATE, DELETE, TRUNCATE ON dromex_account_status_change FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. The audit vocabulary grows by the account-management events, and events
--    gain the account acted on and a status-change reference. The previous
--    list is carried over unchanged; only this one constraint is replaced. No
--    reason text, address, session identifier, or token is ever audited.
-- ---------------------------------------------------------------------------

ALTER TABLE dromex_audit_event DROP CONSTRAINT IF EXISTS dromex_audit_event_event_type_check;

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
  'terminal_recovery_abandoned',
  'admin_invitation_created',
  'admin_invitation_resent',
  'admin_invitation_superseded',
  'admin_invitation_cancelled',
  'admin_invitation_expired',
  'admin_invitation_delivery_accepted',
  'admin_invitation_delivery_failed',
  'admin_invitation_refused',
  'admin_invitation_acceptance_refused',
  'admin_invitation_identity_created',
  'admin_invitation_identity_resumed',
  'admin_invitation_password_rejected',
  'admin_invitation_totp_enrolment_started',
  'admin_invitation_totp_rejected',
  'admin_invitation_totp_verified',
  'admin_invitation_recovery_codes_issued',
  'admin_invitation_sessions_revoked',
  'admin_invitation_accepted',
  'password_reset_requested',
  'password_reset_request_suppressed',
  'password_reset_superseded',
  'password_reset_expired',
  'password_reset_delivery_accepted',
  'password_reset_delivery_failed',
  'password_reset_rejected',
  'password_reset_claimed',
  'password_reset_failed',
  'password_reset_sessions_revoked',
  'password_reset_session_revocation_incomplete',
  'password_reset_completed',
  'password_changed_notification_accepted',
  'password_changed_notification_failed',
  'admin_account_disabled',
  'admin_account_enabled',
  'admin_account_sessions_revoked',
  'admin_account_session_revoked',
  'admin_account_session_cleanup_incomplete',
  'admin_account_action_refused',
  'owner_route_refused'
));

-- RESTRICT, as for every DROMEX reference to a Better Auth identity: an
-- account must not disappear from under the history of what was done to it.
ALTER TABLE dromex_audit_event
  ADD COLUMN IF NOT EXISTS target_user_id TEXT REFERENCES "user" ("id") ON DELETE RESTRICT;

-- A plain reference, not a foreign key: the audit trail must never be the
-- reason a status change cannot be written.
ALTER TABLE dromex_audit_event
  ADD COLUMN IF NOT EXISTS account_change_id BIGINT CHECK (account_change_id IS NULL OR account_change_id > 0);

CREATE INDEX IF NOT EXISTS dromex_audit_event_target
  ON dromex_audit_event (target_user_id, occurred_at) WHERE target_user_id IS NOT NULL;
