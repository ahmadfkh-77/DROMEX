# Claude Context Handoff

Short, living handoff for whichever Claude Code session picks this project up next.
`CLAUDE.md` at the repo root is still the primary operating contract — read that
first. This file is a pointer to current state, not a replacement for it.

## Design context (Impeccable)

- `PRODUCT.md` (repo root) — product truth captured via `/impeccable init`:
  single-admin, offline-first plant/construction app; Android is the confirmed
  primary platform; field/outdoor usage (glare, dust, gloves, one-handed) is a
  confirmed design constraint; long-term direction is that other similar
  businesses may eventually run their own instance, so business identity stays
  data-driven rather than hard-coded. Checked against the Home-screen work below
  on 2026-09-03: no conflict found, not edited.
- `DESIGN.md` (repo root) + `.impeccable/design.json` — the documented visual
  system, generated via `/impeccable document` from the actual shipped code,
  cross-checked against `docs/design-system.md` (the pre-existing,
  still-authoritative "DROMEX Interface Standard"). `DESIGN.md` carries an
  **Approved Refinement Targets** section — a graded typography-weight
  hierarchy and restrained non-color domain identifiers. **As of 2026-09-03,
  both targets are implemented on the Home screen** (`refined`) **and, in a
  richer second layer, on Project Command Center** (`refined`+`polished`) —
  see `DESIGN.md`'s "Implemented on Home" and "Implemented on Project Command
  Center" sections. Project Command Center is **not** just a copy of Home's
  treatment: it adds an attached numbered ledger tab, a connected
  header/body seam (animated Signal Orange), and layered white-on-cream
  content rows that Home does not have — see "`refined` vs `polished`" below.
  **Supplier Loads (`QuarryPurchasesScreen.tsx`) additionally implements the
  typography-weight target as its full 4-step scale** (900/700/600/500 — see
  `DESIGN.md`'s "Implemented on Supplier Loads"), but **does not** use
  `ExpandableMenuSection`/`refined`/`polished` at all — it stays fully
  bespoke by explicit decision, and did not adopt the domain-visual-identity
  target (kept its existing two-tier Supplier/Project color hierarchy
  instead). **Daily Reports (`ReportsScreen.tsx`) additionally implements
  both targets a third time** — the full 4-step typography scale (second
  screen to do so) and a third independently-built numbered-ledger-tab
  domain-identity device (see `DESIGN.md`'s "Implemented on Daily Reports")
  — also fully bespoke, not `ExpandableMenuSection`. Every other screen, and
  `src/ui/theme.ts`'s global tokens, still match the base/default (pervasive
  weight-900, no domain markers) description. `.impeccable/design.json`
  (the sidecar) **is kept in sync as of 2026-09-04** with Home's, Project
  Command Center's, Supplier Loads', and Daily Reports' current code — see
  its own narrative/components for the `polished`-specific and
  Supplier-Loads/Daily-Reports-specific entries.

## Home screen — UI phase complete

**Status: done, approved, not shipped.** Read `docs/ui-improvement-log.md` in
full — it has four dated entries (phase 1, phase 1's correction, phase 2's
redesign, and a 2026-09-03 **final summary** that consolidates all of it:
original problems, every change, the final layout/hierarchy/colors/animations,
the four Attention states, the Draft Center and refined-navigation treatment,
accessibility/touch-target/reduced-motion work, every file changed, and how the
six other `ExpandableMenuSection`/`MenuAction` consumers stayed protected). The
final summary entry is the one to read for "what does Home actually look like
and why" — don't reconstruct it from the earlier entries individually.

**Physically verified**: reviewed live in Expo Go on an Android phone
(LAN, `exp://192.168.10.25:8081`) and approved by the owner — layout, colors,
hierarchy, the Make Receipt card, the expandable navigation sections, and the
animations.

**`ExpandableMenuSection`/`MenuAction` now carry two independent boolean
props**, both default `false`:
- **`refined`** — Home's exact shipped, physically-approved treatment.
  **Used by `HomeScreen.tsx` only.**
- **`polished`** — a richer additional layer (attached tab, connected
  header/body seam, header shadow/press feedback, capped staggered reveal,
  white floating rows, weight-600 labels), always passed *alongside*
  `refined`, never alone. **Used by `ProjectCommandCenterScreen.tsx` only.**

The remaining five screens (`DraftCenterScreen`, `PavementCalculatorScreen`,
`WallConstructionScreen`, `WorkspaceHubScreen`, `PavementAdvancedSections`)
pass neither prop and render the original base/default treatment, unchanged.
**Before extending `ExpandableMenu.tsx` again, check all three states** —
`refined` only (Home), `refined`+`polished` (Project Command Center), and
neither (the five other screens) — a change that looks like a simplification
could silently alter any of the three.

**Lessons for future sessions**:
- When a `getAttentionSnapshot()`-shaped total is computed via
  `Object.values(x).reduce(...)`, verify the visible breakdown text actually
  enumerates *every* field being summed — a partial breakdown that looks
  complete is the same bug as no breakdown.
- `grep` for `minHeight` finds under-sized controls but not un-sized ones; a
  real touch-target audit means reading every `Pressable`/`TouchableOpacity`
  call site.
- Correctness fixes (state logic, touch targets, a11y) and visual redesign
  (typography weight, card treatment, color discipline, spacing rhythm) are
  different kinds of work with different visible payoff — doing the first
  thoroughly does not produce the second, and a user asking for "professional"
  or "noticeably different" after a correctness pass is asking for the second.
- When a design system doc (`DESIGN.md`) says a refinement target is "not yet
  implemented anywhere," that claim expires the moment any screen implements
  it — update the doc in the same pass rather than leaving a stale absolute
  claim standing next to new code that contradicts it.

**Not committed, not pushed, no APK built.** Do not commit/push/build on behalf
of a future session without a fresh, explicit instruction — approval of the
Home redesign does not extend to any other action.

## Project Command Center — UI phase complete, approved, not shipped

**Status: implemented, typechecked, tested, and physically approved on
Android via Expo Go — twice.** See `docs/ui-improvement-log.md`'s 2026-09-03
**final summary** entry (the last dated entry in the file) for the complete
record; two earlier entries above it cover the two individual passes in
detail. Score: 24/40 (Acceptable) → 36/40 (Excellent), code-reasoned.

**Two passes, both approved**:
1. **Workflow/correctness redesign**: fixed an unreachable initial-load
   error state (same bug class as Home's original Attention defect, worse
   here — no Back button either), promoted "Manage Project" to a real 48dp
   button, regrouped the ten existing metrics into three labeled clusters
   (*Site Activity*, *Project Control*, *Planning & Engineering* — all
   values/calculations unchanged), added progressive "Show More Photos"
   reveal, added clarifying copy about the timeline/grouped-view
   relationship.
2. **Visual correction pass** (triggered by physical-review feedback that
   the first pass's mixed navy/orange/cream headers looked busy and the
   opened sections looked like generic cards): unified all seven section
   headers onto one Structural Navy treatment; added an attached numbered
   ledger tab, a connected header/body folder seam (animated Signal Orange),
   and content-specific internal layouts — most notably a real vertical
   timeline rail for "All Activity Timeline." Introduced the `polished` flag
   (see above) specifically so none of this touched Home.

**The screen's seven sections, their names, order, closed-by-default state,
and the latest-20/50/500 caps are exactly what `requirements/SRS.md` FR-086
requires — none of that was touched by either pass, only presentation.**

**`src/ui/components/DatePickerField.tsx`** (shared with Home) had its
modal's touch targets raised to 48dp during pass 1 — verified no Home
regression. Not touched again in pass 2.

**Remaining, not resolved this phase**: `project_issues`/`project_media`
repository queries are still unbounded at the query layer (photos got a
client-side progressive-reveal mitigation; issues did not); no text search
beyond the existing date-range filter; no shortcuts/bulk actions.

**Not committed, not pushed, no APK built.** Do not begin another UI phase
(including the Waste Dump Outsider feature) on behalf of a future session
without a fresh, explicit instruction.

## Supplier Loads — UI phase complete, approved, not shipped

**Status: implemented, typechecked, tested, and physically approved on
Android via Expo Go, in one pass** (no separate correction pass was needed,
unlike Home and Project Command Center). See `docs/ui-improvement-log.md`'s
2026-09-03 **"Supplier Loads: critique, refinement, and phase complete"**
entry (the last entry in the file) for the complete record.

**Deliberately not migrated to `ExpandableMenuSection`.** Unlike Home and
Project Command Center, Supplier Loads (`src/ui/screens/QuarryPurchasesScreen.tsx`)
keeps a fully bespoke, screen-local disclosure implementation — Structural
Navy supplier headers, warm cream-tan project headers, soft blue-gray
supplier containers, the Supplier → Project → Supplied Materials hierarchy —
per an explicit decision to refine, not replace or generalize, an
already-approved and already-liked design. **Before extending
`ExpandableMenuSection` again, remember this screen is not one of its
consumers** and never has been.

**What's new**:
- Local text search (supplier, project, material, reference/ticket number,
  driver, truck plate) combined with the existing date-range filter, both
  applied before a per-project progressive "Show More" reveal (20 at a
  time).
- A new screen-local `SuppliedMaterialRow` record component implementing a
  fixed 13-point reading order — material name leads, quantity-and-unit is
  one inseparable large value, and the purchase/ticket reference number
  (previously the card's most prominent 900-weight line) is now demoted to
  600-weight metadata near status.
- A Status-Warning "Reactivated" badge, derived only from
  `status==='Active' && cancelledAt!=null` (no new field).
- A locally-computed "Trip N of M" connected-rail device for repeated
  same-day, same-signature deliveries — display-only, never merges
  underlying records.
- A shared-component fix: `GroupedSearchableSelect.tsx`'s `groupEyebrow`
  raised from 8px/900 to 11px/600, verified safe for both of its consumers
  (`MakeReceiptScreen.tsx`, this screen).

**Lessons reinforced, not new this phase**: the touch-target audit was done
by reading every `TouchableOpacity` individually (not `grep`-ing `minHeight`
alone) and found three controls with no sizing style at all — the same
category of gap Home's phase-1 correction first surfaced.

**Not committed, not pushed, no APK built.** Do not begin another UI phase
(including the Waste Dump Outsider feature) on behalf of a future session
without a fresh, explicit instruction.

## Daily Reports — UI phase complete, approved, not shipped

**Status: implemented, typechecked, tested, and physically approved on
Android via Expo Go, across two passes** (the main redesign, then a focused
follow-up adding the initial-load `loading`/`error`/`ready` state machine
before physical review). See `docs/ui-improvement-log.md`'s 2026-09-04
**"Daily Reports: critique, refinement, and phase complete"** entry (the
last entry in the file) for the complete record.

**Scope boundary, strictly kept**: only the per-project workflow
(`src/ui/screens/ReportsScreen.tsx`'s project's report list, ten-section
editor, and PDF generation) and the PDF template
(`src/services/projectReportWasteTemplate.ts`) were touched. The
whole-business "Report Generation" Excel-workbook section living in the same
screen file — its JSX and every style it or its sub-components
(`ExportOption`, `BusinessWorkbookOption`, `WorkbookLanguagePicker`) depend
on — is confirmed byte-identical to before this phase, after a mid-
implementation typography sweep briefly leaked into several of its shared
styles and was caught and fully reverted. **Before touching this file again,
re-run that same check**: extract every `styles.*` name the Report
Generation JSX line references (directly or via its sub-components) and
diff each one before assuming a styling change is scoped correctly.

**Deliberately not migrated to `ExpandableMenuSection`.** Like Supplier
Loads, Daily Reports' ten sections use a fresh, screen-local `LedgerSection`
disclosure device (Structural Navy header, attached Ledger-Cream numbered
tab `01`–`10`, rotating `+`/`×`, Signal-Orange-topped body) — the third
independently-built bespoke implementation of this general idea this
session, not shared code with Home/PCC's `refined`/`polished` mechanism or
with Supplier Loads' own bespoke pattern.

**What's new**: a project/date identity card with the operating period
stated in plain text; a "Sections with entries: N of 10" summary (never
called "completion," since nine of ten sections are optional — only Work
Information's badge goes Status-Warning when empty); a live duplicate-date
warning computed from the project's already-loaded report list; split
(not reinterpreted) validation-error messages; a unified company/supplier
`LoadRow` (Signal Orange vs. Structural Navy accent); 48dp PPE status
controls; one "Generate PDF" flow with No Prices as the explicit default;
a Final Review summary before Save; and a visual-only PDF template pass that
replaced four decorative, unrelated summary-card colors with the DROMEX
orange/navy/cream hierarchy, verified against real generated With/No-Prices
sample HTML (No-Prices: zero `$` figures, zero financial column headers).

**A real correctness bug was found and fixed during this phase's own
self-review** (not by the owner): `LoadRow` never displayed the driver's
name for a supplier load actually picked up by DROMEX's own driver, because
the driver/truck line was only wired to render on the `source==='company'`
branch. Caught by tracing all four delivery-method/source combinations by
hand, not by only checking the common case.

**No RN component-rendering test harness exists anywhere in this codebase**
(no `@testing-library/react-native` or `react-test-renderer`) — confirmed by
checking `package.json` before deciding not to add test coverage for the
new `loading`/`error`/`ready` state machine; every existing test is
domain/repository/migration/export logic, not component rendering.

**Not committed, not pushed, no APK built.** Do not begin another UI phase
(including the Waste Dump Outsider feature) on behalf of a future session
without a fresh, explicit instruction.

## Known open items (not yet scheduled)

- No drawn icon system exists anywhere in the app; the "domain visual identity"
  target is implemented on Home via a numbered chip only, not icons.
- The `detect.mjs` design-token scanner reports ~13 advisory "color outside
  DESIGN.md" findings (legitimate one-off tint/border colors never added to
  `DESIGN.md`'s frontmatter) — pre-existing, unrelated to the Home redesign,
  worth a future `/impeccable document`/`extract` refresh (which would also
  resync the `.impeccable/design.json` sidecar mentioned above).
- **Font scale 1.3 and exact 320/360/412dp layout were reasoned about in code,
  not measured on the device used for physical review.** The physical review
  covered visual approval (colors/hierarchy/cards/animations), not these two
  specific checks. A quick `adb shell settings put system font_scale 1.3` on
  that same phone would close this gap with real evidence.
- "Daily project reports" and "Reports center" on Home both route to the same
  handler; left as-is (destinations are out of scope for UI phases), but worth
  a product decision if they should ever diverge.
- Project Command Center's remaining performance/scope items are listed in
  its own section above (unbounded queries, no text search, no shortcuts) —
  not repeated here.
- Supplier Loads' remaining items: `repository.listPurchases()` is still an
  unbounded query (search/progressive-reveal are client-side only);
  `CollapsibleFilterCard.tsx`'s internal `LayoutAnimation` is not
  reduced-motion-gated (shared, pre-existing, out of this phase's scope);
  `SearchableSelect.tsx`'s own 10px `eyebrow` style is a similar sub-11px gap
  to the one just fixed in `GroupedSearchableSelect.tsx`, but was not named
  in the approved decisions and was left untouched — see
  `docs/ui-improvement-log.md`'s Supplier Loads entry for detail.
- Daily Reports' remaining items: the pre-existing sub-48dp language-picker
  and business-filter controls inside the untouched Report Generation
  section were deliberately left as-is; `repository.getSetup()`'s
  `loading`/`error`/`ready` fix has no automated test coverage (no RN
  component-rendering harness exists in this codebase); the PDF template's
  visual polish did not touch its data completeness or field set — see
  `docs/ui-improvement-log.md`'s Daily Reports entry for detail.

## Release — DROMEX 0.8.0, Android build 11 (2026-09-04)

**Shipped.** This release bundles the four physically-approved UI phases
above — Home, Project Command Center, Supplier Loads, and Daily Reports.
Waste Dump Outsider and all other new business functions remain deferred,
untouched, and unstarted.

- **Version**: `package.json`/`app.json` bumped `0.7.0`→`0.8.0`,
  `android.versionCode` `10`→`11`. Package identity
  (`com.dromex.management`) and the existing EAS Android signing credentials
  (keystore `wtQXwzktVi`) were reused unchanged — confirmed via
  `√ Using Keystore from configuration: Build Credentials wtQXwzktVi
  (default)` in both build logs.
- **EAS builds**: first attempt `725ab734-8df3-46fb-acff-459fc32ed430`
  **errored** — root-project Gradle `classpath` configuration failed to
  resolve because EAS's own internal Maven cache
  (`maven.production.caches.eas-build.internal`) returned `504 Gateway
  Timeout` on several artifacts, followed by a Gradle daemon communication
  failure. Confirmed as an EAS-infrastructure issue, not a project defect,
  by reading the full "Run gradlew" phase log: every failing lookup targets
  EAS's internal proxy (not a repository this project configures), the
  affected artifacts are generic Android-tooling transitive dependencies
  unrelated to anything DROMEX's own code depends on, and the identical
  dependency graph had built successfully three days earlier (build
  `820217d0`, 0.7.0/build10). Retried once with identical version/package/
  signing identifiers, per that diagnosis: **`f6130859-babf-4625-809d-120ef1536c33`
  finished successfully.**
- **Artifact**: downloaded to `output/DROMEX-0.8.0-build11.apk`, 82,855,810
  bytes (~79 MB). SHA-256: `565113f66548dbea2e97dbb78420993513ace58197cbaed98f99a8e4bca040ca`.
  Verified as a structurally valid ZIP (correct local file header `504b0304`
  and end-of-central-directory signature `504b0506`) before committing —
  not just trusted on file size alone.
- **Committed and pushed**: commit `32b47b7` on `main` (staged narrowly —
  only `output/DROMEX-0.8.0-build11.apk`, `app.json`, `package.json`; every
  other file this session touched was deliberately left uncommitted, since
  committing them wasn't requested). The initial push failed twice with
  `HTTP 408` (GitHub-side timeout on the ~79MB single-file transfer over the
  default 1MB git HTTP post buffer) — fixed by raising this repository's
  local `http.postBuffer` to 500MB (explicit user approval obtained first;
  this is a repo-local config value, not global) and pushing again, which
  succeeded. GitHub's push response warned the file exceeds its recommended
  50MB threshold and suggested Git LFS — informational only, did not block
  the push; worth a future decision if release APKs keep growing.

**Not done this session**: no App Bundle (`production` EAS profile) was
built, only the `preview`/APK profile, matching every prior release in
`output/`. No GitHub Release was created for the artifact — it lives only
as a committed binary in `main`'s history via the repo-local push above.

## Release — DROMEX 0.9.0, Android build 12 (2026-09-04/05)

**Shipped.** Company Load audited correction and cancellation (reason
required, before/after history, no reactivation — supersedes the earlier
direct-edit-only model recorded in DEC-060/061; database version 28),
project start-date correction with linked-record date-conflict blocking
(database version 29), optional Consultant Sign-off for Daily Reports
(off by default, never implies approval when incomplete, prior data only
removed via an explicit confirmed action; database version 30), and
in-place editing for Worker and Driver profiles (previously only Trucks
and Machines supported this — additive `updateWorker`/`updateDriver`
repository methods, no schema change). See `requirements/decisions.md`
DEC-385 through DEC-388 for the corresponding product decisions.

Also shipped: a display-layer-only design/accessibility pass across six
screens reached from Business Directory — Financials, Workspace Hub
(Business Directory grouping only), Projects, Customers, People &
Equipment, and Item Catalog. Each phase added 48dp touch targets, full
`accessibilityRole`/`accessibilityLabel`/`accessibilityState` coverage
(several of these screens had none before), search/sort/active-inactive
filtering, consistent loading/empty/no-results states, and visual
treatment consistent with the existing Foreman's Field Ledger identity
(navy hero headers, collapsible bands, the app's existing color tokens
only — no new palette). **These six phases were not run through
`/impeccable document`** — `DESIGN.md`/`PRODUCT.md` and
`docs/ui-improvement-log.md` still only reflect the earlier Home/Project
Command Center/Supplier Loads/Daily Reports phases and do not mention
Financials/Workspace Hub/Projects/Customers/People & Equipment/Item
Catalog at all. Treat those two files as stale for those six screens
until a future session runs the Impeccable documentation flow (or they
are updated by hand) — the actual implementation and its rationale are
recorded only in this session's conversation history, not in a durable
project doc.

- **Version**: `package.json`/`app.json` bumped `0.8.0`→`0.9.0`,
  `android.versionCode` `11`→`12`. Package identity
  (`com.dromex.management`) and the existing EAS Android signing
  credentials were reused unchanged.
- **EAS build**: `ca288d1a-e30e-4658-b5b4-59b01f8afeb0` finished
  successfully (the local `eas build` CLI process was killed twice by the
  machine's own low-memory condition while waiting/polling — the remote
  EAS build was unaffected both times, since EAS builds run server-side;
  status was recovered via `eas build:view <id> --json`).
- **Artifact**: downloaded to `output/DROMEX-0.9.0-build12.apk`,
  82,919,462 bytes (~79 MB). SHA-256:
  `818340f9bebb80e137dea86c33dd2e739f482da0ea18ef87e41728abdd4222c6`.
  Verified as a structurally valid ZIP (correct local file header
  `504b0304` and end-of-central-directory signature) before committing.
- **Committed and pushed**: commit `c917872` on `main`. Unlike the
  0.8.0/build11 release, this commit staged and pushed **all** of the
  session's application-code changes (not just the release-artifact
  files) — 46 files, including every UI phase, the new
  `updateWorker`/`updateDriver` repository methods, migrations through
  database version 30, and the corresponding test files — since the user
  asked for the accumulated work to be committed and pushed, not only the
  release identifiers. Deliberately excluded: `.claude/`, `.codex/`,
  `.cursor/`, `skills-lock.json` — local AI-tool configuration, not
  application code. The push succeeded on the first attempt (no `HTTP
  408` this time); GitHub again warned the APK exceeds its 50MB
  recommended threshold (informational only, did not block).

**Not done this session**: no App Bundle build; no GitHub Release; no
`/impeccable document` run to refresh `DESIGN.md`/`PRODUCT.md` for the six
new UI phases (see above); `docs/ui-improvement-log.md` was not updated
with per-phase entries for Financials/Workspace Hub/Projects/Customers/
People & Equipment/Item Catalog.

## Standing rules this project expects every session to follow

Everything in `CLAUDE.md`'s "Operating rules" applies without exception, notably:
`requirements/` is authoritative product record; work in small, explicitly
approved phases; never silently rewrite confirmed historical business data; run
`npm run typecheck` and `npm test` after every phase; never build/release an APK
without explicit approval.
