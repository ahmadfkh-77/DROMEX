import type {BackupExportResult,BackupPreview,RestoreResult,SelectedBackup} from '../../domain/backup';

export interface BackupRepository {
  exportToSelectedFolder(password:string):Promise<BackupExportResult>;
  selectBackup():Promise<SelectedBackup|null>;
  inspectBackup(source:SelectedBackup,password:string):Promise<BackupPreview>;
  restoreBackup(source:SelectedBackup,password:string,safetyPassword:string):Promise<RestoreResult>;
}
