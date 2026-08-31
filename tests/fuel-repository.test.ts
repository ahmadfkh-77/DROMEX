import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';
import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {localDateKey} from '../src/domain/fuel';

class TestDatabase{
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

describe('fuel price and fill-cost SQLite integration',()=>{
  const databases:TestDatabase[]=[];afterEach(()=>{for(const database of databases.splice(0))database.close();});
  async function setup(){const database=new TestDatabase();databases.push(database);await migrateDatabase(database as never);const now='2026-08-29T00:00:00Z';database.raw.exec(`INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${now}','${now}');INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('project','customer','Road Project','Beirut','active','${now}','${now}',0);INSERT INTO machine_profiles (id,name,machine_type,is_active,created_at,updated_at) VALUES ('machine','Excavator','Excavator',1,'${now}','${now}');INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('supplier','Fuel Supplier',1,'${now}','${now}');`);return{database,repository:new SqliteFuelRepository(database as never)};}

  it('keeps each fill price and cost unchanged after the current price changes',async()=>{const{database,repository}=await setup();await repository.setCurrentPrice({pricePerLitreUsd:'0.90',reason:'Initial price'});const first=await repository.recordFill({equipmentId:'machine',projectId:'project',litres:'40',odometerReading:'',pricePerLitreUsd:'0.90',priceOverrideReason:'',notes:''});expect(first).toMatchObject({pricePerLitreUsd:.9,consumptionCostUsd:36,projectName:'Road Project'});await repository.setCurrentPrice({pricePerLitreUsd:'1.00',reason:'Supplier increase'});const history=(await repository.getSetup()).fuelPriceHistory;expect(history.map(value=>value.pricePerLitreUsd)).toEqual([1,.9]);const saved=(await repository.getOverview()).movements.find(value=>value.id===first.id);expect(saved).toMatchObject({pricePerLitreUsd:.9,consumptionCostUsd:36});const daily=await new SqliteProjectReportRepository(database as never).listLinkedFuelFills('project',localDateKey(first.confirmedAt));expect(daily[0]).toMatchObject({equipmentName:'Excavator',litres:40,pricePerLitreUsd:.9,consumptionCostUsd:36});});

  it('requires a reason when the owner overrides the current fill price',async()=>{const{repository}=await setup();await repository.setCurrentPrice({pricePerLitreUsd:'0.90',reason:''});await expect(repository.recordFill({equipmentId:'machine',projectId:'project',litres:'10',odometerReading:'',pricePerLitreUsd:'1.00',priceOverrideReason:'',notes:''})).rejects.toThrow('reason for overriding');const fill=await repository.recordFill({equipmentId:'machine',projectId:'project',litres:'10',odometerReading:'',pricePerLitreUsd:'1.00',priceOverrideReason:'Emergency purchase',notes:''});expect(fill).toMatchObject({consumptionCostUsd:10,priceOverrideReason:'Emergency purchase'});});

  it('can price a purchase and make it the new current price',async()=>{const{repository}=await setup();const purchase=await repository.recordDelivery({supplierId:'supplier',litres:'1000',ticketNumber:'INV-1',pricePerLitreUsd:'0.95',updateCurrentPrice:true,notes:''});expect(purchase).toMatchObject({pricePerLitreUsd:.95,subtotalUsd:950});expect((await repository.getSetup()).currentFuelPrice?.pricePerLitreUsd).toBe(.95);});
});
