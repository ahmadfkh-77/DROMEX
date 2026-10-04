# Production Gates

One page that says what must be true before real Owner activation and before
production, what evidence exists today, and what only the Owner can do. It
summarises and points to the detailed records; it creates no decision and
closes no open question. Where it disagrees with `requirements/decisions.md`,
the decision wins.

Written 2026-10-04 against `origin/web/phase2c-auth-foundation` at `8fbb023`.

## How to read the status column

Exactly one of these four values is used.

| Status | Meaning |
| --- | --- |
| Not started | Nothing exists, not even an approved design |
| Design only | A written design or decision exists; no working code or setup |
| Implemented locally, not production-proven | Code exists and passes tests against disposable databases, capture transports, stubs, or CI; nothing real has happened |
| Met with real evidence | Observed in the real production environment and recorded |

**No gate is currently "Met with real evidence."** Strict rules: a fake or
capture email sender is not real delivery; an email design is not a provider
account; local and CI tests are not production proof (DEC-443 (4)). CI
evidence counts for what it ran (DEC-491), and nothing it runs is production.

## Gate table

### A. DEC-443 Owner activation

DEC-443 (3) lists conditions (a) to (h). The Owner activation command refuses
every run until **all** hold. Terminal emergency recovery (DEC-437) is
separate: meeting this gate does not enable it.

| # | Gate: what must be true | Source | Status | Evidence required to call it Met | Who acts |
| --- | --- | --- | --- | --- | --- |
| A1 | DEC-443 (a), (b): password reset implemented and its enumeration resistance, token lifecycle, session revocation, MFA preservation, audit and failure behaviour verified | DEC-441, DEC-442, DEC-487, DEC-488; checkpoint 4C in [testing-and-production-readiness.md](testing-and-production-readiness.md) | Implemented locally, not production-proven | Local and CI test results already exist; the DEC-443 gate itself counts this as satisfied only locally. Production proof is gates A5 and A6 | Agent (done locally) |
| A2 | DEC-443 (c): a real email provider account exists (Resend, DEC-439), its current plan and terms are confirmed (including whether the Free plan permits DROMEX's business use), and its API key is delivered through the approved production secret-file mechanism | DEC-439, DEC-443 (3c), DEC-489 | Design only (the running server can read the configuration, DEC-489, but defaults to disabled and no provider, account, or key exists) | Owner-held account; key present as a secret file on the production host; startup in Resend mode succeeds there. The agent never sees the key | Owner (agent may only document) |
| A3 | DEC-443 (d): the authoritative sending domain has valid SPF, DKIM and DMARC | DEC-443 (3d), DEC-439 | Not started | DNS records published; provider shows the domain verified; a received test message shows SPF, DKIM and DMARC passing in its headers | Owner |
| A4 | DEC-443 (e): a monitored `Reply-To` mailbox exists | DEC-443 (3e), DEC-489 | Not started | The mailbox exists, someone reads it, and a reply to a test message arrives there | Owner |
| A5 | DEC-443 (f): a real invitation or a controlled test message is delivered successfully | DEC-443 (3f) | Not started | A message sent through the production configuration is received in a real inbox; the receipt is recorded | Owner (agent may prepare the procedure) |
| A6 | DEC-443 (g): a complete password-reset recovery is physically rehearsed | DEC-443 (3g), DEC-441 | Not started | A real reset executed end to end in production (request, receive, set a new password, old sessions ended, MFA still required), recorded | Both: the agent writes the rehearsal script; the Owner performs it |
| A7 | DEC-443 (h): enabling the Owner activation command receives its own separate, explicit approval | DEC-443 (3h) | Not started | The Owner's explicit written approval, after A2 to A6 and the gates in section B that the Owner chooses to require. Never inferred from other approvals | Owner |

### B. Other gates before real Owner activation or production

| # | Gate: what must be true | Source | Status | Evidence required to call it Met | Who acts |
| --- | --- | --- | --- | --- | --- |
| B1 | Terminal emergency Owner recovery rehearsed (lost authenticator via supported replacement or recovery code; last-resort reset only when supported recovery is impossible) | DEC-423, DEC-435, DEC-436, DEC-437 | Implemented locally, not production-proven (the command refuses every run; tested on disposable databases only) | A rehearsal against a disposable or test copy, then the Owner's separate approval to enable it for production, per DEC-437 (8). Production execution is Owner-only | Both |
| B2 | OQ-168: an invited Admin who verified an authenticator and lost it before setup finished has a recovery path | [OQ-168](../../requirements/open-questions.md) | Not started (open; no path exists today; the address cannot be activated) | An Owner decision, then an implementation with tests | Owner decides; agent implements |
| B3 | Session policy leftovers from OQ-160: `freshAge`, an absolute maximum session age, and a re-authentication window for sensitive Owner actions | OQ-160, DEC-493 | Not started (open; DEC-493 settled only `expiresIn` 12 h and `updateAge` 1 h, sliding, so 12 h bounds inactivity, not total age) | Owner chooses the closing wording; implementation and tests follow | Owner decides; agent implements |
| B4 | Idle rate-limit rows (`dromex_rate_limit`) are pruned in small bounded steps without changing any rate-limit decision (SEC-1b) | DEC-492 (a **proposal**, not accepted) | Design only. DEC-492 and its code exist only on the unmerged verification branch `verify/overnight-sec-1b` (`b2b67f3`, `7b4f8b8`); neither is on the feature branch, and DEC-492 is not in this branch's `requirements/decisions.md` | Owner accepts or changes the retention, batch size and timing; code merged and CI-verified | Owner decides; agent implements |
| B5 | CI security tooling adopted (secret, dependency, static analysis, container scanning) | OQ-165; options in section D | Not started. The workflow runs typecheck and tests only; "OQ-165 security tooling" is listed as not covered by CI. `npm audit` was run by hand for DS-1 (2026-10-04), not in CI | Owner decision; tool enabled; first clean result recorded | Owner decides; agent configures |
| B6 | Authorisation and permission model (template, per-user overrides, project scope, effective permissions, deny by default) proven | DEC-424, DEC-425, DEC-426, DEC-428, DEC-429 | Design only (route classification and default-deny exist; no permission model) | Tests of unauthorised access, Owner and Admin boundaries, per-user overrides, project scope, privilege escalation and IDOR, against real PostgreSQL | Agent |
| B7 | Web sign-in screen and Owner and account-management screens designed and built | [authentication-and-authorization-architecture.md](authentication-and-authorization-architecture.md) | Not started (no designed sign-in UI exists; stubbed browser API tests only) | Real-browser check of cookie flags, headers, and no auth value in `localStorage` or `sessionStorage` | Agent |
| B8 | Audit trail hardened: least-privilege runtime role and grants provisioned | DEC-430 | Implemented locally, not production-proven (trigger rejects `UPDATE`, `DELETE`, `TRUNCATE`; runtime role and grant not provisioned). This is not a guarantee against a database administrator | Role and grants applied in production and tested | Both |
| B9 | Business tables and business rules (migrated, reconciled, tested at realistic volume) | DEC-410, DEC-412, DEC-413; OQ-159 | Not started (no business table exists; OQ-159 open) | Reconciled record counts, identifiers, financial totals, payment statuses | Agent; Owner accepts |
| B10 | Android authentication and synchronisation | DEC-407; OQ-162, OQ-163 | Not started (open questions; Android unchanged) | Tests for duplicates, interruption, concurrent edits, conflict rejection; Android verified unaffected | Agent; Owner decides OQ-162/163 |
| B11 | Deployment and rollback rehearsed, including a rollback across an authentication-schema migration; HTTPS with a valid certificate | DEC-409; [docker-vps-strategy.md](docker-vps-strategy.md) | Not started (local development only; production topology planned, not built) | A real deployment and a real rollback, recorded | Owner (VPS access); agent prepares |
| B12 | Backups running off the VPS, encrypted, with failure alerting; a real restore performed | DEC-414, OQ-158; [backup-and-recovery.md](backup-and-recovery.md) | Not started (no backups exist; OQ-158 open) | A successful real restore meeting RPO one hour and RTO four hours; restore ends by revoking all sessions | Owner (infrastructure); agent writes runbook |
| B13 | Monitoring, structured logging and alerting in production | [testing-and-production-readiness.md](testing-and-production-readiness.md) | Not started | Alerts observed firing and reaching the Owner | Owner; agent configures |
| B14 | Production secrets handling: provider key, database credentials and session secrets as secret files, never in the repository, logs, URLs or client storage; rotation documented | DEC-439, DEC-489 | Design only (secret-file mechanism designed; no production secret exists) | Secrets present only on the host with restricted permissions; rotation rehearsed | Owner |
| B15 | Raw CI log visibility limit: the agent can read only public GitHub Actions run pages, not raw logs, and cannot re-run jobs | DEC-491; repository is public, so its logs are public | Not a gate to close; a standing limit. Consequence: a CI result the agent cannot read in full is reported as such, and the Owner reads raw logs when needed. Nothing CI runs may print secrets (the logs are public) | Owner reads raw logs or re-runs jobs on request | Owner |

## Owner-only actions

The agent must never do these. Each needs the Owner personally.

- Create or hold any account: email provider, domain registrar, DNS host, VPS
  host, GitHub settings; create or hold any API key, password, token, or
  recovery code.
- Create or edit DNS records (domain, SPF, DKIM, DMARC) and set up the
  `Reply-To` mailbox.
- Access, configure, deploy to, or restore on the VPS. The agent has no access
  of any kind.
- Place the provider key and other production secrets on the host.
- Sign in to GitHub: re-run jobs, read raw CI logs, change repository
  settings (for example enabling security features), delete verification
  branches.
- Create the real Owner, real Admins, or real invitations, and perform the
  real delivery test and the physical reset rehearsal.
- Run, or approve the running of, any production recovery command.
- Approve enabling the Owner activation command (DEC-443 (3h)). Approvals for
  other work never count as this approval.
- Decide the open questions (OQ-160, OQ-165, OQ-168, and others) and accept
  or reject proposals such as DEC-492.

## OQ-165 options (no decision)

**This is a menu, not a recommendation to adopt. The Owner decides OQ-165.**
The repository is public (see the CI-1 section of
[testing-and-production-readiness.md](testing-and-production-readiness.md)),
which affects cost. The agent cannot read the repository's current settings,
so "setting needed" is what the documentation says is required, not what is
currently on or off. All pages accessed 2026-10-04.

| Option | What it covers | Cost and usage impact | Repository setting needed | Official documentation |
| --- | --- | --- | --- | --- |
| Dependency review | Flags vulnerable dependency versions added or changed in a pull request; can block merging | Free for public repositories. Runs as a workflow job, so it uses Actions minutes | Dependency graph enabled; a workflow using the dependency review action | https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review |
| Code scanning (CodeQL default setup) | Static analysis of JavaScript/TypeScript for security flaws | No cost for public repositories. Runs through Actions; GitHub documents that it pauses scheduled scans after six months of inactivity | Settings, Advanced Security, CodeQL analysis, Default | https://docs.github.com/en/code-security/code-scanning/enabling-code-scanning/configuring-default-setup-for-code-scanning |
| Secret scanning | Detects hardcoded credentials (API keys, tokens, passwords) in the repository and in issues, pull requests, wikis and gists | Runs automatically and free for public repositories. The page fetched does not describe push protection, so that feature is not assessed here | Documented as automatic for public repositories; confirm in Settings | https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning |
| Dependabot alerts | Alerts when a dependency matches a GitHub-reviewed advisory; only reviewed advisories are covered | The page fetched states no price. No Actions minutes for alerts themselves | Enabled by a repository administrator; builds the dependency graph | https://docs.github.com/en/code-security/dependabot/dependabot-alerts/about-dependabot-alerts |
| Dependabot security updates | Opens pull requests that fix vulnerable dependencies; version updates (via `dependabot.yml`) are separate and keep dependencies current without a vulnerability | The page fetched states no price. Each pull request triggers the web CI workflow (Actions minutes). Pull requests would touch lockfiles, which DS-1 shows needs care | Dependabot alerts enabled, then security updates enabled; optional `dependabot.yml` | https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates |
| `npm audit` in CI | Reports known vulnerabilities in the dependencies in the lockfile; `--audit-level` sets the failure threshold and `--omit=dev` limits it to runtime dependencies | No cost beyond a few seconds in the existing workflow. It sends package names and versions to the npm registry. New advisories can fail an unchanged build on a later day | None. A workflow change (a CI change, so a separate approval) | https://docs.npmjs.com/cli/v11/commands/npm-audit |

Not covered by an official page above: container image scanning (listed in
OQ-165) has no option in this table yet; an official source would be needed
before one is proposed.

## Recommended order

Consistent with the master plan; each step needs its own approval, and the
order is a recommendation for the Owner to confirm.

1. **Sign-in screen** (B7): the web sign-in, with real-browser header and
   cookie checks.
2. **SEC-1b v2** (B4): the Owner decides DEC-492's values (or changes them);
   then the pruning is built and CI-verified. Session leftovers (B3) and OQ-168
   (B2) can be decided at the same time.
3. **Remaining gates:** CI security tooling (B5) after the Owner's OQ-165
   choice, authorisation (B6), audit grants (B8), then the Owner-only
   groundwork: provider account, domain records, mailbox, secrets (A2 to A4,
   B14), and deployment, backups, monitoring (B11 to B13).
4. **Reconcile with `main`:** the web branch and `main` have diverged and the
   merge is deliberately deferred until the web phase is done.
5. **Delivery and rehearsals** (A5, A6, B1) in production.
6. **Owner activation last** (A7), only after every gate the Owner requires is
   Met with real evidence and only on the Owner's explicit approval.

## Sources

DEC-406 to DEC-444, DEC-487 to DEC-491 and DEC-493 in
`requirements/decisions.md`; OQ-158, OQ-159, OQ-160, OQ-162 to OQ-165 and
OQ-168 in `requirements/open-questions.md`; DEC-492 on `verify/overnight-sec-1b`
only; GitHub and npm documentation pages listed in the OQ-165 table, accessed
2026-10-04.
