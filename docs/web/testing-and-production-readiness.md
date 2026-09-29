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

### Resumed and re-verified (2026-09-15)

3F-D was resumed on `web/phase2c-auth-foundation` at the work-in-progress
commit, confirmed identical to `origin`. The Owner's approval of the DEC-437
design, terminal re-enrolment, password proof, migration `0007`, the
configuration boundary, and the implementation scope matches what DEC-437
already records; no production source, migration, or decision text changed.

- **Audit against the approval.** Every approved condition was traced to code
  and a test. Five checks had no test, so five tests were added to
  `integration/terminal-owner-recovery.test.ts` (four new, one strengthened):
  an incomplete DROMEX migration ledger is refused before any prompt; an empty
  or over-long password is rejected and audited without reaching Better Auth;
  the terminal-only Better Auth instance issues no session to an identity that
  is not an active Owner principal (Better Auth reports that refusal as an
  ordinary sign-in failure); completion is refused while a web recovery is
  open; and a completion refused because a session remains audits
  `terminal_sessions_revoked` as a failure.
- **RED evidence for the new tests.** Production code already existed, so
  each new test was proven by mutation instead: removing the ledger check, the
  password length guard, the terminal instance's principal check, the
  completion's web-recovery check, or the failure outcome each made exactly its
  test fail (M40–M44 below). One new test first failed on its own wrong
  assumption (it expected a thrown error) and was corrected to assert the real
  fail-closed result: no session and no session row.
- **Suites on exact Node 24.20.0** (disposable container, `npm ci` from the
  committed lockfile, export without `.env`, Docker-backed PostgreSQL 18.6).
  Before the new tests: typecheck clean, unit 333/333, integration 242/242.
  After: typecheck clean, unit 333/333 (19 files), integration 246/246
  (12 files, 57 terminal recovery tests), `npm audit` and
  `npm audit --omit=dev` 0 vulnerabilities, lockfile hash unchanged.
- **Mutation testing (43/43 killed).** The 38 recorded mutations were rerun
  and M40–M44 added, each applied alone in the container's own copy and
  restored and confirmed byte-identical by SHA-256. The first pass killed 33;
  the other 10 did not apply because their multi-line snippets were written
  with LF while this Windows working tree uses CRLF. With line-ending-aware
  matching all 10 were applied and killed. No mutation survived.
- **Still pending.** Owner acceptance; replacing the work-in-progress commit;
  the enabling decision for the command (DEC-437 (8)); production secret
  delivery; operator identity capture and second-person approval; OQ-161.

## Phase 2C email transport foundation (checkpoint 4A): local verification

Status: **implemented and verified on exact Node 24.20.0 in a disposable Linux
container only.** This is not production verification and satisfies no item
in the gate below or in DEC-443. No Resend account, DNS record, API key, or
secret file exists; the real Resend API was never contacted; no email was
sent; the transport is not wired to the server; invitations and password
reset remain unimplemented; and the Owner activation and terminal recovery
commands still refuse every run. Design and limits:
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md#implemented-transport-foundation-phase-2c-checkpoint-4a-local-development-only).

Tests were written first against stub modules. The RED run in the container
failed 87 of 92 tests, every one because a stub was not implemented; the 5
that passed were the structural boundary guards, proven afterwards by
mutation. Every fetch is injected, every key is generated in memory and
labelled synthetic, every domain uses the reserved `.test` TLD, and every key
file is a temporary file removed after its test.

The HTTP 409 policy was added afterwards, also test first, once Resend's
official error reference and idempotency guide and the error type in its
official Node SDK had been re-checked (2026-09-16). Its RED run failed 6 of the
8 new tests, each on the missing classification or the missing 4 KiB bound;
the other 2 (fail-closed bodies and no other body read) already held and were
proven by mutation. The capture transport's conflict reason was also changed
test first (1 RED failure).

Proven locally (101 tests in six files, including the HTTP 409 policy added
before the checkpoint was committed):

- **Configuration.** Disabled by default in every environment; capture
  refused in production by both the loader and the transport; unknown
  transport names refused; Resend requires an absolute key-file path, which is
  refused for any other transport; four ambient key variables stop
  configuration without repeating the value; only the supplied environment
  object is read.
- **Key file** (Linux). An owner-only regular file is accepted and loses only
  one final newline; the open uses no-follow and non-blocking read-only flags;
  a symbolic link, a directory, a FIFO (without blocking), a missing file, an
  empty file, a file over 512 bytes, eight group or other permission
  combinations, and ten malformed contents are each refused with a fixed
  message that contains neither the synthetic key nor the path; the
  descriptor is closed on every path; nothing is logged. Windows and relative
  paths are refused before any open, on every platform.
- **Message validation.** A synthetic message for every purpose is accepted;
  malformed, non-normalised, and multiple recipients, extra fields, a purpose
  and key mismatch, CR/LF and other control characters in every header field,
  length boundaries on both sides, a missing text or HTML part, 24 unsafe
  markup forms, links to any other origin or scheme, and secret-like metadata
  are each refused with an issue code that repeats no content.
- **Resend request.** The fixed endpoint, `POST`, refused redirects, exactly
  five headers, and exactly the approved JSON body; no tracking or other
  field; the key never in the URL or body and not reachable through the
  transport object; strict provider id extraction; ten malformed success
  responses refused without retry.
- **Retries.** Success first time; success after 429, 500, 502, 503, a
  timeout, a real abort, and three transient network codes; a lost response
  retried with the same key and byte-identical body; seven permanent 4xx
  statuses, a redirect, an unexpected status, and unknown errors not retried;
  a documented in-progress 409 (`concurrent_idempotent_requests`) retried
  with the same key and byte-identical body until acceptance, and ending as
  `retryable_failure` `idempotency_in_progress` after three attempts, inside
  the deadline and the `Retry-After` bound; a conflict 409
  (`invalid_idempotent_request`) never retried, including after an
  in-progress response, and reported only as `idempotency_conflict`;
  `resource_locked`, unknown, case-varied, padded, nested, non-string, and
  missing names, array, null, invalid, and empty bodies, non-JSON and missing
  content types, and bodies one byte over the 4 KiB bound each refused as
  `provider_rejected` without retry, while a body of exactly 4 KiB is
  classified; no 409 message text reaches a result; no other error status
  body is read;
  at most three attempts; the two-minute deadline, including after an
  overrunning sleep; per-attempt timeouts bounded by remaining time; bounded
  jitter; `Retry-After` honoured, capped, or ignored as designed; no result
  containing the key, an address, the subject, a body, or the idempotency
  key.
- **Disabled and capture.** Disabled never reports success, uses no network,
  and still refuses invalid messages; capture is deterministic, frozen,
  isolated per instance, clearable, mirrors provider idempotency (a changed
  payload under a used key is `idempotency_conflict`), and uses no
  network; neither writes to the console.
- **Boundaries.** Exactly seven modules; no console, environment, `.env`,
  `require`, debugger, or child-process use; only Node built-ins and local
  imports and no email SDK in the manifest; exactly one network endpoint,
  used only by the Resend transport; no webhook code. The existing route
  table assertion still passes, so no HTTP route was added.

Suites on exact Node 24.20.0 (disposable container, `npm ci` from the
committed lockfile, a copy of the Git-listed workspace files that excluded
`web/.env`): workspace typecheck clean; email tests 101/101; API unit tests
434/434 (25 files); API integration tests 246/246 (12 files) against
disposable PostgreSQL 18.6, run as a regression check although no database
behaviour was introduced. `npm audit` and `npm audit --omit=dev` report 0
vulnerabilities; the lockfile and all three manifests are byte-identical to
the repository. On the host: the Playwright suite 12/12, the Android
typecheck clean, and the Android suite 537/537. The email suites also pass on
the Windows host with the 11 Linux-only key-file tests skipped by platform.

**Mutation testing, 409 policy (17/17 killed) and transport regression (9/9
killed).** After the 409 change, 17 mutations were each applied alone in the
container and restored byte-identically (SHA-256): the in-progress case not
retried; the conflict retried; an unclassified 409 retried; 409 no longer
classified; every 4xx body classified; the 4 KiB bound removed and reduced by
one byte; case-insensitive or trimmed name matching; a nested `error.name` or
`message` accepted as the name; the JSON content-type check removed; the
provider message leaked into the reason; a new key or a changed body on a
retry; `Retry-After` ignored for a 409; another error body read; and the
capture conflict reason. Nine regression mutations of the pre-existing
transport were rerun against the changed code: four attempts, a widened
deadline, 429 not retried, 400 retried, redirects followed, the key-in-message
refusal removed, the success size cap removed, provider id validation
removed, and the disabled transport claiming acceptance. The 54 mutations
below were not individually re-applied after the change, because their
scripts were not kept.

**Mutation testing before the 409 change (53/54 killed, one equivalent).** Fifty-one targeted
mutations of the transport, key loader, configuration, and validation, and
three of the boundary guards, were each applied alone inside the container's
copy, with the named tests run and the file restored and confirmed identical
by SHA-256. They covered retry count in both directions, the deadline, both
deadline checks, the attempt timeout, each retry classification, stable
idempotency key and body, `Retry-After` handling and its bound, jitter,
redirects, the endpoint, provider id validation, the response size cap,
result redaction, the key-in-message refusal, validation bypass, the
disabled transport's result, capture production refusal (transport and
configuration), capture clearing, idempotency, and isolation, ambient key
refusal, absolute paths, key-file permissions, `O_NOFOLLOW`, `O_NONBLOCK`,
regular-file and size checks, key and path redaction, the Windows refusal,
descriptor closing, header-field control characters, extra fields, recipient
validation, the purpose prefix, unsafe markup, the link origin, secret-like
metadata, the HTML alternative, console logging, environment reads, and a
second endpoint. The first pass killed 49 of 51: the pre-attempt deadline
check survived because no test overran a sleep, and a new test now kills it.
The one remaining survivor, removing the control-character check on
addresses, is equivalent: the address character classes already exclude
every control character, so the check is kept only as defence in depth.

Not verified:

- Any real Resend request, key, domain, delivery, bounce, or dashboard
  tracking setting, all of which are prohibited in this checkpoint.
- The transport wired into the server, used by a workflow, or audited.
- Behaviour against Resend's real error bodies and quota responses. The 409
  classification is tested only against synthetic bodies shaped as the
  official documentation and SDK describe.
- File-ownership matching for the key file, which is deliberately not
  enforced.

## Phase 2C Owner-managed Admin invitations (checkpoint 4B1): local verification

Status: **implemented and verified against disposable PostgreSQL 18.6
databases only, on exact Node 24.20.0.** This is not production verification
and satisfies no DEC-443 item. Only the Owner's side exists; invitation
acceptance and Admin enrolment are not implemented. No real invitation,
account, or email exists: every identity is synthetic, every address uses a
reserved `.test` or `.invalid` domain, and every email went to the capture
transport or a scripted fake. Design and limits:
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md#implemented-invitation-issuance-phase-2c-checkpoint-4b1-local-development-only).

**RED first.** The token, email, route-classification, and audit-writer unit
tests and the 43-test integration file were written before any
implementation. The RED run failed every new unit test on a missing module,
the unrecognised `owner` classification, the missing routes (404 instead of
401), or the audit writer's missing `invitationId`; the integration file
failed to load on the missing service module. Three existing tests that
enumerate the migration ledger, audit columns, and the full route table were
then updated deliberately for migration `0008` and the four new routes.

Proven locally (unit: token 5, email 9, route access and audit additions;
integration: 44 tests in `admin-invitations.test.ts`):

- **Authorization.** Unauthenticated callers get 401 on all four routes with
  no database change, including without a database; an active, MFA-complete
  Admin gets 403 on all four; an untrusted or missing Origin gets 403 before
  any session work; a disabled Owner is refused at the route and the service;
  the service alone refuses an Admin actor (audited `forbidden`, four times)
  and an Owner whose MFA completion is missing.
- **Creation.** 201 with exactly the approved keys; the stored hash equals
  SHA-256 over the label and the token taken from the captured email; the
  lifetime is exactly 24 hours of database time; the response, the stored
  row, every audit column, and the logs contain no token, hash, link,
  delivery id, or (for audit and logs) address; tokens and hashes differ for
  every invitation; seven malformed bodies get `invalid_email` with no row or
  email; an address with an account is refused whatever its case; a second
  pending invitation is refused; eight concurrent creations produce one
  invitation and one email.
- **Delivery.** A retryable failure, a permanent rejection, an idempotency
  conflict, and a thrown transport error are each recorded as `failed` with
  the safe reason and audited, never as delivered, and the invitation stays
  pending and resendable; the disabled transport and no email configuration
  are recorded as `not_sent` (`email_disabled`); each invitation uses its own
  stable idempotency key `admin_invitation/<delivery id>`.
- **Resend.** New token and row; the old row becomes `superseded` with an end
  time; both emails' tokens match their own rows only; audit order is
  created, delivery accepted, superseded, resent, delivery accepted; one
  issuance per 60 seconds per email with a `Retry-After` of 1 to 60 seconds
  (58 seconds refused, 61 allowed); six issuances in 24 hours, then refused
  with a longer `Retry-After`, still refused after cancel and create, and
  allowed again after 24 hours; superseded, cancelled, unknown, and
  malformed ids refused (404 for the last two); six concurrent resends
  produce exactly one new invitation; a resend racing a cancellation ends as
  exactly one of the two outcomes in four rounds.
- **Cancellation and expiry.** Cancel ends the invitation once, a second
  cancel is refused, the database refuses reopening it, and a new invitation
  is allowed after the cooldown. A row 5 seconds before expiry is pending and
  5 seconds after is `expired`, swept and audited exactly once; a due row
  held by another transaction is still reported `expired`; resend and cancel
  expire a due row themselves.
- **Migration 0008.** One pending row per email; exact 24-hour lifetime;
  32-byte hash; status and delivery-status lists; `ended_at` tied to status;
  normalised email; unique hash; and a column list with nowhere to hold a
  token, link, provider id, or body.

Suites on exact Node 24.20.0 (disposable container, `npm ci` from the
committed lockfile, a copy of the Git-listed workspace files that excluded
`web/.env`, Docker-backed PostgreSQL 18.6): workspace typecheck clean; API
unit tests 456/456 (27 files); API integration tests 290/290 (13 files).
`npm audit` and `npm audit --omit=dev` report 0 vulnerabilities, and no
manifest or lockfile changed. On the host: Playwright 12/12, the Android
typecheck clean, and the Android suite 537/537. One Android run made while the
integration suite was loading Docker timed out a single 5-second test; the
suite was rerun alone and passed completely.

**Mutation testing (32/33 killed, one equivalent).** Thirty-three targeted
mutations were each applied alone in the container's copy, with the named
test files run and the file restored and confirmed identical by SHA-256:
storing the raw token; dropping the hash label; a 128-bit token; a token in a
query string; an idempotency key derived from the token; a 48-hour lifetime
at insert, and with the lifetime constraint loosened; the due check late by
an hour; the expiry sweep disabled; a locked row never expiring; the
effective `expired` status hidden; no supersession; the advisory lock
removed; the route and the service Owner checks each removed; MFA completion
ignored by the service; the Owner Origin check removed; a delivery id leaked
in the response; the cooldown removed; the daily limit raised or counting
resends only; the account check removed; the disabled transport or a crash
claiming delivery; extra body fields accepted; cancel skipping its pending
check; the one-pending index made non-unique; the ended-status trigger
removed; the audit losing the invitation reference, in the service and in the
writer; an unknown id reported as not pending; and normalisation keeping case.
The first pass killed 31: hiding the effective `expired` status survived
because every list swept first, so a test now holds the row in another
transaction and the mutation is killed. The remaining survivor, dropping
`status = 'pending'` from the cancel `UPDATE`, is equivalent: the same
transaction has just checked the status under a row lock, and the trigger
refuses any change to an ended row.

Not verified:

- Any real delivery, provider, or configured sending identity.
- Acceptance, enrolment, or use of an invitation (checkpoint 4B2).
- Recovery of a row left in `sending` by a crash between the two
  transactions (documented as outcome unknown, not reconciled).
- Behaviour under a least-privilege runtime database role, which is not
  provisioned.

## Phase 2C password reset (checkpoint 4C): local verification

Status: **implemented and locally verified on exact Node 24.20.0 in a
disposable container (2026-09-26), after an earlier provisional pass on the
Windows host. Not production-verified.** No real account, reset, or email
exists; every email went to the capture transport.

**Authoritative run (Owner-authorised, 2026-09-26).** A temporary directory
held exactly 152 files: the Git-tracked `web/` files plus the 23 new 4C
files, with `.env`, `.env.*` (including `.env.example`), `node_modules`,
`.git`, caches, logs, outputs, APKs, and everything outside `web/` excluded.
The list was printed and checked before copying, and the copy was scanned
for excluded paths and secret-shaped content before Docker started (the only
matches were an error-code name, the synthetic test-key generator, and a test
string asserting that key-shaped content is refused). It was mounted
read-only into disposable `node:24.20.0-trixie-slim` containers with the
Docker socket for Testcontainers only; no development database or volume was
mounted, and nothing was uploaded. The per-file SHA-256 list, the working
tree checked against it afterwards (identical), and both run logs are kept
with the session record; the copy and the containers were then removed, and
every pre-existing container, image, and volume was confirmed unchanged.

| Step (Node v24.20.0) | Result |
|---|---|
| `npm ci` from the committed lockfile | 406 packages; lockfile byte-identical afterwards |
| Workspace typecheck | Exit 0 |
| API unit, including the POSIX key-file permission tests | **530/530** |
| API integration against disposable PostgreSQL 18.6 | **395/395**, including `password-reset.test.ts` 23/23 |
| Measured timing, full run | medians 10.96 to 12.71 ms (spread 1.76 ms); alone, 12.84 to 13.78 ms (spread 0.94 ms) |
| Unit mutations | 19/20 killed; U11 equivalent (as below) |
| Integration mutations | 17/22 killed; five redundant-layer survivors (below) |
| Container copy after all 42 mutations | Byte-identical to the source |
| Leftover Better Auth verification rows after a reset | **0 in 10 of 10 repeated runs**, and none in the full run |
| Playwright | Not run in the container: the slim image has no browsers, and installing them was outside the approved network scope. The host result (51/51) stands |

The four host sign-in failures **did not occur** on Node 24.20.0, where the
API and PostgreSQL share one clock, confirming the clock-skew diagnosis
below; the two host-only Node 22 child-process failures also passed.

**Tests written for 4C:**

| File | Covers |
|---|---|
| `tests/unit/password-policy.test.ts` | NFKC and case normalisation; derivation (length window, dedupe, sort, CRLF); provenance; the committed file normalised, unique, sorted, and matching its pinned hash; a tampered file refused; length boundaries; every committed entry refused in any case; NFKC-padded passwords refused; no trimming |
| `tests/unit/password-policy-boundary.test.ts` | Exactly three modules write a new password to Better Auth, each applies the policy; no other Better Auth password API is called; the hash function carries no policy |
| `tests/unit/password-reset-token.test.ts` | 256 bits, base64url, uniqueness, labelled hash, no collision with invitation or plain hashes, shape checks |
| `tests/unit/password-reset-email.test.ts` | Message validation passes; fragment-only link on the configured origin; no token in metadata; delivery-bound idempotency key; 30 minutes, single use, "not changed", authenticator reminder, DEC-442 sentence; no business terms; password-changed content |
| `tests/unit/password-reset-queue.test.ts` | Offer never runs the job in the caller; capacity drop; one-at-a-time order and drain; error name only; close |
| `tests/unit/password-reset-boundary.test.ts` | The write capability's single importer, sole export, no handler, no environment, pinned settings, Better Auth construction allowlist, hashed identifiers in the runtime config, every Better Auth reset route a 404 |
| `tests/unit/route-access.test.ts`, `auth-http.test.ts`, `security-audit.test.ts`, `owner-input.test.ts`, and two boundary tests | The ninth classification and the three routes; Origin refusals with `no-store` and `no-referrer`; the credential-change gate rule at the exact millisecond boundary; the reset audit reference and vocabulary; `common_password` at Owner activation |
| `tests/integration/password-reset.test.ts` (23 tests) | End to end; the Owner; a pending invitee; neutral responses with the queue held (no row, audit, or email before release); cooldown, supersession, hourly and global limits; per-source `429`; queue overflow; expiry at 29:54 and 30:00; replay; five concurrent completions; unknown tokens unaudited; disabled after issue; password policy without using up the link; failed delivery; write failure; a crash after the claim, the claim-window refusal, and the sweep; a surviving session audited; no secret in logs or audit; hostile `Host`; hashed, short-lived Better Auth identifier; measured timing |
| `tests/integration/invitation-acceptance.test.ts` (+1, +1 case) | A pending invitee's reset ends its setup session and setup resumes only with the new password; a common password refused at setup |
| `tests/integration/owner-recovery.test.ts` (+1) | A reset during an Owner recovery ends the recovery session and restores nothing |
| `tests/integration/dromex-migrations.test.ts` (+10) | Migration `0010`: columns, hash and lifetime checks, one open reset per account, lifecycle trigger, failure reason, delivery status once, forward-only `credentials_changed_at`, audit vocabulary and reference, no rewrite of existing principals, idempotence |
| `e2e/password-reset.spec.ts` (8 tests × 3 widths) | Neutral confirmation and focus; rate limit, network failure, empty address; `dir="ltr"`, autocomplete, no overflow; the home-page link; fragment removal from the address bar and history, POST-body-only token, no Referer, no storage, no off-origin request; the generic unusable-link and missing-fragment states; client checks and every server refusal with the token kept in memory; linked error descriptions |

**Provisional host results (2026-09-26, before the authoritative run;
Windows host, Node 22.17.1, Docker Desktop 28.5.1):**

| Suite | Result |
|---|---|
| Workspace typecheck (`api`, `web`) | Clean |
| API unit | 517 passed, 11 skipped, 2 failed: the two known host-only Node 22 failures spawning a `.ts` child process (`ERR_UNKNOWN_FILE_EXTENSION`), unrelated to 4C |
| API integration | 391 of 395 passed; `password-reset.test.ts` 23/23. The 4 failures were sign-ins refused just after a fixture stamped `mfa_completed_at` with the database clock (below); a different set failed on the previous run |
| Playwright | 51/51 (17 tests × 375, 768, 1280 px) |
| Android typecheck | Clean |
| Android suite | 1,433 of 1,435 on a loaded machine; the two failing files (`demo-backup`, `financial-overview-index`) passed 5/5 when rerun alone. No file outside `web/`, `docs/web/`, and `requirements/decisions.md` changed |
| Manifests and lockfile | Unchanged |

**Measured timing on the host** (40 interleaved rounds per account type, real
scheduler, 2026-09-26; Node 24.20.0 figures are in the table above): median / 95th percentile in ms: known 5.57 / 7.25,
unknown 5.59 / 7.03, disabled 5.77 / 6.98, pending 5.83 / 7.05,
principal-less 5.71 / 7.34. The medians differ by at most 0.26 ms; the test
fails above 10 ms. The structural test additionally proves nothing is looked
up before the response.

**Host clock skew, measured.** The disposable PostgreSQL clock was 443 to
444 ms ahead of the Windows host clock (five samples, 4 to 18 ms round trip).
Better Auth sets a session's `createdAt` from the API process's clock, so a
database-clock stamp compared with it can refuse a session created within
that margin. This is why `credentials_changed_at` is stamped from the API
clock (DEC-487), and it explains the intermittent host-only sign-in failures
earlier checkpoints recorded without investigating: the fixtures and
`mfa_completed_at` still use the database clock. Inside one container host,
as on the VPS, the clocks agree.

**Mutation testing.** Each mutation was applied alone, the named tests run,
and the file restored and confirmed byte-identical by SHA-256, first on the
host (`git status` unchanged afterwards) and then repeated on Node 24.20.0 in
the container's own copy (identical to the source afterwards). The Node
24.20.0 results are authoritative and are the ones below; they differ from
the host only for I20, see the correction.

- Unit, 19 of 20 killed: blocklist lookup, NFKC length, letter case, hash
  verification, the Owner draft and invitation port checks, the hash label,
  a 128-bit token, a query-string token, a token-derived idempotency key,
  an unbounded queue, a job run in the caller, an error message reported,
  the gate rule and its boundary, the Origin check, the audit reference,
  plain runtime identifiers, and sessions kept after reset. **Equivalent:**
  removing "within 30 minutes" from one line leaves the expiry stated in the
  next.
- Integration, 17 of 22 killed: an awaited lookup, disabled or pending
  eligibility, a replayed link (with and without the claim row check),
  supersession, cooldown, the global limit, the policy after the claim, the
  first credential stamp, the claim-time session hook, plain Better Auth
  identifiers, a logged token, a hostile link origin, a failed delivery
  reported as accepted, the abandoned-claim sweep, and a reset that alters an
  invitation. **Survivors, all redundant layers:** the per-row expiry check
  (the sweep that precedes it already ends the row); the second credential
  stamp (the session hook refuses every session during the claim); the
  per-account completion lock (the row lock and status check already enforce
  single use); and the Owner recovery and invitation setup-session rules
  (Better Auth's deletion already removed those sessions; the rules are the
  backstop if it does not).
- **Correction (I20).** On the host, removing the rule from the Owner
  recovery gate appeared killed. On Node 24.20.0 it survives: the host
  failure came from the clock-skew sign-in refusal, not from the mutation, so
  the host result was a false kill.

**Test-first discipline, stated plainly.** The password policy, audit
writer, gate rule, route classification, token, and email modules were
driven by failing tests first. The queue, the service, the migration, and
the reset identity were written before their tests (the migration tests
could not run while Docker was stopped); the mutation results above are the
evidence that those tests can fail.

**The leftover verification row.** In one of five host runs, one Better
Auth verification row was seen after a completed reset; it was not
reproduced on the host afterwards, nor in 11 Node 24.20.0 runs (10 repeated
diagnostic runs and the full suite), and its cause is not identified. The
test asserts the property that matters for any row present: its identifier
is a SHA-256 hash, never `reset-password:<token>`, and it expires within 60
seconds. The token behind it exists only in server memory, and every Better
Auth reset route is a 404, so it cannot be used from outside.

**Not verified:** Playwright on Node 24.20.0 (host only); any real delivery
or configured sending identity; production headers and CSP; behaviour under
a least-privilege runtime database role; a physical reset rehearsal.
**Not production-verified.**

## Phase 2C running-server email configuration (checkpoint 4D): local verification

Status: **implemented and locally verified on exact Node 24.20.0 (DEC-489);
not production-verified.** Final verification is recorded at the end of this
paragraph block (2026-09-29). The table below
records the 2026-09-27 run. The tests changed on 2026-09-28 (the
runtime-compatibility correction was narrowed to two classes, a focused
compatibility test was added, and the provider-failure test was split per
scenario), and the reruns that day on a heavily loaded host were not green:
failures rotated across timing-, TOTP-, and rate-limit-sensitive tests
outside 4D. One 4D test, the six-scenario provider-failure test, exceeded its
120-second budget once and was then split per scenario; in the run after the
split no 4D test failed.

In a later session on 2026-09-28 (host CPU 26 to 42 per cent, 4.5 GB free),
the valid results
were: Node 24.20.0 unit **574/574**; unit mutations **19/19 killed**
(including R01 and U15, which restore the parameter properties), tree
byte-identical afterwards; host typecheck clean; host API unit 555 passed,
17 skipped (POSIX-only), 2 known Node 22 `ERR_UNKNOWN_FILE_EXTENSION`
failures; Playwright **51/51**; `npm audit` 0 vulnerabilities. The full
integration suite failed 49 of 405 (all ten 4D integration tests passed),
and the failing tests changed on every rerun. The cause was measured: a
monitor inside the container logged the Docker VM's wall clock stepping by
about 60,913 seconds (roughly 16.9 hours) back and forth 21 times in about
six minutes, relative to the monotonic clock. TOTP codes, sessions, and
rate-limit windows checked across such a step fail at random. The committed
HEAD `fc63764` showed the same failures in the same environment, and no code
defect was demonstrated, so no code was changed.

**Final verification (2026-09-29), after Docker Desktop and WSL were
restarted.** A clock check ran before any test: over 150 seconds an
in-container monitor saw 0 wall-clock steps (largest deviation from the
monotonic clock 11 ms), and 11 host-versus-container samples stayed within 38
to 225 ms, inside the sampling round trip. On exact Node 24.20.0 with
disposable PostgreSQL 18.6, from a 154-file copy byte-identical to the
working tree: the complete integration suite passed **405/405** in one run
(16 files, including all 10 `email-runtime.test.ts` tests), and the six
integration mutations I01 to I06 were **all killed**, with the tree
byte-identical afterwards. Totals across 4D: unit 574/574, integration
405/405, mutations **25/25** killed (19 unit, 6 integration). The npm install
twice skipped the Linux Rolldown binding on a slow network; the runner now
checks for it and retried. Docker's containers (10), volumes (14), and images
(15) matched the baseline afterwards, and the throwaway npm cache volume was
removed. **Not production-verified.** No
real provider, account, key, secret file, sending identity, or email exists;
every key was a generated synthetic value in a temporary file, and every
Resend request went to a scripted in-memory `fetch`. No schema change: no
migration file changed, and the delivery states and the `email_disabled`
reason already existed (migrations `0008`, `0010`).

**Authoritative run (Node v24.20.0).** A temporary directory held exactly 154
files: the Git-tracked `web/` files plus the 2 new 4D test files, with
`.env`, `.env.*` (including `.env.example`), `node_modules`, `.git`, caches,
logs, outputs, APKs, and everything outside `web/` excluded. The list was
checked before copying and the copy scanned for secret-shaped content (the
only matches were error-code names, labelled synthetic test strings, and the
development Compose file's variable interpolation). It was mounted read-only
into disposable `node:24.20.0-trixie-slim` containers with the Docker socket
for Testcontainers only; no development database or volume was mounted. The
working tree matched the copy's per-file SHA-256 list afterwards (154 of 154),
the copy was removed, and Docker's containers (10), volumes (14), and images
(15) were identical to the list recorded before the run.

| Step (Node v24.20.0) | Result |
|---|---|
| `npm ci` from the committed lockfile | Lockfile byte-identical afterwards |
| Workspace typecheck | Exit 0 |
| API unit, including the POSIX key-file and real-process startup tests | **571/571**, none skipped |
| API integration against disposable PostgreSQL 18.6 | **400/400** (Testcontainers' Ryuk reaper disabled; see below) |
| Unit and integration together, final run | **971/971** |
| `tests/integration/email-runtime.test.ts` alone | 5/5 |
| Mutations | **24/24 killed**; the container's copy byte-identical afterwards |
| Playwright | Not run in the container (no browsers in the slim image); host result below |

**Integration runs, stated plainly.** The first full integration run passed
399 of 400; the one failure was not identified because the output was
filtered. The second run failed across 16 files with `Connection terminated
unexpectedly` at `CREATE DATABASE`: the disposable PostgreSQL container was
ended mid-run, consistent with Testcontainers' Ryuk reaper losing its session
through `host.docker.internal`. With Ryuk disabled (the global setup already
stops the container on teardown, and no container was left behind), the
suite passed 400/400, and the final combined run passed 971/971.

**Host results (Windows, Node 22.17.1, Docker Desktop 28.5.1):**

| Suite | Result |
|---|---|
| Workspace typecheck (`api`, `web`) | Clean |
| API unit | 552 passed, 17 skipped (POSIX-only), 2 failed: the two known host-only Node 22 failures spawning a `.ts` child (`ERR_UNKNOWN_FILE_EXTENSION`) in `owner-command` and `owner-recovery-command`, confirmed by their error code |
| API integration | 15 failures in sign-in-dependent tests across 7 files (the documented host clock-skew pattern, 4C above); the new disabled-mode test was among them once and passed when rerun alone |
| Playwright invitation and password-reset suites | 39/39 (13 tests × 375, 768, 1280 px). The first cold run failed 6 tests at 375 px only; that project then passed 13/13 and the full rerun 39/39. No `web/apps/web` file changed |
| Android typecheck | Clean |
| Android suite | 1,435/1,435 (106 files). An earlier run under load failed three backup-related files, which passed 38/38 alone; no Android file changed |
| `npm audit` (web workspace) | 0 vulnerabilities |
| Manifests, lockfiles, migrations | Unchanged |

**Test-first evidence.**

- **RED.** Before any implementation, 32 new tests failed because
  `loadEmailSettings` and `createEmailDelivery` did not exist and
  `RuntimeConfig.email` was undefined, and every real-process startup test
  failed. The startup failures exposed a pre-existing defect:
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, because TypeScript parameter
  properties in `owner-recovery.ts` and `admin-invitations.ts` cannot run
  under Node's type stripping. A link-origin test failed because
  `https://*.example.test` was accepted.
- **Runtime-compatibility correction, verified on exact Node 24.20.0.**
  Against the committed code (`fc63764`), plain Node 24.20.0 refused
  `server.ts`, `admin-invitations.ts`, `owner-recovery.ts`, and
  `owner-mfa-reset.ts` with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, and the real
  entry point exited before listening; the two terminal commands loaded.
  After converting only the two classes on the server's import path, the
  same check showed those modules loading and the real entry point listening
  (`/health` 200, `emailDelivery: "disabled"`); `owner-mfa-reset.ts`, which
  no production path imports, is deliberately unchanged and still refused.
  An earlier draft also converted it and added `erasableSyntaxOnly` to the
  API `tsconfig.json`; both were reverted to the committed content. The
  focused test (`runtime compatibility of the production import path`, 3
  tests) fails when either conversion is undone (R01, U15).
- **GREEN.** Each was then made to pass by the implementation. Four failures
  after the first implementation were mistakes in the tests themselves (a
  display name of `DROMEX` that also appears in every setting name, and a
  provider case that kept a key-file path and so hit an earlier, correct
  refusal); they were corrected without changing the code under test.
- **Guards, not RED.** The three new boundary tests (business modules behind
  the provider-neutral interface; `process.env` only in the entry block and
  the offline schema tool; no email, debug, or webhook route) passed on first
  run, because they describe properties the code already had. Mutations U16
  and U17 show they fail when those properties break.

**Tests written for 4D:**

| File | Covers |
|---|---|
| `tests/unit/email-config.test.ts` (+16) | Disabled by default in every environment; complete Resend settings holding only the path; optional display name; partial configuration naming the missing setting; public settings without a provider refused, never a fallback; `capture` refused in the running server; unsupported provider or enabled-flag values; invalid sender, display name, Reply-To, and link origin without echo; HTTPS in production; the trusted-origin rule; a key pasted into a public setting; a directly supplied key in either mode; only the given environment read |
| `tests/unit/email-transports.test.ts` (+5) | Disabled builds nothing, opens nothing, and uses no network; Windows refused without opening; `capture` refused by the builder; on POSIX, the key read exactly once with `O_NOFOLLOW` and `O_NONBLOCK`, the identity returned, no request at creation, and the key never exposed; missing, empty, oversized, group- or world-readable, symbolic-link, directory, FIFO, two-key, and non-UTF-8 files refused with fixed messages naming neither the path nor the content (an unreadable file too when not run as root) |
| `tests/unit/runtime-config.test.ts` (+5) | Email disabled by default; Resend settings carried with the path only; the link origin checked against the parsed trusted origins; partial and ambient configuration refused without echo; the ambient process environment never read |
| `tests/unit/email-boundary.test.ts` (+3) | Business modules import only the message and result types; `process.env` only in the entry block and the schema tool; no email, debug, or webhook route |
| `tests/unit/server-email-startup.test.ts` (new, 12) | In process: disabled startup opens nothing and uses no network; route surface identical to a server built without email; with Resend (POSIX) the key is read once, nothing is sent, `/health` and `/ready` answer without the provider, and neither logs nor `/ready` reveal email configuration; an insecure key file fails closed. As a real process with an explicit environment only: disabled startup answers `/health`; partial, settings-without-provider, direct-key, `capture`, and unopenable-file configurations exit 1 with one line and no stack, value, or path; on POSIX a valid synthetic key file starts and a `0644` file is refused |
| `tests/integration/email-runtime.test.ts` (new, 5) | Configuration parsed from an explicit environment object: disabled mode records invitations and resets as `not_sent` and contacts nothing; Resend mode sends the invitation, reset, and password-changed emails through one transport with the configured sender, Reply-To, and origin despite a hostile `Host`, reads the key once, and logs no key, path, token, body, or password; 503, timeout, 422, 401, in-progress 409 then success, and conflicting 409 recorded truthfully with one idempotency key and a byte-identical body per logical email; the public reset response identical for known, unknown, and disabled addresses while only the known account reaches the provider; `/health` and `/ready` without provider calls |

**Mutation testing** (each applied alone to the container's copy, the named
tests run, and the file restored and verified by SHA-256; all 24 killed):

- Settings: accepting public settings while disabled (U01); accepting
  `capture` (U02); dropping the trusted-origin rule (U03); dropping the
  secret-like check (U04); making Reply-To optional (U05); skipping sender
  address validation (U06) or display-name validation (U07); an error that
  repeats the sender (U08); taking the first trusted origin instead of the
  configured one (U09).
- Shared rules: accepting a `*` host in the link origin (U10); widening the
  key-file permission mask so world-readable files pass (U18).
- Composition: building a transport in disabled mode (U11); ignoring email
  settings in the runtime configuration (U12); an entry point that bypasses
  `buildServerFromConfig` (U13); logging the email settings (U14);
  reintroducing a parameter property on the entry point's import graph (U15).
- Boundaries: an invitation module reading `process.env` (U16); the
  password-reset module importing the Resend transport (U17).
- Integration: the server dropping the built delivery (I01); password reset
  given no delivery (I02); the password-changed link built from another
  origin (I03); a new idempotency key per attempt (I04); four attempts
  instead of three (I05); disabled delivery recorded as provider-accepted
  (I06).

**Not verified:** any real provider call, key, secret file, or sending
identity; the production Docker Compose secret mount (its owner and mode
inside the container, and the `node` user ID, are operational checks);
Playwright on Node 24.20.0; the unreadable-file refusal under Node 24.20.0,
because the container ran as root; behaviour under a least-privilege runtime
database role. **Not production-verified.**

## Phase 2C Owner account and session management (checkpoint 4E): local verification

Status: **implemented and locally verified on exact Node 24.20.0 in
disposable containers (2026-09-29 and 2026-09-30; DEC-490, pending Owner
review). Not production-verified.** No real Owner, Admin, session,
invitation, or email exists. Every identity was synthetic, every address used
a reserved test domain, and email went only to the capture transport.

**Clock and environment.** Before any time-sensitive test, a 120-second
in-container monitor saw 0 wall-clock steps (largest deviation 110 ms from
the monotonic clock). A monitor inside each verification container ran for
the whole run and again recorded 0 steps. Docker Desktop 28.5.1. The copy
held exactly the 169 Git-tracked and new `web/` files, with `.env*`,
`node_modules`, and caches excluded. It was scanned for secret-shaped content
(the only matches were error-code names, the synthetic test-key prefix, and a
test asserting that key-shaped content is refused), mounted read-only with the
Docker socket for Testcontainers only, and confirmed byte-identical to the
working tree by SHA-256. No development database or volume was mounted.

| Step (Node v24.20.0) | Result |
|---|---|
| `npm ci` from the committed lockfile | Exit 0; lockfile byte-identical afterwards |
| Workspace typecheck (`api`, `web`) | Exit 0 |
| API unit, including the POSIX key-file tests | **618/618** |
| API integration against disposable PostgreSQL 18.6 | **437/437**, including `admin-accounts.test.ts` 16/16 and `dromex-migrations.test.ts` 65/65 |
| Mutations | **32 of 35 killed**, every file restored byte-identical (below) |
| Playwright (Windows host) | **96/96** (32 tests × 375, 768, 1280 px), 45 of them new |
| `npm audit` (web workspace) | 0 vulnerabilities |
| Android typecheck | Clean; no Android file changed |

**One run was not clean, and why.** The first full integration run of the
final tree passed 437 of 437 but exited 1. After the last migration test,
PostgreSQL's `57P01` ("terminating connection due to administrator command")
reached a pool client with no error listener. That is the file's existing
teardown, `pool.end()` followed by `DROP DATABASE … WITH (FORCE)`, racing
a connection that was still closing. The file then passed 65 of 65 in five
isolated runs with no error, and one further full run passed 437 of 437 with
no error. No code was changed for it. It is recorded below as a known
intermittent harness race.

**Test-first evidence.** Each layer was written test-first and seen failing
for the expected reason before its implementation existed. Unit: 15 failures
plus two missing modules (the audit fields and vocabulary, the gate rule, the
refusal audit, the route surface, the reason rule, the session-control
boundary). Integration: 19 migration failures and a suite that could not
start (`sessions_revoked_at` did not exist). Playwright: 15 of 15 failing
with no page. Two later additions were closed by mutations instead: the
direct use-case authorization test (mutation I01) and the rule that
re-enabling deletes nothing (I05b, which restores the earlier behaviour and
is killed).

**Tests written for 4E:**

| File | Covers |
|---|---|
| `tests/unit/account-reason.test.ts` | Trimming; Arabic and mixed direction; 3 and 500 character boundaries measured in code points; missing, non-string, blank, line breaks, tabs, NUL, C1, bidirectional overrides, embeddings, isolates, lone surrogates |
| `tests/unit/session-control-boundary.test.ts` | Server is the sole importer; one export; the only module reaching `$context` or `internalAdapter`; exactly three session operations and no SQL; deletes only the named user's session by identifier, never an outside token; revoke-all reports what remains |
| `tests/unit/auth-http.test.ts` (+) | The `sessions_revoked_at` rule at the exact millisecond; Owner-route refusals audited with actor and address only; still refused when auditing fails; no audit or admission without a usable session, for disabled, pending, or revoked principals; the Owner admitted unaudited; the new required dependency |
| `tests/unit/security-audit.test.ts` (+) | Target and status-change references written; closed account vocabulary; free-text, address-shaped, overlong, and numeric references refused before any statement |
| `tests/unit/route-access.test.ts`, `owner-provisioning-boundary.test.ts` (+) | Exactly six new `owner` routes (plus HEAD); every one refused without a session and every write refused from a missing or foreign Origin, before any database work |
| `tests/integration/admin-accounts.test.ts` (16) | The list and detail with exact safe key sets and no token, identifier, address, or agent; honest unknowns; opaque session references; an Admin refused and audited on all seven attempts; missing, forged, and cross-origin callers; the use case refusing an Admin and an MFA-incomplete Owner without the guard (DEC-428); reason validation; disable locking the Admin out of sessions, sign-in, reset, and re-invitation; re-enable never reviving a session even after a failed cleanup; Owner self-action refused; pending and missing targets; one-session and all-session revocation, including another Admin's session through the wrong account; concurrent disables, revocations, and re-enables; no reason, session value, password, or address in any audit row or log |
| `tests/integration/dromex-migrations.test.ts` (+) | Migration `0011`: forward-only `sessions_revoked_at`; the status-change columns; every reason and self-change refusal in the database; append-only history; restricted foreign keys; the audit vocabulary and references; no rewrite of existing principals; idempotence. The `0010` idempotence and preservation tests are now bounded to `0010`, as the `0009` ones already were |
| `tests/integration/auth-flow`, `owner-recovery`, `principal`, `rate-limit-storage` (+) | The migration count and ledger, the audit column list, and the principal shape |
| `e2e/accounts.spec.ts` (15 × 3 widths) | Grouped states with text and shape; empty, failed, and retried loads; signed-out and Admin visitors refused without calling Owner routes; invite, resend, and cancel through the existing routes; keyboard opening with a visible focus ring; honest facts; disable, re-enable, and both revocations only after a confirmation that names the person, with exact request bodies; Escape and focus return; server refusal and refresh; ended session and network failure; long, Arabic, and mixed-direction text within the viewport |

**Mutation testing.** Each mutation was applied alone to the container's own
copy, the named tests run, and the file restored and confirmed byte-identical
by SHA-256.

- Unit, 12 of 13 killed: the gate cut-off and its boundary; the guard's
  refusal audit, and admitting when that audit fails; the audit target and
  status-change reference; the reason's bidirectional, length, and trim
  rules; single revocation by an outside identifier; revoke-all's remaining
  count; the `owner` route classification. **Survived, equivalent:** U11
  removes the owning-user filter inside session control, but Better Auth's
  `listSessions(userId)` already returns only that user's sessions.
- Integration, 20 of 22 killed: the use case's Owner check; the
  `sessions_revoked_at` stamp; disable cleanup; re-enable not cleaning up;
  single deletion; the service's reason check; the active-only disable;
  the disable audit; the cleanup-incomplete audit; strict bodies; the session
  list's cut-off; the row lock (the concurrency test); the server's refusal
  audit; the Owner hidden from the list and the detail; and four database
  rules (bidirectional reasons, self-change, a backwards stamp, rewritten
  history). **Survived, redundant layers:** I02 and I03 each remove one of
  the two Owner self-protection checks, and the other still refuses. I21
  removes both together and is killed.

**Other scans.** No `debugger`, `.only`, `.skip`, `console.log`, or TODO
marker in the changed files; no trailing whitespace or mixed line endings; no
temporary file left (the one visual-capture spec was deleted after use); no
historical DROMEX or Android migration changed; no manifest, lockfile, or
Compose file changed. A scan for invisible characters found literal
bidirectional control characters in five files, introduced by an editing
tool that turned `U+202E`-style escapes into the characters themselves. All
eight lines were converted back to visible escapes with identical behaviour,
and the final scan is clean. The Resend transport is exercised only against a
scripted in-memory `fetch`, and the account suite uses the capture
transport, so no real network email request can occur.

**Docker, before and after.** Every pre-existing container, volume, and image
is unchanged. One exited verification container that this checkpoint created
(`dromex-4e-final`) was left in place, because the session's rules forbid
deleting containers.

**Known limits:** the teardown race above; Playwright runs on the Windows
host only (the slim Node image has no browsers); the pages are verified
against a stubbed API, and there is no web sign-in screen; behaviour under a
least-privilege runtime database role is not verified. **Not
production-verified.**

## Planned tests: email, Admin invitations, and password reset

Status: **planned design, now covered by checkpoints 4A to 4C (DEC-439
through DEC-442).** The transport-level rows
below (provider failure, secret handling, webhooks) are now covered by
checkpoint 4A above, and the Owner-side invitation rows (issuance, expiry,
supersession, cancellation, delivery failure, audit, content) by checkpoint
4B1; the acceptance and enrolment rows by checkpoint 4B2; and the reset,
enumeration, session, and page rows by checkpoint 4C (above; Node 24.20.0,
Playwright on the host). Governing design:
[authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md#14a-transactional-email-admin-invitations-and-password-reset).

**No real email in any test.** Automated tests use the deterministic capture
transport or the disabled transport, never the Resend transport and never a
provider key. A local email-capture service may be used for Playwright flows
only in disposable development environments, and choosing or installing one
is a separate approved step.

| Area | What is tested |
|---|---|
| Invitation lifecycle | Owner-only creation, resend, and cancellation; non-Owner and unauthenticated callers refused; one pending invitation per normalized email enforced by the database; 24-hour expiry under controlled time |
| Invitation tokens | Only a SHA-256 hash persisted; a resend makes the previous token fail; used, cancelled, expired, and superseded tokens all return the same generic response; the Owner screen and API never return a link |
| Restricted Admin enrolment | The inactive principal reaches no business route; only enrolment steps are reachable; activation happens only after a verified TOTP code; every session revoked afterwards; a fresh password-plus-TOTP sign-in is required |
| Reset lifecycle | Token single-use; hashed storage confirmed in Better Auth's verification rows; 30-minute expiry; a new request supersedes older tokens; no automatic sign-in; all sessions revoked; password policy enforced; MFA still required at the next sign-in; the Owner can reset and still cannot sign in without TOTP |
| Enumeration resistance | Identical status, body, and headers for known, unknown, disabled, and rate-limited addresses, and **measured** timing; a disabled account causes no send |
| Replay and concurrency | Concurrent acceptance of one invitation or concurrent use of one reset token: exactly one succeeds; lock-dependent tests fail when the lock is removed |
| Rate limiting | Limits by account and by network source, surviving a process restart |
| Session revocation | A session created before a reset or before enrolment completion is refused on its next request; a failed revocation fails closed and is audited |
| Audit redaction | Every lifecycle event recorded; no token, token hash, link, password, or provider key in any audit row or log line |
| Link and page security | Tokens only in the fragment; the POST body carries the token; links built from the configured origin even when a hostile `Host` header is sent; `Referrer-Policy: no-referrer`; no third-party request from invitation or reset pages (real browser) |
| Email content | Plain-text and HTML parts present; expiry stated; no business, role, permission, or secret content; no remote image or tracking; the "never emails sign-in links or asks for codes" statement present |
| Provider failure | Rejection, 429, 5xx, timeout, and lost response simulated against a local fake: at most three attempts within two minutes with one idempotency key; failure closed and audited; existing password-plus-TOTP sign-in unaffected |
| Secret handling | Configuration accepts only a secret-file path; a missing, empty, or over-permissive file refuses startup; errors name the setting, never the value; no key in the environment |
| Delivery status | No provider response or status changes an account, a principal, or a token |
| Webhooks | None exist; a test asserts no inbound webhook route is registered. Signature, timestamp, and duplicate tests are required only if a later decision adds one |

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
- [x] Email delivery mechanism chosen (OQ-161, closed by DEC-439 through
      DEC-442) — **approved design only, not implemented**
- [ ] Admin invitations, restricted Admin enrolment, and password reset
      implemented and verified by the planned tests above — **implemented
      and verified locally on Node 24.20.0 (checkpoints 4B1, 4B2, 4C);
      not production-verified**
- [ ] Owner account and session management (DEC-408, DEC-427, DEC-490):
      Owner-only list and detail, disable and re-enable with a reason, and
      one and all-session revocation — **implemented and verified locally on
      Node 24.20.0 (checkpoint 4E); not production-verified, and DEC-490 is
      pending Owner review**
- [ ] Email delivery production configured and physically verified by the
      Owner: Resend account created; current plan and terms confirmed,
      including whether the Free plan permits DROMEX's business use; the
      notification domain verified; SPF, DKIM, and DMARC configured; the
      monitored `Reply-To` mailbox in place; the secret file created; a real
      delivery test received
- [ ] A complete password-reset recovery physically rehearsed in production,
      and enabling the Owner activation command separately and explicitly
      approved. Together with the two items above, this is the DEC-443 Owner
      activation gate; local tests and documentation alone never satisfy it,
      and the terminal recovery command stays separately disabled
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
