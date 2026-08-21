# DROMEX Firebase production setup

DROMEX remains local-first. Firebase receives verified-owner synchronization copies; it is never the immediate database used by field forms.

## Business-owned project

1. Create the Firebase/Google Cloud project under the business account and attach business billing.
2. Enable Authentication → Email/Password. Create only the owner account in the Firebase console and use a password of at least 12 characters. Do not enable public in-app registration.
3. Enable Cloud Firestore and Cloud Storage in the preferred production region.
4. Copy `.env.example` to `.env` and add the web-app API key, project ID, and storage bucket. These are public client identifiers; never place a service-account JSON key in the app.
5. Deploy `firestore.rules`, `storage.rules`, and the function through the Firebase CLI.
6. Install Firebase's Trigger Email extension on the `mail` collection so the trusted `notifyOwnerOfNewDevice` function sends the new-device warning.
7. Customize Firebase's verification and password-reset email templates. Firebase automatically revokes existing refresh tokens after a password reset.
8. Configure monthly budget alerts, abnormal-usage monitoring, and production App Check before launch.

## Deployment

```powershell
npm install --prefix firebase/functions
npm run build --prefix firebase/functions
firebase use <business-project-id>
firebase deploy --only firestore:rules,storage,functions
```

Build the app only after the `.env` identifiers are present. The Account & Cloud screen will explicitly report an unconfigured build otherwise.

## Required acceptance test

Use two physical phones and the production Firebase project:

1. Sign in and verify the owner email on phone A.
2. Work offline and create representative records with photos, payments, issues, reports, and documents.
3. Confirm the pending count survives restart, then reconnect and wait for it to reach zero.
4. Install DROMEX on phone B and sign in with the same verified owner account.
5. Confirm all synchronized rows, relationships, photos, and financial totals appear and the new-device email is received.
6. Edit the same correctable record offline on both phones; reconnect newest last and verify newest-edit-wins.
7. Reset the password and verify the previous sessions require the new password when they reconnect.

Never claim recovery of work that existed only on a permanently lost offline phone.
