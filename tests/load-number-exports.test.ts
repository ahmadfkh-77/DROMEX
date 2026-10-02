import {afterEach,describe,expect,it} from 'vitest';

import {SqliteBusinessReportRepository} from '../src/data/repositories/SqliteBusinessReportRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import type {DailyProjectReport,LinkedProjectLoad,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import {dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {buildProjectCompletionHtml} from '../src/services/projectCompletionTemplate';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';
import {type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/** DEC-487 (6)-(7). The Company Load number in every report and export a company load appears in. */
const report:DailyProjectReport={id:'report-1',projectId:'road',workDate:'2026-08-10',workDescription:'Paving',workers:[],workerSafety:[],drivers:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,createdAt:'2026-08-10T17:00:00Z',updatedAt:'2026-08-10T17:00:00Z'};
const project:ReportProject={id:'road',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX Paving',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};
const loads:LinkedProjectLoad[]=[
  {id:'l1',transactionNumber:'20260810-AB12-00001',loadNumber:'ASP-2026-004',itemName:'Asphalt',quantity:18,unitSymbol:'t',driverName:'Omar',truckPlate:'B123'},
  {id:'l2',transactionNumber:'20260810-AB12-00002',loadNumber:null,itemName:'Asphalt',quantity:12,unitSymbol:'t',driverName:'Omar',truckPlate:'B123'},
];
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

describe('Daily Report PDF',()=>{
  it('lists each company load by its load number, with the legacy wording and the transaction number',()=>{
    const html=buildProjectReportHtmlWithWaste(report,project,loads,[],[],[],company,null,[]);
    expect(html).toContain('Load number');
    expect(html).toContain('ASP-2026-004');
    expect(html).toContain('Legacy load — no generated load number');
    expect(html).toContain('20260810-AB12-00001');
  });
});

describe('Daily Report workbook',()=>{
  it('adds a Load Number column to Linked Loads, leaving legacy loads honestly marked',()=>{
    const sheet=dailyReportWorkbookSheets(report,project,loads,[],[],[],company).find(value=>value.name==='Linked Loads')!;
    expect(sheet.rows.map(row=>row['Load Number'])).toEqual(['ASP-2026-004','Legacy load — no generated load number']);
    expect(sheet.rows[0]!['Transaction Number']).toBe('20260810-AB12-00001');
  });
});

describe('Completed Project report',()=>{
  it('prints load numbers in the delivered-loads appendix',()=>{
    const html=buildProjectCompletionHtml(project,[report],loads.map(load=>({...load,workDate:'2026-08-10'})),[],company,null,[]);
    expect(html).toContain('ASP-2026-004');
    expect(html).toContain('Legacy load — no generated load number');
  });
});

describe('business analysis workbook',()=>{
  it('appends a Load Number column to Loads and Sales, after every existing column',async()=>{
    const {db,companyLoad}=await recordsDatabase(databases);
    companyLoad('asphalt',{loadNumber:'ASP-2026-004',time:'08:00:00'});companyLoad('asphalt',{time:'11:00:00'});
    const loads=(await new SqliteBusinessReportRepository(db as never).getReportData()).loads;
    expect(loads.map(row=>row['Load Number'])).toEqual(['ASP-2026-004','Legacy load — no generated load number']);
    expect(Object.keys(loads[0]!).at(-1)).toBe('Load Number');
  });
});

describe('report repository',()=>{
  it('reads the load number with linked and project loads',async()=>{
    const {db,companyLoad}=await recordsDatabase(databases);
    companyLoad('asphalt',{loadNumber:'ASP-2026-004',day:'2026-08-10',time:'08:00:00'});companyLoad('asphalt',{day:'2026-08-10',time:'11:00:00'});
    const repository=new SqliteProjectReportRepository(db as never);
    expect((await repository.listLinkedLoads('road','2026-08-10')).map(load=>load.loadNumber)).toEqual(['ASP-2026-004',null]);
    expect((await repository.listProjectLoads('road')).map(load=>load.loadNumber)).toEqual(['ASP-2026-004',null]);
  });
});
