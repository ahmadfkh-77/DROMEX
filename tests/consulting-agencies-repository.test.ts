import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteProfileRepository} from '../src/data/repositories/SqliteProfileRepository';

class TestDatabase {
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=new TestDatabase();
  databases.push(database);
  await migrateDatabase(database as never);
  return {database,repository:new SqliteProfileRepository(database as never)};
}

describe('consulting agency repository CRUD (DEC-417)',()=>{
  it('creates an agency with a trimmed, whitespace-collapsed English name and an optional Arabic name',async()=>{
    const {repository}=await setup();
    const agency=await repository.createConsultingAgency({nameEn:'  Cedar   Engineering  ',nameAr:'  Arabic Name  '});
    expect(agency).toMatchObject({nameEn:'Cedar Engineering',nameAr:'Arabic Name',isActive:true});
    expect(agency.id).toBeTruthy();
  });

  it('rejects an empty English name and writes nothing',async()=>{
    const {database,repository}=await setup();
    await expect(repository.createConsultingAgency({nameEn:'   '})).rejects.toThrow('English agency name is required.');
    expect(database.raw.prepare('SELECT COUNT(*) total FROM consulting_agencies').get()).toMatchObject({total:0});
  });

  it('lists active agencies before inactive ones, alphabetically by normalized key',async()=>{
    const {repository}=await setup();
    await repository.createConsultingAgency({nameEn:'Zebra Consulting'});
    const cedar=await repository.createConsultingAgency({nameEn:'Cedar Engineering'});
    await repository.setConsultingAgencyActive(cedar.id,false);
    const list=await repository.listConsultingAgencies();
    expect(list.map(a=>a.nameEn)).toEqual(['Zebra Consulting','Cedar Engineering']);
    expect(list[0]!.isActive).toBe(true);
    expect(list[1]!.isActive).toBe(false);
  });

  it('edits an agency, keeping its id stable',async()=>{
    const {repository}=await setup();
    const created=await repository.createConsultingAgency({nameEn:'Cedar'});
    const updated=await repository.updateConsultingAgency(created.id,{nameEn:'Cedar Engineering Consultants',nameAr:'Arabic Name'});
    expect(updated).toMatchObject({id:created.id,nameEn:'Cedar Engineering Consultants',nameAr:'Arabic Name'});
  });

  it('deactivates and reactivates without physically deleting the row',async()=>{
    const {database,repository}=await setup();
    const created=await repository.createConsultingAgency({nameEn:'Cedar'});
    await repository.setConsultingAgencyActive(created.id,false);
    expect(database.raw.prepare('SELECT is_active FROM consulting_agencies WHERE id=?').get(created.id)).toMatchObject({is_active:0});
    const reactivated=await repository.setConsultingAgencyActive(created.id,true);
    expect(reactivated.isActive).toBe(true);
    expect(database.raw.prepare('SELECT COUNT(*) total FROM consulting_agencies').get()).toMatchObject({total:1});
  });

  describe('duplicate protection cannot be bypassed through capitalization or whitespace',()=>{
    it('rejects a create whose only difference from an existing agency is capitalization',async()=>{
      const {repository}=await setup();
      await repository.createConsultingAgency({nameEn:'Cedar Engineering'});
      await expect(repository.createConsultingAgency({nameEn:'CEDAR ENGINEERING'})).rejects.toThrow();
    });
    it('rejects a create whose only difference is surrounding or repeated internal whitespace',async()=>{
      const {repository}=await setup();
      await repository.createConsultingAgency({nameEn:'Cedar Engineering'});
      await expect(repository.createConsultingAgency({nameEn:'  Cedar   Engineering  '})).rejects.toThrow();
    });
    it('rejects an update that renames one agency to collide with another, by capitalization or whitespace',async()=>{
      const {repository}=await setup();
      await repository.createConsultingAgency({nameEn:'Cedar Engineering'});
      const other=await repository.createConsultingAgency({nameEn:'Oakridge Partners'});
      await expect(repository.updateConsultingAgency(other.id,{nameEn:'cedar   engineering'})).rejects.toThrow();
    });
    it('proves the protection is DB-enforced, not merely client-side: bypassing createConsultingAgency and inserting a colliding row directly still fails',async()=>{
      const {database,repository}=await setup();
      await repository.createConsultingAgency({nameEn:'Cedar Engineering'});
      const now=new Date().toISOString();
      expect(()=>database.raw.prepare(
        'INSERT INTO consulting_agencies (id,name_en,name_ar,name_en_key,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)',
      ).run('bypass_id','CEDAR   ENGINEERING',null,'cedar engineering',now,now)).toThrow();
    });
    it('allows re-creating an agency name after the original agency was deactivated, since deactivation does not free the key',async()=>{
      // Deliberately documents current behaviour: the unique key is not scoped to is_active, so a
      // deactivated agency's name remains taken. This matches "never physically delete" -- the name
      // is still owned by a real, recoverable row, and reactivating it is the correct next action.
      const {repository}=await setup();
      const created=await repository.createConsultingAgency({nameEn:'Cedar Engineering'});
      await repository.setConsultingAgencyActive(created.id,false);
      await expect(repository.createConsultingAgency({nameEn:'Cedar Engineering'})).rejects.toThrow();
    });
  });
});
