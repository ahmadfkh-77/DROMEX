import {afterEach,describe,expect,it} from 'vitest';

import {SqliteDayRecordsRepository} from '../src/data/repositories/SqliteDayRecordsRepository';
import {buildCompanyDailyReport,type DayArrival,type DayInput,type DayIssue,type DayDailyReport,type DayLoadOut} from '../src/domain/companyDailyReport';
import {loadCompanyDailyReport} from '../src/services/companyDailyReportLoader';
import {buildCompanyDailyReportHtml} from '../src/services/companyDailyReportTemplate';
import {companyDailyReportSheets} from '../src/services/companyDailyReportWorkbook';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

const DAY='2026-11-06';
const arrival=(over:Partial<DayArrival>={}):DayArrival=>({id:'a1',status:'Active',time:`${DAY}T07:00:00`,kind:'fuel',material:'diesel',unitSymbol:'L',quantity:8000,supplierName:'Al-Nour Fuel',detail:'D-4411',...over});
const issue=(over:Partial<DayIssue>={}):DayIssue=>({id:'i1',time:`${DAY}T08:10:00`,projectId:'p1',projectName:'Airport Road',title:'Crusher stopped',priority:'High',status:'Open',...over});
const report=(over:Partial<DayDailyReport>={}):DayDailyReport=>({id:'r1',projectId:'p1',projectName:'Airport Road',photos:6,notes:3,...over});
const out=(over:Partial<DayLoadOut>={}):DayLoadOut=>({id:'l1',status:'Active',time:`${DAY}T07:40:00`,loadNumber:'ASP-1',itemName:'Asphalt',unitSymbol:'t',quantity:22,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:'T-12',driverName:'Samir',bitumenKg:null,bitumenApplies:false,...over});
const empty:DayInput={loadsOut:[],supplierLoads:[],fills:[],dumps:[]};
const build=(input:Partial<DayInput>)=>buildCompanyDailyReport(DAY,{...empty,...input});
const html=(input:Partial<DayInput>)=>buildCompanyDailyReportHtml({logo:null,report:build(input)});

describe('Arrived today - the model',()=>{
  it('groups deliveries by kind (fuel by type, bitumen, stock), oldest first, with a total per material and unit',()=>{
    const r=build({arrivals:[arrival({id:'b',time:`${DAY}T09:00:00`,quantity:100}),arrival(),arrival({id:'bit',kind:'bitumen',material:'Bitumen',unitSymbol:'kg',quantity:24000,detail:'60/70',supplierName:'Petro Co'}),arrival({id:'s',kind:'stock',material:'Cement',unitSymbol:'bags',quantity:120,detail:null,supplierName:'BuildCo'})]});
    expect(r.arrivals.map(g=>g.title)).toEqual(['Diesel deliveries','Bitumen deliveries','Stock receipts']);
    expect(r.arrivals[0]!.rows.map(v=>v.id)).toEqual(['a1','b']);expect(r.arrivals[0]!.totals).toEqual([{material:'diesel',unitSymbol:'L',quantity:8100,count:2}]);
  });
  it('leaves cancelled deliveries out and never adds different units together',()=>{
    const r=build({arrivals:[arrival({status:'Cancelled'}),arrival({id:'x',kind:'stock',material:'Cement',unitSymbol:'bags',quantity:5,detail:null}),arrival({id:'y',kind:'stock',material:'Cement',unitSymbol:'kg',quantity:7,detail:null})]});
    expect(r.arrivals).toHaveLength(1);expect(r.arrivals[0]!.totals.map(t=>[t.unitSymbol,t.quantity])).toEqual([['bags',5],['kg',7]]);
  });
  it('makes a day with only deliveries worth showing, and an empty day empty',()=>{
    expect(build({arrivals:[arrival()]}).isEmpty).toBe(false);expect(build({}).isEmpty).toBe(true);expect(build({}).arrivals).toEqual([]);
  });
});

describe('Arrived today - the PDF',()=>{
  const full=html({arrivals:[arrival(),arrival({id:'bit',kind:'bitumen',material:'Bitumen',unitSymbol:'kg',quantity:24000,detail:'60/70',supplierName:'Petro Co'}),arrival({id:'s',kind:'stock',material:'Cement',unitSymbol:'bags',quantity:120,detail:null,supplierName:'BuildCo'})]});
  it('prints one table per kind with its own total row and the delivery details',()=>{
    for(const text of ['Arrived today','Diesel deliveries','Bitumen deliveries','Stock receipts','Al-Nour Fuel','D-4411','60/70','Petro Co','BuildCo','Total diesel arrived','Total bitumen arrived','Total cement received'])expect(full).toContain(text);
    expect(full).toContain('8,000 litres');expect(full).toContain('24,000 kg');expect(full).toContain('120 bags');
  });
  it('lists it in the contents and shows Fuel arrived beside Fuel given in the totals',()=>{
    const withFuel=html({loadsOut:[out()],fills:[{id:'f',status:'Active',time:`${DAY}T06:30:00`,givenTo:'Excavator',fuelType:'diesel',operatorName:null,litres:120,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null}],arrivals:[arrival()]});
    expect(withFuel.slice(withFuel.indexOf('Contents'),withFuel.indexOf('</ol>'))).toContain('Arrived today');
    expect(withFuel).toContain('Fuel arrived');expect(withFuel).toContain('Fuel given');
  });
  it('prints nothing for a day with no deliveries: no heading, no empty table, no zero row',()=>{
    const none=html({loadsOut:[out()]});expect(none).not.toContain('Arrived today');expect(none).not.toContain('deliveries');expect(none).not.toContain('Fuel arrived');
  });
  it('prints an arrivals-only day instead of "nothing recorded"',()=>{expect(html({arrivals:[arrival()]})).not.toContain('Nothing was recorded on this day');});
});

describe('Issues and Daily Reports - the model and the PDF',()=>{
  it('lists the day\'s issues and daily reports, newest data first by time, with counts only',()=>{
    const r=build({issues:[issue({id:'i2',time:`${DAY}T11:40:00`,title:'Missing rebar',status:'Resolved'}),issue()],dailyReports:[report()]});
    expect(r.issues.map(i=>i.id)).toEqual(['i1','i2']);expect(r.dailyReports[0]).toMatchObject({photos:6,notes:3});expect(r.isEmpty).toBe(false);
  });
  it('prints Issues and Daily Reports tables with counted photos and notes, and never the photos or long notes',()=>{
    const p=html({issues:[issue()],dailyReports:[report()]});
    for(const text of ['Issues and Daily Reports','Crusher stopped','High','Open','Airport Road'])expect(p).toContain(text);
    expect(p).toContain('1 report');expect(p).toContain('6 photos');
  });
  it('prints only the part that exists and nothing when there is neither',()=>{
    const onlyIssue=html({issues:[issue()]});expect(onlyIssue).toContain('>Issues<');expect(onlyIssue).not.toContain('>Daily Reports<');
    expect(html({loadsOut:[out()]})).not.toContain('Issues and Daily Reports');
  });
  it('escapes issue text',()=>{expect(html({issues:[issue({title:'<b>x</b>'})]})).not.toContain('<b>x</b>');});
});

describe('Workbook sheets for arrivals and issues',()=>{
  const sheets=companyDailyReportSheets(build({arrivals:[arrival()],issues:[issue()],dailyReports:[report()]}));
  it('adds Arrived today with real numbers and units in their own column',()=>{
    const sheet=sheets.find(s=>s.name==='Arrived today')!;
    expect(sheet.rows[0]).toMatchObject({'Record Type':'Fuel delivery',Date:DAY,Time:'07:00',Material:'diesel',Unit:'L',Quantity:8000,Supplier:'Al-Nour Fuel','Ticket Or Grade':'D-4411','Record ID':'a1'});
  });
  it('adds Issues and Reports with counts as numbers',()=>{
    const sheet=sheets.find(s=>s.name==='Issues and Reports')!;
    expect(sheet.rows.find(r=>r['Record Type']==='Issue')).toMatchObject({Project:'Airport Road',Title:'Crusher stopped',Priority:'High',Status:'Open'});
    expect(sheet.rows.find(r=>r['Record Type']==='Daily report')).toMatchObject({Photos:6,Notes:3});
  });
  it('adds neither sheet when nothing was recorded',()=>{
    const names=companyDailyReportSheets(build({loadsOut:[out()]})).map(s=>s.name);expect(names).not.toContain('Arrived today');expect(names).not.toContain('Issues and Reports');
  });
});

describe('loadCompanyDailyReport - arrivals, issues and reports',()=>{
  const base={totals:{listRecords:async()=>[]},waste:{listWasteHistory:async()=>[]},bitumen:{getOverview:async()=>({usingBatchId:null,totalRemainingKg:0,rulesEnabled:0,batches:[{id:'bb',batchNumber:'B-1',arrivedAt:`${DAY}T09:20:00`,supplierName:'Petro Co',gradeName:'60/70',ticketNumber:'T-9',deliveredKg:24000,recordStatus:'Active',subtotalUsd:null},{id:'old',batchNumber:'B-0',arrivedAt:'2026-11-05T09:20:00',supplierName:'Petro Co',gradeName:'60/70',deliveredKg:100,recordStatus:'Active'}] as never,useRows:[]})}};
  it('reads diesel deliveries, bitumen batches and stock batches of the day, active only',async()=>{
    const r=await loadCompanyDailyReport(DAY,{...base,
      fuel:{getOverview:async()=>({currentBalanceLitres:0,hasKnownBalance:false,latestGauge:null,movements:[{id:'d1',type:'delivery',fuelType:'diesel',confirmedAt:`${DAY}T07:00:00`,litres:8000,supplierName:'Al-Nour Fuel',ticketNumber:'D-4411',status:'Active',subtotalUsd:null},{id:'d2',type:'delivery',fuelType:'diesel',confirmedAt:`${DAY}T08:00:00`,litres:5,status:'Cancelled'}] as never})},
      stock:{getOverview:async()=>({items:[{itemId:'i',itemName:'Cement',unitSymbol:'bags',batches:[{id:'sb',arrivedAt:`${DAY}T10:05:00`,supplierName:'BuildCo',quantity:120,recordStatus:'Active',subtotalUsd:null,priceBasis:null,priceUsd:null},{id:'sx',arrivedAt:`${DAY}T10:06:00`,quantity:1,recordStatus:'Cancelled'}]}]} as never)}});
    expect(r.arrivals.map(g=>[g.title,g.rows.length])).toEqual([['Diesel deliveries',1],['Bitumen deliveries',1],['Stock receipts',1]]);
    expect(r.arrivals[0]!.rows[0]).toMatchObject({material:'diesel',quantity:8000,detail:'D-4411'});expect(r.arrivals[1]!.rows[0]).toMatchObject({quantity:24000,detail:'60/70'});
  });
  it('reads the day\'s issues and daily reports from the day-records repository',async()=>{
    const r=await loadCompanyDailyReport(DAY,{...base,fuel:{getOverview:async()=>({currentBalanceLitres:0,hasKnownBalance:false,latestGauge:null,movements:[]})},dayRecords:{listIssues:async()=>[issue()],listDailyReports:async()=>[report()]}});
    expect(r.issues).toHaveLength(1);expect(r.dailyReports).toHaveLength(1);
  });
});

describe('SqliteDayRecordsRepository (read only)',()=>{
  const open:SqliteTestDatabase[]=[];afterEach(()=>{for(const database of open.splice(0))database.close();});
  async function setup(){
    const db=await migratedDatabaseWithProject(open);
    db.raw.exec(`
      INSERT INTO project_issues (id,project_id,title,priority,status,created_at,updated_at) VALUES ('i1','road','Crusher stopped','High','Open','${DAY}T10:10:00.000Z','${DAY}T10:10:00.000Z'),('i2','road','Yesterday','Normal','Open','2026-11-04T10:00:00.000Z','2026-11-04T10:00:00.000Z');
      INSERT INTO daily_project_reports (id,project_id,work_date,work_description,notes,problems_delays_incidents,weather_site_conditions,photos_json,created_at,updated_at) VALUES ('r1','road','${DAY}','Paving','note','problem','','["a.jpg","b.jpg"]','${SEED_TIME}','${SEED_TIME}');
    `);
    return new SqliteDayRecordsRepository(db as never);
  }
  it('lists the issues created that day, with the project name',async()=>{
    const list=await (await setup()).listIssues(DAY);
    expect(list).toHaveLength(1);expect(list[0]).toMatchObject({id:'i1',projectId:'road',projectName:'Mountain Road',title:'Crusher stopped',priority:'High',status:'Open'});
  });
  it('lists the day\'s daily reports with counted photos and filled notes, never the text',async()=>{
    const list=await (await setup()).listDailyReports(DAY);
    expect(list).toEqual([{id:'r1',projectId:'road',projectName:'Mountain Road',photos:2,notes:2}]);
  });
  it('is empty for a day with nothing',async()=>{const repo=await setup();expect(await repo.listIssues('2026-01-01')).toEqual([]);expect(await repo.listDailyReports('2026-01-01')).toEqual([]);});
});
