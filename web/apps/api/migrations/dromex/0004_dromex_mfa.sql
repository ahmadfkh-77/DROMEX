-- DROMEX-owned migration 0004: MFA completion and TOTP replay protection.
--
-- Better Auth owns the factor itself ("user"."twoFactorEnabled" and the
-- "twoFactor" table, created by Better Auth's own migration 0002). This
-- migration adds only the DROMEX facts Better Auth does not model (DEC-434).

-- When mandatory MFA activation completed: TOTP verified and recovery codes
-- acknowledged. NULL means incomplete. There is deliberately no default and
-- no backfill, so every existing principal fails closed until it completes
-- activation. The authentication gate also refuses any session created
-- before this moment.
ALTER TABLE dromex_principal ADD COLUMN mfa_completed_at TIMESTAMPTZ;

-- One row per accepted TOTP code, per user, kept for longer than Better
-- Auth's acceptance window so the same code cannot be accepted twice.
--
-- No code is stored. code_digest is SHA-256 over a fixed label, the user id,
-- and the six digits — a recognition marker, not secret storage: six digits
-- are enumerable. The primary key makes concurrent acceptance of one code
-- impossible. RESTRICT, never CASCADE, as for every DROMEX reference to a
-- Better Auth identity.
CREATE TABLE dromex_totp_replay (
  user_id     TEXT        NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,
  code_digest BYTEA       NOT NULL CHECK (octet_length(code_digest) = 32),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, code_digest)
);

-- Pruning removes markers past the retention by acceptance time.
CREATE INDEX dromex_totp_replay_accepted_at ON dromex_totp_replay (accepted_at);
