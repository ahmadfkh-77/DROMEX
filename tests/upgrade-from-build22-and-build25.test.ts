import {copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {emptyLoadDraft} from '../src/domain/loads';
import {buildLoadEscPos} from '../src/services/escpos';
import {SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * Release check for 0.20.0 build 26. The fixtures are real databases at the schemas the Owner's phones
 * have run: build 22 (0.19.0, database version 47, the accepted installer) and build 25 (0.20.0 preview,
 * version 49, in real use). They were created from the migration code at commits 75c29e9 and 59261e3 and
 * filled with representative loads, supplier loads, a daily report and fuel records (gauge readings, a
 * priced delivery, project, company-site and unassigned fills, gasoline, a cancelled and a corrected
 * fill, an Arabic site name), plus build 25's own {PREFIX}-{YYYY}-{NNN} load numbers.
 *
 * Each test upgrades a copy with today's migrations and proves that every row of every table that already
 * existed is identical afterwards, that the app reads the records the same way, and that numbering
 * continues instead of restarting.
 */
const open:SqliteTestDatabase[]=[];const files:string[]=[];
afterEach(()=>{for(const database of open.splice(0))database.close();for(const file of files.splice(0))rmSync(file,{force:true});});

function copyOfFixture(name:string):SqliteTestDatabase{
  const file=join(tmpdir(),`dromex-upgrade-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);files.push(file);
  copyFileSync(join(__dirname,'fixtures','upgrade',`${name}.sqlite`),file);
  const database=new SqliteTestDatabase(file);open.push(database);return database;
}
type Snapshot=Map<string,{columns:string[];rows:unknown[]}>;
function snapshot(db:SqliteTestDatabase):Snapshot{
  const result:Snapshot=new Map();
  const tables=(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(row=>row.name);
  for(const table of tables){
    const columns=(db.raw.prepare(`PRAGMA table_info("${table}")`).all() as {name:string}[]).map(row=>row.name);
    result.set(table,{columns,rows:db.raw.prepare(`SELECT ${columns.map(column=>`"${column}"`).join(',')} FROM "${table}" ORDER BY rowid`).all()});
  }
  return result;
}
const version=(db:SqliteTestDatabase)=>(db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
const confirm=(loads:SqliteLoadRepository,itemId:string)=>loads.confirmLoad({...emptyLoadDraft,recordDate:'2026-08-20',customerId:'customer',projectId:'road',itemId,driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'direct',directQuantity:'12',directUnitId:'unit_ton'});

describe.each([
  {name:'build22-v47',from:47,label:'build 22 (accepted installer)'},
  {name:'build25-v49',from:49,label:'build 25 (preview in real use)'},
])('upgrading $label to build 26',({name,from})=>{
  it('starts from the real old schema',()=>{
    expect(version(copyOfFixture(name))).toBe(from);
  });

  it('keeps every existing row of every existing table identical',async()=>{
    const db=copyOfFixture(name);
    const before=snapshot(db);
    await migrateDatabase(db as never);
    expect(version(db)).toBe(DATABASE_VERSION);
    const after=snapshot(db);
    for(const [table,{columns,rows}] of before){
      expect(after.has(table),`${table} disappeared`).toBe(true);
      const kept=db.raw.prepare(`SELECT ${columns.map(column=>`"${column}"`).join(',')} FROM "${table}" ORDER BY rowid`).all();
      expect(kept,`${table} changed`).toEqual(rows);
    }
  });

  it('adds the new fuel columns empty and starts with no batch and tracking not started',async()=>{
    const db=copyOfFixture(name);
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM fuel_movements WHERE fuel_source IS NOT NULL OR fuel_station_id IS NOT NULL OR batch_id IS NOT NULL').get()).toEqual({n:0});
    for(const table of ['fuel_batches','fuel_batch_settings','fuel_stations','fuel_batch_allocations','fuel_allocation_events'])expect(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:0});
    const fuel=new SqliteFuelRepository(db as never);
    expect((await fuel.getSetup()).batchTracking).toEqual({started:false,startedAt:null});
    expect((await fuel.getBatchOverview()).tankLitres).toBe((await fuel.getOverview()).currentBalanceLitres);
  });

  it('reads every fuel record, balance and cost exactly as before',async()=>{
    const db=copyOfFixture(name);
    const shape=async()=>{const overview=await new SqliteFuelRepository(db as never).getOverview();return {balance:overview.currentBalanceLitres,known:overview.hasKnownBalance,movements:overview.movements.map(movement=>[movement.id,movement.type,movement.fuelType,movement.status,movement.litres,movement.consumptionCostUsd,movement.finalTotalUsd,movement.destinationType,movement.companySiteName,movement.balanceAfterLitres])};};
    const before=await shape();
    await migrateDatabase(db as never);
    expect(await shape()).toEqual(before);
    expect(before.balance).toBe(1040);
  });

  it('reprints old receipts exactly as before',async()=>{
    const db=copyOfFixture(name);
    await migrateDatabase(db as never);
    const loads=await new SqliteLoadRepository(db as never).listLoads();
    const legacy=loads.find(load=>load.id==='l5')!;
    expect(buildLoadEscPos(legacy,'receipt','58').toString('utf8')).not.toContain('Load No.');
    if(from===49){
      expect(loads.find(load=>load.id==='l1')!.loadNumber).toBe('ASP-2026-001');
      expect(buildLoadEscPos(loads.find(load=>load.id==='l1')!,'receipt','58').toString('utf8')).toContain('ASP-2026-001');
    }else{
      expect(loads.every(load=>load.loadNumber==null)).toBe(true);
    }
  });

  it('continues load numbering in the new format instead of restarting',async()=>{
    const db=copyOfFixture(name);
    await migrateDatabase(db as never);
    const repository=new SqliteLoadRepository(db as never);
    const asphalt=await confirm(repository,'asphalt'),sand=await confirm(repository,'sand');
    if(from===49){
      expect(asphalt.loadNumber).toBe('ASP-00003');
      expect(sand.loadNumber).toBe('LOAD-00002');
    }else{
      expect(asphalt.loadNumber).toBe('LOAD-00001');
      expect(sand.loadNumber).toBe('LOAD-00002');
    }
    expect(buildLoadEscPos(asphalt,'receipt','58').toString('utf8')).toContain('Load No.:');
  });

  it('can start diesel batches on the upgraded data, opening with the existing tank balance',async()=>{
    const db=copyOfFixture(name);
    await migrateDatabase(db as never);
    const fuel=new SqliteFuelRepository(db as never);
    const opening=await fuel.startDieselBatches({dipLitres:'',pricePerLitreUsd:''});
    expect(opening).toMatchObject({kind:'opening',openingBasis:'calculated',deliveredLitres:1040});
    expect((await fuel.getBatchOverview()).tankLitres).toBe(1040);
  });
});
