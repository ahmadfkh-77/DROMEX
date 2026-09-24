import {afterEach,describe,expect,it} from 'vitest';

import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {SqliteSupervisorRepository} from '../src/data/repositories/SqliteSupervisorRepository';
import {emptyDailyReport} from '../src/domain/projectReports';
import {addSupervisorSignoff} from '../src/domain/supervisors';
import {cloudSafeRow,entityTable,isSyncTable} from '../src/services/cloud/SyncSchema';
import {migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/** DEC-479. Saved supervisors with optional saved signatures, snapshotted into Daily Reports. */
const SIGNATURE=['M 20.0 80.5 L 60.2 40.0 L 110.1 90.4','M 130.0 70.0 L 200.0 72.5'];
const REPLACEMENT=['M 5.0 5.0 L 300.0 130.0'];
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=await migratedDatabaseWithProject(databases);
  return {database,supervisors:new SqliteSupervisorRepository(database as never),reports:new SqliteProjectReportRepository(database as never)};
}

describe('supervisor profiles',()=>{
  it('saves several supervisors, name only or with a title, unique by normalized name',async()=>{
    const {supervisors}=await setup();
    const nadim=await supervisors.createSupervisor({name:'  Nadim   Aoun ',jobTitle:'Resident Engineer'});
    const lina=await supervisors.createSupervisor({name:'Lina Khoury'});
    expect(nadim).toMatchObject({name:'Nadim Aoun',jobTitle:'Resident Engineer',signature:[],isActive:true});
    expect(lina).toMatchObject({jobTitle:null});
    expect((await supervisors.listSupervisors()).map(value=>value.name)).toEqual(['Nadim Aoun','Lina Khoury']);
    await expect(supervisors.createSupervisor({name:'NADIM aoun'})).rejects.toThrow('A supervisor named "Nadim Aoun" already exists.');
    await expect(supervisors.createSupervisor({name:''})).rejects.toThrow('Supervisor name is required.');
  });

  it('edits in place and archives instead of deleting',async()=>{
    const {supervisors}=await setup();
    const nadim=await supervisors.createSupervisor({name:'Nadim Aoun'});
    expect(await supervisors.updateSupervisor(nadim.id,{name:'Nadim A. Aoun',jobTitle:'Site Supervisor'})).toMatchObject({id:nadim.id,name:'Nadim A. Aoun',jobTitle:'Site Supervisor'});
    await supervisors.setSupervisorActive(nadim.id,false);
    expect((await supervisors.listSupervisors())[0]).toMatchObject({id:nadim.id,isActive:false});
    await expect(supervisors.updateSupervisor('missing',{name:'X'})).rejects.toThrow('Supervisor was not found.');
  });
});

describe('saved signatures',()=>{
  it('stores each supervisor\'s own signature and never touches another supervisor\'s',async()=>{
    const {supervisors}=await setup();
    const nadim=await supervisors.createSupervisor({name:'Nadim Aoun'});
    const lina=await supervisors.createSupervisor({name:'Lina Khoury'});
    await supervisors.saveSupervisorSignature(nadim.id,SIGNATURE);
    await supervisors.saveSupervisorSignature(lina.id,REPLACEMENT);
    const byId=new Map((await supervisors.listSupervisors()).map(value=>[value.id,value]));
    expect(byId.get(nadim.id)).toMatchObject({signature:SIGNATURE,signatureDamaged:false});
    expect(byId.get(nadim.id)?.signatureUpdatedAt).toBeTruthy();
    expect(byId.get(lina.id)?.signature).toEqual(REPLACEMENT);
  });

  it('rejects anything that is not signature stroke data, without saving it',async()=>{
    const {database,supervisors}=await setup();
    const nadim=await supervisors.createSupervisor({name:'Nadim Aoun'});
    await expect(supervisors.saveSupervisorSignature(nadim.id,['M 1 1 L 2 2" onload="steal()'])).rejects.toThrow('The signature data is not valid.');
    await expect(supervisors.saveSupervisorSignature(nadim.id,['file:///data/user/0/sig.png'])).rejects.toThrow('The signature data is not valid.');
    expect(database.raw.prepare('SELECT signature_json FROM supervisors WHERE id=?').get(nadim.id)).toEqual({signature_json:'[]'});
  });

  it('removes a saved signature, leaving the supervisor available by name',async()=>{
    const {supervisors}=await setup();
    const nadim=await supervisors.createSupervisor({name:'Nadim Aoun'});
    await supervisors.saveSupervisorSignature(nadim.id,SIGNATURE);
    await supervisors.saveSupervisorSignature(nadim.id,[]);
    expect((await supervisors.listSupervisors())[0]).toMatchObject({signature:[],signatureUpdatedAt:expect.any(String)});
  });

  it('reports a damaged stored signature instead of failing to load',async()=>{
    const {database,supervisors}=await setup();
    const nadim=await supervisors.createSupervisor({name:'Nadim Aoun'});
    database.raw.exec(`UPDATE supervisors SET signature_json='{not json' WHERE id='${nadim.id}'`);
    expect((await supervisors.listSupervisors())[0]).toMatchObject({signature:[],signatureDamaged:true});
  });

  it('is never an uploadable entity: the dormant cloud sync has no route for supervisors or their signatures',()=>{
    expect(entityTable.supervisor).toBeUndefined();
    expect(isSyncTable('supervisors')).toBe(false);
  });

  it('keeps report sign-off strokes on the device: out of the sync queue and out of any cloud row',async()=>{
    const {database,reports}=await setup();
    const saved=await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-23',workDescription:'Work',supervisorSignoffs:[{supervisorId:'s',name:'Nadim',jobTitle:null,display:'name_with_signature',signature:SIGNATURE}]});
    const queued=database.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='dailyProjectReport' AND entity_id=?").get(saved.id) as {payload_json:string};
    expect(queued.payload_json).toContain('Nadim');
    expect(queued.payload_json).not.toContain('M 20.0');
    const row=database.raw.prepare('SELECT * FROM daily_project_reports WHERE id=?').get(saved.id) as Record<string,unknown>;
    expect(cloudSafeRow('daily_project_reports',row)).not.toHaveProperty('supervisor_signoffs_json');
    expect(cloudSafeRow('daily_project_reports',row)).toHaveProperty('work_description','Work');
  });

  it('never writes signature strokes into the synchronization queue',async()=>{
    const {database,supervisors}=await setup();
    const nadim=await supervisors.createSupervisor({name:'Nadim Aoun'});
    await supervisors.saveSupervisorSignature(nadim.id,SIGNATURE);
    const payloads=database.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='supervisor'").all().map(row=>(row as {payload_json:string}).payload_json);
    expect(payloads.length).toBe(2);
    for(const payload of payloads)expect(payload).not.toContain('M 20.0');
  });
});

describe('Daily Report supervisor sign-off snapshots',()=>{
  it('keeps the report\'s own copy after the profile is renamed, re-signed, signature removed, and archived',async()=>{
    const {supervisors,reports}=await setup();
    const nadim=await supervisors.createSupervisor({name:'Nadim Aoun',jobTitle:'Resident Engineer'});
    const lina=await supervisors.createSupervisor({name:'Lina Khoury'});
    await supervisors.saveSupervisorSignature(nadim.id,SIGNATURE);
    const [signedProfile,nameOnlyProfile]=[(await supervisors.listSupervisors()).find(v=>v.id===nadim.id)!,(await supervisors.listSupervisors()).find(v=>v.id===lina.id)!];
    let signoffs=addSupervisorSignoff([],nameOnlyProfile,'name_only');
    signoffs=addSupervisorSignoff(signoffs,signedProfile,'name_with_signature');
    await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-20',workDescription:'Pour',supervisorSignoffs:signoffs});
    await supervisors.updateSupervisor(nadim.id,{name:'Nadim X',jobTitle:''});
    await supervisors.saveSupervisorSignature(nadim.id,REPLACEMENT);
    await supervisors.saveSupervisorSignature(nadim.id,[]);
    await supervisors.setSupervisorActive(nadim.id,false);
    const saved=(await reports.listReports('road'))[0]!;
    expect(saved.supervisorSignoffs).toEqual([
      {supervisorId:lina.id,name:'Lina Khoury',jobTitle:null,display:'name_only',signature:[]},
      {supervisorId:nadim.id,name:'Nadim Aoun',jobTitle:'Resident Engineer',display:'name_with_signature',signature:SIGNATURE},
    ]);
  });

  it('offers only active supervisors for new selection and reads older reports as having no sign-off',async()=>{
    const {supervisors,reports}=await setup();
    await supervisors.createSupervisor({name:'Active One'});
    const archived=await supervisors.createSupervisor({name:'Archived One'});
    await supervisors.setSupervisorActive(archived.id,false);
    expect((await reports.getSetup()).supervisors.map(value=>value.name)).toEqual(['Active One']);
    await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-21',workDescription:'Work'});
    expect((await reports.listReports('road'))[0]!.supervisorSignoffs).toEqual([]);
  });

  it('drops any invalid stroke a caller tries to save into a report snapshot',async()=>{
    const {reports}=await setup();
    await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-22',workDescription:'Work',
      supervisorSignoffs:[{supervisorId:'s',name:'Nadim',jobTitle:null,display:'name_with_signature',signature:['<script>alert(1)</script>']}]});
    expect((await reports.listReports('road'))[0]!.supervisorSignoffs).toEqual([{supervisorId:'s',name:'Nadim',jobTitle:null,display:'name_only',signature:[]}]);
  });
});
