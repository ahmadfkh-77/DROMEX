import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';

/**
 * Migration 46 (DEC-476 to DEC-481). Unified People roles, Driver/Operator receipt role snapshots,
 * custom resource directories, saved supervisors, and the three Daily Report snapshot columns.
 *
 * A real version-45 database cannot be produced by the forward-only runner, so the upgrade path is
 * reproduced the way every other migration test in this suite does it: run the chain, put the
 * version-45 shape back exactly (worker_profiles with its original DDL and real rows), roll
 * PRAGMA user_version back to 45, and migrate again.
 */
class TestDatabase{
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  close(){this.raw.close();}
}

const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const NOW='2026-09-01T08:00:00.000Z';

const tables=(db:TestDatabase)=>db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>(row as {name:string}).name);
const columns=(db:TestDatabase,table:string)=>db.raw.prepare(`PRAGMA table_info(${table})`).all().map(row=>(row as {name:string}).name);
const version=(db:TestDatabase)=>(db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;

async function fresh(){const db=new TestDatabase();databases.push(db);await migrateDatabase(db as never);return db;}

/** The exact worker_profiles table migration 8 created, recreated so the v45 -> v46 step meets it. */
const V45_WORKER_PROFILES=`
  CREATE TABLE worker_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    role TEXT,
    phone TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_worker_profiles_active_name ON worker_profiles(is_active, name COLLATE NOCASE);`;

/** A realistic version-45 installation: two drivers (one referenced by a receipt, a supplier load and
 * a waste dump), three workers (one inactive, one whose id collides with a driver id), and a Daily
 * Report that names them. */
/** Removes everything migration 46 adds, so the database is back in its exact version-45 shape. */
function revertToVersion45Shape(db:TestDatabase){
  const drop=(table:string,column:string)=>{if(columns(db,table).includes(column))db.raw.exec(`ALTER TABLE ${table} DROP COLUMN ${column};`);};
  db.raw.exec('DROP INDEX IF EXISTS idx_people_role_active; DROP TABLE IF EXISTS custom_directory_entries; DROP TABLE IF EXISTS custom_directories; DROP TABLE IF EXISTS supervisors;');
  for(const column of ['person_role','job_title','legacy_worker_id','role_history_json'])drop('driver_profiles',column);
  drop('loads','driver_role');
  for(const column of ['operators_json','custom_resources_json','supervisor_signoffs_json'])drop('daily_project_reports',column);
  if(!tables(db).includes('worker_profiles'))db.raw.exec(V45_WORKER_PROFILES);
}

async function atVersion45(){
  const db=await fresh();
  revertToVersion45Shape(db);
  db.raw.exec(`
    DELETE FROM driver_profiles;
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived,start_date) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0,'2026-08-01');
    INSERT INTO driver_profiles (id,name,phone,license_number,notes,is_active,created_at,updated_at) VALUES
      ('driver_omar','Omar Haddad','70111111','L-77','Night shift',1,'2026-01-02T00:00:00.000Z','2026-02-02T00:00:00.000Z'),
      ('shared_id','Karim Driver',NULL,NULL,NULL,0,'2026-01-03T00:00:00.000Z','2026-01-03T00:00:00.000Z');
    INSERT INTO worker_profiles (id,name,role,phone,notes,is_active,created_at,updated_at) VALUES
      ('worker_ali','Ali Mansour','Steel fixer','71000000','Reliable','1','2026-03-01T00:00:00.000Z','2026-03-05T00:00:00.000Z'),
      ('worker_old','Sami Old',NULL,NULL,NULL,0,'2025-12-01T00:00:00.000Z','2025-12-02T00:00:00.000Z'),
      ('shared_id','Hassan Worker','Mason',NULL,NULL,1,'2026-04-01T00:00:00.000Z','2026-04-01T00:00:00.000Z');
    INSERT INTO daily_project_reports (id,project_id,work_date,work_description,workers_json,safety_json,drivers_json,truck_plates_json,machines_json,materials_json,photos_json,created_at,updated_at)
      VALUES ('report_1','road','2026-08-20','Excavation','["Ali Mansour","Hassan Worker"]','[{"workerName":"Omar Haddad","participantType":"driver","status":"compliant","missingItems":[],"notes":""}]','["Omar Haddad"]','[]','[]','[]','[]','${NOW}','${NOW}');
    PRAGMA user_version = 45;
  `);
  return db;
}

describe('migration 46 on a fresh installation',()=>{
  it('reaches the current version with the unified people columns and the new tables',async()=>{
    const db=await fresh();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(46);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(tables(db)).not.toContain('worker_profiles');
    expect(tables(db)).toEqual(expect.arrayContaining(['driver_profiles','custom_directories','custom_directory_entries','supervisors']));
    expect(columns(db,'driver_profiles')).toEqual(expect.arrayContaining(['person_role','job_title','legacy_worker_id','role_history_json']));
    expect(columns(db,'loads')).toContain('driver_role');
    expect(columns(db,'daily_project_reports')).toEqual(expect.arrayContaining(['operators_json','custom_resources_json','supervisor_signoffs_json']));
    expect(columns(db,'custom_directories')).toEqual(expect.arrayContaining(['id','name','name_key','description','display_order','is_active','created_at','updated_at']));
    expect(columns(db,'custom_directory_entries')).toEqual(expect.arrayContaining(['id','directory_id','name','name_key','identifier','notes','display_order','is_active','created_at','updated_at']));
    expect(columns(db,'supervisors')).toEqual(expect.arrayContaining(['id','name','name_key','job_title','signature_json','signature_updated_at','display_order','is_active','created_at','updated_at']));
  });

  it('constrains the role to worker, driver or operator and defaults a legacy row to driver',async()=>{
    const db=await fresh();
    db.raw.exec(`INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at) VALUES ('d','Legacy insert',1,'${NOW}','${NOW}')`);
    expect(db.raw.prepare("SELECT person_role,role_history_json FROM driver_profiles WHERE id='d'").get()).toMatchObject({person_role:'driver',role_history_json:'[]'});
    expect(()=>db.raw.exec(`INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('x','Bad',1,'${NOW}','${NOW}','foreman')`)).toThrow();
    expect(()=>db.raw.exec(`UPDATE loads SET driver_role='worker'`)).not.toThrow();
  });

  it('enforces unique normalized names for directories, for entries within one directory, and for supervisors',async()=>{
    const db=await fresh();
    db.raw.exec(`INSERT INTO custom_directories (id,name,name_key,created_at,updated_at) VALUES ('a','Engineers','engineers','${NOW}','${NOW}'),('b','Pickups','pickups','${NOW}','${NOW}')`);
    expect(()=>db.raw.exec(`INSERT INTO custom_directories (id,name,name_key,created_at,updated_at) VALUES ('c','ENGINEERS','engineers','${NOW}','${NOW}')`)).toThrow();
    db.raw.exec(`INSERT INTO custom_directory_entries (id,directory_id,name,name_key,created_at,updated_at) VALUES ('e1','a','Rami','rami','${NOW}','${NOW}'),('e2','b','Rami','rami','${NOW}','${NOW}')`);
    expect(()=>db.raw.exec(`INSERT INTO custom_directory_entries (id,directory_id,name,name_key,created_at,updated_at) VALUES ('e3','a','rami','rami','${NOW}','${NOW}')`)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO custom_directory_entries (id,directory_id,name,name_key,created_at,updated_at) VALUES ('e4','missing','X','x','${NOW}','${NOW}')`)).toThrow();
    db.raw.exec(`INSERT INTO supervisors (id,name,name_key,created_at,updated_at) VALUES ('s1','Nadim Aoun','nadim aoun','${NOW}','${NOW}')`);
    expect(()=>db.raw.exec(`INSERT INTO supervisors (id,name,name_key,created_at,updated_at) VALUES ('s2','NADIM AOUN','nadim aoun','${NOW}','${NOW}')`)).toThrow();
  });
});

describe('migration 46 upgrading a version-45 installation',()=>{
  it('moves every worker into the people table with its id, fields, active state and timestamps preserved',async()=>{
    const db=await atVersion45();
    await migrateDatabase(db as never);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(tables(db)).not.toContain('worker_profiles');
    const people=db.raw.prepare('SELECT id,name,phone,license_number,notes,is_active,created_at,updated_at,person_role,job_title,legacy_worker_id FROM driver_profiles ORDER BY id').all();
    expect(people).toEqual([
      {id:'driver_omar',name:'Omar Haddad',phone:'70111111',license_number:'L-77',notes:'Night shift',is_active:1,created_at:'2026-01-02T00:00:00.000Z',updated_at:'2026-02-02T00:00:00.000Z',person_role:'driver',job_title:null,legacy_worker_id:null},
      {id:'person_from_worker_shared_id',name:'Hassan Worker',phone:null,license_number:null,notes:null,is_active:1,created_at:'2026-04-01T00:00:00.000Z',updated_at:'2026-04-01T00:00:00.000Z',person_role:'worker',job_title:'Mason',legacy_worker_id:'shared_id'},
      {id:'shared_id',name:'Karim Driver',phone:null,license_number:null,notes:null,is_active:0,created_at:'2026-01-03T00:00:00.000Z',updated_at:'2026-01-03T00:00:00.000Z',person_role:'driver',job_title:null,legacy_worker_id:null},
      {id:'worker_ali',name:'Ali Mansour',phone:'71000000',license_number:null,notes:'Reliable',is_active:1,created_at:'2026-03-01T00:00:00.000Z',updated_at:'2026-03-05T00:00:00.000Z',person_role:'worker',job_title:'Steel fixer',legacy_worker_id:'worker_ali'},
      {id:'worker_old',name:'Sami Old',phone:null,license_number:null,notes:null,is_active:0,created_at:'2025-12-01T00:00:00.000Z',updated_at:'2025-12-02T00:00:00.000Z',person_role:'worker',job_title:null,legacy_worker_id:'worker_old'},
    ]);
  });

  it('keeps every driver reference valid and leaves historical reports and receipts byte-for-byte unchanged',async()=>{
    const db=await atVersion45();
    const now=NOW;
    db.raw.exec(`
      INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('supplier','Stone Quarry',1,'${now}','${now}');
      INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','ABC-1',1,'${now}','${now}');
      INSERT INTO waste_dumps (id,project_id,work_date,dumped_at,truck_profile_id,truck_plate,driver_profile_id,driver_name,created_at,updated_at) VALUES ('dump','road','2026-08-20','${now}','truck','ABC-1','driver_omar','Omar Haddad','${now}','${now}');
      INSERT INTO waste_counter_presets (id,project_id,driver_profile_id,truck_profile_id,created_at,updated_at) VALUES ('counter','road','driver_omar','truck','${now}','${now}');
    `);
    const reportBefore=db.raw.prepare("SELECT * FROM daily_project_reports WHERE id='report_1'").get() as Record<string,unknown>;
    await migrateDatabase(db as never);
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.raw.prepare("SELECT d.name,d.person_role FROM waste_dumps w JOIN driver_profiles d ON d.id=w.driver_profile_id").get()).toEqual({name:'Omar Haddad',person_role:'driver'});
    expect(db.raw.prepare("SELECT d.name FROM waste_counter_presets c JOIN driver_profiles d ON d.id=c.driver_profile_id").get()).toEqual({name:'Omar Haddad'});
    const reportAfter=db.raw.prepare("SELECT * FROM daily_project_reports WHERE id='report_1'").get() as Record<string,unknown>;
    for(const [key,value] of Object.entries(reportBefore))expect(reportAfter[key]).toEqual(value);
    expect(reportAfter).toMatchObject({operators_json:'[]',custom_resources_json:'[]',supervisor_signoffs_json:'[]'});
  });

  it('leaves the role of every pre-existing receipt as not recorded rather than inventing one',async()=>{
    const db=await atVersion45();
    await migrateDatabase(db as never);
    expect(db.raw.prepare("SELECT COUNT(*) count FROM loads WHERE driver_role IS NOT NULL").get()).toEqual({count:0});
  });

  it('is replay-safe: re-running from 45 neither duplicates nor loses anyone',async()=>{
    const db=await atVersion45();
    await migrateDatabase(db as never);
    const first=db.raw.prepare('SELECT id,person_role,job_title FROM driver_profiles ORDER BY id').all();
    db.raw.exec('PRAGMA user_version = 45;');
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT id,person_role,job_title FROM driver_profiles ORDER BY id').all()).toEqual(first);
    expect(version(db)).toBe(DATABASE_VERSION);
  });

  it('completes an interrupted move: rows copied before the interruption are not copied twice',async()=>{
    const db=await atVersion45();
    // Simulates a device that lost power after migration 46 added its columns and copied one worker,
    // but before the verified drop of worker_profiles.
    db.raw.exec(`
      ALTER TABLE driver_profiles ADD COLUMN person_role TEXT NOT NULL DEFAULT 'driver' CHECK (person_role IN ('worker','driver','operator'));
      ALTER TABLE driver_profiles ADD COLUMN job_title TEXT;
      ALTER TABLE driver_profiles ADD COLUMN legacy_worker_id TEXT;
      INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role,job_title,legacy_worker_id) VALUES ('worker_ali','Ali Mansour',1,'${NOW}','${NOW}','worker','Steel fixer','worker_ali');
    `);
    await migrateDatabase(db as never);
    expect(db.raw.prepare("SELECT COUNT(*) count FROM driver_profiles WHERE legacy_worker_id='worker_ali'").get()).toEqual({count:1});
    expect(db.raw.prepare("SELECT COUNT(*) count FROM driver_profiles WHERE person_role='worker'").get()).toEqual({count:3});
    expect(tables(db)).not.toContain('worker_profiles');
  });

  it('emits the version 46 step through execAsync and getFirstAsync alone, as minimal adapters migrate',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:45})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS custom_directories'))).toBe(true);
    expect(statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS supervisors'))).toBe(true);
    expect(statements.some(sql=>sql.includes('ADD COLUMN person_role'))).toBe(true);
    expect(statements.at(-1)).toBe(`PRAGMA user_version = ${DATABASE_VERSION}`);
  });
});
