# Security and Account Model

Status: **planned. Nothing in this document is implemented.** Phase 1 ships no
authentication and no users, sessions, MFA, or recovery tables.

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

## Authentication solution: deliberately unresolved

**OQ-157 is open and gates this work.**

An earlier proposal to assemble password hashing, sessions, MFA, recovery, and
CSRF from individually maintained libraries was withdrawn. The reasoning is
worth recording: each library can be well maintained while the *assembly* is
still custom authentication, and the assembly is where authentication systems
usually fail.

Phase 2 compares maintained self-hosted options (Ory Kratos, Keycloak,
Authentik, Zitadel, Logto, SuperTokens, Better Auth, Auth.js, and the
assemble-from-primitives approach as one clearly labelled candidate) against
the concrete requirements above: one protected Owner, two named Admins,
mandatory MFA, per-device session revocation, Owner-managed recovery, no public
registration, no shared credentials.

No users, sessions, MFA, or recovery schema may be created until that question
closes.

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
