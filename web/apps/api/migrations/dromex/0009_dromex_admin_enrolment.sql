-- DROMEX-owned migration 0009: invited Admin enrolment and the pending
-- principal lifecycle (DEC-440 (7)-(9), DEC-444).
--
-- Written to be idempotent: every object is created with IF NOT EXISTS or
-- CREATE OR REPLACE, and every replaced constraint or trigger is dropped
-- first, so running this file again leaves the schema exactly as it was.
-- Existing principals are not rewritten. Better Auth's generated migrations
-- and earlier DROMEX migrations are unchanged.
--
-- No secret is stored. There is no column for a password, TOTP secret,
-- recovery code, invitation token, cookie, or session token, and there must
-- never be one. `session_id` is Better Auth's internal session identifier,
-- not the session token.

-- ---------------------------------------------------------------------------
-- 1. The principal lifecycle gains `pending` (DEC-444 (4)).
-- ---------------------------------------------------------------------------

ALTER TABLE dromex_principal DROP CONSTRAINT IF EXISTS dromex_principal_status_check;
ALTER TABLE dromex_principal
  ADD CONSTRAINT dromex_principal_status_check CHECK (status IN ('pending', 'active', 'disabled'));

-- A pending principal is never the Owner and never MFA-complete, so every
-- gate that requires either refuses it in the database as well.
ALTER TABLE dromex_principal DROP CONSTRAINT IF EXISTS dromex_principal_pending_is_restricted;
ALTER TABLE dromex_principal
  ADD CONSTRAINT dromex_principal_pending_is_restricted CHECK (status <> 'pending' OR (NOT is_owner AND mfa_completed_at IS NULL));

-- A pending principal becomes active only together with MFA completion, and
-- nothing ever becomes pending again. Active and disabled keep moving freely
-- between each other exactly as before.
CREATE OR REPLACE FUNCTION dromex_principal_lifecycle_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending' THEN
      RAISE EXCEPTION 'principal lifecycle: a principal never returns to pending'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.status = 'pending' AND NOT (NEW.status = 'active' AND NEW.mfa_completed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'principal lifecycle: a pending principal becomes only active, with MFA completion'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dromex_principal_lifecycle_guard ON dromex_principal;
CREATE TRIGGER dromex_principal_lifecycle_guard
  BEFORE UPDATE ON dromex_principal
  FOR EACH ROW EXECUTE FUNCTION dromex_principal_lifecycle_guard();

-- ---------------------------------------------------------------------------
-- 2. One enrolment per invited address (DEC-444 (1), (2)).
-- ---------------------------------------------------------------------------

-- The address, not the invitation, identifies an enrolment: a re-invited
-- pending identity resumes the same row under its newest invitation.
CREATE TABLE IF NOT EXISTS dromex_admin_enrolment (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Normalised exactly as dromex_admin_invitation.email.
  email         TEXT NOT NULL UNIQUE CHECK (
                  length(email) BETWEEN 3 AND 254
                  AND email = lower(email)
                  AND email = btrim(email)
                  AND email ~ '^[^@\s,;<>]+@[^@\s,;<>]+$'
                ),

  -- Set once, when the identity is confirmed. RESTRICT, as for every DROMEX
  -- reference to a Better Auth identity.
  user_id       TEXT UNIQUE REFERENCES "user" ("id") ON DELETE RESTRICT,

  -- The invitation currently driving this setup. Its validity is re-checked
  -- at every state-changing step (DEC-444 (3)).
  invitation_id BIGINT NOT NULL REFERENCES dromex_admin_invitation (id) ON DELETE RESTRICT,

  step          TEXT NOT NULL CHECK (step IN (
                  'identity_pending', 'password_verified', 'totp_enrolling',
                  'factor_challenge', 'codes_issued', 'completed'
                )),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at  TIMESTAMPTZ,

  CONSTRAINT dromex_admin_enrolment_identity CHECK ((step = 'identity_pending') = (user_id IS NULL)),
  CONSTRAINT dromex_admin_enrolment_completion CHECK ((step = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS dromex_admin_enrolment_invitation ON dromex_admin_enrolment (invitation_id);

-- The state machine, in the database. The pairs between the markers are
-- compared with src/invitations/enrolment-state.ts by a unit test.
CREATE OR REPLACE FUNCTION dromex_admin_enrolment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'dromex_admin_enrolment identity columns are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.step IS DISTINCT FROM OLD.step
     OR NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     OR OLD.step = 'completed' THEN
    IF (OLD.step, NEW.step) NOT IN (
      -- BEGIN ENROLMENT TRANSITIONS
      ('identity_pending', 'identity_pending'),
      ('identity_pending', 'password_verified'),
      ('password_verified', 'password_verified'),
      ('password_verified', 'totp_enrolling'),
      ('totp_enrolling', 'password_verified'),
      ('totp_enrolling', 'totp_enrolling'),
      ('totp_enrolling', 'factor_challenge'),
      ('totp_enrolling', 'codes_issued'),
      ('factor_challenge', 'factor_challenge'),
      ('factor_challenge', 'codes_issued'),
      ('codes_issued', 'factor_challenge'),
      ('codes_issued', 'completed')
      -- END ENROLMENT TRANSITIONS
    ) THEN
      RAISE EXCEPTION 'dromex_admin_enrolment: the enrolment transition is not permitted'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dromex_admin_enrolment_guard ON dromex_admin_enrolment;
CREATE TRIGGER dromex_admin_enrolment_guard
  BEFORE UPDATE ON dromex_admin_enrolment
  FOR EACH ROW EXECUTE FUNCTION dromex_admin_enrolment_guard();

-- ---------------------------------------------------------------------------
-- 3. Every Better Auth session ever issued to an enrolment.
-- ---------------------------------------------------------------------------

-- The ordinary authentication gate refuses every session listed here,
-- permanently, exactly as it refuses recovery sessions, so a setup session can
-- never become an ordinary session.
CREATE TABLE IF NOT EXISTS dromex_admin_enrolment_session (
  session_id    TEXT PRIMARY KEY CHECK (length(session_id) BETWEEN 1 AND 255),
  enrolment_id  BIGINT NOT NULL REFERENCES dromex_admin_enrolment (id) ON DELETE RESTRICT,
  -- The invitation the session was issued under. A session never outlives a
  -- change of invitation.
  invitation_id BIGINT NOT NULL REFERENCES dromex_admin_invitation (id) ON DELETE RESTRICT,
  bound_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS dromex_admin_enrolment_session_enrolment ON dromex_admin_enrolment_session (enrolment_id);

-- Enrolments and session bindings are history: never deleted, and a binding is
-- never changed. As for the audit table, this stops application defects, not
-- the table owner.
CREATE OR REPLACE FUNCTION dromex_admin_enrolment_refuse_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted or changed', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;

DROP TRIGGER IF EXISTS dromex_admin_enrolment_no_delete ON dromex_admin_enrolment;
CREATE TRIGGER dromex_admin_enrolment_no_delete
  BEFORE DELETE ON dromex_admin_enrolment
  FOR EACH ROW EXECUTE FUNCTION dromex_admin_enrolment_refuse_delete();

DROP TRIGGER IF EXISTS dromex_admin_enrolment_session_no_change ON dromex_admin_enrolment_session;
CREATE TRIGGER dromex_admin_enrolment_session_no_change
  BEFORE UPDATE OR DELETE ON dromex_admin_enrolment_session
  FOR EACH ROW EXECUTE FUNCTION dromex_admin_enrolment_refuse_delete();

-- ---------------------------------------------------------------------------
-- 4. The audit vocabulary grows by the acceptance events. The previous list is
--    carried over unchanged; only this one constraint is replaced. No address,
--    token, password, code, or secret is ever audited.
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
  'admin_invitation_accepted'
));
