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

/** Tables whose record counts a backup manifest and its restore preview show. Every name must exist in the current schema. */
export const BACKUP_COUNT_TABLES: readonly string[] = ['loads','projects','customers','daily_project_reports','quarry_purchases','waste_dumps','fuel_movements','payment_entries','schedule_tasks','pavement_calculations','walls','wall_consumptions','project_issues','project_media','quick_text_documents','suppliers','driver_profiles','truck_profiles','machine_profiles','catalog_items','custom_directories','custom_directory_entries','supervisors'];
