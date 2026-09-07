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
