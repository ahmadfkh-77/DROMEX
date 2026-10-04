-- DROMEX-owned migration 0005: security audit foundation (DEC-430, DEC-436).
--
-- One row per security event. Every column is structured: an event type from
-- a fixed list, an outcome, the acting user and a snapshot of their name, a
-- recovery reference, a constrained reason code, a count, and a client
-- address. There is deliberately no free-text, JSON, or payload column, so
-- there is nowhere to put a password, password hash, TOTP secret or code,
-- recovery code, key, cookie, session token, credential, or request body.
--
-- Protection, stated honestly: PUBLIC holds no UPDATE, DELETE, or TRUNCATE
-- privilege, and triggers reject all three for every role that does not
-- disable them. That stops an ordinary application defect from altering or
-- erasing history. It does NOT stop the table owner or a database
-- administrator, who can disable the triggers or alter the table; the
-- least-privilege runtime role DEC-429 and DEC-430 require is not provisioned
-- yet.

CREATE TABLE dromex_audit_event (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  event_type            TEXT NOT NULL CHECK (event_type IN (
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
                          'terminal_recovery_required'
                        )),
  outcome               TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),

  -- RESTRICT, as for every DROMEX reference to a Better Auth identity: an
  -- audited user must not disappear from under their own history.
  actor_user_id         TEXT REFERENCES "user" ("id") ON DELETE RESTRICT,
  -- Snapshot at the time of the event (DEC-430), so a later rename never
  -- rewrites what the entry says happened.
  actor_name            TEXT CHECK (actor_name IS NULL OR length(actor_name) BETWEEN 1 AND 200),

  -- A plain reference, not a foreign key: the audit trail must never be the
  -- reason a recovery row cannot be written, and never depend on it.
  recovery_id           BIGINT CHECK (recovery_id IS NULL OR recovery_id > 0),

  reason                TEXT CHECK (reason IS NULL OR reason ~ '^[a-z][a-z_]{0,63}$'),
  revoked_session_count INTEGER CHECK (revoked_session_count IS NULL OR revoked_session_count >= 0),
  client_address        TEXT CHECK (client_address IS NULL OR client_address ~ '^[0-9A-Fa-f:.]{1,45}$'),

  CONSTRAINT dromex_audit_event_name_needs_actor CHECK (actor_name IS NULL OR actor_user_id IS NOT NULL)
);

CREATE INDEX dromex_audit_event_actor_occurred ON dromex_audit_event (actor_user_id, occurred_at);

CREATE FUNCTION dromex_audit_event_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'dromex_audit_event is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER dromex_audit_event_no_row_change
  BEFORE UPDATE OR DELETE ON dromex_audit_event
  FOR EACH ROW EXECUTE FUNCTION dromex_audit_event_refuse_change();

CREATE TRIGGER dromex_audit_event_no_truncate
  BEFORE TRUNCATE ON dromex_audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION dromex_audit_event_refuse_change();

REVOKE UPDATE, DELETE, TRUNCATE ON dromex_audit_event FROM PUBLIC;
