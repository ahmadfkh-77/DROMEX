import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';

class TestDatabase {
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

describe('receipt setup management',()=>{
  const databases:TestDatabase[]=[];afterEach(()=>{for(const database of databases.splice(0))database.close();});
  async function setup(){const database=new TestDatabase();databases.push(database);await migrateDatabase(database as never);return{database,repository:new SqliteLoadRepository(database as never)};}

  it('edits and deletes unused units and conversions',async()=>{const{repository}=await setup();const unit=await repository.createUnit({name:'Test length',symbol:'tl'});expect((await repository.updateUnit(unit.id,{name:'Test linear length',symbol:'tlin'})).name).toBe('Test linear length');const conversion=await repository.createConversion({name:'Temporary conversion',inputUnitId:'unit_kg',outputUnitId:unit.id,inputQuantity:10,outputQuantity:1,decimalPlaces:2});expect((await repository.updateConversion(conversion.id,{name:'Updated conversion',inputUnitId:'unit_kg',outputUnitId:unit.id,inputQuantity:20,outputQuantity:1,decimalPlaces:3})).inputQuantity).toBe(20);expect(await repository.removeConversion(conversion.id)).toBe('deleted');expect(await repository.removeUnit(unit.id)).toBe('deleted');});

  it('deactivates a referenced unit and dependent conversion, then permits ordered reactivation',async()=>{const{repository}=await setup();const unit=await repository.createUnit({name:'Protected unit',symbol:'prot'});const conversion=await repository.createConversion({name:'Protected conversion',inputUnitId:'unit_kg',outputUnitId:unit.id,inputQuantity:5,outputQuantity:1,decimalPlaces:2});expect(await repository.removeUnit(unit.id)).toBe('deactivated');expect((await repository.listMeasurementUnits()).find(value=>value.id===unit.id)?.isActive).toBe(false);expect((await repository.listConversionOptions()).find(value=>value.id===conversion.id)?.isActive).toBe(false);await expect(repository.setConversionActive(conversion.id,true)).rejects.toThrow('Reactivate both measurement units');await repository.setUnitActive(unit.id,true);await repository.setConversionActive(conversion.id,true);expect((await repository.listConversionOptions()).find(value=>value.id===conversion.id)?.isActive).toBe(true);});
});
