# DROMEX large linked demo

Generate the encrypted Android restore file with:

```powershell
npm run demo:backup
```

Output: `demo/DROMEX-Large-Linked-Demo.dromexbackup`

Demo password: `DROMEX-DEMO-2026`

This is deliberately not a production-app data generator. On Android, select it
through the system document picker; on iPhone, select it through Apple Files. Restoring the file
fully replaces the current phone dataset after DROMEX first saves an encrypted
safety backup. Restore that safety backup to return to the prior data.

The standard dataset contains 4,000 linked loads across 180 days, 24 customers,
12 projects, suppliers, catalog items, people and equipment, more than 1,000
daily reports, quarry purchases, waste trips and counters, schedule tasks,
issues, fuel movements, opening balances, payment histories, Quick Text
documents, signatures, drafts, and representative attachments.
