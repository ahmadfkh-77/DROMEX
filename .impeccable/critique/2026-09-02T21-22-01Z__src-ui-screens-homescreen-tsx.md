---
target: src/ui/screens/HomeScreen.tsx
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\fakih\\Desktop\\Dromex\\DROMEX\\src\\ui\\screens\\HomeScreen.tsx"
target_fingerprint: "sha256:ec1fa193370e9b51f2ed5ab1be17c12b4f2916c4aafd6ed9d5ae1a3e817b7135"
target_path: "C:\\Users\\fakih\\Desktop\\Dromex\\DROMEX\\src\\ui\\screens\\HomeScreen.tsx"
timestamp: 2026-09-02T21-22-01Z
slug: src-ui-screens-homescreen-tsx
---
⚠️ DEGRADED: single-context (parallel sub-agent dispatch failed/connection lost on the prior attempt; user explicitly authorized a sequential in-session retry reusing already-loaded files and context)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The "Needs Attention" badge shows a false all-clear (0, "No urgent record alerts") during its own loading window, and its total silently folds in draft count without saying so. |
| 2 | Match Between System / Real World | 3 | Mostly plain business language; "CONNECTED WORKFLOW" badge is unexplained jargon. |
| 3 | User Control and Freedom | 3 | Sections and the dashboard collapse/expand freely; date filters clear easily; no traps found. |
| 4 | Consistency and Standards | 2 | Four touch targets fall below both Android's 48dp and the project's own documented 48pt minimum; a second, divergent copy of the section/row pattern exists alongside the canonical one. |
| 5 | Error Prevention | 3 | No destructive actions on this screen; nothing to prevent. |
| 6 | Recognition Rather Than Recall | 4 | Every action carries a full explanatory sentence, not just a label — a real strength. |
| 7 | Flexibility and Efficiency of Use | 2 | Dashboard customize/hide and swipeable pages exist; no shortcuts or bulk paths to frequent actions. |
| 8 | Aesthetic and Minimalist Design | 2 | The dashboard block (period row, customize panel, tabs, hero, metric grid, attention, list) is dense and sits above all navigation. |
| 9 | Error Recovery | 2 | DashboardOverview has a real retry pattern; HomeAttention's fetch fails silently with no visible error state, ever. |
| 10 | Help and Documentation | 1 | No contextual help anywhere; "CONNECTED WORKFLOW" and similar labels are never explained. |
| **Total** | | **24/40** | **Acceptable (60%)** |

## Design Specificity Verdict

**Manual assessment**: Home is well-anchored to this specific business — every action carries a real, domain-specific sentence ("Record tank readings, deliveries, equipment fills, supplier cost, and current balance," "Use a separate one-tap counter for each driver and truck combination"), not generic nav labels. That's a genuine strength; a template dashboard would never write copy this concrete. The one generic-feeling piece is the dashboard's period-selector/customize-panel/swipeable-pages pattern in `DashboardOverview.tsx` — a fairly standard analytics-widget convention that could belong to any SaaS product; it's well-built but doesn't carry DROMEX's voice the way the menu copy does.

**Deterministic scan** (`detect.mjs` against `HomeScreen.tsx`, `DashboardOverview.tsx`, `ExpandableMenu.tsx`, `AppPrimitives.tsx`): 14 advisory findings, all `design-system-color` — literal hex colors not present in `DESIGN.md`'s frontmatter/sidecar (e.g. `#C4DDEA`, `#F0C5B4`, `#E8DED0`, `#E2B966`, `#354D60`, full list in the scan output). These are not visual chaos: nearly all are legitimate low-saturation tint/border pairs of already-documented brand colors (an orange-tinted border for "connected" cards, a cream-tinted card border, a light-blue status-badge border, etc.), used consistently. They are, however, a real documentation gap in the `DESIGN.md` I generated in this project's `document` pass — it captured the reused theme.ts tokens but not this second layer of one-off functional tints. Worth a `/impeccable document` or `/impeccable extract` refresh later; not a UX defect in its own right, so it is not counted as a Priority Issue below.

**Browser/visual evidence**: not applicable. This is a native Android/iOS screen (Expo React Native) with no dev-server URL or browser renderer; there is no live page to inject a visual overlay into. This is a genuine platform gap in Assessment B, not a skipped step — noting it rather than fabricating a browser-based finding.

## Overall Impression

The Home screen's biggest strength — descriptive, business-specific copy on every action — is real and should be protected in any future change. Its biggest problem is that the screen tries to be two things at once (a live operations dashboard and the app's entire navigation menu) and stacks them vertically, so the dashboard's own complexity (filters, customize panel, swipeable pages) sits as a wall between the user and the four menu sections underneath it. Layered on top of that are a few concrete, fixable bugs: a status badge that can lie during loading, and touch targets that are smaller than the app's own written standard.

## What's Working

- **Descriptive action copy.** Every `QuickAction` pairs a title with a real explanatory sentence (`HomeScreen.tsx:32-41`). This does more UX work than most nav menus attempt and should be the template for any new section.
- **Purposeful, restrained motion.** The staggered entrance (`HomeScreen.tsx:22`), the section-expand accent bar + item stagger (`HomeScreen.tsx:51-52`), and the press-in spring feedback on every tappable row all explain state changes rather than decorate — exactly what `docs/design-system.md`'s motion section asks for.
- **Real state coverage in `DashboardOverview`.** Loading (spinner + label), error (tinted panel + "Try again"), and two distinct empty-list messages are all explicitly designed (`DashboardOverview.tsx:41,46,52`) — this is the state-completeness the rest of the screen should match.

## Priority Issues

**[P1] The "Needs Attention" badge can show a false all-clear, and its number doesn't match its own explanation.**
- **Why it matters**: `HomeScreen.tsx:48` computes `total` as `missingReportsToday + blockedSchedule + openIssues + otherDrafts`, but the title logic (`total ? 'Open items that need review' : 'No urgent record alerts'`) treats a `null` snapshot (still loading) identically to zero — so on every open of the app, for the duration of the async fetch, the badge reads **0** and **"No urgent record alerts"** right next to a hint that says **"Checking local records…"**, a direct contradiction. Separately, the hint text below the number only enumerates `missingReportsToday`, `blockedSchedule`, and `openIssues` — `otherDrafts` is silently added to the headline number but never named, so the big number and its own explanation don't sum to the same value. On a fetch failure the `.catch(()=>{})` (`HomeScreen.tsx:48`) leaves it stuck at this false "all clear" forever, with no visible error state.
- **Fix**: show a neutral loading state (not "no alerts") while `snapshot === null`; either name `otherDrafts` in the hint or stop folding it into the headline total, since "Draft Center" already has its own dedicated shortcut one row below; surface a retry affordance on fetch failure instead of swallowing it.
- **Suggested command**: `/impeccable harden`

**[P1] Several touch targets fall below both Android's 48×48dp guideline and the project's own documented 48pt minimum.**
- **Why it matters**: `docs/design-system.md` states "Minimum button height is 48 points" as a house rule, and `reference/android.md`'s platform floor is 48×48dp — but `searchButton` is `minHeight:35` (`HomeScreen.tsx:67`), `draftShortcut` is `minHeight:42` (`HomeScreen.tsx:67`), and in `DashboardOverview.tsx:71`, `periodButton` is `minHeight:38` and `hideButton` has no minHeight at all (≈30pt from its padding). This is exactly the outdoor/one-handed/gloved-hand condition PRODUCT.md records as a confirmed usage scenario — these are precisely the targets most likely to be mis-tapped in the field.
- **Fix**: raise all four to `minHeight:48`, matching the app's own `AppButton`/`MotionAction` convention.
- **Suggested command**: `/impeccable audit`

**[P1] The dashboard sits between the user and every menu section, adding scroll/interaction depth to the app's most frequent actions.**
- **Why it matters**: to reach any of the 18 menu actions (Fuel Tracking, Load History, Payments & balances, etc.), a user must first scroll past the header, the primary "Make Receipt" hero, the Attention block, and the full `DashboardOverview` — which itself carries a title row, a 4-option period selector, an optional customize panel, a two-page swipeable metric spread, and a swipe hint — before reaching the first collapsed `ActionSection`, which then still needs an explicit tap to open. For a returning owner-operator who already knows exactly which tool they want, this is pure extraneous load stacked in front of the one thing they came for, every single time they open the app.
- **Fix**: consider defaulting the dashboard to its already-built collapsed state after the first session (the "Hide"/"Show +" mechanism already exists at `DashboardOverview.tsx:33-36`), or reordering so at least one frequently-used section sits above the dashboard, or remembering the last-opened section and restoring it expanded.
- **Suggested command**: `/impeccable layout`

**[P2] All four section headers are visually identical, so "Daily Operations," "Records," "Reports & Finance," and "Setup" don't read as different places.**
- **Why it matters**: `HomeScreen.tsx`'s `ActionSection` hardcodes `styles.sectionHeaderNavy` (`HomeScreen.tsx:54,67`) for every section regardless of content, even though `src/ui/components/ExpandableMenu.tsx` already ships a tone-aware version of the same pattern (`ExpandableMenuSection`/`MenuAction`, supporting navy/orange/cream) that Home doesn't use. The result is two near-duplicate implementations of the same disclosure/numbered-row pattern in the codebase, and Home forfeits the one that already supports the domain differentiation `DESIGN.md`'s "Approved Refinement Targets" section already calls for.
- **Fix**: reuse `ExpandableMenuSection`/`MenuAction` (or extract one shared component both files draw from) and assign each of the four sections a restrained, distinct identifier per the already-approved direction — not a new strong color per section, per that same approved note.
- **Suggested command**: `/impeccable layout`

**[P2] Several information-carrying text roles are set at 8-9px, below comfortable outdoor legibility.**
- **Why it matters**: `attentionEyebrow` and `connectedLabel` are `fontSize:8`; `statusHint`, `attentionHint`, `sectionHint`(-adjacent), and several `DashboardOverview` hint/label styles are `fontSize:9` (`HomeScreen.tsx:67`, `DashboardOverview.tsx:71`) — real information (counts, states, category labels), not purely decorative micro-type. PRODUCT.md records confirmed outdoor/glare/dust/glove usage as a design constraint for this app; 8-9px text is the first thing to become unreadable in direct sunlight or at arm's length, and `theme.ts` already defines a 13px `helper` role several of these styles could use instead of hand-setting a smaller size.
- **Fix**: raise any text carrying real information to at least 11px; reserve anything under that for purely decorative micro-labels only.
- **Suggested command**: `/impeccable typeset`

## Persona Red Flags

**Dana (Owner-Operator, on-site — the confirmed PRODUCT.md persona)**: Opens the app mid-job to log a fuel fill. Has to scroll past the hero action, the Attention block, and the full dashboard (with its own period tabs and swipe pages) before "Daily Operations" is even visible, then tap to open it, then find item 02. If the Attention badge happened to load slowly on this visit, Dana would have briefly seen "No urgent record alerts" and moved on — exactly the false all-clear from the P1 above. In bright sun, the 8-9px hint text under several cards is the first thing to disappear.

**Alex (Power User)**: No shortcuts to jump straight to a specific tool; every visit re-scrolls past the same dashboard regardless of how many times "Fuel Tracking" has been opened before. The dashboard's own "Customize" panel is the only personalization available, and it only affects the dashboard widgets, not the navigation below it.

**Casey (Distracted, one-handed, mobile)**: The 35pt search button and 38pt period-selector buttons are exactly the kind of small, closely-packed targets Casey is most likely to mis-tap while holding the phone one-handed. The "CONNECTED WORKFLOW" badge on the Suppliers row has no visible explanation of what "connected" means, which Casey — moving fast, not reading carefully — will simply not process.

## Minor Observations

- `HomeScreen.tsx:23` runs a global `LayoutAnimation.configureNext` on section toggle in addition to `ActionSection`'s own explicit `Animated` sequence for the same open/close event (`HomeScreen.tsx:51-52`) — two animation systems animating the same layout change at once, which risks competing easing/duration rather than one clean motion. Worth removing the redundant `LayoutAnimation` call given `ActionSection` already animates precisely.
- "Daily project reports" (Daily Operations #05) and "Reports center" (Reports & Finance #01) both call the same `onOpenReports` handler (`HomeScreen.tsx:32,38`). If they intentionally land on the same screen from two entry points, the copy should say so somewhere; if not, this is worth double-checking against the receiving screen.
- The "CONNECTED WORKFLOW" badge (`HomeScreen.tsx:32`, styled at `HomeScreen.tsx:67`) is the only place in this screen that uses unexplained internal terminology.
- `profileRepository.getCompanySettings()`'s failure is silently swallowed (`HomeScreen.tsx:21`) — low stakes (falls back to the default wordmark image) but still a silent catch with no signal if it ever needs debugging.
- Within an open section with many rows (e.g., Daily Operations' 6 items), there is no sticky/pinned section header, so scrolling within a long open section can scroll the header itself out of view, leaving rows with no visible parent label.

## Proposed Home-Screen Direction (conceptual — no code changes made)

**Current workflow**: Home is a single continuous `ScrollView`: wordmark/search/cloud-status header → primary "Make Receipt" hero → Attention block → full `DashboardOverview` (its own filters/customize/swipe UI) → four collapsed `ActionSection`s covering every remaining screen in the app, each opened individually to reveal numbered `QuickAction` rows.

**Problems this direction would address**: the two P1s above that are workflow-shaped (dashboard-before-navigation ordering, and the false-status badge) plus the P2 lack of section differentiation.

**Proposed change, at a conceptual level**:
1. Fix the Attention badge's state logic so loading, zero, and error are three visibly different states (spinner/dash while loading, the real count only once resolved, a visible retry on failure) — a states fix, not a layout change.
2. Let the dashboard remember its collapsed/expanded state per the mechanism it already has, and consider defaulting new sessions to collapsed after the first successful view, so returning users reach the menu sections faster without losing the dashboard for those who want it.
3. Replace `HomeScreen`'s own `ActionSection`/`QuickAction` with the existing tone-aware `ExpandableMenuSection`/`MenuAction`, assigning each of the four sections a distinct restrained tone/marker consistent with `DESIGN.md`'s already-approved "restrained domain identifiers" direction (icon/marker/numbering, not a new strong color per section).
4. Raise the four undersized touch targets to 48pt and the sub-11px information-bearing text to at least 11px, both value changes only (no new components).

**Affected files** (if approved and implemented later): `src/ui/screens/HomeScreen.tsx`, `src/ui/components/DashboardOverview.tsx`, `src/ui/components/ExpandableMenu.tsx` (reused, likely needs no changes), `src/ui/theme.ts` (only if new type-scale steps are needed for the typeset fix).

**Risks**:
- Changing the dashboard's default collapsed/expanded behavior changes what every existing user sees on first open after an update; should be a deliberate, explicit decision, not a silent default.
- Swapping `ActionSection`/`QuickAction` for `ExpandableMenuSection`/`MenuAction` needs a careful visual diff — the two implementations currently differ slightly beyond tone (padding, shadow, accent-bar behavior), so this is a real (small) UI change, not a no-op refactor.
- None of this touches data, repositories, or business logic — the Attention badge fix is the only change that touches actual state/data-flow logic (a read-side fix only: it changes when text is shown, not what is fetched or stored).

**Testing plan** (if approved and implemented later): manual pass on an Android device/emulator per `reference/android.md` (cold-start the Attention badge fetch to confirm the loading state no longer shows "No urgent record alerts"; verify the four resized touch targets at 48pt with `adb shell settings put system font_scale 1.3` to confirm no clipping); a visual before/after screenshot comparison of the four section headers; existing automated tests in `tests/` are unaffected since none of this touches domain/repository logic other than the Attention badge's presentational branch.

## Gap List (from `document.md`, for reference — not new to this critique)
- Typography weight-900 pervasiveness and the lack of per-domain visual identity were already recorded as **Approved Refinement Targets** in `DESIGN.md`. The P2 findings above (section differentiation, small hint text) are this screen's concrete instances of those two already-approved future directions — not new scope.
