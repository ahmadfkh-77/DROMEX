# DROMEX Android large-demo testing

## Readiness statement

DROMEX is ready for structured Android offline demonstration and acceptance
testing. It is not yet a final production release. Physical printer acceptance,
the 73,000-load long-term performance gate, a full operating-day/restart test,
the 30-day field pilot, complete Arabic RTL acceptance, and the currently
deferred Firebase/two-device checks remain release gates.

## Demo package

- File: `demo/DROMEX-Large-Linked-Demo.dromexbackup`
- Demo restore password: `DROMEX-DEMO-2026`
- Loads: 4,000 across 180 days
- Projects: 12 (9 Active and 3 Completed)
- Customers: 24 demo customers plus the demo company profile
- Additional linked data: 1,017 daily reports, 600 quarry purchases, 800 waste
  dumps, 2,283 payments, 160 schedule tasks, 60 issues, 91 fuel movements,
  suppliers, items, drivers, trucks, workers, machines, opening balances,
  Quick Text documents, signatures, drafts, and 104 attachment references.

This file replaces the phone's dataset; it never merges. Do not restore it over
real data until a separate real-data backup has been copied off the phone.

## 1. Prepare the Android phone

1. Use Android 10 or later. Android 12+, 6 GB RAM, and 128 GB storage are the
   recommended test baseline.
2. Install/open the current DROMEX Android build.
3. Install Google Drive and sign in, or copy the demo file into Downloads.
4. Copy `DROMEX-Large-Linked-Demo.dromexbackup` to that Drive/Downloads folder.
5. If the phone already contains important DROMEX data, open **Backup & Restore**,
   create a normal backup using a private password, and confirm the file is
   visible on a second device or in Drive before continuing.

## 2. Restore the large demo

1. Open **Home → Setup → Backup & Restore** or **More → Setup → Backup & Restore**.
2. Under **Select a backup to restore**, select the demo `.dromexbackup` file.
3. Enter `DROMEX-DEMO-2026` and press **Unlock & Preview**.
4. Verify the preview shows 4,000 loads, 12 projects, 2,283 payments, and the
   expected supporting counts.
5. In step 04, create a private safety-backup password of at least 12 characters.
   Do not use the public demo password if the current phone contains real data.
6. Press **Confirm, Choose Safety Folder & Replace**, read the replacement
   warning, and confirm.
7. Choose a Drive/Downloads folder for the automatic encrypted safety backup.
8. Wait for **Restore complete**, record the safety-backup filename, and open
   the restored DROMEX dataset.

Expected result: no merge or duplicates; the active-project bar selects the
Airport Service Road demo project; the Home dashboard and attention cards show
real values from the restored records.

## 3. Core workflow walkthrough

### Home and project workflow

1. Change dashboard periods: Today, 7 days, 30 days, and a custom open-ended
   range. Confirm every card changes consistently.
2. Open **Projects**, press an Active project name, and inspect its Command
   Center metrics, activity, reports, issues, photos, and documents.
3. Open a Completed project and confirm history is readable but new work is
   blocked until reactivation.
4. Change the active-project context and verify applicable Create workflows
   start with that project selected.

### Schedule and waste counters

1. Open Schedule and test Today, Week, 3 Weeks, and All.
2. Open a project schedule from its Command Center and verify every task belongs
   only to that project.
3. Move a demo task through Planned, In Progress, Blocked, and Completed.
4. Open Waste Dump Tracking, press one driver's counter three times and another
   driver's twice, and verify the counts remain separate.
5. Cancel the last trip and confirm the active count decreases while the
   Cancelled history record remains.

### Loads, customers, and finance

1. Open Load History; group by Project and then Customer.
2. Filter by date, customer, project, item, driver, and plate. Each result should
   appear within two seconds on the recommended phone.
3. Open signed and unsigned loads and inspect Receipt and Delivery Authorization
   previews. Generate/share both PDF widths.
4. Open Customers and verify projects, paid/partial/unpaid/unpriced loads,
   opening balances, payment entries, and remaining totals reconcile.
5. Create one new receipt offline, review its calculations, confirm it, restart
   DROMEX, and verify the same transaction number and record remain.

### Reports and supporting ledgers

1. Open project Reports and inspect people, equipment, materials, linked loads,
   waste, working time, issues, and photos.
2. Generate a Daily Report PDF, Completed Project PDF, one focused XLSX report,
   and the Complete Analysis Workbook.
3. Test Quarry Purchases, including project/supplier filtering and cancelled
   records.
4. Test Fuel Tracking history, current balance, deliveries, equipment fills,
   supplier costs, and payments.
5. Open Global Search and find a project, receipt number, customer, driver,
   schedule task, issue, and Quick Text document.
6. Open Needs Attention and verify its labels reach the relevant records.
7. Open Draft Center, continue the supplied Quick Text draft, move it to Trash,
   restore it, and save it.

## 4. Backup recovery test

1. While using demo data, create a new encrypted backup with a new private test
   password and save it to Google Drive.
2. Add a clearly named new schedule task and one waste trip after that backup.
3. Select the backup from step 1, deliberately enter a wrong password once, and
   verify no data changes.
4. Enter the correct password, review its counts, create a separate safety-copy
   password, and restore it.
5. Confirm the later schedule task and waste trip are absent, proving replacement
   rather than merge, while all backed-up records and attachments remain.
6. Confirm the pre-restore safety file is visible in Drive.

## 5. Return to real data

1. Select the private real-data backup created before the demo.
2. Enter its original password and verify its date and record counts.
3. Choose a new password and folder for the automatic demo-state safety copy.
4. Confirm replacement and then verify the company name, recent receipts,
   projects, photos, and totals.

Keep both safety files until the restored real data has been checked carefully.

## Test record

Record the phone model, Android version, available storage, DROMEX build, test
date, observed load/filter/export/backup timings, failures, screenshots, and
final pass/fail result. A successful demo is not the same as the confirmed final
release gates listed in the readiness statement.
