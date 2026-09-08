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

## Production-readiness gate

The system is **not** production ready until every line below is verified with
evidence. Today, none of them are.

- [ ] Authentication implemented and its solution chosen (OQ-157)
- [ ] Authorisation proven: unauthorised API access, Owner and Admin
      boundaries, expired sessions, revoked sessions
- [ ] CSRF, injection, and private-file access tested
- [ ] Business schema migrated and tested at realistic volumes
- [ ] Existing-data migration reconciled: record counts, identifiers, financial
      totals, payment statuses
- [ ] Synchronisation tested: duplicates, interruption, concurrent edits,
      conflict rejection
- [ ] HTTPS working with a valid certificate
- [ ] Monitoring and structured logging in place
- [ ] Backups running, stored off the VPS, with failure alerting
- [ ] **A real restore performed successfully** (DEC-414, OQ-158)
- [ ] Deployment and rollback both rehearsed
- [ ] Android application verified unaffected

A passing unit-test suite is not proof of production readiness, and a hidden
button is not an authorisation test.
