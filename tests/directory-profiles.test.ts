import {afterEach,describe,expect,it} from 'vitest';

import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {SqliteWasteRepository} from '../src/data/repositories/SqliteWasteRepository';
import {SqliteWorkspaceRepository} from '../src/data/repositories/SqliteWorkspaceRepository';
import {emptyDailyReport} from '../src/domain/projectReports';
import {migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * DEC-476. One People directory: each person has one current role (Worker, Driver or Operator),
 * changing it edits the same record, and history keeps the role recorded at the time.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=await migratedDatabaseWithProject(databases);
  return {database,people:new SqliteLoadRepository(database as never),reports:new SqliteProjectReportRepository(database as never)};
}

describe('editing people',()=>{
  it('creates a person with a role and keeps every field',async()=>{
    const {people}=await setup();
    const created=await people.createPerson({name:'  Ali   Mansour ',role:'worker',jobTitle:'Steel fixer',phone:'71000000',licenseNumber:'',notes:'Reliable'});
    expect(created).toMatchObject({name:'Ali Mansour',role:'worker',jobTitle:'Steel fixer',phone:'71000000',licenseNumber:null,notes:'Reliable',isActive:true,roleHistory:[]});
    expect(await people.listPeople()).toEqual([created]);
  });

  it('updates a person in place, preserving the id and active state',async()=>{
    const {people}=await setup();
    const created=await people.createPerson({name:'Omar Haddad',role:'driver',phone:'70111111',licenseNumber:'L-1'});
    const updated=await people.updatePerson(created.id,{name:'Omar Senior Haddad',role:'driver',phone:'70222222',licenseNumber:'L-2',notes:'Renewed licence'});
    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({name:'Omar Senior Haddad',phone:'70222222',licenseNumber:'L-2',notes:'Renewed licence',isActive:true});
  });

  it('rejects a blank name, an unknown role, and a person that does not exist',async()=>{
    const {people}=await setup();
    const created=await people.createPerson({name:'Ali',role:'worker'});
    await expect(people.updatePerson(created.id,{name:'   ',role:'worker'})).rejects.toThrow('Name is required.');
    await expect(people.createPerson({name:'Sami',role:'foreman' as never})).rejects.toThrow('Choose Worker, Driver, or Operator.');
    await expect(people.updatePerson('missing',{name:'Anyone',role:'worker'})).rejects.toThrow('Person was not found.');
  });

  it('lets a deactivated person still be edited',async()=>{
    const {people}=await setup();
    const worker=await people.createPerson({name:'Ali',role:'worker'});
    await people.setPersonActive(worker.id,false);
    expect(await people.updatePerson(worker.id,{name:'Ali',role:'worker',jobTitle:'Updated'})).toMatchObject({jobTitle:'Updated',isActive:false});
  });

  it('moves one person Worker -> Driver -> Operator without creating a duplicate, recording each change',async()=>{
    const {people}=await setup();
    const ali=await people.createPerson({name:'Ali Mansour',role:'worker'});
    await people.updatePerson(ali.id,{name:'Ali Mansour',role:'driver'});
    const operator=await people.updatePerson(ali.id,{name:'Ali Mansour',role:'operator'});
    expect(operator.id).toBe(ali.id);
    expect(operator.role).toBe('operator');
    expect(operator.roleHistory.map(change=>[change.fromRole,change.toRole])).toEqual([['worker','driver'],['driver','operator']]);
    expect(await people.listPeople()).toHaveLength(1);
  });

  it('refuses a new person whose normalized name already exists in any role, active or not',async()=>{
    const {people}=await setup();
    const omar=await people.createPerson({name:'Omar Haddad',role:'driver'});
    await expect(people.createPerson({name:' omar  HADDAD',role:'operator'})).rejects.toThrow('Omar Haddad is already in People as a Driver.');
    await people.setPersonActive(omar.id,false);
    await expect(people.createPerson({name:'Omar Haddad',role:'worker'})).rejects.toThrow('already in People');
    const ali=await people.createPerson({name:'Ali',role:'worker'});
    await expect(people.updatePerson(ali.id,{name:'OMAR haddad',role:'worker'})).rejects.toThrow('already in People');
  });

  it('keeps a legacy duplicate editable while its name is unchanged',async()=>{
    const {database,people}=await setup();
    database.raw.exec(`INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES
      ('w','Karim Nasser',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','worker'),('d','Karim Nasser',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','driver')`);
    await expect(people.updatePerson('d',{name:'Karim Nasser',role:'operator',phone:'70'})).resolves.toMatchObject({role:'operator'});
  });

  it('never deletes a person; deactivation is the only removal path',async()=>{
    const {people}=await setup();
    const ali=await people.createPerson({name:'Ali',role:'worker'});
    await people.setPersonActive(ali.id,false);
    expect((await people.listPeople())[0]).toMatchObject({id:ali.id,isActive:false});
    await expect(people.setPersonActive('missing',true)).rejects.toThrow('Person was not found.');
  });

  it('queues every change for synchronization in the same transaction',async()=>{
    const {database,people}=await setup();
    const ali=await people.createPerson({name:'Ali',role:'worker'});
    await people.updatePerson(ali.id,{name:'Ali',role:'operator'});
    const entries=database.raw.prepare("SELECT entity_type,entity_id FROM sync_outbox WHERE entity_id=?").all(ali.id);
    expect(entries).toEqual([{entity_type:'person',entity_id:ali.id},{entity_type:'person',entity_id:ali.id}]);
  });
});

describe('role-aware selection across the app',()=>{
  it('offers each role in its own Daily Report list, and Operators as their own category',async()=>{
    const {people,reports}=await setup();
    await people.createPerson({name:'Ali',role:'worker',jobTitle:'Mason'});
    await people.createPerson({name:'Omar',role:'driver'});
    await people.createPerson({name:'Rami',role:'operator'});
    const inactive=await people.createPerson({name:'Old Operator',role:'operator'});
    await people.setPersonActive(inactive.id,false);
    const options=(await reports.getSetup()).presenceOptions;
    expect(options.workers.map(value=>value.label)).toEqual(['Ali']);
    expect(options.drivers.map(value=>value.label)).toEqual(['Omar']);
    expect(options.operators.map(value=>value.label)).toEqual(['Rami']);
  });

  it('keeps a historical report exactly as saved when a person later changes role, and offers them under the new role only',async()=>{
    const {people,reports}=await setup();
    const ali=await people.createPerson({name:'Ali',role:'driver'});
    const saved=await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-20',workDescription:'Hauling',drivers:['Ali'],
      workerSafety:[{workerName:'Ali',participantType:'driver',status:'compliant',missingItems:[],notes:''}]});
    await people.updatePerson(ali.id,{name:'Ali',role:'operator'});
    const reread=(await reports.listReports('road'))[0]!;
    expect(reread.drivers).toEqual(['Ali']);
    expect(reread.operators).toEqual([]);
    expect(reread.workerSafety).toEqual(saved.workerSafety);
    const options=(await reports.getSetup()).presenceOptions;
    expect(options.drivers.map(value=>value.label)).not.toContain('Ali');
    expect(options.operators.map(value=>value.label)).toEqual(['Ali']);
  });

  it('saves Operators with their own PPE entries alongside workers and drivers',async()=>{
    const {reports}=await setup();
    const saved=await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-21',workDescription:'Grading',workers:['Ali'],drivers:['Omar'],operators:['Rami'],
      workerSafety:[{workerName:'Rami',participantType:'operator',status:'missing',missingItems:['Helmet'],notes:''}]});
    expect(saved.operators).toEqual(['Rami']);
    expect(saved.workerSafety?.map(value=>[value.workerName,value.participantType,value.status])).toEqual([
      ['Ali','worker','not_checked'],['Omar','driver','not_checked'],['Rami','operator','missing'],
    ]);
  });

  it('still offers a previously entered free-text name, but not a name that is now a saved person',async()=>{
    const {people,reports}=await setup();
    await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-22',workDescription:'Work',drivers:['Casual Hauler','Ali']});
    await people.createPerson({name:'Ali',role:'operator'});
    const options=(await reports.getSetup()).presenceOptions;
    expect(options.drivers.map(value=>[value.label,value.detail])).toEqual([['Casual Hauler','Previously entered']]);
  });

  it('keeps Waste and Supplier Load driver pickers to Drivers only, never Workers or Operators',async()=>{
    const {database,people}=await setup();
    await people.createPerson({name:'Ali',role:'worker'});
    await people.createPerson({name:'Omar',role:'driver'});
    await people.createPerson({name:'Rami',role:'operator'});
    expect((await new SqliteWasteRepository(database as never).getSetup()).drivers.map(value=>value.name)).toEqual(['Omar']);
    expect((await new SqliteQuarryRepository(database as never).getSetup()).drivers.map(value=>value.name)).toEqual(['Omar']);
  });

  it('labels people by their current role in global search',async()=>{
    const {database,people}=await setup();
    await people.createPerson({name:'Rami Saad',role:'operator'});
    await people.createPerson({name:'Rami Worker',role:'worker'});
    const results=await new SqliteWorkspaceRepository(database as never).search('Rami');
    expect(results.filter(value=>value.route==='directory').map(value=>[value.title,value.kind]).sort()).toEqual([['Rami Saad','Operator'],['Rami Worker','Worker']]);
  });
});
