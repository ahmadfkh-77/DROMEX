import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteProfileRepository} from '../src/data/repositories/SqliteProfileRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
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

const NOW='2026-09-06T00:00:00.000Z';
const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=new TestDatabase();
  databases.push(database);
  await migrateDatabase(database as never);
  database.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_1','company','Road Works Ltd',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived)
      VALUES ('project_1','cust_1','Airport Road','Beirut','active','2026-07-01','${NOW}','${NOW}',0);
  `);
  return {
    database,
    reports:new SqliteProjectReportRepository(database as never),
    profiles:new SqliteProfileRepository(database as never),
    loads:new SqliteLoadRepository(database as never),
  };
}

describe('a new report inherits its project\'s agency (DEC-417)',()=>{
  it('carries the project\'s current agency into the report snapshot at creation time',async()=>{
    const {reports,profiles,loads}=await setup();
    const cedar=await profiles.createConsultingAgency({nameEn:'Cedar Engineering',nameAr:'Arabic Name'});
    await loads.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:cedar.id});

    const setup2=await reports.getSetup();
    const project=setup2.projects.find(p=>p.id==='project_1')!;
    const draft=emptyDailyReport('project_1',project.consultingAgencyId?{id:project.consultingAgencyId,nameEn:project.consultingAgencyNameEn!,nameAr:project.consultingAgencyNameAr??null}:null);
    expect(draft.consultingAgencyId).toBe(cedar.id);
    expect(draft.consultingAgencyNameEn).toBe('Cedar Engineering');
    expect(draft.consultingAgencyNameAr).toBe('Arabic Name');

    const saved=await reports.saveReport({...draft,workDate:'2026-08-01',workDescription:'Paving'});
    expect(saved).toMatchObject({consultingAgencyId:cedar.id,consultingAgencyNameEn:'Cedar Engineering',consultingAgencyNameAr:'Arabic Name'});
  });

  it('a project with no consulting agency produces a new report with no agency by default',async()=>{
    const {reports}=await setup();
    const setup2=await reports.getSetup();
    const project=setup2.projects.find(p=>p.id==='project_1')!;
    expect(project.consultingAgencyId).toBeFalsy();

    const draft=emptyDailyReport('project_1',null);
    const saved=await reports.saveReport({...draft,workDate:'2026-08-01',workDescription:'Paving'});
    expect(saved).toMatchObject({consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null});
  });

  it('enabling the header toggle at creation never selects an agency by itself',async()=>{
    const {reports}=await setup();
    const draft={...emptyDailyReport('project_1',null),showConsultingAgency:true};
    const saved=await reports.saveReport({...draft,workDate:'2026-08-01',workDescription:'Paving'});
    expect(saved.showConsultingAgency).toBe(true);
    expect(saved.consultingAgencyId).toBeNull();
  });
});

describe('a deliberate report-level override (DEC-417)',()=>{
  it('replaces the inherited agency when the user explicitly selects a different saved agency',async()=>{
    const {reports,profiles,loads}=await setup();
    const cedar=await profiles.createConsultingAgency({nameEn:'Cedar Engineering'});
    const oak=await profiles.createConsultingAgency({nameEn:'Oakridge Partners',nameAr:'Oak Arabic'});
    await loads.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:cedar.id});

    const draft=emptyDailyReport('project_1',{id:cedar.id,nameEn:'Cedar Engineering',nameAr:null});
    const overridden={...draft,workDate:'2026-08-01',workDescription:'Paving',consultingAgencyId:oak.id,consultingAgencyNameEn:oak.nameEn,consultingAgencyNameAr:oak.nameAr};
    const saved=await reports.saveReport(overridden);
    expect(saved).toMatchObject({consultingAgencyId:oak.id,consultingAgencyNameEn:'Oakridge Partners',consultingAgencyNameAr:'Oak Arabic'});
  });

  it('"No consulting agency" as an explicit override clears the reference and both snapshot names',async()=>{
    const {reports,profiles,loads}=await setup();
    const cedar=await profiles.createConsultingAgency({nameEn:'Cedar Engineering'});
    await loads.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:cedar.id});
    const draft=emptyDailyReport('project_1',{id:cedar.id,nameEn:'Cedar Engineering',nameAr:null});
    const saved1=await reports.saveReport({...draft,workDate:'2026-08-01',workDescription:'Paving'});
    expect(saved1.consultingAgencyId).toBe(cedar.id);

    const cleared=await reports.saveReport({...saved1,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null});
    expect(cleared).toMatchObject({consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null});
  });
});

describe('historical snapshot integrity (DEC-416/DEC-417)',()=>{
  it('an existing report keeps the agency name it was saved with, even after that agency is renamed',async()=>{
    const {reports,profiles,loads}=await setup();
    const cedar=await profiles.createConsultingAgency({nameEn:'Cedar Engineering'});
    await loads.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:cedar.id});
    const draft=emptyDailyReport('project_1',{id:cedar.id,nameEn:'Cedar Engineering',nameAr:null});
    const saved=await reports.saveReport({...draft,workDate:'2026-08-01',workDescription:'Paving'});

    await profiles.updateConsultingAgency(cedar.id,{nameEn:'Cedar Engineering Consultants International'});

    const reloaded=(await reports.listReports('project_1')).find(r=>r.id===saved.id)!;
    expect(reloaded.consultingAgencyNameEn).toBe('Cedar Engineering');
  });

  it('an existing report keeps its agency after the project is reassigned to a different agency; a NEW report created afterward uses the new one',async()=>{
    const {reports,profiles,loads}=await setup();
    const cedar=await profiles.createConsultingAgency({nameEn:'Cedar Engineering'});
    const oak=await profiles.createConsultingAgency({nameEn:'Oakridge Partners'});
    await loads.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:cedar.id});

    const oldDraft=emptyDailyReport('project_1',{id:cedar.id,nameEn:'Cedar Engineering',nameAr:null});
    const oldReport=await reports.saveReport({...oldDraft,workDate:'2026-08-01',workDescription:'Paving'});

    // Project reassigned to a different agency.
    await loads.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:oak.id});

    const reloadedOld=(await reports.listReports('project_1')).find(r=>r.id===oldReport.id)!;
    expect(reloadedOld.consultingAgencyNameEn).toBe('Cedar Engineering');

    // A new report created after the reassignment uses the project's new agency.
    const setup2=await reports.getSetup();
    const project=setup2.projects.find(p=>p.id==='project_1')!;
    expect(project.consultingAgencyId).toBe(oak.id);
    const newDraft=emptyDailyReport('project_1',{id:project.consultingAgencyId!,nameEn:project.consultingAgencyNameEn!,nameAr:project.consultingAgencyNameAr??null});
    const newReport=await reports.saveReport({...newDraft,workDate:'2026-08-02',workDescription:'Second day'});
    expect(newReport.consultingAgencyNameEn).toBe('Oakridge Partners');
  });

  it('saving an old report for an unrelated field edit does not refresh its agency snapshot',async()=>{
    const {reports,profiles,loads}=await setup();
    const cedar=await profiles.createConsultingAgency({nameEn:'Cedar Engineering'});
    await loads.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:cedar.id});
    const draft=emptyDailyReport('project_1',{id:cedar.id,nameEn:'Cedar Engineering',nameAr:null});
    const saved=await reports.saveReport({...draft,workDate:'2026-08-01',workDescription:'Paving'});

    // The agency is renamed AFTER the report was saved, simulating "unrelated edit happens later."
    await profiles.updateConsultingAgency(cedar.id,{nameEn:'Renamed Agency'});

    // The screen re-saves the SAME report for an unrelated reason (editing notes), carrying forward
    // exactly the snapshot fields it already had -- this is what the editor actually does, since it
    // never re-derives these fields from anywhere except an explicit override action.
    const resaved=await reports.saveReport({...saved,id:saved.id,notes:'Unrelated note added later'});
    expect(resaved.consultingAgencyNameEn).toBe('Cedar Engineering');
    expect(resaved.notes).toBe('Unrelated note added later');
  });
});

describe('inactive-agency preservation on a report (DEC-417)',()=>{
  it('a report referencing a since-deactivated agency keeps its snapshot and its reference',async()=>{
    const {reports,profiles,loads}=await setup();
    const cedar=await profiles.createConsultingAgency({nameEn:'Cedar Engineering'});
    await loads.updateProjectInformation('project_1',{name:'Airport Road',location:'Beirut',consultingAgencyId:cedar.id});
    const draft=emptyDailyReport('project_1',{id:cedar.id,nameEn:'Cedar Engineering',nameAr:null});
    const saved=await reports.saveReport({...draft,workDate:'2026-08-01',workDescription:'Paving'});

    await profiles.setConsultingAgencyActive(cedar.id,false);

    const reloaded=(await reports.listReports('project_1')).find(r=>r.id===saved.id)!;
    expect(reloaded).toMatchObject({consultingAgencyId:cedar.id,consultingAgencyNameEn:'Cedar Engineering'});
  });
});
