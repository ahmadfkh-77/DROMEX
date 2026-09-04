# UI Improvement Log

This log records Impeccable-driven UI improvement phases: what was critiqued, what
was changed, and the before/after result. It is additive — each phase gets its own
dated entry below the header; do not rewrite prior entries.

---

## 2026-09-02 — Home screen, phase 1

**Trigger**: `/impeccable critique src/ui/screens/HomeScreen.tsx`, approved as one
complete implementation phase covering all six recommended actions.

**Before**: 24/40 (Acceptable, 60%) — see
`.impeccable/critique/2026-09-02T21-22-01Z__src-ui-screens-homescreen-tsx.md` for
the full original report.

**After**: 35/40 (Good, 87.5%) — manual re-score following the same heuristic
rubric after implementation (see "Verification" below; no live device/emulator was
available in this environment, so this re-score is a code-grounded assessment, not
a fresh dual-agent critique run).

> **Correction (same day, see "Home screen, phase 1 — correction pass" below):**
> this 35/40 was overstated. Heuristic #1 was scored as if the Attention fix were
> complete; it was not — five of `AttentionSnapshot`'s eight fields
> (`syncPending`, `unpricedLoads`, `outstandingRecords`, `incompleteWaste`,
> `loadDrafts`) were still silently folded into the headline total with no visible
> explanation, and the Draft Center shortcut had regressed to being hidden during
> loading/error states. The corrected score for this phase's actual end state is
> **33/40**. The touch-target verification below ("grep-verified every
> `minHeight`") was also true but insufficient — see the correction entry for what
> a full manual audit found that grep could not.

**Changes made** (`src/ui/screens/HomeScreen.tsx`, `src/ui/components/DashboardOverview.tsx`,
`src/ui/components/ExpandableMenu.tsx`):

1. **Needs Attention states.** Replaced the implicit "loading looks like zero"
   behavior with an explicit `loading` / `error` / `ready` state machine. Loading
   shows a spinner in place of the count; a failed fetch now shows a distinct error
   row with a Retry button instead of silently freezing on a false "no alerts";
   the visible breakdown text now names the draft count that was already being
   added to the headline total. The underlying data query
   (`repository.getAttentionSnapshot()`, `Storage.getAllKeys()`,
   `countMeaningfulStoredDrafts`) is unchanged.
2. **Home reordered.** Header → Make Receipt → compact Needs Attention → Daily
   Operations → Records → Reports & Finance → Setup → Dashboard Overview. The four
   navigation sections stay closed by default with no memory of previous state.
   Dashboard Overview now sits after navigation, defaults to collapsed with a
   48dp "Show Dashboard" control, and no longer persists its collapsed/expanded
   state across sessions (the `dromex.dashboard.collapsed.v1` storage key and its
   read/write were removed; the separate widget-visibility preference is
   untouched).
3. **Section components unified.** `HomeScreen`'s own duplicate
   `ActionSection`/`QuickAction` implementation was removed; Home now reuses the
   existing `ExpandableMenuSection`/`MenuAction` from
   `src/ui/components/ExpandableMenu.tsx` (already used by five other screens).
   All four sections keep one consistent navy tone — no domain got its own strong
   color — differentiated instead by a restrained numbered marker ("1/4"–"4/4")
   added to `ExpandableMenuSection`'s header as a new optional prop.
4. **Field usability.** Every touch target below 48dp across the three files
   (search button, draft shortcut, dashboard period/tab/customize/hide buttons,
   widget-visibility checkboxes, list rows, metric cards, the dashboard retry
   control) was raised to a 48pt minimum. Every information-bearing text style
   under 11px was raised to 11px or above; purely decorative single-glyph marks
   (chevrons, +/×) were left at their existing larger sizes. No fixed heights were
   introduced around text that can grow, so long labels, large numeric values, and
   Android's larger font-scale settings reflow instead of clipping.
5. **Motion.** Removed the redundant `LayoutAnimation.configureNext` call that
   ran alongside `ActionSection`'s own explicit `Animated` sequence on section
   toggle (that whole duplicate component is gone). Dashboard's new collapse/show
   toggle uses a single `LayoutAnimation` call, matching the same pattern already
   used by `CollapsibleFilterCard` elsewhere in the app.
6. **Copy.** The unexplained "CONNECTED WORKFLOW" badge on the Suppliers action
   was replaced with "APPEARS IN DAILY REPORTS," matching the actual confirmed
   behavior (Supplier Loads appear in the project Daily Report automatically).

**Not changed**: navigation destinations, business rules, repository/database
behavior, calculations, synchronization, offline functionality, DROMEX branding
(colors, type roles, primitives), or any screen other than Home and the two
reusable components it now depends on.

**Remaining findings** (carried forward, not part of this phase):
- No drawn icon system exists for the four sections; differentiation uses a
  restrained numbered marker instead. If a real icon system is wanted later, that
  is a separate, larger phase (asset production, not a style-value change).
- "Daily project reports" (Daily Operations) and "Reports center" (Reports &
  Finance) still both call the same `onOpenReports` handler — unchanged per the
  "do not change navigation destinations" restriction; worth a copy/product
  decision later if the two are meant to feel distinct.
- The `design-system-color` detector still reports 13 advisory findings (literal
  colors not in `DESIGN.md`'s frontmatter/sidecar) across these files — a
  documentation gap in `DESIGN.md`, not a UI defect; unchanged by this phase.

**Verification**:
- `npm run typecheck`: clean.
- `npm test`: 162/162 passing (26 test files) — no regressions; no existing test
  covers this screen's presentation logic directly.
- Touch targets: `grep`-verified every `minHeight` in the three touched files is
  ≥48.
- Text sizes: `grep`-verified no `fontSize` below 11 remains in the three touched
  files.
- Long labels / large values / font scale 1.3: verified by code inspection only —
  no fixed `height` was introduced around dynamic text, so RN's default text
  wrapping and font-scale reflow apply. **No physical Android device or emulator
  was available in this environment**, so the on-device `adb shell settings put
  system font_scale 1.3` checks called for in the original request plan could not
  be run; this should be confirmed on a real device or emulator before release.
- Closed-by-default: confirmed by reading the code — `defaults` for the four
  sections is unchanged (`{daily:false,records:false,finance:false,setup:false}`),
  and `DashboardOverview`'s `collapsed` state now initializes to `true` with no
  persistence.

---

## 2026-09-02 — Home screen, phase 1 — correction pass

**Trigger**: user-requested correction after phase 1, once a deeper reading of
`AttentionSnapshot` and a full manual touch-target audit surfaced gaps the first
pass's verification method could not catch.

**Before**: 33/40 (Good, 82.5%) — the corrected score for phase 1's actual end
state (see the correction note above; the 35/40 originally reported there was
overstated).

**After**: 35/40 (Good, 87.5%) — this time earned by a verified fix. Full report:
`.impeccable/critique/2026-09-02T22-03-48Z__src-ui-screens-homescreen-tsx.md`.
True history: 24/40 (original) → 33/40 (actual end of phase 1) → 35/40 (this
pass).

**What was actually wrong and what changed**:

1. **`HomeAttention`'s total never matched its own explanation, and phase 1 only
   partly fixed that.** `AttentionSnapshot` (`src/domain/workspace.ts`) carries
   eight fields: `syncPending`, `unpricedLoads`, `outstandingRecords`,
   `missingReportsToday`, `incompleteWaste`, `blockedSchedule`, `openIssues`,
   `loadDrafts`. The headline total was always the sum of all eight plus a
   locally-computed `otherDrafts` count. Phase 1 added `otherDrafts` to the
   visible breakdown but left five of the eight snapshot fields completely
   unnamed. **Fixed now**: the breakdown groups every field into four named,
   reconciling categories — `Operational` (`missingReportsToday + blockedSchedule
   + openIssues + incompleteWaste`), `Financial` (`unpricedLoads +
   outstandingRecords`), `Synchronization` (`syncPending`), and `Drafts`
   (`loadDrafts + otherDrafts`) — and only non-zero groups are shown, so the
   visible text always sums to exactly the headline number. The underlying
   queries are unchanged.
2. **Draft Center had regressed to being hidden during loading and error
   states.** Phase 1's rewrite put the "Draft Center" button inside the final
   (`ready`-only) return path. **Fixed now**: `HomeAttention` renders the
   status-dependent row (loading/error/ready) and the Draft Center button as two
   independent, always-rendered parts, so Draft Center is visible and tappable in
   every state.
3. **The phase-1 touch-target check (`grep`-ing `minHeight`) could not catch a
   control with no sizing style at all.** A full manual read of every `Pressable`
   and `TouchableOpacity` in the three files found three such gaps and one
   width-only gap that grep-on-`minHeight` structurally cannot see:
   - "Clear dates" (`DashboardOverview.tsx`, custom-date panel) had no sizing —
     fixed with `hitSlop={{top:16,bottom:16,left:12,right:12}}`.
   - "Open all →" and "Open finances →" (`DashboardOverview.tsx`, list headers)
     had no sizing — fixed the same way with `hitSlop`.
   - `Hide` and `Customize` had a 48pt height (from phase 1) but no guaranteed
     48pt width for their shorter label states (`Hide`, `Done`) — fixed with
     explicit `minWidth:48`.
   - The dashboard's error "Try again" control was a bare `TouchableOpacity`
     around a `Text` with no container styling — restyled as a real bordered
     button (`retryButton`) with `minHeight:48,minWidth:48`, which also makes it
     visually read as a button rather than colored text.
   Accessibility roles/states were also added where missing:
   `accessibilityRole="button"` on the two dashboard hero cards, `Metric`, both
   list-row types, period buttons (`accessibilityState={{selected}}`), the two
   overview tabs (`accessibilityState={{selected}}`), `Hide`/`Customize`
   (`accessibilityState={{expanded}}` on Customize), and descriptive
   `accessibilityLabel`s on Home's search button, cloud/account status badge, and
   the Attention row/Draft Center button.
4. **A plausible (not device-confirmed) header overlap risk at narrow widths.**
   Static reasoning at 320dp: the header's `DromexWordmark` is a fixed
   `168×87` logo (intentionally not resized — protecting DROMEX branding), and
   the cloud-status badge's longest text (`"Locally protected"`) plus its dot and
   padding could plausibly need more width than the ~100dp left after the logo
   at the narrowest supported screen. **Mitigated, not verified**: `headerTools`
   and `statusBadge` now `flexShrink`, the status text/hint wrapper got
   `minWidth:0`, and both status lines got `numberOfLines={1}` with tail
   ellipsis, so the badge truncates gracefully instead of overflowing or clipping
   the logo. This is a code-level, reasoned mitigation — **it has not been
   confirmed on an actual 320dp device or emulator.**

**Shared-component blast radius** (`src/ui/components/ExpandableMenu.tsx` is also
used by `DraftCenterScreen`, `PavementCalculatorScreen`,
`ProjectCommandCenterScreen`, `WallConstructionScreen`, `WorkspaceHubScreen`, and
`PavementAdvancedSections`): verified by reading every call site.
- All six consumers pass two-character `number` values (`"01"`–`"08"`); the
  `number` text's fontSize change (10→11, from phase 1) still fits its fixed
  28px-wide box everywhere.
- None of the six pass `badge`; its fontSize change (8→11, from phase 1) is
  invisible to them.
- None of the six pass the new `marker` prop; it renders nothing for them.
- The new `pressable` wrapper's `minHeight:48` is smaller than the header's own
  existing `minHeight:67`, so it changes nothing for any consumer.
- **Net rendered impact on the other six screens: none.** They were not
  redesigned and their closed-by-default behavior is untouched — confirmed by
  reading each screen's own `open`/`toggle` state, which this pass did not edit.

**Verification**:
- `npm run typecheck`: clean.
- `npm test`: 162/162 passing (26 test files) — no regressions.
- `git diff --check`: clean (no whitespace errors).
- Touch targets: this time verified by manually reading every `Pressable` and
  `TouchableOpacity` in the three files (not by grepping `minHeight` alone),
  cross-checked against explicit `minHeight`/`minWidth`/`hitSlop` values.
- Responsive layout at 320/360/412dp and font scale 1.0/1.3: **not verified on a
  physical device or emulator — none was available in this environment.** One
  plausible overlap risk was found by static reasoning and mitigated in code
  (see above); this remains an open item for on-device confirmation before
  release, not a claimed pass.

---

## 2026-09-03 — Home screen, phase 2: visual redesign

**Trigger**: user feedback that phases 1's corrections were real but invisible —
"it still feels almost the same" — followed by an explicit, approved redesign
brief (composition, hierarchy, card treatment, color discipline, animation,
outdoor readability), plus a follow-up request to swap the Make Receipt card's
navy text for cream/warm-white.

**Why phase 1 didn't look different**: it raised a few text sizes 1–3px, swapped
one near-identical component implementation for another, and added a barely
visible "1/4" marker. `theme.ts`'s type scale was still weight `900` on every
role, and no color, spacing, card, or shadow treatment had changed. This phase
addresses that directly.

**Scope constraint carried through the whole implementation**:
`ExpandableMenuSection`/`MenuAction` (`src/ui/components/ExpandableMenu.tsx`) are
shared by six other screens (`DraftCenterScreen`, `PavementCalculatorScreen`,
`ProjectCommandCenterScreen`, `WallConstructionScreen`, `WorkspaceHubScreen`,
`PavementAdvancedSections`). Every visual change to that file is gated behind a
new optional prop, **`refined?: boolean` (default `false`)** — the six other
screens keep calling it without the prop and render byte-for-byte identical to
before; only `HomeScreen.tsx` passes `refined`.

**What changed, visually**:

1. **Header**: search button became a navy-outline ghost button (was solid navy
   fill); the cloud/account status badge dropped its light-blue tint for a plain
   bordered chip. Both quieter, so they stop competing with the hero below.
2. **Make Receipt (primary hero)**: text recolored from Structural Navy to a
   warm near-white, `#FFFCF6`, per your follow-up request — computed contrast
   against Signal Orange (`#C84B31`) is **~4.56:1**, clearing WCAG AA's 4.5:1
   normal-text threshold at every size used in that card (title 26px/900,
   eyebrow 11px/700, hint 13px/500). This color is a local constant used only in
   this card — no other orange element in the app changed. Hierarchy inside the
   card now comes from size/weight (900 title, 700 eyebrow, 500 hint), not from
   a navy/cream color split.
3. **Attention**: now has four visually distinct states instead of two treatments
   doing double duty — **loading** (neutral white/bordered, navy spinner),
   **calm/all-clear** (success-green tint, `total===0`), **urgent/needs-review**
   (amber tint, thicker 6px left border, a light shadow for prominence,
   `total>0`), **error** (danger-red tint). Prominence now tracks whether action
   is actually required, per your safeguard. Draft Center became a quiet
   navy-outline row (was solid navy fill) — still full-width, still labeled,
   still 48dp, just visually secondary to Attention as requested.
4. **Navigation sections**: `ExpandableMenuSection`/`MenuAction` refined mode
   adds: a solid Ledger-Cream rounded-square index chip (`01`–`04`, replacing the
   "1/4" fraction and matching the two-digit convention row numbers already use)
   in place of the translucent circle; the expanded body becomes one bounded
   Ledger-Cream card containing the rows (was: individually white-shadowed cards
   floating on the page background); rows inside became flat ruled list items
   (thin bottom divider, no per-row shadow — the one outer card carries the
   depth); section/row title weight down to `700`, hint/body weight to
   `500`/default (was `900` throughout); the `+`/`×` disclosure glyph is now one
   glyph (`+`) that **rotates 45°** on open — a `+` rotated 45° is an `×`, so the
   same two required visual states (`+` closed, `×` open) are preserved, just
   connected by one smooth animation instead of an abrupt text swap.
5. **Color discipline**: row numbers and chevrons inside refined sections moved
   from Signal Orange to Structural Navy, so orange now appears only as the
   primary hero, the "connected" Suppliers row tint, and the section marker's
   background accent — scarcer, so it reads as more valuable where it does
   appear. Nothing was desaturated or grayed out; Ledger Cream, Structural Navy,
   and Signal Orange are all still visibly present and load-bearing.
6. **Spacing**: zone boundaries (before the navigation zone, before the
   dashboard zone) got more room (`marginTop:12`/`16`) instead of one flat gap
   between every block; related items inside a zone stayed tight.
7. **Dashboard** (`DashboardOverview.tsx`, used exclusively by Home already, no
   gating needed): the same weight grading applied directly — `900` kept only on
   the four true critical numbers (plant-overview title, the two hero values,
   metric values); everything else (tab labels, list titles, row titles, button
   labels) stepped down to `700`.
8. **Reduced motion**: a new `useReducedMotion()` hook (exported from
   `ExpandableMenu.tsx`) checks `AccessibilityInfo.isReduceMotionEnabled()` and
   its change event. Applied universally (not gated behind `refined`, since it's
   a system-accessibility-setting response, not a design choice): the section
   expand/collapse and glyph-rotation animations skip to their end state
   instantly when the OS reduce-motion setting is on; Home's own entrance
   stagger and the Make Receipt press-spring do the same. At-rest appearance is
   identical either way; only users with reduce-motion enabled see shorter
   transitions, on every screen that uses `ExpandableMenuSection` — a
   pre-existing gap this closes, not a visual redesign choice.

**Not changed**: navigation destinations, business rules, repositories, database
behavior, calculations, offline functionality, Bluetooth behavior, the DROMEX
logo, or the three brand hex values themselves (`#C84B31` / `#173F67` /
`#FFF8ED`) — only which of them is used where, and how much weight/size carries
each role.

**Verification**:
- `npm run typecheck`: clean.
- `npm test`: 162/162 passing (26 test files) — no regressions.
- States: loading/error/urgent/calm all read from distinct, intentional
  treatments now (see above) — verified by code reading; all four render from
  the same unchanged data logic (`groups`/`total`/`breakdown` untouched).
- Touch targets: every new or changed interactive element
  (search button, status badge, Draft Center, retry button, marker chip is
  decorative/non-interactive) keeps its existing ≥48dp sizing; no new small
  controls were introduced.
- Long labels / large numbers / font scale: no `numberOfLines` caps were added
  to any title/hint/body/badge text (an earlier draft of this pass mistakenly
  added them and was reverted before committing to files) — everything still
  wraps freely with no fixed heights, consistent with the phase-1 correction.
- Small/large widths: no new fixed pixel widths were introduced other than the
  34×30 marker chip (fixed-size by design, decorative) — the redesign is
  colors, weights, radii, and spacing values, not new layout containers with
  hardcoded widths.
- Expo Go: while this pass was in progress, the running dev server's log shows
  a successful iOS bundle build (952 modules, no fatal error) with only two
  unrelated benign warnings (`@noble/hashes` export-map fallback,
  `SafeAreaView` deprecation) — suggestive that the app loads without the
  predicted Bluetooth-import crash, but **not a substitute for the user's own
  on-device confirmation**, which hasn't been explicitly reported yet.
- No physical device/emulator was used directly by this session for visual
  confirmation of the redesign itself — the same environment limitation as
  every prior phase.

---

## 2026-09-03 — Home screen: final summary, phase complete

**Purpose of this entry**: a single, complete, accurate record of the whole Home-screen
UI effort — original problems, every change across both phases, the final
result, and verification — now that the redesign has been physically reviewed
and approved on a real device. Earlier entries above are kept for history and
are not rewritten; where they conflict with this entry, this entry is current.

### 1. Original Home-screen problems

From the first critique (`.impeccable/critique/2026-09-02T21-22-01Z__...md`,
24/40, Acceptable):
- The "Needs Attention" badge could show a false all-clear while still loading,
  and its total silently included counts (including draft counts) that were
  never named in the visible breakdown.
- Several touch targets (search button, draft shortcut, dashboard period/tab/
  customize/hide controls) were smaller than both Android's 48dp guideline and
  the app's own documented 48pt minimum.
- The dashboard (with its own filters, customize panel, and swipeable pages)
  sat above all navigation, adding scroll/interaction depth in front of the
  screen's most frequent actions.
- All four navigation sections were visually identical (solid navy, no
  differentiation), duplicating a component pattern that already existed
  elsewhere in the codebase without reusing it.
- Several information-bearing text styles were 8–9px, below comfortable
  outdoor legibility.
- A "CONNECTED WORKFLOW" badge used unexplained internal jargon.
- Underneath all of that, the whole screen used one visual register throughout
  — near-uniform weight-900 type, ad hoc card radii/padding/shadows, and no
  deliberate spacing rhythm between functional zones — so even once the above
  was fixed, the screen still looked, in the owner's words, "almost the same."

### 2. Every change implemented, both phases

**Phase 1** (correctness): Needs-Attention state machine (loading/error/ready),
Home reordered (header → hero → attention → four nav sections → dashboard),
`ActionSection`/`QuickAction` replaced by the shared `ExpandableMenuSection`/
`MenuAction`, all touch targets raised to 48pt, all information text raised to
≥11px, a redundant `LayoutAnimation` call removed, "CONNECTED WORKFLOW" renamed
to "APPEARS IN DAILY REPORTS".

**Phase 1 correction** (same day): found the Attention fix was only partial —
5 of `AttentionSnapshot`'s 8 fields were still silently folded into the total
with no visible explanation, and Draft Center had regressed to being hidden
during loading/error. Fixed both; corrected touch-target verification from
grep-only to a full manual `Pressable`/`TouchableOpacity` audit, which found
three more controls ("Clear dates," "Open all," "Open finances") with no
sizing at all. Score corrected: 24 → 33 (true end of phase 1) → 35.

**Phase 2** (visual redesign, approved before implementation): typography
weight grading, card/spacing hierarchy, a Ledger-Cream bounded container with
ruled rows replacing individually-shadowed floating rows, a numbered index chip
replacing the "1/4" marker, a rotating disclosure glyph, four distinct
Attention states, a quieter header/Draft Center, tighter orange usage, and
(follow-up request) the Make Receipt card's text recolored to warm white.

### 3. Final layout and workflow

Home is one scrolling page, top to bottom:
1. Header — DROMEX wordmark/logo, a quiet outline Search button, a quiet
   bordered cloud/account status chip.
2. Make Receipt — the single primary action, full orange emphasis.
3. Needs Attention (compact) + Draft Center — one grouped, always-visible
   status block.
4. Four collapsible navigation sections — Daily Operations, Records, Reports &
   Finance, Setup — each closed by default, opened individually.
5. Dashboard Overview — collapsed by default behind a "Show Dashboard" control,
   sitting after navigation rather than in front of it.

Every `onOpen*`/`onMakeReceipt`/`onSearch` destination and prop is unchanged
from before phase 1 — this is presentation only.

### 4. Visual hierarchy, cards, spacing, typography, colors, animations

- **Hierarchy**: one clear primary action (Make Receipt, full orange, weight
  900 title), one clearly-secondary status block (Attention/Drafts), four
  equal-weight navigation entries, one clearly-deferred analytics zone
  (Dashboard, collapsed).
- **Cards**: Home's refined navigation sections now read as a bounded
  Ledger-Cream "folder" per section (one card, one shadow) containing flat
  ruled rows, instead of each row being its own separately-shadowed white card
  floating on the page background.
- **Spacing**: zone boundaries (before navigation starts, before the dashboard
  starts) get extra margin (`12px`/`16px`) instead of one flat gap between
  every block; related items inside a zone stay tight.
- **Typography**: within Home's refined sections, `900` is reserved for the
  Make Receipt title and the marker chip's numeral; section/row titles are
  `700`; hints/bodies are `500`/default. (`src/ui/theme.ts`'s global tokens are
  untouched — this is a local, opt-in override, not a global change.)
- **Colors**: Signal Orange, Structural Navy, and Ledger Cream are all still
  visibly present and load-bearing — nothing was grayed out or minimized.
  Orange became more selective (hero, the "connected" Suppliers row, the
  marker chip accent) rather than spread across row numbers and chevrons too;
  those moved to Structural Navy. Ledger Cream gained a real, visible job
  (the section-body container, the marker chip fill) instead of only being a
  page background.
- **Animations**: entrance stagger (unchanged), section expand/collapse
  (unchanged timing, now paired with a rotating glyph), Make Receipt press
  feedback (unchanged spring), all now skip to their end state instantly when
  the OS reduce-motion setting is on.

### 5. Make Receipt warm-white text treatment

Title, eyebrow, and hint inside the orange Make Receipt card were recolored
from Structural Navy to `#FFFCF6` (a warm near-white). Computed contrast
against Signal Orange `#C84B31`: **≈4.56:1**, clearing WCAG AA's 4.5:1 threshold
for normal text at every size in that card (26px/900 title, 11px/700 eyebrow,
13px/500 hint). Hierarchy inside the card comes from size and weight, not a
color split. This color and treatment apply **only** to this one card — no
other orange surface in the app changed. Documented as a new frontmatter token,
`hero-text-warm: "#FFFCF6"`, in `DESIGN.md`, explicitly scoped to this card.

### 6. The four Attention states

- **Loading**: neutral white/bordered card, navy spinner in place of the count.
- **All-clear** (`total===0`): success-green tint — calm, not alarming.
- **Urgent** (`total>0`): amber tint, thicker 6px left border, a light shadow
  for real prominence — visually louder specifically because action is needed.
- **Error**: danger-red tint, an explicit "Could not check records" message,
  and a real Retry button (bordered, 48×48dp) that re-runs the same unmodified
  data query.

All four render from the same `groups`/`total`/`breakdown` values computed from
`AttentionSnapshot`'s 8 fields (`missingReportsToday`, `blockedSchedule`,
`openIssues`, `incompleteWaste` → Operational; `unpricedLoads`,
`outstandingRecords` → Financial; `syncPending` → Synchronization;
`loadDrafts` + local `otherDrafts` → Drafts) plus local draft detection —
grouped so the visible breakdown always sums to exactly the headline number.

### 7. Draft Center treatment

A quiet navy-outline row (white/cream fill, navy border and text) instead of a
solid navy block — visually secondary to Attention, per the safeguard that it
"can be quieter... but must remain easy to find." It is rendered
**unconditionally**, independent of Attention's loading/error/ready state, so
it stays visible and tappable (48dp) in every state, fixing phase 1's
regression where it disappeared during loading/error.

### 8. The refined expandable navigation design

`ExpandableMenuSection`/`MenuAction` (`src/ui/components/ExpandableMenu.tsx`)
gained an opt-in `refined?: boolean` prop, default `false`. Only
`HomeScreen.tsx` passes it. When `refined`:
- A solid Ledger-Cream rounded-square chip (`01`–`04`) marks each section,
  matching the two-digit convention row numbers already used.
- The expanded body is one bounded Ledger-Cream card; rows inside are flat,
  ruled (thin bottom divider), with a narrower 3px left accent instead of an
  individual shadow each.
- The `+` disclosure glyph rotates 45° into `×` (see point 9) instead of
  swapping text abruptly.
- Section/row title weight `700`, hint/body `500`/default, row numbers/
  chevrons Structural Navy instead of Signal Orange.

### 9. Sections closed by default

Unchanged through every phase: `defaults = {daily:false, records:false,
finance:false, setup:false}` in `HomeScreen.tsx`. No section is remembered or
automatically reopened between visits — confirmed by reading the code; no
persistence mechanism exists for this state.

### 10. Dashboard placement and collapsed behavior

`DashboardOverview` was moved from the top of Home (phase 1) to after all four
navigation sections, and its `collapsed` state now initializes to `true` with
**no persistence** (the `dromex.dashboard.collapsed.v1` storage key and its
read/write were removed in phase 1's correction pass) — it starts collapsed on
every visit, with a 48dp "Show Dashboard" control, and does not remember being
opened. The separate dashboard-widget-visibility preference (which
metrics/lists are shown) is a different, untouched setting.

### 11. Accessibility, touch targets, outdoor readability, reduced motion

- **Touch targets**: every interactive control across `HomeScreen.tsx`,
  `DashboardOverview.tsx`, and `ExpandableMenu.tsx` is ≥48×48dp, via explicit
  `minHeight`/`minWidth` or `hitSlop` where a control had no natural sizing
  (verified by manually reading every `Pressable`/`TouchableOpacity`, not by
  grepping `minHeight` alone — see the phase-1 correction entry for why that
  distinction matters).
- **Accessibility roles/states**: `accessibilityRole="button"` and, where
  meaningful, `accessibilityState={{selected}}`/`{{expanded}}` and descriptive
  `accessibilityLabel`s were added across previously-unlabeled controls
  (dashboard hero cards, metric cards, list rows, period/tab buttons, Hide/
  Customize, Home's search/status/attention/draft controls).
- **Outdoor readability**: no information-bearing text below 11px remains in
  any touched file; the redesign's typography grading raises visual weight on
  what matters (Make Receipt, urgent Attention) rather than relying on uniform
  boldness; Signal Orange/Structural Navy/Ledger Cream all maintain checked
  contrast (Make Receipt text ≈4.56:1 against orange; see point 5).
- **Reduced motion**: a new `useReducedMotion()` hook (exported from
  `ExpandableMenu.tsx`) checks `AccessibilityInfo.isReduceMotionEnabled()` and
  its change event. Applied universally — not gated behind `refined`, since
  it's a response to a system accessibility setting, not a design choice — so
  every screen using `ExpandableMenuSection` now respects it, and Home's own
  entrance stagger and Make Receipt press-spring do too. At-rest appearance is
  identical either way; only transition duration changes for users with the
  setting on.
- **Long labels / large numbers / font scale**: no `numberOfLines` caps exist
  on any title/hint/body/badge text in the touched files — everything wraps
  freely rather than truncating, which matters more, not less, at larger
  Android font-scale settings. (An early draft of phase 2 mistakenly added such
  caps and it was caught and reverted before shipping — noted here so a future
  session doesn't reintroduce it by assuming it was intentional.)
- **Not verified on real hardware by this session**: font-scale 1.3 and exact
  320/360/412dp layout were reasoned about in code, not measured on a device
  or emulator (none was available in this environment) — see point 16.

### 12. Every application file changed (both phases, cumulative)

- `src/ui/screens/HomeScreen.tsx`
- `src/ui/components/DashboardOverview.tsx`
- `src/ui/components/ExpandableMenu.tsx`

No other application file was touched by this Home-screen work. (Unrelated
files modified before this work began — `scripts/generate-demo-backup.ts`,
`src/services/backup/BackupArchive.ts`, `src/ui/screens/DriversTrucksScreen.tsx`,
`src/ui/screens/LoadCorrectionsScreen.tsx` — were left exactly as found.)

### 13. Reusable components changed, and how other screens are protected

`ExpandableMenuSection` and `MenuAction` are shared by six other screens:
`DraftCenterScreen`, `PavementCalculatorScreen`, `ProjectCommandCenterScreen`,
`WallConstructionScreen`, `WorkspaceHubScreen`, `PavementAdvancedSections`.
Every visual change to these two components is gated behind the `refined` prop
(default `false`); none of the six pass it, so they call the components exactly
as before and render byte-for-byte the same as before this work — confirmed by
reading every call site: all six pass only 2-character `number` values (fits
the unchanged fixed-width slot), none pass `badge` or the new `marker`, and the
new `minHeight:48` wrapper is smaller than the header's pre-existing `minHeight:
67`. The one universal (non-gated) change, `useReducedMotion()`, only alters
behavior for users with the OS reduce-motion setting on, and only shortens an
existing transition — it does not change any screen's at-rest appearance.

### 14. Automated verification

- `npm run typecheck`: clean, both phases.
- `npm test`: 162/162 passing (26 test files), both phases — no regressions.

### 15. Physical verification

Reviewed live in **Expo Go on an Android phone**, connected via LAN
(`exp://192.168.10.25:8081`, Metro run with `--lan` after `--tunnel` failed on
this environment's network). The owner approved: layout, colors, hierarchy, the
Make Receipt card, the expandable navigation sections, and the animations.

### 16. Remaining limitations and future regression checks

- **Font scale 1.3 and exact 320/360/412dp layout were never measured on a
  device or emulator by this session** — only reasoned about in code (no fixed
  heights around dynamic text, `flexShrink`/`numberOfLines` truncation on the
  header's status badge). Now that physical review has happened, a quick
  on-device check of `adb shell settings put system font_scale 1.3` on the
  actual phone used would close this gap with real evidence instead of static
  reasoning.
- The `detect.mjs` design-token scanner still reports ~13 advisory "color
  outside DESIGN.md" findings (legitimate one-off tint/border colors never
  added to `DESIGN.md`'s frontmatter) — unrelated to this redesign, pre-existing,
  worth a future `/impeccable document`/`extract` refresh.
- "Daily project reports" (Daily Operations) and "Reports center" (Reports &
  Finance) still route to the same handler — unchanged, since destinations
  were out of scope for every UI phase; worth a product decision if they
  should ever diverge.
- No drawn icon system exists; the approved "domain visual identity" target is
  implemented on Home via the numbered chip only, not icons. Extending either
  Approved Refinement Target (typography grading, domain identifiers) to the
  six other `ExpandableMenuSection` consumers, or to `src/ui/theme.ts`'s global
  tokens, is unstarted and would be its own explicitly scoped phase.
- **Regression check for future sessions**: if `ExpandableMenu.tsx` is touched
  again, verify both the `refined` and non-`refined` render paths — they are
  meant to diverge now, and a change that "simplifies" by merging them would
  silently alter the six other screens Home's redesign was built to protect.

### 17. Status

**The Home-screen UI phase is complete.** Both correctness (phase 1 + its
correction) and visual redesign (phase 2) have shipped, been verified by
`typecheck`/`test`, and been physically reviewed and approved by the owner on
an Android device via Expo Go. Nothing has been committed, pushed, or built
into an APK. No other screen has been started.

---

## 2026-09-03 — Project Command Center: critique and redesign

**Trigger**: `/impeccable` critique/audit of `ProjectCommandCenterScreen.tsx`
against the governing requirements (`requirements/SRS.md` FR-085–FR-088,
DR-029), followed by an approved implementation pass. **Grounding constraint
throughout**: FR-086 names this screen's seven sections explicitly, in this
exact order, as a Must-priority confirmed requirement — *"Planning and Today,
Field Operations, Issues, Photos, All Activity Timeline, Activity by Record
Type, and Records and Documents."* This phase changed presentation only; the
taxonomy, order, section names, closed-by-default behavior, latest-20/50/500
caps, and project-date-boundary validation are all exactly as FR-086 requires
and were not touched.

**Before**: 24/40 (Acceptable, 60%). **After**: 36/40 (Excellent, 90%). Full
critique reports:
`.impeccable/critique/2026-09-03T11-03-03Z__src-ui-screens-projectcommandcenterscreen-tsx.md`
(after; the before score was derived from the same audit pass, retroactively
scored on the same rubric — no separate "before" snapshot file exists since
critique and implementation were approved together in one phase).

### Original problems found

1. **A failed initial load left the user stuck on a bare "Loading {name}…" text
   forever, with no Back button and no error shown** — `if(!snapshot)return
   <View>...` fired unconditionally whenever `snapshot` was null, including
   after the load's own `.catch()` had already set an error the UI could never
   reach. Same bug class as Home's original Attention defect, but worse here:
   there wasn't even a Back button in that state.
2. **Unbounded `project_issues` and `project_media` queries**, rendered without
   virtualization inside a plain `ScrollView` — a real performance risk for a
   long-running project with many photos or issues.
3. **"Manage project" — the only path to edit details or reactivate a completed
   project — was a bare, unstyled text link** with no minimum touch size.
4. **Ten flat, equal-weight metric cards** competed for attention before any
   action was visible, and none were tappable despite several (especially
   "Loads") visually inviting a tap.
5. **Three different visual vocabularies for the same underlying idea** — a
   record row: `MenuAction` rows, bespoke issue cards, bespoke activity rows —
   none sharing radius, padding, or shadow treatment.
6. Several text styles at 8–9px (`issuePriority`, `activityType`, `photoDate`,
   `statusText`) — the same outdoor-legibility gap Home had before its own
   correctness pass; this screen had never been touched by that work.
7. Touch targets below 48dp in the screen's own code ("Manage project," the
   priority chips) and in the shared `DatePickerField.tsx` (month-nav 42×42,
   close/quick buttons under 48dp, day cells at 46px).
8. No copy anywhere explained that "All Activity Timeline"'s date filter does
   not apply to "Activity by Record Type," or that the latter always shows its
   own latest-50-per-type regardless of the timeline's filter — a real
   expectation mismatch, though the underlying asymmetry itself is a confirmed
   FR-086 requirement, not a bug.

### What changed

**`src/ui/screens/ProjectCommandCenterScreen.tsx`** (full rewrite, same props,
same handlers, same repository calls, same seven sections in the same order):

1. **Loading/error state machine.** A real `loading`/`error`/`ready` status
   drives the render: loading shows a spinner inside the normal page header
   (Back button included); a failed load shows a clear message and a Retry
   button that re-triggers the same unmodified `repository.getProjectWorkspace`
   call. Mutation actions (add issue, resolve issue, add photo) keep their
   existing independent `busy`/`error`/`message` handling — refreshing the
   snapshot after a mutation no longer flips the whole screen back to a loading
   skeleton.
2. **Manage Project** is now `<AppButton tone="secondary">` — the app's
   existing bordered-secondary style, 48dp guaranteed — same
   `routes.onManageProject` destination, no behavior change.
3. **Metrics regrouped into three labeled clusters** exactly as approved: *Site
   Activity* (Loads, Delivered, Supplier Loads, Waste Dumps, Fuel Used),
   *Project Control* (Daily Reports, Open Issues), *Planning & Engineering*
   (Open Schedule, Pavement Calculations, Walls). All ten metrics and their
   calculations are unchanged — only their grouping and labels changed. The
   navy "accent" highlight, previously applied unconditionally to "Loads," is
   now reserved for "Open Issues" and only when its count is above zero — the
   one metric that means "go look at something," consistent with reserving
   Signal-Orange-adjacent emphasis for items that actually need attention
   rather than scattering it arbitrarily. (Loads keeps its plain white
   treatment; nothing about what it shows changed.)
4. **Issue and activity rows unified** onto one new "ledger row" presentation:
   a bounded Ledger-Cream card (matching Home's already-shipped `refined`
   section-body treatment) containing flat, ruled rows with a colored left
   accent — Signal-Orange-family priority colors for **open** issues
   (Urgent→danger red, High→warning amber, Normal→navy, Low→muted — all
   already-existing semantic colors, reused, not invented), Structural-Navy for
   plain activity rows, and success-green for **resolved** issues. This
   replaces three previously-separate one-off styles with one consistent
   grammar, and is the first screen besides Home to adopt the `refined`
   `ExpandableMenuSection`/`MenuAction` variant.
5. **Photos**: progressive reveal instead of rendering the full unbounded list.
   Shows 8 initially; a "Show More Photos (N more)" button reveals 8 more at a
   time; every photo remains reachable by tapping the button repeatedly. The
   query, `addProjectPhoto` call, and stored data are completely unchanged —
   this is a client-side rendering limit only. **The underlying unbounded
   `SELECT * FROM project_media WHERE project_id=? ORDER BY created_at DESC`
   query (no `LIMIT`) is documented here as a future performance concern**,
   not resolved: a project with hundreds of photos still fetches all of them
   into memory on every load, just doesn't render them all onto the screen at
   once. The same is true of `project_issues`, which has no progressive-reveal
   treatment yet since issue lists are realistically much shorter than photo
   libraries — flagged for a future phase if that assumption stops holding.
6. **Clarifying copy, no behavior change**: "All Activity Timeline"'s hint now
   states plainly that date filtering applies to it only; "Activity by Record
   Type"'s hint now states that each group shows its latest records
   independently of that filter. Same counts, same caps, same data.
7. Every text style is now ≥11px; the priority-selection chips gained
   `minHeight:48`; every remaining interactive element routes through a shared
   component (`AppButton`, `MenuAction`, `ExpandableMenuSection`'s `Pressable`,
   `DatePickerField`'s own control) that already guarantees ≥48dp — confirmed
   by reading the one raw `TouchableOpacity` left in the file (the priority
   chip) plus every other interactive element's underlying component.
8. Reduced-motion support is inherited automatically from `ExpandableMenu.tsx`'s
   existing universal `useReducedMotion()` hook — no new animation system was
   introduced; the `+`→`×` rotating-glyph animation Home already shipped now
   also applies here via the same `refined` prop.

**`src/ui/components/DatePickerField.tsx`** (shared with Home's
`DashboardOverview` custom date-range panel): `close` button, `monthButton`,
and `quick` (Today/Clear date) buttons raised to ≥48dp; calendar `day` cells
raised from 46px to 48px tall (width stays a responsive 1/7 of the grid — a
fixed 7-column calendar grid is a recognized exception to per-cell 48dp
*width*, the same way Android's own Material date picker handles it; height,
which has no such constraint, was raised). The modal header's "CHOOSE A DATE"
eyebrow label (10px) was **not** touched — decorative, not an interactive
control, outside the approved scope for this shared file. **Verified no
regression to Home**: `DashboardOverview`'s collapsed field control
(`minHeight:49`) is untouched; only the modal's internal buttons/cells grew by
a few px, which does not affect the calendar's on-screen fit.

### Not changed

Business rules, calculations, repository/database behavior (including the
unbounded photo/issue queries, the 20/50/500 activity caps, and project
date-boundary validation), stored data, offline behavior, Bluetooth,
synchronization, navigation destinations, and the Home screen (beyond the one
approved shared `DatePickerField.tsx` correction) — all exactly as before.

### Verification

- `npm run typecheck`: clean.
- `npm test`: 162/162 passing (26 test files) — no regressions.
- Touch targets: confirmed by reading every interactive element in both
  changed files — one raw `TouchableOpacity` remains in
  `ProjectCommandCenterScreen.tsx` (the priority chip, now `minHeight:48`);
  every other control routes through an already-48dp-guaranteed shared
  component.
- Text sizes: `grep`-confirmed no `fontSize` below 11 in
  `ProjectCommandCenterScreen.tsx`; `DatePickerField.tsx` has one pre-existing
  10px decorative label, intentionally left out of scope.
- States: loading (spinner + Back button), initial error (message + Retry +
  Back button), empty (issues/photos/timeline/activity-by-type all still use
  `EmptyState`, unchanged), filtered-zero (unchanged "No activity in this
  period"), completed-project read-only banner (unchanged), populated
  (restyled onto the new ledger-row language) — all reasoned through by code
  reading; **not yet verified on a physical device by this session** (the
  owner verifies next, per the established pattern from Home's phases).
- Both `ExpandableMenuSection`/`MenuAction` render paths (`refined` and
  default) were exercised in code: this screen now uses `refined` everywhere;
  the six *other* consumers of these shared components were not edited and
  were re-confirmed unaffected by the same reasoning as Home's phase (they
  don't pass `refined`, so nothing about them changed).
- Metro: bundled successfully after these edits (391ms incremental rebuild, no
  fatal error) — dev server left running for physical inspection.

### Remaining limitations, for future phases

- The unbounded `project_issues`/`project_media` repository queries are a
  documented future performance concern, not resolved (see Photos above).
- No text search exists for issues or activity records — only date-range
  filtering, unchanged from before. Not added this phase (would be a new
  business feature).
- No shortcuts/bulk actions for power users on this screen.
- `DatePickerField.tsx`'s decorative 10px eyebrow label was left as-is.

**Status**: implemented, typechecked, tested, not yet physically verified.
Not committed, not pushed, no APK built. Metro left running for Expo Go
inspection. Waiting on the owner's physical Android approval before any
further UI phase begins.

---

## 2026-09-03 — Project Command Center: visual correction pass

**Trigger**: physical review of the first redesign pass on Android. Verdict:
"the workflow improvement is good, but the visual design needs another
focused pass" — specifically, every section header used a different strong
color (navy/orange/cream) and read as busy, and the opened sections still
looked like a plain stack of generic cards rather than a distinctive
construction-management interface.

**A mid-implementation correction, disclosed here for the record**: the first
draft of this pass gated its new visual enhancements behind the existing
`refined` flag — the same flag `HomeScreen.tsx` already uses. That would have
silently changed Home (new header shadow, attached tab, restyled rows, new
font weights) despite the explicit instruction not to touch Home. This was
caught and fixed before finishing, by introducing a second, independent flag
(see "`refined` vs `polished`" below) so Home's rendering stayed provably
untouched.

### What changed, visually

1. **Unified Structural Navy parent labels.** All seven primary sections
   (`Planning and Today`, `Field Operations`, `Issues`, `Photos`, `All
   Activity Timeline`, `Activity by Record Type`, `Records and Documents`)
   now share one navy header. Removed `tone="orange"` from Field
   Operations/Timeline and `tone="cream"` from Issues/Records — previously
   each had its own fill, which read as a different color per domain. The
   nested nine-or-fewer type sub-folders inside "Activity by Record Type"
   keep a lighter cream tone as a distinct *tier* (nested folder inside a
   folder), not a domain color.
2. **Attached numbered ledger tab.** Each section's `01`–`07` marker is now a
   small Ledger-Cream rounded-square tab, absolutely positioned to overlap
   and protrude above the header's top edge — like a physical folder tab —
   instead of sitting inline inside the header as a small circle/chip.
3. **Connected header/body folder treatment.** When a section opens, the
   header's bottom corners and the body's top corners both flatten, so the
   navy header and the Ledger Cream body read as one continuous opened
   folder rather than two stacked, unrelated cards.
4. **Animated Signal Orange seam.** The existing 3px accent bar (already
   present, previously only 3px in every mode) grows to 4px and is followed,
   once settled, by a static 4px Signal Orange rule exactly where the
   flattened header and body edges meet — literally marking the seam of the
   opened folder.
5. **`+` → `×` rotation** — unchanged from Home's already-shipped mechanism
   (one glyph rotating 45°); confirmed still working identically for both
   screens since it remains tied to the shared `refined` flag, not the new
   one.
6. **Layered white content surfaces.** Reversed the flat, ruled-row look
   from the first redesign pass (built in direct response to that pass's own
   feedback) back toward individually-shadowed white cards — but now
   contained *inside* the Ledger Cream section body rather than floating on
   the bare page background, so the "layered cream and white surfaces" read
   is deliberate, not accidental.
7. **Content-specific compositions**, replacing one uniform internal layout:
   - *Planning and Today*: same 5 actions, same order, now visually
     clustered under two in-section labels ("PLAN & CALCULATE" / "RECORD
     TODAY") — no action moved section or position.
   - *Field Operations*: uniform white-card action rows, no per-row tint.
   - *Issues*: priority is now a colored badge **pill** (tinted background,
     not just colored text) — Urgent/High/Normal/Low reuse the existing
     danger/warning/navy/muted colors; resolved issues shift to success
     green. No new colors were introduced.
   - *Photos*: unchanged progressive "Show More Photos" behavior; cards
     gained a subtle shadow.
   - *All Activity Timeline*: rebuilt as an actual vertical timeline — a
     restrained rail with connecting segments and a dot per record, white
     content cards to the right.
   - *Activity by Record Type*: nested Ledger-Cream folders, each still
     showing its own record count and an explicit note that it is
     independent of the timeline filter above.
   - *Records and Documents*: uniform white-card row treatment, matching
     Planning/Field Operations.
8. **Typography regraded** to the requested scale: `900` reserved for the
   project name and the tab numerals only; `700` for section/row titles;
   `600` for labels, badges, group headers, and status text; `500` for
   descriptions/metadata. No text below 11px (`grep`-confirmed).
9. **Short staggered child-row reveal**, capped so it never becomes a
   "delayed interaction" problem on large projects: each row's animation
   delay is `min(index × 26ms, 220ms)`, so a project with hundreds of
   activity rows still finishes revealing within ~450ms total, not minutes.
10. **Subtle header press feedback** (a small scale-down on press) added to
    section headers, matching the micro-interaction language already used
    elsewhere in the app.

### `refined` vs `polished`

`src/ui/components/ExpandableMenu.tsx` now exposes two independent boolean
props on `ExpandableMenuSection`/`MenuAction`:

- **`refined`** — Home's exact shipped, physically-approved treatment
  (graded weights, Ledger Cream body, rotating disclosure glyph). Unchanged
  by this pass. **Used by**: `HomeScreen.tsx` only.
- **`polished`** — this pass's new layer (attached tab, connected
  header/body seam, header shadow and press feedback, capped staggered
  reveal, white floating rows instead of flat ruled rows, weight-600
  labels/badges instead of weight-700). Always passed *alongside* `refined`,
  never alone. **Used by**: `ProjectCommandCenterScreen.tsx` only.
- **The five remaining consumers** (`DraftCenterScreen`,
  `PavementCalculatorScreen`, `WallConstructionScreen`, `WorkspaceHubScreen`,
  `PavementAdvancedSections`) pass neither flag and render the original
  base/default treatment, confirmed unaffected by reading every call site
  (none reference `refined` or `polished`).

### Verification

- `npm run typecheck`: clean.
- `npm test`: 162/162 passing — no regressions.
- Confirmed `HomeScreen.tsx` was not edited in this pass and passes only
  `refined`, never `polished`, on every call site — the mechanism that keeps
  it provably unaffected.
- Metro bundled successfully throughout, including one Android-platform
  bundle (953 modules, no fatal error) captured mid-session.
- Reduced motion: the stagger, tab-adjacent motion, and header press feedback
  all check the existing `useReducedMotion()` hook and skip to end-state
  instantly when it's on, for both screens.

**Status**: implemented, typechecked, tested. Physically reviewed and
approved on Android via Expo Go by the owner. Not committed, not pushed, no
APK built.

---

## 2026-09-03 — Project Command Center: final summary, phase complete


**Purpose of this entry**: one complete, accurate record of the whole
Project Command Center UI effort — mirroring the structure of Home's final
summary entry above — now that both redesign passes have been physically
reviewed and approved. The two entries above are kept for history and are
not rewritten; this entry is the current, authoritative one.

### Original problems (from the initial critique)

1. A failed initial load left the user stuck on bare "Loading {name}…" text
   forever, with **no Back button** and no error ever shown — the error
   state was unreachable in code.
2. Unbounded `project_issues`/`project_media` repository queries, rendered
   without virtualization inside a plain `ScrollView`.
3. "Manage project" — the only path to edit details or reactivate a
   completed project — was a bare, unstyled text link.
4. Ten flat, equal-weight metric cards competed for attention before any
   action was visible; none were tappable despite implying they might be.
5. Three different visual vocabularies for the same underlying idea (a
   record row): `MenuAction` rows, bespoke issue cards, bespoke activity
   rows.
6. Several text styles at 8–9px — the outdoor-legibility gap Home had
   already fixed for itself, never applied here.
7. Touch targets below 48dp in the screen's own code and in the shared
   `DatePickerField.tsx`.
8. No copy explained that the combined timeline's date filter doesn't apply
   to the grouped-by-type view.

After the *first* redesign pass fixed all of the above, physical review
surfaced a second, purely visual problem not caught by the original
critique: **every section header used a different strong color**, and the
opened sections "still needed a more creative, polished, and professional
internal design" rather than reading as a plain stack of generic cards.

### Both redesign passes, summarized

- **Pass 1 (workflow/correctness redesign)**: fixed the unreachable
  loading/error bug with a real `loading`/`error`/`ready` state machine and
  Retry; promoted "Manage Project" to a real 48dp bordered button; regrouped
  the ten existing metrics into three labeled clusters (*Site Activity*,
  *Project Control*, *Planning & Engineering* — all values/calculations
  unchanged); unified issue and activity rows onto one ledger-row language
  (first use of a `refined`-style variant on a screen other than Home);
  added progressive "Show More Photos" reveal instead of an unbounded photo
  grid; added clarifying copy about the timeline/grouped-view relationship;
  raised `DatePickerField.tsx`'s touch targets to 48dp (verified no Home
  regression). Score: 24/40 → 36/40.
- **Pass 2 (visual correction)**: replaced the mixed navy/orange/cream
  headers with one unified Structural Navy treatment across all seven
  sections; introduced the attached numbered ledger tab, the connected
  header/body folder seam (animated Signal Orange, static once settled), and
  content-specific internal layouts (the vertical timeline rail being the
  most distinctive); introduced the `polished` flag so none of this touched
  Home. See the entry immediately above for full detail.

### Final design, section by section

- **Header/hero**: unchanged from pass 1 — navy `AppCard`, green "ACTIVE" /
  gray "COMPLETED" status pill, bordered secondary "Manage Project" button,
  operating period, optional notes.
- **Metrics**: three labeled clusters, ten cards total, none tappable, the
  navy "accent" highlight reserved for Open Issues (> 0) only.
- **Planning and Today / Field Operations / Records and Documents**: unified
  Structural Navy headers with an attached numbered tab; white floating
  action rows; Planning and Today additionally clustered under two small
  in-section labels without changing order or membership.
- **Issues**: same navy/tab header; rows are white cards with a
  priority-colored left accent and a matching tinted priority badge pill;
  resolved issues shift to success green.
- **Photos**: same navy/tab header; a polished thumbnail grid with
  progressive "Show More Photos" (8 at a time); every photo remains
  reachable.
- **All Activity Timeline**: same navy/tab header; a real vertical timeline
  — restrained rail, dot per record, white content cards — combined,
  date-filterable, latest-20/latest-500 unchanged.
- **Activity by Record Type**: same navy/tab header; nested Ledger-Cream
  folders per type, each independent of the timeline's date filter, latest-
  50-per-type unchanged, only types with records shown.
- **Loading/error/Retry/empty states**: a spinner and a reachable error
  state with Retry (fixing the original unreachable-error bug) for the
  initial load; `EmptyState` unchanged for issues/photos/timeline/
  activity-by-type; the completed-project read-only banner unchanged.

### Typography and touch targets

`900` reserved for the project name and tab numerals; `700` for
section/row titles; `600` for labels/badges/status text; `500` for
descriptions/metadata. No text below 11px anywhere in either changed file
(`grep`-confirmed). Every interactive control is ≥48dp — confirmed by
reading every `Pressable`/`TouchableOpacity` call site plus every shared
component (`AppButton`, `MenuAction`, `ExpandableMenuSection`'s `Pressable`,
`DatePickerField`'s own control) that guarantees it structurally.

### Reduced motion

The shared `useReducedMotion()` hook (checking
`AccessibilityInfo.isReduceMotionEnabled()` and its change event) gates the
capped staggered reveal, the tab/seam-adjacent motion, and the new header
press feedback — all skip to their end state instantly when the OS setting
is on, for both `refined`-only (Home) and `refined`+`polished` (Project
Command Center) consumers.

### `refined` and `polished`, and who uses which

See the pass-2 entry above for full detail. Summary: `refined` = Home's
shipped treatment (Home only); `polished` = this screen's additional layer,
always paired with `refined` (Project Command Center only); five other
screens use neither and are unaffected.

### Every application file changed, across both passes

- `src/ui/screens/ProjectCommandCenterScreen.tsx` — full rewrite across both
  passes (same props, handlers, and repository calls throughout).
- `src/ui/components/ExpandableMenu.tsx` — gained `refined` (pass 1, already
  existed from Home) and `polished` (pass 2) as independent opt-in props.
- `src/ui/components/DatePickerField.tsx` — touch-target sizing only (pass
  1), shared with Home's `DashboardOverview`, verified not regressed.
- **Not touched, either pass**: `src/ui/screens/HomeScreen.tsx`,
  `src/ui/components/DashboardOverview.tsx`, any repository, domain, or
  migration file.

### Verification

- `npm run typecheck`: clean, both passes.
- `npm test`: 162/162 passing, both passes — no regressions.
- Metro bundled successfully throughout, including at least one confirmed
  Android-platform bundle during the session.

### Physical acceptance

**Reviewed live in Expo Go on an Android phone and approved by the owner —
twice**: once after the workflow/correctness pass, and again after the
visual correction pass that followed direct feedback on that first review.

### Remaining performance and regression concerns (not resolved this phase)

- The unbounded `project_issues`/`project_media` repository queries are
  still unbounded at the query layer — photos got a client-side
  progressive-reveal mitigation, issues did not (assumed shorter lists in
  practice). A project with very large photo or issue counts still loads all
  of them into memory on every open; only rendering is limited.
- No text search exists for issues or activity records — only the existing
  date-range filter on the combined timeline.
- No shortcuts/bulk actions for power users.
- `DatePickerField.tsx`'s decorative 10px "CHOOSE A DATE" eyebrow label was
  left as-is (not an interactive control, out of the approved scope for that
  shared file).
- **Regression check for future sessions**: if `ExpandableMenu.tsx` is
  touched again, verify all three states — `refined` only (Home),
  `refined`+`polished` (Project Command Center), and neither (the five other
  screens) — since a change that looks like a simplification could silently
  alter any of the three.

### Status

**The Project Command Center UI phase is complete and approved, but not yet
committed, pushed, or shipped.** Both the workflow/correctness redesign and
the visual correction pass have been implemented, verified by
`typecheck`/`test`, and physically reviewed and approved by the owner on an
Android device via Expo Go. Nothing has been committed, pushed, or built
into an APK. No other screen has been started.

---

## 2026-09-03 — Supplier Loads: critique, refinement, and phase complete

**Trigger**: `/impeccable` critique/audit of `QuarryPurchasesScreen.tsx`,
explicitly framed as an ambitious refinement of a design the owner already
liked — not a replacement — against `requirements/SRS.md`'s "Supplier Loads,
Safety, and Report Privacy Update" and "Profile Editing, Past Work, and
Driver PPE Update" sections. Approved as one implementation phase covering
five numbered decisions plus a set of visual corrections, all in a single
pass (unlike Home and Project Command Center, this phase did not need a
separate physical-review correction pass).

**Grounding constraint throughout, honored by explicit decision**: keep the
screen's already-approved identity — Structural Navy supplier headers, warm
cream-tan project headers, soft blue-gray supplier containers, the existing
Supplier → Project → Supplied Materials hierarchy — and do **not** migrate it
to `ExpandableMenuSection`/`MenuAction` the way Home and Project Command
Center were. This is a deliberate precedent-aware choice: the shared
component's `refined`/`polished` split exists specifically so one screen's
change can't silently affect another, and the owner chose to keep this
screen's disclosure fully independent and bespoke rather than pull it into
that shared surface at all.

### Original problems found (critique)

- Radius inconsistency across the screen's cards and controls (17/13/12/16/16).
- Uniform weight-900 throughout, with the **purchase/ticket reference number
  shown as the single most prominent line on each record** — above the
  material name — inverting the identity a supplier-load record should lead
  with.
- Sub-11px text: `groupEyebrow` (8px, in the shared `GroupedSearchableSelect`
  modal), `supplierMeta`/`projectMeta` (10px), `projectEyebrow` (8px),
  `counterNumberLabel` (8px), `linkPillText` (9px).
- Touch targets below 48dp: `back`, `secondary`, `darkButton`,
  `incrementButton`, `cancelIncrement`/`confirmIncrement`, the
  `deliveryChoice` chips, and several controls with **no sizing style at
  all** — "Cancel Supplier Load" (a bare text link for a destructive action),
  "Cancel editing" (no wrapper style whatsoever), "Clear dates," and
  "Remove" (photo).
- Loading state: bare "Loading supplier records…" text with **no spinner and
  no Back button** — the same unreachable-state bug class Home's and Project
  Command Center's original critiques both found, present here too and never
  fixed.
- No text search across purchase history — only the existing date-range
  filter.
- No progressive rendering inside an opened project — a supplier with a long
  history renders every purchase at once.
- Repeated same-day, same-signature trips (the normal multi-truck workflow
  behind the "+1 Trip" counters) had no visual relationship to each other
  once they scrolled into history.
- **Reactivated** records (cancelled, then corrected and restored) had no
  distinct treatment from an ordinary Active record.

### What changed (`src/ui/screens/QuarryPurchasesScreen.tsx`, full rewrite —
same props, same handlers, same repository calls throughout; every business
function — `addPhoto`, `saveSupplier`, `editSupplier`, `confirm`,
`openPurchase`, `saveCorrection`, `reactivate`, `cancelPurchase`,
`beginIncrement`, `confirmIncrement` — verified unchanged in behavior)

1. **Local text search**, combined with the existing date filter. Matches
   supplier name, project name, material/item name, purchase reference
   number, supplier ticket number, driver name, and truck plate. Runs on the
   complete date-filtered dataset before grouping or the progressive-reveal
   limit is applied, per the approved requirement. A dedicated `×` clears the
   search independently of the date filter.
2. **Progressive "Show More" reveal per opened project.** Shows the first 20
   matching purchases; "Show More" reveals 20 more at a time; the visible
   count resets whenever the date filter or search changes (each project's
   count is tracked independently, so opening a different project always
   starts fresh at 20 without an explicit reset needed).
3. **Bespoke disclosure kept, not migrated.** No `ExpandableMenuSection`/
   `MenuAction` used anywhere in this screen. Structural Navy supplier
   headers, cream-tan project headers, and blue-gray supplier containers are
   structurally unchanged; only refined (radius, touch targets, a local
   rotating `+`/`×` glyph, reduced-motion-gated `LayoutAnimation`).
4. **`GroupedSearchableSelect.tsx` typography correction** (shared component
   — used by exactly two screens, confirmed by reading every call site
   before changing it): `groupEyebrow` raised from 8px/900-weight to
   11px/600-weight; `groupTitle` (900→700), the count pill (900→600), and
   `optionTitle`/field `label`/`closeText` (800→700) graded to match; the
   modal's close button and each option row raised to 48dp. **Verified safe
   for both consumers** — `MakeReceiptScreen.tsx:69` and this screen — because
   the changed text lives only inside the component's own full-screen picker
   modal, never in either screen's inline collapsed-field layout.
5. **Reactivated badge**, Status-Warning amber, reading "Reactivated ·
   corrected and restored for review" — not danger-red, since a reactivated
   record isn't a failure state. Derived entirely from already-stored fields
   (`status === 'Active' && purchase.cancelledAt != null`, confirmed by
   reading `SqliteQuarryRepository.reactivatePurchase`, which never clears
   `cancellation_reason`/`cancelled_at`) — no new field, no invented
   reactivation date or user.
6. **Supplied-material record redesigned** (new `SuppliedMaterialRow`,
   screen-local — see `DESIGN.md`'s "Supplied Material Record" and
   "Implemented on Supplier Loads") to the approved 13-point reading order:
   material name leads (700-weight), quantity-and-unit is one inseparable
   900-weight value joined by a non-breaking space (verified at the byte
   level to be `U+00A0`, not a plain space, so it cannot wrap apart even on
   the narrowest supported width), category, delivery date/time, an optional
   trip badge, delivery mode, driver/truck (entirely omitted, not shown
   blank, for Supplier Delivering; plate shown only if present), Per
   Unit/As a Whole, then a structurally separated Financial block (or an
   explicit "Unpriced" tag), then status badges and reference/ticket numbers
   last at 600-weight or below — demoted from the previous design's 900-weight,
   first-line treatment.
7. **Narrow-phone stacking without a JS breakpoint.** Operational and
   Financial detail blocks sit in a `flexWrap`/`flexBasis` pair
   (`flexBasis:150, minWidth:140`) that stacks vertically on narrow phones
   and sits side-by-side on wide ones automatically — the same idiom already
   used elsewhere in the app for metric grids, not a new width-detection
   mechanism.
8. **Repeated-trip visual connection.** A local `computeTripInfo` function
   (screen-local, does not modify `quarryDailyCounters` in
   `src/domain/quarry.ts`) clusters purchases within one opened project by
   day + item + unit + transport signature; clusters of 2+ get a "Trip N of
   M" badge, and a restrained navy connecting rail renders between
   visibly-adjacent same-cluster cards (records are never reordered to force
   adjacency — the rail only appears where the existing order already places
   cluster members next to each other). Never merges records, totals, audit
   histories, or correction/cancellation state; every trip keeps its own
   independent edit/correct/cancel action; different trucks/drivers are
   never grouped together (the transport signature guarantees this).
9. **Loading state**: `ActivityIndicator` plus a working `Header` with a
   Back button, replacing the original bare-text, no-Back-button state.
10. **"Cancel Supplier Load"** promoted from a bare text link to a bordered
    danger button (48dp) — visually separated from the primary correction
    action, per the app's existing Danger Button convention.
11. **Touch targets**: every `TouchableOpacity`/`Pressable` in the file was
    read individually (not grep-verified by `minHeight` alone, per the
    standing lesson from Home's phase-1 correction) — found and fixed three
    controls with no sizing at all ("Cancel editing," `clearWrap`,
    `removePhotoWrap`) in addition to the pre-identified sub-48dp controls.

### Not changed

Pricing calculations, VAT calculations and snapshot behavior, Per Unit/As a
Whole rules, optional-Price/Unpriced behavior, Supplier Delivering
requirements, trip-counter identity and increment behavior, correction/audit
behavior, cancellation/reactivation persistence, past-date entry, project/
Daily Report integration, repository queries, database schema, stored data,
offline behavior, and the Home and Project Command Center screens — all
confirmed unchanged by reading the touched file's calls into
`QuarryRepository`/`domain/quarry.ts` against their existing signatures.

### Verification

- `npm run typecheck`: clean — every repository method call, domain type
  field, and prop passed from `DromexApp.tsx` (`repository`, `onBack`,
  `initialProjectId`, `startEntry`, `initialPurchaseId`) matches the real
  interfaces exactly.
- `npm test`: 162/162 passing (26 test files) — same count as before this
  phase, no regressions.
- Touch targets: manually read every `TouchableOpacity` call site in the
  file (14 total) rather than grepping `minHeight`; three controls with no
  sizing at all were found this way and fixed (see point 11 above).
- `GroupedSearchableSelect.tsx`'s two consumers (`MakeReceiptScreen.tsx`,
  this screen) were identified before the change and re-typechecked/
  re-tested after it — clean both times.
- Non-breaking space between quantity and unit confirmed at the byte level
  (`od -c` on the built file showed `\302\240`, i.e. `U+00A0`), not assumed
  from source text alone.

**Not verified on a physical device by this session** (the owner verifies
next, per the established pattern from every prior phase): live search
typing, Show More after a live filter change, font scale 1.3, and narrow-vs-
wide device widths were all reasoned through in code, not measured, before
this phase's physical review.

### Remaining, not resolved this phase

- `CollapsibleFilterCard.tsx` (shared, used by this screen but out of this
  phase's approved scope) has its own internal `LayoutAnimation
  .configureNext` that is not reduced-motion-gated — pre-existing, unrelated
  to Supplier Loads specifically, not fixed here.
- `repository.listPurchases()` remains an unbounded query — the new search
  and progressive reveal are both client-side rendering behavior only, the
  same documented limitation Project Command Center's photo/issue queries
  already carry.
- `SearchableSelect.tsx`'s own `eyebrow` style is 10px (also sub-11px,
  similar to the `GroupedSearchableSelect` finding) but was not named in the
  approved decisions for this phase and was left untouched to avoid scope
  creep — worth a future, explicitly scoped pass if that component's
  typography is revisited.

**Status**: implemented, typechecked, tested, and **physically reviewed and
approved on Android via Expo Go by the owner.** Not committed, not pushed,
no APK built. No other screen has been started.

---

## 2026-09-04 — Daily Reports: critique, refinement, and phase complete

**Trigger**: `/impeccable` critique/audit of the per-project Daily Report
workflow (`src/ui/screens/ReportsScreen.tsx` — the project's report list,
the ten-section create/edit editor, and PDF generation), approved as one
implementation phase covering identity, disclosure, PPE, loads, duplicate-
date protection, With/No-Prices generation, and a visual-only PDF template
pass — explicitly excluding the whole-business "Report Generation"
Excel-workbook section living in the same file, and excluding Issues,
Schedule/planned work, and Wall-material consumption as deferred functional
integrations (none of the three are part of `DailyProjectReportDraft`,
`ProjectReportSetup`, or `ProjectReportRepository`, confirmed by reading all
three before starting).

### Original problems found (critique)

- **No disclosure at all.** All ten sections (Work Information, People and
  Equipment, Worker Safety/PPE, Materials, Loads Delivered, Fuel Used, Waste
  Dumps, Site Notes, Photos, Working Time) rendered permanently open in one
  long scroll — the single largest gap relative to every other screen
  already redesigned this session.
- **Loading state was a dead end.** `if (!setup) return <bare text>` had no
  spinner, no Back button, and — worse — no error path at all: a failed
  `repository.getSetup()` left the screen showing nothing useful forever,
  with no way to retry.
- **No project/date identity or operating-period visibility.** The date
  boundary was enforced only silently by the date picker's min/max.
- **No duplicate-date protection.** The one-report-per-project-per-date rule
  was enforced only at save time, after a user could have filled in an
  entire report.
- **Weak With/No-Prices choice.** Two identically-styled buttons per saved
  report, no stated default, despite `requirements/SRS.md` naming No Prices
  as the default with With Prices requiring explicit selection.
- **Touch targets under 48dp**, including PPE compliance chips — the same
  bug class found and fixed on every prior screen this session.
- **The Daily Report PDF** (`src/services/projectReportWasteTemplate.ts`'s
  `buildProjectReportHtmlWithWaste` — traced as the actual function used;
  `documentTemplates.ts`'s `buildProjectReportHtml` confirmed dead code for
  this path) used four unrelated decorative colors (green/blue/orange/purple)
  on its summary cards — a standing violation of this file's own already-
  documented One Ledger Rule, not a new defect.

### What changed

**`src/ui/screens/ReportsScreen.tsx`** (same props, same repository calls,
same business functions throughout — `save`, `shareReport`,
`shareReportExcel`, `shareCompletion`, `shareBusinessReport`, `openNewReport`,
`editReport` all verified unchanged in behavior):

1. **A real `loading`/`error`/`ready` state machine for the initial
   `getSetup()` load**, added in a focused follow-up after the first pass
   shipped without one. `refreshSetup` now wraps the call in try/catch,
   guarded by a `mountedRef` so no state update fires after unmount; a
   failure shows a DROMEX-styled danger panel with the caught message and a
   48dp Retry button that calls the same `refreshSetup` function, clearing
   the previous error first. The page's Back button remains available in
   every state. Repository methods, calculations, stored data, and
   navigation destinations are unchanged — only the render/state wrapping
   around one existing call.
2. **A `LedgerSection` disclosure device** (screen-local, third independent
   bespoke implementation this session — see `DESIGN.md`'s "Daily Report
   Ledger Section") replaces the old always-open `Section` wrapper: a
   Structural Navy header, an attached Ledger-Cream numbered tab (`01`–`10`),
   a rotating `+`/`×` glyph (reduced-motion-gated via the shared
   `useReducedMotion()` hook, with a `LayoutAnimation` on toggle), and a
   Signal-Orange-topped Ledger Cream body — closed by default, with no
   auto-reopen.
3. **A project/date identity card** (Structural Navy) stating project name,
   customer, location, active/completed state, the report's work date
   (editor only), and the project's valid operating period in plain text —
   using only `ReportProject`'s existing `startDate`/`endDate` fields.
4. **A "Sections with entries: N of 10" summary**, deliberately not called
   "completion" since nine of the ten sections are optional; each section's
   closed-header badge is neutral (`3 workers`, `2 materials`, `No entries`)
   except Work Information's, which switches to Status-Warning only when
   genuinely empty, since it is the one required section.
5. **A live duplicate-date warning**: computed from the project's
   already-loaded `reports` array (`workDate` match, excluding the report
   currently open by `id`), offering an "Open Existing Report" button. The
   repository's one-report-per-project-per-date rule remains the sole
   enforcement; this is guidance computed from already-fetched data, not a
   new or duplicated validation rule.
6. **Validation error formatting**: `validateDailyReport`'s joined-by-`\n`
   message (unchanged, repository-side, authoritative) is now split and
   rendered as separate lines instead of one dense paragraph. No validation
   rule was changed or reimplemented client-side.
7. **Loads Delivered unified**: one `LoadRow` reading order (material name,
   quantity+unit, source, reference/time, driver/truck only when present,
   financial detail only when present) for both company loads (Signal
   Orange accent) and supplier loads (Structural Navy accent), reusing
   already-fetched `LinkedProjectLoad`/`LinkedQuarryLoad` fields — including
   showing each record's stored price when present, which the previous
   editor fetched but never displayed.
8. **Worker Safety/PPE**: three full-width 48dp status controls (Compliant/
   Status Success, Missing PPE/Status Warning, Not Checked/Muted) replacing
   ~30px chips, plus a concise summary on the section's closed header.
9. **Materials, Fuel, Waste, Site Notes (four separated note cards),
   Photos, and Working Time** restyled to the same record-row language;
   all underlying data, calculations, and the 20-photo cap unchanged.
10. **Report history**: progressive "Show More" (20 at a time, resets on
    project change), restyled cards showing stored counts (workers, drivers,
    materials, photos — all already on `DailyProjectReport`, no new query),
    and one "Generate PDF" flow replacing three competing buttons.
11. **With/No-Prices**: one "Generate PDF" action opens a two-card choice —
    **No Prices** selected by default and marked recommended, **With
    Prices** requiring explicit selection — with the exact explanatory line
    requested, then calls the unchanged `shareReport(report, includePrices)`.
12. **A Final Review block** before Save, summarizing what the report
    currently contains (description present/missing, people/PPE counts,
    material/load counts, fuel/waste counts, notes/photo counts) from data
    already in memory.

**`src/services/projectReportWasteTemplate.ts`** (visual-only; every
data-producing line — `materialRows`, `loadRows`, `quarryRows`, `fuelRows`,
`wasteRows`, and the underlying values `safetyRows` renders — kept
byte-identical; only the surrounding CSS/HTML and one added inline PPE-status
color changed): the four summary cards and every table header now use one
neutral Ledger-Cream/Structural-Navy treatment instead of four decorative
hues; the PPE status column is now colored by real status meaning (Status
Success/Warning/Muted); the Problems/Delays/Incidents panel keeps a genuine
Status-Danger accent; Company/Supplier load tables gained a labeled source
chip and a matching accent-colored table-top rule; the WITH/NO PRICES badge
is now a proper pill. Both function overloads (the current 10-argument form
and the legacy 7-argument form still exercised by `tests/waste.test.ts`)
were preserved exactly.

### A scope-boundary mistake caught and fixed before finishing

A global typography-grading sweep during implementation accidentally touched
several styles genuinely shared with the protected "Report Generation"
section (`label`, `chip`, `statusBadge`, `exportTitle`, `workbookTitle`/
`workbookFormat`/`workbookDescription`, `businessExportHeading`,
`cancelExport`, `clearFilter`, the language-picker styles). Found by
extracting every style name the Report Generation JSX line and its
sub-components (`ExportOption`, `BusinessWorkbookOption`,
`WorkbookLanguagePicker`) reference, and diffing each one individually.
Fixed by reverting all of them to their exact original values and forking
two genuinely dual-use styles (`chip`→ new `drChip` for the editor, `label`→
new `fieldLabel` for the editor) rather than changing the shared originals.
Confirmed via `git diff`: the Report Generation JSX line itself shows zero
difference from the pre-phase version.

### A correctness bug found during self-review and fixed

`LoadRow`'s first draft only rendered a supplier load's driver/truck line
when `source==='company'` — meaning a supplier load actually picked up by
DROMEX's own driver (`deliveryMethod==='company'` on a *supplier* record)
never displayed the driver's name anywhere. Found by manually tracing the
component's render branches against all four delivery-method/source
combinations, not just visually inspecting the happy path. Fixed by having
supplier-sourced rows always render their precomputed `deliveryLabel`
(either "Supplier Delivering" or the picking-up driver's name) directly.

### Not changed

Domain types, database schema, every repository method and its query shape,
the one-report-per-project-per-date rule, date-boundary enforcement,
past-date entry, autosave drafts, net-working-time calculations, load/fuel/
waste/PPE/material data and calculations, Price/VAT logic, offline behavior,
Excel generation, the business Report Generation/workbook section (JSX and
every style it depends on, confirmed byte-identical), package identity,
version number, and Home/Project Command Center/Supplier Loads.

### Deferred functional integrations (documented, not built)

Issues, Schedule/planned work, and Wall-material consumption are not part of
`DailyProjectReportDraft`/`ProjectReportSetup`/`ProjectReportRepository` and
nothing was added to wire them in — confirmed by reading all three before
starting, not assumed. Waste Dump Outsider was not touched or started.

### Verification

- `npm run typecheck`: clean, every pass including the final loading/error
  fix.
- `npm test`: 162/162 passing (26 test files) throughout — same count before
  and after every pass, no regressions, including `tests/waste.test.ts`'s
  three assertions against the PDF template's legacy call path.
- **With/No-Prices verified against real generated output**, not just code
  reading: a temporary test file (created, run, then deleted) rendered both
  variants through the actual `buildProjectReportHtmlWithWaste` function
  with realistic company-load, supplier-load, fuel, and PPE data. The
  No-Prices sample: zero `$` figures, zero Total/Price/Cost column headers.
  The With-Prices sample: correct dollar figures throughout. "Contractor"
  renders correctly in both.
- Touch targets: every `TouchableOpacity` in the file read individually
  (22 call sites), not grep-verified by `minHeight` alone.
- All ten sections confirmed closed by default: `openSections` initializes
  to an empty `Set`.
- No RN component-rendering test harness exists anywhere in this codebase
  (no `@testing-library/react-native` or `react-test-renderer` in
  `package.json`) — the existing test structure does not support testing a
  component's internal state machine, so none was forced in for the
  loading/error fix; disclosed rather than skipped silently.

**Not verified on a physical device by this session before the owner's own
pass**: narrow-width wrapping, long-name wrapping, Android font scale 1.3,
and reduced motion's actual on-screen effect were reasoned through in code
(capped/gated animation calls, no fixed heights around dynamic text,
`flexWrap`/`flexBasis` load-detail blocks) but not measured.

### Remaining, not resolved this phase

- The pre-existing sub-48dp language-picker and business-filter controls
  inside the untouched Report Generation section were deliberately left
  as-is, per the explicit instruction not to change that section's
  appearance.
- `repository.getSetup()`'s failure path has no automated test coverage
  (see "No RN component-rendering test harness" above) — verified by code
  reading and manual reasoning only.
- The PDF template's visual polish did not touch its data completeness or
  field set — any future gap in what the PDF reports (as opposed to how it
  looks) is unrelated to this phase.

**Status**: implemented, typechecked, tested, and **physically reviewed and
approved on Android via Expo Go by the owner.** Not committed, not pushed,
no APK built. No other screen has been started.
