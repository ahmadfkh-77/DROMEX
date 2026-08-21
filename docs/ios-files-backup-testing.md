# iPhone Apple Files backup test

1. Open **Home → Setup → Backup & Restore**.
2. Enter and confirm a private password of at least 12 characters.
3. Press **Create & Save to Apple Files**.
4. In the Apple share sheet choose **Save to Files**.
5. Choose **iCloud Drive**, **On My iPhone**, connected USB storage, or another
   Files provider and press **Save**.
6. Open Apple Files independently and verify the `.dromexbackup` file is visible.
7. In DROMEX press **Select Backup File**, choose that file, enter its password,
   and press **Unlock & Preview**.
8. Verify its date and counts. Enter a new private password for the current-data
   safety copy and confirm replacement.
9. When Apple Files opens for that safety copy, save it before returning to
   DROMEX. Wait for the non-cancelable Restore Complete message.

The source password and safety-copy password may differ. DROMEX does not receive
or store the Apple ID password. A physical standalone iPhone build must still be
tested because Expo Go and an App Store/Ad Hoc build have different signing and
iCloud container ownership.
