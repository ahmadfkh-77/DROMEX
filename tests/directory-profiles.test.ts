import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';
import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';

class TestDatabase{
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

describe('worker and driver profile editing',()=>{
  const databases:TestDatabase[]=[];afterEach(()=>{for(const database of databases.splice(0))database.close();});
  async function setup(){const database=new TestDatabase();databases.push(database);await migrateDatabase(database as never);return{repository:new SqliteLoadRepository(database as never)};}

  it('updates an existing worker in place and preserves its id and active state',async()=>{
    const {repository}=await setup();
    const created=await repository.createWorker({name:'Ali Worker',role:'Labourer',phone:'71000000',notes:''});
    const updated=await repository.updateWorker(created.id,{name:'Ali Senior Worker',role:'Foreman',phone:'71000001',notes:'Promoted'});
    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({name:'Ali Senior Worker',role:'Foreman',phone:'71000001',notes:'Promoted',isActive:true});
  });

  it('rejects updating a worker to a blank name',async()=>{
    const {repository}=await setup();
    const created=await repository.createWorker({name:'Ali Worker',role:'',phone:'',notes:''});
    await expect(repository.updateWorker(created.id,{name:'   ',role:'',phone:'',notes:''})).rejects.toThrow('Worker name is required.');
  });

  it('rejects updating a worker that does not exist',async()=>{
    const {repository}=await setup();
    await expect(repository.updateWorker('missing-worker',{name:'Anyone',role:'',phone:'',notes:''})).rejects.toThrow('Worker was not found.');
  });

  it('updates an existing driver in place and preserves its id and active state',async()=>{
    const {repository}=await setup();
    const created=await repository.createDriver({name:'Omar Driver',phone:'70111111',licenseNumber:'L-1',notes:''});
    const updated=await repository.updateDriver(created.id,{name:'Omar Senior Driver',phone:'70222222',licenseNumber:'L-2',notes:'Renewed licence'});
    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({name:'Omar Senior Driver',phone:'70222222',licenseNumber:'L-2',notes:'Renewed licence',isActive:true});
  });

  it('rejects updating a driver to a blank name',async()=>{
    const {repository}=await setup();
    const created=await repository.createDriver({name:'Omar Driver',phone:'',licenseNumber:'',notes:''});
    await expect(repository.updateDriver(created.id,{name:'',phone:'',licenseNumber:'',notes:''})).rejects.toThrow('Driver name is required.');
  });

  it('rejects updating a driver that does not exist',async()=>{
    const {repository}=await setup();
    await expect(repository.updateDriver('missing-driver',{name:'Anyone',phone:'',licenseNumber:'',notes:''})).rejects.toThrow('Driver was not found.');
  });

  it('deactivating a worker or driver does not block later editing its information',async()=>{
    const {repository}=await setup();
    const worker=await repository.createWorker({name:'Ali Worker',role:'',phone:'',notes:''});
    await repository.setWorkerActive(worker.id,false);
    const updated=await repository.updateWorker(worker.id,{name:'Ali Worker',role:'Updated role',phone:'',notes:''});
    expect(updated).toMatchObject({role:'Updated role',isActive:false});
  });
});
