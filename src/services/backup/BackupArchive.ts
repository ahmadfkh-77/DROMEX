import * as FileSystem from 'expo-file-system/legacy';
import type {SQLiteDatabase} from 'expo-sqlite';
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';
import type {BackupPreview,BackupRecordCounts} from '../../domain/backup';
import {base64ToBytes} from './BackupCrypto';

export const BACKUP_ARCHIVE_FORMAT='DROMEX-COMPLETE-BACKUP';
export const BACKUP_ARCHIVE_VERSION=1;
export const DROMEX_APP_VERSION='0.7.0';

type MediaLocator={table:string;recordId:string;column:string;jsonIndex:number|null;archivePath:string};
export type BackupManifest={format:string;formatVersion:number;backupId:string;createdAt:string;appVersion:string;databaseVersion:number;recordCounts:BackupRecordCounts;preferenceCount:number;media:MediaLocator[]};
export type DecodedArchive={manifest:BackupManifest;databaseBytes:Uint8Array;preferences:Array<[string,string]>;files:Record<string,Uint8Array>};

const singleSpecs=[
  {table:'company_settings',column:'logo_uri'},
  {table:'loads',column:'company_logo_uri'},
  {table:'quick_text_documents',column:'company_logo_uri'},
  {table:'project_media',column:'uri'},
] as const;
const jsonSpecs=[
  {table:'daily_project_reports',column:'photos_json'},
  {table:'quarry_purchases',column:'photos_json'},
] as const;
const allowedLocator=new Set([...singleSpecs,...jsonSpecs].map(value=>`${value.table}.${value.column}`));
const countTables=['loads','projects','customers','daily_project_reports','quarry_purchases','waste_dumps','fuel_movements','payment_entries','schedule_tasks','pavement_calculations','walls','wall_consumptions','project_issues','project_media','quick_text_documents','suppliers','driver_profiles','truck_profiles','worker_profiles','machine_profiles','catalog_items'];

export async function createBackupArchive(db:SQLiteDatabase,preferences:Array<[string,string]>,backupId:string,createdAt:string):Promise<{bytes:Uint8Array;manifest:BackupManifest}>{
  await db.execAsync('PRAGMA wal_checkpoint(FULL)');
  const databaseVersion=(await db.getFirstAsync<{user_version:number}>('PRAGMA user_version'))?.user_version??0;
  const recordCounts=await collectCounts(db);
  const files:Record<string,Uint8Array>={'database.sqlite':await db.serializeAsync(),'preferences.json':strToU8(JSON.stringify(preferences))};
  const media:MediaLocator[]=[];
  const archivedByUri=new Map<string,string>();
  for(const spec of singleSpecs){
    const rows=await db.getAllAsync<{id:string;value:string|null}>(`SELECT id, ${spec.column} value FROM ${spec.table} WHERE ${spec.column} IS NOT NULL AND TRIM(${spec.column}) <> ''`);
    for(const row of rows){const uri=row.value?.trim();if(!uri)continue;const archivePath=await addMediaFile(files,archivedByUri,uri);media.push({table:spec.table,recordId:row.id,column:spec.column,jsonIndex:null,archivePath});}
  }
  for(const spec of jsonSpecs){
    const rows=await db.getAllAsync<{id:string;value:string}>(`SELECT id, ${spec.column} value FROM ${spec.table} WHERE ${spec.column} IS NOT NULL AND ${spec.column} <> '[]'`);
    for(const row of rows){for(const[index,uri]of parseUriArray(row.value).entries()){const archivePath=await addMediaFile(files,archivedByUri,uri);media.push({table:spec.table,recordId:row.id,column:spec.column,jsonIndex:index,archivePath});}}
  }
  const manifest:BackupManifest={format:BACKUP_ARCHIVE_FORMAT,formatVersion:BACKUP_ARCHIVE_VERSION,backupId,createdAt,appVersion:DROMEX_APP_VERSION,databaseVersion,recordCounts,preferenceCount:preferences.length,media};
  files['manifest.json']=strToU8(JSON.stringify(manifest));
  return{bytes:zipSync(files,{level:6}),manifest};
}

export function decodeBackupArchive(bytes:Uint8Array):DecodedArchive{
  let files:Record<string,Uint8Array>;
  try{files=unzipSync(bytes);}catch{throw new Error('The decrypted backup package is damaged or incomplete.');}
  const manifestBytes=files['manifest.json'],databaseBytes=files['database.sqlite'],preferenceBytes=files['preferences.json'];
  if(!manifestBytes||!databaseBytes||!preferenceBytes)throw new Error('The backup package is missing required data.');
  let manifest:BackupManifest,preferences:Array<[string,string]>;
  try{manifest=JSON.parse(strFromU8(manifestBytes)) as BackupManifest;preferences=JSON.parse(strFromU8(preferenceBytes)) as Array<[string,string]>;}catch{throw new Error('The backup manifest is damaged.');}
  validateManifest(manifest,files);
  if(strFromU8(databaseBytes.subarray(0,15))!=='SQLite format 3')throw new Error('The backup database is invalid.');
  if(!Array.isArray(preferences)||preferences.some(value=>!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||typeof value[1]!=='string'||!value[0].startsWith('dromex.')))throw new Error('The backup preferences are invalid.');
  return{manifest,databaseBytes,preferences,files};
}

export function previewFromManifest(manifest:BackupManifest,encryptedBytes:number):BackupPreview{return{backupId:manifest.backupId,createdAt:manifest.createdAt,appVersion:manifest.appVersion,databaseVersion:manifest.databaseVersion,recordCounts:manifest.recordCounts,mediaCount:new Set(manifest.media.map(value=>value.archivePath)).size,preferenceCount:manifest.preferenceCount,encryptedBytes};}

export async function materializeArchiveMedia(db:SQLiteDatabase,decoded:DecodedArchive):Promise<void>{
  if(!FileSystem.documentDirectory)throw new Error('Permanent app storage is unavailable.');
  const root=`${FileSystem.documentDirectory}restored-backups/${safe(decoded.manifest.backupId)}/`;
  await FileSystem.makeDirectoryAsync(root,{intermediates:true});
  const restored=new Map<string,string>();
  for(const locator of decoded.manifest.media){
    let uri=restored.get(locator.archivePath);
    if(!uri){const data=decoded.files[locator.archivePath];if(!data)throw new Error('A required backup attachment is missing.');const filename=locator.archivePath.split('/').pop()??'attachment.bin';uri=`${root}${safe(filename)}`;await FileSystem.writeAsStringAsync(uri,bytesToBase64Native(data),{encoding:FileSystem.EncodingType.Base64});restored.set(locator.archivePath,uri);}
    if(locator.jsonIndex===null)await db.runAsync(`UPDATE ${locator.table} SET ${locator.column}=? WHERE id=?`,uri,locator.recordId);
  }
  const groups=new Map<string,MediaLocator[]>();
  for(const locator of decoded.manifest.media.filter(value=>value.jsonIndex!==null)){const key=`${locator.table}|${locator.recordId}|${locator.column}`;groups.set(key,[...(groups.get(key)??[]),locator]);}
  for(const group of groups.values()){const first=group[0];if(!first)continue;const values=group.sort((a,b)=>(a.jsonIndex??0)-(b.jsonIndex??0)).map(value=>restored.get(value.archivePath)??'');await db.runAsync(`UPDATE ${first.table} SET ${first.column}=? WHERE id=?`,JSON.stringify(values),first.recordId);}
}

function validateManifest(manifest:BackupManifest,files:Record<string,Uint8Array>){
  if(manifest.format!==BACKUP_ARCHIVE_FORMAT||manifest.formatVersion!==BACKUP_ARCHIVE_VERSION)throw new Error('This backup format is not supported. Update DROMEX and try again.');
  if(!manifest.backupId||!Number.isFinite(Date.parse(manifest.createdAt))||!Number.isInteger(manifest.databaseVersion)||manifest.databaseVersion<1)throw new Error('The backup manifest is invalid.');
  if(!manifest.recordCounts||typeof manifest.recordCounts!=='object'||!Array.isArray(manifest.media))throw new Error('The backup manifest is invalid.');
  for(const locator of manifest.media){if(!allowedLocator.has(`${locator.table}.${locator.column}`)||!locator.recordId||!locator.archivePath.startsWith('media/')||!files[locator.archivePath]||(locator.jsonIndex!==null&&(!Number.isInteger(locator.jsonIndex)||locator.jsonIndex<0)))throw new Error('The backup attachment index is invalid.');}
}

async function collectCounts(db:SQLiteDatabase){const counts:BackupRecordCounts={};for(const table of countTables){const row=await db.getFirstAsync<{count:number}>(`SELECT COUNT(*) count FROM ${table}`);counts[table]=row?.count??0;}return counts;}

async function addMediaFile(files:Record<string,Uint8Array>,archivedByUri:Map<string,string>,uri:string){
  const existing=archivedByUri.get(uri);if(existing)return existing;
  if(uri.startsWith('cloud-storage://'))throw new Error('A cloud-only attachment must be downloaded before creating a complete backup.');
  const info=await FileSystem.getInfoAsync(uri);if(!info.exists||info.isDirectory)throw new Error(`A referenced attachment is missing: ${uri.split('/').pop()??'unknown file'}.`);
  const base64=await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64});
  const extension=(uri.split('.').pop()?.split('?')[0]??'bin').replace(/[^a-zA-Z0-9]/g,'').slice(0,8)||'bin';
  const archivePath=`media/${String(archivedByUri.size+1).padStart(5,'0')}.${extension.toLowerCase()}`;
  files[archivePath]=base64ToBytes(base64);archivedByUri.set(uri,archivePath);return archivePath;
}

function parseUriArray(value:string){try{const parsed=JSON.parse(value)as unknown;return Array.isArray(parsed)?parsed.filter(item=>typeof item==='string'&&item.trim()).map(item=>String(item)):[];}catch{throw new Error('A saved photo list is damaged and cannot be backed up.');}}
function safe(value:string){return value.replace(/[^a-zA-Z0-9_.-]/g,'_');}
function bytesToBase64Native(bytes:Uint8Array){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i]??0,b=bytes[i+1]??0,c=bytes[i+2]??0,n=(a<<16)|(b<<8)|c;result+=alphabet[(n>>18)&63]??'';result+=alphabet[(n>>12)&63]??'';result+=i+1<bytes.length?(alphabet[(n>>6)&63]??''):'=';result+=i+2<bytes.length?(alphabet[n&63]??''):'=';}return result;}
