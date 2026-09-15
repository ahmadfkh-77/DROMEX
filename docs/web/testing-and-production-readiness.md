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
- MFA, real Owner provisioning, frontend authentication, permissions,
  deployment, and production readiness remain incomplete. *(Mandatory MFA was
  since added locally by checkpoint 3F-B, below; the rest still stands.)*

## Phase 2C Owner provisioning tooling: local verification

Status: **implemented and verified against disposable PostgreSQL 18.6
databases only, on exact Node 24.20.0.** The command is not approved for real
use before MFA, and no Owner exists. This is not production verification and
satisfies no item in the gate below.

Proven locally, with synthetic identities in disposable databases:

- A first bootstrap creates exactly one Better Auth identity, one active Owner
  principal, an Argon2id password (`m=19456,t=2,p=1`), and no session; the
  intent row is removed.
- A second bootstrap, and a re-run with the same identity, are refused
  without creating another identity. An existing Owner refuses the run before
  Better Auth is called. Existing non-Owner principals do not block it.
- Invalid name, email, password, or confirmation is refused before any
  connection opens or Better Auth is called.
- A held provisioning advisory lock refuses a run immediately and changes
  nothing; two concurrent runs create exactly one Owner and one identity; the
  lock is released afterwards.
- A pre-existing Better Auth identity with the same email is refused rather
  than adopted.
- Interruption before Better Auth creation leaves no identity and retries
  cleanly. Interruption after it leaves a `pending_identity` intent and an
  orphaned identity with no principal, never a partial Owner. A retry with the
  same email and password completes it with no second identity; a wrong
  password or a different email cannot claim it. The verification session
  Better Auth issues is inserted once and deleted once, leaving none.
- A failing principal insert rolls back, leaves an `identity_created` intent,
  and remains resumable.
- No password, password hash, or session token appears in results, errors,
  console output, or process output. No statement sent on provisioning's own
  connections mutates a Better Auth-owned table.
- The normal runtime instance still refuses `signUpEmail`, the route table is
  unchanged, and the provisioned Owner signs in through the unchanged
  transport with `isOwner: true`.
- The command refuses every real run with the pre-MFA message and a non-zero
  exit, opens no connection, refuses password and connection-string
  arguments without echoing them, ignores the environment, and prints no
  stack when run as a real process. The hidden prompt echoes nothing, handles
  paste, backspace, and escape sequences, cancels on Ctrl+C or Ctrl+D with
  its buffer emptied and the terminal restored, and refuses a non-terminal.
- Mutation checks: removing the advisory lock, the session revocation, the
  password verification, the foreign-identity refusal, or the existing-Owner
  check each makes at least one test fail.

Not verified:

- A lost lock connection while a Better Auth call is in flight.
- The command wired end to end to the prompt and service, which is
  deliberately not done before MFA.
- Any run against a persistent database, which is prohibited.

## Phase 2C mandatory MFA and terminal Owner activation: local verification

Status: **implemented and verified against disposable PostgreSQL 18.6
databases only, on exact Node 24.20.0.** This is not production verification
and satisfies no item in the gate below. The Owner command still refuses
every run, and no Owner exists (DEC-435).

Proven locally, with synthetic identities in disposable databases:

- Exactly four authentication routes exist. Every other Better Auth
  two-factor path and `revoke-sessions` returns a generic 404 and changes no
  data.
- A correct password yields only `{ "mfaRequired": true }` and a `Secure`,
  `HttpOnly`, `SameSite=Lax`, five-minute challenge cookie, with no session
  row. Unknown email, wrong password, missing principal, disabled principal,
  and an account without completed MFA are indistinguishable, and no
  password-only session survives.
- A valid code completes sign-in with a session cookie and no token or
  trusted-device cookie. Wrong codes and codes two steps in the past or future
  are refused. A replayed code is refused, and of concurrent submissions of
  one code exactly one succeeds.
- The sixth TOTP request per address within 60 seconds is refused with a
  `Retry-After` from 1 to 60. Ten consecutive failures lock the account for
  900 seconds, even against a correct code, and the test proves the refusal
  is the lockout rather than either rate limit.
- A challenge completed after the principal was disabled, or while DROMEX MFA
  is incomplete, issues no session. `/api/session` rejects missing, malformed,
  expired, revoked, orphaned, disabled, MFA-reset, older-than-MFA, and
  factor-removed sessions with one identical response.
- A genuine trusted-device cookie minted by Better Auth skips TOTP when sent
  straight to Better Auth, and does not through the transport.
- TOTP secrets and recovery codes are encrypted under the newest secret
  version; an ambient `BETTER_AUTH_SECRETS` is ignored by the instance and,
  with `BETTER_AUTH_SECRET`, `AUTH_SECRET`, and the retired
  `DROMEX_AUTH_SECRET`, refused at startup; a factor enrolled under an older
  version still verifies after rotation.
- Recovery codes are ten distinct 24-symbol Crockford Base32 codes of 120
  bits, shown once, only after TOTP verification and the typed device
  acknowledgement, and identical to what Better Auth stores. Every resumed run
  rotates them, so no code shown by an interrupted run stays valid.
- Terminal activation allows at most five TOTP attempts per run. Refusing
  either typed acknowledgement activates nothing. Interruption before or
  after identity creation, after enabling TOTP, after verification, after
  showing codes, during session revocation, and during the final DROMEX
  transaction grants no web access and resumes cleanly. The activated Owner
  signs in through the unchanged transport. The terminal echoes no code,
  accepts each acknowledgement only as its exact phrase, clears the screen and
  scrollback where honoured, and refuses a non-interactive terminal.
- No scenario in the Owner activation suite — including a run resumed through
  a TOTP challenge, the one path where a trusted-device request could take
  effect — ever leaves a `trust-device-*` row in Better Auth's `verification`
  table: an explicit invariant checked after every test in that suite, not
  only the ones that exercise it, because `owner-identity.ts` discards
  Better Auth's trusted-device cookie and would not otherwise surface one
  being requested.
- Better Auth migration `0002` matches the pinned CLI output byte for byte,
  and neither `verified` nor `failedVerificationCount` has a database default.
  Enrolment, re-enrolment, sign-in failure, success, lockout, lock expiry,
  recovery-code regeneration and retrieval, and every activation scenario
  leave both columns non-null, and no API source writes `twoFactor` with its
  own SQL. A negative control shows that a NULL counter never locks on
  PostgreSQL, which is why that invariant is enforced.
- No password, TOTP code or secret, challenge, cookie, session token, or
  recovery code appears in structured logs, console output, process output,
  results, or errors.
- The Android application's typecheck and test suites, and the web preview's
  Playwright suite, still pass.

**Mutation testing (25/25 killed).** Each of 25 targeted mutations against
the mandatory-MFA gate, trusted-device refusal, TOTP replay protection, rate
limiting and lockout, factor and recovery-code configuration, versioned
secrets, terminal activation ordering and acknowledgements, and the
Better-Auth-default invariant above was applied one at a time to a disposable
copy of the sources, and every one made at least one of the suites above
fail; production sources were restored after each mutation and confirmed
byte-identical to the working tree afterward. Two findings from the first
pass were corrected rather than accepted: a mutation that made Owner
activation request `trustDevice: true` during a resumed TOTP challenge
initially **survived**, because `owner-identity.ts` discards Better Auth's
trusted-device cookie and nothing asserted on the resulting database state —
closed by the invariant above, not by weakening the mutation or the
production code; and a second mutation targeting `skipVerificationOnEnable`
was initially **invalid** because its search pattern also matched the option
name inside a doc comment — corrected to target the executable line only.
Both were re-verified as killed, individually and in a full clean re-run of
all 25.

Not verified:

- Timing equivalence of failures, and cookie behaviour in a real browser.
- Recovery-code use (checkpoint 3F-C) and break-glass retrieval (3F-D).
- The command wired end to end to the terminal and service, deliberately not
  done before real activation is approved.
- Any run against a persistent database, which is prohibited.

## Phase 2C Owner recovery and security audit: local verification

Status: **implemented and verified against disposable PostgreSQL 18.6
databases only, on exact Node 24.20.0.** This is not production verification
and satisfies no item in the gate below. No Owner exists and the Owner
command still refuses every run (DEC-435, DEC-436).

Proven locally, with synthetic identities in disposable databases (tests
written first; the RED runs failed with 404s, missing tables, a missing
module, unrecognised classifications, and admitted sessions before any
implementation existed):

- A valid password plus an unused recovery code yields only a restricted
  recovery state: a `Secure`, `HttpOnly`, `SameSite=Lax` session, no
  trusted-device cookie, `mfa_completed_at` cleared, one recovery row bound
  to that session with a lifetime of exactly 300 seconds, the session
  recorded as a recovery session, and the used code gone from the stored
  set.
- That session is refused by `/api/session` and by `authenticated` stand-in
  routes for projects, reports, finance, settings, backups, and accounts
  (GET and POST), including while replacement requests run concurrently. It
  reaches only the replacement steps, in order, and sign-out.
- Unknown, malformed, and already used recovery codes are refused with no
  session. Five attempts per 60 seconds per address are allowed and the
  sixth is refused with `Retry-After`; recovery-code and TOTP failures share
  the ten-failure, 900-second account lockout, which then refuses even a
  valid code.
- Rate-limit correction (written RED first; all six new tests failed against
  the provisionally accepted code): malformed-length, invalid-character,
  non-string, empty, incorrect, and reused codes, and requests without a
  challenge, all share one Better Auth bucket per address before any audit
  row is written. A sixth attempt is refused with `429` and `Retry-After`
  and writes no row, even when valid; 24 concurrent mixed attempts admit
  exactly five and audit exactly five; the bucket stays closed 58 seconds
  after the fifth attempt and reopens for exactly five more once 60 seconds
  have passed; malformed codes never count toward the account lockout or the
  challenge's attempt budget; a failing limiter returns `500` with no row and
  no session; no submitted value appears in audit rows or logs.
- Every other Owner session is revoked, and the count is audited.
- A non-Owner principal and a disabled Owner get no recovery state and no
  session; two concurrent recoveries for one Owner produce exactly one.
- An expired recovery fails closed, ends, and revokes its session; the
  database refuses any lifetime over five minutes. Missing, malformed,
  ordinary, unbound, and disabled-principal sessions are all refused, and a
  concurrent or repeated start is accepted once.
- A wrong password ends the recovery with the old factor intact and ordinary
  access still closed.
- Replacement uses Better Auth's `disableTwoFactor` then `enableTwoFactor`:
  the old secret and every old code are replaced, `twoFactorEnabled` is false
  until the new code verifies, and the rotated session is still a recovery
  session.
- Completion requires a valid new code; returns ten new canonical codes once
  with `Cache-Control: no-store`; sets `mfa_completed_at`; revokes every
  Owner session; and requires a fresh sign-in, which succeeds with the new
  authenticator. The old TOTP, old recovery codes, and a replay of the code
  used to complete are all refused; a new code works once.
- Five wrong new codes, an abandonment by sign-out, and an expiry after the
  old factor is disabled each leave business access blocked and record
  `terminal_recovery_required`.
- A failure recording the recovery releases no session and changes nothing;
  a failure recording completion never restores ordinary access; a factor
  Better Auth removed before failing is treated as disabled.
- Every step of a completed recovery produces its audit event in order, with
  the Owner's id and name snapshot, the recovery reference, and the client
  address. A rejected code is recorded with no actor. No password, TOTP
  secret or value, recovery code, cookie, or session token appears in audit
  rows or logs.
- `dromex_audit_event` rejects `UPDATE`, `DELETE`, and `TRUNCATE`, PUBLIC
  holds none of those privileges, it has no free-form column, and its checks
  refuse unknown types, outcomes, unstructured reasons, negative counts, and
  malformed addresses. The audit writer refuses any extra, missing, or
  malformed property before touching the database.
- No API source module writes a Better Auth-owned table with its own SQL.
  The route surface is exactly the seven approved authentication routes, and
  a `recovery` route without its own gate is refused.
- Every earlier sign-in, sign-out, session, MFA, principal, replay, rate-limit,
  provisioning, and migration test still passes.

**Mutation testing (26/26 killed).** Each of 26 targeted mutations was
applied alone to a disposable copy of the sources and migrations and
required to make at least one test fail. They covered:

- the ordinary gate and recovery classification;
- the trusted-device refusal;
- the owner-wide MFA lockdown and recovery-session list;
- non-Owner and disabled-principal refusal;
- session revocation on entry, on failure, and at completion;
- the recovery-code rate limit;
- expiry;
- the atomic step claim;
- factor-state re-reading;
- the five-attempt limit;
- replay recording;
- completion;
- abandonment and terminal-recovery flagging;
- the audit writer's validation;
- the append-only trigger;
- the five-minute and one-recovery database constraints.

Sources and migrations were confirmed byte-identical after the run.

The first passes exposed three weak tests, all fixed by strengthening tests,
never production code:

- *Start claim (two mutations).* The concurrent `start` test never forced
  both requests past the gate, so removing the atomic claim, or its step
  check, survived. A new test holds the recovery row locked until PostgreSQL
  shows both requests queued at the claim, then releases it.
- *One open recovery per Owner.* The concurrent entry test was only killed
  by timing, because Better Auth's own compare-and-swap on the code list
  often rejects a truly concurrent second code first. A new test submits a
  second valid code sequentially while the first recovery is open.

**Rate-limit correction mutation run (35/36 killed, 1 equivalent).** After
the rate-limit correction, 36 targeted mutations were rerun against
disposable copies on Node 24.20.0. There were eight new mutations and 28
covering the areas above:

- The eight new mutations audit a malformed code before the limiter, audit a
  limited attempt, let a missing challenge bypass the limiter, audit a
  missing challenge, forward a malformed code as a code, audit a server
  fault, loosen the limit to six, and shorten the window. All are killed
  except the server-fault mutation, which is covered below.
- The first pass left five survivors. Four were weak tests, fixed by new
  tests with no production change:
  - A server fault Better Auth returns during recovery-code verification
    must stay a `500` with no audit row.
  - A recovery that expires after the gate admits `start` must refuse the
    claim.
  - A new code the replay guard has already seen must never complete
    recovery.
  - An Owner disabled after the gate admits the final code must not complete
    recovery.
- Each new test kills its mutation on the rerun.
- The fifth survivor, removing the attempt guard from
  `reserveVerifyAttempt`, is equivalent. The transport's five-attempt check
  and the database's `CHECK (verify_attempts BETWEEN 0 AND 5)` still
  enforce the limit, so no request can observe the difference.
- Sources, tests, and migrations were confirmed byte-identical after each
  run.

Not verified:

- Terminal recovery for an existing Owner (checkpoint 3F-D), which an
  abandoned replacement requires. Implemented later on disposable databases
  (DEC-437; see the next section); its command is not enabled.
- An expiry event for a recovery nobody touches again.
- Timing equivalence of failures, and cookie behaviour in a real browser.
- Any run against a persistent database, which is prohibited.

## Phase 2C terminal emergency Owner recovery: local verification

Status: **implemented and verified against disposable PostgreSQL 18.6
databases only, on exact Node 24.20.0.** This is not production verification
and satisfies no item in the gate below. The command refuses every run, no
Owner exists, and the Owner activation command is unchanged (DEC-437).

Tests were written first. The RED runs failed for the expected reasons only
(54 unit and 54 integration failures): stub modules that threw "not
implemented", the missing `0007` tables and audit columns, a migration count
of 6 instead of 7, and a command that did not refuse. Every test is run
through injected terminals and disposable databases; the real command is
never executed against a database.

Proven locally, with synthetic identities:

- **Eligibility.** No Owner, more than one Owner, and a disabled Owner are
  refused before any prompt; a typed email that does not name the Owner is
  refused before the password is asked for.
- **Password proof.** An incorrect password is refused after exactly one
  attempt and changes nothing but the audit trail (no run, no session, factor
  and codes intact, `mfa_completed_at` unchanged). Five rejections within 15
  minutes throttle the next run before any prompt; older rejections do not
  count.
- **Pinning.** Better Auth 1.7.5 reported, an extra `twoFactor` column, and a
  missing `session` column are each refused before the Owner is touched.
- **Supported retrieval.** Exactly one stored code is shown once; the stored
  set is unchanged; the audit trail records the retrieval and contains no
  code; the code then enters 3F-C web recovery successfully. Without the exact
  confirmation nothing is shown and the run is abandoned.
- **Supported replacement** for an Owner with no factor, an unverified factor,
  a partially disabled factor, a factor disabled by an abandoned web recovery,
  and a proven existing authenticator: ten new canonical codes equal to the
  stored set, one verified factor, old codes and the old authenticator
  refused, `mfa_completed_at` set, no session left, three terminal sessions
  recorded, audit events in order, and normal sign-in with the new
  authenticator reaching a business route.
- **New codes.** An incorrect code and a replayed code are rejected, and the
  replayed code is never sent to Better Auth; five wrong codes fail closed,
  revoke every session, and a rerun completes.
- **Sessions and access.** Every Owner session, including web sessions made
  before the run, is revoked and counted. At every step from the availability
  question to the screen clear, the pre-existing web session and every
  session the run held are refused on `/api/session` and a business route,
  and `mfa_completed_at` is null. Completion is refused while any session
  remains, without a verified factor, without the exact two-device or
  recovery-code acknowledgement, and after an operator cancellation.
- **DEC-437 reset** only when every code is used and no authenticator is
  available, when codes are encrypted under a retired secret version, and
  when the enabled flag has no factor row. Its DROMEX statements to Better
  Auth tables are exactly `update user` then `delete from twoFactor`, once
  each, with no owner id or email in any statement text. A non-Owner
  bystander's user row, factor row, and sessions are byte-identical before
  and after. It is refused, leaving the factor intact, without the exact
  phrase, with a malformed incident reference, when the factor changes after
  classification, and when the Owner is disabled after classification; a
  failure inside its transaction rolls back the flag, the factor row, the run
  state, and the audit rows together. An interrupted reset is finished by a
  supported rerun and never resets twice.
- **Concurrency and crashes.** Two concurrent runs produce exactly one; a
  foreign holder of the lock is refused; a stale open run is ended as
  `interrupted` and audited. An interruption at enrolment, the new-code
  prompt, the device acknowledgement, the code display, the code
  acknowledgement, or the screen clear each leaves `mfa_completed_at` null
  and no session, and a rerun completes with every previously shown code
  invalid.
- **Secrets.** After a rejected password, a crash whose underlying error
  carries the password, and a full reset run, no password, TOTP secret, URI,
  old or new recovery code, or session token appears in any error, stack, or
  row of any `dromex_*` table. The command refuses secret-bearing and
  account-naming arguments without echoing them, ignores the environment, and
  fails closed as a real process with no stack; the prompts echo no hidden
  entry and refuse a non-terminal; the configuration loader refuses
  over-permissive, oversized, malformed, and invalid files without repeating
  a path or value.
- **3F-C protections.** Web recovery cannot begin while a terminal run is
  open; a terminal run ends an open web recovery; and the ordinary gate
  refuses a valid, MFA-complete session once it is recorded as a terminal
  recovery session.
- **Migration 0007.** One open run per Owner; state and end time consistent;
  a reset requires a well-formed incident reference; every audit event type
  is accepted while unknown types, free-text references, zero run
  references, and changes are refused.
- **Boundaries.** Exactly the two DEC-437 statements, parameterised, exist in
  exactly one module; no other source module writes a Better Auth table; no
  `twoFactor` row is inserted or rewritten; the route table is unchanged, so
  no HTTP endpoint was added; provisioning modules read no environment.

Suites on exact Node 24.20.0 (disposable container, `npm ci` from the
committed lockfile, Docker-backed PostgreSQL 18.6): workspace typecheck
clean; API unit tests 333/333 (19 files); API integration tests 242/242
(12 files), including 53 terminal recovery tests. `npm audit` and
`npm audit --omit=dev` report 0 vulnerabilities. The Playwright suite and the
Android typecheck and suite were rerun on the host and are unaffected.

**Mutation testing (38/38 killed).** Thirty-eight targeted mutations were each
applied alone, inside the disposable Node 24.20.0 container's own copy of the
workspace, with the named tests run and the file restored and confirmed
byte-identical by SHA-256 afterwards. They covered password verification
(ignoring a rejection, treating a 401 as a session), the throttle and its
window, Owner selection (several Owners, a disabled Owner, the typed email),
the version and schema pins, the advisory lock and stale-run clearing,
`mfa_completed_at` clearing, the ordinary gate's terminal-session refusal,
web recovery's refusal and supersession, terminal-session recording, session
revocation at completion and on failure, the completion session and factor
checks, replay claiming, the five-attempt limit, both acknowledgements, path
selection, all three typed confirmations and the incident pattern, retired
secret detection, the reset fingerprint, principal re-check, W1 and W2
scoping, commit ordering, error redaction, the disabled command, the
configuration permission check, and the audit incident-reference check.

The first pass killed 32. Five mutations ran no test because the runner
passed two name filters and Vitest honours only one; with the filters joined
into one pattern, all five were killed. One genuinely survived — removing the
schema column-count check — because the only schema test added a column,
which the per-column type check already refused; a new test dropping a
verified column kills it. Before the run, four further weak spots were found
while mapping mutations to tests and closed with new tests, never production
changes: the reset's principal re-check, the completion factor check, and
the exact two-device and recovery-code acknowledgements. One 3F-C test that
pins the audit table's exact column list was updated for the two
constrained columns migration `0007` adds.

Host notes: the host's Node 22.17.1 cannot execute a `.ts` entry point
directly, so the real-process command tests (the new one and the existing
activation command's) fail only there with `ERR_UNKNOWN_FILE_EXTENSION`; both
pass on Node 24.20.0.

Not verified:

- Any real configuration file, real Owner, or real run of the command, all of
  which are prohibited until a separate enabling decision.
- The command wired end to end to the configuration loader and the real
  terminal, deliberately not done while it is not enabled.
- Operator identity capture and a second-person approval, which do not exist.
- Timing equivalence of failures.
- Any run against a persistent database, which is prohibited.

### Continuation checkpoint: 3F-D paused (2026-09-15)

Checkpoint 3F-D was paused by Owner directive so an Android workstream could
proceed on a separate branch. Nothing below changes the status above; it
records where to resume.

- **Branch.** `web/phase2c-auth-foundation`, work-in-progress commit
  `wip(web): checkpoint terminal Owner recovery` on top of `af407a4`. Not
  merged into `main`.
- **Completed.** The DEC-437 design approved on 2026-09-15 and implemented as
  described in the architecture document (§11, checkpoint 3F-D): terminal-only
  recovery requiring the current password; version, schema, and ledger pins;
  advisory lock and durable run record (migration `0007`); containment that
  keeps business access blocked; supported replacement, supported one-code
  retrieval, and the last-resort reset limited to W1 and W2 in
  `src/provisioning/owner-mfa-reset.ts`; the audit events; the configuration
  loader; the tests, the RED record, and the 38-mutation run recorded above.
- **Files.** New: `migrations/dromex/0007_dromex_terminal_recovery.sql`;
  `src/provisioning/` `owner-mfa-reset.ts`, `owner-recovery-command.ts`,
  `recovery-config.ts`, `terminal-recovery.ts`,
  `terminal-recovery-errors.ts`, `terminal-recovery-identity.ts`,
  `terminal-recovery-prompt.ts`; tests
  `integration/terminal-owner-recovery.test.ts`,
  `unit/owner-recovery-command.test.ts`,
  `unit/owner-recovery-terminal.test.ts`, `unit/recovery-config.test.ts`.
  Modified: `src/auth/owner-recovery.ts`, `src/auth/security-audit.ts`,
  `src/db/dromex-migrations.ts`, five existing test files, this document,
  `README.md`, `security-and-accounts.md`,
  `authentication-and-authorization-architecture.md`, and
  `requirements/decisions.md` (DEC-437).
- **Re-verified at the pause, on the host.** Workspace typecheck clean; API
  unit tests 331/333, with the two failures being the documented host
  limitation (Node 22.17.1 cannot run a `.ts` entry point); secret scan of
  every changed file found synthetic fixtures only; `web/.env` is ignored and
  untouched, and the Android migrations and root `package.json` are
  unchanged. In a disposable Node 24.20.0 container (`npm ci`, a copy
  without `.env`): typecheck clean and API unit tests 333/333. On the host,
  the five affected integration files (terminal recovery, web recovery,
  migrations, authentication flow, rate-limit storage) passed 162/162 against
  disposable PostgreSQL. The full 242-test integration suite and the mutation
  checks were not rerun at the pause.
- **Still pending.** Owner review and acceptance of 3F-D; replacing the
  work-in-progress commit with an accepted `feat(web)` commit; the full
  integration suite and mutation checks rerun on Node 24.20.0 after any
  review changes; the enabling decision for the command (DEC-437 (8));
  production secret delivery; operator identity capture and second-person
  approval; OQ-161.
- **Risks and blockers.** The known limits listed in the architecture
  document (§11, checkpoint 3F-D) are unchanged. No blocker prevents
  resumption; acceptance is the gate.
- **First step on resume.** Check out `web/phase2c-auth-foundation`, confirm
  it matches `origin`, rerun the typecheck and both API suites on exact Node
  24.20.0, then present 3F-D for Owner acceptance. Do not enable the command.
- **Not touched.** The real recovery command still refuses every run. No real
  account, `web/.env`, VPS, persistent database, or production system was
  accessed.

## Production-readiness gate

The system is **not** production ready until every line below is verified with
evidence. Today, none of them are.

- [x] Authentication solution chosen (OQ-157, closed by DEC-418) — **not yet implemented**
- [ ] Authentication implemented: Better Auth configured per DEC-419 through
      DEC-422; Argon2id in place; session cookie cache confirmed disabled
- [ ] Mandatory MFA enforced for every account with no exception, including the
      Owner (DEC-421) — implemented and verified locally against disposable
      databases in checkpoint 3F-B (DEC-434); not production-verified
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
      — partly addressed locally in checkpoint 3F-C (DEC-436):
      `dromex_audit_event` rejects `UPDATE`, `DELETE`, and `TRUNCATE` by
      trigger and PUBLIC holds none of those privileges, but the
      least-privilege runtime role and its grant are not provisioned, and
      only recovery events are recorded
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
