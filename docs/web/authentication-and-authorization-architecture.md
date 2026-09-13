# Authentication and Authorization Architecture

Status: **partly implemented, local development only; not production-ready.**
Implemented and tested against disposable databases: route classification,
Argon2id hashing, the Better Auth configuration and schema, the DROMEX
principal and its migrations, the minimal sign-in, sign-out, and session
transport (see §11, "Implemented transport"), and Owner provisioning tooling
that is **not approved for real use** before MFA (see §11, "Owner provisioning
tooling"). No Owner exists. Everything else here — MFA, recovery, Owner
readiness enforcement, permissions, account management, audit events, the
frontend, and any deployment — remains **design only**. Nothing is
merged, released, or deployed. This document records the approved design so
that no future session has to reconstruct it from chat history.

This document is the detailed companion to
[security-and-accounts.md](security-and-accounts.md), which remains the short
statement of the private-application boundary and the account model. Where
the two overlap, this document is the fuller treatment and
security-and-accounts.md links here rather than duplicating it.

Research conducted 2026-09-11. Decisions recorded here were approved by the
Owner on 2026-09-12 and are numbered DEC-418 through DEC-433 in
`requirements/decisions.md`. Six related questions remain open and are
tracked as OQ-160 through OQ-165 in `requirements/open-questions.md`; they
are named throughout this document and **must not be answered here**.

## 1. Plain-language objective

DROMEX holds the operating record of a real construction business: what was
delivered, to whom, at what price, who owes money, what fuel went where, and
which reports were issued to outside parties. The web application puts that
record on a machine reachable from the internet and eventually lets more than
one person write to it. Those two changes are what create the risk the
Android app has been largely free of, because Android has been one person's
device.

The objective: only people the Owner personally created accounts for can get
in; each of them can only do the specific things the Owner decided they can
do; every sensitive action is recorded with their name on it; and when access
is taken away, it is gone immediately, not whenever a session happens to
expire.

Four commitments follow from that:

1. Nothing about the business is visible before sign-in — not data, not a
   project name, not a customer list in page metadata, not a PDF at a
   guessable URL.
2. The server decides, always. A browser or an Android device never tells
   the server what it is allowed to do. Hiding a button is a courtesy to the
   user, never a security control.
3. A password alone is never enough. Every account carries a second factor,
   mandatory for everyone including the Owner.
4. Permission is granted, never assumed. A user who has not been given a
   permission does not have it. Adding a new module to DROMEX never quietly
   hands it to anyone.

**No system here is completely secure.** This design reduces the chance of a
breach, limits the damage of one, and makes one detectable and recoverable.
It does not eliminate the possibility. The largest remaining risks are not
technical: a compromised administrator computer, a leaked backup, and a
trusted insider. Those are addressed by operational discipline, not code.

## 2. Research sources and dates

All research below is current as of **2026-09-11**. Each finding is labelled:

- **Verified** — fetched directly from an official source (product
  documentation, official GitHub repository, npm registry, OWASP, NIST, or
  W3C) during this research pass.
- **Reported** — found by a research pass but not independently re-fetched;
  treat as needing a fresh check before relying on it operationally.
- **Unverified** — could not be confirmed from an official source.

Standards referenced, with links current as of 2026-09-11:

- [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/) — released 2025-05-30. ([GitHub tag](https://github.com/OWASP/ASVS/tree/v5.0.0))
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (supersedes the deprecated "Access Control Cheat Sheet")
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — recommends Argon2id first (m=19456, t=2, p=1), then bcrypt, then scrypt
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP API Security Top 10, 2023 edition](https://owasp.org/API-Security/editions/2023/en/0x00-toc/) — still the current official edition as of this research; no newer edition found
- [OWASP Top 10, 2025 edition](https://top10.owasp.org/2025) — A01:2025 Broken Access Control remains #1
- [NIST SP 800-63-4, Digital Identity Guidelines (Final)](https://csrc.nist.gov/pubs/sp/800/63/4/final) — published 2025-07-31
- [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) — reached Recommendation 2026-08-25

Candidate research sources are cited inline in §4.

## 3. Full threat model

DROMEX-specific. For each threat: prevention, detection, recovery, residual
risk.

| # | Threat | Prevention | Detection | Recovery | Residual risk |
|---|---|---|---|---|---|
| 1 | Password theft | Mandatory TOTP MFA on every account; Argon2id hashing; breached-password check on set/change; 15+ character passwords recommended, 8 absolute floor, no composition rules, paste and password managers permitted | Audit event on every sign-in with IP and user agent; Owner-visible sign-in history | Owner disables the account; all sessions revoked; password reset; TOTP re-enrolled | A stolen password plus a stolen TOTP seed defeats both factors. Only phishing-resistant WebAuthn closes this — deferred, not excluded |
| 2 | Credential stuffing | No public registration keeps the account set tiny; MFA blocks stuffing even on a correct password; per-account and per-IP rate limiting | Spike in failed sign-ins across accounts | Lockout with Owner-controlled release | Accepted; MFA is the real backstop |
| 3 | Brute force | Rate limiting on sign-in and MFA endpoints, stricter than the global default; exponential backoff; account lockout | Rate-limit rejections logged | Automatic window expiry; Owner can clear a lockout | A slow distributed attack below the threshold remains possible; MFA mitigates |
| 4 | Phishing | Three named users can be told, once, that DROMEX never emails a sign-in link; magic-link and email-OTP authentication are not enabled at all; a single fixed hostname | User reports; sign-in from unexpected geography | Disable, revoke sessions, rotate | **TOTP is phishable in real time.** The largest residual authentication risk; the strongest argument for a future WebAuthn phase |
| 5 | MFA fatigue / recovery abuse | No push-based MFA at all; recovery codes shown once, single-use; regenerating destroys the old set and requires a fresh session and the password | Audit event on every recovery-code use and regeneration | Owner regenerates codes; investigate unexplained use | A user who stores codes badly defeats this — operational, not technical |
| 6 | Lost devices | Recovery codes issued at enrolment; Owner can reset a user's MFA | Owner notices the user cannot sign in | Owner clears the TOTP enrolment, user re-enrols, prior sessions revoked | Owner losing their own device and codes is the catastrophic case — addressed directly in §9 |
| 7 | Session theft | `HttpOnly` so JavaScript cannot read the cookie; `Secure`; `SameSite=Lax`; opaque server-side session ID; **session cookie cache disabled** so revocation is immediate | Session used from a second IP or user agent; per-device session list visible to the Owner | Revoke that session, or all of the user's sessions | A stolen cookie works until noticed or expired; short session lifetime reduces the window |
| 8 | Session fixation | A new session identifier is issued on authentication and re-authentication; the pre-auth session is discarded | Anomalous session lineage in audit events | Revoke and re-authenticate | Low |
| 9 | CSRF | `SameSite=Lax` as defence in depth only; Origin-header validation against an explicit `trustedOrigins` allowlist with no wildcards; state-changing requests required to be non-simple (`Content-Type: application/json`); Fetch Metadata checks | Rejected requests logged | None needed — the request is refused | A browser bug or same-site subdomain takeover could weaken this; no wildcard subdomains permitted |
| 10 | XSS | React's default escaping; no `dangerouslySetInnerHTML`; strict CSP with no `unsafe-inline`; session token never readable by JavaScript; no bearer tokens in the browser | CSP violation reporting; code review | Patch, rotate secrets, revoke all sessions | A successful XSS can still act as the user within their permissions — this is why permissions stay narrow |
| 11 | SQL injection | Parameterized queries everywhere via `pg`; runtime database role holds no DDL and no DELETE | Static analysis; anomalous query errors | Patch; audit what was reachable | Low, given a single data path |
| 12 | Broken access control (A01:2025, still #1) | Deny by default; permission checked at the service/use-case boundary, not only the route; effective permissions read from the database on every request | Denied sensitive actions logged as security events | Correct the policy; review the audit trail | A missing check on one new endpoint is the classic failure — countered by a default-deny route registration pattern, §11 |
| 13 | IDOR | Never trust an identifier from the client; the record is loaded first, its project checked against the caller's scope, then the action permission | Denied access to a specific record logged | Fix the handler; audit what was returned | Any handler bypassing the shared guard — countered by making the guard the only way to load a scoped record |
| 14 | Vertical privilege escalation | Permission set is server-side only; the client never sends its own permissions; Owner status protected by a database constraint; an Admin cannot grant themselves anything | Audit event on every permission change, with actor | Revoke, revert, investigate | An Admin with user-administration permission is powerful by definition — initially only the Owner holds it |
| 15 | Horizontal privilege escalation | Project scope enforced in the same guard as IDOR; no cross-project query without an explicit unscoped permission | Denied access logged with target project | Fix; audit | As #13 |
| 16 | Disabled user retaining a session | Disabling revokes every session in the same transaction; the per-request check reads user status from the database, so a surviving cookie fails immediately | Audit event; any request from a disabled user logged | None needed | This is precisely why the session cookie cache must stay off |
| 17 | Malicious insider | Least privilege via narrow permission blocks; price visibility separated from data entry; nothing hard-deleted; cancellation and correction require a reason and leave history | Append-only audit trail; Owner review of security events | Disable the account; historical attribution preserved | An Admin can still do real damage within their permissions — bounded, not eliminated |
| 18 | Leaked logs | Generic error to the user, detail to the log; never log passwords, tokens, session IDs, TOTP secrets, or recovery codes; log encoding against injection | Secret-scanning log output in CI (OQ-165) | Rotate anything exposed; revoke all sessions | A verbose third-party library logging a header — countered by an explicit redaction list |
| 19 | Leaked backups | Backups encrypted at rest with a key held separately from the backup; off-site copy; restricted access | Access logging on the backup destination | Rotate the encryption key; rotate all credentials; force password and MFA re-enrolment | A leaked backup is a total compromise of the business record — one of the worst outcomes in this model |
| 20 | Leaked `.env` | `web/.env` gitignored, never read into a Claude session; only `.env.example` with placeholders committed; production secrets via Docker secrets; secret scanning | Secret scan on every commit (OQ-165) | Rotate every secret; revoke all sessions; re-issue the Better Auth secret | Human error in a screenshot or a paste |
| 21 | Compromised dependencies | Exact version pins per DEC-415, no floating ranges; committed lockfile; `npm ci` in CI; images pinned by tag and digest in production | `npm audit`; advisory monitoring on Better Auth | Pin back, patch, rebuild, redeploy | A compromised transitive package is genuinely hard to prevent |
| 22 | Compromised administrator computer | MFA on a separate device from the browser; short sessions; per-device session list | Unfamiliar device in the session list | Revoke all sessions; rotate password and MFA | A fully compromised admin machine defeats most controls here — this is honestly the weakest point |
| 23 | VPS compromise | Only 80/443 published; PostgreSQL published on no port at all; `DOCKER-USER` chain rules because Docker-published ports bypass UFW; SSH keys only, root login disabled; least-privilege database roles | Host monitoring; audit-trail anomalies; backup integrity checks | Rebuild from a known image, restore from backup, rotate every secret | Full compromise means full data disclosure |
| 24 | Synchronization replay | Every mutation carries a durable client-generated UUID; the server records applied mutation IDs and ignores repeats; stale mutations rejected rather than blind last-write-wins (DEC-412) | Rejected-conflict count observable and auditable | Client refreshes and re-applies | Bounded by session security |
| 25 | Offline Android device returning after revocation | Device sync requires a live authenticated session; a revoked user's queued mutations are rejected at the boundary | Rejected mutations logged with user and device | Owner decides whether to re-admit any rejected work | **Real operational consequence — the reject-vs-quarantine choice is OQ-163, deliberately not decided here** |
| 26 | Denial of service | Rate limiting; reverse-proxy limits; small connection pool; health checks and restart policies | 503s and rate-limit rejections; uptime monitoring | Restart, scale, block the source | No DDoS protection is in scope |
| 27 | Backup, upgrade, recovery, or rollback mistakes | Rehearsed procedures; a safety copy before any restore; forward-only migrations; a tested rollback path | A restore test that actually runs; backup-failure alerting that reaches a person | The safety copy | An untested backup is not a backup — OQ-158 remains open precisely here |

## 4. Authentication candidate comparison

Nine self-hosted or hosted candidates plus a discouraged baseline were
compared against: Fastify, Node 24, self-hosted PostgreSQL, React/Vite, 3
named users growing to more, no public registration, mandatory TOTP MFA,
possible future Android bearer-token sync, a single-operator maintenance
budget, and a hard rule against rolling custom auth.

### Disqualified, with reasons

- **Auth.js** — no Fastify support, no built-in TOTP, no user management, no
  session revocation, no admin surface (verified from `authjs.dev`).
- **SuperTokens** — Apache 2.0 core, but **TOTP MFA is a paid add-on: $0.01
  per MAU with a $100/month minimum**, even self-hosted (verified from
  `supertokens.com/pricing`). Paying that much for the one non-negotiable
  requirement is poor value.
- **Keycloak** — Apache 2.0, JVM runtime, full admin console, but
  brute-force protection ships **disabled by default**, the Node server
  adapter (`keycloak-connect`) is deprecated, and it carries the largest CVE
  stream of any candidate researched, including CVE-2026-3429 (improper
  access control enabling MFA deletion and account takeover) (reported).
  Disproportionate operational burden for three users on a single VPS
  maintained by one person.
- **Ory Kratos** — Apache 2.0, cleanest CVE record of any candidate
  researched (one SQL-injection advisory, CVE-2026-33503, fixed in
  v26.2.0+). **Headless**: every sign-in, MFA, recovery, and settings screen
  must be built by hand, a separate service must be run and patched, and
  mandatory-MFA enforcement, rate limiting, and enumeration protection are
  all unconfirmed as built-in for self-hosted deployments (reported). That
  is the work of a library plus the work of a server.
- **Zitadel** — the best mandatory-MFA toggle and the best audit
  architecture of any candidate researched (an explicit instance-level
  "Force MFA for all users" setting; event-sourced audit trail). Disqualified
  because **CVE-2025-64103 (CVSS 9.8) was an authentication bypass in
  exactly the MFA-enforcement path** that would be the reason to choose it,
  fixed in 4.6.0/3.4.3/2.71.18 (reported). Combined with a second service, a
  second database lifecycle, and an AGPL-3.0 core license whose
  non-applicability to internal use I could not verify from an official
  page, the balance tips against it. Worth revisiting if DROMEX ever needs
  real multi-tenancy or SAML.
- **Authentik** — MIT core, but requires **four additional services**
  (PostgreSQL, Redis, server, worker), has no official React SDK, and
  general login rate limiting is not confirmed as built-in (reported).
- **Assemble from primitives** — Passport.js is effectively unmaintained;
  OWASP's Session Management Cheat Sheet explicitly discourages rolling your
  own session handling. This is the option `docs/web/security-and-accounts.md`
  already recorded as withdrawn, for the reason recorded there.

### Top two, and the recommendation

**1. Better Auth** — an MIT-licensed library running inside the existing
Fastify process, using the existing PostgreSQL instance, adding no container
and no Redis.

**2. Logto** — an MPL-2.0 self-hosted service with a genuine built-in
mandatory-MFA policy, an official Fastify guide, an official React SDK, and
OIDC-native support for a future Android client. **Not selected**, but
recorded as the strongest self-hosted alternative if Better Auth's
conditions in §5 prove unworkable.

**Selected: Better Auth (DEC-418).** The decisive argument is not feature
count. DROMEX has one operator, an unproven recovery objective (OQ-158), and
a hard requirement that a disabled user loses access immediately. Better
Auth puts users, sessions, two-factor secrets, and recovery data in **the
same PostgreSQL database as the business data**. One backup covers
everything; one restore restores everything consistently; there is no second
service to patch; a session-revocation check is a local query, not a network
call to another system. Every self-hosted alternative researched splits
identity into a second stateful system with its own backup, upgrade path,
and failure mode — on infrastructure that has not yet proven it can meet a
four-hour RTO for *one* database (OQ-158).

**Held as the named fallback (DEC-433): WorkOS (AuthKit).** Free to 1M MAU
with MFA included at every tier, official Fastify and React SDKs, the most
completely documented session-revocation API of any candidate researched
(list sessions with device metadata; revoke one, all, or all-but-current;
emits a `session.revoked` event) (reported). Not selected as primary because
DEC-406 approved a business-controlled VPS as the production architecture,
and WorkOS places user identity and login availability outside that
boundary — a WorkOS outage means nobody can sign in regardless of the VPS's
own health, and migrating off later means re-implementing authentication.
Recorded explicitly so it does not have to be re-researched if self-hosted
authentication proves operationally unsustainable.

## 5. Better Auth: verified capabilities, and what is DROMEX policy

This section is written so a future reader can tell, at a glance, which
statement is a documented product capability and which is a decision DROMEX
is making on top of it.

### Verified from official documentation (`better-auth.com`, the GitHub
repository, and the npm registry), 2026-09-11

- **Version and license**: `better-auth` v1.7.4, MIT license (npm registry).
- **Fastify integration**: a catch-all route handler at `/api/auth/*`
  (`auth.handler(req)`, `fromNodeHeaders`), not a dedicated adapter package.
  CORS via `@fastify/cors`; `trustedOrigins` configured on the `betterAuth()`
  instance.
- **PostgreSQL**: via the Kysely adapter over a standard `pg` `Pool`.
  **Better Auth generates and owns its own tables** through its own CLI,
  invoked as the repository-local pinned binary — `auth@1.7.4`, run as
  `node node_modules/auth/dist/index.mjs generate` (or `migrate`) — never as
  a floating `npx auth@latest`, which would resolve an unpinned version at
  run time. It can be pointed at an existing database. Note that with the
  Kysely/PostgreSQL adapter, `generate` **introspects a live database** to
  compute what is missing, so it requires a reachable server; schema
  generation is therefore run against a disposable database, never against
  the development or production one.
- **Better Auth keeps no migration ledger.** Verified against a disposable
  PostgreSQL 18.6 database on 2026-09-12: after `migrate`, the only tables
  present are Better Auth's own five. The CLI tracks what has been applied by
  introspecting the live schema, so re-running `migrate` reports
  `No migrations needed` and a second `generate` reports
  `Your schema is already up to date`. Replaying the generated `.sql` file
  **by hand** is a different matter and fails with `already exists`, so any
  tooling that applies that file directly needs its own tracking.
- **DROMEX keeps its own ledger, and the two mechanisms never meet.** Better
  Auth discovers its state by introspection; DROMEX records what it applied
  in a `dromex_migration` table (identifier, name, SHA-256 checksum, applied
  timestamp). The DROMEX migrator never reads, applies, or reasons about
  Better Auth's SQL, and Better Auth never sees DROMEX's ledger. Keeping them
  apart is what stops a DROMEX change from being credited to Better Auth's
  schema state, or the reverse (DEC-431). The migrator holds a PostgreSQL
  advisory lock for the whole run so two API instances starting at once
  cannot both apply the same migration — proven by a test that fails when the
  lock is removed — runs each migration in its own transaction alongside its
  ledger row, and fails closed on a changed checksum, a duplicate identifier,
  or a migration recorded as applied but absent from the set.
- **`rateLimit.lastRequest` type — verified 2026-09-13; defect resolved by
  DROMEX-owned storage (Owner decision, Option C).**
  Better Auth's generated SQL declares `lastRequest bigint`, and its runtime
  schema check warns `Expected number but got int8`. Tested through the real
  sign-in route against disposable PostgreSQL 18.6 databases: node-postgres
  returns `int8` to JavaScript as a **string**, and Better Auth's database
  rate limiter converts only a JavaScript `bigint`, so it receives the string
  unchanged.
  - **Enforcement is correct.** Comparisons subtract, which coerces the string
    to a number. The five-attempt, 60-second rule blocks the sixth attempt —
    even with the right password — persists in PostgreSQL across a freshly
    constructed application, resets once the window has elapsed, cannot be
    bypassed with forged forwarding headers, and gives a genuinely different
    socket address its own bucket.
  - **The retry-after value is wrong.** Better Auth computes it as
    `lastRequest + windowInMs`, which concatenates the string; testing
    observed `X-Retry-After: 178928925868309` seconds.
  - **Resolution.** Better Auth 1.7.4 officially supports
    `rateLimit.customStorage` with an atomic `consume(key, { window, max })`
    operation. DROMEX supplies one (`src/auth/rate-limit-storage.ts`) backed
    by its own `dromex_rate_limit` table, created by DROMEX migration `0002`
    through the DROMEX ledger. Its `last_request_ms` column is `BIGINT`,
    converted explicitly: only canonical non-negative integer text within
    `Number.MAX_SAFE_INTEGER` is accepted, and anything else fails closed
    without changing the row. Each decision runs in one transaction under a
    `SELECT … FOR UPDATE` row lock, so concurrent requests can neither lose
    an increment nor be over-granted. The retry time is
    `ceil((last + window − now) / 1000)`, clamped to `1…window`.
  - **Rejected alternatives.** A global node-postgres `int8` parser would
    silently change every `BIGINT` read in the process, including future
    business columns where exact 64-bit values matter. Editing Better Auth's
    generated schema would break the separation of the two migration
    sequences (DEC-431) and be overwritten by the next generation. Better
    Auth's generated `rateLimit` table is left exactly as generated
    (`storage: 'database'` is kept for that reason) and is no longer written.
  - **Verified:** the sixth attempt is blocked with `Retry-After` between 1
    and 60; state survives a fresh server instance; 12 concurrent sign-ins
    yield exactly five 401s and seven 429s; forged forwarding headers create
    no new bucket; the global `BIGINT` parser is unchanged. Removing the row
    lock makes the concurrency test fail.
- **Two-factor plugin (`twoFactor`)**: TOTP enrolment returns `{ method,
  totpURI, backupCodes }`; verification accepts one period before and after
  the current code. `skipVerificationOnEnable` defaults to `false`.
  `trustDevice`, when used, trusts a device for 30 days.
- **Backup codes**: `backupCodeOptions` defaults to `amount: 10`,
  `length: 10`. **`storeBackupCodes` defaults to `"plain"`** — codes are
  stored **unhashed** in the database unless explicitly configured to
  `"encrypted"`. The documentation states this option accepts `"plain"`,
  `"encrypted"`, or a custom encryptor function — **all three are
  reversible encryption or no encryption at all; none is a one-way hash.**
  `customBackupCodesGenerate` was checked separately and controls only how
  codes are *generated*, not how they are *stored* or *verified*. The
  `verify-backup-code` endpoint accepts a plain code string, implying an
  exact-match (or decrypt-and-compare) lookup rather than a hash
  comparison. **Conclusion, checked directly against the current official
  documentation: one-way hashed storage of backup codes is not a
  documented or supported option in Better Auth, in any configuration.**
  This is recorded as a limitation of the library, not worked around by
  DROMEX — see DEC-423 and §14 for what closes the resulting gap instead.
  `generateBackupCodes()` deletes the previous set and issues a new one.
  `viewBackupCodes()` is server-side and documented as requiring a fresh
  session. A used code is removed from the database and cannot be reused.
- **Mandatory MFA is not a built-in policy.** The documentation states only
  that "2FA sign-in enforcement applies to the credential-based sign-in
  endpoints"; other methods need custom hooks. Enforcing MFA for every
  account is application-layer work.
- **Admin plugin**: `createUser`, `listUsers`, `getUser`, `updateUser`,
  `removeUser`, `setRole`, `banUser` (reason and optional expiry —
  **verified: banning immediately revokes all of the user's existing
  sessions**, not merely future sign-in), `unbanUser`, `setUserPassword`,
  `listUserSessions`, `revokeUserSession` (one), `revokeUserSessions` (all
  for a user), `impersonateUser`, `stopImpersonating`.
- **No admin-side function for resetting or clearing another user's TOTP
  enrolment is documented anywhere in the admin plugin.** Checked directly
  against the admin plugin reference — not found.
- **No built-in concept of a protected "super admin" role that other admins
  cannot modify is documented.** `adminRoles`/`adminUserIds` configure who
  holds admin capabilities, but nothing in the plugin itself prevents one
  admin from altering another's role.
- **No admin capability to view or export another user's backup codes is
  documented.**
- **User-initiated TOTP removal**: `twoFactor.disable()`, requiring the
  password (or nothing, if `allowPasswordless` is enabled) — this requires
  an existing valid session, so it is not reachable by a fully locked-out
  user.
- **Sessions**: database-backed; `session_token` is an opaque signed cookie
  identifier. Default `expiresIn` 7 days, `updateAge` 1 day.
  `revokeSession({token})`, `revokeOtherSessions()`, `revokeSessions()`.
  `freshAge` (default 1 day) gates sensitive endpoints.
  **`session.cookieCache`, if enabled, means a revoked session can remain
  active on other devices until the cache's `maxAge` expires** — the
  documentation states this plainly.
- **Cookies**: `httpOnly` and `secure` in production; `SameSite=Lax` by
  default; `useSecureCookies: true` to force.
- **CSRF**: layered — Origin-header verification against `trustedOrigins`;
  a preference for non-simple requests (`Content-Type: application/json`);
  `SameSite=Lax`; Fetch Metadata blocking of cross-site navigation.
- **Password hashing**: `scrypt` by default, overridable via custom
  `hash`/`verify` functions.
- **Rate limiting**: built in. Production default 100 requests per 60
  seconds; **disabled in development by default**. Storage: memory
  (default), `"database"`, `"secondary-storage"`, or custom. Per-path
  `customRules`.
- **Bearer plugin**: issues a token in a `set-auth-token` response header,
  sent as `Authorization: Bearer`. The documentation warns it is "intended
  only for APIs that don't support cookies" and that "improper
  implementation could easily lead to security vulnerabilities," without
  elaborating on the specific XSS/CSRF trade-off.
- **Security advisories**: 10 published on the repository's advisories page,
  including one Critical (`GHSA-rjg6-39jm-rgg4`, account takeover via SCIM
  provider-id collision) and several High (including
  `GHSA-qq9h-g4jm-xgf3`, account takeover via magic-link/email-OTP
  hijacking). **Every published advisory found sits in SSO, SCIM,
  OIDC-provider, Stripe, magic-link, or email-OTP** — features this design
  does not enable. **This is time-bounded evidence of where past
  vulnerabilities were found, not a guarantee about the code this design
  does use.** Not enabling those features removes them as an attack
  surface; it does not and cannot prove the enabled password-plus-TOTP
  core is free of undiscovered issues. Ongoing version upgrades (DEC-431),
  the testing strategy in §19, and advisory monitoring remain required
  regardless. The repository states it supports only the latest version;
  there are no backported patches.
- **Not stated in official documentation, checked directly and confirmed
  absent**: whether one account can hold more than one enrolled TOTP
  authenticator at a time; an automatic low-backup-code warning; a
  count-only endpoint for remaining backup codes.

### DROMEX application policy built on top of the above

None of the following is a Better Auth feature. All of it is DROMEX's own
enforcement, required by the decisions cited inline below and recorded in
`requirements/decisions.md`.

- Overriding password hashing to Argon2id (DEC-419), because `scrypt` is
  acceptable but not OWASP's first choice.
- Disabling `session.cookieCache` entirely (DEC-420), because its documented
  behaviour is incompatible with immediate revocation.
- Disabling `trustDevice` (DEC-421), because a 30-day MFA bypass contradicts
  mandatory MFA.
- Enforcing mandatory MFA for every account at a single authorization gate
  that rejects any authenticated request from a user without an enrolled
  TOTP, allowing only the enrolment endpoints (DEC-421).
- Enabling no feature DROMEX does not need — no SSO, SCIM, OIDC-provider,
  Stripe, magic-link, or email-OTP (DEC-422). Every published advisory
  found lives in those, so not enabling them is a deliberate reduction of
  attack surface — **it reduces exposure to known past issues; it is not
  proof that the remaining, enabled surface is safe.**
- Configuring `storeBackupCodes: "encrypted"` rather than accepting the
  default `"plain"` (DEC-423) — the strongest built-in option available,
  **explicitly still reversible encryption, not a one-way hash, which
  Better Auth does not support for backup codes in any configuration** —
  paired with the Owner-specific emergency-recovery design in §14, because
  Better Auth's own protection for backup codes stops there.
- Every part of authorization: role templates, per-user overrides, project
  scope, effective-permission computation, the business audit trail, and
  invitation onboarding (§6 through §11) — Better Auth provides none of
  this, by design, so it lives entirely in DROMEX's own schema under
  DROMEX's own migrations.

## 6. Owner and Admin account model

Implements DEC-408 without change.

- Exactly one Owner **once the system is initialised** — but that rule is
  assembled from three mechanisms, and it is worth being precise about which
  one does what, because the imprecise version invites a false sense of
  safety:

  | Mechanism | Guarantees | Status |
  |---|---|---|
  | Partial unique index on `is_owner WHERE is_owner` (DEC-426) | **At most** one Owner. A second is impossible | **Implemented** (`dromex_principal`, migration `dromex/0001`) |
  | Bootstrap workflow (DEC-426's "bootstrap transaction") | Creates the first and only Owner | **Tooling implemented and tested on disposable databases only; not approved for real use before MFA; no Owner exists.** It is *not* one transaction: Better Auth's identity commit and DROMEX's Owner commit are separate, bridged by a resumable intent under an advisory lock (§11, "Owner provisioning tooling") |
  | Runtime readiness + service rules | Refuse an initialised system with no Owner; refuse to remove or demote the Owner | **Not implemented** |

  A unique index can only forbid a second row; it cannot require a first.
  **Zero Owners is therefore a legitimate, expected state before bootstrap**,
  and the schema deliberately permits it — a test asserts this. No trigger or
  placeholder Owner row is used to force existence, because a fabricated
  Owner would be worse than an absent one. Until the readiness check exists,
  nothing detects an initialised system that has lost its Owner.
- Two individually named Admins at launch, identical initial permissions,
  each with their own credentials. No shared credential ever exists.
- No public registration. The only way an account comes into being is the
  Owner creating it.
- Only the Owner manages accounts, role templates, permissions, project
  scope, other users' sessions, and recovery.
- An Admin can never disable, delete, demote, rename, or replace the Owner,
  nor revoke a permission the Owner granted, nor grant themselves anything.
- **Owner self-protection (DEC-426)**: any operation that would remove
  `users.manage` or `security.manage` from the Owner, or clear `is_owner`,
  is rejected at the service layer.
- Disabled users keep their history. Disabling sets a status and revokes
  sessions; it never deletes the user row, because loads, reports,
  corrections, and payments reference their stable user ID (DEC-427).
  Deletion is not offered.
- Growth: additional individually named users are created the same way,
  differing only in template and overrides. Nothing in this model is
  specific to three users.

## 7. Role-template architecture

A template is a **named starting set of permissions** and nothing more; it
is convenience, not authority (DEC-424).

- Templates seeded at launch: Owner, Admin, and drafts for Plant
  Administrator, Accountant, Fuel Operator, Project Engineer, Report Viewer,
  and Custom. Only Owner and Admin are assigned initially.
- Assigning a template copies its permissions into the user's effective set
  at assignment time. The template name is stored so the Owner can see it,
  but **the name never controls access** — the effective set does.
- Editing a template does not silently re-flow to existing users. The Owner
  is shown which users hold that template and what would change, and
  applies it explicitly per user, creating an audit event.
- **New modules never arrive silently (DEC-425)**: when DROMEX gains a
  module, its permission keys are added to the catalog **ungranted**. No
  template and no user receives them automatically. The Owner grants them
  deliberately.

## 8. Permission blocks

Permissions name protected business actions, not screens, in the form
`module.action`. Absence means denial. Each split below passed the test:
*could a real DROMEX person reasonably be allowed one action and not the
other?*

| Module | Permission keys | Project-scoped? |
|---|---|---|
| Projects | `projects.view`, `.create`, `.edit`, `.complete`, `.reactivate` | view/edit |
| Company Loads | `loads.view`, `.create`, `.confirm`, `.correct`, `.cancel`, `.print`, `.view_prices`, `.manage_prices` | ✅ |
| Supplier Loads | `supplier_loads.view`, `.create`, `.correct`, `.cancel`, `.reactivate`, `.print`, `.view_prices`, `.manage_prices` | ✅ |
| Fuel Ledger | `fuel.view`, `.record_fill`, `.record_delivery`, `.record_gauge`, `.correct`, `.cancel`, `.view_prices`, `.manage_prices` | ✅ fills |
| Daily Reports | `daily_reports.view`, `.create`, `.edit`, `.export`, `.view_prices` | ✅ |
| Business Reports | `business_reports.view`, `.export`, `.view_prices` | ❌ cross-project |
| Financials | `financials.view`, `.view_prices`, `.export` | ✅ |
| Payments | `payments.view`, `.record`, `.cancel` | ✅ |
| Customers | `customers.view`, `.create`, `.edit`, `.deactivate`, `.merge`, `.view_balances` | ❌ |
| Suppliers | `suppliers.view`, `.create`, `.edit`, `.deactivate`, `.merge`, `.view_balances` | ❌ |
| Workers and Drivers | `people.view`, `.create`, `.edit`, `.deactivate` | ❌ |
| Trucks and Machines | `equipment.view`, `.create`, `.edit`, `.deactivate` | ❌ |
| Catalog | `catalog.view`, `.create`, `.edit`, `.deactivate` | ❌ |
| Units and Conversions | `units.view`, `.manage` | ❌ |
| Waste Dumps | `waste.view`, `.record`, `.cancel` | ✅ |
| Walls | `walls.view`, `.record`, `.edit` | ✅ |
| Pavement | `pavement.view`, `.calculate`, `.export` | ✅ |
| Schedule | `schedule.view`, `.manage` | ✅ |
| PDF Settings | `pdf_settings.view`, `.manage` | ❌ |
| Company Settings | `company_settings.view`, `.manage` | ❌ |
| Backup and Restore | `backup.create`, `.restore` | ❌ |
| Exports | inherits per module `.export`/`.print` | ✅ inherits |
| User and Permission Administration | `users.view`, `.create`, `.edit`, `.disable`, `.manage_permissions`, `.manage_sessions`, `security.view_audit`, `security.manage` | ❌, Owner-only at launch |

Actions deliberately merged rather than split, with reasons: *Edit* and
*Correct* are distinct only where the record is confirmed (loads, supplier
loads, fuel); *Print* merges into *Export* except for loads, where a
reprint carries the COPY marking of DEC-386; *Confirm* exists only for
company loads, the one workflow with a real draft-to-confirmed transition;
*Manage settings* is per-module so PDF Settings can be granted without
Company Settings.

### Worked example: Plant Administrator

Template grants: `loads.view/create/confirm/print`; `fuel.view/record_fill`;
`projects.view`; `equipment.view`; `catalog.view`; `units.view`;
`people.view`. Not granted, therefore denied: everything in Daily Reports,
Business Reports, Financials, Payments, User Administration, Backup and
Restore, PDF Settings, Company Settings, Supplier Loads, Waste, Walls,
Pavement, Schedule, every `view_prices`/`manage_prices` key,
`loads.correct/cancel`, `fuel.record_gauge/record_delivery/correct/cancel`.
Project scope: the plants they actually run. **Price visibility is fully
separate from fuel or load entry** — they record a load without ever seeing
its value; **correction, cancellation, confirmation, gauge readings,
fuel-price management, and transaction creation are each independently
assignable**, satisfying the requirement directly.

The Owner opens this profile and sees the assigned template, which
permissions came from it, which were added individually with reason and
date, which were revoked individually with reason and date, the project
scope, a plain-language effective-access summary, and who last changed
access and when.

## 9. Per-user override model

**Effective permissions = (template grants ∪ individual grants) −
individual revocations**, filtered by project scope for scoped permissions.
Deny by default: anything not in the result is denied (DEC-424).

- Every override records the permission key, grant or revoke, the reason
  the Owner typed, who made the change, and when.
- **An individual revocation always wins over a template grant.** This is
  the only form of denial in the model — there are no general explicit-deny
  rules, kept out deliberately to keep the model simple.
- Because `users.manage_permissions` is Owner-only at launch, an Admin
  cannot restore a permission the Owner revoked; that is structurally true
  today. When it is ever delegated, an Owner-created override must
  additionally be marked Owner-locked and unmodifiable by a non-Owner.
- Computation happens in one function, in one module, used by every caller
  — no second implementation in the UI, a query, or SQL.
- **Sensitive changes revoke sessions (DEC-427)**: any revocation, template
  change, project-scope narrowing, or disabling calls
  `revokeUserSessions()` for that user.

## 10. Project-scope model

- A user is either unscoped (every project, present and future) or scoped
  to an explicit list. An empty scoped list means no projects — deny by
  default holds even here.
- Scope applies only to project-scoped permissions. Reference data —
  catalog, units, equipment, people — is never project-scoped, because a
  scoped user still needs to resolve an item name to record a valid load.
- **Enforcement happens on the record, never on a client-supplied request
  parameter.** The record is loaded, its true `project_id` is read from the
  database, and that value is checked. This single rule is what prevents
  IDOR (DEC-428).
- New projects do not flow to scoped users automatically, following the
  same principle as new modules.
- Cross-project aggregate reports require an unscoped permission, because an
  aggregate that silently drops out-of-scope rows would mislead the reader.
- Historical attribution ignores scope. Removing a project from a user's
  scope hides it going forward; it never erases their name from records they
  created.

## 11. API enforcement design

**Browser pages and hidden buttons are never a security boundary (DEC-409).
Every protected API route or use case must explicitly declare and enforce
its own authorization policy; there is no route that is protected "by
default" through some other route's check (DEC-428).**

Fastify `preHandler` hooks, layered in order:

1. **Authentication** — resolve the session from the cookie via
   `auth.api.getSession()`. No session, no access.
2. **Account status** — the user must exist, be enabled, and be
   MFA-enrolled, read fresh from the database on every request. A disabled
   user with a valid cookie is refused here, which is what makes revocation
   immediate.
3. **Effective permissions** — computed by the one function from §9,
   attached to the request.
4. **Permission requirement** — `requirePermission('loads.confirm')`.
   **Route registration is default-deny: a route that has not declared
   either a required permission or an explicit public-route allowlist
   entry fails at server startup, not at request time.** A small number of
   routes are genuinely public before authentication exists at all —
   `/health` and `/ready` are the only ones today — and these must be
   **explicitly named on an allowlist**, never merely left undeclared;
   "undeclared" and "intentionally public" are not the same state, and the
   startup check must be able to tell them apart.
5. **Record load and scope check** — for any operation on an existing
   record, the service loads it, reads its true `project_id` **from the
   database**, and checks that stored value against the caller's scope
   before acting. A project or record identifier supplied by the client is
   never trusted as the basis for a scope decision — only the value
   already stored on the server-side record is.

Enforcement lives at the **service/use-case boundary**, not only the route,
so a future synchronization endpoint, background job, or Android sync path
reaching the same use case inherits the same check rather than needing a
second copy — the deep-module shape the installed `codebase-design` skill
describes, mirroring the existing Android `LoadRepository` interface /
`SqliteLoadRepository` implementation split.

Stable identity per DEC-410: server-minted rows use PostgreSQL 18's native
`uuidv7()`. The Android `makeId` helper (`Date.now()` base-36 plus
`Math.random()`, duplicated across `SqliteLoadRepository.ts:74`,
`SqliteCatalogRepository.ts:30`, `SqliteProfileRepository.ts:52`,
`SqliteProjectReportRepository.ts:21`, `SqliteQuarryRepository.ts:31`) must
not be reused for server rows — it is not collision-resistant across
devices.

Errors are generic to the user, detailed to the log, with a correlation ID
— the pattern already implemented and tested on `/ready`. 403 and 404 are
deliberately indistinguishable for records outside a user's scope, so scope
cannot be used to enumerate what exists.

### Implemented transport (Phase 2C checkpoint 3D, local development only)

Status: **implemented and verified against disposable PostgreSQL 18.6
databases; not production-ready.** MFA, Owner bootstrap, permissions, account
management, and the frontend are not implemented.

**Exact route surface.** Three authentication routes exist, and nothing else:

| Method | Path | Classification |
|---|---|---|
| `POST` | `/api/auth/sign-in/email` | `guest-only` |
| `POST` | `/api/auth/sign-out` | `session-cleanup` |
| `GET` | `/api/session` | `authenticated` |

There is **no catch-all route**. Better Auth's documented Fastify integration
mounts a handler at `/api/auth/*`; DROMEX deliberately does not. Each approved
route forwards to one fixed Better Auth path, so a client query string or path
suffix never reaches Better Auth. Any other path — sign-up, raw `get-session`,
password reset, account updates, provider or plugin routes — is answered by a
generic 404 that never touches Better Auth. `/health` and `/ready` remain
explicitly `public`.

**The active principal is enforced twice.**

1. *At issuance.* A `session.create.before` database hook, built into
   `createAuthOptions` so that no construction path can omit it, returns
   `false` unless the user has an active principal. Better Auth then aborts
   the insert, so a user with a missing or disabled principal is never issued
   a session: the row is never written, rather than written and hidden. A
   failed lookup throws, which also aborts.
2. *On every request.* The request-time guard resolves the session and then
   requires an active principal from PostgreSQL. Missing, malformed, expired,
   revoked, orphaned, and disabled-principal sessions all receive one
   identical `401`.

**Session resolution bypasses Better Auth's router.** Sessions are resolved
with `auth.api.getSession({ headers, asResponse: true })` rather than through
the HTTP router, so an authenticated request neither consumes a rate-limit
bucket nor writes a rate-limit row, while refresh and expiry `Set-Cookie`
headers are still forwarded.

**Raw Better Auth output is never returned.** `/api/session` returns exactly
`{ "user": { "id", "name", "email" }, "isOwner" }`. The sign-in body is
replaced with `{ "authenticated": true }`, because Better Auth's own body
carries the session token.

**Sign-in failures are normalised.** Unknown email, wrong password, missing
principal, disabled principal, malformed input, and a refused Origin all
return `401 { "error": "invalid_credentials" }` with no cookie. A rate-limited
attempt returns `429 { "error": "too_many_requests" }` with a standard
`Retry-After` header; the transport forwards it only when it is an integer
from 1 to 3600 and never forwards Better Auth's `X-Retry-After`. Timing
equivalence has **not** been measured.

**Client address.** The transport discards every client-supplied address
header (`x-forwarded-for`, `x-real-ip`, `forwarded`, `cf-connecting-ip`,
`true-client-ip`, and similar) and sets `x-dromex-client-ip` from Fastify's
socket address, with `trustProxy` disabled. Better Auth is configured to read
only that header. Trusting a reverse proxy is deferred until one exists and
can be configured to overwrite forwarded headers.

**CSRF boundary.** Better Auth's Origin checks protect sign-in whenever an
Origin, Referer, Fetch Metadata header, or cookie is present. Sign-out has its
own DROMEX exact-match Origin check against the trusted origins, because
Better Auth skips its check when no cookie is sent; a missing, opaque
(`null`), or untrusted Origin receives `403` before Better Auth is reached. No
general DROMEX Fastify-level Origin policy exists yet; one is required before
the first state-changing DROMEX business route.

**Configuration fails closed.** `buildServer` requires explicit
authentication settings and a database URL. The executable entry point reads
them once from the environment through a validated boundary whose errors name
variables, never values. `web/.env.example` leaves the secret empty, so the
API refuses to start until a real one is set. The local Docker Compose `api`
service does not yet supply these variables and will not start until it does;
that file is unchanged.

**Sign-out is security cleanup (Owner decision, 2026-09-13).** It is
classified `session-cleanup`, a fourth route classification that the
request-time guard lets through without resolving a session or principal.
This is deliberate: sign-out only destroys the caller's own authentication
state and reveals nothing, so a user whose principal is disabled or missing
must still be able to revoke their session. Better Auth revokes the session
named by the caller's own signed cookie (never another user's) and expires the
session cookies. The response is one generic `200 { "signedOut": true }` with
cookie-clearing headers whether the session was valid, expired, malformed,
missing, already revoked, or belonged to a disabled or missing principal. A
failed revocation is reported as `500`, never as success. `GET` is `404`.
This does **not** widen access anywhere else: a missing or disabled principal
still receives `401` from `/api/session` and from every `authenticated` route.

### Owner provisioning tooling (Phase 2C checkpoint 3E, disposable databases only)

Status: **implemented and tested against disposable PostgreSQL 18.6 databases
only. Not approved for real use.** No Owner exists, and none may be created
until mandatory MFA and recovery are implemented and separately approved
(DEC-421, DEC-423). Owner readiness enforcement — refusing an initialised
system that has no Owner, and refusing removal or demotion of the Owner —
remains **unimplemented**.

**A local, interactive command; never HTTP.** The Owner is created only by
`apps/api/src/provisioning/owner-command.ts`, run by a person at a terminal.
There is no setup route, no temporary bootstrap website, no public
registration, no default Owner, and no shared credential. A test walks the
server's import graph and proves no provisioning module is reachable from
`server.ts`, and the complete route table is asserted unchanged.

- The only accepted input is `--database-url-file <path>` (and `--help`). A
  password or connection string given as an argument is refused and never
  echoed; the environment is never read, so it cannot supply either.
- **Pre-MFA gate.** Every run except `--help` is refused with "Production
  Owner provisioning is unavailable until mandatory MFA and recovery are
  implemented and approved", exit status 1, before any file is read, any
  prompt is shown, or any connection is opened. No flag, environment variable,
  or hidden switch enables it: enabling it is a reviewed code change in a
  later, separately approved checkpoint. The service below is exercised only
  by automated tests against disposable databases.
- **Hidden prompt** (`terminal-prompt.ts`, Node's own raw-mode TTY only, no
  dependency). The password and its confirmation echo nothing at all, not
  even a mask character, so neither the password nor its length reaches the
  screen. Password-manager paste works, including bracketed-paste markers;
  backspace and delete work; terminal escape sequences are discarded; Ctrl+C
  or Ctrl+D cancels, empties the per-character buffer, and restores the
  terminal. It refuses when input or output is not a terminal, and there is
  no piped-input fallback. *Honest limit:* a JavaScript string cannot be
  zeroed, so the completed entry lives until garbage collection.

**Provisioning-only Better Auth instance** (`owner-identity.ts`). It lives
outside `src/auth/`, reads no environment value, is mounted on no route, and
is constructed from exactly the runtime options with three differences, each
required to create the first Owner and nothing else:

1. `disableSignUp: false`, because `signUpEmail` is Better Auth's documented
   way to create an email/password identity. `autoSignIn` stays `false`, so
   creation issues no session.
2. Its session hook admits exactly one kind of session: the one requested to
   verify an orphaned identity (below), for that identity only, and only
   while it has no principal. Every other session is refused.
3. Better Auth's logger is disabled, so a database error carrying row data is
   never printed to the operator's terminal.

The runtime `createAuthOptions` keeps `disableSignUp: true` in every
environment and cookie setting, which is asserted.

**The transaction boundary, stated honestly.** Better Auth identity creation
and the DROMEX Owner principal insert are **not one transaction**. Verified
2026-09-13 against the installed 1.7.4 source: `signUpEmail` creates the
`user` and `account` rows inside `runWithTransaction(ctx.context.adapter, …)`;
the Kysely adapter opens that transaction on a connection it takes from the
pool it was configured with; and the AsyncLocalStorage store that carries it
is marked internal in `@better-auth/core`. Better Auth's official
email/password, server-API, and database documentation (accessed 2026-09-13)
describes no way to hand `auth.api` a caller-controlled transaction. DEC-426
and the table in §6 call this mechanism the "bootstrap transaction"; the
honest description is two commits — Better Auth's, then DROMEX's — made
recoverable by the workflow below. That is a precision correction of wording,
not a change of policy.

**Workflow** (`owner-provisioning.ts`):

1. The name, email, password length (15 to 128, measured as Better Auth
   measures it), and confirmation are validated before any connection opens.
   The email is trimmed and lower-cased; the password is used exactly as
   entered, consistent with the existing hashing policy.
2. `pg_try_advisory_lock` on a fixed key (distinct from the migrator's) is
   taken on one dedicated connection and held for the whole run. If another
   run holds it, provisioning refuses immediately and changes nothing.
3. An existing Owner refuses the run before Better Auth is asked anything.
4. An existing Better Auth identity with that email that this workflow did
   not start is refused, so no foreign identity can be adopted. This matters
   because, with `autoSignIn: false`, Better Auth answers a duplicate
   sign-up with a synthetic success rather than an error; after creation the
   returned id is also confirmed against a real row.
5. A singleton intent row (`dromex_owner_bootstrap`, DROMEX migration `0003`)
   is written as `pending_identity` before `signUpEmail` is called, then
   moved to `identity_created` with the new user id.
6. One DROMEX transaction confirms the identity has no session, inserts the
   active `is_owner` principal — under the unchanged partial unique index —
   and deletes the intent. That commit alone makes an Owner.

The intent table stores only state, the normalised email, the user id, and
timestamps. A `CHECK` allows only the value `TRUE` as its key, another allows
only the two states, a third ties each state to the presence or absence of
the user id, and the email must be lower-case. Its foreign key to `user` is
`RESTRICT`.

**Interruption and orphan reconciliation.**

| Interrupted | Left behind | Retry, same email and password | Retry, different email | Retry, wrong password |
|---|---|---|---|---|
| Before Better Auth creation | `pending_identity` intent, no identity | Creates the identity and completes | Refused, nothing changes | Nothing to verify; creates the identity with the password given |
| After Better Auth creation, before the user id is recorded | `pending_identity` intent and an orphaned identity with no principal | Better Auth verifies the password, then completes | Refused, nothing changes | Refused, nothing claimed |
| After the user id is recorded, including a failed principal insert (rolled back) | `identity_created` intent and an orphaned identity | Better Auth verifies the password, then completes | Refused, nothing changes | Refused, nothing claimed |
| After the Owner commit | An Owner; no intent | Refused: an Owner exists | Refused | Refused |

An orphan is claimed only after `auth.api.signInEmail` succeeds for that
identity. The session that sign-in issues is revoked immediately with
`auth.api.signOut` using Better Auth's own signed cookie, and the Owner commit
refuses to proceed if any session for the identity remains. A second Better
Auth identity is never created to work around an orphan, and an orphan is
never deleted.

**No DROMEX SQL mutates a Better Auth-owned row.** Provisioning only *reads*
`user` (by email) and `session` (a count). Identity creation, sign-in, and
revocation go exclusively through Better Auth's documented server API. This
is asserted twice: by scanning every provisioning module for mutating SQL
against Better Auth tables, and by recording every statement sent on
provisioning's own connections during a real run.

**Email delivery.** Initial Owner creation needs none. OQ-161 remains open and
still gates Admin invitations and self-service password recovery, neither of
which exists.

**Known limits, not yet addressed:**

- Verifying an orphan's password calls `auth.api.signInEmail` directly, which
  Better Auth's HTTP rate limiter does not cover. Reaching it requires local
  execution and database access, which already exceed what the check
  protects; it is recorded rather than assumed away.
- The advisory lock is session-scoped to one connection, while Better Auth
  works on others. If that connection were lost mid-run, a second run could
  begin while a Better Auth call was still in flight. Better Auth's unique
  email, the singleton intent, the post-creation identity confirmation, and
  the single-Owner index still bound the outcome to at most one identity per
  email and at most one Owner, but that scenario is not covered by a test.
- The interactive prompt and the service are each tested, but the command is
  not yet wired to them; that wiring belongs to the checkpoint that enables
  real use after MFA.
- The comment in the already-applied migration `0001` still describes the
  bootstrap as unimplemented. Applied migrations are never edited (their
  checksum is enforced); this section supersedes that comment.

Sources, accessed 2026-09-13: Better Auth documentation
<https://www.better-auth.com/docs/authentication/email-password>,
<https://www.better-auth.com/docs/concepts/api>, and
<https://www.better-auth.com/docs/concepts/database>; installed package
source `better-auth@1.7.4` (`dist/api/routes/sign-up.mjs`, `sign-in.mjs`,
`sign-out.mjs`, `dist/api/index.mjs`), `@better-auth/core@1.7.4`
(`dist/context/transaction.mjs`), and `@better-auth/kysely-adapter@1.7.4`
(`dist/index.mjs`).

## 12. PostgreSQL security and the row-level-security decision

**Row-level security will not be used in the first release (DEC-429).**
RLS would let PostgreSQL enforce project scope itself, which is genuinely
attractive. Against it, specifically: the application connects as one
runtime role, so RLS needs `SET LOCAL app.current_user_id` correctly on
every transaction — miss it once and policies fail open or fail closed,
silently; it duplicates the authorization computation of §9 in a second
language, and two implementations of one rule drift; there is exactly one
data path today (DEC-406's architecture diagram is explicit that neither
client touches PostgreSQL directly), so RLS defends against a second path
that does not exist yet. **Revisit immediately if any second data path
appears** — a reporting user, a BI tool, or any service connecting with its
own credentials.

Instead, database-level protection comes from least-privilege roles,
building on what `postgresql-strategy.md` already documents. Precise
wording matters here: these roles are an **independent safeguard against
ordinary application defects** — a bug in the API code cannot use them to
delete an audited row or alter the schema, because the credential the
running application holds is simply not granted that power. They are not a
defense against a privileged database administrator or a compromised
database superuser, who can alter roles, grants, or data directly; that
threat is addressed by restricting who holds production database access
and by the operational controls in §3 (items 22–23), not by the grants
themselves.

- **Migration owner** — DDL, used only by migrations. **The application's
  own runtime role must never hold this — it must not own the schema and
  must not be able to run DDL.**
- **Application runtime** — `SELECT`, `INSERT`, `UPDATE` only. No DDL, no
  `DELETE` on audited business tables.
- **Audit events get `INSERT` and `SELECT` only** — no `UPDATE`, no
  `DELETE`, for the application runtime role specifically. See §13 for the
  precise, non-absolute wording this guarantee is stated in.

## 13. Security audit model

Per DEC-411 and DEC-430, the existing Android `correction_history_json`
representation is preserved unchanged, and a separate `audit_event` table
is added alongside it. **Precise wording for what "append-only" means
here**: the table is append-only *to the application's own runtime
database role* — that role's grant permits `INSERT` and `SELECT` only, so
the running application, including a buggy or compromised version of it,
cannot alter or erase an entry. It is **not** immutable in an absolute
sense: a privileged database administrator, or anyone who obtains
superuser access to the PostgreSQL instance, can still alter or delete
rows directly. That risk is addressed by restricting who holds production
database access, by encrypted off-site backups (which preserve a copy
independent of live alteration), by monitoring, and — optionally, for a
stronger guarantee — by streaming audit events to an external,
write-once destination outside the application's own database, which is
not part of this design but is not precluded by it either.

`audit_event`: `id uuidv7`, `occurred_at timestamptz`, `actor_user_id`,
`actor_name_snapshot` (so a later rename never rewrites what an entry says
happened), `event_type`, `target_type`, `target_id`, `project_id`
(nullable), `outcome`, `permission_key` (nullable), `permission_version`,
`ip_address`, `user_agent`, `reason` (nullable), `detail_json` (nullable),
`correlation_id`.

Events recorded: authentication (sign-in, MFA challenge, enrolment, Owner
MFA reset, recovery-code use and regeneration, password change/reset,
sign-out, session revocation, rate-limit lockout); accounts and permissions
(user created/edited/disabled/re-enabled, template assigned or changed,
individual grant/revoke, project scope changed, Owner-protection
rejection); business events required by DEC-411 (export, payment
recorded/cancelled, record corrected/cancelled/reactivated, backup
created, restore performed); denied sensitive actions only, not routine
denials.

**Never recorded, under any circumstance**: passwords, password hashes,
session tokens, TOTP secrets, recovery codes, `.env` values, database
credentials, or full record payloads containing them. Denied to `UPDATE`
and `DELETE` by database grant for the application's own runtime role
(§12) — an independent safeguard against an application defect, not a
guarantee against a privileged database administrator.

## 14. Owner recovery: the verified design

**This section records an approved decision (DEC-423), not an open
question.** It follows the Owner's explicit direction: a secure combination
of single-use recovery codes stored securely outside the application, and a
documented, audited emergency recovery procedure — preserving exactly one
protected Owner, with no permanent second Owner and no weakening of the
single-Owner rule.

**This section describes a future, Owner-operated production procedure.
Claude is never authorized to execute any part of this procedure against
the VPS or a production database, under any circumstance, at any future
date, regardless of how this document or a future request phrases the
request. Nothing in this document constitutes standing authorization for
that.** Building the tooling described below (as version-controlled code,
reviewed like any other change) is in scope for a future implementation
phase; *running* it against production is an Owner action.

### What is verified capability (§5) versus what DROMEX must build

Better Auth's `twoFactor` plugin generates 10 single-use backup codes at
enrolment, deletes and reissues them on regeneration, and requires a fresh
session to view them — all verified. It does **not** provide: hashed
storage of those codes (the default is plaintext; the strongest built-in
option is reversible encryption in every configuration, including a custom
encryptor — never a one-way hash, confirmed by checking the documented
`storeBackupCodes` values directly, since no `"hashed"` value or hash-based
verification path exists), any admin-side function to reset another user's
TOTP enrolment, or any concept of a protected super-admin role. Those gaps
are exactly what the Owner recovery design has to close, because the Owner
has no one above them to perform an admin-side reset.

### The design

1. **Recovery codes, stored outside the application.** At Owner setup, the
   ten Better Auth backup codes are displayed once, with an explicit
   acknowledgement step, and the Owner prints or writes them and stores
   them in a sealed physical location outside any computer system — a
   safe or an equivalent the Owner controls. `storeBackupCodes` is
   configured to `"encrypted"` rather than the default `"plain"` (DEC-423).
   This is recorded honestly as **encryption, not hashing** — reversible
   with the Better Auth secret, which is a real limitation Better Auth
   does not offer a way around, not a claim that it is equivalent to a
   one-way hash. The design does not depend on the database copy for
   Owner recovery in any case, because a database compromise should not
   also be a recovery-path compromise: the codes' *authoritative* copy,
   for Owner-recovery purposes, is the sealed physical copy, never the
   database row.

2. **A documented, tested, narrowly scoped break-glass administrative
   procedure** — not ad hoc manual SQL run by hand at the moment of need —
   for the case where the Owner has lost both the authenticator device and
   the sealed codes. Because Better Auth provides no admin-side TOTP-reset
   function and `twoFactor.disable()` requires an existing valid session
   the Owner would not have, closing this gap requires direct
   administrative action against the database. The production
   implementation of that action must be a **version-controlled
   administrative command or runbook**, reviewed and stored in this
   repository like any other operational tooling, that:

   - **targets exactly one protected Owner account** — it must not accept
     an arbitrary user ID as a parameter, or otherwise be usable against
     any account but the single row where `is_owner = true`;
   - **requires direct server-administrator authority to invoke** — it is
     not exposed through any application API, admin UI, or user-facing
     surface;
   - **verifies the expected Better Auth schema and version before acting**
     and refuses to proceed if either does not match what it was written
     and tested against, rather than assuming compatibility;
   - **operates transactionally** — the MFA-clearing change, the session
     revocation in the next bullet, and the audit-event write all commit
     together or not at all;
   - **invalidates every existing session belonging to the Owner** as part
     of the same operation, so a locked-out state is not replaced by a
     stale valid session existing somewhere;
   - **forces MFA re-enrolment at the Owner's next successful login** —
     the account is left able to sign in with a password but unable to
     do anything else until a fresh TOTP factor is enrolled, mirroring the
     restriction DEC-421 already applies to every newly created account;
   - **writes a dedicated, distinct `audit_event` row** (a type such as
     `owner_emergency_mfa_reset`, distinguishable from routine MFA resets)
     in the same transaction where the database technically supports it,
     naming who performed the action and when, so its use is never silent
     and never merely implied by its effects;
   - **prints or logs no secret, password, recovery code, or session token**
     to any terminal, console, or log destination at any point;
   - **requires an explicit typed confirmation** before acting (not a
     single flag or a default-yes prompt) and is paired with a **written
     incident record** — a short, dated note of why it was invoked, kept
     with the runbook's own history — for every real use;
   - **is rehearsed only against a disposable or test database** before
     it is ever relied upon in production, the same way the restore
     procedure in `backup-and-recovery.md` must be proven with a real
     restore before being trusted.

   **No UI reset button exists or is proposed for this.** The absence of a
   convenient path is deliberate: this procedure is meant to be visible,
   deliberate, and rare, not a normal support workflow that could be
   reached for casually.

3. **The single-Owner rule is untouched.** Nothing in this design creates a
   second Owner-equivalent account, permanently or temporarily. The database
   constraint from DEC-426 continues to guarantee **at most** one row with
   `is_owner = true` throughout (see §6 for why "at most" is the precise
   word), and the break-glass procedure above never creates, promotes, or
   substitutes a second account to work around that constraint.

### What this deliberately does not decide

The exact operational form of the procedure beyond the properties listed
above — who beyond the Owner may ever be authorized to invoke it, what
identity verification precedes it, and where the runbook and its incident
records are stored — is implementation detail for the phase that builds
and tests it, not for this documentation pass. What is decided now is the
shape: physical-custody codes as the first line, a version-controlled,
tested, transactional, audited administrative procedure as the last
resort, and the single-Owner rule never bent to provide either.

## 15. Future Android authentication and synchronization

Nothing here is implemented, and none of it may be built before the central
schema and API rules are approved and stable. This is the forward plan the
present design must not foreclose.

A restricted web user creating an authoritative record (e.g. a Plant
Administrator recording a fuel fill) is authenticated by session, checked
for `fuel.record_fill` and project scope, and validated by **the same
business rules Android applies** — which is exactly why OQ-159 (sharing
domain rules without a forked copy) must close before this is built, since
a second diverging copy of the fuel rules would be a correctness and
security problem. The record links to stable project, equipment, supplier,
fuel-type, and user IDs and carries audit data naming the actor.

**Android authentication model — OQ-162, not decided here.** Two options
exist: a cookie-based session honoured by a WebView or native client, which
keeps the browser security model intact; or Better Auth's bearer plugin,
with the token held in Android's encrypted storage. Bearer mode genuinely
changes the model: it removes CSRF as a concern, because there is no
ambient credential a hostile site can ride, and introduces
token-theft-by-local-compromise, because the token is now a value the app
holds rather than a cookie the platform holds. On a device with a
hardware-backed keystore this is a reasonable trade; in a browser it is
not, which is why bearer tokens are never used in the browser (§5).

Synchronization builds on what already exists: the `sync_outbox` table
(`src/data/database/migrations.ts:76-84`) and its same-transaction write
pattern (`SqliteLoadRepository.ts:385-439`) are reusable as-is. What must
be added: a durable client-generated `mutation_uuid` per mutation,
server-side idempotency keyed on it, and a sync cursor. Conflicts are
explicit, never blind last-write-wins, for payments, corrections,
cancellations, and confirmed records (DEC-412); a stale mutation is
rejected and the client refreshes and re-applies. Transaction numbering
follows DEC-413 exactly: existing numbers preserved, the server issues
numbers for web-created records, Android keeps its device-coded local
sequence until the sync phase, collisions go to explicit reconciliation.

**Offline revocation — OQ-163, not decided here.** A revoked or disabled
user's device fails authentication at the sync boundary, and queued
offline mutations are rejected rather than silently merged. Whether that
rejection is final or whether rejected work is quarantined for Owner
review is a business-policy choice for the Owner to make when this phase is
scoped, not before.

## 16. Daily Report and fuel historical-boundary analysis

**OQ-164, not decided here** — recorded because the risk must be understood
before any linkage code is written, not because an answer is being chosen.

Fuel linked to a project and a work date can flow into that day's Daily
Report. DROMEX already supports past-date entry (DEC-382). DEC-403
establishes that global header values and project descriptive information
are read live at generation time, while confirmed transaction records —
`loads`, `quarry_purchases`, `fuel_movements`, `quick_text_documents` — are
snapshotted at confirmation.

**The problem**: a Daily Report today has no finalized state. Once web
users exist, a Plant Administrator can record a fuel fill dated for a day
whose Daily Report was already generated, signed, and issued to a ministry
or consulting agency. Regenerating that PDF would then produce a document
that differs from the one already in someone else's hands — a silent
rewrite of an issued business document, which operating rule 7 forbids.
Today this risk is contained because one person controls both entry and
report; multi-user web entry removes that containment.

**DEC-432 is confirmed as an interim guardrail, not the final answer**:
automatic linkage of late-arriving records into an already-generated Daily
Report shall not be implemented until a finalization or snapshot rule is
confirmed under OQ-164. It exists only to stop the unsafe automatic version
from being built by default while OQ-164 remains open.

**Recommended final direction for OQ-164**, recorded here for the Owner to
confirm rather than decided unilaterally: once issued, a Daily Report
becomes an **immutable snapshot** — the exact content delivered is fixed at
the moment of issuance and a later regeneration reproduces that same
content, never a live-recomputed one. A late-arriving record never
silently alters an already-issued report's content. Where a genuine
correction is needed after issuance, it is made by creating an **explicitly
numbered and audited revision** of the report — Revision 1, Revision 2, and
so on — each one itself an immutable snapshot from the moment it is issued,
with the audit trail from §13 recording who created each revision, when,
and why. This preserves every version a Daily Report ever had rather than
overwriting one with another, extending the same never-silently-rewrite
principle DEC-403 and DEC-416 already apply elsewhere in the product,
rather than introducing a new one. This is a recommendation, not a
decision: OQ-164 remains open until the Owner confirms this direction or
chooses one of the other two shapes considered during research — an
explicit "recorded after this report was issued" addendum section with no
locking at all, or a simpler warn-and-refuse guard on past-dated entry with
no revision concept.

## 17. Authentication and permission-management UX

Grounded in `DESIGN.md` — the "Foreman's Field Ledger" system — reusing
existing tokens rather than inventing a parallel visual language. **No UI
code exists.** DESIGN.md documents a measured contrast issue (`warning`
text on `#FFF3D8` at 4.49:1, below AA); new security screens must not
replicate that pairing.

| Screen | Design intent |
|---|---|
| Sign-in | Cream page, navy header, two fields, one orange action. Identical response and timing for a wrong password and a non-existent account. `autocomplete` set for password managers. No sign-up link. |
| First-time Owner setup | One-time bootstrap: set password, enrol MFA, acknowledge and store recovery codes. Not skippable; the route no longer exists afterward. |
| Admin invitation | Owner creates the account and chooses a template; the invited user receives a single-use, short-lived link to set their own password. The Owner never sees or sets another person's password. |
| MFA enrolment | QR code plus the secret as selectable text; a verification field proving the authenticator works before enrolment completes. |
| MFA verification | One six-digit field, `autocomplete="one-time-code"`; a quiet secondary link to use a recovery code instead. |
| Recovery codes | Full-width monospace list; copy and print actions; a required "I have saved these codes" checkbox; shown once; regeneration states plainly that the old codes stop working immediately. |
| Password recovery | Always the same message whether or not the address exists; single-use, short-lived, rate-limited link. |
| Session expiration | A calm inline notice, not a modal; typed work is preserved and re-submitted after re-authentication wherever possible. |
| Device and session management | One card per session: device, browser, IP, first/last seen; each carries a clearly separated "Revoke this session"; one "Sign out everywhere." |
| Owner user management | Account cards: name, template, status, MFA state, last sign-in. |
| Role-template selection | Shows exactly which permissions the template will grant, grouped by module, before saving. |
| Permission blocks | Grouped by module, closed-by-default expandable sections, matching the DROMEX house pattern; each permission labelled as a business action. |
| Per-user overrides | Each permission shows its provenance inline — from template, added by Owner, or revoked by Owner, with reason and date. |
| Project scope | Searchable project list, All / Selected; selecting Selected with nothing chosen shows an explicit warning. |
| Effective-access summary | Plain prose, not a matrix — the single most important screen: if the Owner cannot tell at a glance what someone can do, the permission model has failed regardless of its correctness. |
| Account disabling | Confirmation naming the person and the consequences: signed out everywhere immediately, historical records keep their name; requires a typed reason. |
| Security-event history | Reverse-chronological, filterable; each entry reads as a sentence. |
| Loading, error, lockout, empty, offline, maintenance | Every one explicit; lockout states say when access returns, never why the attempt failed; offline states say plainly the web app requires a connection, unlike Android. |

Tone: calm and trustworthy, no alarming iconography, no red unless
genuinely destructive, no gradients or glass, no decorative animation.

## 18. Accessibility requirements

- Responsive across phone, tablet, desktop.
- Fully keyboard operable; logical tab order; no traps; Escape closes
  dialogs.
- Visible focus indicators, minimum 2px outline at 3:1 contrast, never
  removed for aesthetics.
- Screen-reader accessible: landmarks, labelled fields, errors associated
  via `aria-describedby`, `aria-live` for authentication results and
  lockout notices.
- Touch targets at least 44×44 CSS pixels, consistent with the existing
  48px button and 46px input heights.
- Password managers and autofill supported everywhere, including the TOTP
  field; no field-splitting of the six-digit code.
- `prefers-reduced-motion` honoured.
- Never colour alone — a disabled account shows a pill with text and
  shape, not a red dot.
- Contrast at WCAG AA minimum; the 4.49:1 warning-on-cream pairing
  documented in DESIGN.md must not be reused on security screens.
- No account-enumeration leak through accessibility surfaces either — the
  screen-reader announcement for a failed sign-in must be identical in
  both cases.

## 19. Complete testing strategy

Designed here, **not written and not run**. Following the installed
`test-driven-development` skill: each row below is a failing test before
any implementation exists.

| Area | What is tested | Needs |
|---|---|---|
| Login / logout | Correct credentials succeed; wrong password fails; non-existent account fails identically in body, status, and timing; logout destroys the server session | Real PostgreSQL |
| MFA enrolment and challenge | Enrolment requires verification; a user without MFA reaches only enrolment routes; a valid code succeeds; a stale or replayed code fails; the ±1 period window behaves as documented | PostgreSQL + controlled time |
| Recovery codes | Generated at enrolment; each works once; a reused code fails; regeneration invalidates the previous set; viewing requires a fresh session | PostgreSQL, controlled time |
| Password reset | Single-use, short-lived link; identical response for known and unknown addresses; reset revokes other sessions | PostgreSQL + captured email |
| Session rotation and expiry | New session ID on authentication; expiry and `updateAge` extension behave correctly | Controlled time |
| Session revocation | Revoke one leaves others alive; revoke-all kills every session; an Owner revoking another user's session takes effect on their very next request | PostgreSQL |
| Account disabling | A disabled user's existing session is refused immediately; their name still renders on historical records | PostgreSQL |
| Owner protection | An Admin cannot disable, demote, delete, or rename the Owner; the Owner cannot remove their own `users.manage`/`security.manage`; the single-Owner constraint rejects a second Owner | PostgreSQL |
| Role templates | Assignment copies the expected set; editing a template does not silently change existing users | PostgreSQL |
| Per-user grants/revocations | A revocation beats a template grant; every change writes an audit event | |
| Project scope | A scoped user reads only in-scope records; an out-of-scope record returns the same response as non-existent; aggregate reports require an unscoped permission | |
| Sensitive API permissions | Every sensitive endpoint refuses a caller lacking the permission; a route with no declared permission fails at startup | Startup test |
| Vertical/horizontal escalation | A restricted user cannot reach admin endpoints or alter their own permissions; a client-supplied project ID is never trusted over the record's own | |
| CSRF / CORS | Cross-origin state-changing requests without a valid Origin are refused; only the configured origin is allowed | Browser |
| Rate limiting | Sign-in and MFA limits trigger correctly and survive a process restart (proving database storage) | PostgreSQL |
| Account enumeration | Sign-in, reset, and invitation respond identically for known and unknown addresses, in body, status, and timing | Timing measurement |
| Cookie flags | `HttpOnly`, `Secure`, `SameSite=Lax`; no auth value in `localStorage`/`sessionStorage` | Real browser |
| Security headers | HSTS, CSP without `unsafe-inline`, nosniff, frame-ancestors none | Browser |
| Audit events | Each event type written with actor, target, timestamp, outcome; the table rejects UPDATE/DELETE at the grant level | PostgreSQL, least-privilege roles |
| Secret redaction | No password, token, session ID, TOTP secret, or recovery code appears in any log line | Log capture |
| PostgreSQL isolation | The runtime role cannot DDL or DELETE from audited tables | Real PostgreSQL |
| Backup and restore | A restore test that actually runs, not a documented intention | Full environment |
| Accessibility / responsive | Keyboard traversal, focus visibility, screen-reader labels, contrast, widths | Real browser |
| Android authentication | Deferred to the Android phase (OQ-162) | Device |
| Offline revocation | Deferred (OQ-163) | |
| Sync replay and idempotency | Deferred | |

Requiring real PostgreSQL: everything touching sessions, permissions,
audit, and database roles, via the existing Testcontainers lifecycle.
Requiring a real browser: cookies, CSRF, CORS, headers, accessibility, via
the existing Playwright setup. Requiring captured email: password reset and
invitation, via a local capture service, never a real provider in tests.
Per the installed `verification-before-completion` skill: no test is
described as passing without fresh command output in the same turn.

## 20. Backup, upgrade, rollback, and maintenance implications

Backup scope grows to include users, sessions, two-factor secrets,
recovery-code data, permission tables, and audit events. Because Better
Auth shares the application database, one PostgreSQL backup covers all of
it. **A backup now contains authentication material**, so backup encryption
moves from good practice to a requirement, with the key stored separately
from the backup. Restoring to an earlier point resurrects sessions valid at
that time and reverts permission changes made since; the restore runbook
must end with revoking all sessions and the Owner verifying every account's
effective access. **Upgrades become security maintenance**: Better Auth
supports only its latest version with no backported patches, so a defined
cadence — proposed monthly, plus immediate on any advisory touching an
enabled feature — is an operational commitment (DEC-431). Better Auth owns
only its own tables through its own CLI; DROMEX's business and permission
tables use a separate, independently versioned, forward-only migration
sequence, and the two are never merged. `src/data/database/migrations.ts`
stays untouched; Android is unaffected by everything in this document.
**OQ-158 is still open and now matters more**: the RPO/RTO targets now also
govern the ability to sign in at all.

## 21. Residual risks, stated plainly

Repeated here because they are the honest limits of this design, not
because they were solved above:

- A fully compromised administrator computer defeats most controls in this
  document.
- TOTP is phishable in real time; only a future WebAuthn phase closes this.
- A leaked backup is a total compromise of the business record.
- The Owner-recovery break-glass procedure (§14) is, by necessity, an
  administrative bypass of MFA — its existence is a deliberate trade
  against total lockout. It is designed to be version-controlled, tested,
  transactional, and audited rather than ad hoc, but it remains a real
  bypass, its production use is an Owner action Claude is never authorized
  to perform, and every use must always be loudly audited, never routine.
- Better Auth's own advisory history (10 published) shows a project under
  active, sometimes urgent, security churn. Not enabling the features
  those advisories concern reduces exposure to what has already been
  found; it does not prove the enabled surface has no undiscovered issues.
  The discipline in §20 — treating upgrades as security maintenance, not
  optional — is what keeps that risk from silently growing over time.

## 22. Proposed permanent-documentation plan — completed in this pass

This document is the dedicated file proposed for the material that exceeded
`security-and-accounts.md`. `docs/web/README.md`,
`docs/web/security-and-accounts.md`, `docs/web/postgresql-strategy.md`,
`docs/web/testing-and-production-readiness.md`, `requirements/decisions.md`,
`requirements/open-questions.md`, and `docs/claude-context.md` were each
extended in this same pass rather than duplicated — see the changed-files
list in the session record for exactly what moved where.

## 23. Bounded implementation phases

Each phase is independently testable, independently acceptable, and
**separately approved**. No phase may begin without Owner approval, and none
may be combined with another. This restates the phase list from the Gate A
research; nothing here has been approved to start.

| Phase | Scope | Gate to enter |
|---|---|---|
| Authentication foundation | Better Auth installed and configured; Argon2id; its own schema generated; cookie, CSRF, trusted-origin, rate-limit configuration; sign-in/out; the Owner account created; no permissions, no business data | OQ-161 (email delivery) closed |
| MFA and recovery | Mandatory TOTP enforcement; enrolment; verification; recovery codes; the Owner emergency procedure written and rehearsed | Foundation accepted |
| Accounts and sessions | Admin invitation; account disabling; per-device session list; revoke one/all; Owner protection and the single-Owner constraint | MFA phase accepted |
| Permission model | Permission catalog; role templates; per-user overrides; project scope; the effective-permission function; no enforcement yet | Accounts phase accepted |
| API enforcement | Authorization middleware; default-deny route registration; the record-load scope guard; denied-action auditing; applied first to read-only endpoints per DEC-409 | Permission model accepted |
| Audit trail | The `audit_event` table with append-only grants; the security-event history screen | API enforcement accepted |
| Authentication and permission UX | All screens from §17, to DESIGN.md, with the §18 accessibility requirements | API enforcement accepted; `impeccable` loaded at this point |
| Hardening and production readiness | Security headers; CSP; database least-privilege roles; the §19 test suite complete; a restore test that actually runs; a rehearsed rollback | All prior accepted; OQ-158 closed by measurement |
| Business tables, domain-rule sharing, write paths, Android synchronization | | OQ-159, OQ-162, OQ-163, OQ-164 closed |
