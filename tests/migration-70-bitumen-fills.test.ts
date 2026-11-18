import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/** Migration 70 (DEC-557). Bitumen fills are new tables only: every batch, use row, closure and adjustment is left exactly as it was. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const columns=(db:SqliteTestDatabase,table:string)=>db.raw.prepare(`PRAGMA table_info(${table})`).all().map(row=>(row as {name:string}).name);
const version=(db:SqliteTestDatabase)=>(db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
const count=(db:SqliteTestDatabase,table:string)=>(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;

function seed(db:SqliteTestDatabase){
  db.raw.exec(`
    PRAGMA foreign_keys = OFF;
    INSERT INTO bitumen_batches (id,batch_number,year,sequence,arrived_at,delivered_kg,grade_name,created_at,updated_at) VALUES ('b1','BIT-2026-00001',2026,1,'2026-10-01T08:00:00.000Z',20000,'60/70','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO bitumen_use (id,load_id,batch_id,kind,kg,mix_kg,rule_aggregate_kg,rule_bitumen_kg,item_name,created_at) VALUES ('u1','l1','b1','use',312.5,10000,1600,50,'Base','${SEED_TIME}');
    INSERT INTO bitumen_adjustments (id,batch_id,kg,reason,estimated_before,real_after,created_at) VALUES ('a1','b1',-100,'Dip',19687.5,19587.5,'${SEED_TIME}');
  `);
}

describe('migration 70',()=>{
  it('brings a fresh database to the current version with both fill tables empty',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(70);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(columns(db,'bitumen_fills')).toEqual(expect.arrayContaining(['id','fill_date','confirmed_at','truck_id','truck_name','destination_type','project_id','project_name','company_site_id','company_site_name','layer_note','ticket_number','notes','total_kg','status','cancellation_reason','cancelled_at','created_at']));
    expect(columns(db,'bitumen_fill_portions')).toEqual(expect.arrayContaining(['id','fill_id','batch_id','kg','price_per_kg_usd','position']));
    expect(count(db,'bitumen_fills')).toBe(0);expect(count(db,'bitumen_fill_portions')).toBe(0);
  });

  it('upgrades a version-69 database in place without changing any bitumen record',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    seed(db);
    const before={batches:db.raw.prepare('SELECT * FROM bitumen_batches').all(),use:db.raw.prepare('SELECT * FROM bitumen_use').all(),adjustments:db.raw.prepare('SELECT * FROM bitumen_adjustments').all()};
    db.raw.exec('DROP TABLE bitumen_fill_portions; DROP TABLE bitumen_fills; PRAGMA user_version = 69;');
    expect(version(db)).toBe(69);
    await migrateDatabase(db as never);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(columns(db,'bitumen_fills').length).toBeGreaterThan(0);
    expect({batches:db.raw.prepare('SELECT * FROM bitumen_batches').all(),use:db.raw.prepare('SELECT * FROM bitumen_use').all(),adjustments:db.raw.prepare('SELECT * FROM bitumen_adjustments').all()}).toEqual(before);
    await migrateDatabase(db as never);
    expect(version(db)).toBe(DATABASE_VERSION);
  });

  it('keeps fills append-only: no delete, and a cancelled fill or a changed quantity cannot be rewritten',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    seed(db);
    db.raw.exec(`
      INSERT INTO bitumen_fills (id,fill_date,confirmed_at,truck_name,destination_type,total_kg,created_at) VALUES ('f1','2026-11-10','2026-11-10T08:00:00.000Z','T-12','unassigned',500,'${SEED_TIME}');
      INSERT INTO bitumen_fill_portions (id,fill_id,batch_id,kg,position) VALUES ('p1','f1','b1',500,0);
    `);
    expect(()=>db.raw.exec("DELETE FROM bitumen_fills WHERE id='f1'")).toThrow(/cannot be deleted/);
    expect(()=>db.raw.exec("DELETE FROM bitumen_fill_portions WHERE id='p1'")).toThrow(/cannot be deleted/);
    expect(()=>db.raw.exec("UPDATE bitumen_fill_portions SET kg=1 WHERE id='p1'")).toThrow(/cannot change/);
    expect(()=>db.raw.exec("UPDATE bitumen_fills SET total_kg=900 WHERE id='f1'")).toThrow(/cannot change/);
    db.raw.exec("UPDATE bitumen_fills SET status='Cancelled',cancellation_reason='Wrong truck',cancelled_at='2026-11-10T09:00:00.000Z' WHERE id='f1'");
    expect(()=>db.raw.exec("UPDATE bitumen_fills SET status='Active' WHERE id='f1'")).toThrow(/cannot change/);
  });
});
