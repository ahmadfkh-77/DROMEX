import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import {dailyContractProgress,type ContractItem,type ContractLoad} from '../src/domain/contractQuantities';
import type {DailyProjectReport,DailyReportSectionOptions,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import {
  CONTRACT_SECTION_PREFERENCE_KEY,CONTRACT_WHOLE_PROJECT_PREFERENCE_KEY,WALL_SECTION_PREFERENCE_KEY,describeContractSectionPreference,
  describeContractWholeProjectPreference,describeWallSectionPreference,parseSectionPreference,serializeSectionPreference,
} from '../src/domain/reportSectionPreferences';
import {buildDailyReportWorkbook,dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';

/**
 * DEC-537. The Daily Report gains a Quantity Targets section (used today, total used, percent complete, optional whole-project row) and
 * Wall Construction becomes optional in issued output. Defaults print exactly what was printed before.
 */
const report:DailyProjectReport={id:'r1',projectId:'p1',workDate:'2026-10-28',workDescription:'Paving',workers:[],drivers:[],operators:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',
  consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,createdAt:'2026-10-28T08:00:00Z',updatedAt:'2026-10-28T08:00:00Z'};
const project:ReportProject={id:'p1',name:'Highway Rehabilitation',customerName:'Road Co',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};

const item=(over:Partial<ContractItem>):ContractItem=>({id:'ci1',projectId:'p1',name:'Base Course Type A',unitId:'u_m3',unitSymbol:'m³',quantity:5000,unitPriceUsd:null,materialIds:['m'],status:'in_progress',completedOn:null,cancelledAt:null,...over});
const load=(over:Partial<ContractLoad>):ContractLoad=>({id:'l1',source:'company',reference:'L-1',materialId:'m',unitId:'u_m3',unitSymbol:'m³',quantity:100,date:'2026-10-28',status:'Active',contractItemId:'ci1',...over});
const progress=dailyContractProgress([
  {item:item({}),loads:[load({quantity:3860,date:'2026-10-20'}),load({id:'l2',quantity:320})],adjustments:[]},
  {item:item({id:'ci2',name:'Sub-base',quantity:3000}),loads:[load({id:'l3',contractItemId:'ci2',quantity:3070,date:'2026-10-25'}),load({id:'l4',contractItemId:'ci2',quantity:140})],adjustments:[]},
],'2026-10-28');

describe('Daily Report PDF, Quantity Targets',()=>{
  const html=(sections?:DailyReportSectionOptions)=>buildProjectReportHtmlWithWaste(report,project,[],[],[],[],company,null,[],false,null,[],[],sections);
  it('prints used today, total used, target, remaining and percent complete for each target that moved',()=>{
    const out=html({contractProgress:progress});
    expect(out).toContain('<h2>Quantity targets</h2>');
    expect(out).toContain('>Used today<');expect(out).toContain('>Total used<');expect(out).toContain('>% complete<');
    expect(out).toContain('Base Course Type A');
    expect(out).toContain('320 m³');expect(out).toContain('4180 m³');expect(out).toContain('83.6%');
    expect(out).toContain('over 210 m³');expect(out).toContain('107.0%');expect(out).toContain('pct-over');
  });
  it('prints the whole-project row by default and leaves it out when switched off',()=>{
    expect(html({contractProgress:progress})).toContain('class="target-whole"');
    expect(html({contractProgress:progress})).toContain('95.3%');
    expect(html({contractProgress:progress,includeWholeProject:false})).not.toContain('class="target-whole"');
    expect(html({contractProgress:progress,includeWholeProject:false})).toContain('83.6%');
  });
  it('places the section directly after Loads delivered and before Fuel used',()=>{
    const out=html({contractProgress:progress});
    expect(out.indexOf('Loads delivered')).toBeLessThan(out.indexOf('<h2>Quantity targets</h2>'));
    expect(out.indexOf('<h2>Quantity targets</h2>')).toBeLessThan(out.indexOf('<h2>Fuel used</h2>'));
  });
  it('prints nothing when Quantity Targets are off, absent or the project has none',()=>{
    expect(html()).not.toContain('Quantity targets');
    expect(html({contractProgress:null})).not.toContain('Quantity targets');
    expect(html({contractProgress:dailyContractProgress([],'2026-10-28')})).not.toContain('Quantity targets');
  });
  it('says so when targets exist but none moved that day, and still shows the whole-project row',()=>{
    const quiet=dailyContractProgress([{item:item({}),loads:[load({quantity:100,date:'2026-10-20'})],adjustments:[]}],'2026-10-28');
    const out=html({contractProgress:quiet});
    expect(out).toContain('No quantity target received a load on this date');
    expect(out).toContain('class="target-whole"');
  });
  it('escapes a target name',()=>{
    const out=html({contractProgress:dailyContractProgress([{item:item({name:'<b>Base</b> & co'}),loads:[load({})],adjustments:[]}],'2026-10-28')});
    expect(out).toContain('&lt;b&gt;Base&lt;/b&gt; &amp; co');
  });
  it('leaves the Wall construction section out only when switched off',()=>{
    expect(html()).toContain('<h2>Wall construction</h2>');
    expect(html({includeWall:true})).toContain('<h2>Wall construction</h2>');
    expect(html({includeWall:false})).not.toContain('<h2>Wall construction</h2>');
  });
});

describe('Daily Report workbook, Quantity Targets and Wall Construction',()=>{
  const names=(sections?:DailyReportSectionOptions)=>dailyReportWorkbookSheets(report,project,[],[],[],[],company,[],'en',[],[],sections).map(sheet=>sheet.name);
  it('adds a Quantity Targets sheet last, with real numbers and a whole-project row',()=>{
    const sheets=dailyReportWorkbookSheets(report,project,[],[],[],[],company,[],'en',[],[],{contractProgress:progress});
    expect(sheets.at(-1)!.name).toBe('Quantity Targets');
    const rows=sheets.at(-1)!.rows;
    expect(rows[0]).toMatchObject({Target:'Base Course Type A',Unit:'m³','Used Today':320,'Total Used':4180,'Target Quantity':5000,'Quantity Left':820,'Percent Complete':83.6,Status:'In progress'});
    expect(rows[1]).toMatchObject({Target:'Sub-base','Over Target By':210,'Percent Complete':107,Status:'Over target'});
    expect(rows.at(-1)).toMatchObject({'Percent Complete':95.3,'Used Today':null});
    expect(rows.at(-1)!.Target).toContain('Whole project');
  });
  it('drops the whole-project row when switched off',()=>{
    const rows=dailyReportWorkbookSheets(report,project,[],[],[],[],company,[],'en',[],[],{contractProgress:progress,includeWholeProject:false}).at(-1)!.rows;
    expect(rows).toHaveLength(2);
  });
  it('keeps the default sheet list unchanged when no option is given',()=>{
    expect(names()).not.toContain('Quantity Targets');
    expect(names({contractProgress:null})).not.toContain('Quantity Targets');
    expect(names({contractProgress:dailyContractProgress([],'2026-10-28')})).not.toContain('Quantity Targets');
    expect(names()).toEqual(expect.arrayContaining(['Wall Construction','Wall Layers','Wall Foundations','Lifts']));
  });
  it('removes the three wall sheets, keeping Lifts, when Wall Construction is switched off',()=>{
    const off=names({includeWall:false});
    for(const name of ['Wall Construction','Wall Layers','Wall Foundations'])expect(off).not.toContain(name);
    expect(off).toContain('Lifts');
  });
  it('builds a valid workbook with the new sheet and localizes it',()=>{
    expect(()=>buildDailyReportWorkbook(report,project,[],[],[],[],company,[],'en',[],[],{contractProgress:progress})).not.toThrow();
    expect(()=>buildDailyReportWorkbook(report,project,[],[],[],[],company,[],'ar',[],[],{contractProgress:progress})).not.toThrow();
  });
});

describe('the three new report-section switches',()=>{
  const reports=readFileSync(join(__dirname,'..','src/ui/screens/ReportsScreen.tsx'),'utf8');
  it('default to included and turn off only on the exact stored off value',()=>{
    expect(parseSectionPreference(null)).toBe(true);
    expect(parseSectionPreference('off')).toBe(false);
    for(const raw of ['OFF','0','false','{}'])expect(parseSectionPreference(raw)).toBe(true);
    for(const included of [true,false])expect(parseSectionPreference(serializeSectionPreference(included))).toBe(included);
  });
  it('use separate versioned keys so none affects another',()=>{
    const keys=[WALL_SECTION_PREFERENCE_KEY,CONTRACT_SECTION_PREFERENCE_KEY,CONTRACT_WHOLE_PROJECT_PREFERENCE_KEY];
    expect(new Set(keys).size).toBe(3);
    for(const key of keys)expect(key).toMatch(/^dromex\..*\.v\d+$/);
  });
  it('say plainly that excluding does not delete anything',()=>{
    expect(describeWallSectionPreference(false)).toMatch(/still recorded/i);
    expect(describeContractSectionPreference(false)).toMatch(/still tracked/i);
    expect(describeContractWholeProjectPreference(false)).toMatch(/left out/i);
  });
  it('are wired into the editor and both exports',()=>{
    expect(reports).toMatch(/<LedgerSection number="06" title="Quantity Targets"/);
    expect(reports).toMatch(/<LedgerSection number="09" title="Wall Construction"/);
    expect(reports).toContain('listLinkedContractProgress');
    expect(reports.match(/includeWall:includeWallSection,contractProgress:includeContractSection\?progress:null,includeWholeProject:includeContractWholeProject/g)).toHaveLength(2);
  });
});
