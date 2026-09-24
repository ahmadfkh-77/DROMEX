import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import type {DailyProjectReport,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import {dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {buildProjectCompletionHtml} from '../src/services/projectCompletionTemplate';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';

/** DEC-476. Operators are their own category everywhere Workers and Drivers already appear. */
const report:DailyProjectReport={id:'r1',projectId:'p1',workDate:'2026-08-20',workDescription:'Grading',workers:['Ali Mansour'],drivers:['Omar Haddad'],operators:['Rami Saad','رامي سعد'],
  workerSafety:[{workerName:'Rami Saad',participantType:'operator',status:'missing',missingItems:['Hearing protection'],notes:''}],
  truckPlates:[],machines:['Excavator'],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',
  consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,
  consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,createdAt:'2026-08-20T08:00:00Z',updatedAt:'2026-08-20T08:00:00Z'};
const project:ReportProject={id:'p1',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};

describe('Daily Report PDF',()=>{
  const html=buildProjectReportHtmlWithWaste(report,project,[],[],[],[],company,null,[]);
  it('lists Operators as their own People and equipment row, escaped and direction-safe',()=>{
    expect(html).toMatch(/<td>Operators<\/td><td class="number">2<\/td><td>Rami Saad; <bdi>رامي سعد<\/bdi><\/td>|<td>Operators<\/td><td class="number">2<\/td>/);
    expect(html).toContain('Rami Saad');
    expect(html).toContain('رامي سعد');
  });
  it('gives each Operator a PPE row labelled Operator',()=>{
    expect(html).toMatch(/<td>Rami Saad<\/td><td>Operator<\/td><td><span[^>]*>Missing PPE<\/span><\/td><td>Hearing protection<\/td>/);
  });
  it('still reads a report saved before Operators existed',()=>{
    const legacy={...report,operators:undefined};
    expect(()=>buildProjectReportHtmlWithWaste(legacy,project,[],[],[],[],company,null,[])).not.toThrow();
    expect(buildProjectReportHtmlWithWaste(legacy,project,[],[],[],[],company,null,[])).toMatch(/<td>Operators<\/td><td class="number">0<\/td>/);
  });
});

describe('Daily Report workbook',()=>{
  const sheets=dailyReportWorkbookSheets(report,project,[],[],[],[],company);
  it('adds an Operators presence row and Operator PPE rows',()=>{
    expect(sheets.find(sheet=>sheet.name==='Presence')?.rows).toContainEqual({Category:'Operators',Entries:'Rami Saad, رامي سعد'});
    expect(sheets.find(sheet=>sheet.name==='Worker Safety')?.rows).toContainEqual({Person:'Rami Saad',Role:'Operator',Status:'Missing PPE','Missing PPE':'Hearing protection',Notes:null});
  });
});

describe('Project completion report',()=>{
  it('counts Operators separately from Workers and Drivers',()=>{
    const html=buildProjectCompletionHtml(project,[report],[],[],company,null,[]);
    expect(html).toContain('<h3>Operators</h3>');
    expect(html).toContain('Rami Saad');
  });
});

describe('Daily Report editor',()=>{
  it('offers Operators as their own selectable category with PPE',()=>{
    const screen=readFileSync(join(__dirname,'..','src/ui/screens/ReportsScreen.tsx'),'utf8');
    expect(screen).toMatch(/<PresenceField label="Operators" options=\{setup\.presenceOptions\.operators\}/);
    expect(screen).toContain("type:'operator' as const,label:'Operator'");
  });
});
