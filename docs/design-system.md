# DROMEX Interface Standard

This is the required visual and interaction baseline for all current and future screens.

## Page structure

1. Use the warm-cream application background.
2. Use 20-point horizontal page padding, 16-point vertical gaps, and at least 42 points of bottom content padding.
3. A secondary page starts with one standard header: white Back button, orange uppercase eyebrow, then a 28-point navy/ink title.
4. Follow the header with a short helper sentence only when it explains the workflow or a business rule.
5. Put related form fields or records in rounded cards. Do not place unrelated controls in one card.
6. Show the most important current totals near the top as two-column metric cards that wrap on narrow screens.
7. Keep the main action after its form and keep destructive actions visually separate.

## Color roles

- Orange (`#C84B31`): primary action and brand emphasis.
- Navy (`#173F67`): navigation groups, strong context cards, and stable secondary actions.
- Warm cream (`#FFF8ED` / `#F5F2EC`): page and expanded-filter backgrounds.
- White: normal cards, forms, and record rows.
- Green, amber, and red: success, warning, and destructive/error meaning only.

Color must communicate role consistently; it is not decorative.

## Buttons

- Primary: solid orange, white label. One principal action per page section.
- Navy: solid navy, white label. Save/confirm/open actions when orange is already the page emphasis.
- Secondary: white with a thin navy border. Preview, export, retry, and non-destructive alternatives.
- Danger: white with a thin red border and red text. Cancellation/deactivation only, placed away from primary actions.
- Minimum button height is 48 points. Disabled buttons remain visible at 40% opacity.
- Labels use direct verbs: `Save Fuel Delivery`, `Open Report`, `Cancel Movement`.
- A button may include one short helper line; never place a paragraph inside a button.

## Cards, forms, and lists

- Standard card: white, 16-point radius, 17-point padding, 12-point internal gap.
- Context card: navy with cream text. Use for the selected project, tank state, or other strong page context.
- Inputs: 46-point minimum height, white/warm-white fill, thin neutral border, 11-point radius, label above.
- Required labels end in `*`; validation appears in one error panel and the invalid record remains editable.
- Growing master-data choices use searchable dropdowns. Small fixed choices use chips/tabs.
- Record rows show primary identity first, compact metadata second, and status/value aligned consistently.
- Empty lists use a dashed empty-state card that explains the next action.

## Filters and disclosure

- Multi-control filters use the shared collapsed orange header and warm-cream body.
- Simple one-field searches stay inline.
- Navy group headers open their own record list; records are hidden until explicitly opened when lists are large.
- Use encoding-safe `+`, `−`, and `×` symbols.

## Feedback and motion

- Success, warning, and error messages use green, amber, and red tinted panels.
- Press motion is short and restrained; it must never delay access to a record.
- Layout transitions explain opening/closing. No continuous decorative animation.
- Loading and export actions disable repeat taps and replace the label with a clear progress state.

## Documents and reports

- App screens use the same orange/navy/cream hierarchy as PDFs and spreadsheets.
- Reports put title/context first, then KPI summaries, then detail tables, then appendices/evidence.
- Spreadsheet raw sheets remain flat and filterable; summary sheets may use branded KPI blocks and charts.

## Implementation rule

New screens must use `AppPage`, `PageHeader`, `AppCard`, `AppButton`, `AppField`, `MetricCard`, `Feedback`, and `EmptyState` from `src/ui/components/AppPrimitives.tsx`. Existing screens should migrate to these primitives when they are next materially edited; do not perform cosmetic-only rewrites that risk stable workflows.
