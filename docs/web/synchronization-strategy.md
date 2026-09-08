# Android Synchronisation Strategy

Status: **planned. Nothing in this document is implemented.** No
synchronisation code, endpoint, or schema exists.

Synchronisation is not built until the central schema and API rules are
approved and stable. This document records the design constraints so that the
work, when it starts, is answerable to a written rule rather than inventing one.

## What already exists and will be reused

The Android application already writes a durable outbox. Every mutating
repository method wraps its business-table write and a `sync_outbox` insert in
the same SQLite transaction:

```sql
CREATE TABLE sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
```

That atomic local write is the hard part of offline-first, and it is already
correct. The `SyncSchema` table-ordering ranks used by the Firebase code are
also reusable as dependency-safe apply ordering, independent of transport.

## What must be added

| Requirement | Why the current code does not satisfy it |
| --- | --- |
| Durable mutation ID | The outbox's autoincrement `id` is local-only and cannot identify a mutation across devices. A `mutation_uuid` column is needed. |
| Server-side idempotency | The server must dedupe by mutation ID so a retried push after a dropped connection is a no-op rather than a duplicate record. |
| Ordered change cursor | The server assigns a monotonic sequence per applied write; clients pull "changes since N". |
| Transactional pull application | A pulled batch applies inside one local SQLite transaction, and the cursor advances **only after** that transaction commits. |
| Non-blocking retry | The existing Firebase push re-throws on the first failing item, so one bad row blocks the whole queue. The replacement must isolate a failing mutation. |
| Visible status | Pending count, last sync time, and recoverable errors surfaced to the user. |

## Conflict policy

Governed by DEC-412, which supersedes the newest-edit-wins rule of DEC-058 and
DEC-059 for the operations named here.

**Financially significant operations must never use blind last-write-wins.**
That covers payments, corrections, cancellations, and confirmed records. A
stale mutation against one of these is **rejected**, and the client must
refresh and deliberately reapply the change.

Ordinary reference data may resolve through record versions, but an
administrator's change is never silently lost. **Every rejected conflict must be
observable and auditable**, recorded in the server audit-event table (DEC-411).

The reasoning: newest-edit-wins was accepted (RISK-009) when one owner used one
device, where conflicts were nearly impossible. With an Owner, two Admins, a
browser, and a phone able to touch the same record, silent discard stops being a
remote edge case, and the values at stake are payments and corrections to
customer-facing financial documents. A rejected write is recoverable because
the user is told; a silently discarded payment is not.

## Transaction numbers under synchronisation

Governed by DEC-413.

- Existing transaction numbers are preserved exactly.
- The server issues numbers for records created through the web application.
- Android keeps its existing device-coded local sequence for offline-created
  records until this phase provides a reviewed replacement.
- Uniqueness is enforced centrally.
- A confirmed historical record is **never silently renumbered**.
- A collision enters an explicit reconciliation workflow.

The existing format is `YYYYMMDD-{device_code}-{sequence}`, where `device_code`
is four random base-36 characters generated once per install and registered with
no central authority. Two installs can therefore produce the same code, and on
the same day at the same sequence, the same transaction number. That is
harmless while each database is separate and unacceptable once records merge.
Renumbering silently would rewrite a number already printed on a delivered
customer document, so a collision must become work for a person.

## Testing required before acceptance

Simultaneous edits, interrupted synchronisation, duplicate delivery, payments,
corrections, cancellations, project renaming, and transaction numbering, each
tested explicitly rather than assumed.
