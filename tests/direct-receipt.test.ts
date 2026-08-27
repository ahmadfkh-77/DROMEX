import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';
import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {emptyLoadDraft} from '../src/domain/loads';

class TestDatabase{
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

describe('direct-quantity receipt SQLite integration',()=>{
  const databases:TestDatabase[]=[];afterEach(()=>{for(const database of databases.splice(0))database.close();});
  it('confirms pipes in pieces without exposing scale weights',async()=>{
    const db=new TestDatabase();databases.push(db);await migrateDatabase(db as never);const now='2026-08-23T00:00:00.000Z';
    db.raw.exec(`
      INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${now}');
      INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1100,'${now}');
      INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Pipes','${now}','${now}');
      INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,created_at,updated_at) VALUES ('pipe','cat','PVC Pipe','unit_piece',1,'${now}','${now}');
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Pipe Buyer',0,1,'${now}','${now}');
      INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at) VALUES ('driver','Ali',1,'${now}','${now}');
      INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${now}','${now}');
    `);
    const repository=new SqliteLoadRepository(db as never);
    const saved=await repository.confirmLoad({...emptyLoadDraft,customerId:'customer',destinationAddress:'Beirut',itemId:'pipe',driverId:'driver',driverName:'Ali',truckId:'truck',truckPlate:'B123',quantityMethod:'direct',directQuantity:'50',directUnitId:'unit_piece',unitPriceUsd:'4.25'});
    expect(saved).toMatchObject({quantityMethod:'direct',billedQuantity:50,outputUnitSymbol:'pc',emptyWeightKg:null,fullWeightKg:null,netWeightKg:null,subtotalUsd:212.5,finalTotalUsd:235.88});
    expect(db.raw.prepare('SELECT quantity_method,direct_quantity,direct_unit_symbol FROM loads WHERE id=?').get(saved.id)).toMatchObject({quantity_method:'direct',direct_quantity:50,direct_unit_symbol:'pc'});
  });
});
