import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';
import type {DailyProjectReport,LinkedWallWork,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import type {WallBaseDraft} from '../src/domain/wallBase';
import type {WallConsumptionDraft} from '../src/domain/walls';
import {dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';

class TestDatabase {
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}
const NOW='2026-09-01T00:00:00.000Z';
const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

const report:DailyProjectReport={id:'report',projectId:'road',workDate:'2026-09-01',workDescription:'Base pour',workers:[],workerSafety:[],drivers:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,createdAt:NOW,updatedAt:NOW};
const project:ReportProject={id:'road',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};
const pdf=(walls:LinkedWallWork[],workDate:string)=>buildProjectReportHtmlWithWaste({...report,workDate},project,[],[],[],[],company,null,[],false,null,walls);
const section=(html:string)=>html.slice(html.indexOf('<section class="wall-section"'),html.indexOf('</section>',html.indexOf('<section class="wall-section"')));

async function setup(){
  const db=new TestDatabase();databases.push(db);
  await migrateDatabase(db as never);
  db.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
    INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('other','customer','Harbour','Beirut','active','${NOW}','${NOW}',0);
  `);
  const walls=new SqliteWallRepository(db as never),reports=new SqliteProjectReportRepository(db as never);
  const wall=await walls.saveWall({projectId:'road',name:'Retaining wall A',system:'rubble_masonry',purpose:'retaining',lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4,deductionM3:0,allowancePercent:0,notes:''});
  const base:WallBaseDraft={wallId:wall.id,reference:'Base A',location:'Km 2+150',lengthM:22,heightM:.8,bottomThicknessM:1.2,topThicknessM:1.2,deductionM3:0,materialType:'ready_mix',concretePurpose:'footing',customPurposeId:null,quantity:21.12,quantityUnit:'m3',manualOverride:false,consumptionDate:'2026-09-01',notes:'Poured in one lift'};
  await walls.saveBase(base);
  await walls.changeBaseStatus(wall.id,{status:'constructed',constructedOn:'2026-09-01'});
  await walls.changeBaseStatus(wall.id,{status:'curing',curingStartedOn:'2026-09-01'});
  return{db,walls,reports,wall};
}
const use=(wallId:string,usedOn:string):WallConsumptionDraft=>({wallId,usedOn,type:'stone',concretePurpose:null,customPurposeId:null,finishedVolumeM3:null,cementBags:null,cementBagKg:null,sandQuantity:null,sandUnit:null,gravelQuantity:null,gravelUnit:null,waterLitres:null,admixtureQuantity:null,admixtureUnit:null,stoneQuantity:9,stoneUnit:'m3',rebarDiameterMm:null,rebarCount:null,rebarLengthEachM:null,rebarGrade:'',notes:'',volume:null});

describe('base activity in the Daily Report',()=>{
  it('includes a wall on the date its base was constructed, even with no wall consumption',async()=>{
    const {reports,wall}=await setup();
    const linked=await reports.listLinkedWallWork('road','2026-09-01');
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({wallId:wall.id,entries:[]});
    expect(linked[0]!.base).toMatchObject({status:'curing',constructedOn:'2026-09-01',netVolumeM3:21.12,quantity:21.12});
    expect(linked[0]!.baseEvents).toEqual(['Base constructed or poured','Curing started','Base material recorded']);
    expect(linked[0]!.baseStatusAsOf).toBe('curing');
  });

  it('shows the cured confirmation on its own date and excludes other dates and projects',async()=>{
    const {reports,walls,wall}=await setup();
    await walls.changeBaseStatus(wall.id,{status:'cured',curedOn:'2026-09-08',inspected:true});
    expect((await reports.listLinkedWallWork('road','2026-09-08'))[0]!.baseEvents).toEqual(['Base confirmed cured']);
    expect(await reports.listLinkedWallWork('road','2026-09-05')).toEqual([]);
    expect(await reports.listLinkedWallWork('other','2026-09-01')).toEqual([]);
  });

  it('never shows later wall work, or the built wall, on an earlier base-only report',async()=>{
    const {reports,walls,wall}=await setup();
    await walls.changeBaseStatus(wall.id,{status:'cured',curedOn:'2026-09-08',inspected:true});
    await walls.saveLayers(wall.id,[{name:'Core',phaseOrder:1,bottomThicknessM:.8,topThicknessM:.4,note:'',materialKey:null}]);
    await walls.addConsumption(use(wall.id,'2026-09-10'));

    const baseDay=(await reports.listLinkedWallWork('road','2026-09-01'))[0]!;
    expect(baseDay.entries).toEqual([]);
    expect(baseDay.layers).toEqual([]);
    expect(baseDay.baseStatusAsOf).toBe('curing');
    const wallDay=(await reports.listLinkedWallWork('road','2026-09-10'))[0]!;
    expect(wallDay.entries).toHaveLength(1);
    expect(wallDay.layers).toHaveLength(1);
    expect(wallDay.baseStatusAsOf).toBe('cured');
  });

  // DEC-463. Curing is informational: wall work recorded while the base is still curing is honestly
  // reported (never hidden, never labelled cured) with a concise non-blocking note.
  it('shows recorded wall work honestly on a date the base was still curing, with a concise note and no false cured claim',async()=>{
    const {reports,walls,wall}=await setup();
    await walls.addConsumption(use(wall.id,'2026-09-01'));
    const linked=await reports.listLinkedWallWork('road','2026-09-01');
    const day=linked[0]!;
    expect(day.baseStatusAsOf).toBe('curing');
    expect(day.entries).toHaveLength(1);
    const html=section(pdf(linked,'2026-09-01'));
    expect(html).toContain('Curing');
    expect(html).toContain('9 m³ stone');
    expect(html).toContain('Base curing not confirmed on this work date');
    expect(html).not.toContain('&middot; cured');
  });

  it('prints the base stage, geometry, and volumes in the PDF, with a stage-appropriate diagram',async()=>{
    const {reports,walls,wall}=await setup();
    const curingDay=section(pdf(await reports.listLinkedWallWork('road','2026-09-01'),'2026-09-01'));
    expect(curingDay).toContain('Base A');
    expect(curingDay).toContain('Curing');
    expect(curingDay).toContain('21.12 m³');
    expect(curingDay).toContain('Base constructed or poured');
    expect(curingDay).toContain('Footing concrete');
    expect(curingDay).toContain('No layers recorded');
    expect(curingDay).toContain('<svg ');
    // A base-only day has no wall material yet, and says so rather than printing an empty table.
    expect(curingDay).toContain('No wall material recorded on this date');

    await walls.changeBaseStatus(wall.id,{status:'cured',curedOn:'2026-09-08',inspected:true});
    await walls.saveLayers(wall.id,[{name:'Core',phaseOrder:1,bottomThicknessM:.8,topThicknessM:.4,note:'',materialKey:null}]);
    await walls.addConsumption(use(wall.id,'2026-09-10'));
    const wallDay=section(pdf(await reports.listLinkedWallWork('road','2026-09-10'),'2026-09-10'));
    expect(wallDay).toContain('Phase 1');
    expect(wallDay).toContain('9 m³ stone');
    expect(wallDay).toContain('Cured');
  });

  it('carries the base into the workbook so it agrees with the PDF',async()=>{
    const {reports}=await setup();
    const linked=await reports.listLinkedWallWork('road','2026-09-01');
    const sheets=dailyReportWorkbookSheets(report,project,[],[],[],[],company,[],'en',linked);
    const bases=sheets.find(sheet=>sheet.name==='Wall Bases')!.rows;
    expect(bases).toHaveLength(1);
    expect(bases[0]).toMatchObject({Wall:'Retaining wall A','Base Reference':'Base A',Location:'Km 2+150','Base Status':'Curing','Constructed On':'2026-09-01','Curing Started':'2026-09-01','Cured On':null,'Base Length m':22,'Base Gross Volume m³':21.12,'Base Deduction m³':0,'Base Net Volume m³':21.12,'Recorded Quantity':21.12,'Quantity Unit':'m³','Manual Override':'No',Material:'Ready-mix concrete',Purpose:'Footing concrete','Events On This Date':'Base constructed or poured; Curing started; Base material recorded'});
  });
});
