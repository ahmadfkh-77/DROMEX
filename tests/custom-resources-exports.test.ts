import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import type {DailyProjectReport,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import {dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';

/** DEC-478. Selected custom resources print under their own directory heading; empty ones never do. */
const base:DailyProjectReport={id:'r1',projectId:'p1',workDate:'2026-08-20',workDescription:'Formwork',workers:[],drivers:[],operators:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',
  consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,createdAt:'2026-08-20T08:00:00Z',updatedAt:'2026-08-20T08:00:00Z'};
const report:DailyProjectReport={...base,customResources:[
  {directoryId:'d_eng',directoryName:'Site Engineers',entries:[{entryId:'e1',name:'Rami Saad',identifier:'ENG-4',note:'Checked <formwork> & levels'},{entryId:'e2',name:'مهندس الموقع',identifier:null,note:null}]},
  {directoryId:'d_gen',directoryName:'Generators',entries:[{entryId:'g1',name:'Generator 60 kVA',identifier:'GEN-2',note:null}]},
]};
const project:ReportProject={id:'p1',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};

describe('Daily Report PDF custom resources',()=>{
  const html=buildProjectReportHtmlWithWaste(report,project,[],[],[],[],company,null,[]);
  it('prints each selected directory under its own heading in the recorded order',()=>{
    const engineers=html.indexOf('>Site Engineers<'),generators=html.indexOf('>Generators<');
    expect(engineers).toBeGreaterThan(0);
    expect(generators).toBeGreaterThan(engineers);
  });
  it('prints name, identifier and note, escaping custom text and letting mixed-direction names lay themselves out',()=>{
    expect(html).toContain('Checked &lt;formwork&gt; &amp; levels');
    expect(html).not.toContain('<formwork>');
    expect(html).toContain('<td dir="auto">مهندس الموقع</td>');
    expect(html).toContain('ENG-4');
    expect(html).toMatch(/Generator 60 kVA<\/td><td[^>]*>GEN-2/);
  });
  it('keeps each directory block together and never prints an empty directory',()=>{
    expect(html).toContain('class="resource-group"');
    expect(html).toMatch(/\.resource-group\{[^}]*break-inside:avoid/);
    const none=buildProjectReportHtmlWithWaste(base,project,[],[],[],[],company,null,[]);
    expect(none).not.toContain('class="resource-group"');
    const empty=buildProjectReportHtmlWithWaste({...base,customResources:[{directoryId:'x',directoryName:'Empty Dir',entries:[]}]},project,[],[],[],[],company,null,[]);
    expect(empty).not.toContain('Empty Dir');
  });
});

describe('Daily Report workbook custom resources',()=>{
  it('adds a flat, filterable Custom Resources sheet with stable ids',()=>{
    const sheet=dailyReportWorkbookSheets(report,project,[],[],[],[],company).find(value=>value.name==='Custom Resources');
    expect(sheet?.rows).toEqual([
      {'Directory ID':'d_eng',Directory:'Site Engineers','Entry ID':'e1',Entry:'Rami Saad',Identifier:'ENG-4','Report Note':'Checked <formwork> & levels'},
      {'Directory ID':'d_eng',Directory:'Site Engineers','Entry ID':'e2',Entry:'مهندس الموقع',Identifier:null,'Report Note':null},
      {'Directory ID':'d_gen',Directory:'Generators','Entry ID':'g1',Entry:'Generator 60 kVA',Identifier:'GEN-2','Report Note':null},
    ]);
  });
});

describe('Custom Directories UI',()=>{
  const read=(path:string)=>existsSync(join(__dirname,'..',path))?readFileSync(join(__dirname,'..',path),'utf8'):'';
  it('has its own focused screen routed from People & Equipment',()=>{
    const app=read('src/ui/DromexApp.tsx');
    expect(app).toContain("screen==='customDirectories'");
    expect(app).toMatch(/<PeopleEquipmentScreen[^>]*onOpenCustomDirectories=\{\(\)=>navigate\('customDirectories'\)\}/);
    const screen=read('src/ui/screens/CustomDirectoriesScreen.tsx');
    expect(screen).toContain('<FocusedSheet');
    expect(screen).toContain('Add directory');
    expect(screen).toContain('Add entry');
    expect(screen).toContain('Archived directories');
    expect(screen).toMatch(/accessibilityLabel=\{`Move \$\{[^}]+\} up`\}/);
  });
  it('lets a Daily Report select entries per directory and add a report-specific note',()=>{
    const picker=read('src/ui/components/CustomResourcePicker.tsx');
    expect(picker).toContain('addCustomResourceEntry(');
    expect(picker).toContain('removeCustomResourceEntry(');
    expect(picker).toContain('setCustomResourceNote(');
    expect(picker).toContain('Note for this report');
    const reports=read('src/ui/screens/ReportsScreen.tsx');
    expect(reports).toContain('<CustomResourcePicker');
  });
});
