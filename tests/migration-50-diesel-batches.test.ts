import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Migration 50 (DEC-492). Diesel batches, the saved Stations list, and the columns that mark a fill as
 * coming from the tank or an outside station. Nothing existing is rewritten: every current delivery,
 * fill and gauge reading keeps its values, the new columns start empty, and no batch exists until the
 * Owner starts diesel batch tracking.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const columns=(db:SqliteTestDatabase,table:string)=>db.raw.prepare(`PRAGMA table_info(${table})`).all().map(row=>(row as {name:string}).name);
const version=(db:SqliteTestDatabase)=>(db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
const count=(db:SqliteTestDatabase,table:string)=>(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;

function seedFuel(db:SqliteTestDatabase){
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Fuel Co',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO machine_profiles (id,name,is_active,created_at,updated_at) VALUES ('exc','Excavator',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,supplier_id,supplier_name,ticket_number,price_per_litre_usd_cents,subtotal_usd_cents,final_total_usd_cents,payment_status,created_at,fuel_type)
      VALUES ('d1','delivery','2026-09-01T08:00:00.000Z',1000,'sup','Fuel Co','INV-1',110,110000,110000,'Unpaid','${SEED_TIME}','diesel');
    INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,equipment_type,equipment_id,equipment_name,destination_type,project_id,project_name,price_per_litre_usd_cents,consumption_cost_usd_cents,created_at,fuel_type)
      VALUES ('f1','fill','2026-09-02T08:00:00.000Z',150,'machine','exc','Excavator','project','road','Mountain Road',110,16500,'${SEED_TIME}','diesel');
    INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,previous_balance_litres,difference_litres,reason,created_at,fuel_type)
      VALUES ('g1','gauge','2026-09-03T08:00:00.000Z',840,850,-10,'Morning dip','${SEED_TIME}','diesel');
  `);
}

describe('migration 50',()=>{
  it('brings a fresh database to version 50 with every new structure',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(50);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(columns(db,'fuel_stations')).toEqual(expect.arrayContaining(['id','name','name_key','location','notes','is_active','created_at','updated_at']));
    expect(columns(db,'fuel_batch_settings')).toEqual(expect.arrayContaining(['id','started_at','created_at']));
    expect(columns(db,'fuel_batch_counters')).toEqual(expect.arrayContaining(['year','next_number']));
    expect(columns(db,'fuel_batches')).toEqual(expect.arrayContaining(['id','batch_number','year','sequence','kind','delivery_movement_id','opening_basis','opening_gauge_movement_id','arrived_at','delivered_litres','price_per_litre_usd_cents','invoice_number','supplier_id','supplier_name','status','cancellation_reason','cancelled_at','created_at']));
    expect(columns(db,'fuel_batch_allocations')).toEqual(expect.arrayContaining(['movement_id','batch_id','kind','litres','position','calculated_litres','dip_litres']));
    expect(columns(db,'fuel_allocation_events')).toEqual(expect.arrayContaining(['id','movement_id','caused_by_movement_id','before_json','after_json','created_at']));
    expect(columns(db,'fuel_movements')).toEqual(expect.arrayContaining(['fuel_source','fuel_station_id','fuel_station_name','batch_id']));
  });

  it('starts with no batch, no station, and tracking not started',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    for(const table of ['fuel_stations','fuel_batch_settings','fuel_batch_counters','fuel_batches','fuel_batch_allocations','fuel_allocation_events'])expect(count(db,table)).toBe(0);
  });

  it('upgrades a version-49 database without changing any existing fuel record',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    seedFuel(db);
    const before=db.raw.prepare('SELECT * FROM fuel_movements ORDER BY id').all() as Record<string,unknown>[];
    db.raw.exec(`
      PRAGMA foreign_keys = OFF;
      DROP INDEX IF EXISTS idx_fuel_movements_station;
      DROP INDEX IF EXISTS idx_fuel_movements_batch;
      ALTER TABLE fuel_movements DROP COLUMN batch_id; ALTER TABLE fuel_movements DROP COLUMN fuel_station_name;
      ALTER TABLE fuel_movements DROP COLUMN fuel_station_id; ALTER TABLE fuel_movements DROP COLUMN fuel_source;
      DROP TABLE fuel_allocation_events; DROP TABLE fuel_batch_allocations; DROP TABLE fuel_batches;
      DROP TABLE fuel_batch_counters; DROP TABLE fuel_batch_settings; DROP TABLE fuel_stations;
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 49;
    `);
    await migrateDatabase(db as never);
    expect(version(db)).toBe(DATABASE_VERSION);
    const after=db.raw.prepare('SELECT * FROM fuel_movements ORDER BY id').all() as Record<string,unknown>[];
    expect(after).toEqual(before.map(row=>({...row,fuel_source:null,fuel_station_id:null,fuel_station_name:null,batch_id:null})));
    expect(count(db,'fuel_batches')).toBe(0);
    expect(count(db,'fuel_batch_settings')).toBe(0);
  });

  it('runs again harmlessly on an already-migrated database',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    seedFuel(db);
    db.raw.exec('PRAGMA user_version = 49');
    await migrateDatabase(db as never);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(count(db,'fuel_movements')).toBe(3);
  });

  it('allows only a tank or station source and keeps the allocation history append-only',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    seedFuel(db);
    db.raw.exec("UPDATE fuel_movements SET fuel_source='tank' WHERE id='f1'");
    expect(()=>db.raw.exec("UPDATE fuel_movements SET fuel_source='barrel' WHERE id='f1'")).toThrow();
    db.raw.exec(`INSERT INTO fuel_allocation_events (movement_id,before_json,after_json,created_at) VALUES ('f1','[]','[]','${SEED_TIME}')`);
    expect(()=>db.raw.exec("UPDATE fuel_allocation_events SET after_json='x'")).toThrow(/cannot change/);
    expect(()=>db.raw.exec('DELETE FROM fuel_allocation_events')).toThrow(/cannot be deleted/);
  });

  it('keeps a batch number unique and a batch tied to exactly one delivery or one opening stock',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    seedFuel(db);
    const insert=(id:string,number:string,sequence:number,kind:string,delivery:string|null,basis:string|null)=>db.raw.prepare(`INSERT INTO fuel_batches (id,batch_number,year,sequence,kind,delivery_movement_id,opening_basis,arrived_at,delivered_litres,created_at) VALUES (?,?,2026,?,?,?,?,'2026-09-01T08:00:00.000Z',1000,'${SEED_TIME}')`).run(id,number,sequence,kind,delivery,basis);
    insert('b1','DSL-2026-00001',1,'delivery','d1',null);
    expect(()=>insert('b2','DSL-2026-00001',2,'delivery',null,null)).toThrow();
    expect(()=>insert('b3','DSL-2026-00003',1,'opening',null,'dip')).toThrow();
    expect(()=>insert('b4','DSL-2026-00004',4,'opening','d1','dip')).toThrow();
    expect(()=>insert('b5','DSL-2026-00005',5,'opening',null,null)).toThrow();
    insert('b6','DSL-2026-00006',6,'opening',null,'calculated');
    expect(count(db,'fuel_batches')).toBe(2);
  });

  it('keeps a saved station name unique among active stations only',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    const add=(id:string,active:number)=>db.raw.prepare(`INSERT INTO fuel_stations (id,name,name_key,is_active,created_at,updated_at) VALUES (?,'Hasbaya Station','hasbaya station',?,'${SEED_TIME}','${SEED_TIME}')`).run(id,active);
    add('s1',1);
    expect(()=>add('s2',1)).toThrow();
    add('s3',0);
    expect(count(db,'fuel_stations')).toBe(2);
  });
});
