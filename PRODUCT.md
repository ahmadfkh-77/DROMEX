# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

Both Android and iOS are configured (`app.json`: `com.dromex.management` on each) and share one custom design system with no per-OS visual differences beyond copy wording (e.g. `BackupRestoreScreen.tsx`, `BluetoothPrinterScreen.tsx` swap document-provider names, not layout or components). Android is the confirmed primary platform for native-affordance decisions: the accepted internal release artifact is an Android APK (`output/DROMEX-0.9.0-build12.apk`), and Bluetooth Classic receipt printing is explicitly Android-first (iOS support requires a not-yet-identified MFi/BLE printer protocol). iOS keeps its own OS guarantees (safe-area insets, Reduce Motion, edge-swipe back, Apple Files/iCloud backup flows) but is not the platform new native-pattern work is designed against first.

## Stack

Expo React Native (SDK 54), React 19, React Native 0.81, strict TypeScript. SQLite via `expo-sqlite` is the on-device source of truth; a config-gated Firebase cloud layer exists in code but is disabled until explicitly approved (see repository `CLAUDE.md`). Not a greenfield stack choice — inherited from the existing codebase.

## Users

The primary user is the owner-operator of a small asphalt/paving plant and construction business: one person who runs the business, is the sole application user for a given deployment (staff accounts are explicitly deferred), and uses the phone hands-on in the field as well as for admin work. They record the business's own paving projects, asphalt/aggregate sales to outside customers, incoming quarry-truck purchases, equipment/fuel, daily site activity, and payments.

DROMEX is designed to be used out in the field — by truck drivers, site staff, and the owner on-site — not only at a desk: expect bright sunlight glare, dust and dirt on the screen, gloved or imprecise hands, and one-handed operation, alongside ordinary indoor/office use for admin and reporting. (Confirmed in the init interview; the current design-system.md touch-target and contrast rules already lean this way but should keep being checked against it explicitly.)

A second, later-stage audience exists: other plant/construction businesses who would run their own single-admin instance of DROMEX (see Positioning). This does not change the per-instance user model above — each deployment still has one owner-operator as its user — but it means the "owner's business" identity (company name, logo, terminology, item categories) must stay data-driven and configurable rather than assumed to be this one company's.

## Product Purpose

DROMEX gives a plant/construction business owner one offline, phone-first system of record for everything a paper-and-memory operation currently tracks by hand: outgoing loads to customers and own projects, incoming supplier/quarry deliveries, projects and daily site reports, equipment and fuel, waste and wall/pavement consumption, payments and balances, and printable business documents (receipts, delivery authorizations, reports). Success is that the owner can trust the app as the complete, correctable, historically honest record of the business — replacing paper tickets and memory, without requiring connectivity, a second device, or IT support.

## Positioning

DROMEX's mechanism a cloud construction-management SaaS could not truthfully copy: it is fully offline-first on a single phone (SQLite is the source of truth; there is no server dependency for the core workflows), yet still produces the artifacts a business actually needs on paper and in spreadsheets — Bluetooth-printed receipts, PDFs, and audited Excel exports — and protects that data with password-encrypted, portable `.dromexbackup` files instead of trusting a vendor's cloud.

Confirmed direction (this init interview): while the current release is single-admin and built out of this specific asphalt/paving business's real workflow, DROMEX is intended to eventually become software other similar plant/construction businesses could run too — each on their own phone, their own single-admin instance, their own data. This is a future-direction fact, not a scope change to the current release: `CLAUDE.md` operating rule 5 (no multi-user/cloud sync without explicit approval) and `decisions.md` DEC-038 (version one has one user, the owner) still govern today's build. What it does change now is how new work should be framed: avoid hard-coding this one company's identity or vocabulary into anything but data (company profile/logo are already configurable per `CLAUDE.md`'s Company module — keep extending that pattern rather than assuming "the business" means one named company).

## Operating Context

- Construction/plant business workflow: outgoing company loads and receipts (direct or weighbridge quantity), incoming supplier/quarry deliveries, projects with daily reports (work, attendees, materials, loads, fuel, waste, issues, photos, PPE/safety), equipment and single-tank fuel ledger, waste dump tracking, wall and pavement material calculations, payments/balances, and backups — the full feature set is recorded in the repository's `CLAUDE.md` and `requirements/SRS.md`, which remain the authoritative product record for behavior detail.
- Real paper artifacts the app replaces or produces: supplier delivery tickets/invoices, printed receipts and delivery authorizations (Bluetooth thermal printing), PDFs, and Excel workbooks.
- Confirmed device/usage conditions: phone-first, used both on active job sites (sun glare, dust, gloves, one hand) and indoors for admin/reporting; must survive app restarts and work fully offline.
- Confirmed release process: versioned, signed Android APKs are the accepted internal artifact; builds/releases require explicit approval per `CLAUDE.md`.

## Capabilities and Constraints

- Offline-first by contract: every form must work with no network access; SQLite (WAL mode, foreign keys, forward-only migrations) is the source of truth on-device.
- Confirmed transactions (receipts, quarry/supplier purchases, payments) are corrected or cancelled with a reason, never silently rewritten — audit history is a product requirement, not an implementation detail.
- Deferred/gated by explicit approval: Firebase/cloud sync, web support, multi-user/staff accounts, hour-meter/odometer consumption alerts, a large CPM scheduling engine, electronic payment processing, APK builds/releases.
- Printing is native-only: Bluetooth Classic receipt printing works from the installed Android app, not a browser; a future web version (not currently in scope) would need a different printing path.
- Terminology is fixed by decision, not open to relabeling: "Customers" stays "Customers" even though project PDFs label the business itself "Contractor"; "Supplier Loads" is the incoming-delivery workflow (legacy DB naming may still say "quarry"); pricing choice is `Per Unit` or `As a Whole` under the single field label `Price`.
- Undecided/deferred by explicit product record: items in `requirements/open-questions.md` must not be guessed — ask the owner or propose a clearly isolated option when work touches them.

## Brand Commitments

- Product name: DROMEX. Package/bundle identifier `com.dromex.management`.
- Documented, binding visual identity in `docs/design-system.md` ("DROMEX Interface Standard"): warm-cream backgrounds, orange (`#C84B31`) as primary/brand-emphasis, navy (`#173F67`) for navigation/context, a fully custom component set (`AppPage`, `PageHeader`, `AppCard`, `AppButton`, `AppField`, `MetricCard`, `Feedback`, `EmptyState`) rather than platform-default (e.g. Material) components. This is a confirmed, pinned aesthetic — not a gap for future design work to fill or override with generic per-platform conventions.
- Company profile/logo are user-configurable data (upload company logo, edit company details), not hard-coded — consistent with the future multi-business-use direction above.

## Evidence on Hand

- Real, load-bearing product documentation exists and is authoritative: `requirements/SRS.md`, `requirements/decisions.md`, `requirements/elicitation-state.md`, `requirements/interview-transcript.md`, `requirements/open-questions.md`, and `docs/` (architecture, design-system, audit, setup, testing guides). Treat these as ground truth over inference.
- Real app icon/asset: `assets/dromex-icon.png`. No customer testimonials, case studies, press, or third-party benchmarks exist or should be fabricated — this is a single-business operational tool, not a marketed product with public proof points (yet).

## Product Principles

1. Never lose or silently alter a confirmed business record — correct, cancel, or replace with a reason and an audit trail; the app is the trusted paper-ticket replacement.
2. Work fully offline, on one phone, without depending on connectivity, a server, or another device to function.
3. Keep the business's own identity (name, logo, item categories, terminology) as configurable data, not hard-coded assumptions, so the same app can serve other plant/construction businesses later without a rewrite.
4. Match the real operating environment: phone-first, field-usable (glare, dust, gloves, one hand), not just desk-usable.
5. Preserve the confirmed `requirements/` record and existing workflows; extend rather than reinterpret or duplicate them.

## Accessibility & Inclusion

Confirmed in this init interview: design for outdoor/field-usage conditions — higher-contrast color choices, touch targets comfortable with gloves or imprecise taps, and legibility in direct sunlight — in addition to ordinary indoor/office use. No formal accessibility standard (e.g. WCAG level) has been established as a requirement; treat this as an open item rather than inventing a compliance target.
