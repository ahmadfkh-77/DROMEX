export type BackupRecordCounts = Record<string, number>;

export type BackupPreview = {
  backupId: string;
  createdAt: string;
  appVersion: string;
  databaseVersion: number;
  recordCounts: BackupRecordCounts;
  mediaCount: number;
  preferenceCount: number;
  encryptedBytes: number;
};

export type SelectedBackup = {
  uri: string;
  name: string;
};

export type BackupExportResult = {
  filename: string;
  localUri: string;
  destinationUri: string;
  preview: BackupPreview;
};

export type RestoreResult = {
  preview: BackupPreview;
  safetyBackupFilename: string;
  safetyBackupLocalUri: string;
  safetyBackupDestinationUri: string;
};

