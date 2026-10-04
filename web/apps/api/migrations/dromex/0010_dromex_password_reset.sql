-- DROMEX-owned migration 0010: password reset (DEC-441, DEC-442, DEC-487).
--
-- Written to be idempotent: every object is created with IF NOT EXISTS or
-- CREATE OR REPLACE, and every replaced constraint or trigger is dropped
-- first, so running this file again leaves the schema exactly as it was.
-- Existing principals are not rewritten. Better Auth's generated migrations
-- and earlier DROMEX migrations are unchanged.
--
-- No secret is stored. The public reset token exists only in memory while
-- its email is rendered and handed to the transport; this table keeps only a
-- 32-byte SHA-256 hash of it. There is no column for a token, link, address,
-- password, provider message id, or message body, and there must never be
-- one. Delivery status is advisory only (DEC-439 (5)).

-- ---------------------------------------------------------------------------
-- 1. One row per issued reset token.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dromex_password_reset (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- RESTRICT, as for every DROMEX reference to a Better Auth identity.
  user_id             TEXT NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,

  token_hash          BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),

  -- issued: usable until expiry.
  -- claimed: taken by exactly one completion attempt; the password write is in progress.
  -- completed | superseded | expired | failed: ended; the token never works again.
  status              TEXT NOT NULL CHECK (status IN ('issued', 'claimed', 'completed', 'superseded', 'expired', 'failed')),

  -- The reset this one superseded; each can be superseded once.
  supersedes_id       BIGINT UNIQUE REFERENCES dromex_password_reset (id) ON DELETE RESTRICT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at          TIMESTAMPTZ NOT NULL,
  claimed_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  end_reason          TEXT CHECK (end_reason IS NULL OR end_reason ~ '^[a-z][a-z_]{0,63}$'),

  -- The logical delivery this reset's one email belongs to. The transport's
  -- idempotency key is derived from it, never from the token.
  delivery_id         UUID NOT NULL UNIQUE,
  delivery_status     TEXT NOT NULL CHECK (delivery_status IN ('sending', 'provider_accepted', 'failed', 'not_sent')),
  delivery_reason     TEXT CHECK (delivery_reason IS NULL OR delivery_reason ~ '^[a-z][a-z_]{0,63}$'),
  delivery_attempts   SMALLINT NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 3),
  delivery_updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Exactly 30 minutes, whatever the application asks for (DEC-441 (6)).
  CONSTRAINT dromex_password_reset_lifetime CHECK (expires_at = created_at + interval '30 minutes'),
  CONSTRAINT dromex_password_reset_open_status CHECK ((status IN ('issued', 'claimed')) = (ended_at IS NULL)),
  CONSTRAINT dromex_password_reset_claim_time CHECK (
    CASE status
      WHEN 'claimed' THEN claimed_at IS NOT NULL
      WHEN 'completed' THEN claimed_at IS NOT NULL
      WHEN 'failed' THEN TRUE
      ELSE claimed_at IS NULL
    END
  ),
  CONSTRAINT dromex_password_reset_failure_reason CHECK ((status = 'failed') = (end_reason IS NOT NULL)),
  CONSTRAINT dromex_password_reset_delivery_reason CHECK (
    (delivery_status IN ('failed', 'not_sent')) = (delivery_reason IS NOT NULL)
  ),
  CONSTRAINT dromex_password_reset_not_self_superseding CHECK (supersedes_id IS NULL OR supersedes_id < id)
);

-- At most one open reset per account (DEC-441 (5)).
CREATE UNIQUE INDEX IF NOT EXISTS dromex_password_reset_one_open_per_user
  ON dromex_password_reset (user_id) WHERE status IN ('issued', 'claimed');

-- Per-account issuance limits count recent rows per account.
CREATE INDEX IF NOT EXISTS dromex_password_reset_user_created ON dromex_password_reset (user_id, created_at);

-- The global issuance limit counts recent rows.
CREATE INDEX IF NOT EXISTS dromex_password_reset_created ON dromex_password_reset (created_at);

-- Expiry finds due issued resets; the sweep finds stale claims.
CREATE INDEX IF NOT EXISTS dromex_password_reset_issued_expiry
  ON dromex_password_reset (expires_at) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS dromex_password_reset_claimed
  ON dromex_password_reset (claimed_at) WHERE status = 'claimed';

-- Identifying columns never change, the lifecycle only moves forward, and
-- delivery status leaves `sending` at most once. This protects against
-- ordinary application defects, not against the table owner (see 0005).
CREATE OR REPLACE FUNCTION dromex_password_reset_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id THEN
    RAISE EXCEPTION 'dromex_password_reset identifying columns are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'issued' AND NEW.status IN ('claimed', 'superseded', 'expired', 'failed'))
      OR (OLD.status = 'claimed' AND NEW.status IN ('completed', 'failed'))
    ) THEN
      RAISE EXCEPTION 'password reset transition from % to % is not allowed', OLD.status, NEW.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF OLD.status NOT IN ('issued', 'claimed') AND (
         NEW.ended_at IS DISTINCT FROM OLD.ended_at
      OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
      OR NEW.end_reason IS DISTINCT FROM OLD.end_reason
    ) THEN
    RAISE EXCEPTION 'password reset transition: an ended reset cannot change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.delivery_status <> 'sending' AND (
       NEW.delivery_status IS DISTINCT FROM OLD.delivery_status
    OR NEW.delivery_reason IS DISTINCT FROM OLD.delivery_reason
    OR NEW.delivery_attempts IS DISTINCT FROM OLD.delivery_attempts
  ) THEN
    RAISE EXCEPTION 'password reset delivery status is already recorded'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dromex_password_reset_guard ON dromex_password_reset;
CREATE TRIGGER dromex_password_reset_guard
  BEFORE UPDATE ON dromex_password_reset
  FOR EACH ROW EXECUTE FUNCTION dromex_password_reset_guard();

CREATE OR REPLACE FUNCTION dromex_password_reset_refuse_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'dromex_password_reset rows are never deleted'
    USING ERRCODE = 'insufficient_privilege';
END
$$;

DROP TRIGGER IF EXISTS dromex_password_reset_no_delete ON dromex_password_reset;
CREATE TRIGGER dromex_password_reset_no_delete
  BEFORE DELETE ON dromex_password_reset
  FOR EACH ROW EXECUTE FUNCTION dromex_password_reset_refuse_delete();

-- ---------------------------------------------------------------------------
-- 2. The credential-change session rule (DEC-487 (3)).
-- ---------------------------------------------------------------------------

-- Every session gate refuses a session created before this moment. Nullable
-- with no default and no backfill: existing principals are not rewritten.
ALTER TABLE dromex_principal ADD COLUMN IF NOT EXISTS credentials_changed_at TIMESTAMPTZ;

-- It only moves forward, so a later defect can never re-admit a session
-- that a password change ended.
CREATE OR REPLACE FUNCTION dromex_principal_credentials_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.credentials_changed_at IS NOT NULL
     AND (NEW.credentials_changed_at IS NULL OR NEW.credentials_changed_at < OLD.credentials_changed_at) THEN
    RAISE EXCEPTION 'dromex_principal credentials_changed_at only moves forward'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dromex_principal_credentials_forward ON dromex_principal;
CREATE TRIGGER dromex_principal_credentials_forward
  BEFORE UPDATE ON dromex_principal
  FOR EACH ROW EXECUTE FUNCTION dromex_principal_credentials_forward();

-- ---------------------------------------------------------------------------
-- 3. The audit vocabulary grows by the password-reset events, and events gain
--    a plain reset reference. The previous list is carried over unchanged;
--    only this one constraint is replaced. No address, token, token hash,
--    link, or password is ever audited (DEC-441 (10)).
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
  'password_changed_notification_failed'
));

-- A plain reference, not a foreign key: the audit trail must never be the
-- reason a reset row cannot be written.
ALTER TABLE dromex_audit_event
  ADD COLUMN IF NOT EXISTS password_reset_id BIGINT CHECK (password_reset_id IS NULL OR password_reset_id > 0);

CREATE INDEX IF NOT EXISTS dromex_audit_event_password_reset
  ON dromex_audit_event (password_reset_id) WHERE password_reset_id IS NOT NULL;
