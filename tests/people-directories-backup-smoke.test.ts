import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteCustomDirectoryRepository} from '../src/data/repositories/SqliteCustomDirectoryRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {SqliteSupervisorRepository} from '../src/data/repositories/SqliteSupervisorRepository';
import {BACKUP_COUNT_TABLES} from '../src/domain/backup';
import {addCustomResourceEntry} from '../src/domain/customDirectories';
import {emptyLoadDraft} from '../src/domain/loads';
import {emptyDailyReport} from '../src/domain/projectReports';
import {addSupervisorSignoff} from '../src/domain/supervisors';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-476 to DEC-479 backup coverage. The real backup copies the whole SQLite file (expo-sqlite's
 * serialize/backup, the same operation as SQLite's VACUUM INTO used here), so people, roles, receipts,
 * directories, supervisors, signatures and every report snapshot travel with it -- no file attachments
 * are involved, because signatures are stroke data inside the database.
 */
const SIGNATURE=['M 20.0 80.5 L 60.2 40.0 L 110.1 90.4'];
const open:SqliteTestDatabase[]=[];
const files:string[]=[];
afterEach(()=>{for(const database of open.splice(0))database.close();for(const file of files.splice(0))fs.rmSync(file,{force:true});});

function copyOf(database:SqliteTestDatabase):SqliteTestDatabase{
  const file=path.join(os.tmpdir(),`dromex-backup-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);files.push(file);
  database.raw.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);
  const restored=new SqliteTestDatabase(file);open.push(restored);
  return restored;
}

describe('backup and restore of the People, directory and supervisor data',()=>{
  it('counts only tables that exist in the current schema, including the new ones',async()=>{
    const database=await migratedDatabaseWithProject(open);
    const tables=new Set(database.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>(row as {name:string}).name));
    for(const table of BACKUP_COUNT_TABLES)expect(tables.has(table),`${table} is counted but does not exist`).toBe(true);
    expect(BACKUP_COUNT_TABLES).toEqual(expect.arrayContaining(['driver_profiles','custom_directories','custom_directory_entries','supervisors']));
    expect(BACKUP_COUNT_TABLES).not.toContain('worker_profiles');
  });

  it('round-trips roles, receipt role snapshots, directories, supervisors, signatures and report snapshots',async()=>{
    const database=await migratedDatabaseWithProject(open);
    database.raw.exec(`
      INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
      INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
      INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,created_at,updated_at) VALUES ('sand','cat','Sand','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');
      INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}');
    `);
    const loads=new SqliteLoadRepository(database as never),reports=new SqliteProjectReportRepository(database as never);
    const directories=new SqliteCustomDirectoryRepository(database as never),supervisors=new SqliteSupervisorRepository(database as never);
    const rami=await loads.createPerson({name:'Rami Saad',role:'worker'});
    await loads.updatePerson(rami.id,{name:'Rami Saad',role:'operator'});
    const receipt=await loads.confirmLoad({...emptyLoadDraft,recordDate:'2026-08-20',customerId:'customer',projectId:'road',itemId:'sand',driverId:rami.id,driverName:'Rami Saad',truckId:'truck',truckPlate:'B123',quantityMethod:'direct',directQuantity:'12',directUnitId:'unit_ton'});
    const engineers=await directories.createDirectory({name:'Engineers'});
    const entry=await directories.createEntry(engineers.id,{name:'Nour Haddad',identifier:'ENG-1'});
    const nadim=await supervisors.saveSupervisorSignature((await supervisors.createSupervisor({name:'Nadim Aoun',jobTitle:'Resident Engineer'})).id,SIGNATURE);
    const saved=await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-20',workDescription:'Grading',operators:['Rami Saad'],
      customResources:addCustomResourceEntry([],engineers,entry,[engineers.id]),supervisorSignoffs:addSupervisorSignoff([],nadim,'name_with_signature')});

    const restored=copyOf(database);
    expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(restored.raw.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
    const restoredLoads=new SqliteLoadRepository(restored as never);
    expect((await restoredLoads.listPeople()).find(person=>person.id===rami.id)).toMatchObject({role:'operator',roleHistory:[{fromRole:'worker',toRole:'operator'}]});
    expect((await restoredLoads.listLoads()).find(load=>load.id===receipt.id)).toMatchObject({driverName:'Rami Saad',driverRole:'operator'});
    expect((await new SqliteCustomDirectoryRepository(restored as never).listEntries(engineers.id))[0]).toMatchObject({name:'Nour Haddad',identifier:'ENG-1'});
    expect((await new SqliteSupervisorRepository(restored as never).listSupervisors())[0]).toMatchObject({name:'Nadim Aoun',signature:SIGNATURE,signatureDamaged:false});
    const report=(await new SqliteProjectReportRepository(restored as never).listReports('road')).find(value=>value.id===saved.id)!;
    expect(report.operators).toEqual(['Rami Saad']);
    expect(report.customResources).toEqual(saved.customResources);
    expect(report.supervisorSignoffs).toEqual([{supervisorId:nadim.id,name:'Nadim Aoun',jobTitle:'Resident Engineer',display:'name_with_signature',signature:SIGNATURE}]);
  });

  it('upgrades a backup taken before these features: its workers join People with nothing lost',async()=>{
    const legacy=new SqliteTestDatabase();open.push(legacy);
    await migrateDatabase(legacy as never);
    // Put the copy into the exact version-45 shape a real pre-feature backup has.
    for(const [table,column] of [['driver_profiles','person_role'],['driver_profiles','job_title'],['driver_profiles','legacy_worker_id'],['driver_profiles','role_history_json'],['loads','driver_role'],['daily_project_reports','operators_json'],['daily_project_reports','custom_resources_json'],['daily_project_reports','supervisor_signoffs_json']] as const){
      if(table==='driver_profiles'&&column==='person_role')legacy.raw.exec('DROP INDEX IF EXISTS idx_people_role_active;');
      legacy.raw.exec(`ALTER TABLE ${table} DROP COLUMN ${column};`);
    }
    legacy.raw.exec(`DROP TABLE custom_directory_entries; DROP TABLE custom_directories; DROP TABLE supervisors;
      CREATE TABLE worker_profiles (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL COLLATE NOCASE UNIQUE,role TEXT,phone TEXT,notes TEXT,is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      INSERT INTO worker_profiles (id,name,role,phone,notes,is_active,created_at,updated_at) VALUES ('w1','Ali Mansour','Mason','71000000',NULL,1,'${SEED_TIME}','${SEED_TIME}');
      PRAGMA user_version = 45;`);
    const restored=copyOf(legacy);
    await migrateDatabase(restored as never);
    expect((restored.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect((await new SqliteLoadRepository(restored as never).listPeople())).toEqual([expect.objectContaining({id:'w1',name:'Ali Mansour',role:'worker',jobTitle:'Mason',phone:'71000000'})]);
  });
});
