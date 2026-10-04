-- DROMEX-owned migration 0008: Owner-managed Admin invitation issuance (DEC-440).
--
-- One row per issued invitation. A resend never rewrites a row: it ends the
-- previous invitation as superseded and inserts a new one that names it.
-- Acceptance is not implemented by this migration.
--
-- No secret is stored. The token exists only in memory while its email is
-- rendered and handed to the transport; this table keeps only a 32-byte
-- SHA-256 hash of it. There is no column for a token, link, provider message
-- id, or message body, and there must never be one. Delivery status is
-- advisory only (DEC-439 (5)): it never validates a token or changes any
-- authentication state. Earlier migrations are unchanged.

CREATE TABLE dromex_admin_invitation (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Normalised: trimmed and lower-cased by the application, and refused here
  -- if it is not. The application validates the full address shape.
  email               TEXT NOT NULL CHECK (
                        length(email) BETWEEN 3 AND 254
                        AND email = lower(email)
                        AND email = btrim(email)
                        AND email ~ '^[^@\s,;<>]+@[^@\s,;<>]+$'
                      ),

  token_hash          BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),

  -- pending: issued and usable until expiry.
  -- superseded | cancelled | expired: ended; the token never works again.
  -- accepted: reserved for the acceptance checkpoint.
  status              TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'superseded', 'cancelled', 'expired')),

  -- RESTRICT, as for every DROMEX reference to a Better Auth identity.
  invited_by_user_id  TEXT NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,

  -- The invitation this one replaced by a resend; each can be replaced once.
  supersedes_id       BIGINT UNIQUE REFERENCES dromex_admin_invitation (id) ON DELETE RESTRICT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,

  -- The logical delivery this invitation's one email belongs to. The
  -- transport's idempotency key is derived from it, never from the token.
  delivery_id         UUID NOT NULL UNIQUE,
  delivery_status     TEXT NOT NULL CHECK (delivery_status IN ('sending', 'provider_accepted', 'failed', 'not_sent')),
  delivery_reason     TEXT CHECK (delivery_reason IS NULL OR delivery_reason ~ '^[a-z][a-z_]{0,63}$'),
  delivery_attempts   SMALLINT NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 3),
  delivery_updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Exactly 24 hours, whatever the application asks for (DEC-440 (4)).
  CONSTRAINT dromex_admin_invitation_lifetime CHECK (expires_at = created_at + interval '24 hours'),
  CONSTRAINT dromex_admin_invitation_open_status CHECK ((status = 'pending') = (ended_at IS NULL)),
  CONSTRAINT dromex_admin_invitation_delivery_reason CHECK (
    (delivery_status IN ('failed', 'not_sent')) = (delivery_reason IS NOT NULL)
  ),
  CONSTRAINT dromex_admin_invitation_not_self_superseding CHECK (supersedes_id IS NULL OR supersedes_id < id)
);

-- At most one pending invitation per normalised email (DEC-440 (2)).
CREATE UNIQUE INDEX dromex_admin_invitation_one_pending_per_email
  ON dromex_admin_invitation (email) WHERE status = 'pending';

-- Issuance rate limits count recent rows per email.
CREATE INDEX dromex_admin_invitation_email_created ON dromex_admin_invitation (email, created_at);

-- Expiry finds due pending invitations.
CREATE INDEX dromex_admin_invitation_pending_expiry
  ON dromex_admin_invitation (expires_at) WHERE status = 'pending';

-- The Owner's list is newest first.
CREATE INDEX dromex_admin_invitation_created ON dromex_admin_invitation (created_at DESC, id DESC);

-- An ended invitation never becomes usable again, and identifying columns
-- never change. This protects against ordinary application defects, not
-- against the table owner (see migration 0005).
CREATE FUNCTION dromex_admin_invitation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.invited_by_user_id IS DISTINCT FROM OLD.invited_by_user_id
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id THEN
    RAISE EXCEPTION 'dromex_admin_invitation identifying columns are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'pending' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.ended_at IS DISTINCT FROM OLD.ended_at) THEN
    RAISE EXCEPTION 'an ended dromex_admin_invitation cannot change status'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER dromex_admin_invitation_guard
  BEFORE UPDATE ON dromex_admin_invitation
  FOR EACH ROW EXECUTE FUNCTION dromex_admin_invitation_guard();

CREATE FUNCTION dromex_admin_invitation_refuse_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'dromex_admin_invitation rows are never deleted'
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER dromex_admin_invitation_no_delete
  BEFORE DELETE ON dromex_admin_invitation
  FOR EACH ROW EXECUTE FUNCTION dromex_admin_invitation_refuse_delete();

-- The audit vocabulary grows by the invitation events, and events gain a
-- plain invitation reference. The previous list is carried over unchanged;
-- only this one constraint is replaced. No address is ever audited.
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
  'terminal_recovery_abandoned',
  'admin_invitation_created',
  'admin_invitation_resent',
  'admin_invitation_superseded',
  'admin_invitation_cancelled',
  'admin_invitation_expired',
  'admin_invitation_delivery_accepted',
  'admin_invitation_delivery_failed',
  'admin_invitation_refused'
));

-- A plain reference, not a foreign key: the audit trail must never be the
-- reason an invitation row cannot be written.
ALTER TABLE dromex_audit_event
  ADD COLUMN invitation_id BIGINT CHECK (invitation_id IS NULL OR invitation_id > 0);

CREATE INDEX dromex_audit_event_invitation ON dromex_audit_event (invitation_id) WHERE invitation_id IS NOT NULL;
