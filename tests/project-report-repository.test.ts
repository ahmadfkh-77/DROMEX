import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';
import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {emptyDailyReport} from '../src/domain/projectReports';

class TestDatabase{
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

describe('consultant sign-off persistence on daily project reports',()=>{
  const databases:TestDatabase[]=[];afterEach(()=>{for(const database of databases.splice(0))database.close();});
  async function setup(){
    const database=new TestDatabase();databases.push(database);await migrateDatabase(database as never);
    database.raw.prepare(`INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer_1','company','Road Company',0,1,'2026-08-19T00:00:00Z','2026-08-19T00:00:00Z')`).run();
    database.raw.prepare(`INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('project_1','customer_1','Highway Section B','Beirut','active','2026-08-19T00:00:00Z','2026-08-19T00:00:00Z',0)`).run();
    return {database,repository:new SqliteProjectReportRepository(database as never)};
  }

  it('creates a new report with consultant sign-off disabled and empty by default',async()=>{
    const {repository}=await setup();
    const draft={...emptyDailyReport('project_1'),workDate:'2026-08-19',workDescription:'Paving'};
    const saved=await repository.saveReport(draft);
    expect(saved.consultantSignoffEnabled).toBe(false);
    expect(saved.consultantName).toBe('');
    expect(saved.consultantSignaturePaths).toEqual([]);
  });

  it('loads a report seeded directly in the database (pre-migration shape) with safe disabled defaults',async()=>{
    const {database,repository}=await setup();
    database.raw.prepare(`INSERT INTO daily_project_reports (id,project_id,work_date,work_description,workers_json,drivers_json,truck_plates_json,machines_json,materials_json,safety_json,photos_json,created_at,updated_at) VALUES ('report_legacy','project_1','2026-08-19','Excavation','[]','[]','[]','[]','[]','[]','[]','2026-08-19T00:00:00Z','2026-08-19T00:00:00Z')`).run();
    const report=(await repository.listReports('project_1'))[0]!;
    expect(report).toMatchObject({id:'report_legacy',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[]});
  });

  it('persists the enabled toggle through save and reload',async()=>{
    const {repository}=await setup();
    const draft={...emptyDailyReport('project_1'),workDate:'2026-08-19',workDescription:'Paving',consultantSignoffEnabled:true};
    const saved=await repository.saveReport(draft);
    const reloaded=(await repository.listReports('project_1'))[0]!;
    expect(saved.consultantSignoffEnabled).toBe(true);
    expect(reloaded.consultantSignoffEnabled).toBe(true);
  });

  it('persists the consultant name through save and reload',async()=>{
    const {repository}=await setup();
    const draft={...emptyDailyReport('project_1'),workDate:'2026-08-19',workDescription:'Paving',consultantSignoffEnabled:true,consultantName:'Jad Khoury'};
    await repository.saveReport(draft);
    const reloaded=(await repository.listReports('project_1'))[0]!;
    expect(reloaded.consultantName).toBe('Jad Khoury');
  });

  it('persists consultant signature paths through save and reload',async()=>{
    const {repository}=await setup();
    const paths=['M10 10 L20 20','M30 30 L40 10'];
    const draft={...emptyDailyReport('project_1'),workDate:'2026-08-19',workDescription:'Paving',consultantSignoffEnabled:true,consultantName:'Jad Khoury',consultantSignaturePaths:paths};
    await repository.saveReport(draft);
    const reloaded=(await repository.listReports('project_1'))[0]!;
    expect(reloaded.consultantSignaturePaths).toEqual(paths);
  });

  it('round-trips a signature clear-and-replace',async()=>{
    const {repository}=await setup();
    const first=await repository.saveReport({...emptyDailyReport('project_1'),workDate:'2026-08-19',workDescription:'Paving',consultantSignoffEnabled:true,consultantName:'Jad Khoury',consultantSignaturePaths:['M10 10 L20 20']});
    const {createdAt:_c1,updatedAt:_u1,...editableFirst}=first;
    const cleared=await repository.saveReport({...editableFirst,consultantSignaturePaths:[]});
    expect(cleared.consultantSignaturePaths).toEqual([]);
    const {createdAt:_c2,updatedAt:_u2,...editableCleared}=cleared;
    const replaced=await repository.saveReport({...editableCleared,consultantSignaturePaths:['M50 50 L60 60']});
    expect(replaced.consultantSignaturePaths).toEqual(['M50 50 L60 60']);
  });

  it('does not delete stored consultant name or signature when the report is saved again with sign-off toggled off',async()=>{
    const {repository}=await setup();
    const enabled=await repository.saveReport({...emptyDailyReport('project_1'),workDate:'2026-08-19',workDescription:'Paving',consultantSignoffEnabled:true,consultantName:'Jad Khoury',consultantSignaturePaths:['M10 10 L20 20']});
    const {createdAt:_createdAt,updatedAt:_updatedAt,...editable}=enabled;
    const disabled=await repository.saveReport({...editable,consultantSignoffEnabled:false});
    expect(disabled.consultantSignoffEnabled).toBe(false);
    expect(disabled.consultantName).toBe('Jad Khoury');
    expect(disabled.consultantSignaturePaths).toEqual(['M10 10 L20 20']);
  });
});
