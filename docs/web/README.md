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
| [security-and-accounts.md](security-and-accounts.md) | Owner and Admin model, the private-application boundary, authorisation rules | **Partly implemented** (local development only: password-plus-TOTP sign-in, sign-out, sanitized session endpoint, active-principal and mandatory-MFA enforcement, Owner recovery-code sign-in with restricted authenticator replacement, and a security audit foundation; terminal Owner activation and terminal emergency Owner recovery tested on disposable databases only, both commands refuse every run, and no Owner exists; password reset (checkpoint 4C) and Owner account and session management (checkpoint 4E, DEC-490) on disposable databases only; no public registration or permission model) |
| [authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md) | Selected authentication system and why, threat model, MFA and Owner-recovery design, permission-block architecture, API enforcement, testing strategy | **Partly implemented** (local development only: route classification, Argon2id hashing, Better Auth configuration and schema, the DROMEX principal and migrations, the sign-in, TOTP verification, sign-out, and session transport, mandatory MFA, TOTP replay protection, versioned secrets, recovery-code issuance, resumable terminal Owner activation whose command refuses every run, recovery-code sign-in with a restricted recovery state and supported authenticator replacement, the security audit foundation, and terminal emergency Owner recovery with the DEC-437 last-resort reset, whose command refuses every run, the email transport foundation (checkpoint 4A), Owner-managed Admin invitations (checkpoint 4B1), and restricted invitation acceptance with the `pending` lifecycle and a never-routed internal sign-up capability (checkpoint 4B2), and password reset with a DROMEX-owned fragment token, a never-routed internal password-write capability, the credential-change session rule, and the offline common-password blocklist (checkpoint 4C), and the running server's email configuration, disabled by default and failing closed on any partial configuration (checkpoint 4D), and Owner account and session management with the `sessions_revoked_at` rule, disable and re-enable with a reason, one and all-session revocation, and guard-level auditing of refused non-Owners (checkpoint 4E, DEC-490). No Owner, real invitation, Admin, or reset, Owner readiness enforcement, configured email provider, email sending, permissions, designed sign-in UI, or deployment) |
| [postgresql-strategy.md](postgresql-strategy.md) | Schema approach, identifier preservation, roles, the PostgreSQL 18 volume rule | **Partly implemented** (development service only, no schema) |
| [synchronization-strategy.md](synchronization-strategy.md) | Android synchronisation protocol and conflict rules | **Planned** (not implemented) |
| [docker-vps-strategy.md](docker-vps-strategy.md) | Local Docker topology, port exposure rules, production deployment plan | **Partly implemented** (local development only) |
| [backup-and-recovery.md](backup-and-recovery.md) | Backup design, recovery objectives, restore verification | **Planned** (no backups exist) |
| [testing-and-production-readiness.md](testing-and-production-readiness.md) | Test strategy, the isolated database test lifecycle, the production-readiness gate | **Partly implemented** (Phase 1 tests only; CI verification on GitHub Actions (phase CI-1, DEC-491)) |

For what must be true before real Owner activation and production, the
evidence status of each gate, and what only the Owner can do, see
[production-gates.md](production-gates.md).

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
  (DEC-437; its command refuses every run): no permissions or real account,
- any real email sending or real password reset: the email transport
  foundation (checkpoint 4A), the Owner's side of Admin invitations (create,
  list, resend, cancel, expiry, audit; checkpoint 4B1), restricted invitation
  acceptance with the `pending` principal lifecycle (checkpoint 4B2,
  DEC-444), and password reset with the common-password blocklist
  (checkpoint 4C, DEC-487, DEC-488) exist, tested against capture
  transports, disposable databases, and a stubbed browser API only; the
  running server reads email configuration (checkpoint 4D, DEC-489) but
  defaults to disabled and has no provider configured, no real invitation,
  Admin, or reset exists, and there is no provider account, API key, DNS
  configuration, secret file, or email,
- a real Owner: terminal activation exists and is tested against disposable
  databases, but its command refuses every run. OQ-161's design closure does
  not unblock it: enabling it requires the DEC-443 gate. Password reset is now
  implemented and verified locally (gate items (a) and (b), local evidence
  only); production email configuration, SPF/DKIM/DMARC, a monitored
  Reply-To mailbox, a real delivery, a physically rehearsed reset, and
  separate approval all remain,
- any real account administration: Owner account and session management
  (checkpoint 4E, DEC-490) exists and is tested against disposable databases
  and a stubbed browser API only; the sign-in and account screens (SI-1a)
  exist and are verified against a stubbed API only, with no real Admin or
  session to manage, and no permission model,
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
| DEC-439 | Transactional email through Resend's HTTPS API behind a provider-neutral interface; Postmark documented fallback; self-hosted and mailbox SMTP rejected; provider key as a Compose secret file; no webhooks initially; delivery status advisory only (closes OQ-161 with DEC-440 to DEC-442; design only) |
| DEC-440 | Owner-only, single-use, 24-hour Admin invitations stored as a token hash; restricted web TOTP enrolment for invited Admins, refining DEC-434 (the Owner stays terminal-only); all sessions revoked after enrolment (design only) |
| DEC-441 | Password reset for every enabled account including the Owner: 30 minutes, single-use, hashed, superseding, generic responses, all sessions revoked, MFA never bypassed; nuisance-lockout residual risk accepted (design only) |
| DEC-442 | Tokens only in the URL fragment; configured origin; no-referrer and no third-party content; English-only emails with no business or secret content and no tracking (design only) |
| DEC-443 | Real Owner activation stays blocked until password reset is implemented, verified, production configured, delivered, and physically rehearsed, and enabling the command is separately approved; refines DEC-435 (6); terminal recovery stays separately disabled |
| DEC-444 | Interrupted invitation setup leaves a never-deleted, unusable `pending` principal; re-invitation resumes it only after proof of the existing password; invitation validity re-checked at every acceptance step; a server-internal, never-routed Better Auth sign-up capability creates the invited identity (implemented locally in checkpoint 4B2) |
| DEC-487 | Password reset: a DROMEX-owned 256-bit fragment token and lifecycle; an unmounted internal Better Auth capability performs only the final password write; the `credentials_changed_at` rule ends every earlier session at every gate; pending invitees may reset without activation; one neutral `202`, with `429` only per network source; no TOTP at completion and MFA never touched (implemented locally in checkpoint 4C) |
| DEC-488 | An offline, pinned common-password blocklist (NCSC top 100,000 via SecLists) refuses common passwords on every path that creates or changes a password; no runtime network check (implemented locally in checkpoint 4C) |
| DEC-489 | The running API reads email configuration in exactly two modes: disabled by default, or Resend only when the key-file path, sender, Reply-To, and a trusted HTTPS link origin are all valid; partial, ambient-key, or `capture` configuration stops startup; delivery built once at startup and shared by invitations, reset, and password-changed; startup never contacts the provider (implemented locally in checkpoint 4D; no provider configured) |
| DEC-490 | Owner account and session management: Owner-only list, detail, disable and re-enable with a mandatory bounded reason, one and all-session revocation; a forward-only `sessions_revoked_at` rule ends sessions atomically with the change and keeps re-enabling from reviving any; Better Auth rows deleted afterwards through its internal adapter in one never-routed module; guard-level auditing of refused non-Owners; no deletion (implemented locally in checkpoint 4E; confirmed) |
| DEC-491 | GitHub Actions on a GitHub-hosted `ubuntu-24.04` runner is the accepted environment for time-sensitive web test evidence; evidence counts only from `web-tests.yml` runs whose strict clock gate passed; read-only permissions, no secrets, no deployment, no VPS access (phase CI-1; confirmed) |
| DEC-493 | Web sessions keep the values already in code: 12 hour lifetime and 1 hour refresh, a sliding window (so 12 hours bounds inactivity, not total age), cookie cache disabled, `freshAge` not configured; Better Auth's 7 day / 1 day defaults are not DROMEX policy; an absolute maximum age and a fresh-login window are deferred; OQ-160 stays open until the Owner decides its closing wording (confirmed) |

Full detail for DEC-418 through DEC-437, and for DEC-439 through DEC-444 and
DEC-487 to DEC-490 (§14A), is in
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md).
DEC-438 is an Android decision and is not a web governing decision.

Open questions that gate later phases: **OQ-158** (whether the real
infrastructure can meet DEC-414, now also gating sign-in itself), **OQ-159**
(how domain rules are shared without a forked copy), **OQ-160** (session
lifetime values), **OQ-162** (Android authentication model), **OQ-163**
(offline-revocation policy), **OQ-164** (Daily Report finalization boundary),
**OQ-165** (CI security tooling), **OQ-168** (recovery for an invited Admin
who lost the authenticator before activation). **OQ-157** (authentication solution) is
closed by DEC-418. **OQ-161** (email delivery mechanism) is closed as a design
decision by DEC-439 through DEC-442; password reset is implemented locally
(checkpoint 4C), the running server reads email configuration (checkpoint
4D), production configuration is pending, and Owner activation
stays blocked (DEC-443).
