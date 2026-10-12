import {afterEach,describe,expect,it} from 'vitest';

import {SqliteWasteRepository} from '../src/data/repositories/SqliteWasteRepository';
import type {DieselBatchReport} from '../src/domain/dieselBatchReport';
import {buildWasteHistory,NO_DRIVER,wasteRangeFor,wasteRangeLabel,type WasteHistoryRow} from '../src/domain/wasteHistory';
import {buildDieselBatchReportHtml} from '../src/services/dieselBatchTemplate';
import {buildWasteHistoryHtml,wasteDriverWidths,type WasteHistoryPdf} from '../src/services/wasteHistoryTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * The waste dump history: days newest first, inside a day each project with its location, each driver's dumps and the
 * project total; then period totals per driver. Counts of dumps only, Active dumps only. Plus the project and site name
 * colour on the Diesel Batch Report. No record is changed by any of it.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

let n=0;
const row=(day:string,projectId:string,projectName:string,driver:string|null,extra:Partial<WasteHistoryRow>={}):WasteHistoryRow=>({
  id:`d${++n}`,projectId,projectName,projectLocation:null,workDate:day,dumpedAt:`${day}T09:00:00.000Z`,materialType:null,dumpLocation:null,truckProfileId:null,truckPlate:null,
  driverProfileId:driver?`drv_${driver}`:null,driverName:driver,notes:null,status:'Active',cancellationReason:null,cancelledAt:null,createdAt:SEED_TIME,updatedAt:SEED_TIME,...extra,
});
const many=(count:number,...args:Parameters<typeof row>)=>Array.from({length:count},()=>row(...args));
const ZEB='Zebdine - Choukine Road',AIN='Ain Qana - Jbaa';
const sample:WasteHistoryRow[]=[
  ...many(5,'2026-10-12','z',ZEB,'Ali kazem',{projectLocation:'Choukine Road'}),...many(3,'2026-10-12','z',ZEB,'Mohamad mohsen',{projectLocation:'Choukine Road'}),
  ...many(4,'2026-10-12','a',AIN,'Mahmoud doughman'),...many(2,'2026-10-12','a',AIN,'Ali kazem'),
  ...many(4,'2026-10-10','z',ZEB,'Ali kazem'),...many(1,'2026-10-09','a',AIN,null),
  row('2026-10-12','z',ZEB,'Ali kazem',{status:'Cancelled'}),
];

describe('the date ranges',()=>{
  it('makes this week Monday to Sunday around today, whatever day today is',()=>{
    expect(wasteRangeFor('week','2026-10-12')).toEqual({fromDate:'2026-10-12',toDate:'2026-10-18'});// a Monday
    expect(wasteRangeFor('week','2026-10-14')).toEqual({fromDate:'2026-10-12',toDate:'2026-10-18'});
    expect(wasteRangeFor('week','2026-10-18')).toEqual({fromDate:'2026-10-12',toDate:'2026-10-18'});// a Sunday
    expect(wasteRangeFor('week','2026-10-11')).toEqual({fromDate:'2026-10-05',toDate:'2026-10-11'});
  });
  it('makes this month the whole calendar month, and a custom range exactly what was chosen',()=>{
    expect(wasteRangeFor('month','2026-02-17')).toEqual({fromDate:'2026-02-01',toDate:'2026-02-28'});
    expect(wasteRangeFor('custom','2026-10-12',{fromDate:'2026-10-03',toDate:'2026-10-09'})).toEqual({fromDate:'2026-10-03',toDate:'2026-10-09'});
    expect(wasteRangeFor('custom','2026-10-12',{fromDate:'2026-10-09',toDate:'2026-10-03'})).toEqual({fromDate:'2026-10-03',toDate:'2026-10-09'});
    expect(wasteRangeLabel(wasteRangeFor('custom','2026-10-12'))).toBe('All dates');
    expect(wasteRangeLabel({fromDate:'2026-10-05',toDate:'2026-10-11'})).toBe('Mon 5 Oct 2026 – Sun 11 Oct 2026');
  });
});

describe('the history',()=>{
  const history=buildWasteHistory(sample,{fromDate:'2026-10-01',toDate:'2026-10-31'});
  it('lists the days newest first with each day total',()=>{
    expect(history.days.map(day=>[day.day,day.total])).toEqual([['2026-10-12',14],['2026-10-10',4],['2026-10-09',1]]);
    expect(history.days[0]!.label).toBe('Mon 12 Oct 2026');
  });
  it('groups a day by project with each driver count and the project total, most dumps first',()=>{
    const day=history.days[0]!;
    expect(day.projects.map(block=>[block.projectName,block.total])).toEqual([[AIN,6],[ZEB,8]]);
    expect(day.projects[1]!.drivers.map(driver=>[driver.name,driver.count])).toEqual([['Ali kazem',5],['Mohamad mohsen',3]]);
    expect(day.projects[1]!.location).toBe('Choukine Road');
  });
  it('totals each driver inside each project and over all projects for the period',()=>{
    expect(history.periodProjects.find(block=>block.projectId==='z')!.drivers.map(driver=>[driver.name,driver.count])).toEqual([['Ali kazem',9],['Mohamad mohsen',3]]);
    expect(history.periodDrivers.map(driver=>[driver.name,driver.count])).toEqual([['Ali kazem',11],['Mahmoud doughman',4],['Mohamad mohsen',3],[NO_DRIVER,1]]);
    expect(history.total).toBe(19);
  });
  it('never counts a cancelled dump, and says how many were left out',()=>{
    expect(history.cancelledCount).toBe(1);
    expect(history.days[0]!.total).toBe(14);
  });
  it('lists a dump with no driver as No driver',()=>{
    expect(history.days[2]!.projects[0]!.drivers).toEqual([{key:'none',name:NO_DRIVER,count:1}]);
  });
  it('keeps to the range and to one project when asked',()=>{
    expect(buildWasteHistory(sample,{fromDate:'2026-10-10',toDate:'2026-10-11'}).days.map(day=>day.day)).toEqual(['2026-10-10']);
    const one=buildWasteHistory(sample,{fromDate:'2026-10-01',toDate:'2026-10-31'},'z');
    expect(one.periodProjects.map(block=>block.projectId)).toEqual(['z']);
    expect(one.total).toBe(12);
  });
  it('is empty, not an error, when nothing was dumped',()=>{
    const none=buildWasteHistory([],{fromDate:'2026-10-01',toDate:'2026-10-31'});
    expect(none).toMatchObject({days:[],periodProjects:[],periodDrivers:[],total:0,cancelledCount:0});
  });
  it('treats the same driver typed on some dumps and picked on others by profile, not by spelling',()=>{
    const mixed=buildWasteHistory([row('2026-10-12','z',ZEB,'Ali'),row('2026-10-12','z',ZEB,'Ali')],{fromDate:'2026-10-12',toDate:'2026-10-12'});
    expect(mixed.periodDrivers).toEqual([{key:'drv_Ali',name:'Ali',count:2}]);
  });
});

describe('the read across every project',()=>{
  it('returns the dumps of every project in the range, with the project location, even for a completed project',async()=>{
    const database=await migratedDatabaseWithProject(databases);
    database.raw.exec(`
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('done','customer','Old Bypass','Saida','completed','2026-01-01','${SEED_TIME}','${SEED_TIME}',0);
      INSERT INTO waste_dumps (id,project_id,work_date,dumped_at,driver_name,status,created_at,updated_at) VALUES
        ('w1','road','2026-10-12','2026-10-12T08:00:00.000Z','Ali','Active','${SEED_TIME}','${SEED_TIME}'),
        ('w2','done','2026-10-11','2026-10-11T08:00:00.000Z','Omar','Active','${SEED_TIME}','${SEED_TIME}'),
        ('w3','road','2026-10-12','2026-10-12T09:00:00.000Z','Ali','Cancelled','${SEED_TIME}','${SEED_TIME}'),
        ('w4','road','2026-09-01','2026-09-01T09:00:00.000Z','Ali','Active','${SEED_TIME}','${SEED_TIME}');
    `);
    const rows=await new SqliteWasteRepository(database as never).listWasteHistory('2026-10-05','2026-10-18');
    expect(rows.map(value=>[value.id,value.projectName,value.projectLocation,value.status])).toEqual([['w3','Mountain Road','Aley','Cancelled'],['w1','Mountain Road','Aley','Active'],['w2','Old Bypass','Saida','Active']]);
    const built=buildWasteHistory(rows,{fromDate:'2026-10-05',toDate:'2026-10-18'});
    expect(built.total).toBe(2);
    expect(built.cancelledCount).toBe(1);
  });
});

describe('the Waste Dump History PDF',()=>{
  const history=buildWasteHistory(sample,{fromDate:'2026-10-01',toDate:'2026-10-31'});
  const input=(extra:Partial<WasteHistoryPdf>={}):WasteHistoryPdf=>({companyName:'Fakih & Sons',logo:null,contactLine:'Nabatieh · +961 70 000 000',generatedAt:'2026-10-12T10:00:00.000Z',projectLabel:'All projects',periodLabel:wasteRangeLabel(history.range),history,includeAllProjectsDriverTotals:true,...extra});
  const html=(extra:Partial<WasteHistoryPdf>={})=>buildWasteHistoryHtml(input(extra));
  it('is A4 with the company header, a running title and Page X of Y',()=>{
    const page=html();
    expect(page).toContain('size:A4');expect(page).toContain('counter(page)');expect(page).toContain('Fakih &amp; Sons');expect(page).toContain('Waste Dump History');
    expect(page).toContain('Fakih & Sons · Waste Dump History');
  });
  it('groups by day newest first, with the day total, each project, its location, the drivers and the project total',()=>{
    const page=html().replace(/<wbr>/g,'');
    // Each text is found after the previous one, so the page reads in exactly this order.
    let from=0;const found:number[]=[];
    for(const text of ['Mon 12 Oct 2026','14 dumps','Ain Qana - Jbaa','Mahmoud doughman','Project total','Zebdine - Choukine Road','Choukine Road</span>','Ali kazem','Mohamad mohsen','Sat 10 Oct 2026','Fri 9 Oct 2026','PERIOD TOTALS PER DRIVER','Each driver, all projects']){const at=page.indexOf(text,from);found.push(at);if(at>=0)from=at+text.length;}
    expect(found.every(index=>index>=0)).toBe(true);
  });
  it('writes the project name in the project colour, keeps the word PROJECT, and uses no symbol or colour key',()=>{
    const page=html();
    expect(page).toContain('.pname{font-size:10.5pt;font-weight:700;color:#C84B31');
    expect(page).toContain('<span class="ty">PROJECT</span>');
    expect(page).not.toMatch(/class="key"|◆|◇|📁|📍/);
    expect(page).toContain('No driver');
  });
  it('gives every table widths that add up to exactly 100',()=>{
    for(const drivers of [history.periodDrivers,history.days[0]!.projects[0]!.drivers,[]])expect(wasteDriverWidths(drivers).reduce((a,b)=>a+b,0)).toBe(100);
    expect([...html().matchAll(/<colgroup>(.*?)<\/colgroup>/g)].every(match=>[...match[1]!.matchAll(/width:(\d+)%/g)].reduce((sum,width)=>sum+Number(width[1]),0)===100)).toBe(true);
  });
  it('escapes names, counts only dumps, and states that cancelled ones were left out',()=>{
    const risky=buildWasteHistory([row('2026-10-12','x','<b>Pit</b> & Co','A <i>')],{fromDate:'2026-10-12',toDate:'2026-10-12'});
    const page=buildWasteHistoryHtml(input({history:risky}));
    expect(page).toContain('&lt;b&gt;Pit&lt;/b&gt; &amp; Co');expect(page).not.toContain('<b>Pit</b>');
    expect(html()).toContain('1 cancelled in this period were left out');
  });
  it('leaves out the all-projects driver card when asked, and says so plainly when empty',()=>{
    expect(html({includeAllProjectsDriverTotals:false})).not.toContain('Each driver, all projects');
    expect(buildWasteHistoryHtml(input({history:buildWasteHistory([],history.range)}))).toContain('No waste dumps were counted in this period.');
  });
});

describe('project and site names on the Diesel Batch Report',()=>{
  const destination=(name:string,typeLabel:string,totalLabel:string)=>({name,typeLabel,total:10,totalText:'10 L',totalLabel,days:[{label:'Mon 12 Oct 2026',total:10,totalText:'10 L',rows:[{date:'Mon 12 Oct 2026 · 10:00',equipment:'Bobcat',type:'Machine',source:'Tank · DSL-1',litres:'10 L'}]}]});
  const base:DieselBatchReport={
    scopeLabel:'All batches',metadata:[{label:'Batch',value:'All batches'}],summary:{deliveredLitres:100,filledLitres:30,adjustmentLitres:0,remainingLitres:70,filteredNote:null},
    sections:[{title:'PROJECTS',destinations:[destination('Zebdine','PROJECT','Project total')]},{title:'COMPANY SITES',destinations:[destination('Yard B','SITE','Site total')]},{title:'UNASSIGNED',destinations:[destination('Unassigned','UNASSIGNED','Unassigned total')]}],
    batchTotals:[],tank:{litres:'70 L',overfill:'None'},destinationTotals:[],adjustments:[],pricesIncluded:false,empty:false,fileName:'x.pdf',
  } as never;
  const page=buildDieselBatchReportHtml(base,{companyName:'DROMEX',logo:null,contactLine:null});
  it('colours a project name and a site name the same orange and keeps the words PROJECT and SITE',()=>{
    expect(page).toContain('.dest h3 .name{color:#C84B31}');
    expect(page).toContain('<span class="type">PROJECT</span><bdi dir="auto" class="name">Zebdine</bdi>');
    expect(page).toContain('<span class="type">SITE</span><bdi dir="auto" class="name">Yard B</bdi>');
  });
  it('leaves the unassigned group and the batch and supplier titles uncoloured',()=>{
    expect(page).toContain('<span class="type">UNASSIGNED</span><bdi dir="auto">Unassigned</bdi>');
    expect(page).not.toMatch(/class="key"/);
  });
});
