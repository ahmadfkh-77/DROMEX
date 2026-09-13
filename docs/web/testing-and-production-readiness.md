# Testing and Production Readiness

Status: **partly implemented.** Phase 1 tests exist. The production-readiness
gate at the end of this document is **not** met and must not be described as
met.

## Approach

Test-driven development, per the installed `test-driven-development` skill:
write the test, watch it fail for the expected reason, write the minimal code to
pass, watch it pass. A test that has never failed has not been shown to test
anything.

Claims about test results follow the installed `verification-before-completion`
skill: a claim requires fresh command output from the current state. "Should
pass" is not a result.

## Isolated PostgreSQL test lifecycle

**Tests never use the development database.** This is enforced, not merely
intended.

| Concern | Mechanism |
| --- | --- |
| Isolation from development | Testcontainers starts a dedicated ephemeral PostgreSQL 18.6 container on a random port |
| Guard against misconfiguration | The global setup **throws** if the resolved connection points at port 5433 or database `dromex_dev` |
| Per-file isolation | Each test file creates `test_<random>` and drops it afterwards, so parallel workers cannot collide |
| Cleanup | The container stops in global teardown; Testcontainers' reaper removes orphans if a run crashes |
| Migrations | None exist yet. The hook point is documented for the schema phase |

Testcontainers was chosen over a shared Compose test service because it needs no
manual setup step, cannot accidentally point at development data, and behaves
the same locally and in CI.

### Testing `/ready` in both states

- **Reachable**: a real ephemeral container, expecting `200 {"status":"ready"}`.
- **Unreachable**: the pool targets `127.0.0.1:1`, a reserved closed port, with
  a short connection timeout, expecting `503 {"status":"not_ready"}`. This case
  needs no container and no manual setup.

A third assertion checks that the 503 body leaks **no** driver text, host, port,
credential, or error detail. Not leaking internals is a security requirement
(OWASP A10, ASVS 16.5.1), so it is asserted rather than assumed.

## Phase 1 test inventory

| Test | Kind | Asserts |
| --- | --- | --- |
| `health.test.ts` | API unit | `/health` returns `200 {"status":"ok"}`, and stays `200` when the database is unreachable |
| `ready.test.ts` | PostgreSQL integration | `/ready` returns `200` against a real database, `503` when unreachable, and leaks nothing |
| `smoke.spec.ts` | Browser | The preview renders and is labelled non-production, at mobile, tablet, and desktop widths |

Browser testing follows the installed `webapp-testing` and `playwright-cli`
guidance: wait for the page to settle, then assert on the rendered result.

## Accessibility and responsive criteria

The Phase 1 preview carries no product interface, but the baseline starts here
rather than being retrofitted:

- renders correctly at 375, 768, and 1280 pixels wide with no horizontal
  overflow,
- text meets WCAG AA contrast,
- semantic landmarks and a single `h1`,
- honours `prefers-reduced-motion`,
- keyboard operable with no traps.

Real interface work will follow the existing DROMEX identity in `DESIGN.md` and
`docs/design-system.md` rather than inventing a second visual language.

## Phase 2C authentication transport: local verification

Status: **implemented and verified locally only.** This is evidence from
automated tests against disposable PostgreSQL 18.6 databases. It is not
production verification and does not satisfy any item in the gate below.

Proven locally:

- Exactly three authentication routes exist: `POST /api/auth/sign-in/email`,
  `POST /api/auth/sign-out`, and `GET /api/session`. Every other
  `/api/auth/*` path, including sign-up and raw `get-session`, returns a
  generic 404 without reaching Better Auth.
- A user without an active DROMEX principal is never issued a session: no
  session row is written.
- Unknown email, wrong password, missing principal, and disabled principal
  produce one identical sign-in response.
- `/api/session` returns a fixed sanitized shape and rejects missing,
  malformed, expired, revoked, orphaned, and disabled-principal sessions with
  one identical response.
- Sign-out deletes the session and clears the cookie for active, disabled, and
  missing principals; the old cookie can no longer reach `/api/session`.
  Valid, missing, malformed, expired, and already-revoked sessions receive one
  identical result. Another user's session is untouched. `GET` is `404`, and
  a missing, `null`, or untrusted Origin is refused with `403`.
- Sign-in rate limiting uses DROMEX-owned PostgreSQL storage
  (`dromex_rate_limit`, migration `0002`): five attempts per 60 seconds, a
  `Retry-After` from 1 to 60, state that survives a freshly constructed
  application, reset after the window, no lost or over-granted increments
  under concurrency, no new bucket from forged forwarding headers, fail-closed
  parsing of malformed or unsafe `BIGINT` values, and an unchanged global
  node-postgres parser. Better Auth's generated `rateLimit` table stays
  unchanged and unused.
- Session cookies are `__Secure-` prefixed, `Secure`, `HttpOnly`,
  `SameSite=Lax`, and `Path=/`.
- No password, session cookie, or session token appears in the structured log
  or the console during the tested flows.

Not verified, and still required before production:

- **Timing equivalence of sign-in failures has not been measured.** The four
  failure cases are identical in status and body only.
- Cookie attributes were verified through Fastify injected requests, not a
  real browser.
- No general DROMEX Fastify-level Origin policy exists yet for future
  state-changing DROMEX routes. Sign-in relies on Better Auth's Origin checks;
  sign-out has its own DROMEX Origin check.
- Expired `dromex_rate_limit` rows are not pruned yet; rows accumulate per
  distinct client address and path.
- MFA, Owner provisioning, frontend authentication, permissions, deployment,
  and production readiness remain incomplete.

## Production-readiness gate

The system is **not** production ready until every line below is verified with
evidence. Today, none of them are.

- [x] Authentication solution chosen (OQ-157, closed by DEC-418) — **not yet implemented**
- [ ] Authentication implemented: Better Auth configured per DEC-419 through
      DEC-422; Argon2id in place; session cookie cache confirmed disabled
- [ ] Mandatory MFA enforced for every account with no exception, including the
      Owner (DEC-421)
- [ ] Owner break-glass recovery procedure built as version-controlled,
      tested tooling (never ad hoc manual queries), rehearsed only against
      a disposable/test database, confirmed to invalidate all Owner
      sessions, force MFA re-enrolment, print no secret, and write its own
      distinct audit event (DEC-423) — production execution is an
      Owner-only action, never Claude's
- [ ] Authorisation proven: unauthorised API access, Owner and Admin
      boundaries, expired sessions, revoked sessions, per-user permission
      overrides, project scope, horizontal and vertical privilege escalation,
      IDOR
- [ ] A route with no declared permission confirmed to fail server startup
      (DEC-428's default-deny registration)
- [ ] CSRF, CORS, injection, rate limiting, account-enumeration, and
      private-file access tested
- [ ] Cookie flags and security headers verified in a real browser; no auth
      value found in `localStorage`/`sessionStorage`
- [ ] `audit_event` table confirmed append-only at the database-grant level
      (DEC-430); secret redaction confirmed across the full auth test suite
- [ ] Business schema migrated and tested at realistic volumes
- [ ] Existing-data migration reconciled: record counts, identifiers, financial
      totals, payment statuses
- [ ] Synchronisation tested: duplicates, interruption, concurrent edits,
      conflict rejection
- [ ] HTTPS working with a valid certificate
- [ ] Monitoring and structured logging in place
- [ ] Backups running, stored off the VPS, with failure alerting, and now
      confirmed to include authentication material under encryption
- [ ] **A real restore performed successfully** (DEC-414, OQ-158) — the
      restore runbook confirmed to end with revoking all sessions and Owner
      verification of effective access
- [ ] Deployment and rollback both rehearsed, including a rollback crossing an
      authentication-schema migration
- [ ] Android application verified unaffected

A passing unit-test suite is not proof of production readiness, and a hidden
button is not an authorisation test. The full test-area breakdown (what
needs real PostgreSQL, a real browser, captured email, or controlled time) is
in
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md#19-complete-testing-strategy).
