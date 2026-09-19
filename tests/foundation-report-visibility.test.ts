import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteConstructionLiftRepository} from '../src/data/repositories/SqliteConstructionLiftRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';

/**
 * DEC-470. A planned foundation must still appear in the Daily Report for the day it was created.
 *
 * DEC-468 correctly stopped a new foundation from claiming a material consumption, which also cleared
 * `consumption_date`. That date had been the foundation's only route into a Daily Report, so a planned
 * foundation -- with no constructed, curing or cured date either -- silently vanished from every
 * report. The Owner found this on the device. Creation is itself a real, dated event, so it is now one.
 */
class TestDatabase{
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

const TODAY=new Date().toISOString().slice(0,10);

async function seeded(){
  const db=new TestDatabase();databases.push(db);
  await migrateDatabase(db as never);
  db.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
    INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',0);
  `);
  const walls=new SqliteWallRepository(db as never);
  const lifts=new SqliteConstructionLiftRepository(db as never);
  const reports=new SqliteProjectReportRepository(db as never);
  const section=await walls.createConstructionSection({projectId:'road',name:'Section A',location:'Km 3+000',description:''});
  return {db,walls,lifts,reports,section};
}

/** Exactly what the corrected Foundation form now sends: geometry only, no material of any kind. */
const plannedFoundation=(sectionId:string)=>({
  projectId:'road',constructionSectionId:sectionId,reference:'Foundation F1',location:'North abutment',
  lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0,
  materialType:null,concretePurpose:null,customPurposeId:null,
  quantity:null,quantityUnit:null,manualOverride:false,consumptionDate:null,notes:'',
});

describe('a planned foundation reaches the Daily Report on the day it was created',()=>{
  it('appears in the foundation activity for its creation date',async()=>{
    const {walls,reports,section}=await seeded();
    const foundation=await walls.createFoundation(plannedFoundation(section.id));
    const activity=await reports.listLinkedFoundationActivity('road',TODAY);
    expect(activity.map(entry=>entry.foundation.id)).toContain(foundation.id);
  });

  it('names the creation as the event, without inventing a consumption',async()=>{
    const {walls,reports,section}=await seeded();
    await walls.createFoundation(plannedFoundation(section.id));
    const entry=(await reports.listLinkedFoundationActivity('road',TODAY))[0]!;
    expect(entry.foundationEvents.join(' ')).toMatch(/created/i);
    expect(entry.foundationEvents.join(' ')).not.toMatch(/material recorded/i);
    expect(entry.foundation.quantity).toBeNull();
    expect(entry.foundation.materialType).toBeNull();
  });

  it('still carries its structural envelope and its (empty) lift group',async()=>{
    const {walls,reports,section}=await seeded();
    await walls.createFoundation(plannedFoundation(section.id));
    const entry=(await reports.listLinkedFoundationActivity('road',TODAY))[0]!;
    expect(entry.foundation.netVolumeM3).toBe(9);
    expect(entry.lifts?.lifts).toEqual([]);
    expect(entry.lifts?.reconciliation.remainingUnallocatedVolumeM3).toBe(9);
  });

  it('does not appear in a report dated before it existed',async()=>{
    const {walls,reports,section}=await seeded();
    await walls.createFoundation(plannedFoundation(section.id));
    expect(await reports.listLinkedFoundationActivity('road','2026-09-02')).toEqual([]);
  });

  it('reaches the PDF Wall Construction section rather than the empty state',async()=>{
    const {walls,reports,section}=await seeded();
    await walls.createFoundation(plannedFoundation(section.id));
    const activity=await reports.listLinkedFoundationActivity('road',TODAY);
    const {wallConstructionSectionHtml}=await import('../src/services/projectReportWasteTemplate');
    const html=wallConstructionSectionHtml([],activity);
    expect(html).toContain('Foundation F1');
    expect(html).toContain('Section A');
    expect(html).not.toContain('No wall construction recorded for this date');
    // DEC-474 reworded this so it can never contradict a Lift that holds real material.
    expect(html).toContain('No Lift materials recorded yet.');
  });

  it('reaches the workbook foundation sheet with empty material columns',async()=>{
    const {walls,reports,section}=await seeded();
    await walls.createFoundation(plannedFoundation(section.id));
    const activity=await reports.listLinkedFoundationActivity('road',TODAY);
    const {foundationOnlyRows}=await import('../src/services/dailyReportWorkbookCore');
    const row=foundationOnlyRows(activity)[0]!;
    expect(row['Foundation Reference']).toBe('Foundation F1');
    expect(row['Foundation Net Volume m³']).toBe(9);
    expect(row.Material).toBeNull();
    expect(row['Recorded Quantity']).toBeNull();
  });

  it('keeps a foundation whose lifts worked that day, even when it was created earlier',async()=>{
    const {db,walls,lifts,reports,section}=await seeded();
    const foundation=await walls.createFoundation(plannedFoundation(section.id));
    // Age the foundation so creation is no longer the reason it appears.
    db.raw.prepare("UPDATE foundations SET created_at='2026-09-01T00:00:00Z' WHERE id=?").run(foundation.id);
    await lifts.createLift({parentType:'foundation',parentId:foundation.id,sequence:1,reference:'Lift 1',startElevationM:0,
      geometry:{lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},notes:''});
    const activity=await reports.listLinkedFoundationActivity('road',TODAY);
    expect(activity.map(entry=>entry.foundation.id)).toContain(foundation.id);
  });

  it('is actually wired from the Reports screen through to both exports',async()=>{
    const {readFileSync}=await import('node:fs');
    const {join}=await import('node:path');
    const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');
    // DEC-470. The foundation-only block and its workbook sheet existed and were covered at the
    // template level from DEC-464, but nothing ever fetched the activity that feeds them, so on the
    // device a foundation with no wall linked could never appear. This pins the whole chain.
    const screen=source('src/ui/screens/ReportsScreen.tsx');
    expect(screen).toContain('listLinkedFoundationActivity');
    expect((screen.match(/listLinkedFoundationActivity/g)??[]).length).toBeGreaterThanOrEqual(2);
    expect(source('src/services/documentExport.ts')).toContain('foundationActivity');
    expect(source('src/services/dailyReportWorkbook.ts')).toContain('foundationActivity');
  });

  it('breaks each detail onto its own line instead of running them together',async()=>{
    const {walls,reports,section}=await seeded();
    await walls.createFoundation(plannedFoundation(section.id));
    const activity=await reports.listLinkedFoundationActivity('road',TODAY);
    const {wallConstructionSectionHtml,buildProjectReportHtmlWithWaste}=await import('../src/services/projectReportWasteTemplate');
    const section_=wallConstructionSectionHtml([],activity);
    // The stacked detail lines are spans, so they only read as separate lines if a rule makes them
    // block-level. Without this they printed as one run-on paragraph on the device.
    expect(section_).toContain('<span class="sub">');
    const report={id:'r',projectId:'road',workDate:TODAY,workDescription:'',workers:[],workerSafety:[],drivers:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,createdAt:'',updatedAt:''} as never;
    const project={id:'road',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'} as never;
    const company={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null} as never;
    const html=buildProjectReportHtmlWithWaste(report,project,[],[],[],[],company,null,[],false,null,[],activity);
    expect(html).toMatch(/\.foundation-only \.sub[^}]*display:block/);
    expect(html).toMatch(/\.lift-main \.sub[^}]*display:block/);
  });

  it('uses no em-dash in the foundation report copy',async()=>{
    const {walls,reports,section}=await seeded();
    await walls.createFoundation(plannedFoundation(section.id));
    const activity=await reports.listLinkedFoundationActivity('road',TODAY);
    const {wallConstructionSectionHtml}=await import('../src/services/projectReportWasteTemplate');
    expect(wallConstructionSectionHtml([],activity)).not.toContain('—');
  });

  it('never claims no material when the foundation lifts recorded some',async()=>{
    const {walls,lifts,reports,section}=await seeded();
    const foundation=await walls.createFoundation(plannedFoundation(section.id));
    const lift=await lifts.createLift({parentType:'foundation',parentId:foundation.id,sequence:1,reference:'Lift 1',startElevationM:0,
      geometry:{lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},notes:''});
    await lifts.saveStonePhase(lift.id,{calculationDimensions:{lengthM:30,heightM:.4,bottomThicknessM:.375,topThicknessM:.375,deductionM3:0},
      actualStoneQuantityM3:4.5,manualOverride:false,workDate:TODAY,position:null,offsets:null,notes:''});
    await lifts.saveConcreteMatrixPhase(lift.id,{calculationMethod:'estimated_matrix',independentDimensions:null,
      actualReadyMixQuantityM3:4.5,manualOverride:false,purpose:'Matrix fill',workDate:TODAY,notes:''});
    const activity=await reports.listLinkedFoundationActivity('road',TODAY);
    const {wallConstructionSectionHtml}=await import('../src/services/projectReportWasteTemplate');
    const html=wallConstructionSectionHtml([],activity);
    // The old copy said "No foundation material recorded" beside a completed lift holding 4.5 m³ of
    // Stone and 4.5 m³ of Ready Mix, which contradicted itself.
    expect(html).not.toContain('No foundation material recorded');
    expect(html).toMatch(/Materials recorded through 1 Lift: Stone 4.50 m³ &middot; Concrete 4.50 m³/);
    expect(html).toContain('4.50');
  });

  it('still says nothing is recorded when nothing genuinely is',async()=>{
    const {walls,reports,section}=await seeded();
    await walls.createFoundation(plannedFoundation(section.id));
    const activity=await reports.listLinkedFoundationActivity('road',TODAY);
    const {wallConstructionSectionHtml}=await import('../src/services/projectReportWasteTemplate');
    expect(wallConstructionSectionHtml([],activity)).toMatch(/No Lift materials recorded yet./i);
  });

  it('calls them Lifts, never Cyclopean Lifts, anywhere the Owner reads',async()=>{
    const {walls,lifts,reports,section}=await seeded();
    const foundation=await walls.createFoundation(plannedFoundation(section.id));
    await lifts.createLift({parentType:'foundation',parentId:foundation.id,sequence:1,reference:'Lift 1',startElevationM:0,
      geometry:{lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},notes:''});
    const activity=await reports.listLinkedFoundationActivity('road',TODAY);
    const {wallConstructionSectionHtml}=await import('../src/services/projectReportWasteTemplate');
    const html=wallConstructionSectionHtml([],activity);
    expect(html).toContain('Foundation Lifts');
    expect(html).not.toMatch(/Cyclopean/i);
  });

  it('names the workbook sheet Lifts',async()=>{
    const {dailyReportWorkbookSheets}=await import('../src/services/dailyReportWorkbookCore');
    const report={id:'r',projectId:'road',workDate:TODAY,workDescription:'',workers:[],workerSafety:[],drivers:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,createdAt:'',updatedAt:''} as never;
    const project={id:'road',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'} as never;
    const company={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null} as never;
    const names=dailyReportWorkbookSheets(report,project,[],[],[],[],company,[],'en',[],[]).map(sheet=>sheet.name);
    expect(names).toContain('Lifts');
    expect(names.some(name=>/Cyclopean/i.test(name))).toBe(false);
  });

  it('leaves a foundation with no activity at all out of an unrelated date',async()=>{
    const {db,walls,reports,section}=await seeded();
    const foundation=await walls.createFoundation(plannedFoundation(section.id));
    db.raw.prepare("UPDATE foundations SET created_at='2026-09-01T00:00:00Z' WHERE id=?").run(foundation.id);
    expect(await reports.listLinkedFoundationActivity('road',TODAY)).toEqual([]);
  });
});

/**
 * DEC-474. The Owner's exact wording rules for a foundation's material line, and the Foundation
 * structural-envelope figure that sits above the Lift diagrams.
 *
 * The line has to count Lifts correctly in singular and plural, and a genuine pre-Lift top-level
 * record has to stay visibly separate from the Lift figures so the two are never read as one total.
 */
describe('DEC-474: foundation material wording and the structural-envelope figure',()=>{
  const withLegacyMaterial=(sectionId:string)=>({...plannedFoundation(sectionId),
    materialType:'ready_mix' as const,concretePurpose:'footing' as const,quantity:9,quantityUnit:'m3' as const,
    manualOverride:true,consumptionDate:TODAY});

  /** One completed lift of the given sequence, half the foundation's height, fully recorded. */
  async function completedLift(lifts:Awaited<ReturnType<typeof seeded>>['lifts'],foundationId:string,sequence:number,startElevationM:number){
    const lift=await lifts.createLift({parentType:'foundation',parentId:foundationId,sequence,reference:`Lift ${sequence}`,startElevationM,
      geometry:{lengthM:30,heightM:.2,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},notes:''});
    await lifts.saveStonePhase(lift.id,{calculationDimensions:{lengthM:30,heightM:.2,bottomThicknessM:.375,topThicknessM:.375,deductionM3:0},
      actualStoneQuantityM3:2.25,manualOverride:false,workDate:TODAY,position:null,offsets:null,notes:''});
    await lifts.saveConcreteMatrixPhase(lift.id,{calculationMethod:'estimated_matrix',independentDimensions:null,
      actualReadyMixQuantityM3:2.25,manualOverride:false,purpose:'Matrix fill',workDate:TODAY,notes:''});
    return lift;
  }

  async function html(build:(context:Awaited<ReturnType<typeof seeded>>)=>Promise<unknown>){
    const context=await seeded();
    await build(context);
    const activity=await context.reports.listLinkedFoundationActivity('road',TODAY);
    const {wallConstructionSectionHtml}=await import('../src/services/projectReportWasteTemplate');
    return wallConstructionSectionHtml([],activity);
  }

  it('says "1 Lift", singular, when exactly one Lift holds the material',async()=>{
    const result=await html(async({walls,lifts,section})=>{
      const foundation=await walls.createFoundation(plannedFoundation(section.id));
      await completedLift(lifts,foundation.id,1,0);
    });
    expect(result).toContain('Materials recorded through 1 Lift: Stone 2.25 m³ &middot; Concrete 2.25 m³');
    expect(result).not.toContain('1 Lifts');
  });

  it('says "2 Lifts", plural, and totals both',async()=>{
    const result=await html(async({walls,lifts,section})=>{
      const foundation=await walls.createFoundation(plannedFoundation(section.id));
      await completedLift(lifts,foundation.id,1,0);
      await completedLift(lifts,foundation.id,2,.2);
    });
    expect(result).toContain('Materials recorded through 2 Lifts: Stone 4.50 m³ &middot; Concrete 4.50 m³');
  });

  it('says nothing is recorded, in the wording the Owner asked for, when there are no Lifts',async()=>{
    const result=await html(async({walls,section})=>walls.createFoundation(plannedFoundation(section.id)));
    expect(result).toContain('No Lift materials recorded yet.');
    // The superseded wording explained the data model at the reader instead of stating the position.
    expect(result).not.toContain('Actual Stone and concrete are recorded through Lifts');
  });

  it('keeps a legacy record and the Lift materials as two separate lines, never combined',async()=>{
    const result=await html(async({walls,lifts,section})=>{
      const foundation=await walls.createFoundation(withLegacyMaterial(section.id));
      await completedLift(lifts,foundation.id,1,0);
    });
    expect(result).toContain('Legacy foundation material record:');
    expect(result).toContain('Materials recorded through 1 Lift: Stone 2.25 m³ &middot; Concrete 2.25 m³');
    // Two separate spans, so no reader and no later total can add 9 m³ to the 2.25 m³ of the Lift.
    const legacyEnd=result.indexOf('</span>',result.indexOf('Legacy foundation material record:'));
    expect(result.slice(legacyEnd)).toMatch(new RegExp('^</span><span class="sub">Materials recorded through 1 Lift'));
  });

  it('draws a Foundation structural envelope, not a wall diagram with no layers',async()=>{
    const result=await html(async({walls,section})=>walls.createFoundation(plannedFoundation(section.id)));
    expect(result).toContain('Foundation structural envelope');
    expect(result).toContain('Elevation');
    expect(result).toContain('Cross-section');
    expect(result).toContain('Not to scale');
    expect(result).toContain('Gross structural volume');
    // The retired wall-layer vocabulary must never appear over a foundation again.
    expect(result).not.toContain('No layers recorded');
    expect(result).not.toContain('Layers and construction phases');
  });

  it('keeps Stone and concrete out of the envelope figure and in the Lift block',async()=>{
    const result=await html(async({walls,lifts,section})=>{
      const foundation=await walls.createFoundation(plannedFoundation(section.id));
      await completedLift(lifts,foundation.id,1,0);
    });
    const envelope=result.slice(result.indexOf('Foundation structural envelope'),result.indexOf('</svg>'));
    expect(envelope).not.toMatch(/Stone|Concrete|Ready Mix/);
    expect(result).toContain('Foundation Lifts');
  });
});
