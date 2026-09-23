import {strFromU8,unzipSync} from 'fflate';
import {describe,expect,it} from 'vitest';

import type {DailyProjectReport,LinkedWallWork,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import {describeWallConsumptionQuantity,type WallConsumption} from '../src/domain/walls';
import {buildDailyReportWorkbook,dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';

const report:DailyProjectReport={id:'report-1',projectId:'road',workDate:'2026-09-10',workDescription:'Wall works',workers:[],workerSafety:[],drivers:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:true,showConsultingAgency:true,showCustomHeader:false,consultingAgencyId:'agency',consultingAgencyNameEn:'Cedar Consulting',consultingAgencyNameAr:'استشارات الأرز',createdAt:'2026-09-10T17:00:00Z',updatedAt:'2026-09-10T17:00:00Z'};
const project:ReportProject={id:'road',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX Paving',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:'Ministry of Public Works',ministryNameAr:'وزارة الأشغال العامة',ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};

const entry=(overrides:Partial<WallConsumption>):WallConsumption=>({id:'use',wallId:'wall-a',usedOn:'2026-09-10',type:'ready_mix',concretePurpose:null,customPurposeId:null,customPurposeLabel:null,finishedVolumeM3:null,cementBags:null,cementBagKg:null,sandQuantity:null,sandUnit:null,gravelQuantity:null,gravelUnit:null,waterLitres:null,admixtureQuantity:null,admixtureUnit:null,stoneQuantity:null,stoneUnit:null,rebarDiameterMm:null,rebarCount:null,rebarLengthEachM:null,rebarGrade:'',notes:'',volume:null,totalRebarLengthM:null,totalRebarKg:null,correctionHistory:[],createdAt:'2026-09-10T08:00:00Z',updatedAt:null,...overrides});
const layers=[{id:'l1',wallId:'wall-a',phaseOrder:1,name:'Structural core',materialKey:null,bottomThicknessM:.6,topThicknessM:.3,note:'',createdAt:'2026-09-10T08:00:00Z',updatedAt:null},{id:'l2',wallId:'wall-a',phaseOrder:2,name:'Stone facing',materialKey:null,bottomThicknessM:.2,topThicknessM:.1,note:'Quarry stone',createdAt:'2026-09-10T08:00:00Z',updatedAt:null}];
const wallA:LinkedWallWork={wallId:'wall-a',wallName:'Retaining wall A',system:'rubble_masonry',purpose:'retaining',lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4,netVolumeM3:48,plannedVolumeM3:48,layers,foundation:null,constructionSectionName:null,foundationEvents:[],foundationStatusAsOf:null,foundationComposition:null,foundationLifts:null,wallLifts:null,foundationLegacyStage:null,entries:[
  entry({id:'mix',concretePurpose:'structural',finishedVolumeM3:10,volume:{lengthM:10,heightM:2,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0,grossVolumeM3:10,netVolumeM3:10}}),
  entry({id:'stone',type:'stone',stoneQuantity:54.2,stoneUnit:'m3',volume:{lengthM:18,heightM:4.5,bottomThicknessM:.9,topThicknessM:.5,deductionM3:2.5,grossVolumeM3:56.7,netVolumeM3:54.2},notes:'Face course',correctionHistory:[{correctedAt:'2026-09-11T09:00:00Z',correctedBy:'Owner',reason:'Truck count re-checked',changes:[{field:'Stone',originalValue:'50 m³',newValue:'54.2 m³'}]}],updatedAt:'2026-09-11T09:00:00Z'}),
]};
const wallB:LinkedWallWork={wallId:'wall-b',wallName:'Boundary wall B',system:'reinforced_concrete',purpose:'boundary',lengthM:12,heightM:2.5,bottomThicknessM:.3,topThicknessM:.3,netVolumeM3:9,plannedVolumeM3:9.45,layers:[],foundation:null,constructionSectionName:null,foundationEvents:[],foundationStatusAsOf:null,foundationComposition:null,foundationLifts:null,wallLifts:null,foundationLegacyStage:null,entries:[
  entry({id:'custom',wallId:'wall-b',customPurposeId:'p1',customPurposeLabel:'Parapet cap concrete',finishedVolumeM3:1.25}),
  entry({id:'plain-stone',wallId:'wall-b',type:'stone',stoneQuantity:3,stoneUnit:'tonnes'}),
  entry({id:'steel',wallId:'wall-b',type:'rebar',rebarDiameterMm:12,rebarCount:40,rebarLengthEachM:6,totalRebarLengthM:240,totalRebarKg:213.1}),
]};
const pdf=(walls:LinkedWallWork[])=>buildProjectReportHtmlWithWaste(report,project,[],[],[],[],company,null,[],false,null,walls);
const wallSection=(html:string)=>html.slice(html.indexOf('<section class="wall-section"'),html.indexOf('</section>',html.indexOf('<section class="wall-section"')));

describe('Daily Report PDF: Wall Construction section',()=>{
  it('groups every wall with its own heading, dimensions, and materials',()=>{
    const section=wallSection(pdf([wallB,wallA]));
    expect(section).toContain('<h2>Wall construction that day</h2>');
    expect(section.match(/class="wall-block"/g)).toHaveLength(2);
    expect(section.indexOf('Boundary wall B')).toBeLessThan(section.indexOf('Retaining wall A'));
    expect(section).toContain('Stacked rock + mortar/concrete');
    expect(section).toContain('20 m long × 4 m high');
    expect(section).toContain('0.8 m to 0.4 m thick');
    expect(section).toContain('0.3 m thick');
    expect(section).not.toContain('0.3 m to 0.3 m');
    expect(section).toContain('9.45 m³ planned');
  });

  it('shows the consumed quantity beside its volume calculation, including deductions',()=>{
    const section=wallSection(pdf([wallA]));
    expect(section).toContain('<th>Material and purpose</th><th>Consumed quantity</th><th>Volume calculation</th><th>Notes</th>');
    expect(section).toContain(describeWallConsumptionQuantity(wallA.entries[0]!));
    expect(section).toContain('54.2 m³ stone');
    expect(section).toContain('54.20 m³ net');
    expect(section).toContain('56.70 m³ gross, 2.50 m³ deductions');
    expect(section).toContain('18 m × 4.5 m × 0.9 to 0.5 m thick');
    expect(section).toContain('10.00 m³ gross, no deductions');
    expect(section).toContain('10 m × 2 m × 0.5 m thick');
  });

  it('shows custom purposes, uncalculated quantities honestly, rebar as not applicable, and corrections',()=>{
    const section=wallSection(pdf([wallA,wallB]));
    expect(section).toContain('Parapet cap concrete');
    expect(section).toContain('Entered directly');
    expect(section).not.toMatch(/(^|[^\d.])0(\.00)? m³ net/);
    expect(section).toContain('Not applicable');
    expect(section).toContain('Corrected: Truck count re-checked');
    expect(section).toContain('Face course');
    expect(section).not.toContain('m²');
  });

  it('prints a single honest empty row with the correct column span when no wall work exists',()=>{
    const section=wallSection(pdf([]));
    expect(section).toContain('<td colspan="4" class="empty">No wall construction recorded for this date</td>');
    expect(section).not.toContain('class="wall-block"');
    expect(wallSection(buildProjectReportHtmlWithWaste(report,project,[],[],[],[],company,null,[]))).toContain('No wall construction recorded for this date');
  });

  it('keeps wall headings with their tables and repeats table headings across pages',()=>{
    const html=pdf([wallA]);
    expect(html).toMatch(/\.wall-head\{[^}]*break-after:avoid/);
    expect(html).toMatch(/\.wall-table tr\{[^}]*break-inside:avoid/);
    expect(html).toContain('thead{display:table-header-group}');
    expect(html).toMatch(/\.wall-block\{[^}]*break-inside:avoid/);
  });

  it('embeds a generated vector diagram for every wall, with no raster image or external resource',()=>{
    const section=wallSection(pdf([wallA,wallB]));
    expect(section.match(/<svg /g)).toHaveLength(2);
    expect(section).toContain('Elevation');
    expect(section).toContain('Cross-section');
    expect(section).toContain('Layers and construction phases');
    expect(section).toContain('Phase 1');
    expect(section).toContain('Stone facing');
    expect(section).toContain('No layers recorded');
    for(const forbidden of ['<image','<script','href=','data:image','url(http'])expect(section).not.toContain(forbidden);
    // The only http text allowed is the SVG namespace declaration, which fetches nothing.
    const urls=section.match(/https?:\/\/[^"' )]*/g)??[];
    expect(urls.every(url=>url==='http://www.w3.org/2000/svg')).toBe(true);
  });

  it('keeps each diagram whole and lets a wall block move to the next page',()=>{
    const html=pdf([wallA]);
    expect(html).toMatch(/\.wall-figure\{[^}]*break-inside:avoid/);
    expect(html).toMatch(/\.wall-figure svg\{[^}]*max-width:100%/);
    expect(html).toMatch(/\.wall-block\{[^}]*break-inside:avoid/);
  });

  it('escapes entered text inside the diagram as well as the table',()=>{
    const hostile={...wallA,wallName:'<script>alert(1)</script>',layers:[{...layers[0]!,name:'" onload="x'}]};
    const section=wallSection(pdf([hostile]));
    expect(section).not.toContain('<script>alert');
    expect(section).not.toMatch(/"\s+onload="/);
    expect(section).toContain('&lt;script&gt;');
  });

  it('escapes entered text and keeps every existing header and section',()=>{
    const html=pdf([{...wallA,wallName:'<Wall & "A">'}]);
    expect(html).toContain('&lt;Wall &amp; &quot;A&quot;&gt;');
    expect(html).toContain('DAILY PROJECT REPORT');
    expect(html).toContain('<div class="bi-ar" dir="rtl" lang="ar">وزارة الأشغال العامة</div>');
    expect(html).toContain('استشارات الأرز');
    for(const heading of ['Loads delivered that day','Fuel used that day','Waste dumps completed that day','Site notes and follow-up','Photo evidence'])expect(html).toContain(heading);
    expect(html.indexOf('Waste dumps completed that day')).toBeLessThan(html.indexOf('Wall construction that day'));
    expect(html.indexOf('Wall construction that day')).toBeLessThan(html.indexOf('Site notes and follow-up'));
  });
});

describe('Daily Report workbook: Wall Construction sheet',()=>{
  const sheets=()=>dailyReportWorkbookSheets({...report,showMinistryHeader:false},project,[],[],[],[],company,[],'en',[wallA,wallB]);
  const rows=()=>sheets().find(sheet=>sheet.name==='Wall Construction')!.rows;

  it('adds the wall sheets after Waste Dumps and before Photos',()=>{
    // Sheets added later (Custom Resources, DEC-478 onward) follow Photos; this pins the wall block only.
    const names=sheets().map(sheet=>sheet.name);
    expect(names.slice(0,names.indexOf('Photos')+1)).toEqual(['Report Overview','Work Details','Presence','Worker Safety','Materials','Linked Loads','Supplier Loads','Fuel Used','Waste Dumps','Wall Construction','Wall Layers','Wall Foundations','Lifts','Foundations Without a Wall','Photos']);
  });

  it('lists every layer with its phase order and thicknesses, agreeing with the PDF legend',()=>{
    const rows=sheets().find(sheet=>sheet.name==='Wall Layers')!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({Wall:'Retaining wall A','Wall ID':'wall-a',Phase:1,Layer:'Structural core','Layer Bottom Thickness m':.6,'Layer Top Thickness m':.3,Note:null});
    expect(rows[1]).toMatchObject({Phase:2,Layer:'Stone facing','Layer Bottom Thickness m':.2,'Layer Top Thickness m':.1,Note:'Quarry stone'});
  });

  it('carries the wall geometry and volumes on the wall construction sheet',()=>{
    const stone=sheets().find(sheet=>sheet.name==='Wall Construction')!.rows.find(row=>row['Record ID']==='stone')!;
    expect(stone).toMatchObject({'Wall Bottom Thickness m':.8,'Wall Top Thickness m':.4,'Wall Gross Volume m³':48,'Wall Layer Count':2});
  });

  it('has one row per consumption with the same quantity text as the PDF and numeric calculation columns',()=>{
    expect(rows()).toHaveLength(5);
    const stone=rows().find(row=>row['Record ID']==='stone')!;
    expect(stone).toMatchObject({Wall:'Retaining wall A','Wall System':'Stacked rock + mortar/concrete','Used On':'2026-09-10',Material:'Stone',Quantity:'54.2 m³ stone','Stone Quantity':54.2,'Stone Unit':'m³','Calc Length m':18,'Calc Height m':4.5,'Calc Bottom Thickness m':.9,'Calc Top Thickness m':.5,'Calc Deductions m³':2.5,'Calc Gross Volume m³':56.7,'Calc Net Volume m³':54.2,'Volume Calculation':'Calculated',Corrections:1,'Last Correction Reason':'Truck count re-checked',Notes:'Face course'});
    for(const row of rows())expect(String(row.Quantity)).toBe(describeWallConsumptionQuantity([...wallA.entries,...wallB.entries].find(value=>value.id===row['Record ID'])!));
    expect(Object.keys(stone).some(key=>/Area|m²/.test(key))).toBe(false);
  });

  it('leaves missing values empty, never zero, and marks uncalculated or inapplicable records',()=>{
    const plain=rows().find(row=>row['Record ID']==='plain-stone')!,steel=rows().find(row=>row['Record ID']==='steel')!,custom=rows().find(row=>row['Record ID']==='custom')!;
    expect(plain).toMatchObject({'Calc Net Volume m³':null,'Calc Gross Volume m³':null,'Volume Calculation':'Entered directly','Cement Bags':null});
    expect(steel).toMatchObject({'Volume Calculation':'Not applicable','Rebar kg':213.1,Purpose:null});
    expect(custom).toMatchObject({Purpose:'Parapet cap concrete','Purpose Source':'Saved purpose','Ready-Mix or Finished m³':1.25});
  });

  it('localizes the sheet name for the Arabic workbook',()=>{
    const files=unzipSync(buildDailyReportWorkbook(report,project,[],[],[],[],company,[],'ar',[]));
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('أعمال الجدران');
    expect(strFromU8(files['xl/worksheets/sheet10.xml']!)).toContain('rightToLeft="1"');
  });
});
