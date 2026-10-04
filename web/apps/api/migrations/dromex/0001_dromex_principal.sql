-- DROMEX-owned migration 0001: principal.
--
-- Separate from Better Auth's generated schema in every sense: its own
-- directory, its own forward-only sequence, and its own ledger. Better Auth
-- discovers its schema by introspecting the live database; DROMEX records
-- what it applied. The two mechanisms never meet (DEC-431).
--
-- This table holds DROMEX's own authorization-adjacent facts about a
-- principal and nothing else. Identity — name, email, password, tokens,
-- sessions — stays in Better Auth's tables and is never duplicated here.
-- Role templates, permission grants, and project scope belong to later
-- checkpoints and are deliberately absent.

CREATE TABLE dromex_principal (
  -- The stable link to Better Auth. RESTRICT, never CASCADE: a principal is
  -- referenced by historical business records, so deleting the underlying
  -- Better Auth user must fail loudly rather than silently erase the identity
  -- those records attribute work to. DROMEX disables principals; it does not
  -- delete them.
  user_id    TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE RESTRICT,

  -- Constrained to the values approved today. A value outside this set is a
  -- bug, and the database refuses it rather than letting the application
  -- invent a third state that authorization code would not recognise.
  status     TEXT NOT NULL CHECK (status IN ('active', 'disabled')),

  is_owner   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AT MOST one Owner. Read that precisely: this index cannot require that an
-- Owner exists, and it is not intended to. Zero Owners is the correct and
-- expected state before bootstrap. "Exactly one Owner once initialised" is a
-- product rule assembled from three separate mechanisms, only the first of
-- which lives here:
--
--   1. this index                     - makes a second Owner impossible;
--   2. the bootstrap transaction      - creates the first and only Owner;
--   3. runtime readiness + services   - refuse an initialised system with no
--                                       Owner, and refuse to remove or demote
--                                       the one that exists.
--
-- Mechanisms 2 and 3 are NOT implemented yet.
CREATE UNIQUE INDEX dromex_principal_single_owner
  ON dromex_principal ((TRUE))
  WHERE is_owner;
