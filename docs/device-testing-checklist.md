# Device testing checklist

The checks that must be run on a physical Android device, because no test in
this repository can establish them. `npm test` covers domain rules, repository
behaviour, migrations and generated HTML strings; it renders no screen and
shapes no glyph.

Keep this file current. When a phase adds a behaviour whose correctness
depends on the device, add its check here rather than leaving it in a session
transcript.

## How to use it

1. Install the APK **over** the existing app. Never uninstall first: an
   in-place upgrade is what exercises the migration.
2. Work through **Section 0 first**. If anything there fails, stop.
3. For a failure, record the step number, what you expected, what happened,
   and a screenshot. For a crash, the screen and the action just before it.

---

## 0 · Upgrade safety — always, on every build

1. Android Settings, Apps, DROMEX shows the expected version.
2. Projects, Customers, Load History, Supplier Loads, Daily Reports and the
   Fuel Ledger all still hold their records, with unchanged values.
3. Several existing Daily Reports open normally.
4. Take a backup and confirm it saves. Any build carrying a migration changes
   the schema the backup captures.

## 1 · Standing checks — any build that touches these areas

5. **Airplane mode.** Every form works with no network, and records survive an
   app restart.
6. **Remove animations on** (Android accessibility). No entrance, collapse or
   glyph animation anywhere; content still correct.
7. **Font size Largest.** No clipped labels. Long project, customer, supplier
   and material names wrap without overlapping.
8. **TalkBack.** Controls announce a name, a role, and their state.
9. **Sunlight and gloves.** Every tap target comfortable; status legible
   without relying on colour.
10. Android Back gesture and button close any sheet or editor without saving,
    and never trap you.

---

## Build 17 — 0.14.0 (verified 2026-09-07)

Everything below passed. Kept as the regression set for later builds.

### PDF Settings and the move out of Company & VAT

11. More, Setup shows **PDF Settings** at row 05, Backup at 06, Account &
    Cloud at 07.
12. Previously configured Ministry name, Ministry logo and Consulting agency
    name are **present in PDF Settings after the upgrade**. They changed
    screens, not values.
13. Company & VAT no longer shows the Ministry or Consulting agency cards, and
    still holds company name, logo, contacts, Tax/VAT, receipt footer, VAT
    rate and DEMO visibility.
14. **The wipe test, both directions.** Change and save something in Company &
    VAT, then reopen PDF Settings: every header value is still there. Then the
    reverse.
15. Configuration State Pills match what is actually configured.

### Arabic — the check no test can make

16. Typing in an Arabic field starts the caret at the right and flows
    right-to-left.
17. In a **generated PDF**, Arabic renders as **connected, correctly shaped,
    right-to-left script**. Isolated, disconnected or reversed letters is a
    failure whose fallback is bundling a font (DEC-400).
18. Arabic-Indic digits are not reversed.
19. No Arabic text overlaps a logo or the divider.

### The three headers

20. Each of Show Ministry, Show Consulting Agency and Show Custom Header
    appears and disappears in the PDF **alone**.
21. Every combination renders: three, two, one, none.
22. **The backfill.** A report whose Consultant Sign-off was on before the
    upgrade still prints its agency line (DEC-399).
23. **Independence, forward.** Sign-off off with the agency on: the agency
    stays.
24. **Independence, backward.** Agency off with sign-off on: the agency goes,
    the end-of-page-two signature stays.
25. A header switched on with nothing configured says so and offers **Open PDF
    Settings**, which navigates there.
26. Switching a header off does not delete its stored global values.
27. The editor still has **twelve** sections.

### Page-one composition

28. Order: logo row, institutional names, one divider, centred title.
29. Company logo left, ministry logo right, neither stretched nor cropped.
30. **Ministry off leaves the company logo in place** (DEC-401).
31. English left and Arabic right, facing each other.
32. With one language cleared, the other takes the full width — no empty
    facing column.
33. Project and Location left; Contractor and Work date starting near
    mid-page, left-aligned on one shared edge, nothing touching the right
    margin.
34. A long contractor name stays on one line and inside the page.
35. Page two shows no institutional headers.

### Supplier blocks

36. Each supplier is a visually separate block, not one continuous list.
37. Billed, Paid and Outstanding align in columns across suppliers.
38. Each material shows quantity, unit and trip count; unlike units are not
    merged.
39. Record detail sits behind a per-supplier disclosure, closed by default.
40. For an **overpaid** supplier, Paid shows the real amount paid and an
    Overpaid line explains it. This is the case where `billed - outstanding`
    would be wrong (DEC-405).
41. **No combined total, net, profit or margin anywhere.**

### Edit Project Information

42. Reachable from Project Command Center, Records and Documents, row 04, and
    from each card in the Projects list.
43. A notes-only edit saves with no confirmation.
44. A name or location change asks for confirmation first.
45. **The snapshot boundary.** After a rename, a load confirmed *before* the
    rename still shows the **old** project name in Load History (DEC-403,
    DEC-404).
46. That load's payments, totals and transaction number are unchanged.
47. Customer, start date and status cannot be changed from this editor.
48. Start-date editing still works from Projects, unchanged.

---

## Build 28 — 0.20.0 (accepted by the Owner 2026-10-04)

Build 28 is build 27 with the company from Company Settings on the Diesel
Batch Report. Install over build 27, 26 or 25 and run the Build 27 and Build 26
steps below, then:

1. Settings → Company: check the company name, logo, address, phone and email.
2. Export a Diesel Batch Report. Its header shows your logo, company name and
   contact details (not "DROMEX · Construction & Plant Management"), and the
   running title at the top of each page starts with your company name.
3. A long or Arabic company name wraps inside the header without overlapping.

## Build 27 — 0.20.0 (built; superseded by build 28)

Build 27 is build 26 plus the History and Usage tabs in the day-card design.
Install **over build 26** (or build 25) and run the Build 26 steps below, then:

1. Fuel Management → **History**: a summary card (Delivered in, Filled out, Dip
   adjustments, Diesel in tank), then **one card per day**, newest first, with
   DELIVERIES IN, DIP READINGS and the fills grouped by project, company site
   and unassigned. The card header shows In and Out litres.
2. A cancelled fill or delivery shows struck through with a red "Cancelled ·
   reason" tag and is not counted in any total.
3. Tap a delivery, a dip reading and a fill: each opens its record as before.
4. History filters (project, equipment, type, status, dates) show as removable
   chips with Clear all, and the day cards follow them.
5. Fuel Management → **Usage**: Fuel used by destination (batches, before
   batches, outside stations, cost), By destination, By source, then one card
   per day grouped by destination.
6. Tap a project in By destination: only its fills show, the summary changes
   to that project, and **Export <project> PDF** exports just that project. Do
   the same for a company site and for Unassigned, then Show all destinations.
7. Usage filters (Projects / Sites / Unassigned, search, dates) narrow the
   cards and the export.

## Build 26 — 0.20.0 (tested by the Owner; superseded by build 27)

Install **over build 25** (the preview in use). If a phone still runs build 22,
also install over build 22 once. Do Section 0 first.

**Upgrade and numbering**

1. Load History: every load keeps its number exactly as before (for example
   `ASP-2026-001`); loads from before build 23 still show the legacy wording.
2. Confirm a new asphalt load. Its Load No. continues the count in the new form
   (after two `ASP-2026-…` loads it is `ASP-00003`), never restarting at 1.
3. Load number series screen: the help text and the preview show `ASP-00001`
   style numbers and say the count never restarts.

**Printed receipt (real printer, 58 mm and 80 mm if both exist)**

4. Company title, address, phone, email and Tax/VAT are centred under the title,
   including a long address that wraps onto two lines.
5. Receipt and Delivery Authorization both print **Load No.** in bold directly
   above **Transaction**. A reprinted old load without a number prints no Load
   No. line and otherwise looks as it did before.
6. The PDF receipt shows the same Load No. row.

**Diesel batches**

7. Fuel opens on the dashboard as before. The new Batches tab shows **Start
   diesel batches** with the calculated tank balance.
8. Start with a dip reading. The Opening stock batch (`DSL-2026-00001`) holds the
   dip litres; the Fuel screen now opens on Batches; Home shows the litres in
   the tank and the batch in use under Fuel Tracking.
9. Record a diesel delivery with an invoice number. A new batch appears,
   waiting, with "Invoice …" and "Starts after … is used up".
10. Record Fill, From tank: the oldest batch is pre-selected; enter more litres
    than it has left. "Before you save" shows the split, the batch that closes,
    the tank before and after, and the cost (Unpriced litres written out).
    Save, then check both batches and the tank figure.
11. Record a fill larger than all the diesel. It saves, and a red Overfill
    Alert appears in words on the tank card, the batch page and Home.
12. Record a dip reading that differs from the batches. The batch page shows an
    amber adjustment with the calculated and dip figures.
13. Outside station: add a station inline, record a fill from it. The tank and
    every batch are unchanged; the fill appears under Outside station fills and
    in the project's fuel.
14. Open a batch: the four figures stay at the top while scrolling; Cancel Batch
    needs a reason and asks first; the number is never reused afterwards.
15. Project → Equipment Fuel: totals split into batches, before batches and
    outside stations; one card per day, newest first, each row tagged.

**Exports**

16. Export the PDF from a batch, from the filter view (project, site, station,
    dates) and from a project, Without and With prices. Check A4, headings
    repeating on page 2, the running title and "Page X of Y" in the margins
    (may be missing on older Android System WebView versions), Arabic names
    whole, and text searchable in a PDF viewer.
17. Fuel and analysis workbooks: Fuel Type, Source, Station, Batch Number and
    Batch Portions columns; Diesel Batches and Fuel Stations sheets.

**Standing checks for these screens**

18. Items 5 to 9 of Section 1 (airplane mode, remove animations, font size
    Largest, TalkBack, sunlight) on Record Fill, the Batches tab, a batch page
    and the project fuel view, with a long Arabic project and site name.
19. Back up, restore the backup, and confirm batches, stations and numbering
    are unchanged and a new delivery takes the next DSL number.

---

## Carried forward, still unverified

Builds 13, 14, 15 and 16 were released without device verification. If a
regression appears in any of the areas below, its build is the place to look.

- **Fuel gauge readings.** Build 13 shipped a `recordGauge` defect (nine
  columns bound to ten value slots) that no test called; it was found by
  reading. Record a physical tank reading on any new build.
- **Fuel type and corrections** (build 16 UI over build 14 repository paths):
  a gasoline fill must not move the diesel tank balance, and pricing a fill
  that was saved Unpriced is the case cancel-and-re-enter cannot do.
- **Units & Conversions** (build 16): Edit opens a populated sheet, and
  removing an in-use unit deactivates rather than deletes it.
