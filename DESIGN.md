---
name: DROMEX
description: An offline-first plant/construction ledger styled as a durable field ticket book — Signal Orange for action, Structural Navy for authority, Ledger Cream for paper.
colors:
  signal-orange: "#C84B31"
  signal-orange-deep: "#8E2E1B"
  structural-navy: "#173F67"
  structural-navy-deep: "#082D61"
  ledger-cream: "#FFF8ED"
  ledger-cream-soft: "#F5F2EC"
  ink: "#17212B"
  muted: "#65717D"
  background: "#F5F2EC"
  surface: "#FFFFFF"
  line: "#DDD7CC"
  status-success: "#287A55"
  status-warning: "#9A6512"
  status-danger: "#B3261E"
  calc-result: "#087F8C"
  calc-result-deep: "#04545D"
  calc-result-soft: "#DDF7F5"
  hero-text-warm: "#FFFCF6"
typography:
  eyebrow:
    fontFamily: "System"
    fontSize: "11px"
    fontWeight: 900
    letterSpacing: "1.4px"
  pageTitle:
    fontFamily: "System"
    fontSize: "28px"
    fontWeight: 900
  sectionTitle:
    fontFamily: "System"
    fontSize: "19px"
    fontWeight: 900
  cardTitle:
    fontFamily: "System"
    fontSize: "16px"
    fontWeight: 900
  body:
    fontFamily: "System"
    fontSize: "14px"
    lineHeight: "20px"
  helper:
    fontFamily: "System"
    fontSize: "13px"
    lineHeight: "19px"
rounded:
  sm: "10px"
  md: "13px"
  lg: "16px"
  xl: "19px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "13px 16px"
    height: "48px"
  button-navy:
    backgroundColor: "{colors.structural-navy}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "13px 16px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.structural-navy}"
    rounded: "{rounded.md}"
    padding: "13px 16px"
    height: "48px"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.status-danger}"
    rounded: "{rounded.md}"
    padding: "13px 16px"
    height: "48px"
  card-standard:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "17px"
  card-context-navy:
    backgroundColor: "{colors.structural-navy}"
    textColor: "{colors.ledger-cream}"
    rounded: "{rounded.lg}"
    padding: "17px"
  input-field:
    backgroundColor: "#FCFBF8"
    textColor: "{colors.ink}"
    rounded: "11px"
    height: "46px"
    padding: "11px 13px"
---

# Design System: DROMEX

## Overview

**Creative North Star: "The Foreman's Field Ledger"**

DROMEX is documented, not redesigned, here: every rule below describes the interface as it actually ships in `src/ui/theme.ts`, `src/ui/components/AppPrimitives.tsx`, and the screen implementations, cross-checked against `docs/design-system.md` ("DROMEX Interface Standard"), which remains the authoritative source of record. Where the confirmed target direction differs from what ships today, that gap is named explicitly in **Approved Refinement Targets** and again in the closing gap list — nothing below should be read as already-implemented unless it cites real code.

DROMEX presents as a durable, organized field ledger for running a construction/plant operation: Structural Navy gives it authority and hierarchy, Ledger Cream stands in for paper record stock, and Signal Orange marks the one thing that matters most on a given screen — the action to take or the record that needs attention. The voice is sturdy, direct, and field-professional rather than decorative: it favors bold, legible values and direct-verb actions ("Save Fuel Delivery", "Cancel Movement") over soft, ornamental interface language.

Domain separation (projects, loads, suppliers, fuel, equipment, safety, reports) is carried by grouping, labels, numbering, and icons inside expandable sections — not by a unique color per domain. Home and Project Command Center both mark their sections with a numbered chip/tab rather than a per-section hue. Color is otherwise reserved for role, not decoration: orange for action, navy for structure, green/amber/red strictly for semantic status, and one further reserved hue (teal, "calc-result") strictly for calculated/derived values such as pavement area or rebar totals.

**Key Characteristics:**
- One consistent orange/navy/cream hierarchy reused across every screen, PDF, and spreadsheet export.
- Color communicates role, not decoration — status colors mean status, the result teal means "this number was calculated," nothing else borrows those hues.
- Bold, high-weight type used pervasively as the base/default treatment (see Typography and the gap list) rather than varied for hierarchy — **except Home's and Project Command Center's navigation sections, which now implement the graded hierarchy below; see "Implemented on Home" and "Implemented on Project Command Center."**
- Rounded, card-based composition throughout; no bare unstyled lists or borderless flat sections.
- Restrained, functional shadows: elevation appears only on floating/interactive elements (the create button, sticky action bars, collapsible filter headers), never as decoration on static content.

## Colors

The palette is small and role-driven: three brand hues (orange, navy, cream) plus a fixed set of semantic and functional colors. Nothing outside this set should be introduced without a stated role.

### Primary
- **Signal Orange** (`#C84B31`, deep variant `#8E2E1B`): the primary action and brand-emphasis color. Solid-orange buttons, the Home hero action, the collapsed-filter header, numbered index marks, active-nav indicators, and "this needs attention" badges all use it. `docs/design-system.md` calls this role out explicitly: color must communicate role consistently and is never decorative. On Home's and Project Command Center's refined navigation sections specifically, row numbers and chevrons shift from orange to Structural Navy, making orange rarer and more deliberate there (Make Receipt, the "connected" Suppliers row, the section markers, the animated seam on Project Command Center) — see "Implemented on Home" and "Implemented on Project Command Center." Elsewhere in the app, orange keeps the broader usage described above.

### Secondary
- **Structural Navy** (`#173F67`, deep variant `#082D61`): navigation groups, strong context cards (e.g. the selected-project banner, tank-state cards), section group headers, and stable secondary/save-confirm actions when orange is already the page's primary emphasis.

### Neutral
- **Ledger Cream** (`#FFF8ED` background tone, `#F5F2EC` app background): the page background and the body of expanded filter/disclosure sections — the "paper" surface the record sits on.
- **Surface White** (`#FFFFFF`): standard cards, forms, and record rows.
- **Ink** (`#17212B`): primary text.
- **Muted** (`#65717D`): secondary/helper text and metadata.
- **Line** (`#DDD7CC`): borders, dividers, and input strokes.

### Semantic status (functional only — never decorative or brand)
- **Success** (`#287A55`) with a tinted panel background (`#E5F3EC`): confirmations and positive states. As of 2026-09-03, also marks Daily Reports' PPE **Compliant** status control.
- **Warning** (`#9A6512`) with a tinted panel background (`#FFF3D8`): caution states, e.g. unpriced records or pending attention. As of 2026-09-03, also used for Supplier Loads' **Reactivated** badge — "this record was corrected and restored for review," a caution-toned status, not a failure — reusing the existing warning color rather than introducing a fourth semantic hue. Daily Reports reuses it identically for the PPE **Missing PPE** status control and for a genuinely-required-but-empty Work Information badge.
- **Danger** (`#B3261E`) with a tinted panel background (`#FCE8E6`): cancellation, deactivation, and destructive-adjacent actions — always visually separated from primary actions per `docs/design-system.md`. Daily Reports' initial-load error panel also uses this color, matching the app-wide error convention.

### On-orange text (Home Make Receipt only)
- **Hero Text Warm** (`#FFFCF6`): the only text/symbol color used on Home's Make Receipt card (title, eyebrow, hint) as of 2026-09-03, replacing an earlier navy-on-orange treatment that read poorly. Computed contrast against Signal Orange is ≈4.56:1, clearing WCAG AA's 4.5:1 threshold for normal text at every size used in that card. **Scoped to this one card only** — every other orange surface in the app (buttons, badges, the collapsed-filter header) keeps its existing white/cream text per the Components and Shapes sections; this is not a general on-orange text rule.

### Calculated-value accent
- **Calc Result Teal** (`#087F8C`, deep `#04545D`, soft tint `#DDF7F5`): reserved exclusively for numbers the app derived rather than a user entered — pavement area totals, rebar/consumption calculations, selected-item highlighting tied to a calculated result. It is not a general-purpose fourth brand color and must not be applied outside calculated-output contexts. As of 2026-09-05, also correctly applied to Customers' Billed/Paid/Remaining balance tiles (`CustomersScreen.tsx`) and Item Catalog's unit-symbol chip on each item row (`CatalogScreen.tsx`) — both are genuinely calculated/reference values, not user-entered ones, and neither existed before this session's Business Directory pass (Customers previously showed these in plain Ink tiles).

### Directory-screen neutral tints
A small number of additional near-white/near-cream neutrals appear once each on Projects' completed-project card fill (`#F7F4EE`) and People & Equipment's active-record avatar fill (`#E8F0F6`), introduced during the 2026-09-04/05 Business Directory pass below. Both sit in the same low-saturation neutral family as the already-documented `#FCFBF8`/`#FFFEFC`/`#F5F2EC` tints elsewhere in the app; they are not a new brand hue and carry no independent role beyond "quiet neutral surface," so they are noted here rather than promoted to a named color.

### Named Rules
**The One Ledger Rule.** Every screen, PDF, and Excel export shares the same orange/navy/cream hierarchy (`docs/design-system.md`, "Documents and reports"). A new surface introducing its own palette is a defect, not a variant.

**The Third-Party Logo Exception** (approved 2026-09, DEC-389). A logo belonging to an outside organisation — today only the optional Ministry logo on Daily Report PDFs — renders in its own intrinsic colours, because reproducing an external body's mark in DROMEX's palette would misrepresent it. The exception is deliberately narrow: it covers the logo image alone. Surrounding type, rules, and fills stay Structural Navy on Ledger Cream, no colour is sampled from the logo into the interface, and no new named colour enters the palette. Any other surface importing outside colour remains a defect under the One Ledger Rule.

**The Reserved-Hue Rule.** Green, amber, red, and calc-result teal each mean exactly one thing (success, warning, danger, calculated value). None of the four may be reused for brand emphasis or decoration, and no other hue may be used for those four meanings.

## Typography

**Face:** System font stack (no custom typeface is loaded; `fontFamily` is left to the OS default across `theme.ts` and every screen).

**Character:** Bold and declarative as the base/default treatment — the shipped scale pushes weight to the top of the range across nearly every text role. **Home's and Project Command Center's navigation sections are the exceptions**, using the graded hierarchy from "Implemented on Home" and "Implemented on Project Command Center" below rather than uniform 900.

### Hierarchy (as shipped, `src/ui/theme.ts`)
- **Eyebrow** (900, 11px, 1.4px letter-spacing): short uppercase-style labels above a title (e.g. `PageHeader`'s eyebrow, section overlines).
- **Page Title** (900, 28px): the one title per secondary screen, set in Ink, following the standard header (white Back button → orange eyebrow → navy/ink title) defined in `docs/design-system.md`.
- **Section Title** (900, 19px): group/section headers within a screen.
- **Card Title** (900, 16px): the title inside an `AppCard`.
- **Body** (default weight, 14px, 20px line-height): ordinary record and paragraph text.
- **Helper** (default weight, 13px, 19px line-height): supporting/explanatory sentences under a header or field.

Beyond these named roles, individual screens hand-set additional bold (800–900) weights for button labels, field labels, badges, metric values, and list-row identity text — the pervasive-bold pattern is not confined to the four named roles above; see the gap list.

### Named Rules
**The Direct-Verb Rule.** Button and action labels are direct verbs describing the exact effect (`Save Fuel Delivery`, `Open Report`, `Cancel Movement`), never vague labels like "Submit" or "Go" (`docs/design-system.md`, "Buttons").

## Layout

- **Page padding:** 20px horizontal, 16px vertical gaps between blocks, at least 42px of bottom content padding so the last item clears system chrome and any sticky action bar (`docs/design-system.md`, "Page structure"; `AppPrimitives.tsx`'s `AppPage`).
- **Secondary-screen header:** one fixed pattern — white Back button, orange uppercase eyebrow, 28px Ink/Navy title, optional one-sentence helper only when it explains a workflow or business rule.
- **Cards as the unit of grouping:** related fields or records live in one rounded card; unrelated controls are never combined into one card.
- **Metrics up top:** the most important current totals appear near the top as two-column metric cards that wrap on narrow screens (`MetricCard`).
- **Action placement:** the main action follows its form; destructive actions are visually separated from primary actions, never adjacent.
- **Disclosure over density:** large record sets are hidden behind an explicit open action (navy group headers, collapsible orange filter headers) rather than shown all at once; sections are closed by default.
- **Bottom navigation shell:** a fixed navy context bar (49px, 3px orange bottom rule) plus a white bottom tab bar (72px) with an elevated center "create" circle that floats above the bar (`DromexApp.tsx`).

## Elevation & Depth

DROMEX is mostly flat, with shadow reserved for elements that float above the page or demand attention: the raised center "create" action, the primary hero action card on Home, the sticky bottom action bar on long forms, and collapsible/filter header cards. Depth is otherwise conveyed through solid color blocks (navy/orange fills) and left-border accent stripes on record rows, not through shadow layering.

### Shadow Vocabulary
- **Floating action** (`shadowColor: #8E2E1B, shadowOpacity: 0.3, shadowRadius: 7, shadowOffset: {0,4}, elevation: 7`): the center "create" circle in the bottom nav — the single most prominent floating element in the app.
- **Primary hero** (`shadowColor: #8E2E1B, shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: {0,5}, elevation: 5`): the Home screen's primary action card.
- **Collapsible header** (`shadowColor: #8E2E1B, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: {0,3}, elevation: 2`): the orange collapsed-filter header (`CollapsibleFilterCard`) and its inline equivalents.
- **Sticky action bar** (`shadowColor: #17212B, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: {0,-3}, elevation: 8`): the bottom-anchored save bar on long forms (e.g. `MakeReceiptScreen`).
- **Resting row** (`shadowColor: #17212B, shadowOpacity: 0.04–0.05, shadowRadius: 4–5, shadowOffset: {0,2}, elevation: 1`): ordinary interactive rows (quick-action rows, counter cards) — a near-imperceptible lift that distinguishes them from flat static content without competing with the floating elements above.

### Named Rules
**The Tinted-Shadow Rule.** Shadows are colored from the element they fall from (brand-orange-deep `#8E2E1B` under orange/warm elements, ink `#17212B` under neutral surfaces), never a generic flat black — depth stays part of the same warm/structural palette rather than reading as a separate gray layer.

## Shapes

- **Radius scale:** 10px (small controls, back buttons), 13px (buttons, metric cards, standard corners), 15–19px (cards, collapsible headers, hero blocks), 999px (pill/fully-rounded elements).
- **Left-border accent stripes:** record rows commonly carry a 4–5px left border in navy, orange, or the calc-result teal to indicate category or calculated-selection state, rather than a full-block color change (e.g. `MenuAction`, wall/pavement record rows). Home's and Project Command Center's refined `MenuAction`/record rows use a narrower 3px version of the same device, sized down because the rows sit inside one bounded card rather than floating individually — see "Implemented on Home" and "Implemented on Project Command Center." On Project Command Center's Issues rows specifically, this accent is priority-colored (Urgent/High/Normal/Low reuse the existing danger/warning/navy/muted colors) rather than a fixed navy, and resolved issues shift to success green — status-driven, not domain-driven, per the Reserved-Hue Rule. Supplier Loads' supplied-material records (see "Implemented on Supplier Loads") use the same status-driven device at 3px: Signal Orange for Active, Status Danger for Cancelled, Status Warning for Reactivated.
- **Bottom accent rules:** a 3px orange or navy rule marks a seam — under the navy context bar, across the bottom of an expanding menu header as it opens, and along the top of a collapsible filter's opened body. This is a repeated, deliberate structural device, not a one-off.
- **Circular badges:** counts, totals, and the floating create action use full circles (`borderRadius: width/2`) rather than rounded squares.

### Named Rules
**The Seam Rule.** Wherever a collapsed/solid-color header opens into a lighter body (a filter header into its cream body, a menu section into its record list), a colored rule marks the seam — 3px navy under an orange header, or an animated 3px orange bar that grows across an opening menu header. The seam is always present; it is never a plain, unmarked edge.

## Components

### Buttons (`AppButton`)
- **Shape:** 13px radius, 48px minimum height (`docs/design-system.md`'s stated minimum), disabled state drops to 40% opacity rather than changing color.
- **Primary:** solid Signal Orange, white label — one principal action per page section.
- **Navy:** solid Structural Navy, white label — save/confirm/open actions when orange already carries the page's primary emphasis.
- **Secondary:** white fill, thin navy border, navy label — preview, export, retry, non-destructive alternatives.
- **Danger:** white fill, thin red border, red label — cancellation/deactivation only, always placed away from primary actions.
- A button may carry one short helper line beneath the label; never a paragraph.

### Cards (`AppCard`)
- **Standard:** white, 16px radius, 17px padding, 12px internal gap.
- **Cream:** warm-cream fill with a thin `#E8DED0` border — used for secondary/expanded groupings.
- **Navy / Orange (context cards):** solid fill with cream/white text — used for the selected project, tank state, or other strong page context that should visually outrank surrounding white cards.

### Fields (`AppField`, `SearchableSelect`)
- **Text input:** 46px minimum height, white/warm-white (`#FCFBF8`) fill, thin neutral (`line`) border, 11px radius, label set above in bold Ink.
- **Searchable dropdown (`SearchableSelect`):** the collapsed control looks like a text field (same border/radius/fill) with a bold navy chevron; tapping opens a full-screen page-sheet modal with its own eyebrow ("CHOOSE FROM SAVED RECORDS"), a search field, and a scrollable option list where the selected option gets an orange-tinted (`#FBE9E4`) selected state and a navy check mark. Used for growing, searchable master-data choices per `docs/design-system.md`; small fixed choices use chips/tabs instead.
- **Required fields** end their label in `*`; validation surfaces as one error panel while the invalid record stays editable — never inline-blocking.

### Metric Cards (`MetricCard`)
- Flex-wrapping two-column layout; default white fill with a large (26px, 900-weight) Ink value and a small bold Muted label.
- **Accent** variant switches to solid navy fill with cream text for a highlighted total.
- **Result** variant switches to the calc-result teal fill with a 2px deep-teal border, reserved for calculated totals (pavement area, etc.).

### Feedback (`Feedback`)
- One-line tinted panel per state: green/`#E5F3EC` for success, amber/`#FFF3D8` for warning, red/`#FCE8E6` for error — 12px padding, `sm` radius, bold text in the matching status color.

### Empty States (`EmptyState`)
- A dashed-border (`line` color), `lg`-radius card explaining what to do next — never a bare "No records" line with no path forward.

### Collapsible Filters (`CollapsibleFilterCard`, and its inline equivalents)
- **Collapsed:** solid Signal Orange header with a bold cream title, a smaller warm-tinted (`#F9E8D8`) summary line, and a large `+`/`×` disclosure mark that swaps on open.
- **Expanded:** the body drops onto a Ledger Cream surface behind a 3px Structural Navy top rule (the Seam Rule), holding whatever filter fields the screen needs.

### Expandable Menu (`ExpandableMenuSection`, `MenuAction` — shared by seven screens)
- **Base/default treatment (five screens: `DraftCenterScreen`, `PavementCalculatorScreen`, `WallConstructionScreen`, `WorkspaceHubScreen`, `PavementAdvancedSections`):** a 67px-minimum, 15px-radius header block in navy, orange, or cream, with a title, a one-line hint, and a `+`/`×` mark that swaps instantly on open; opening animates a 3px orange accent bar growing across the header's bottom edge over ~230ms, and reveals child actions with a simultaneous fade/slide-up. Action rows are 80px-minimum white cards with a 4px left border in the section's accent color, a small numbered index, a bold Ink title, a Muted description, and a trailing orange chevron (`›`). Sections are closed by default, per `docs/design-system.md`.
- **Home's `refined` variant** (opt-in `refined` prop, default `false`, used only by `HomeScreen.tsx` — see "Implemented on Home"): a solid Ledger-Cream rounded-square index chip (`01`–`04`) instead of the translucent circle; the `+` rotates 45° into `×` (one glyph, animated) instead of swapping text; the expanded body is one bounded Ledger-Cream card containing flat, ruled rows (thin bottom divider, no per-row shadow, 3px left border) instead of individually-shadowed floating cards; section/row title weight `700`, hint/body weight `500`/default, row numbers and chevrons in Structural Navy instead of Signal Orange.
- **Project Command Center's `refined`+`polished` variant** (opt-in `polished` prop, default `false`, always paired with `refined`, used only by `ProjectCommandCenterScreen.tsx` — see "Implemented on Project Command Center"): builds on Home's `refined` treatment with an attached numbered ledger tab (protruding above the header rather than sitting inline), a connected header/body seam on open (flattened corners, a static 4px Signal Orange rule at the join), individually-shadowed white rows layered on the Ledger Cream body (reversing `refined`'s flat ruled-row look for this screen only), a capped staggered row reveal, and subtle header press feedback. Row number/badge weight is `600` here (`refined`-only screens keep `700`).

### Supplied Material Record (`QuarryPurchasesScreen.tsx`, screen-local)
As of 2026-09-03: a bespoke record row (not a shared component) presenting one Supplier Load in a fixed 13-point reading order — material name first (700-weight, most prominent by position and size), quantity-and-unit as one inseparable, largest-on-the-card value (900-weight, joined by a non-breaking space so they can never wrap apart), category, delivery date/time, an optional "Trip N of M" badge, delivery mode, driver/truck (omitted entirely, not shown blank, when the supplier delivered), Per Unit/As a Whole, then a structurally separated Financial block (price/VAT/total, or an explicit "Unpriced" tag), then status badges (Cancelled/Reactivated) and reference/ticket numbers last, at 600-weight or below — deliberately demoting what the previous design showed first. Operational and Financial information sit in two `flexWrap`/`flexBasis` blocks that stack vertically on narrow phones and sit side-by-side on wide ones without any JS width breakpoint. See "Implemented on Supplier Loads" below.

### Daily Report Ledger Section (`ReportsScreen.tsx`, screen-local)
As of 2026-09-03: a third, independently-built bespoke disclosure device (not `ExpandableMenuSection`, not shared with Supplier Loads' own bespoke pattern) for the Daily Report editor's fixed sections. **Section count: twelve (`01` Work Information through `12` Ministry Header).** This file previously recorded ten, predating both the Consultant Sign-off (`11`) and Ministry Header (`12`) sections; the count is corrected here. One Structural Navy header per section with a small attached Ledger-Cream numbered tab (`01`–`12`) protruding above its top edge — the same visual idea as Project Command Center's attached tab, rebuilt locally rather than reused as code — a rotating `+`/`×` glyph, and a Signal-Orange-topped Ledger Cream body that appears only on open. Every section carries a neutral count/state badge on its closed header (e.g. `3 workers`, `2 materials`, `No entries`); the one genuinely required section (Work Information) is the only one whose empty badge switches to the Status-Warning tone — every other empty section stays neutral, since its content is optional. Reduced-motion-gated via the same `useReducedMotion()` hook used elsewhere; sections are closed by default.

### Optional Document Headers (Daily Report PDF, editor sections `11` and `12`)

Implemented 2026-09 (DEC-389, DEC-390, DEC-391). The header-row layout, the agency line beneath the report title, and the split consultant placement described below all ship as written; the earlier stacked-band form of the Ministry header was replaced by the header-row treatment.

Two independent optional headers, both off by default, both driven by a per-report option rather than by global configuration alone — so existing reports and non-ministry, non-consultant projects stay unbranded.

**Ministry identity** — a globally configured name and logo, shown only when that report's `Show Ministry Header` option is on. When on, it becomes the **right-hand identity of the page-one header row**, with the company name and logo on the left, and the report title moves to a strip directly beneath that row. When off, the page-one header keeps its existing unbranded layout with the title in its current right-hand position: there is deliberately no empty ministry slot, so an unbranded report is byte-identical to what it produces today. Page one only; it never repeats on `.page-two`. With one of the two values configured the configured part renders alone; with neither, the PDF omits it entirely and the editor shows a Status-Warning panel naming what is missing. The ministry name is Structural Navy at weight 700; the logo sits at a small fixed maximum height in its own colours under the Third-Party Logo Exception above.

**Consultant identity** — split across two placements by DEC-390, because the two halves answer different questions. The **consulting agency name** alone appears beneath the report title on page one, as a plain Structural Navy identity line — the same palette as the ministry header but deliberately a different form: no logo, no header-row slot, no band. It answers "under whose supervision was this produced". The consultant's **personal name and signature** appear together at the end of page two, immediately before Photo Evidence, answering "who acknowledged this record" at the end of the content being acknowledged. The agency line renders only when the sign-off is on *and* an agency name is configured; the personal name and signature render whenever the sign-off is on, using the existing Status-Warning treatment for the incomplete state.

The agency name never affects completeness — `consultantSignoffState` depends only on the personal name and signature (DEC-388), so adding or removing an agency can never turn an incomplete sign-off into a complete one.

Both headers are bound by the no-endorsement rule: labels are `Consultant name` and `Signature` only, the agency name carries no verb, never `Approved by` or `Certified by`, and an incomplete sign-off renders no signature image — DROMEX has no report approval workflow (DEC-032) and its documents must never imply one.

### Directory Hero Header (`ProjectsScreen.tsx`, `CustomersScreen.tsx`, `PeopleEquipmentScreen.tsx`, `CatalogScreen.tsx`, `FinancialsScreen.tsx` — screen-local, repeated pattern)
As of 2026-09-04/05: a solid Structural Navy banner replacing the earlier plain-white "Back button + eyebrow + title" header on each of these five screens. Fixed structure: a translucent-white (`rgba(255,255,255,0.14)`) 48dp Back pill, a `#F2A184` eyebrow, a `#FFF8ED` page title, one tightened purpose sentence in `#D5E4EF`, and — below a `rgba(255,255,255,0.22)` divider — a live summary row of 2-3 count metrics (e.g. Active/Inactive/Total, or Categories/Items/Units) in the same `#FFF8ED` value / `#D5E4EF` label pairing used on the app's other navy context cards. This is `card-context-navy` from the frontmatter, applied identically five times rather than varied per screen — the repetition is deliberate, not an oversight.

### Search Bar (same five screens, screen-local, repeated pattern)
A pill-shaped `colors.surface` bar (52dp, 14px radius) with a Signal Orange "⌕" glyph, a borderless `TextInput`, and — once text is entered — a small circular `#EEEAE2` clear ("×") button. Carries the app's "resting row" shadow tint. Replaces plain labeled `TextInput` fields used for the same purpose before this pass. Not a shared component yet; implemented identically five times as `styles.searchBar`/`searchGlyph`/`searchInput`/`searchClear` in each screen file.

### Status Pill (Projects, Customers, People & Equipment)
A small rounded pill with a 6px status dot plus a short label, replacing plain colored text or a caps-lock badge. Active: `#E5F3EC` fill, Status Success dot and text. Inactive/Completed: transparent fill with a `line`-colored (or, on a navy card, `rgba(255,255,255,0.4)`) border, Muted dot and text — the inactive state is deliberately outlined rather than tinted, so active/inactive read as distinct even in grayscale or bright sunlight, not by hue alone.

### Collapsible Status Band (Projects' Completed Projects, Customers' Inactive Customers, People & Equipment's Inactive records)
A `colors.creamSoft` bordered band (56dp, 14px radius) replacing a plain "+/×" text row for a secondary, closed-by-default record group. Always states its current disclosure state in words ("Tap to view" / "Tap to hide") beside the count, not just the `+`/`×` glyph, and carries the same bold count badge (`colors.surface` fill, `line` border) as the primary section heading beside it.

### Monogram Avatar (Customers, People & Equipment)
A 40-44dp circle showing a record's initials (first letters of its first two words, or the first two characters of a single-word name), replacing a plain leading text line. Structural Navy tint (`rgba(255,255,255,0.16)` on a navy hero, `#E8F0F6` on a white row) for an ordinary record; Signal Orange fill reserved for exactly one distinguished record — Customers' own-company profile, marked with a "★" glyph instead of initials. Not used on Trucks/Machines (plate/identifier text serves the same at-a-glance-identity role there) or on Item Catalog (unit/price/code chips serve it instead — see Colors' Calculated-value accent note above).

### Quiet Inline Action (Projects, Customers, People & Equipment, Item Catalog)
A lower-emphasis alternative to a bordered/filled button for a secondary, reversible-adjacent action (Mark Completed/Reactivate, Deactivate/Reactivate, Edit information, Cancel editing): plain `colors.brandDark` bold text, no border or fill, inside a 44-48dp touch target created by padding rather than visible size. Used specifically to visually step back an action from the screen's one primary button, per the existing "Action placement" layout rule, without shrinking its actual tap target below the 48dp floor.

## Do's and Don'ts

### Do:
- **Do** reuse `AppPage`, `PageHeader`, `AppCard`, `AppButton`, `AppField`, `MetricCard`, `Feedback`, and `EmptyState` from `src/ui/components/AppPrimitives.tsx` for any new screen (`docs/design-system.md`, "Implementation rule").
- **Do** keep the calc-result teal exclusive to calculated/derived values; keep semantic (green/amber/red) colors exclusive to status.
- **Do** mark the seam between a solid collapsed header and its lighter expanded body with a colored rule (the Seam Rule).
- **Do** keep destructive (danger) actions visually separated from the primary action on every screen.
- **Do** close large record sections by default and require an explicit tap to open them.

### Don't:
- **Don't** introduce a new brand hue outside Signal Orange / Structural Navy / Ledger Cream without a stated, non-decorative role.
- **Don't** give a domain (fuel, safety, waste, etc.) its own strong brand color today — that isn't how the current system separates domains (see Approved Refinement Targets).
- **Don't** place unrelated controls inside one card, or a paragraph inside a button.
- **Don't** use a flat, uncolored black shadow — shadows are tinted from the element they fall from.
- **Don't** treat the pervasive weight-900 usage across every text role as an intentional hierarchy device outside Home's and Project Command Center's refined navigation sections — everywhere else it is still the current shipped base state, not a confirmed target for that surface (see Approved Refinement Targets, "Implemented on Home," and "Implemented on Project Command Center").
- **Don't** use `hero-text-warm` anywhere outside Home's Make Receipt card, and don't pass the `polished` prop without also passing `refined` — see "Implemented on Project Command Center."

## Approved Refinement Targets

These were confirmed future directions, agreed with the product owner during the original `document` pass, describing where the system should move beyond its base/default treatment. **As of 2026-09-03, both are implemented on the Home screen, and in a richer second layer on Project Command Center; the typography weight hierarchy is additionally implemented, as its full 4-step target scale, on Supplier Loads' supplied-material records and on Daily Reports' section/record content; domain visual identity is additionally implemented, as a third independent bespoke instance, on Daily Reports' ten numbered ledger sections** — see "Implemented on Home," "Implemented on Project Command Center," "Implemented on Supplier Loads," and "Implemented on Daily Reports" immediately below. Domain visual identity remains untouched on Supplier Loads by explicit decision (its existing two-tier Supplier/Project color hierarchy was preserved, not replaced with a numbered-marker device) and remains a target for every other screen, which still uses the base/default treatment described earlier in this file.

### Domain visual identity
Domains (projects, loads, suppliers, fuel, equipment, safety, reports) may receive **restrained** visual identifiers — icons, header markers, numbering, dividers, or subtle accent treatments — to strengthen wayfinding beyond grouping/labels alone. Explicitly rejected: giving every domain its own strong, saturated color. That would collide with the Reserved-Hue Rule (status colors and the calc-result teal must stay uniquely meaningful) and would work against the One Ledger Rule's single shared hierarchy, and risks a busier, more tiring interface than the current one.

### Typography weight hierarchy
The target type scale replaces today's pervasive weight-900 usage with a graded hierarchy:

| Weight | Target usage |
|---|---|
| 900 | Top-level screen titles, critical totals, and exceptional emphasis only |
| 700 | Section titles, card titles, primary button labels |
| 600 | Field labels, badges, secondary actions |
| 400–500 | Descriptions, helper text, ordinary values |

Intent: sturdy and clear without every element competing for attention — bold weight should mark what's actually most important on a screen, not saturate the whole screen. `src/ui/theme.ts`'s global type-scale tokens are unchanged (still 900 across the four named roles) — Home's implementation lives as local/component-level overrides instead (see below), not a global token change, so it could be applied deliberately rather than silently inherited everywhere at once.

## Implemented on Home (2026-09-03)

Both Approved Refinement Targets above are implemented on the Home screen only, via `src/ui/screens/HomeScreen.tsx` and an opt-in `refined?: boolean` prop (default `false`) on `ExpandableMenuSection`/`MenuAction` in `src/ui/components/ExpandableMenu.tsx`:

- **Typography weight hierarchy**: within Home's refined navigation sections, section/row titles are `700`, hints/bodies are `500`/default, and `900` is reserved for the Make Receipt title and the marker chip's numeral — a pragmatic 3-step subset (`900`/`700`/`500`) of the 4-step target table above, chosen for this scope rather than the full `600` tier.
- **Domain visual identity**: a solid Ledger-Cream rounded-square index chip (`01`–`04`) marks each of Home's four navigation sections — a restrained marker/numbering device, explicitly not a distinct strong color per section (Daily Operations, Records, Reports & Finance, and Setup all stay Structural Navy).

**Everywhere else** (`src/ui/theme.ts`'s global tokens, and the five other `ExpandableMenuSection`/`MenuAction` consumers that pass neither `refined` nor `polished`) is unchanged and still matches the base/default descriptions earlier in this file. Full implementation detail, including the Attention-state redesign and the Make Receipt cream-text treatment that accompanied this work, is recorded in `docs/ui-improvement-log.md`.

## Implemented on Project Command Center (2026-09-03)

Project Command Center (`src/ui/screens/ProjectCommandCenterScreen.tsx`) adopts Home's `refined` treatment and layers a second, richer set of enhancements on top, gated behind a new, independent `polished?: boolean` prop (default `false`, always passed alongside `refined`, never alone) on `ExpandableMenuSection`/`MenuAction`. This second layer exists specifically so Home's own rendering — which passes `refined` only — is provably unaffected; see the Named Rule below.

- **Unified Structural Navy parent labels**: all seven of the screen's primary sections (`Planning and Today`, `Field Operations`, `Issues`, `Photos`, `All Activity Timeline`, `Activity by Record Type`, `Records and Documents`) share one Structural Navy header — no section uses `tone="orange"` or `tone="cream"` for its own primary header. This directly followed physical-review feedback that a mixed navy/orange/cream header-per-section looked busy; sections are distinguished by numbering, titles/descriptions, and content layout instead, per the One Ledger and Reserved-Hue Rules.
- **Attached numbered ledger tab**: each section's `01`–`07` marker renders as a small Ledger-Cream rounded-square tab, absolutely positioned to overlap and protrude above the header's top edge — like a physical folder tab — rather than sitting inline as a small chip (Home's `refined`-only treatment, unchanged).
- **Connected header/body folder seam**: on open, the header's bottom corners and the body's top corners both flatten, and a 4px Signal Orange rule sits exactly where they meet (the animated accent bar, at 4px instead of `refined`'s 3px, settles into this static seam) — so the navy header and Ledger Cream body read as one opened folder, not two stacked cards.
- **Layered white-on-cream content rows**: individually-shadowed white cards inside the Ledger Cream section body, replacing `refined`'s flat ruled-row treatment for this screen only — a deliberate reversal, made in direct response to feedback that the flat treatment (used for Home) read as too plain once applied to Project Command Center's richer content.
- **Content-specific compositions**: a real vertical timeline (restrained rail, dot markers, white content cards) for "All Activity Timeline"; nested Ledger-Cream folders for "Activity by Record Type"; tinted priority badge pills for "Issues"; in-section grouping labels for "Planning and Today" (order and section membership unchanged). None of these are shared components; each is a screen-local presentational component in `ProjectCommandCenterScreen.tsx`.
- **Capped staggered row reveal**: each row's animation delay is `min(index × 26ms, 220ms)`, so opening a section with hundreds of records still finishes revealing within roughly half a second, never a "delayed interaction."
- **Header press feedback**: a subtle scale-down on press, matching the micro-interaction language already used elsewhere in the app.

### Named Rules
**The Refined/Polished Separation Rule.** `refined` and `polished` are independent props. `refined` alone reproduces Home's exact shipped treatment; `polished` is Project Command Center's additional layer and must only ever be passed alongside `refined`, never alone. A future screen wanting Project Command Center's richer look opts into both explicitly — it does not get it by accident from a `refined`-only change, and Home does not inherit it by accident from a `polished`-only change either.

**Everywhere else** (the five other `ExpandableMenuSection`/`MenuAction` consumers, and Home, which passes `refined` but never `polished`) is unaffected — confirmed by reading every call site.

## Implemented on Supplier Loads (2026-09-03)

`src/ui/screens/QuarryPurchasesScreen.tsx` was refined as an ambitious pass on an already-approved, already-liked design, not replaced — per explicit decision, it keeps its bespoke Structural-Navy supplier headers, warm cream-tan project headers, soft blue-gray supplier containers, and the existing Supplier → Project → Supplied Materials hierarchy, and was **not** migrated to `ExpandableMenuSection`/`MenuAction` (contrast with Home and Project Command Center above) — its disclosure remains a screen-local implementation, deliberately kept independent of the shared component's `refined`/`polished` states.

- **Typography weight hierarchy — first full 4-step implementation**: Home and Project Command Center each use a pragmatic 3-step subset (`900`/`700`/`500`). Supplier Loads' new **Supplied Material Record** (see Components above) is the first surface to use the complete target table: `900` reserved for the quantity-and-unit value alone; `700` for the material name and card/section titles; `600` for field labels, status badges, and — notably — the purchase/ticket reference number, which the previous design showed at `900` as the most prominent line on the card; `500`/default for descriptions, dates, and metadata.
- **Domain visual identity — deliberately not extended here.** Supplier Loads' existing two-tier Supplier/Project color hierarchy already serves the restrained-wayfinding intent this target describes; it was preserved exactly rather than replaced with Home/Project-Command-Center-style numbered markers, per the explicit instruction to refine, not replace, an already-approved identity.
- **Reactivated status treatment**: a Status-Warning-colored badge ("this record was corrected and restored for review"), derived entirely from already-stored fields (`status === 'Active' && cancelledAt != null` — no new field, no invented reactivation date or user), visually distinct from the Status-Danger-colored Cancelled badge.
- **Repeated-trip visual connection**: same-day, same-supplier, same-project, same-item/unit/transport-signature deliveries get a restrained Structural Navy connecting rail and a "Trip N of M" badge — a display-only grouping aid computed locally in the screen (mirroring, without modifying, `quarryDailyCounters`'s grouping-key logic in `src/domain/quarry.ts`) that never merges the underlying records, totals, audit histories, or correction/cancellation state; each trip keeps its own independent edit/correct/cancel action.
- **Progressive disclosure, extended**: an opened project now reveals its purchases 20 at a time behind a "Show More" control (mirroring Project Command Center's photo progressive-reveal pattern), and a new local text search (supplier, project, material, reference/ticket number, driver, truck plate) combines with the existing date-range filter — both operate on the complete loaded/filtered dataset before the reveal limit applies, per the Disclosure-over-density layout principle above.

**Everywhere else in this screen** (the Supplier/Project/container color hierarchy, the create/edit form's four cards, the daily truck counters, all pricing/VAT/correction/cancellation logic) is unchanged from the already-approved design. Full implementation detail is recorded in `docs/ui-improvement-log.md`.

## Implemented on Daily Reports (2026-09-03)

`src/ui/screens/ReportsScreen.tsx`'s per-project Daily Report workflow (project's report list, the ten-section editor, and the PDF-generation flow) was reorganized around a third, independently-built bespoke disclosure device — see "Daily Report Ledger Section" under Components above. The whole-business "Report Generation" Excel-workbook section in the same file was deliberately left untouched, including every style it depends on.

- **Typography weight hierarchy — full 4-step scale, second instance.** Following Supplier Loads' precedent: `900` reserved for the quantity/value emphasis inside record rows; `700` for the identity card's project name and section/record titles; `600` for field labels and section badges (a new `fieldLabel` style, forked from the pre-existing shared `label` style specifically so the untouched Report Generation payment-status filter kept its original weight); `500`/default for descriptions and metadata.
- **Domain visual identity — a third, bespoke instance.** Each section carries a numbered Ledger-Cream tab (`01`–`12`), the same restrained-numbering idea Home and Project Command Center use, rebuilt locally for this screen rather than reused as shared code (extends the Numbered Marker Rule — see `.impeccable/design.json`'s narrative rules).
- **Project/date identity card**: a Structural Navy card stating project name, customer, location, active/completed state, the report's work date (editor only), and the project's valid operating period in plain text — closing a gap where the date-boundary rule was previously enforced only silently by the date picker's min/max.
- **Section-entry summary**: a neutral "Sections with entries: N of 10" strip, computed from data already in memory — never called "completion," since every section but one is optional by design; only Work Information's badge switches to Status-Warning when empty, since it is the one genuinely required section. The denominator counts the ten **content** sections only: Consultant Sign-off (`11`) and Ministry Header (`12`) are per-report output options rather than report content, so neither is counted.
- **Duplicate-date warning**: a live-computed banner (from the project's already-loaded report list, excluding the report being edited) offering to open the existing report instead — the repository's one-report-per-project-per-date rule remains the sole source of truth; this is guidance, not a new validation rule.
- **Company Load vs. Supplier Load distinction, restated**: Signal Orange accent for company loads, Structural Navy for supplier loads — the same two-hue device used elsewhere, applied here to a unified record-row reading order (material name, quantity+unit, source, reference/time, driver/truck only when present, financial detail only when present).
- **PPE, 48dp status controls**: Compliant (Status Success), Missing PPE (Status Warning), Not Checked (Muted) — three full-width 48dp controls replacing undersized chips, with a concise summary on the section's closed header.
- **PDF template brought into compliance with the already-documented One Ledger Rule.** The Daily Report PDF's four summary cards previously used unrelated decorative green/blue/orange/purple fills — a standing violation of the Rule stated earlier in this file ("Every screen, PDF, and Excel export shares the same orange/navy/cream hierarchy"), not a new one introduced here. All four cards, and every table header, now use one neutral Ledger-Cream/Structural-Navy treatment; semantic color is reserved for the PPE status column (Status Success/Warning/Muted, newly added) and the Problems/Delays/Incidents panel (Status Danger, a genuine attention panel). Verified by rendering real With-Prices/No-Prices sample HTML through the actual template function: the No-Prices sample contains zero `$` figures and zero Total/Price/Cost columns; the Contractor label renders correctly in both.

**Everywhere else in this screen** (all repository calls, calculations, the one-report-per-project-per-date rule, past-date entry, autosave, and the untouched Report Generation section) is unchanged from the already-approved design. Full implementation detail is recorded in `docs/ui-improvement-log.md`.

## Implemented on Business Directory Screens (2026-09-04/05)

Financials (`FinancialsScreen.tsx`), Workspace Hub's Business Directory grouping only (`WorkspaceHubScreen.tsx`), Projects, Customers, People & Equipment, and Item Catalog were each audited and given a display-layer-only pass: full `accessibilityRole`/`accessibilityLabel`/`accessibilityState` coverage (several of these screens — Customers and People & Equipment especially — had none at all beforehand), every interactive control raised to the documented 48dp floor, consistent loading/empty/no-search-results states, and — on the five screens beyond Workspace Hub — the new **Directory Hero Header**, **Search Bar**, **Status Pill**, **Collapsible Status Band**, **Monogram Avatar**, and **Quiet Inline Action** patterns documented under Components above.

**This is a distinct pattern family from the Approved Refinement Targets below, not an extension of them.** These six screens did **not** adopt the graded typography-weight hierarchy target — they largely kept their pre-existing `800`/`900`-heavy weight usage (confirmed by direct inspection: `ProjectsScreen.tsx`, `CustomersScreen.tsx`, and `PeopleEquipmentScreen.tsx` each still use `fontWeight:'900'` more than any other weight). Nor is the new hero/search/band/avatar pattern the "domain visual identity" target — that target is about the app's *operational* domains (fuel, waste, reports, safety); these six are *record-directory* screens reached from Business Directory, and their new pattern is about findability and record-type identity (which project/customer/worker/item is this), not domain wayfinding. Treat the two gap-list items below as still accurately describing these six screens' typography-weight and domain-identity status — this section documents a different, additional improvement, not progress against either listed target.

Workspace Hub's Business Directory section specifically: its four `MenuAction` rows now pass `refined` and its `ExpandableMenuSection` passes `refined`+`marker`, identical to Home's mechanical `refined` usage — not a bespoke pattern, just Home's existing device applied to one more section. A `tone="cream"` + `refined` combination is now live on these four rows and on Workspace Hub's "More" tab's Reports Center row; `MenuAction`'s `refined` path only special-cases `tone="orange"`, so `cream`-toned refined rows currently render identically to untoned ones (confirmed intentional, not a defect — see the session record for the "Business Directory tile grid" attempt that was tried and then explicitly reverted by the product owner in favor of keeping this plainer treatment).

**Everywhere else** (`ExpandableMenu.tsx` itself, and every other screen not named above) is unchanged. Full phase-by-phase rationale, before/after descriptions, and audit findings for each of these six screens live only in this session's conversation history — `docs/ui-improvement-log.md` was not updated with matching per-phase entries for them (flagged in `docs/claude-context.md`'s 0.9.0 release section as follow-up work for a future session, not done silently).

## Current-vs-Target Gap List

1. **Typography weight.** Current: `fontWeight: '900'` used pervasively in `src/ui/theme.ts`'s global tokens and on every screen except Home, Project Command Center, Supplier Loads, and Daily Reports. Target: graded hierarchy above. **Partially implemented** — Home's and Project Command Center's navigation sections use a 3-step subset (`900`/`700`/`500`); Supplier Loads' supplied-material records and Daily Reports' section/record content use the full 4-step scale including `600` (see "Implemented on Supplier Loads" and "Implemented on Daily Reports"). Every other screen is still the pre-existing pervasive-900 state, and the global `theme.ts` tokens themselves are unchanged.
2. **Domain visual identity.** Current: domain separation via grouping, labels, and icons only, with no domain-dedicated color, on every screen except Home, Project Command Center, and Daily Reports. Target: restrained non-color identifiers per domain. **Partially implemented — Home's four sections (numbered chip), Project Command Center's seven sections (attached numbered tab), and Daily Reports' twelve sections (a third, independently-built attached numbered tab)**; Supplier Loads deliberately kept its existing two-tier color hierarchy instead (see "Implemented on Supplier Loads"); the five other `ExpandableMenuSection` consumers are unchanged.

These gaps are now first-instanced on Home, Project Command Center, and (typography only) Supplier Loads, rather than unimplemented everywhere. Extending either target to another screen is a separate, explicitly scoped future phase — not a mandate implied by any one screen's implementation, and not a reason to redesign the color system or restate `docs/design-system.md`. Financials, Workspace Hub's Business Directory grouping, Projects, Customers, People & Equipment, and Item Catalog (see "Implemented on Business Directory Screens" above) do not count toward either gap closing — their 2026-09-04/05 pass was accessibility/findability work using a separate pattern family, not an implementation of these two targets.
