import {afterEach,describe,expect,it,vi} from 'vitest';
import {strToU8} from 'fflate';

const media=new Map<string,Uint8Array>();
vi.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///test/',getInfoAsync:async(uri:string)=>({exists:true,isDirectory:false,uri}),EncodingType:{Base64:'base64'}}));
vi.mock('../src/services/backup/BackupFiles',()=>({readBytes:async(uri:string)=>{const bytes=media.get(uri);if(!bytes)throw new Error('missing '+uri);return bytes;},writeBytes:async()=>undefined,saveToSafDirectory:async()=>'saf'}));

import {createBackupArchive,decodeBackupArchive} from '../src/services/backup/BackupArchive';
import {base64Length,base64ToBytes,bytesToBase64,decodeBase64From,decryptBackupBytes,encodeBase64Into,encryptBackupBytes} from '../src/services/backup/BackupCrypto';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * The backup is built and read as raw bytes: the same encrypted file format as before, but the payload is never turned into a giant
 * string, and photos are stored in the zip without compression. This is what lets a large backup finish instead of running out of memory.
 */
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&Buffer.from(a).equals(Buffer.from(b));
const random=(size:number)=>Uint8Array.from({length:size},(_,index)=>(index*17+size)%256);
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{media.clear();for(const database of databases.splice(0))database.close();});

describe('base64 straight to and from bytes',()=>{
  it('matches the text encoder for every length, padding included',()=>{
    for(let length=0;length<=40;length+=1){
      const bytes=Uint8Array.from({length},(_,index)=>(index*37+length*11)%256);
      const out=new Uint8Array(base64Length(length)+3);const end=encodeBase64Into(bytes,out,3);
      expect(end).toBe(3+base64Length(length));
      expect(new TextDecoder().decode(out.subarray(3,end))).toBe(bytesToBase64(bytes));
      if(length)expect(decodeBase64From(out,3,end)).toEqual(bytes);
    }
  });
  it('decodes what the text decoder wrote, a megabyte of it, quickly',()=>{
    const bytes=random(1_000_000);const text=strToU8(bytesToBase64(bytes));
    const started=Date.now();const decoded=decodeBase64From(text,0,text.length);const took=Date.now()-started;
    expect(same(decoded,bytes)).toBe(true);expect(took).toBeLessThan(1000);
    expect(same(base64ToBytes(bytesToBase64(bytes)),bytes)).toBe(true);
  });
  it('refuses anything that is not valid base64',()=>{
    for(const bad of ['abc','ab=d','a*cd','====','abcd=','']){const bytes=strToU8(bad);expect(()=>decodeBase64From(bytes,0,bytes.length)).toThrow('Invalid base64 data.');}
  });
});

describe('the encrypted envelope',()=>{
  it('is still the same JSON envelope, with the payload last, so older and newer builds read each other\'s files',async()=>{
    const encrypted=await encryptBackupBytes(strToU8('private DROMEX records'),'correct horse battery',{iterations:10_000,randomBytes:random});
    const envelope=JSON.parse(new TextDecoder().decode(encrypted)) as Record<string,unknown>;
    expect(Object.keys(envelope)).toEqual(['magic','formatVersion','kdf','iterations','salt','cipher','nonce','payload']);
    expect(envelope).toMatchObject({magic:'DROMEX-ENCRYPTED-BACKUP',formatVersion:1,kdf:'PBKDF2-HMAC-SHA256',iterations:10000,cipher:'AES-256-GCM'});
    expect(typeof envelope.payload).toBe('string');expect(base64ToBytes(envelope.payload as string).length).toBe('private DROMEX records'.length+16);
    expect(new TextDecoder().decode(await decryptBackupBytes(encrypted,'correct horse battery'))).toBe('private DROMEX records');
  });
  it('still opens an envelope written the old way, with the fields in another order and spaces between them',async()=>{
    const plain=random(5000);const encrypted=await encryptBackupBytes(plain,'correct horse battery',{iterations:10_000,randomBytes:random});
    const envelope=JSON.parse(new TextDecoder().decode(encrypted)) as Record<string,unknown>;
    const reordered=strToU8(JSON.stringify({payload:envelope.payload,...envelope},null,2));
    expect(same(await decryptBackupBytes(reordered,'correct horse battery'),plain)).toBe(true);
  });
  it('round-trips megabytes and still detects a changed byte or a wrong password',async()=>{
    const plain=random(2_000_000);
    const encrypted=await encryptBackupBytes(plain,'correct horse battery',{iterations:10_000,randomBytes:random});
    expect(same(await decryptBackupBytes(encrypted,'correct horse battery'),plain)).toBe(true);
    const tampered=encrypted.slice();tampered[tampered.length-40]=tampered[tampered.length-40]===65?66:65;
    await expect(decryptBackupBytes(tampered,'correct horse battery')).rejects.toThrow(/damaged|incorrect/);
    await expect(decryptBackupBytes(encrypted,'another long password')).rejects.toThrow('The backup password is incorrect');
    await expect(decryptBackupBytes(strToU8('not a backup'),'correct horse battery')).rejects.toThrow('not a valid DROMEX backup file');
  });
});

describe('the backup package',()=>{
  async function database(){
    const db=await migratedDatabaseWithProject(databases);
    db.raw.exec(`INSERT INTO company_settings (id,company_name,logo_uri,updated_at) VALUES ('company','DROMEX','file:///test/logo.png','${SEED_TIME}')`);
    return Object.assign(db,{serializeAsync:async()=>{const header=new Uint8Array(4096);header.set(strToU8('SQLite format 3'));return header;}});
  }
  it('stores a photo without compressing it and restores the same bytes',async()=>{
    const photo=new Uint8Array(1_000_000);media.set('file:///test/logo.png',photo);
    const archive=await createBackupArchive(await database() as never,[['dromex.test','1']],'backup-1','2026-10-11T10:00:00.000Z');
    expect(archive.bytes.length).toBeGreaterThan(990_000);
    const decoded=decodeBackupArchive(archive.bytes);
    expect(decoded.manifest.media).toHaveLength(1);expect(same(decoded.files[decoded.manifest.media[0]!.archivePath]!,photo)).toBe(true);
    expect(decoded.preferences).toEqual([['dromex.test','1']]);
  });
  it('goes through encryption and back as one package',async()=>{
    media.set('file:///test/logo.png',random(300_000));
    const archive=await createBackupArchive(await database() as never,[],'backup-2','2026-10-11T10:00:00.000Z');
    const encrypted=await encryptBackupBytes(archive.bytes,'correct horse battery',{iterations:10_000,randomBytes:random});
    const decoded=decodeBackupArchive(await decryptBackupBytes(encrypted,'correct horse battery'));
    expect(decoded.manifest.backupId).toBe('backup-2');expect(same(decoded.files[decoded.manifest.media[0]!.archivePath]!,random(300_000))).toBe(true);
  });
  it('reports a missing attachment instead of writing a package without it',async()=>{
    await expect(createBackupArchive(await database() as never,[],'backup-3','2026-10-11T10:00:00.000Z')).rejects.toThrow('missing');
  });
});
