# PostgreSQL Strategy

Status: **partly implemented.** A local development service and an isolated
test lifecycle exist. **No business schema, no authentication schema, and no
server roles exist yet.**

PostgreSQL 18.6 is the approved version (DEC-415).

## The PostgreSQL 18 volume rule

**Mount the volume at `/var/lib/postgresql`, never at `/var/lib/postgresql/data`.**

PostgreSQL 18's official image changed this. From the upstream Dockerfile:

```
ENV PG_MAJOR 18
# NOTE: in 18+, PGDATA has changed to match the pg_ctlcluster standard directory
# structure, and the VOLUME has moved from /var/lib/postgresql/data to /var/lib/postgresql
ENV PGDATA /var/lib/postgresql/18/docker
VOLUME /var/lib/postgresql
```

For comparison, PostgreSQL 16 used `PGDATA=/var/lib/postgresql/data` and
`VOLUME /var/lib/postgresql/data`.

Why this matters more than a normal configuration detail: mounting the old path
against an 18 image **does not fail**. The server starts, accepts writes, and
reports healthy, while the real data directory sits in the container's writable
layer. The data is destroyed the moment the container is removed, with no error
at any point. A configuration that is silently wrong is worse than one that
crashes, so it is recorded here and commented in the compose file itself.

## Identifier preservation

Governed by DEC-410.

- Existing SQLite `TEXT` primary keys and their relationships are carried across
  **unchanged**. They are not converted to UUIDs. Re-keying would break the
  references that payments, corrections, cancellations, and generated documents
  depend on.
- Records that exist **only** on the server use cryptographically secure UUIDs:
  users, sessions, device registrations, synchronisation mutations, audit
  events. PostgreSQL 18 provides `uuidv7()` natively, which is time-ordered and
  indexes better than v4 for insert-heavy tables.

The application's existing `makeId` scheme is a timestamp plus `Math.random`.
That is adequate for one device writing to its own database and is **not** a
collision-resistant identifier for rows a shared server mints, which is why new
server-only tables do not reuse it.

## Money and time

The existing conventions are preserved, not redesigned:

- money is **integer minor units** in columns named `*_usd_cents`,
- VAT is an integer in `vat_rate_basis_points`,
- timestamps are stored UTC.

No floating-point money column will be introduced.

## Role model (documented, deliberately not yet implemented)

The production model separates two roles:

| Role | Purpose | Privileges |
| --- | --- | --- |
| migration owner | owns schema objects, runs migrations | DDL on the application schema |
| application runtime | serves API requests | `SELECT`, `INSERT`, `UPDATE` on specific tables; **no DDL**; **no `DELETE`** on audited business tables; **`INSERT`/`SELECT` only** (no `UPDATE`, no `DELETE`) on the `audit_event` table (DEC-430) |

Withholding `DELETE` at the database level is deliberate. "Never physically
delete an audited business record" is an existing product rule, and restricting
the application's own runtime credential in the database means an **ordinary
application defect cannot violate it** — the credential the running code holds
is simply not granted that power. This is an independent safeguard, not an
absolute one: a privileged database administrator, or anyone who obtains
superuser access to PostgreSQL, can still alter or delete rows directly, which
is why the application runtime role must never be the migration owner and must
never hold schema-altering (DDL) privileges. Restricting the `audit_event`
table to `INSERT`/`SELECT` only, by the same mechanism, makes the audit trail
append-only **to that runtime role** — not append-only in an absolute sense.

**This is not implemented yet, by decision.** There is no schema for roles to
protect, so bootstrapping them now would mean inventing credential handling
before there is anything to secure. It is implemented at the first real server
migration. The development container uses the default superuser from a
git-ignored `web/.env`; that is a development convenience and is explicitly not
the production model.

## Row-level security: not used in the first release (DEC-429)

Considered and deliberately deferred, not overlooked. The application will
connect to PostgreSQL as a single runtime role, so row-level security would
require correctly setting the acting user's identity on every transaction —
a mechanism that fails silently (either open or closed) if ever missed — and
it would duplicate the effective-permission computation of
`authentication-and-authorization-architecture.md` §9 in SQL policy
alongside its TypeScript implementation, risking drift between the two.
Today there is exactly one data path to PostgreSQL: DEC-406's architecture
means neither the web client nor the Android client ever connects directly.
**Revisit this decision immediately if a second data path to the database is
ever introduced** — a reporting user, a BI tool, or any service connecting
with its own credentials. See
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md#12-postgresql-security-and-the-row-level-security-decision)
for the full reasoning.

## Development and test databases are fully separated

| | Development | Test |
| --- | --- | --- |
| Lifecycle | long-lived Compose service | ephemeral Testcontainers container per run |
| Storage | named volume `dromex_web_dev_pgdata` | container filesystem, discarded |
| Host port | `127.0.0.1:5433` | random high port |
| Database | `dromex_dev` | `test_<random>` per test file, dropped after |

Tests never touch the development database. A guard in the test global setup
throws if the resolved connection points at port 5433 or database `dromex_dev`,
so a misconfiguration fails loudly instead of writing into development data.

## Schema work, when it starts

Schema, indexing, and row-level security decisions will follow the installed
`supabase-postgres-best-practices` guidance, whose priority order is query
performance, connection management, and security first, then schema design.
Migrations will be versioned, forward-only, and tested against a real
PostgreSQL instance rather than a mock.

Server migrations are kept **entirely separate** from the Android SQLite
migrations in `src/data/database/migrations.ts`. The two version sequences are
independent and must never be conflated.
