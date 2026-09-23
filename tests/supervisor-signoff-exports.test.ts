import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import type {DailyProjectReport,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import {dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';

/** DEC-479. The Supervisor Sign-off closes the Daily Report PDF, separate from the Consultant sign-off. */
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';
const base:DailyProjectReport={id:'r1',projectId:'p1',workDate:'2026-08-20',workDescription:'Pour',workers:[],drivers:[],operators:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',
  consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,createdAt:'2026-08-20T08:00:00Z',updatedAt:'2026-08-20T08:00:00Z'};
const report:DailyProjectReport={...base,supervisorSignoffs:[
  {supervisorId:'s1',name:'Nadim <b>Aoun</b>',jobTitle:'Resident Engineer',display:'name_with_signature',signature:[STROKE]},
  {supervisorId:'s2',name:'لينا خوري',jobTitle:null,display:'name_only',signature:[]},
]};
const project:ReportProject={id:'p1',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};
const build=(value:DailyProjectReport)=>buildProjectReportHtmlWithWaste(value,project,[],[],[],[],company,null,[]);

describe('Supervisor Sign-off in the Daily Report PDF',()=>{
  const html=build(report);
  it('closes the report: after Photo evidence and before the footer note',()=>{
    const signoff=html.indexOf('<h2 class="keep-next">Supervisor Sign-off</h2>');
    expect(signoff).toBeGreaterThan(html.indexOf('<h2>Photo evidence</h2>'));
    expect(signoff).toBeLessThan(html.indexOf('class="footer-note"'));
  });
  it('prints the supervisors in the selected order, each block kept together',()=>{
    expect(html.indexOf('Nadim')).toBeLessThan(html.indexOf('لينا خوري'));
    expect((html.match(/class="signoff-block/g)??[]).length).toBe(2);
    expect(html).toMatch(/\.signoff-block\{[^}]*break-inside:avoid/);
  });
  it('shows the name prominently and escaped, the title only when present, and supports Arabic',()=>{
    expect(html).toContain('<div class="signoff-name" dir="auto">Nadim &lt;b&gt;Aoun&lt;/b&gt;</div>');
    expect(html).toContain('<div class="signoff-title" dir="auto">Resident Engineer</div>');
    expect(html).toContain('<div class="signoff-name" dir="auto">لينا خوري</div>');
    expect((html.match(/class="signoff-title"/g)??[]).length).toBe(1);
  });
  it('draws a signature only when chosen, without stretching or cropping it',()=>{
    expect((html.match(/<svg class="signoff-signature"/g)??[]).length).toBe(1);
    expect(html).toContain('viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain(`<path d="${STROKE}"`);
  });
  it('makes a name-only sign-off look deliberate and complete, not like a missing signature',()=>{
    expect(html).toMatch(/signoff-block signoff-name-only[\s\S]*Sign-off recorded by name/);
    expect(html).not.toMatch(/signoff-name-only[^]*?Signature not supplied/);
  });
  it('never prints a stroke that is not signature data',()=>{
    const hostile=build({...base,supervisorSignoffs:[{supervisorId:'s',name:'X',jobTitle:null,display:'name_with_signature',signature:['M 1 1 L 2 2" onload="x']}]});
    expect(hostile).not.toContain('onload');
    expect(hostile).toContain('signoff-name-only');
  });
  it('is omitted entirely when no supervisor was selected, and stays independent of the Consultant sign-off',()=>{
    expect(build(base)).not.toContain('Supervisor Sign-off');
    const both=build({...report,consultantSignoffEnabled:true,consultantName:'Consultant Co',consultantSignaturePaths:[STROKE]});
    expect(both).toContain('<h2>Consultant Sign-off</h2>');
    expect(both).toContain('Supervisor Sign-off');
  });
});

describe('Supervisor Sign-off in the workbook',()=>{
  it('lists each sign-off in order without any signature data',()=>{
    const sheet=dailyReportWorkbookSheets(report,project,[],[],[],[],company).find(value=>value.name==='Supervisor Sign-off');
    expect(sheet?.rows).toEqual([
      {Order:1,'Supervisor ID':'s1',Supervisor:'Nadim <b>Aoun</b>','Job Title':'Resident Engineer','Sign-off':'Name with saved signature'},
      {Order:2,'Supervisor ID':'s2',Supervisor:'لينا خوري','Job Title':null,'Sign-off':'Name only'},
    ]);
    expect(JSON.stringify(sheet)).not.toContain('M 20.0');
  });
});

describe('Supervisor UI',()=>{
  const read=(path:string)=>existsSync(join(__dirname,'..',path))?readFileSync(join(__dirname,'..',path),'utf8'):'';
  it('manages supervisors from PDF Settings on their own screen',()=>{
    const app=read('src/ui/DromexApp.tsx');
    expect(app).toContain("screen==='supervisors'");
    expect(read('src/ui/screens/PdfSettingsScreen.tsx')).toContain('onOpenSupervisors');
    const screen=read('src/ui/screens/SupervisorsScreen.tsx');
    expect(screen).toContain('<SignaturePad');
    expect(screen).toContain('Add supervisor');
    expect(screen).toContain('Remove saved signature');
    expect(screen).toMatch(/future reports only/i);
  });
  it('selects supervisors in the Daily Report, in order, each as name only or with the saved signature',()=>{
    const picker=read('src/ui/components/SupervisorSignoffPicker.tsx');
    for(const call of ['addSupervisorSignoff(','removeSupervisorSignoff(','moveSupervisorSignoff(','setSupervisorSignoffDisplay('])expect(picker).toContain(call);
    expect(picker).toContain("'Name only'");
    expect(picker).toContain("'Name + saved signature'");
    expect(read('src/ui/screens/ReportsScreen.tsx')).toContain('<SupervisorSignoffPicker');
  });
});
