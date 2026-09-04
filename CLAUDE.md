# DROMEX - Claude Project Handoff

This file is the implementation handoff for Claude Code. It describes the current
application and the rules for future work. Read it together with every file in
`requirements/` before changing code.

## Operating rules

1. `requirements/` is the authoritative product record. Read it completely.
2. Treat confirmed decisions as binding. Treat draft/open questions as unresolved.
3. Inspect the existing implementation before proposing a rewrite.
4. Preserve working workflows, historical records, and the existing visual style.
5. Do not introduce Firebase/VPS/PostgreSQL sync, web support, or multi-user access
   unless that phase is explicitly approved.
6. Work in small phases. Before each phase, state scope, affected files, schema
   migrations, risks, and tests. Implement only the approved phase.
7. Never silently rewrite confirmed historical business data. Use correction,
   cancellation, replacement, or audit history where appropriate.
8. Do not create duplicate requirements or design documents. Extend existing ones.
9. Run typecheck and the relevant tests after every implementation phase.
10. Do not build or release an APK without explicit approval.

## Product identity and current release

DROMEX is a phone-first, offline-first construction and plant-management
application. It records outgoing company loads, incoming supplier loads, projects,
daily reports, equipment, fuel, waste, walls, pavement calculations, finances,
documents, and backups.

Current source release metadata is version `0.9.0`, Android version code `12`,
package/bundle identifier `com.dromex.management`, and Expo SDK 54. The accepted
internal Android artifact is `output/DROMEX-0.9.0-build12.apk` when present.

The first production rollout is a single-admin, offline-only deployment. Firebase
cloud code exists as a later/config-gated slice; SQLite remains the immediate
source of truth on the device until cloud configuration and acceptance testing are
explicitly approved.

## Source-of-truth precedence

When information conflicts, use this order and report the conflict:

1. The latest confirmed decision in `requirements/decisions.md`.
2. Confirmed requirements in `requirements/SRS.md`.
3. The current implementation and database migrations.
4. `requirements/elicitation-state.md` and `requirements/interview-transcript.md`.
5. `docs/` explanatory material.
6. Assumptions proposed by Claude (must be labeled as assumptions).

Open questions in `requirements/open-questions.md` must not be guessed. Ask the
owner or propose a clearly isolated option.

## Technology and architecture

- Expo React Native, React 19, React Native 0.81, strict TypeScript.
- SQLite through `expo-sqlite`, with WAL mode, foreign keys, and forward-only
  migrations in `src/data/database/migrations.ts`.
- Repository boundary: UI calls domain/repository interfaces; SQLite adapters
  persist data and append a `sync_outbox` entry in the same transaction.
- Offline-first: forms must work without network access and survive app restarts.
- Optional cloud layer: Firebase REST/Auth/Firestore/Storage services under
  `src/services/cloud` and `src/config/firebase.ts`; disabled when environment
  identifiers are absent.
- Bluetooth Classic receipt printing through
  `react-native-bluetooth-classic`; PDFs and native sharing use Expo services.

Dependency direction:

```text
UI -> repository interface -> SQLite adapter -> SQLite
                                      -> sync_outbox -> optional cloud worker
```

## Repository layout

- `src/domain/`: framework-independent types, validation, calculations, and
  business rules.
- `src/data/database/`: schema and migrations. Never edit old migrations in a way
  that breaks an existing database; add a forward migration.
- `src/data/repositories/`: interfaces and SQLite implementations.
- `src/ui/DromexApp.tsx`: application shell and navigation.
- `src/ui/screens/`: feature screens.
- `src/ui/components/`: reusable selectors, cards, filters, menus, and primitives.
- `src/services/`: PDF/Excel export, Bluetooth, backup, media, and cloud services.
- `tests/`: fast domain, repository, migration, export, backup, and sync tests.
- `requirements/`: elicited requirements, decisions, transcript, and state.
- `docs/`: architecture, design system, setup, audit, and device test guides.

## Implemented feature areas

### Home and navigation

Home is the command center. It uses grouped, colorful action cards and expandable
labels. Expandable sections are closed by default. Parent labels reveal related
child actions; do not replace this organization with a flat list without approval.

### Catalog and setup

The catalog supports user-defined categories, items, measurement units, conversion
options, active/inactive state, internal codes, and supplier enablement. Supplier
load selectors show only active items explicitly enabled for Suppliers, grouped by
category. Referenced configuration is deactivated rather than deleted so history
stays valid.

### Company, customers, suppliers, people, and equipment

Customers remain named **Customers**. In project PDFs, the business is identified
as the **Contractor**; this does not rename the Customers module. Suppliers are the
incoming external-delivery workflow (legacy database names may still say quarry).
Machines and trucks are both supported and editable. Confirmed transactions keep
historical snapshots when a profile is later edited.

### Company loads and receipts

Make Receipt records an outgoing company load. It supports project/customer,
destination, item, driver/truck, direct quantity or weighbridge quantity, unit and
conversion, optional price/VAT, notes, signature, receipt, and delivery
authorization. Confirmation is irreversible except through the reasoned correction
or cancellation paths. Receipt and authorization share one underlying load record.

### Supplier Loads

Supplier Loads record incoming deliveries. They support supplier, project, item,
unit, quantity, date, optional price, VAT, delivery details, ticket, notes, and
either Our Driver or Supplier Delivering. Supplier Delivering does not require a
company driver or truck; a supplier plate is optional. Pricing choices are visibly
`Per Unit` or `As a Whole`; the field is labeled only `Price`. Price, VAT treatment,
rate, subtotal, and total are snapshotted. Counters create separate numbered
deliveries and never duplicate a ledger entry.

Supplier Loads appear in project Daily Reports under Loads delivered that day,
separated from Company/Plant Loads. Load History shares one entry point but keeps
company and supplier source labels. Canceled loads can be corrected and reactivated
in place with a reason; active payments constrain supplier reassignment/reactivation.

### Projects, schedules, and command centers

Projects have active/completed state, dates, completion/reactivation, and a Project
Command Center. Project activity is grouped by record type (Loads, Daily Reports,
Supplier Loads, Waste Dumps, Fuel, Scheduled Work, Pavement, Walls, Issues, Photos)
and also has a bounded mixed timeline with inclusive date filtering. Dates outside
the project operating period are rejected.

The current Schedule screen is the foundation for future engineering scheduling.
The approved roadmap is WBS -> activities -> dependencies -> CPM -> resources and
cost -> baseline -> progress/control -> PERT and compression. Do not implement a
large scheduling engine without a separate approved phase.

### Daily reports and safety

Daily Reports store work, time, attendees, materials, loads, supplier deliveries,
fuel used, waste, issues, photos, and Worker Safety/PPE. Truck drivers appear as
workers with their own PPE status. Reports can be exported with prices or with all
financial values excluded; no-prices is the operational default.

Past-date entry is supported for operational records. Preserve the selected
effective date separately from the actual entry timestamp.

### Fuel

Fuel is a single-tank, offline ledger. It supports physical baseline readings,
fuel purchases, equipment fills, cancellation-aware history, project/equipment
filters, supplier pricing/VAT, and a dashboard for today and the calendar month.
Fuel purchases and fills snapshot price and cost. A missing price is explicitly
`Unpriced`; it is not silently treated as zero. Project fills appear in the
project Daily Report and project cost reports.

Hour-meter/odometer consumption calculations and abnormal-consumption alerts are
deferred. The optional odometer remains reference-only.

### Waste, walls, and pavement

Waste Dump Tracking supports one-tap counters, multiple trucks/drivers, dates,
materials, locations, cancellation, history, and Daily Report inclusion. Walls
support reinforced concrete, rock/stone systems, concrete plus rocks, and per-wall
consumption records for concrete, rebar, cement, sand, gravel, filling concrete,
and related inputs. Pavement tools support kg/m² quantities, thickness rules,
loose/compacted factors, and advanced sections.

### Finance and exports

Payments and balances cover priced company loads, supplier loads, customer/supplier
opening balances, partial in-person payments, statuses, and reasoned cancellation.
No electronic payment processing is in scope.

Reports include Daily Reports, project completion reports, business analysis,
supplier-specific Excel workbooks, fuel/project cost reports, pavement exports,
photos, and PDFs. Excel workbooks should preserve stable identifiers, numeric
columns, filters, frozen headings, summaries, and a data dictionary.

### Backup, restore, and printing

Backups are password-encrypted `.dromexbackup` packages containing SQLite data,
preferences, and referenced media. Restore validates and previews, saves a
separately passworded safety copy, then replaces the current database; it does not
merge records. Android uses the system picker/Downloads/USB/Drive providers. iOS
uses Apple Files/iCloud/On My iPhone/providers. Bluetooth printing is native to the
mobile app and is not directly reusable by a browser; the web version would need a
browser-supported printer or a companion service.

## UI and interaction contract

Read `docs/design-system.md` before visual work. Preserve the colorful DROMEX
identity, card hierarchy, rounded controls, clear labels, grouped workflows,
searchable selectors, closed-by-default expandable sections, readable result
highlighting, and phone-first touch targets. Reuse components from
`src/ui/components` before creating new ones. Loading, empty, error, confirmation,
and disabled states must be explicit.

## Engineering project-management roadmap

The EPM knowledge base should be maintained as a separate Claude skill/reference
pack. Its implementation phases are:

1. Schedule data model: WBS, activities, milestones, durations, calendars,
   quantities, productivity, areas, and responsibility.
2. CPM engine: FS/SS/FF/SF links, lag, forward/backward pass, early/late dates,
   total/free float, critical path, and finish date.
3. Schedule UI: activity tree, editor, dependency editor, Gantt, filters, and
   critical-path highlighting.
4. Resources/cost: labor, equipment, trucks, materials, suppliers, fuel,
   subcontractors, availability, and over-allocation warnings.
5. Baseline/control: baseline, status date, actual progress, units complete,
   tracking Gantt, delays, causes, and corrective actions.
6. Earned value: planned value/BCWS, earned value/BCWP, actual cost/ACWP, SV, CV,
   SPI, CPI, EAC, ETC, and S-curves.
7. Advanced planning: PERT, resource leveling, what-if scenarios, and
   normal/crashed schedule cost-time comparisons.

Each phase must be independently testable and must integrate with existing daily
records rather than create a second disconnected data-entry system.

## Commands and quality gates

```powershell
npm install
npm run typecheck
npm test
npm start
npm run demo:backup
```

Before a phase is accepted, report:

- files and database migrations changed;
- behavior added or corrected;
- tests run and their result;
- backup/restore implications;
- offline behavior;
- unresolved risks or open questions;
- whether an APK/build was intentionally not created.

For release work, verify the Expo version, Android version code, package identity,
signing identity, APK artifact, data-retention behavior during in-place install,
and the complete test suite. Keep release artifacts versioned and do not overwrite
an accepted installer.

## First instruction to Claude

Start every new task by saying which requirements and decisions you read, which
current implementation files are relevant, what is confirmed versus open, and
which smallest phase you recommend. Wait for approval before implementing any
non-trivial change.
