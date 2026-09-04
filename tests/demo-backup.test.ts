import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {strFromU8,unzipSync} from 'fflate';
import {describe,expect,it} from 'vitest';
import {generateDemoBackup} from '../scripts/generate-demo-backup';
import {decryptBackupBytes} from '../src/services/backup/BackupCrypto';

describe('large linked demo backup generator',()=>{
  it('creates a decryptable, relationally valid complete-backup package',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'dromex-demo-test-')),output=join(directory,'demo.dromexbackup');
    try{
      const generated=await generateDemoBackup({output,password:'test-demo-password',loadCount:40,now:new Date('2026-08-21T12:00:00.000Z')});
      expect(generated.counts.loads).toBe(40);
      expect(generated.counts.projects).toBe(12);
      const decrypted=await decryptBackupBytes(Uint8Array.from(readFileSync(output)),'test-demo-password'),files=unzipSync(decrypted);
      expect(files['database.sqlite']?.[18]).toBe(1);
      expect(files['database.sqlite']?.[19]).toBe(1);
      const manifest=JSON.parse(strFromU8(files['manifest.json']!)) as {databaseVersion:number;recordCounts:Record<string,number>;media:unknown[]};
      expect(manifest.databaseVersion).toBe(30);
      expect(manifest.recordCounts).toMatchObject({loads:40,customers:25,projects:12,catalog_items:12,quarry_purchases:600,waste_dumps:800,pavement_calculations:96,walls:45,wall_consumptions:180});
      expect(manifest.media.length).toBe(104);
      const databasePath=join(directory,'restored.sqlite');writeFileSync(databasePath,files['database.sqlite']!);
      const db=new DatabaseSync(databasePath,{readOnly:true});
      try{
        expect(db.prepare('PRAGMA integrity_check').get()).toMatchObject({integrity_check:'ok'});
        expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
        expect(db.prepare('SELECT COUNT(*) count FROM loads l JOIN projects p ON p.id=l.project_id JOIN customers c ON c.id=p.customer_id').get()).toMatchObject({count:40});
        expect(db.prepare("SELECT COUNT(*) count FROM loads WHERE quantity_method='direct'").get()).toMatchObject({count:15});
        expect(db.prepare('SELECT COUNT(*) count FROM wall_consumptions wc JOIN walls w ON w.id=wc.wall_id JOIN projects p ON p.id=w.project_id').get()).toMatchObject({count:180});
      }finally{db.close();}
    }finally{rmSync(directory,{recursive:true,force:true});}
  },20_000);
});
