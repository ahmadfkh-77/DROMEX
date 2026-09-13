-- DROMEX-owned migration 0002: rate-limit storage.
--
-- Replaces Better Auth's database rate-limit storage at runtime, through
-- Better Auth's supported `rateLimit.customStorage` interface. Better Auth's
-- generated "rateLimit" table is left exactly as generated and is simply no
-- longer written.
--
-- Why a DROMEX table: node-postgres returns BIGINT as text, and Better Auth
-- 1.7.4 coerces only a JavaScript bigint, so its retry time was computed by
-- string concatenation. Changing the process-wide BIGINT parser would alter
-- every BIGINT read in the application, and editing Better Auth's generated
-- schema would break the separation of the two migration sequences
-- (DEC-431). DROMEX instead owns this table and converts its one BIGINT
-- column explicitly, failing closed on anything unsafe.
--
-- No credential, address list, or business data is stored: the key is
-- Better Auth's "<client address>|<path>" rate-limit key.

CREATE TABLE dromex_rate_limit (
  key             TEXT    PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 512),
  -- Requests counted in the current window. Zero only for the instant a row
  -- exists before its first increment inside the same transaction.
  count           INTEGER NOT NULL CHECK (count >= 0),
  -- Milliseconds since the Unix epoch of the last counted request.
  last_request_ms BIGINT  NOT NULL CHECK (last_request_ms >= 0)
);
