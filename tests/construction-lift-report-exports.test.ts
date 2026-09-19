import {describe,expect,it} from 'vitest';

import {buildLiftReportGroup} from '../src/domain/constructionLiftReport';
import type {Foundation} from '../src/domain/foundations';
import type {DailyProjectReport,LinkedFoundationActivity,LinkedWallWork,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import type {ConstructionLift} from '../src/domain/wallConstructionLift';
import {constructionLiftRows,dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';

const report:DailyProjectReport={id:'report-1',projectId:'road',workDate:'2026-09-12',workDescription:'Lift works',workers:[],workerSafety:[],drivers:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:true,showConsultingAgency:true,showCustomHeader:false,consultingAgencyId:'agency',consultingAgencyNameEn:'Cedar Consulting',consultingAgencyNameAr:'استشارات الأرز',createdAt:'2026-09-12T17:00:00Z',updatedAt:'2026-09-12T17:00:00Z'};
const project:ReportProject={id:'road',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX Paving',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:'Ministry of Public Works',ministryNameAr:'وزارة الأشغال العامة',ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};

const foundation:Foundation={id:'f1',projectId:'road',constructionSectionId:'sec-1',legacyWallId:null,reference:'Foundation F1',location:'North abutment',
  materialType:'ready_mix',concretePurpose:'structural',customPurposeId:null,customPurposeLabel:null,quantity:null,quantityUnit:'m3',manualOverride:false,consumptionDate:null,
  lengthM:20,heightM:1,bottomThicknessM:1.5,topThicknessM:1.5,deductionM3:0,grossVolumeM3:30,netVolumeM3:30,status:'curing',
  constructedOn:'2026-09-08',curingStartedOn:'2026-09-09',curedOn:null,curingNote:'',notes:'',correctionHistory:[],createdAt:'2026-09-08T08:00:00Z',updatedAt:null};

const snapshot=(net:number)=>({lengthM:5,heightM:.4,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0,grossVolumeM3:net,netVolumeM3:net});
const lift=(overrides:Partial<ConstructionLift>={}):ConstructionLift=>({
  id:'lift-1',parentType:'foundation',parentId:'f1',sequence:1,reference:'Lift 1',startElevationM:0,
  geometry:{lengthM:10,heightM:.5,bottomThicknessM:1,topThicknessM:1,deductionM3:0},netLiftVolumeM3:5,
  stonePhase:{calculationSnapshot:snapshot(2),calculatedStoneVolumeM3:2,actualStoneQuantityM3:2.1,manualOverride:true,
    workDate:'2026-09-10',position:{xNorm:.5,yNorm:.5},offsets:null,notes:''},
  concretePhase:null,status:'stone_placed',notes:'',correctionHistory:[],createdAt:'2026-09-09T08:00:00Z',updatedAt:null,...overrides});
const completedLift=(overrides:Partial<ConstructionLift>={})=>lift({id:'lift-2',sequence:2,reference:'Lift 2',status:'completed',
  concretePhase:{liftId:'lift-2',calculationMethod:'estimated_matrix',estimatedMatrixVolumeM3:3,independentCalculation:null,
    actualReadyMixQuantityM3:3.4,manualOverride:false,purpose:'Matrix fill',workDate:'2026-09-11',notes:''},...overrides});

const group=(lifts:ConstructionLift[],asOf=report.workDate,net=30,parentType:'foundation'|'wall'='foundation')=>
  buildLiftReportGroup({parentType,parentId:parentType==='foundation'?'f1':'wall-a',parentReference:parentType==='foundation'?'Foundation F1':'Retaining wall A',parentNetVolumeM3:net,lifts,asOf});

const wall=(overrides:Partial<LinkedWallWork>={}):LinkedWallWork=>({
  wallId:'wall-a',wallName:'Retaining wall A',system:'rubble_masonry',purpose:'retaining',lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4,
  netVolumeM3:48,plannedVolumeM3:48,layers:[],entries:[],foundation,constructionSectionName:'Section A',foundationEvents:[],
  foundationStatusAsOf:'curing',foundationComposition:null,
  foundationLifts:group([lift(),completedLift()]),
  wallLifts:group([lift({id:'wl-1',parentType:'wall',parentId:'wall-a',reference:'Wall Lift 1'})],report.workDate,48,'wall'),
  foundationLegacyStage:null,...overrides});

const pdf=(walls:LinkedWallWork[],activity:LinkedFoundationActivity[]=[])=>
  buildProjectReportHtmlWithWaste(report,project,[],[],[],[],company,null,[],false,null,walls,activity);
const wallSection=(html:string)=>html.slice(html.indexOf('<section class="wall-section"'),html.indexOf('</section>',html.indexOf('<section class="wall-section"')));

describe('Daily Report PDF: Lift hierarchy',()=>{
  it('nests lifts under their own parent, foundation lifts before the wall and its lifts',()=>{
    const section=wallSection(pdf([wall()]));
    expect(section).toContain('Section A');
    expect(section).toContain('Foundation Lifts');
    expect(section).toContain('Wall Lifts');
    expect(section.indexOf('Foundation Lifts')).toBeLessThan(section.indexOf('Wall Lifts'));
  });

  it('gives every lift its sequence, reference, status and quantities',()=>{
    const section=wallSection(pdf([wall()]));
    expect(section).toContain('Lift 1');
    expect(section).toContain('Concrete fill pending');
    expect(section).toContain('Completed');
    expect(section).toContain('3.4');
    expect(section).toContain('2.1');
  });

  it('shows the parent totals, remaining volume and curing as information only',()=>{
    const section=wallSection(pdf([wall()]));
    expect(section).toContain('Remaining');
    expect(section).toMatch(/Curing|curing/);
    expect(section).not.toMatch(/blocked|not allowed|cannot record/i);
  });

  it('warns about over-allocation instead of hiding it',()=>{
    const section=wallSection(pdf([wall({foundationLifts:group([lift(),completedLift()],report.workDate,8)})]));
    expect(section).toContain('Over-allocated');
  });

  it('marks a manual override on the lift that carries one',()=>{
    expect(wallSection(pdf([wall()]))).toContain('Manual override');
  });

  it('embeds the deterministic Phase 4 lift diagram beside its lift, with Stone inside the matrix',()=>{
    const section=wallSection(pdf([wall()]));
    expect(section).toContain('class="lift-figure"');
    expect(section).toContain('<svg');
    expect(section).toContain('#8C8579');
    expect(section).not.toContain('<image');
    expect(section).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(section).not.toContain('<script');
  });

  it('keeps a lift heading with its own data across a page break',()=>{
    const html=pdf([wall()]);
    expect(html).toMatch(/\.lift-row\{[^}]*break-inside:avoid/);
    expect(html).toMatch(/\.lift-head\{[^}]*break-after:avoid/);
  });

  it('shows the established empty state when no wall construction exists at all',()=>{
    expect(wallSection(pdf([]))).toContain('No wall construction recorded for this date');
  });

  it('says so plainly when a foundation has no lifts recorded yet, rather than printing an empty grid',()=>{
    const section=wallSection(pdf([wall({foundationLifts:group([]),wallLifts:group([],report.workDate,48,'wall')})]));
    expect(section).toContain('No Lifts recorded on or before this date');
  });

  it('escapes hostile lift text so no markup survives into the report',()=>{
    const section=wallSection(pdf([wall({foundationLifts:group([lift({reference:'<script>alert(1)</script>'})])})]));
    expect(section).not.toContain('<script>alert');
    expect(section).toContain('&lt;script&gt;');
    expect(section).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
  });

  it('keeps Arabic and mixed-direction lift references readable and intact',()=>{
    const section=wallSection(pdf([wall({foundationLifts:group([lift({reference:'رفعة الأساس ١'}),completedLift({reference:'Lift 2 — رفعة'})])})]));
    expect(section).toContain('رفعة الأساس');
    expect(section).toContain('Lift 2');
    expect(section).toMatch(/dir="auto"|direction="rtl"|unicode-bidi/);
  });

  it('shows a long lift reference without clipping it out of the record',()=>{
    const long='Foundation lift with an extremely long descriptive reference name for the north abutment';
    expect(wallSection(pdf([wall({foundationLifts:group([lift({reference:long})])})]))).toContain(long);
  });

  it('keeps an imported legacy composite stage labelled, never redrawn as lifts',()=>{
    const section=wallSection(pdf([wall({foundationLifts:group([]),wallLifts:group([],report.workDate,48,'wall'),
      foundationLegacyStage:{foundationId:'f1',label:'Imported legacy composite stage',netFoundationVolumeM3:30,activeStoneM3:9,estimatedConcreteM3:21,activeReadyMixM3:0,variance:null}})]));
    expect(section).toContain('Imported legacy composite stage');
    expect(section).toContain('Recorded before ordered Lifts');
    // Nothing is fabricated for it: the lift group stays honestly empty rather than inventing a sequence.
    expect(section).toContain('No Lifts recorded on or before this date');
    expect(section).not.toContain('class="lift-row"');
  });

  it('preserves every existing Daily Report section',()=>{
    const html=pdf([wall()]);
    for(const heading of ['Wall construction that day','Work performed'])expect(html).toContain(heading);
  });
});

describe('Daily Report workbook: Lifts sheet',()=>{
  const rows=()=>constructionLiftRows([wall()],[],project,report.workDate);

  it('emits one row per visible lift, for both foundation and wall parents',()=>{
    expect(rows()).toHaveLength(3);
    expect(rows().filter(row=>row['Parent Type']==='Foundation')).toHaveLength(2);
    expect(rows().filter(row=>row['Parent Type']==='Wall')).toHaveLength(1);
  });

  it('carries the project, work date, section, location and both references',()=>{
    const row=rows()[0]!;
    expect(row.Project).toBe('Mountain Road');
    expect(row['Report Work Date']).toBe('2026-09-12');
    expect(row['Construction Section']).toBe('Section A');
    expect(row['Section Location']).toBe('North abutment');
    expect(row['Foundation Reference']).toBe('Foundation F1');
    expect(row['Wall Reference']).toBe('Retaining wall A');
  });

  it('keeps every quantity a real number, never formatted text',()=>{
    const row=rows().find(value=>value['Lift Reference']==='Lift 2')!;
    for(const column of ['Lift Sequence','Structural Volume m³','Estimated Stone m³','Actual Stone m³','Estimated Concrete Matrix m³','Actual Ready Mix m³','Concrete Variance m³','Remaining Volume m³']){
      expect(typeof row[column as keyof typeof row]).toBe('number');
    }
    expect(row['Actual Ready Mix m³']).toBe(3.4);
  });

  it('leaves a not-yet-recorded quantity empty rather than writing a misleading zero',()=>{
    const pending=rows().find(value=>value['Lift Reference']==='Lift 1')!;
    expect(pending['Actual Ready Mix m³']).toBeNull();
    expect(pending['Lift Status']).toBe('Concrete fill pending');
  });

  it('records status, manual override, over-allocation, correction and curing information',()=>{
    const row=rows()[0]!;
    expect(row['Manual Override']).toBe('Yes');
    expect(row['Curing Status']).toBeTruthy();
    expect(row).toHaveProperty('Over-Allocation Warning');
    expect(row).toHaveProperty('Corrections');
    expect(row).toHaveProperty('Last Correction Reason');
  });

  it('registers the sheet in the workbook with readable headers and no other sheet disturbed',()=>{
    const before=dailyReportWorkbookSheets(report,project,[],[],[],[],company,[],'en',[],[]).map(sheet=>sheet.name);
    const after=dailyReportWorkbookSheets(report,project,[],[],[],[],company,[],'en',[wall()],[]).map(sheet=>sheet.name);
    expect(after).toContain('Lifts');
    expect(after.filter(name=>name!=='Lifts')).toEqual(before.filter(name=>name!=='Lifts'));
    expect(before).toContain('Lifts');
  });

  it('never emits a lift that had not happened by the report date',()=>{
    const future=group([lift({id:'later',reference:'Later lift',createdAt:'2026-09-30T08:00:00Z'})]);
    expect(constructionLiftRows([wall({foundationLifts:future,wallLifts:group([],report.workDate,48,'wall')})],[],project,report.workDate)).toHaveLength(0);
  });

  it('includes a foundation that has lifts but no wall linked to it yet',()=>{
    const activity:LinkedFoundationActivity={foundation,constructionSectionName:'Section A',foundationEvents:[],foundationStatusAsOf:'curing',composition:null,
      lifts:group([lift()]),legacyStage:null};
    const rowsWithActivity=constructionLiftRows([],[activity],project,report.workDate);
    expect(rowsWithActivity).toHaveLength(1);
    expect(rowsWithActivity[0]!['Wall Reference']).toBeNull();
    expect(rowsWithActivity[0]!['Parent Type']).toBe('Foundation');
  });
});
