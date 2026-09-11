import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {projectIdentityChanged,validateProjectInformation} from '../src/domain/loads';

class TestDatabase {
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

const NOW='2026-09-06T00:00:00.000Z';
const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=new TestDatabase();
  databases.push(database);
  await migrateDatabase(database as never);
  database.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_1','company','Road Works Ltd',0,1,'${NOW}','${NOW}');
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_2','company','Other Client',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,notes,status,start_date,created_at,updated_at,is_archived)
      VALUES ('project_1','cust_1','Airpot Road','Berut','First notes','active','2026-07-01','${NOW}','${NOW}',0);
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat_1','Produced','${NOW}','${NOW}');
    INSERT INTO catalog_items (id,category_id,name,loads_enabled,is_active,created_at,updated_at) VALUES ('item_1','cat_1','Asphalt',1,1,'${NOW}','${NOW}');
  `);
  database.raw.exec('PRAGMA foreign_keys=OFF;');
  // A confirmed load carrying its own project_name snapshot, plus a payment against it.
  database.raw.exec(`
    INSERT INTO loads (id,transaction_number,confirmed_at,project_id,project_name,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,unit_price_usd_cents,final_total_usd_cents,payment_status,company_name,status)
      VALUES ('load_1','TXN-1','2026-08-10T10:00:00.000Z','project_1','Airpot Road','cust_1','Road Works Ltd','item_1','Asphalt','Produced','Driver A','A111',10000,30000,20000,'conv_1','Kg to t','1000 kg = 1 t','t',20,20,2500,50000,'Unpaid','DROMEX','Active');
    INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at)
      VALUES ('pay_1','load','load_1',20000,'2026-08-11','Active','${NOW}');
  `);
  return {database,repository:new SqliteLoadRepository(database as never)};
}

const projectRow=(database:TestDatabase)=>database.raw.prepare('SELECT * FROM projects WHERE id=?').get('project_1') as Record<string,unknown>;

describe('validateProjectInformation (DEC-404)',()=>{
  it('requires a name and a location after trimming',()=>{
    expect(validateProjectInformation({name:'Road',location:'Beirut'})).toEqual([]);
    expect(validateProjectInformation({name:'   ',location:'Beirut'})).toEqual(['Project name is required.']);
    expect(validateProjectInformation({name:'Road',location:'  '})).toEqual(['Project location is required.']);
    expect(validateProjectInformation({name:'',location:''})).toHaveLength(2);
  });

  it('treats notes as optional',()=>{
    expect(validateProjectInformation({name:'Road',location:'Beirut'})).toEqual([]);
    expect(validateProjectInformation({name:'Road',location:'Beirut',notes:''})).toEqual([]);
  });
});

describe('projectIdentityChanged (DEC-404 confirmation trigger)',()=>{
  const before={name:'Airport Road',location:'Beirut'};
  it('is true when the name or the location changes',()=>{
    expect(projectIdentityChanged(before,{name:'Airport Road Phase 2',location:'Beirut'})).toBe(true);
    expect(projectIdentityChanged(before,{name:'Airport Road',location:'Aley'})).toBe(true);
  });

  it('is false for an unchanged identity, for whitespace-only differences, and for a notes-only edit',()=>{
    expect(projectIdentityChanged(before,{name:'Airport Road',location:'Beirut'})).toBe(false);
    expect(projectIdentityChanged(before,{name:'  Airport   Road  ',location:' Beirut '})).toBe(false);
    expect(projectIdentityChanged(before,{name:'Airport Road',location:'Beirut',notes:'Anything at all'})).toBe(false);
  });
});

describe('updateProjectInformation',()=>{
  it('corrects name, location, and notes, and normalises whitespace',async()=>{
    const {repository}=await setup();
    const updated=await repository.updateProjectInformation('project_1',{name:'  Airport   Road  ',location:' Beirut ',notes:'  Corrected  '});
    expect(updated).toMatchObject({id:'project_1',name:'Airport Road',location:'Beirut',notes:'Corrected'});
  });

  it('stores an empty notes value as null rather than an empty string',async()=>{
    const {database,repository}=await setup();
    await repository.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',notes:'   '});
    expect(projectRow(database).notes).toBeNull();
  });

  it('rejects an empty name or location without writing anything',async()=>{
    const {database,repository}=await setup();
    await expect(repository.updateProjectInformation('project_1',{name:'  ',location:'Beirut'})).rejects.toThrow('Project name is required.');
    await expect(repository.updateProjectInformation('project_1',{name:'Road',location:''})).rejects.toThrow('Project location is required.');
    expect(projectRow(database).name).toBe('Airpot Road');
  });

  it('rejects an unknown project',async()=>{
    const {repository}=await setup();
    await expect(repository.updateProjectInformation('nope',{name:'Road',location:'Beirut'})).rejects.toThrow('Project was not found.');
  });

  // The safety guarantees DEC-404 exists to make. Each is asserted against the database, not inferred.
  it('never changes the customer, dates, status, or archive flag',async()=>{
    const {database,repository}=await setup();
    const before=projectRow(database);
    await repository.updateProjectInformation('project_1',{name:'Airport Road',location:'Aley',notes:'x'});
    const after=projectRow(database);
    for(const column of ['id','customer_id','status','start_date','end_date','created_at','is_archived']) expect(after[column]).toEqual(before[column]);
    expect(after.updated_at).not.toEqual(before.updated_at);
  });

  it('leaves confirmed loads, their snapshotted project name, transaction number, and totals untouched',async()=>{
    const {database,repository}=await setup();
    const before=database.raw.prepare('SELECT * FROM loads WHERE id=?').get('load_1') as Record<string,unknown>;
    await repository.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut'});
    const after=database.raw.prepare('SELECT * FROM loads WHERE id=?').get('load_1') as Record<string,unknown>;
    // A rename must never rewrite history: the load keeps the name it was confirmed with.
    expect(after.project_name).toBe('Airpot Road');
    expect(after).toEqual(before);
  });

  it('leaves payments and payment status untouched',async()=>{
    const {database,repository}=await setup();
    const before=database.raw.prepare('SELECT * FROM payment_entries WHERE id=?').get('pay_1') as Record<string,unknown>;
    await repository.updateProjectInformation('project_1',{name:'Renamed Project',location:'Aley'});
    expect(database.raw.prepare('SELECT * FROM payment_entries WHERE id=?').get('pay_1')).toEqual(before);
    expect((database.raw.prepare('SELECT payment_status FROM loads WHERE id=?').get('load_1') as {payment_status:string}).payment_status).toBe('Unpaid');
  });

  it('keeps the project reachable from its records, so relationships survive the rename',async()=>{
    const {database,repository}=await setup();
    await repository.updateProjectInformation('project_1',{name:'Renamed Project',location:'Aley'});
    const linked=database.raw.prepare('SELECT COUNT(*) n FROM loads WHERE project_id=?').get('project_1') as {n:number};
    expect(linked.n).toBe(1);
    expect((await repository.listProjects()).find(value=>value.id==='project_1')).toMatchObject({name:'Renamed Project',customerName:'Road Works Ltd'});
  });

  it('queues exactly one project sync entry and touches no other entity',async()=>{
    const {database,repository}=await setup();
    database.raw.exec('DELETE FROM sync_outbox');
    await repository.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut'});
    const rows=database.raw.prepare('SELECT entity_type,entity_id FROM sync_outbox').all() as {entity_type:string;entity_id:string}[];
    expect(rows).toEqual([{entity_type:'project',entity_id:'project_1'}]);
  });
});

describe('consulting agency assignment on a project (DEC-417)',()=>{
  it('assigns different agencies to different projects independently',async()=>{
    const {database,repository}=await setup();
    database.raw.exec(`INSERT INTO projects (id,customer_id,name,location,notes,status,start_date,created_at,updated_at,is_archived)
      VALUES ('project_2','cust_2','Coastal Highway','Tyre',NULL,'active','2026-07-01','${NOW}','${NOW}',0);`);
    database.raw.exec(`INSERT INTO consulting_agencies (id,name_en,name_ar,name_en_key,is_active,created_at,updated_at) VALUES
      ('agency_cedar','Cedar Engineering',NULL,'cedar engineering',1,'${NOW}','${NOW}'),
      ('agency_oak','Oakridge Partners',NULL,'oakridge partners',1,'${NOW}','${NOW}');`);

    await repository.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:'agency_cedar'});
    await repository.updateProjectInformation('project_2',{name:'Coastal Highway',location:'Tyre',consultingAgencyId:'agency_oak'});

    const projects=await repository.listProjects();
    expect(projects.find(p=>p.id==='project_1')).toMatchObject({consultingAgencyId:'agency_cedar'});
    expect(projects.find(p=>p.id==='project_2')).toMatchObject({consultingAgencyId:'agency_oak'});
  });

  it('editing one project does not affect the agency assigned to another',async()=>{
    const {database,repository}=await setup();
    database.raw.exec(`INSERT INTO projects (id,customer_id,name,location,notes,status,start_date,created_at,updated_at,is_archived)
      VALUES ('project_2','cust_2','Coastal Highway','Tyre',NULL,'active','2026-07-01','${NOW}','${NOW}',0);`);
    database.raw.exec(`INSERT INTO consulting_agencies (id,name_en,name_ar,name_en_key,is_active,created_at,updated_at) VALUES
      ('agency_cedar','Cedar Engineering',NULL,'cedar engineering',1,'${NOW}','${NOW}');`);
    await repository.updateProjectInformation('project_2',{name:'Coastal Highway',location:'Tyre',consultingAgencyId:'agency_cedar'});

    await repository.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',notes:'unrelated edit'});

    const project2=(await repository.listProjects()).find(p=>p.id==='project_2');
    expect(project2).toMatchObject({consultingAgencyId:'agency_cedar'});
  });

  it('supports "No consulting agency" explicitly, and an omitted field leaves the existing assignment untouched',async()=>{
    const {database,repository}=await setup();
    database.raw.exec(`INSERT INTO consulting_agencies (id,name_en,name_ar,name_en_key,is_active,created_at,updated_at) VALUES
      ('agency_cedar','Cedar Engineering',NULL,'cedar engineering',1,'${NOW}','${NOW}');`);
    await repository.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:'agency_cedar'});

    // Omitting the field (an unrelated edit) leaves the assignment as it was.
    await repository.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',notes:'unrelated'});
    expect((await repository.listProjects()).find(p=>p.id==='project_1')).toMatchObject({consultingAgencyId:'agency_cedar'});

    // Explicit null clears it to "No consulting agency."
    await repository.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:null});
    expect((await repository.listProjects()).find(p=>p.id==='project_1')).toMatchObject({consultingAgencyId:null});
  });

  it('a project with no consulting agency starts with none, by default',async()=>{
    const {repository}=await setup();
    const project=(await repository.listProjects()).find(p=>p.id==='project_1');
    expect(project?.consultingAgencyId).toBeFalsy();
  });
});

describe('listConsultingAgencyOptions (DEC-417 selector construction)',()=>{
  it('offers only active agencies when the project has none currently assigned',async()=>{
    const {database,repository}=await setup();
    database.raw.exec(`INSERT INTO consulting_agencies (id,name_en,name_ar,name_en_key,is_active,created_at,updated_at) VALUES
      ('agency_cedar','Cedar Engineering',NULL,'cedar engineering',1,'${NOW}','${NOW}'),
      ('agency_inactive','Retired Agency',NULL,'retired agency',0,'${NOW}','${NOW}');`);
    const options=await repository.listConsultingAgencyOptions(null);
    expect(options.map(o=>o.id)).toEqual(['agency_cedar']);
  });

  it('includes the project\'s own currently assigned agency even when it has since been deactivated, without offering other inactive agencies',async()=>{
    const {database,repository}=await setup();
    database.raw.exec(`INSERT INTO consulting_agencies (id,name_en,name_ar,name_en_key,is_active,created_at,updated_at) VALUES
      ('agency_active','Cedar Engineering',NULL,'cedar engineering',1,'${NOW}','${NOW}'),
      ('agency_mine_inactive','Retired Agency Of Mine',NULL,'retired agency of mine',0,'${NOW}','${NOW}'),
      ('agency_other_inactive','Some Other Retired Agency',NULL,'some other retired agency',0,'${NOW}','${NOW}');`);
    const options=await repository.listConsultingAgencyOptions('agency_mine_inactive');
    expect(options.map(o=>o.id).sort()).toEqual(['agency_active','agency_mine_inactive']);
  });
});
