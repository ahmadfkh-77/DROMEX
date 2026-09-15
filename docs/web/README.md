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
| [security-and-accounts.md](security-and-accounts.md) | Owner and Admin model, the private-application boundary, authorisation rules | **Partly implemented** (local development only: password-plus-TOTP sign-in, sign-out, sanitized session endpoint, active-principal and mandatory-MFA enforcement, Owner recovery-code sign-in with restricted authenticator replacement, and a security audit foundation; terminal Owner activation and terminal emergency Owner recovery tested on disposable databases only, both commands refuse every run, and no Owner exists; no public registration, password recovery, or account management) |
| [authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md) | Selected authentication system and why, threat model, MFA and Owner-recovery design, permission-block architecture, API enforcement, testing strategy | **Partly implemented** (local development only: route classification, Argon2id hashing, Better Auth configuration and schema, the DROMEX principal and migrations, the sign-in, TOTP verification, sign-out, and session transport, mandatory MFA, TOTP replay protection, versioned secrets, recovery-code issuance, resumable terminal Owner activation whose command refuses every run, recovery-code sign-in with a restricted recovery state and supported authenticator replacement, the security audit foundation, and terminal emergency Owner recovery with the DEC-437 last-resort reset, whose command refuses every run. No Owner, Owner readiness enforcement, permissions, UI, or deployment) |
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

- authentication beyond the Phase 2C local transport (email/password plus
  mandatory TOTP sign-in, sign-out, and a sanitized session endpoint, verified
  only against disposable test databases), recovery-code sign-in with
  restricted authenticator replacement, a security audit foundation, and
  terminal emergency Owner recovery tested on disposable databases only
  (DEC-437; its command refuses every run): no password recovery,
  permissions, or real account,
- a real Owner: terminal activation exists and is tested against disposable
  databases, but its command refuses every run until checkpoints 3F-B, 3F-C,
  and 3F-D are accepted and OQ-161 is resolved (DEC-435),
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
| DEC-418 | Better Auth selected as the authentication foundation (closes OQ-157) |
| DEC-419 | Argon2id password hashing, overriding Better Auth's default |
| DEC-420 | Cookie-based sessions; Better Auth's session cookie cache disabled |
| DEC-421 | Mandatory MFA enforced as DROMEX application policy |
| DEC-422 | Only required Better Auth features enabled; no SSO/SCIM/OIDC-provider/Stripe/magic-link/email-OTP |
| DEC-423 | Owner recovery: sealed physical recovery codes plus a version-controlled, tested, audited break-glass procedure (never ad hoc manual queries); no second Owner; not authorized for Claude to execute |
| DEC-424 | Authorization shape: template, per-user overrides, project scope, effective permissions, deny by default |
| DEC-425 | Effective-permission computation and override provenance |
| DEC-426 | Database-enforced single Owner and Owner self-protection |
| DEC-427 | Sensitive changes revoke sessions; disabling never deletes a user |
| DEC-428 | API authorization at the service/use-case boundary; default-deny route registration |
| DEC-429 | Row-level security not used in the first release; least-privilege roles instead |
| DEC-430 | Server `audit_event` table, append-only to the application's own runtime role (not a guarantee against a database administrator) |
| DEC-431 | Better Auth upgrades treated as security maintenance; separate migration sequence |
| DEC-432 | Guardrail against automatic Daily Report linkage pending OQ-164 |
| DEC-433 | WorkOS recorded as the named authentication fallback |
| DEC-434 | Mandatory TOTP MFA enforced; first Owner activated only through the local terminal; no trusted-device bypass; versioned secrets; TOTP replay protection |
| DEC-435 | Hardened Better Auth recovery codes; supported retrieval as the primary future break-glass; real activation prohibited until 3F-B, 3F-C, 3F-D, and OQ-161; precision correction: supported replacement temporarily disables the old factor |
| DEC-436 | Restricted web recovery state for Owner recovery-code sign-in and supported authenticator replacement; no business access without a verified factor; security audit foundation |
| DEC-437 | Terminal emergency Owner recovery requiring the current password; supported replacement and one-code retrieval preferred; narrowly scoped two-operation factor reset only when supported recovery is impossible; command not enabled |

Full detail for DEC-418 through DEC-437 is in
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md).

Open questions that gate later phases: **OQ-158** (whether the real
infrastructure can meet DEC-414, now also gating sign-in itself), **OQ-159**
(how domain rules are shared without a forked copy), **OQ-160** (session
lifetime values), **OQ-161** (email delivery mechanism), **OQ-162** (Android
authentication model), **OQ-163** (offline-revocation policy), **OQ-164**
(Daily Report finalization boundary), **OQ-165** (CI security tooling).
**OQ-157** (authentication solution) is closed by DEC-418.
