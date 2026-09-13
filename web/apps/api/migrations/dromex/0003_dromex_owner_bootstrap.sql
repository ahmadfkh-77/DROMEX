-- DROMEX-owned migration 0003: Owner bootstrap intent.
--
-- Better Auth creates an identity (its "user" and "account" rows) inside its
-- own transaction, on its own connection. Better Auth 1.7.4 documents no way
-- to run that inside a transaction the caller controls, so creating the
-- identity and creating the DROMEX Owner principal are NOT atomic. This table
-- makes the gap between them durable and recoverable instead of hidden: the
-- provisioning workflow records its intent before asking Better Auth for
-- anything, and removes the record in the same transaction that inserts the
-- Owner principal.
--
-- It holds no secret. There is no column for a password, password hash,
-- token, cookie, or recovery code, and there must never be one. The email is
-- kept only so an interrupted run can be resumed for the same identity and
-- refused for any other.
--
-- Every write to this table happens while the provisioning workflow holds its
-- PostgreSQL advisory lock.

CREATE TABLE dromex_owner_bootstrap (
  -- At most one intent can exist, enforced by the database rather than by
  -- application care: the only permitted key value is TRUE.
  singleton  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),

  -- pending_identity: recorded, Better Auth identity not yet confirmed.
  -- identity_created: Better Auth identity confirmed, principal not yet made.
  -- There is no "completed" state: completion deletes the row, atomically
  -- with the principal insert, and the Owner principal is the record of it.
  state      TEXT NOT NULL CHECK (state IN ('pending_identity', 'identity_created')),

  email      TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),

  -- RESTRICT, as for principals: an identity an unfinished bootstrap refers
  -- to must not disappear from under it.
  user_id    TEXT REFERENCES "user" ("id") ON DELETE RESTRICT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT dromex_owner_bootstrap_state_identity CHECK (
    (state = 'pending_identity' AND user_id IS NULL)
    OR (state = 'identity_created' AND user_id IS NOT NULL)
  )
);
