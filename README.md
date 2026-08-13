# DROMEX

Offline-first plant management for iPhone and Android.

## Current build slices

The executable foundation and profile-management slice include:

- Expo SDK 54 with React Native and strict TypeScript, aligned with the
  currently available iPhone Expo Go client;
- a versioned SQLite database using WAL and foreign keys;
- a durable synchronization outbox boundary for later Firebase integration;
- a phone-first Home screen with the prominent Make Receipt entry point;
- a purpose-grouped Home screen separating Daily Operations, Records, Reports
  & Finance, and Setup with explicit descriptions and no placeholder metrics;
- a persistent shared Item Catalog supporting category creation, item creation,
  usage-area selection, unique internal-code validation, and non-blocking
  similar-name warnings;
- persistent customer creation, search, details, duplicate warnings, and
  activation controls;
- editable company contact, Tax/VAT, receipt-footer, and universal VAT
  settings, synchronized with a protected own-company customer profile; and
- receipt setup for projects, measurement units, and conversion options;
- a dedicated Projects directory with project creation, Active/Completed lists,
  completion, and reactivation;
- a reusable People & Equipment directory with worker role/contact details,
  driver contact/licence details, truck plate/make/capacity/owner details, and
  machine type/identifier details;
- compact searchable dropdowns for growing customer, project, item,
  conversion, unit, driver, and truck selections;
- an autosaved Make Receipt workflow with customer/project/destination, item,
  driver/truck, requested quantity, whole-kilogram weights, conversion,
  optional price, VAT, and notes;
- irreversible offline confirmation with stable transaction numbering,
  snapshotted business data, 58/80 mm Receipt and Delivery Authorization
  previews, and unified Load History; and
- a Reports area with a searchable project selector, explicit open action,
  Active/Completed Project lists, daily-report history,
  editable project-day work information, saved-dropdown and manual
  people/equipment presence,
  materials used or transported, site notes, working time, and read-only
  matching confirmed loads; and
- a separate Quarry Purchases workflow with reusable suppliers, searchable
  supplier/item/driver/truck selection, confirmed whole-m³ deliveries,
  optional USD pricing, universal VAT calculation, and purchase history; and
- persistent company-logo selection, camera/library attachments for project
  reports and quarry tickets, post-confirmation driver signature capture,
  58/80 mm Receipt and Delivery Authorization PDFs, project-report PDFs, and
  native iPhone/Android sharing; and
- offline Quick Text company documents with 58/80 mm fixed minimum page
  layouts, normal readable message sizing, live preview, searchable permanent
  history, direct printing, and PDF sharing; and
- a Payments & Balances area that combines priced loads, priced quarry
  purchases, and separate customer/supplier opening balances; records multiple
  partial in-person payments; derives remaining/status totals; preserves final
  reasoned cancellations; and shows real customer financial summaries; and
- project-linked Waste Dump Tracking with one-tap timestamped counting,
  optional material/location/truck/driver details, permanent reasoned
  cancellation, Daily Report/PDF inclusion, history, and completion summaries;
- full completed-project PDF generation with start-to-finish metrics, daily
  timeline, materials, loads, waste, working time, issues, appendices, and
  project photos;
- the first confirmed-load correction path for weights, requested quantity,
  price, destination, and notes with dependent recalculation and stable record
  identity/payments;
- confirmed quarry-purchase correction for quantity, driver, truck, supplier
  ticket, price, and notes, plus permanent reasoned cancellation blocked by
  active payments and excluded from financial selection; and
- automated domain tests.
- a complete single-tank Fuel Tracking slice with physical baselines, deliveries,
  equipment fills, cancellation-aware history, supplier pricing/VAT, and finance integration.
- the first Slice 8 business-report export increment: five offline XLSX report
  groups plus a Complete Analysis Workbook with stable raw identifiers, numeric
  fields, summaries, filterable/frozen headings, a Data Dictionary, and native sharing.

Physical printer adapters, remaining business-report charts/progress/localization,
individual daily-report Excel/photo export, and the remaining confirmed-load association
corrections remain subsequent work. Quarry Purchases remain operationally
separate from outgoing Load History while sharing the financial payment ledger.

## Run locally

Prerequisites: Node.js 22.13 or later and an Expo-compatible iPhone or Android
development environment.

```powershell
npm install
npm start
```

For iPhone previewing, connect the phone and computer to the same Wi-Fi,
open Expo Go, and scan the QR code printed by `npm start`. This SDK 54 target
is for the current development-preview workflow; the production toolchain can
be upgraded after device testing no longer depends on this Expo Go version.

Other useful commands:

```powershell
npm run typecheck
npm test
npm run android
npm run ios
```

## Architecture

- `src/domain`: framework-independent business types and validation.
- `src/data/database`: local schema and forward-only migrations.
- `src/data/repositories`: persistence interfaces and SQLite adapters.
- `src/ui`: mobile application shell and screens.
- `tests`: fast domain tests that do not require a simulator.
- `requirements`: authoritative elicited requirements and decisions.

Every local write in the implemented repository is committed together with a
`sync_outbox` entry. Firebase synchronization will consume this outbox in a
later slice while SQLite remains the immediate source of truth on the phone.

See [docs/architecture.md](docs/architecture.md) for implementation boundaries
and the planned sequence.
