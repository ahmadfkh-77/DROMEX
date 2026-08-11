# DROMEX Architecture

## Direction

DROMEX is a local-first Expo React Native application. The device database is
the immediate source of truth, so core work does not wait for network access.
Firebase is a synchronization and recovery destination, not the primary write
path used by the UI.

## Dependency direction

```text
UI -> repository interface -> SQLite adapter -> SQLite
                           -> sync outbox -> future Firebase worker
```

Domain validation has no Expo, React Native, SQLite, Firebase, or printer
dependency. This keeps calculations and record rules testable without a phone.

## Local persistence

Database migrations use `PRAGMA user_version`. The current schema creates:

- `categories`;
- `catalog_items`; and
- `sync_outbox`.

Later migrations add customer/company settings, measurement units,
conversions, projects, the autosaved load draft, device-local numbering, and
confirmed load snapshots. Schema version 4 adds reusable driver/truck profiles
and their load references while confirmed records retain driver-name and plate
snapshots. Schema version 5 adds unique per-project/work-date daily reports,
including structured presence/material JSON, site notes, optional working time,
and created/updated timestamps. Schema version 6 adds supplier profiles,
confirmed quarry purchases, separate quarry numbering, financial/VAT snapshots,
and purchase history indexes.
Schema version 7 adds persistent signature paths, per-load logo snapshots, and
offline photo collections for daily reports and quarry tickets.
Schema version 8 adds reusable worker and machine profiles for daily-report
dropdown selection while retaining temporary manual presence entries.
Schema version 9 adds customer/supplier opening balances and one-target payment
entries with active/cancelled lifecycle, cancellation evidence, and indexes for
load, quarry-purchase, and opening-balance histories.
Schema version 10 adds project/date-indexed individual waste-dump records with
optional field detail and permanent Active/Cancelled lifecycle evidence.

SQLite runs with foreign keys enabled and WAL journaling. Catalog writes and
their corresponding outbox entry execute in the same transaction, preventing a
locally saved business change from being omitted from later synchronization.

## Boundaries not yet implemented

- Firebase Authentication, Firestore, Storage, and outbox processing;
- supplier/profile and project/unit/conversion lifecycle refinements;
- fuel, Excel/business-report exports, and confirmed-record correction;
- Bluetooth and built-in Xprinter adapters.

Printer code must remain behind an adapter because supported models are defined
by physical acceptance testing rather than assumed generic compatibility.

## Implemented load vertical path

The current load vertical path includes:

1. customers, projects, units, and conversions in SQLite;
2. autosaved load draft and validation;
3. net-weight, conversion, VAT, and total calculations as pure domain code;
4. review and irreversible confirmation transaction;
5. live 58 mm and 80 mm document previews; and
6. unified Load History.

Supplier-payment entries, confirmed-record correction, and physical printer
adapters remain subsequent integrations behind their defined boundaries.

## Document and media path

Company logos and record photos are copied into app-owned document storage.
Signature strokes are stored as scalable paths and appear only on the Delivery
Authorization. Receipt and authorization HTML templates produce selectable
58/80 mm PDFs, while daily-report A4 PDFs include all report sections, linked
loads, and attached photos. Generated PDFs are retained under app-owned exports
and handed to the native share sheet. Physical printing remains an adapter
boundary until the target printer protocols are identified and tested.

## Implemented quarry-purchase vertical path

Quarry Purchases are stored separately from outgoing loads and do not change
inventory. The current path creates reusable supplier profiles, selects active
quarry-enabled catalog items and saved driver/truck profiles, requires a
positive whole-m³ quantity, and optionally calculates price per m³, subtotal,
the universal Company-profile VAT rate, and final USD total. Confirmation
snapshots identifying and financial data, advances a device-local quarry
number, writes the synchronization outbox, and exposes purchase history.

## Implemented project-report vertical path

Reports now lists active and completed projects, opens each project's report
history, and allows new reports only for active projects. A saved daily report
contains the required work date and description plus optional people,
equipment, materials, notes, issues, site conditions, working time, and next
work. Confirmed loads are queried by project and plant-local work date and are
shown read-only; they are not copied into the report. Photo capture and PDF
export are implemented. Excel exports remain a later integration.
