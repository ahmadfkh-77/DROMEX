import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';
import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteWorkspaceRepository} from '../src/data/repositories/SqliteWorkspaceRepository';
import {groupWorkspaceActivities,type WorkspaceActivity} from '../src/domain/workspace';

class TestDatabase{
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

describe('workspace repository SQLite integration',()=>{
  const databases:TestDatabase[]=[];afterEach(()=>{for(const database of databases.splice(0))database.close();});
  async function setup(){const database=new TestDatabase();databases.push(database);await migrateDatabase(database as never);database.raw.prepare(`INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer_1','company','Road Company',0,1,'2026-08-19T00:00:00Z','2026-08-19T00:00:00Z')`).run();database.raw.prepare(`INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('project_1','customer_1','Highway Section B','Beirut','active','2026-08-19T00:00:00Z','2026-08-19T00:00:00Z',0)`).run();return{database,repository:new SqliteWorkspaceRepository(database as never)};}

  it('executes the complete migration and project workspace queries',async()=>{const{database,repository}=await setup();expect(database.raw.prepare('PRAGMA user_version').get()).toMatchObject({user_version:23});const snapshot=await repository.getProjectWorkspace('project_1');expect(snapshot.project.name).toBe('Highway Section B');expect(snapshot.metrics).toMatchObject({loads:0,dailyReports:0,wasteDumps:0,pavementCalculations:0,openIssues:0});});

  it('creates issues, filters the project-bounded combined timeline, and executes every global-search union',async()=>{const{repository}=await setup();await repository.createIssue('project_1',{title:'Blocked access road',description:'Waiting for clearance',priority:'High',dueDate:'2026-08-20'});const timeline=await repository.listProjectActivities('project_1');expect(timeline).toHaveLength(1);expect(timeline[0]).toMatchObject({type:'Issue',title:'Blocked access road'});await expect(repository.listProjectActivities('project_1','1900-01-01','1900-12-31')).rejects.toThrow('before the project start date');await expect(repository.listProjectActivities('project_1','2026-08-20','2026-08-19')).rejects.toThrow('From date cannot be after To date.');const results=await repository.search('road');expect(results.some(result=>result.kind==='Project Issue'&&result.title==='Blocked access road')).toBe(true);const attention=await repository.getAttentionSnapshot();expect(attention.openIssues).toBe(1);});

  it('uses the project finish date as the completed timeline maximum',async()=>{const{database,repository}=await setup();database.raw.prepare("UPDATE projects SET status='completed',start_date='2026-08-01',end_date='2026-08-20' WHERE id='project_1'").run();await expect(repository.listProjectActivities('project_1','2026-08-21','2026-08-21')).rejects.toThrow('after the project finish date (2026-08-20)');expect(await repository.listProjectActivities('project_1','2026-08-01','2026-08-20')).toEqual([]);});

  it('organizes mixed project activity under stable record-type labels',()=>{const activity=(id:string,type:WorkspaceActivity['type'],occurredAt:string)=>({id,type,occurredAt,title:id,detail:null});const groups=groupWorkspaceActivities([activity('waste','Waste Dump','2026-08-20T10:00:00Z'),activity('load-old','Load','2026-08-19T10:00:00Z'),activity('quarry','Quarry','2026-08-21T10:00:00Z'),activity('load-new','Load','2026-08-22T10:00:00Z')]);expect(groups.map(group=>group.label)).toEqual(['Loads','Quarry Purchases','Waste Dumps']);expect(groups[0]?.activities.map(value=>value.id)).toEqual(['load-new','load-old']);});
});
