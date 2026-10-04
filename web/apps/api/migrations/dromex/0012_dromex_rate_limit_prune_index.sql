-- DROMEX-owned migration 0012: index for pruning idle rate-limit rows.
--
-- PROPOSAL (SEC-1b, DEC-492, pending Owner review): not accepted until the
-- Owner confirms the decision.
--
-- `dromex_rate_limit` rows were never deleted. A row whose last request is
-- older than its rule's window behaves exactly like a missing row (the limiter
-- restarts the count at one either way), so rows idle for far longer than the
-- longest window can be removed without changing any decision. Pruning looks
-- rows up by `last_request_ms`, in age order, a few at a time; without an
-- index each prune would scan the whole table.
--
-- A plain B-tree on the one column the prune filters and orders by. No data is
-- read, changed, or removed by this migration, and no column or constraint
-- changes. Idempotent, forward-only.

CREATE INDEX IF NOT EXISTS dromex_rate_limit_last_request
  ON dromex_rate_limit (last_request_ms);
