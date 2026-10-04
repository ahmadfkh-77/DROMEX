import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {BACKUP_COUNT_TABLES} from '../src/domain/backup';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-505. A backup copies the whole SQLite file, so batches, stations, the derived allocation and its
 * history travel with it. These tests restore a real file copy and prove nothing is lost or renumbered.
 */
const open:SqliteTestDatabase[]=[];const files:string[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of open.splice(0))database.close();for(const file of files.splice(0))fs.rmSync(file,{force:true});});
function copyOf(database:SqliteTestDatabase):SqliteTestDatabase{
  const file=path.join(os.tmpdir(),`dromex-dec492-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);files.push(file);
  database.raw.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);
  const restored=new SqliteTestDatabase(file);open.push(restored);return restored;
}
const clock=(local:string)=>vi.setSystemTime(new Date(local));

async function build(){
  const db=await migratedDatabaseWithProject(open);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Al-Nour Fuel',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO machine_profiles (id,name,is_active,created_at,updated_at) VALUES ('exc','Excavator',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const repository=new SqliteFuelRepository(db as never);
  const deliver=(local:string,litres:string,price:string,ticket:string)=>{clock(local);return repository.recordDelivery({recordDate:local.slice(0,10),supplierId:'sup',litres,ticketNumber:ticket,pricePerLitreUsd:price,updateCurrentPrice:false,notes:''});};
  const fill=(local:string,litres:string,extra:Record<string,unknown>={})=>{clock(local);return repository.recordFill({recordDate:local.slice(0,10),fuelType:'diesel',litres,equipmentType:'machine',equipmentId:'exc',destinationType:'project',projectId:'road',companySiteId:'',odometerReading:'',pricePerLitreUsd:'',priceOverrideReason:'',notes:'',...extra} as never);};
  return {db,repository,deliver,fill};
}

describe('backup and restore of diesel batches',()=>{
  it('counts batches and stations in the backup preview',()=>{
    expect(BACKUP_COUNT_TABLES).toEqual(expect.arrayContaining(['fuel_movements','fuel_batches','fuel_stations']));
  });

  it('round-trips batches, stations, fills, adjustments and the allocation history, then keeps numbering',async()=>{
    const {db,repository,deliver,fill}=await build();
    await deliver('2026-09-20T09:00:00','500','1.00','OLD-1');
    clock('2026-10-01T09:00:00');await repository.startDieselBatches({dipLitres:'480',pricePerLitreUsd:'1.00'});
    await deliver('2026-10-02T09:00:00','1000','1.10','55821');
    const station=await repository.createFuelStation({name:'Hasbaya Station',location:'Hasbaya',notes:''});
    await fill('2026-10-03T09:00:00','600');
    await fill('2026-10-03T10:00:00','60',{fuelSource:'station',stationId:station.id,receiptNumber:'R-1'});
    clock('2026-10-04T08:00:00');await repository.recordGauge({recordDate:'2026-10-04',actualLitres:'800',reason:'Morning dip',notes:''});
    await deliver('2026-10-03T12:00:00','200','1.20','55822');
    const expected=await repository.getBatchOverview();
    expect(expected.batches.map(batch=>batch.batchNumber)).toEqual(['DSL-2026-00001','DSL-2026-00002','DSL-2026-00003']);

    const restored=copyOf(db);
    const after=new SqliteFuelRepository(restored as never);
    expect(await after.getBatchOverview()).toEqual(expected);
    expect((await after.getSetup()).fuelStations).toEqual([expect.objectContaining({name:'Hasbaya Station',location:'Hasbaya'})]);
    expect((await after.getOverview()).currentBalanceLitres).toBe((await repository.getOverview()).currentBalanceLitres);

    clock('2026-10-05T09:00:00');
    await after.recordDelivery({recordDate:'2026-10-05',supplierId:'sup',litres:'100',ticketNumber:'55823',pricePerLitreUsd:'1.30',updateCurrentPrice:false,notes:''});
    expect((await after.getBatchOverview()).batches.map(batch=>batch.batchNumber)).toEqual(['DSL-2026-00001','DSL-2026-00002','DSL-2026-00003','DSL-2026-00004']);
  });

  it('never reuses a cancelled batch number after a restore',async()=>{
    const {db,repository,deliver}=await build();
    clock('2026-10-01T09:00:00');await repository.startDieselBatches({dipLitres:'',pricePerLitreUsd:''});
    const delivery=await deliver('2026-10-02T09:00:00','100','1.00','A');
    await repository.cancelMovement(delivery.id,'Entered twice');
    const after=new SqliteFuelRepository(copyOf(db) as never);
    clock('2026-10-03T09:00:00');
    await after.recordDelivery({recordDate:'2026-10-03',supplierId:'sup',litres:'100',ticketNumber:'B',pricePerLitreUsd:'1.00',updateCurrentPrice:false,notes:''});
    expect((await after.getBatchOverview()).batches.map(batch=>[batch.batchNumber,batch.status])).toEqual([['DSL-2026-00001','cancelled'],['DSL-2026-00002','in_use']]);
  });

  it('restores a file from before this update untouched: no batches, tracking not started, every fill unbatched',async()=>{
    const {db,deliver,fill}=await build();
    await deliver('2026-09-20T09:00:00','500','1.00','OLD-1');
    const saved=await fill('2026-09-21T09:00:00','120');
    // The shape of a build-25 file: the new fuel structures do not exist yet, and migration 50 adds them on open.
    db.raw.exec(`PRAGMA foreign_keys = OFF; DROP INDEX IF EXISTS idx_fuel_movements_station; DROP INDEX IF EXISTS idx_fuel_movements_batch;
      ALTER TABLE fuel_movements DROP COLUMN batch_id; ALTER TABLE fuel_movements DROP COLUMN fuel_station_name; ALTER TABLE fuel_movements DROP COLUMN fuel_station_id; ALTER TABLE fuel_movements DROP COLUMN fuel_source;
      DROP TABLE fuel_allocation_events; DROP TABLE fuel_batch_allocations; DROP TABLE fuel_batches; DROP TABLE fuel_batch_counters; DROP TABLE fuel_batch_settings; DROP TABLE fuel_stations;
      PRAGMA foreign_keys = ON; PRAGMA user_version = 49;`);
    const restored=copyOf(db);
    await migrateDatabase(restored as never);
    const after=new SqliteFuelRepository(restored as never);
    expect(await after.getBatchOverview()).toMatchObject({started:false,batches:[],fills:{},tankLitres:380});
    expect((await after.getOverview()).movements.find(value=>value.id===saved.id)).toMatchObject({litres:120,fuelSource:null,batchId:null});
    expect((await after.getSetup()).batchTracking).toEqual({started:false,startedAt:null});
  });
});
