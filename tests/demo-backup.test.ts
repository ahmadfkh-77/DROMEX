import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {strFromU8,unzipSync} from 'fflate';
import {describe,expect,it} from 'vitest';
import {generateDemoBackup} from '../scripts/generate-demo-backup';
import {DATABASE_VERSION} from '../src/data/database/migrations';
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
      expect(manifest.databaseVersion).toBe(DATABASE_VERSION);
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
        // DEC-417: the consulting_agencies table and the new columns on projects and
        // daily_project_reports are ordinary database content, so the whole-database backup format
        // needs no change to carry them -- confirmed here by restoring a real backup and reading them.
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='consulting_agencies'").get()).toMatchObject({name:'consulting_agencies'});
        const projectColumns=(db.prepare('PRAGMA table_info(projects)').all() as {name:string}[]).map(c=>c.name);
        expect(projectColumns).toContain('consulting_agency_id');
        const reportColumns=(db.prepare('PRAGMA table_info(daily_project_reports)').all() as {name:string}[]).map(c=>c.name);
        expect(reportColumns).toEqual(expect.arrayContaining(['consulting_agency_id','consulting_agency_name_en','consulting_agency_name_ar']));
        // Saved company sites and fill destinations are ordinary database content in the same way.
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_sites'").get()).toMatchObject({name:'company_sites'});
        const fuelColumns=(db.prepare('PRAGMA table_info(fuel_movements)').all() as {name:string}[]).map(c=>c.name);
        expect(fuelColumns).toEqual(expect.arrayContaining(['destination_type','company_site_id']));
      }finally{db.close();}
    }finally{rmSync(directory,{recursive:true,force:true});}
  },20_000);
});
