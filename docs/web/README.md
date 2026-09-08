# DROMEX Web System Documentation

This directory documents the private DROMEX web application, its API, its
PostgreSQL database, and the deployment that will host them.

`requirements/` remains the authoritative business record. Nothing here
overrides a confirmed requirement or decision; where this documentation
describes a rule, it cites the decision that established it.

## Reading order

| Document | Covers | Implementation status |
| --- | --- | --- |
| [architecture.md](architecture.md) | Service boundaries, technology baseline, how the web system relates to the existing Android application | **Partly implemented** (Phase 1 skeleton only) |
| [security-and-accounts.md](security-and-accounts.md) | Owner and Admin model, the private-application boundary, authorisation rules | **Planned** (no authentication exists) |
| [postgresql-strategy.md](postgresql-strategy.md) | Schema approach, identifier preservation, roles, the PostgreSQL 18 volume rule | **Partly implemented** (development service only, no schema) |
| [synchronization-strategy.md](synchronization-strategy.md) | Android synchronisation protocol and conflict rules | **Planned** (not implemented) |
| [docker-vps-strategy.md](docker-vps-strategy.md) | Local Docker topology, port exposure rules, production deployment plan | **Partly implemented** (local development only) |
| [backup-and-recovery.md](backup-and-recovery.md) | Backup design, recovery objectives, restore verification | **Planned** (no backups exist) |
| [testing-and-production-readiness.md](testing-and-production-readiness.md) | Test strategy, the isolated database test lifecycle, the production-readiness gate | **Partly implemented** (Phase 1 tests only) |

## Current state, stated plainly

As of Phase 1 the web system is a **local development foundation only**.

What exists:

- a self-contained `web/` npm workspace,
- a minimal Fastify API exposing `/health` and `/ready`,
- a minimal React and Vite development preview,
- a local PostgreSQL development service in Docker,
- an isolated Testcontainers lifecycle for integration tests,
- this documentation.

What does **not** exist, and must not be assumed to exist:

- authentication of any kind, and no users, sessions, MFA, or recovery tables,
- any business table or business rule,
- any Android synchronisation,
- any deployment, any VPS configuration, and any production data.

The Android application is unchanged and remains offline-first on local SQLite
(DEC-331). The Firebase implementation remains present and dormant (DEC-407).

## Governing decisions

| Decision | Subject |
| --- | --- |
| DEC-406 | VPS, PostgreSQL, and the private web application replace Firebase as the approved production architecture |
| DEC-407 | Firebase stays dormant and is removed only after the replacement is accepted |
| DEC-408 | One protected Owner and two named Admins |
| DEC-409 | Private application boundary and read-only-first rollout |
| DEC-410 | Existing identifiers preserved; UUIDs only for new server-only records |
| DEC-411 | Correction history preserved; a separate server audit-event table is added |
| DEC-412 | No blind last-write-wins for financially significant operations |
| DEC-413 | Transaction-number policy |
| DEC-414 | Recovery point and recovery time objectives |
| DEC-415 | Pinned technology baseline |

Open questions that gate later phases: **OQ-157** (authentication solution),
**OQ-158** (whether the real infrastructure can meet DEC-414), **OQ-159**
(how domain rules are shared without a forked copy).
