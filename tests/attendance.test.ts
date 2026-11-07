import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteAttendanceRepository} from '../src/data/repositories/SqliteAttendanceRepository';
import {buildAttendanceSheet,validateAttendancePlaces,type AttendanceEntry} from '../src/domain/attendance';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/** DEC-544. A simple who-worked-where sheet: presence and places only, no hours, no pay. */
const open:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of open.splice(0))database.close();});
const DAY='2026-11-06';

async function setup(){
  const db=await migratedDatabaseWithProject(open);
  db.raw.exec(`
    INSERT INTO driver_profiles (id,name,person_role,is_active,created_at,updated_at) VALUES ('drv1','Samir','driver',1,'${SEED_TIME}','${SEED_TIME}'),('drv2','Old Driver','driver',0,'${SEED_TIME}','${SEED_TIME}'),('wrk1','Karim','operator',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,make_model,is_active,created_at,updated_at) VALUES ('trk1','T-12','Tipper',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO machine_profiles (id,name,machine_type,is_active,created_at,updated_at) VALUES ('mch1','Excavator E-3','Excavator',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO company_sites (id,name,name_key,is_active,created_at,updated_at) VALUES ('site1','Main Plant','main plant',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  return {db,repo:new SqliteAttendanceRepository(db as never)};
}
const road={type:'project' as const,id:'road',name:'ignored'};
const plant={type:'company_site' as const,id:'site1',name:'ignored'};

describe('attendance migration',()=>{
  it('adds the two attendance tables in migration 68 or later',async()=>{
    const {db}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(68);
    const tables=(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'daily_attendance%'").all() as {name:string}[]).map(r=>r.name).sort();
    expect(tables).toEqual(['daily_attendance','daily_attendance_places']);
  });
});

describe('validateAttendancePlaces',()=>{
  it('needs at least one place',()=>{expect(()=>validateAttendancePlaces([])).toThrow(/at least one place/i);});
  it('trims typed places, drops duplicates and refuses an empty typed place',()=>{
    expect(validateAttendancePlaces([{type:'typed',id:null,name:'  Yard  '},{type:'typed',id:null,name:'yard'},{type:'project',id:'a',name:'A'},{type:'project',id:'a',name:'A'}]).map(p=>p.name)).toEqual(['Yard','A']);
    expect(()=>validateAttendancePlaces([{type:'typed',id:null,name:'   '}])).toThrow(/name/i);
  });
  it('refuses a project or site without an id and more than 10 places',()=>{
    expect(()=>validateAttendancePlaces([{type:'project',id:null,name:'x'}])).toThrow();
    expect(()=>validateAttendancePlaces(Array.from({length:11},(_,i)=>({type:'typed' as const,id:null,name:`P${i}`})))).toThrow(/10/);
  });
});

describe('SqliteAttendanceRepository',()=>{
  it('lists only the active people, trucks, machines, projects and sites, with the day\'s entries',async()=>{
    const {repo}=await setup();
    const result=await repo.getSetup(DAY);
    expect(result.people.map(p=>[p.subjectType,p.name,p.detail])).toEqual([['person','Karim','Operator'],['person','Samir','Driver']]);
    expect(result.trucks.map(p=>p.name)).toEqual(['T-12']);expect(result.machines.map(p=>p.name)).toEqual(['Excavator E-3']);
    expect(result.projects.map(p=>p.name)).toEqual(['Mountain Road']);expect(result.sites.map(p=>p.name)).toEqual(['Main Plant']);expect(result.entries).toEqual([]);
  });
  it('saves a worked entry with its places, keeps the name as it was, and writes a sync_outbox entry in the same call',async()=>{
    const {db,repo}=await setup();
    const entry=await repo.saveEntry(DAY,{type:'person',id:'drv1'},[road,plant,{type:'typed',id:null,name:'Yard'}]);
    expect(entry).toMatchObject({workDate:DAY,subjectType:'person',subjectId:'drv1',name:'Samir',detail:'Driver'});
    expect(entry.places.map(p=>[p.type,p.name])).toEqual([['project','Mountain Road'],['company_site','Main Plant'],['typed','Yard']]);
    const outbox=db.raw.prepare("SELECT entity_type,operation FROM sync_outbox WHERE entity_type='dailyAttendance'").all() as {entity_type:string;operation:string}[];
    expect(outbox).toEqual([{entity_type:'dailyAttendance',operation:'upsert'}]);
  });
  it('keeps one entry per person per day: saving again replaces the places',async()=>{
    const {db,repo}=await setup();
    await repo.saveEntry(DAY,{type:'truck',id:'trk1'},[road]);await repo.saveEntry(DAY,{type:'truck',id:'trk1'},[plant]);
    const list=await repo.listDay(DAY);expect(list).toHaveLength(1);expect(list[0]!.places.map(p=>p.name)).toEqual(['Main Plant']);
    expect((db.raw.prepare('SELECT COUNT(*) c FROM daily_attendance_places').get() as {c:number}).c).toBe(1);
  });
  it('does not change a past day when a profile is renamed later',async()=>{
    const {db,repo}=await setup();
    await repo.saveEntry(DAY,{type:'machine',id:'mch1'},[road]);db.raw.exec("UPDATE machine_profiles SET name='Excavator Renamed' WHERE id='mch1'");
    expect((await repo.listDay(DAY))[0]!.name).toBe('Excavator E-3');
  });
  it('removes an entry (the tick taken off) with a delete outbox entry',async()=>{
    const {db,repo}=await setup();
    await repo.saveEntry(DAY,{type:'person',id:'wrk1'},[road]);await repo.removeEntry(DAY,{type:'person',id:'wrk1'});
    expect(await repo.listDay(DAY)).toEqual([]);
    const ops=(db.raw.prepare("SELECT operation FROM sync_outbox WHERE entity_type='dailyAttendance' ORDER BY id").all() as {operation:string}[]).map(r=>r.operation);
    expect(ops).toEqual(['upsert','delete']);
  });
  it('lists one day only and works for any past or future day',async()=>{
    const {repo}=await setup();
    await repo.saveEntry('2026-10-01',{type:'person',id:'drv1'},[road]);await repo.saveEntry('2027-01-05',{type:'person',id:'drv1'},[road]);
    expect((await repo.listDay('2026-10-01')).length).toBe(1);expect(await repo.listDay(DAY)).toEqual([]);
  });
  it('creates no project or site for a typed place, and refuses an unknown project, an unknown person and an empty place list',async()=>{
    const {db,repo}=await setup();
    await repo.saveEntry(DAY,{type:'person',id:'drv1'},[{type:'typed',id:null,name:'Roadside'}]);
    expect((db.raw.prepare('SELECT COUNT(*) c FROM projects').get() as {c:number}).c).toBe(1);expect((db.raw.prepare('SELECT COUNT(*) c FROM company_sites').get() as {c:number}).c).toBe(1);
    await expect(repo.saveEntry(DAY,{type:'person',id:'drv1'},[{type:'project',id:'nope',name:'x'}])).rejects.toThrow(/project/i);
    await expect(repo.saveEntry(DAY,{type:'person',id:'ghost'},[road])).rejects.toThrow(/not found/i);
    await expect(repo.saveEntry(DAY,{type:'person',id:'drv1'},[])).rejects.toThrow(/at least one place/i);
  });
  it('stores no hours, pay or time columns at all',async()=>{
    const {db}=await setup();
    const columns=(db.raw.prepare('PRAGMA table_info(daily_attendance)').all() as {name:string}[]).map(c=>c.name.toLowerCase()).join(' ');
    expect(columns).not.toMatch(/hour|pay|wage|salary|overtime|check_?in|check_?out/);
  });
});

describe('buildAttendanceSheet',()=>{
  const entry=(over:Partial<AttendanceEntry>):AttendanceEntry=>({id:'e',workDate:DAY,subjectType:'person',subjectId:'d',name:'Samir',detail:'Driver',places:[{type:'project',id:'road',name:'Airport Road'},{type:'typed',id:null,name:'Yard'}],...over});
  it('groups into People (drivers, operators and workers), Trucks and Machines, sorted by name, with every place in "worked at"',()=>{
    const sheet=buildAttendanceSheet([entry({}),entry({subjectType:'person',name:'Karim',detail:'Operator'}),entry({subjectType:'truck',name:'T-12',detail:'Tipper'}),entry({subjectType:'machine',name:'Excavator E-3',detail:'Excavator'})]);
    expect(sheet.people.map(r=>r.name)).toEqual(['Karim','Samir']);
    expect(sheet.people[1]!.workedAt).toBe('Airport Road, Yard');expect(sheet.trucks).toHaveLength(1);expect(sheet.machines).toHaveLength(1);
  });
  it('is empty when nobody worked',()=>{expect(buildAttendanceSheet([]).count).toBe(0);});
});
