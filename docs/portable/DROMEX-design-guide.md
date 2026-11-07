# DROMEX Design Guide (portable)

Use this file to make a new application look and behave like DROMEX. It is a summary of what the app actually does today, taken from `docs/design-system.md`, `src/ui/theme.ts`, `src/ui/components/AppPrimitives.tsx`, the Home and Daily Report screens, the PDF templates, and the approved mockups in `docs/design/`. Where this file and the source disagree, the source wins.

Files to copy into the new project so the look matches exactly:

- `src/ui/theme.ts` (colors, spacing, radius, typography)
- `src/ui/components/AppPrimitives.tsx` (page, header, card, button, field, metric, feedback, empty state)
- `src/ui/components/FocusedSheet.tsx`, `SegmentedChoice.tsx`, `SearchableSelect.tsx`, `ExpandableMenu.tsx`, `SaveContinueFooter.tsx`
- `docs/design-system.md` and the `docs/design/*.html` mockups as visual references

## 1. What the app is

A phone-first, offline-first construction and plant-management app (Expo React Native, strict TypeScript, local SQLite). One person uses it on site, often outdoors, often with dirty hands. That drives every choice below: large touch targets, high contrast, one clear action per page, and no surprises.

## 2. Identity and principles

1. **Color means a role, never decoration.** Orange is the main action, navy is structure, green/amber/red are success/warning/danger only.
2. **One principal action per page section.** Everything else is quieter.
3. **Grouped, closed-by-default disclosure.** Long lists and big sections stay closed until opened. Nothing is remembered as open between visits.
4. **Explicit states.** Loading, empty, error, confirmation and disabled are always designed, never blank.
5. **History is never silently rewritten.** Confirmed records change only through audited corrections or cancellations with a reason.
6. **Mockup first.** Any new screen, PDF or receipt layout is shown as an openable HTML mockup and approved before it is built (see `DROMEX-skills-and-working-rules.md`).
7. **Do not rewrite working screens just to restyle them.** New screens use the shared primitives; old ones migrate when next materially edited.

## 3. Design tokens

### Color

| Token | Hex | Role |
|---|---|---|
| `brand` (Signal Orange) | `#C84B31` | Primary action, brand emphasis, eyebrow text, project and site names |
| `brandDark` | `#8E2E1B` | Shadow and pressed tint for orange |
| `navy` (Structural Navy) | `#173F67` | Navigation groups, context cards, secondary actions, table headers |
| `navyDeep` | `#082D61` | Deepest navy accents |
| `cream` (Ledger Cream) | `#FFF8ED` | Text on navy/orange, soft card fill |
| `creamSoft` / `background` | `#F5F2EC` | Page background |
| `surface` | `#FFFFFF` | Normal cards, forms, record rows |
| `ink` | `#17212B` | Primary text |
| `muted` | `#65717D` | Helper and meta text |
| `line` | `#DDD7CC` | Borders and dividers |
| `success` | `#287A55` | Success (tint `#E5F3EC`) |
| `warning` | `#9A6512` | Warning (tint `#FFF3D8`) |
| `danger` | `#B3261E` | Error and destructive (tint `#FCE8E6`) |
| `result` / `resultDark` / `resultSoft` | `#087F8C` / `#04545D` / `#DDF7F5` | Calculated results (teal) |
| Hero text | `#FFFCF6` | Text on the orange hero card only (contrast about 4.56:1) |

Progress and status tones used on target and batch cards: navy bar for in progress, amber (`#C98A1A` bar, `#8A5300` text, `#FFF4DC` fill) for near, red (`#A61B12`) for over, green for done. A tone is always paired with words so it reads in black and white.

### Spacing, radius, type

- Spacing: xs 4, sm 8, md 12, lg 16, xl 20, xxl 28.
- Radius: sm 10, md 13, lg 16, xl 19, pill 999.
- Type (system font on the phone): eyebrow 11 / 900 / letter-spacing 1.4 (uppercase, orange); page title 28 / 900; section title 19 / 900; card title 16 / 900; body 14 / 20; helper 13 / 19. Mockups use Noto Sans.
- Touch targets: at least 48 points for buttons and tappable rows; inputs at least 46.

## 4. Page structure

Every secondary page is built from `AppPage`, `PageHeader`, `AppCard`, `AppButton`, `AppField`, `MetricCard`, `Feedback`, `EmptyState`:

1. Warm-cream page background, 20 horizontal padding, 16 gaps, at least 42 bottom padding.
2. Standard header: white Back button, then an orange uppercase **eyebrow**, then the 28-point **title**.
3. A short helper sentence only when it explains a workflow or business rule.
4. Related fields or records go in rounded white cards; unrelated controls never share a card.
5. Current totals near the top as two-column metric cards that wrap on narrow phones.
6. The main action sits after its form; destructive actions are visually separate (a red link or bordered button at the bottom).

## 5. Components

- **Cards:** white, radius 16, padding 17, gap 12. Tones: cream (bordered `#E8DED0`), navy (context such as the selected project), orange (emphasis).
- **Buttons:** primary solid orange; navy solid navy; secondary white with a thin navy border; danger white with a thin red border and red text. Minimum 48 high, disabled at 40% opacity, direct verb labels (`Save Fuel Delivery`, `Cancel Movement`), at most one short helper line inside.
- **Fields:** label above, 46 minimum height, warm-white fill `#FCFBF8`, thin neutral border, radius 11. Required labels end in `*`. Validation appears in one error panel and the record stays editable. An "open" variant draws an underlined field with a smaller grey label (used on Open form pages).
- **Choices:** growing master data (customers, items, trucks) uses searchable dropdowns (`SearchableSelect`, grouped variant for categories). Small fixed choices use `SegmentedChoice` chips or tabs. The selected chip has a fill, a heavier border and a check mark, so it never relies on color alone.
- **Focused sheet:** a full-screen page sheet for one record: eyebrow, title, Close pill, scrolling body, sticky footer with the one primary action. Errors stay inside the body so typing survives. Do not open a second modal from inside a sheet.
- **Feedback:** green, amber and red tinted panels for success, warning, error.
- **Empty state:** dashed-border card that says what to do next.
- **Record rows:** identity first, compact meta second, status or value aligned consistently.
- **Filters:** multi-control filters share a collapsed orange header with a cream body; a single search stays inline. Symbols are `+`, `−`, `×`.
- **Expandable menu:** a section with a two-digit marker chip (`01`..`05`), a title and hint, a `+` that rotates into `×`, and a bounded cream card of flat ruled rows with a thin left accent.
- **Numbered ledger sections** (the Daily Report editor): each section has a two-digit number, title, badge (count or "No records") and a collapse arrow; linked sections are read-only and say where to correct them.
- **Wizards:** long forms are one step at a time (Make Receipt has four) with a sticky bar showing TOTAL, Cancel or Back, and Next. Next stops only for the current step's checks; the last step lists every detail with a Change link per line and an irreversible-action warning on confirm.

## 6. Home screen layout

One scrolling page, top to bottom:

1. Header: logo or wordmark, "PLANT MANAGEMENT" eyebrow, date and app version on the right, then a skyline picture (user can choose it in Appearance).
2. **Make Receipt**: the single large orange primary card (eyebrow, 26-point title, one hint line).
3. **Needs Attention** strip plus a **Drafts** button: green "All clear", amber "Need attention" with a count, red with Retry on error, neutral while loading. Drafts is always visible.
4. **Totals**: a navy bar leading to company-wide totals.
5. Expandable groups, all closed by default: Daily Operations, Stock, Records, Reports & Finance, Setup.
6. A dashboard overview, collapsed behind a "Show Dashboard" control.

Entrance animation staggers the blocks in; press feedback is a short spring; every motion skips to its end state when the OS reduce-motion setting is on.

## 7. Documents (PDF and Excel)

- **PDF:** A4, margins 13/13/15 mm, Arial with an Arabic fallback, 9 pt body, `dir="auto"` for mixed-language text. Header has the company logo on the left, a navy tracked title on the right and a 3 px orange rule underneath. Section headings are small uppercase navy with a navy rule. Tables use a navy header row, light row rules, right-aligned tabular numbers. Totals sit in cream rows with a heavy top rule. Tables break only between rows and repeat headings on each page; sections never strand a heading at the foot of a page. Prices are optional: a "No prices" version is the operational default and a "With prices" version is internal.
- **Reports order:** title and context, KPI summary, detail tables, appendices and evidence (photos, sign-offs).
- **Excel:** raw sheets stay flat and filterable with numeric columns, frozen headings, stable ids and a data dictionary; summary sheets may use branded KPI blocks. New sheets are appended at the end so earlier sheet positions never move.
- **Receipts:** printed on 58 or 80 mm with a centred header, load number and contact details.

## 8. Behavior patterns worth copying

- Past dates are allowed for operational records; keep the chosen effective date separate from the entry timestamp.
- Snapshot names, prices and units on confirmed records so a later edit never changes history.
- Deactivate referenced configuration instead of deleting it.
- Corrections and cancellations require a reason, keep the original, and appear in a history list.
- Missing price is shown as "Unpriced", never zero. Units are never converted silently.
- Export switches that hide a section in the PDF or Excel never hide it on screen and never delete data; they are saved app preferences that default to on.
- Backups are one encrypted file; restore previews first and replaces rather than merges.

## 9. Tech stack to match

Expo SDK 54, React 19, React Native 0.81, strict TypeScript, `expo-sqlite` (WAL, foreign keys, forward-only migrations), `expo-print` and `expo-sharing` for PDFs, `fflate` for Excel, `react-native-svg` for diagrams, `vitest` for tests. Layers: `src/domain` (pure rules), `src/data` (repositories), `src/services` (export, backup), `src/ui` (screens and components). The UI calls repository interfaces, never SQLite directly.
