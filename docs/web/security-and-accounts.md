# Security and Account Model

Status: **partly implemented, local development only.** Sign-in with a
password followed by a mandatory TOTP code, sign-out, and a sanitized session
endpoint exist, with no public registration, and every authenticated request
requires an active DROMEX principal and completed MFA (DEC-434). Terminal
Owner activation — identity, TOTP enrolment, recovery codes, and the Owner
principal — exists as a local, interactive, non-HTTP service, tested only
against disposable databases; it is **not approved for real use** until
checkpoints 3F-B, 3F-C, and 3F-D are accepted and OQ-161 is resolved
(DEC-435), its command refuses every run, and **no Owner exists**. An Owner
who has lost the authenticator can sign in with the password and one unused
recovery code into a short-lived recovery state that reaches no business
route and permits only replacing the authenticator, and every recovery step
is recorded in a DROMEX-owned security audit (DEC-436). No terminal
break-glass recovery, password recovery, account management, Owner
readiness enforcement, permissions, or deployment exists.

The full authentication and authorization architecture — candidate research,
the selected system and why, the threat model, session and MFA design, the
Owner-recovery procedure, the permission-block and per-user-override model,
API enforcement, and the testing strategy — is recorded in
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md).
This document remains the short statement of the private-application
boundary and the account model; it does not repeat that detail.

## The private-application boundary

Governed by DEC-409. The web application at `https://app.fakihbrothers.com` is
private and internal.

- An unauthenticated visitor receives **only** the login experience.
- No business information is returned before authentication through HTML, API
  responses, metadata, files, or public URLs.
- There is no public registration and no shared credential.
- Every protected API request is authorised **server-side**, denying by default.
- A hidden or disabled interface control is never the authorisation boundary.
  Hiding a button is a usability choice; the server refusing the request is the
  security control.

## Account model

Governed by DEC-408.

| Role | Count | Capabilities |
| --- | --- | --- |
| Owner | exactly one, protected | Everything an Admin can do, plus managing accounts, recovery, role assignment, and other users' sessions |
| Admin | two, individually named | Business-record work. Both initially hold identical permissions |

An Admin cannot disable, delete, demote, or replace the Owner. The
single-Owner constraint will be enforced by a database constraint, not only by
application logic, following the singleton pattern the SQLite schema already
uses for the company record.

## Authentication solution: selected, partly implemented

**OQ-157 is closed.** DEC-418 selects **Better Auth** (MIT license), embedded
in the existing Fastify process and sharing the existing PostgreSQL database,
subject to the mandatory conditions recorded in DEC-419 through DEC-423 and
DEC-431. The full comparison against Ory Kratos, Keycloak, Authentik,
Zitadel, Logto, SuperTokens, Auth.js, and the assemble-from-primitives
approach — including why each was not selected — is in
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md#4-authentication-candidate-comparison).

An earlier proposal to assemble password hashing, sessions, MFA, recovery, and
CSRF from individually maintained libraries was withdrawn before this
research began. The reasoning is worth preserving here: each library can be
well maintained while the *assembly* is still custom authentication, and the
assembly is where authentication systems usually fail. That reasoning held up
through the Phase 2 research and is part of why Better Auth — a library that
does not require assembling separate pieces for sessions, MFA, and recovery —
was selected over rolling the equivalent by hand.

**Phase 2C has implemented part of it, for local development only:** the
Better Auth user, session, account, verification, and rate-limit schema, the
DROMEX principal table, the sign-in, TOTP verification, sign-out, and session
transport, mandatory MFA with TOTP replay protection and versioned secrets,
Better Auth's two-factor schema, recovery-code issuance, terminal Owner
activation, recovery-code sign-in with restricted authenticator replacement,
and the security audit foundation. Terminal break-glass recovery is not
implemented, no real account has been created, and nothing is deployed.

**The Owner is created only by a local interactive command, never over HTTP.**
There is no setup route, no bootstrap website, no public registration, no
default Owner, and no shared credential. The password is entered through a
hidden terminal prompt and is never accepted from a command argument, the
environment, a file, or piped input. Initial Owner creation needs no email
delivery; OQ-161 still gates Admin invitations and self-service password
recovery. The detail, including the honest non-atomic boundary between Better
Auth and DROMEX, is in
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md#owner-provisioning-tooling-phase-2c-checkpoint-3e-disposable-databases-only).

## Requirements the chosen solution must satisfy

Derived from the installed `owasp-security` guidance (OWASP Top 10:2025 and
ASVS 5.0) and the decisions above.

**Sessions**
- Server-side sessions; the cookie carries an opaque identifier only.
- `HttpOnly`, `Secure`, `SameSite` cookies. No reusable authentication token in
  browser local storage.
- A new session identifier is issued on authentication (ASVS 7.2.4), defeating
  session fixation.
- Session expiration, and per-device revocation visible to and controllable by
  the Owner.

**Credentials and MFA**
- Passwords hashed with a memory-hard algorithm (Argon2 or bcrypt), never a
  bare hash (ASVS 6.2).
- MFA required for all three accounts (ASVS 6.3.3).
- No custom cryptography and no custom authentication algorithm.

**Request protection**
- CSRF protection on every state-changing request; `SameSite` is
  defence-in-depth, not the sole control.
- Rate limiting and backoff on login and recovery (ASVS 6.3.1).
- Identical responses for existing and non-existing accounts, so the login form
  cannot be used to enumerate users.
- Parameterised queries everywhere; no string-concatenated SQL.

**Error handling and logging**
- Generic error to the user, detail to the log (ASVS 16.5.1). The `/ready`
  endpoint already follows this rule and has a test asserting it.
- Authentication events, account changes, exports, payments, corrections, and
  cancellations are recorded in the append-only server audit-event table
  (DEC-411).

**Protected media**
- PDFs, photos, logos, and exports are served through authorisation-checked API
  routes, never from a guessable public path.

## Secrets

- No secret, password, token, private key, or production configuration value is
  ever committed.
- `web/.env.example` contains placeholders only; `web/.env` is git-ignored.
- Production secrets are supplied through Docker secrets or an equivalent
  approved mechanism, never baked into an image layer.
