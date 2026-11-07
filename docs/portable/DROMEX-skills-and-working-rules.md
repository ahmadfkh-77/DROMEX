# DROMEX Skills and Working Rules (portable)

Use this file to set up a new application the same way DROMEX is built. It covers two things: the Claude skills installed in the project, and the working rules that shaped how every change is made.

How "used" is decided in this file: a skill is marked **Used** only where a past DROMEX session transcript records it being launched ("Launching skill: ..."). Those are the Claude Code session transcripts on this machine, checked on 2026-10-31 by searching for each skill. The search returns a limited number of sessions per skill, so the lists below name the sessions found, not every use. A skill with no launch record is marked **Installed only**. A session's own prompt asking for a skill is noted as "requested" because that shows intent, not a launch.

## 1. Skills installed in the project

They live in `.claude/skills/` in the DROMEX repository. To reuse them, copy that folder into the new project's `.claude/skills/`. Claude Code loads them automatically.

| Skill | What it is for | Status on DROMEX |
|---|---|---|
| `owasp-security` | Security review against OWASP Top 10, ASVS and related lists: auth, input handling, vulnerabilities. | **Used** in the web sign-in and account work: "Owner account and session management", "DROMEX Web Phase 2C Checkpoint 4E", "DROMEX Web Phase 2C status check". Also requested in the Phase 2C email, two-factor and web-phase sessions, and cited in `docs/web/authentication-and-authorization-architecture.md`. |
| `supabase-postgres-best-practices` | PostgreSQL schema, index, RLS, migration and query guidance. | **Used** in the same three web sessions (the database side of the web phase). Also requested in the Phase 2C email design, two-factor migration and checkpoint 3D/3F sessions. |
| `test-driven-development` | Write the test before the implementation for any feature or fix. | **Used** in the web phase sessions (master plan, Phase 2C, Checkpoint 4E, Owner account) and in "DROMEX Android finance features". |
| `verification-before-completion` | Run the checks and confirm the output before claiming work is done, fixed or passing. | **Used** in the web phase sessions (master plan, Phase 2C, Checkpoint 4E, Owner account, email configuration). |
| `codebase-design` | Shared vocabulary for deep modules: interface design, where seams go, testability. | **Used** in the web phase sessions and in "DROMEX Android People Roles feature". |
| `design-taste-frontend` | Anti-generic interface design: reads the brief, picks a design direction, avoids templated looks. | **Used** in "DROMEX Android Wall Construction", "DROMEX Android project list and totals redesign" and one web checkpoint session. |
| `high-end-visual-design` | Agency-grade polish: fonts, spacing, shadows, card structure and motion. | **Used** in the Wall Construction and the project list and totals redesign sessions. |
| `redesign-existing-projects` | Audits an existing interface and upgrades it without breaking functionality. | **Used** in the same two Android design sessions. |
| `webapp-testing` | Drive and test a local web app with Playwright: screenshots, console logs, UI behavior. | **Used** once, in "Owner account and session management". |
| `playwright-cli` | Browser automation and Playwright test generation from the command line. | **Used** in "Owner account and session management" and "DROMEX Web Phase 2C Checkpoint 4E". |
| `full-output-enforcement` | Stops truncation and placeholders: complete, unabridged output. | **Installed only** (no launch record found). |
| `graphify` | Builds a persistent knowledge graph of a codebase for architecture questions. | **Installed only** (no launch record found; no `graphify-out/` folder exists). |
| `improve-codebase-architecture` | Scans a codebase for deepening opportunities and presents them as an HTML report. Run on request only. | **Installed only** (no launch record found). |

Also configured outside that folder:

- **`impeccable`** (a user-level skill at `~/.claude/skills/impeccable`) for design critique, polish and anti-pattern checks. **Used**: sessions "Dromex construction logo design", "New update", "DROMEX Android finance features" and "DROMEX Web Phase 2C Checkpoint 4E" launched it. Its `/impeccable init` and `/impeccable document` runs produced `PRODUCT.md`, `DESIGN.md` and `.impeccable/design.json` at the repository root (see `docs/claude-context.md`, section "Design context (Impeccable)"). `.claude/settings.local.json` also runs its `hook.mjs` after every Edit or Write ("Checking UI changes"), so UI edits are checked as they are made. To reuse it, install the skill and add the same hook. Copy `PRODUCT.md` and `DESIGN.md` into the new project as design references too.

Summary by area: **security** (`owasp-security`), **database** (`supabase-postgres-best-practices`), **testing and verification** (`test-driven-development`, `verification-before-completion`, `webapp-testing`, `playwright-cli`), **code structure** (`codebase-design`), **UI design** (`impeccable`, `design-taste-frontend`, `high-end-visual-design`, `redesign-existing-projects`).
- Local permission allowances for Docker and for `npm run typecheck` and `vitest` runs, so routine checks do not prompt.

## 2. Working rules that shaped the app

These come from `CLAUDE.md` in the repository root. Copy the file and edit the product sections for the new app; keep the operating rules.

1. A `requirements/` folder is the authoritative product record. Confirmed decisions are binding; open questions are not guessed.
2. Source-of-truth order when things conflict: latest confirmed decision, then the SRS, then the code and migrations, then elicitation notes, then explanatory docs, then Claude's own assumptions (labelled as assumptions).
3. Inspect the existing implementation before proposing a rewrite. Preserve working workflows, historical records and the visual style.
4. Work in small phases. Before each phase state scope, affected files, schema migrations, risks and tests, and implement only what is approved.
5. Never silently rewrite confirmed historical data; use correction, cancellation, replacement or audit history.
6. Extend existing requirement and design documents; do not create duplicates.
7. Run typecheck and the relevant tests after every phase, and report files changed, behavior added, tests run, backup and offline implications, and unresolved risks.
8. No APK or release build without explicit approval. Accepted installers are never overwritten.
9. Every new decision is recorded as a numbered `DEC-` row in `requirements/decisions.md` and, when it changes behavior, an `FR-` line in `requirements/SRS.md`.
10. Old database migrations are frozen. Changes are new forward migrations only.

Owner preferences recorded in the project memory (they apply to any assistant working on the app):

- **Mockup before visual change.** Show an openable HTML mockup and wait for approval before any screen, PDF or receipt layout change; build it exactly as approved.
- **Owner decisions override engineering judgement.** An explicit Owner decision is followed even if there is a technically neater way.
- **Stage explicit file paths, never `git add -A`,** and present the file list for review before committing. UI modes such as auto-approve never authorize a commit.
- **Do not delegate implementation phases to subagents;** finish them directly in the session.
- **Verify continuation notes against the repository** rather than trusting chat history.
- **Group related safe verification commands** into one call.
- **Use explicit allowlists** instead of broad exclusions when scoping configuration.
- **Standing boundaries:** no history rewriting, no access to the production server, and a full clock-stability check before Docker-based database work. (These are specific to DROMEX's environment; keep or drop them for the new app.)

## 3. A suggested setup for the new application

1. Create the repository with the same layers: `src/domain`, `src/data`, `src/services`, `src/ui`, plus `tests/`, `requirements/` and `docs/`.
2. Copy `.claude/skills/`, `CLAUDE.md` (edited), `docs/design-system.md`, `docs/portable/DROMEX-design-guide.md`, `src/ui/theme.ts` and `src/ui/components/AppPrimitives.tsx`.
3. Install the `impeccable` skill and add its hook to `.claude/settings.local.json` if you want UI edits checked automatically.
4. Start `requirements/decisions.md` and `requirements/SRS.md` empty but with the same table format, and record decisions from the first day.
5. For the first screens, build mockups in `docs/design/` first, get them approved, then implement with the shared primitives.
6. Keep the phase loop: scope, approval, implement, typecheck and tests, report, commit explicit paths.
