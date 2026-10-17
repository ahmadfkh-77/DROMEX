import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteWasteRepository} from '../src/data/repositories/SqliteWasteRepository';
import {asWasteLocation,parseWasteLocationKey,wasteLocationKey,wasteLocationOf,type WasteCounterDraft} from '../src/domain/waste';
import {buildWasteHistory,wasteRangeFor} from '../src/domain/wasteHistory';
import {buildWasteHistoryHtml} from '../src/services/wasteHistoryTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Waste dump Location: a dump and a driver counter belong to a project or a company site. A site dump belongs to no project, so no project
 * total or Daily Report counts it. Existing dumps and counters are copied across by the rebuild with their project and nothing moved.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-16T09:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const read=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO company_sites (id,name,name_key,is_active,created_at,updated_at) VALUES ('plant','Main plant','main plant',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO company_sites (id,name,name_key,is_active,created_at,updated_at) VALUES ('old','Old yard','old yard',0,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO driver_profiles (id,name,is_active,person_role,created_at,updated_at) VALUES ('omar','Omar',1,'driver','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('mixer','L 204118',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const repository=new SqliteWasteRepository(db as never);
  const counter:WasteCounterDraft={driverProfileId:'omar',truckProfileId:'mixer',materialType:'Concrete waste',dumpLocation:'Dump area A',notes:''};
  return {db,repository,counter};
}

describe('locations (pure)',()=>{
  it('names a location from a dump: a project, or a company site',()=>{
    expect(wasteLocationOf({projectId:'p1',projectName:'Mountain Road'})).toEqual({type:'project',id:'p1',name:'Mountain Road',key:'project:p1'});
    expect(wasteLocationOf({projectId:null,projectName:null,companySiteId:'s1',companySiteName:'Main plant'})).toEqual({type:'company_site',id:'s1',name:'Main plant',key:'site:s1'});
  });
  it('turns a location into a key and back, and still accepts a bare project id',()=>{
    expect(wasteLocationKey({type:'project',id:'p1'})).toBe('project:p1');expect(wasteLocationKey({type:'company_site',id:'s1'})).toBe('site:s1');
    expect(parseWasteLocationKey('project:p1')).toEqual({type:'project',id:'p1'});expect(parseWasteLocationKey('site:s1')).toEqual({type:'company_site',id:'s1'});
    for(const bad of ['','project:','site:','p1','other:1'])expect(parseWasteLocationKey(bad),bad).toBeNull();
    expect(asWasteLocation('p1')).toEqual({type:'project',id:'p1'});expect(asWasteLocation({type:'company_site',id:'s1'})).toEqual({type:'company_site',id:'s1'});
  });
});

describe('the migration',()=>{
  it('copies every existing dump and counter across with its project, and keeps the rules',async()=>{
    const {db}=await setup();
    db.raw.exec(`
      DROP TABLE waste_dumps;DROP TABLE waste_counter_presets;
      CREATE TABLE waste_dumps (id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),work_date TEXT NOT NULL,dumped_at TEXT NOT NULL,material_type TEXT,dump_location TEXT,truck_profile_id TEXT REFERENCES truck_profiles(id),truck_plate TEXT,driver_profile_id TEXT REFERENCES driver_profiles(id),driver_name TEXT,notes TEXT,status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Cancelled')),cancellation_reason TEXT,cancelled_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE waste_counter_presets (id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),driver_profile_id TEXT NOT NULL REFERENCES driver_profiles(id),truck_profile_id TEXT NOT NULL REFERENCES truck_profiles(id),material_type TEXT,dump_location TEXT,notes TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(project_id,driver_profile_id,truck_profile_id));
      INSERT INTO waste_dumps (id,project_id,work_date,dumped_at,material_type,driver_profile_id,driver_name,status,cancellation_reason,cancelled_at,created_at,updated_at) VALUES ('d1','road','2026-10-01','2026-10-01T08:00:00.000Z','Rock','omar','Omar','Active',NULL,NULL,'${SEED_TIME}','${SEED_TIME}');
      INSERT INTO waste_dumps (id,project_id,work_date,dumped_at,status,cancellation_reason,cancelled_at,created_at,updated_at) VALUES ('d2','road','2026-10-02','2026-10-02T08:00:00.000Z','Cancelled','Entered twice','2026-10-02T09:00:00.000Z','${SEED_TIME}','${SEED_TIME}');
      INSERT INTO waste_counter_presets (id,project_id,driver_profile_id,truck_profile_id,material_type,created_at,updated_at) VALUES ('c1','road','omar','mixer','Rock','${SEED_TIME}','${SEED_TIME}');
      PRAGMA user_version = 61;
    `);
    await migrateDatabase(db as never);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect(db.raw.prepare("SELECT project_id,company_site_id,status,cancellation_reason,material_type,driver_name FROM waste_dumps ORDER BY id").all()).toEqual([
      {project_id:'road',company_site_id:null,status:'Active',cancellation_reason:null,material_type:'Rock',driver_name:'Omar'},
      {project_id:'road',company_site_id:null,status:'Cancelled',cancellation_reason:'Entered twice',material_type:null,driver_name:null}]);
    expect(db.raw.prepare('SELECT project_id,company_site_id,driver_profile_id FROM waste_counter_presets').all()).toEqual([{project_id:'road',company_site_id:null,driver_profile_id:'omar'}]);
    const repository=new SqliteWasteRepository(db as never);
    expect((await repository.listWasteDumps('road')).map(dump=>dump.id).sort()).toEqual(['d1','d2']);
    expect((await repository.listWasteCounters('road'))).toHaveLength(1);
  });
  it('enforces exactly one location and one counter per driver and truck at each location',async()=>{
    const {db}=await setup();
    const insert=(project:string|null,site:string|null)=>db.raw.exec(`INSERT INTO waste_dumps (id,project_id,company_site_id,work_date,dumped_at,created_at,updated_at) VALUES ('x${Math.random()}',${project?`'${project}'`:'NULL'},${site?`'${site}'`:'NULL'},'2026-10-16','2026-10-16T08:00:00.000Z','${SEED_TIME}','${SEED_TIME}')`);
    expect(()=>insert(null,null)).toThrow();expect(()=>insert('road','plant')).toThrow();expect(()=>insert('road',null)).not.toThrow();expect(()=>insert(null,'plant')).not.toThrow();
  });
});

describe('counting at a company site',()=>{
  it('lists active sites beside projects',async()=>{
    const {repository}=await setup();
    const setupInfo=await repository.getSetup();
    expect(setupInfo.companySites).toEqual([{id:'plant',name:'Main plant'}]);
    expect(setupInfo.projects.map(project=>project.id)).toEqual(['road']);
  });
  it('records a one-off dump at a site with its name, no project, and the same rules for the date',async()=>{
    const {repository}=await setup();
    const dump=await repository.addWasteDump({type:'company_site',id:'plant'},'2026-10-16');
    expect(dump).toMatchObject({projectId:null,projectName:null,companySiteId:'plant',companySiteName:'Main plant',workDate:'2026-10-16',status:'Active'});
    expect(wasteLocationOf(dump).key).toBe('site:plant');
    await expect(repository.addWasteDump({type:'company_site',id:'plant'},'2026-12-01')).rejects.toThrow('today or a valid past date');
    await expect(repository.addWasteDump({type:'company_site',id:'old'},'2026-10-16')).rejects.toThrow('active company site');
    await expect(repository.addWasteDump({type:'company_site',id:'missing'},'2026-10-16')).rejects.toThrow('active company site');
    await expect(repository.addWasteDump('missing','2026-10-16')).rejects.toThrow('active project');
    expect((await repository.listWasteDumps('road'))).toHaveLength(0);
  });
  it('keeps a bare project id working for a project',async()=>{
    const {repository}=await setup();
    const dump=await repository.addWasteDump('road','2026-10-16');
    expect(dump).toMatchObject({projectId:'road',projectName:'Mountain Road',companySiteId:null,companySiteName:null});
    await expect(repository.addWasteDump('road','2026-07-01')).rejects.toThrow('within the selected project dates');
  });
  it('counts with a driver counter at a site, and keeps a site and a project apart',async()=>{
    const {repository,counter}=await setup();
    const siteCounter=await repository.saveWasteCounter({type:'company_site',id:'plant'},counter);
    expect(siteCounter).toMatchObject({projectId:null,companySiteId:'plant',driverName:'Omar',truckPlate:'L 204118'});
    const projectCounter=await repository.saveWasteCounter('road',counter);
    expect(projectCounter).toMatchObject({projectId:'road',companySiteId:null});
    expect((await repository.listWasteCounters({type:'company_site',id:'plant'})).map(value=>value.id)).toEqual([siteCounter.id]);
    expect((await repository.listWasteCounters('road')).map(value=>value.id)).toEqual([projectCounter.id]);
    await expect(repository.saveWasteCounter({type:'company_site',id:'plant'},counter)).rejects.toThrow('This company site already has a counter');
    await expect(repository.saveWasteCounter('road',counter)).rejects.toThrow('This project already has a counter');
    const tap=await repository.addWasteDumpFromCounter(siteCounter.id,'2026-10-16');
    expect(tap).toMatchObject({projectId:null,companySiteId:'plant',companySiteName:'Main plant',driverName:'Omar',truckPlate:'L 204118',materialType:'Concrete waste',dumpLocation:'Dump area A'});
    const projectTap=await repository.addWasteDumpFromCounter(projectCounter.id,'2026-10-16');
    expect(projectTap).toMatchObject({projectId:'road',companySiteId:null});
    expect((await repository.listWasteDumps({type:'company_site',id:'plant'})).map(dump=>dump.id)).toEqual([tap.id]);
    expect((await repository.listWasteDumps('road')).map(dump=>dump.id)).toEqual([projectTap.id]);
  });
  it('stops a counter at a site that is no longer active, and a site\'s name stays as it was counted',async()=>{
    const {db,repository,counter}=await setup();
    const siteCounter=await repository.saveWasteCounter({type:'company_site',id:'plant'},counter);
    const tap=await repository.addWasteDumpFromCounter(siteCounter.id,'2026-10-16');
    db.raw.exec("UPDATE company_sites SET name='Main plant (renamed)' WHERE id='plant'");
    expect((await repository.listWasteDumps({type:'company_site',id:'plant'})).find(dump=>dump.id===tap.id)?.companySiteName).toBe('Main plant');
    db.raw.exec("UPDATE company_sites SET is_active=0 WHERE id='plant'");
    await expect(repository.addWasteDumpFromCounter(siteCounter.id,'2026-10-16')).rejects.toThrow('active company site');
  });
  it('lets a site dump be edited and cancelled like any other',async()=>{
    const {repository}=await setup();
    const dump=await repository.addWasteDump({type:'company_site',id:'plant'},'2026-10-16');
    const edited=await repository.updateWasteDump(dump.id,{materialType:'Soil',dumpLocation:'Area B',truckProfileId:'mixer',driverProfileId:'omar',notes:''});
    expect(edited).toMatchObject({materialType:'Soil',companySiteId:'plant',driverName:'Omar'});
    await expect(repository.cancelWasteDump(dump.id,' ')).rejects.toThrow('reason');
    expect(await repository.cancelWasteDump(dump.id,'Entered twice')).toMatchObject({status:'Cancelled',companySiteId:'plant'});
  });
});

describe('totals, history and the site summary',()=>{
  it('keeps site dumps out of the project totals and the project summary',async()=>{
    const {repository}=await setup();
    await repository.addWasteDump('road','2026-10-16');await repository.addWasteDump({type:'company_site',id:'plant'},'2026-10-16');await repository.addWasteDump({type:'company_site',id:'plant'},'2026-10-15');
    expect((await repository.getProjectSummary('road')).activeCount).toBe(1);
    expect((await repository.listWasteDumps('road'))).toHaveLength(1);
  });
  it('groups the history by location, with a project and a site apart, and filters by one',async()=>{
    const {repository,counter}=await setup();
    const siteCounter=await repository.saveWasteCounter({type:'company_site',id:'plant'},counter);
    await repository.addWasteDumpFromCounter(siteCounter.id,'2026-10-16');await repository.addWasteDumpFromCounter(siteCounter.id,'2026-10-16');
    await repository.addWasteDump('road','2026-10-16');
    const range=wasteRangeFor('custom','2026-10-16',{fromDate:'2026-10-10',toDate:'2026-10-16'});
    const rows=await repository.listWasteHistory(range.fromDate,range.toDate);
    const all=buildWasteHistory(rows,range);
    expect(all.total).toBe(3);
    expect(all.days[0]!.projects.map(block=>[block.locationKey,block.locationType,block.projectName,block.total])).toEqual([['site:plant','company_site','Main plant',2],['project:road','project','Mountain Road',1]]);
    expect(buildWasteHistory(rows,range,'site:plant').total).toBe(2);expect(buildWasteHistory(rows,range,'project:road').total).toBe(1);expect(buildWasteHistory(rows,range,'road').total).toBe(1);
    const html=buildWasteHistoryHtml({companyName:'DROMEX',logoUri:null,contactLine:null,generatedAt:'2026-10-16T09:00:00.000Z',projectLabel:'All locations',periodLabel:'Mon 10 Oct',history:all,includeAllProjectsDriverTotals:true} as never);
    expect(html).toContain('COMPANY SITE');expect(html).toContain('Main plant');expect(html).toContain('Site total');expect(html).toContain('Project total');expect(html).toContain('Location');
  });
  it('summarises a site over the dates asked for, with its dumps by material, driver and dump area',async()=>{
    const {repository,counter}=await setup();
    const siteCounter=await repository.saveWasteCounter({type:'company_site',id:'plant'},counter);
    await repository.addWasteDumpFromCounter(siteCounter.id,'2026-10-14');await repository.addWasteDumpFromCounter(siteCounter.id,'2026-10-14');
    const last=await repository.addWasteDumpFromCounter(siteCounter.id,'2026-10-16');
    await repository.cancelWasteDump(last.id,'Entered twice');
    await repository.addWasteDump({type:'company_site',id:'plant'},'2026-10-15');
    const all=await repository.getSiteSummary('plant');
    expect(all).toMatchObject({site:{id:'plant',name:'Main plant'},activeCount:3,cancelledCount:1,daysWithDumps:2});
    expect(all.byMaterial).toEqual([{label:'Concrete waste',count:2},{label:'Unspecified material',count:1}]);
    expect(all.byDriver).toEqual([{label:'Omar',count:2},{label:'No driver',count:1}]);
    expect(all.byLocation).toEqual([{label:'Dump area A',count:2},{label:'Unspecified location',count:1}]);
    const ranged=await repository.getSiteSummary('plant','2026-10-15','2026-10-16');
    expect(ranged).toMatchObject({activeCount:1,cancelledCount:1,daysWithDumps:1});
    await expect(repository.getSiteSummary('missing')).rejects.toThrow('not found');
  });
});

describe('the screens',()=>{
  const screen=read('src/ui/screens/WasteDumpScreen.tsx'),history=read('src/ui/components/WasteHistoryView.tsx');
  it('asks for a Location, one grouped list of projects and company sites',()=>{
    expect(screen).toContain('<GroupedSearchableSelect label="Location *"');expect(screen).toContain("label:'PROJECTS'");expect(screen).toContain("label:'COMPANY SITES'");
    expect(screen).toContain('Select a location (a project or a company site)');expect(screen).not.toContain('label="Project *"');
  });
  it('counts and adds dumps at the chosen location, and shows counters for a site',()=>{
    expect(screen).toContain('repository.addWasteDump(location,recordDate)');expect(screen).toContain('repository.saveWasteCounter(location,counterDraft');
    expect(screen).toContain("{project?.status==='active'||site?<>");expect(screen).toContain("label={site?'Site total':'Project total'}");
  });
  it('shows a running site summary instead of a project summary, and sends the history the location keys',()=>{
    expect(screen).toContain('View site waste summary');expect(screen).toContain('title="Site waste summary"');expect(screen).toContain('repository.getSiteSummary(where.id)');
    expect(screen).toContain('initialLocationKey={locationKey||undefined}');
    expect(history).toContain('label="Location"');expect(history).toContain('placeholder="All locations"');expect(history).toContain("block.locationType==='company_site'?'COMPANY SITE':'PROJECT'");
  });
});
