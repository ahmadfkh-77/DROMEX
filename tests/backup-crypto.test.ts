import {describe,expect,it,vi} from 'vitest';
import {strToU8,zipSync} from 'fflate';

vi.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///test/'}));

import {BACKUP_ARCHIVE_FORMAT,BACKUP_ARCHIVE_VERSION,decodeBackupArchive,previewFromManifest,type BackupManifest} from '../src/services/backup/BackupArchive';
import {base64ToBytes,bytesToBase64,decryptBackupBytes,encryptBackupBytes,validateNewBackupPassword} from '../src/services/backup/BackupCrypto';

const random=(size:number)=>Uint8Array.from({length:size},(_,index)=>(index*17+size)%256);

describe('encrypted complete backup format',()=>{
  it('round-trips arbitrary database and attachment bytes through AES-GCM',async()=>{const plain=Uint8Array.from({length:2048},(_,index)=>index%251);const encrypted=await encryptBackupBytes(plain,'correct horse battery',{iterations:10_000,randomBytes:random});expect(encrypted).not.toEqual(plain);await expect(decryptBackupBytes(encrypted,'correct horse battery')).resolves.toEqual(plain);});

  it('rejects an incorrect backup password without returning plaintext',async()=>{const encrypted=await encryptBackupBytes(strToU8('private DROMEX records'),'correct horse battery',{iterations:10_000,randomBytes:random});await expect(decryptBackupBytes(encrypted,'incorrect password value')).rejects.toThrow('incorrect');});

  it('detects authenticated ciphertext tampering',async()=>{const encrypted=await encryptBackupBytes(strToU8('complete backup'),'correct horse battery',{iterations:10_000,randomBytes:random});const envelope=JSON.parse(new TextDecoder().decode(encrypted))as{payload:string};const position=Math.max(2,envelope.payload.length-3);envelope.payload=`${envelope.payload.slice(0,position)}${envelope.payload[position]==='A'?'B':'A'}${envelope.payload.slice(position+1)}`;await expect(decryptBackupBytes(strToU8(JSON.stringify(envelope)),'correct horse battery')).rejects.toThrow(/incorrect|damaged/);});

  it('preserves binary data through the portable base64 encoding',()=>{const bytes=Uint8Array.from([0,1,2,3,127,128,254,255]);expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);});

  it('requires a separate backup password of at least 12 characters',()=>{expect(()=>validateNewBackupPassword('too-short')).toThrow('12 characters');expect(()=>validateNewBackupPassword('long-enough-password')).not.toThrow();});

  // DEC-389: the ministry logo is a media-bearing column, so it must be inside the backup
  // allow-list. Without it the file is silently dropped and restore leaves a dead URI behind.
  it('accepts a ministry logo media locator and rejects a column outside the allow-list',()=>{
    const header=new Uint8Array(100);header.set(strToU8('SQLite format 3'));
    const build=(column:string)=>{
      const manifest:BackupManifest={format:BACKUP_ARCHIVE_FORMAT,formatVersion:BACKUP_ARCHIVE_VERSION,backupId:'backup-ministry',createdAt:'2026-09-05T10:00:00.000Z',appVersion:'0.9.0',databaseVersion:31,recordCounts:{},preferenceCount:0,media:[{table:'company_settings',recordId:'company',column,jsonIndex:null,archivePath:'media/ministry.png'}]};
      return zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'database.sqlite':header,'preferences.json':strToU8(JSON.stringify([])),'media/ministry.png':Uint8Array.from([1,2,3])});
    };
    const archive=decodeBackupArchive(build('ministry_logo_uri'));
    expect(archive.manifest.media).toHaveLength(1);
    expect(archive.manifest.media[0]).toMatchObject({table:'company_settings',column:'ministry_logo_uri',recordId:'company'});
    // Control: an unlisted column must still be refused, so the assertion above is meaningful.
    expect(()=>decodeBackupArchive(build('some_other_uri'))).toThrow();
  });

  it('validates the inner manifest and produces the restore preview',()=>{const manifest:BackupManifest={format:BACKUP_ARCHIVE_FORMAT,formatVersion:BACKUP_ARCHIVE_VERSION,backupId:'backup-1',createdAt:'2026-08-21T10:00:00.000Z',appVersion:'0.1.0',databaseVersion:19,recordCounts:{loads:4,projects:2},preferenceCount:3,media:[]};const header=new Uint8Array(100);header.set(strToU8('SQLite format 3'));const archive=decodeBackupArchive(zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'database.sqlite':header,'preferences.json':strToU8(JSON.stringify([['dromex.test','value']]))}));expect(previewFromManifest(archive.manifest,2048)).toMatchObject({backupId:'backup-1',databaseVersion:19,recordCounts:{loads:4,projects:2},preferenceCount:3,encryptedBytes:2048});});
});
