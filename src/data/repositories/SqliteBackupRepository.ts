import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {backupDatabaseAsync,deserializeDatabaseAsync,type SQLiteDatabase} from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import {Platform} from 'react-native';
import type {BackupExportResult,BackupPreview,RestoreResult,SelectedBackup} from '../../domain/backup';
import {DATABASE_VERSION,migrateDatabase} from '../database/migrations';
import type {BackupRepository} from './BackupRepository';
import {createBackupArchive,decodeBackupArchive,materializeArchiveMedia,previewFromManifest,type DecodedArchive} from '../../services/backup/BackupArchive';
import {base64ToBytes,bytesToBase64,decryptBackupBytes,encryptBackupBytes,validateNewBackupPassword} from '../../services/backup/BackupCrypto';

type BuiltPackage={bytes:Uint8Array;filename:string;localUri:string;preview:BackupPreview};
type ValidatedPackage={decoded:DecodedArchive;database:SQLiteDatabase;preview:BackupPreview};

export class SqliteBackupRepository implements BackupRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async exportToSelectedFolder(password:string):Promise<BackupExportResult>{
    validateNewBackupPassword(password);
    const directory=Platform.OS==='android'?await chooseDestination():null;
    const built=await this.buildPackage(password,'Backup');
    const destinationUri=directory?await saveToDirectory(directory,built.filename,built.bytes):await shareToAppleFiles(built.localUri);
    return{filename:built.filename,localUri:built.localUri,destinationUri,preview:built.preview};
  }

  async selectBackup():Promise<SelectedBackup|null>{
    const result=await DocumentPicker.getDocumentAsync({type:['application/octet-stream','application/zip','*/*'],copyToCacheDirectory:true,multiple:false});
    if(result.canceled||!result.assets[0])return null;
    const asset=result.assets[0];return{uri:asset.uri,name:asset.name};
  }

  async inspectBackup(source:SelectedBackup,password:string):Promise<BackupPreview>{const validated=await this.loadValidated(source,password);try{return validated.preview;}finally{await validated.database.closeAsync();}}

  async restoreBackup(source:SelectedBackup,password:string,safetyPassword:string):Promise<RestoreResult>{
    validateNewBackupPassword(safetyPassword);
    const validated=await this.loadValidated(source,password);
    let safety:BuiltPackage|null=null;
    const currentBytes=await this.db.serializeAsync();
    const currentPreferences=await readPreferences();
    try{
      const safetyDirectory=Platform.OS==='android'?await chooseDestination():null;
      safety=await this.buildPackage(safetyPassword,'Safety-Before-Restore');
      const safetyDestinationUri=safetyDirectory?await saveToDirectory(safetyDirectory,safety.filename,safety.bytes):await shareToAppleFiles(safety.localUri);
      await materializeArchiveMedia(validated.database,validated.decoded);
      await assertDatabaseValid(validated.database);
      await backupDatabaseAsync({sourceDatabase:validated.database,destDatabase:this.db});
      await replacePreferences(validated.decoded.preferences);
      await this.db.execAsync('PRAGMA foreign_keys = ON; PRAGMA wal_checkpoint(FULL);');
      return{preview:validated.preview,safetyBackupFilename:safety.filename,safetyBackupLocalUri:safety.localUri,safetyBackupDestinationUri:safetyDestinationUri};
    }catch(cause){
      try{const rollback=await deserializeDatabaseAsync(currentBytes);try{await backupDatabaseAsync({sourceDatabase:rollback,destDatabase:this.db});await replacePreferences(currentPreferences);}finally{await rollback.closeAsync();}}catch{}
      throw cause;
    }finally{await validated.database.closeAsync();}
  }

  private async loadValidated(source:SelectedBackup,password:string):Promise<ValidatedPackage>{
    const encrypted=await readFileBytes(source.uri),plain=await decryptBackupBytes(encrypted,password),decoded=decodeBackupArchive(plain);
    if(decoded.manifest.databaseVersion>DATABASE_VERSION)throw new Error('This backup was created by a newer DROMEX version. Update the app first.');
    const database=await deserializeDatabaseAsync(decoded.databaseBytes);
    try{await assertDatabaseValid(database);if(decoded.manifest.databaseVersion<DATABASE_VERSION)await migrateDatabase(database);await assertDatabaseValid(database);return{decoded,database,preview:previewFromManifest(decoded.manifest,encrypted.length)};}catch(cause){await database.closeAsync();throw cause;}
  }

  private async buildPackage(password:string,label:string):Promise<BuiltPackage>{
    const backupId=Crypto.randomUUID(),createdAt=new Date().toISOString(),preferences=await readPreferences();
    const archive=await createBackupArchive(this.db,preferences,backupId,createdAt);
    const bytes=await encryptBackupBytes(archive.bytes,password,{randomBytes:size=>Crypto.getRandomBytes(size)});
    if(!FileSystem.documentDirectory)throw new Error('Permanent app storage is unavailable.');
    const directory=`${FileSystem.documentDirectory}backups/`;await FileSystem.makeDirectoryAsync(directory,{intermediates:true});
    const stamp=createdAt.replace(/[:.]/g,'-'),filename=`DROMEX-${label}-${stamp}.dromexbackup`,localUri=`${directory}${filename}`;
    await FileSystem.writeAsStringAsync(`${localUri}.partial`,bytesToBase64(bytes),{encoding:FileSystem.EncodingType.Base64});
    await FileSystem.deleteAsync(localUri,{idempotent:true});await FileSystem.moveAsync({from:`${localUri}.partial`,to:localUri});
    return{bytes,filename,localUri,preview:previewFromManifest(archive.manifest,bytes.length)};
  }
}

async function assertDatabaseValid(db:SQLiteDatabase){
  const integrity=await db.getFirstAsync<Record<string,string>>('PRAGMA integrity_check');if(!integrity||!Object.values(integrity).includes('ok'))throw new Error('The backup database failed its integrity check.');
  const foreignKeys=await db.getAllAsync<Record<string,unknown>>('PRAGMA foreign_key_check');if(foreignKeys.length)throw new Error('The backup contains broken record relationships.');
}

async function readPreferences():Promise<Array<[string,string]>>{const keys=(await Storage.getAllKeys()).filter(key=>key.startsWith('dromex.')).sort();const pairs=await Storage.multiGet(keys);return pairs.filter((value):value is [string,string]=>value[1]!==null).map(([key,value]):[string,string]=>[key,value]);}
async function replacePreferences(values:Array<[string,string]>){const current=(await Storage.getAllKeys()).filter(key=>key.startsWith('dromex.'));if(current.length)await Storage.multiRemove(current);if(values.length)await Storage.multiSet(values);}

async function chooseDestination(){if(!FileSystem.StorageAccessFramework)throw new Error('Folder selection is unavailable on this device.');const permission=await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();if(!permission.granted)throw new Error('No backup folder was selected. Nothing was changed.');return permission.directoryUri;}
async function saveToDirectory(directoryUri:string,filename:string,bytes:Uint8Array){const uri=await FileSystem.StorageAccessFramework.createFileAsync(directoryUri,filename,'application/octet-stream');await FileSystem.StorageAccessFramework.writeAsStringAsync(uri,bytesToBase64(bytes),{encoding:FileSystem.EncodingType.Base64});return uri;}
async function shareToAppleFiles(localUri:string){if(Platform.OS!=='ios')throw new Error('This backup destination is unavailable on this device.');if(!await Sharing.isAvailableAsync())throw new Error('Apple Files sharing is unavailable on this device.');await Sharing.shareAsync(localUri,{UTI:'public.data'});return localUri;}
async function readFileBytes(uri:string){try{return base64ToBytes(await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64}));}catch(cause){if(cause instanceof Error&&cause.message.includes('backup'))throw cause;throw new Error('DROMEX could not read the selected backup file.');}}
