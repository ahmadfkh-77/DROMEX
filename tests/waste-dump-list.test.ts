import {afterEach,describe,expect,it} from 'vitest';

import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import type {LinkedWasteDump,ProjectCompletionWasteDump} from '../src/domain/projectReports';
import {clockTime,dumpsByTruck,dumpsSummaryLine,orderedDumps} from '../src/domain/wasteDumpList';
import {buildProjectCompletionHtml} from '../src/services/projectCompletionTemplate';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';
import {dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Daily Report and Project Completion report: every waste dump on its own line (number, time, material, location,
 * truck, driver and the note typed on it), in time order, under the existing count summary and a line per truck. A PDF
 * layout change only: no record is touched and cancelled dumps never appear.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

const at=(time:string,day='2026-10-10')=>`${day}T${time}:00`;
const dump=(id:string,time:string,material:string,location:string,plate:string|null,driver:string|null,notes:string|null=null,day='2026-10-10'):LinkedWasteDump=>({id,dumpedAt:at(time,day),materialType:material,dumpLocation:location,truckPlate:plate,driverName:driver,notes});
const SOIL='Excavation soil',PIT='Quarry pit A',DEBRIS='Demolition debris',LANDFILL='Landfill, Aley';
/** The twelve dumps of the mockup: three trucks, two materials. Deliberately given out of time order. */
const day:LinkedWasteDump[]=[
  dump('d5','09:30',SOIL,PIT,'112233','R. Haddad'),dump('d1','07:42',SOIL,PIT,'B 884211','Walid Khoury','First load of the day'),dump('d2','08:10',SOIL,PIT,'112233','R. Haddad'),
  dump('d3','08:35',SOIL,PIT,'B 884211','Walid Khoury'),dump('d4','09:05',DEBRIS,LANDFILL,'445566','K. Nasr','Mixed with <rebar> & wire'),dump('d6','10:12',SOIL,PIT,'B 884211','Walid Khoury'),
  dump('d7','10:48',DEBRIS,LANDFILL,'445566','K. Nasr'),dump('d8','11:20',SOIL,PIT,'112233','R. Haddad'),dump('d9','12:40',DEBRIS,LANDFILL,'445566','K. Nasr'),
  dump('d10','13:20',SOIL,PIT,'112233','R. Haddad'),dump('d11','14:05',SOIL,PIT,'B 884211','Walid Khoury'),dump('d12','14:55',SOIL,PIT,'B 884211',null),
];
const report={workDate:'2026-10-10',workDescription:'Excavation',workers:[],drivers:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,projectId:'p',id:'r',createdAt:'',updatedAt:''};
const company={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};
const project={id:'p',name:'Highway Link',customerName:'Customer',location:'Zahle',status:'active'};
const dailyHtml=(dumps:LinkedWasteDump[])=>buildProjectReportHtmlWithWaste(report as never,project as never,[],dumps,company as never,null,[]).replace(/\s+/g,' ');
const section=(html:string)=>{const start=html.indexOf('<h2>Waste dumps completed</h2>');return html.slice(start,html.indexOf('</section>',start));};

describe('the list helpers',()=>{
  it('puts dumps in time order, with the id as the tie-break, and gives the clock time',()=>{
    expect(orderedDumps(day).map(value=>value.id)).toEqual(['d1','d2','d3','d4','d5','d6','d7','d8','d9','d10','d11','d12']);
    expect(clockTime(at('07:42'))).toBe('07:42');expect(clockTime(at('00:05'))).toBe('00:05');expect(clockTime('not a date')).toBe('');
  });
  it('counts each truck with its first and last dump, most dumps first',()=>{
    expect(dumpsByTruck(day)).toEqual([
      {truckPlate:'B 884211',driverName:'Walid Khoury',count:5,first:'07:42',last:'14:55'},
      {truckPlate:'112233',driverName:'R. Haddad',count:4,first:'08:10',last:'13:20'},
      {truckPlate:'445566',driverName:'K. Nasr',count:3,first:'09:05',last:'12:40'},
    ]);
  });
  it('writes "3 trucks · first to last", and nothing for no dumps',()=>{
    expect(dumpsSummaryLine(day)).toBe('3 trucks · 07:42 to 14:55');
    expect(dumpsSummaryLine([day[1]!])).toBe('1 truck · 07:42 to 07:42');expect(dumpsSummaryLine([])).toBe('');
  });
});

describe('the Daily Report PDF',()=>{
  it('keeps the count card and the Material / Location summary exactly as before',()=>{
    const waste=section(dailyHtml(day));
    expect(waste).toContain('<strong>12</strong><b>TOTAL DUMPS</b><small>Total completed dumps: 12</small>');
    expect(waste).toContain('<td>Excavation soil</td><td>Quarry pit A</td><td class="number">9</td>');
    expect(waste).toContain('<td>Demolition debris</td><td>Landfill, Aley</td><td class="number">3</td>');
  });
  it('lists every dump in time order with its number, time, material, location, truck, driver and note',()=>{
    const waste=section(dailyHtml(day));
    expect(waste).toContain('<h3 class="dump-sub">Each dump, in time order</h3>');
    expect(waste).toContain('<th class="number">No.</th><th>Time</th><th>Material</th><th>Dump location</th><th>Truck plate</th><th>Driver</th><th>Notes</th>');
    const rows=[...waste.matchAll(/<tr><td class="number">(\d+)<\/td><td>(\d\d:\d\d)<\/td>/g)].map(match=>[Number(match[1]),match[2]]);
    expect(rows).toEqual([[1,'07:42'],[2,'08:10'],[3,'08:35'],[4,'09:05'],[5,'09:30'],[6,'10:12'],[7,'10:48'],[8,'11:20'],[9,'12:40'],[10,'13:20'],[11,'14:05'],[12,'14:55']]);
    expect(waste).toContain('<tr><td class="number">1</td><td>07:42</td><td>Excavation soil</td><td>Quarry pit A</td><td>B 884211</td><td>Walid Khoury</td><td class="dump-note">First load of the day</td></tr>');
  });
  it('prints a note as typed but safely, and a dash for a missing driver or note',()=>{
    const waste=section(dailyHtml(day));
    expect(waste).toContain('Mixed with &lt;rebar&gt; &amp; wire');expect(waste).not.toContain('<rebar>');
    expect(waste).toContain('<td class="number">12</td><td>14:55</td><td>Excavation soil</td><td>Quarry pit A</td><td>B 884211</td><td>&mdash;</td><td class="dump-note">&mdash;</td>');
  });
  it('adds a line per truck with its dumps and first and last time',()=>{
    const waste=section(dailyHtml(day));
    expect(waste).toContain('<h3 class="dump-sub">Dumps by truck</h3>');
    expect(waste).toContain('<tr><td>B 884211</td><td>Walid Khoury</td><td class="number">5</td><td>07:42</td><td>14:55</td></tr>');
    expect(waste).toContain('<tr><td>445566</td><td>K. Nasr</td><td class="number">3</td><td>09:05</td><td>12:40</td></tr>');
    expect(waste).toContain('<small>3 trucks · 07:42 to 14:55</small>');
  });
  it('keeps the column headings on every page, never splits a row, and the widths add up to 100%',()=>{
    const html=dailyHtml(day);
    expect(html).toContain('thead{display:table-header-group}');expect(html).toContain('.dump-table tr{break-inside:avoid;page-break-inside:avoid}');
    for(const colgroup of section(html).match(/<colgroup>.*?<\/colgroup>/g)!)expect([...colgroup.matchAll(/width:(\d+)%/g)].reduce((sum,match)=>sum+Number(match[1]),0)).toBe(100);
  });
  it('stays the same with no dumps: the empty row and no new tables',()=>{
    const waste=section(dailyHtml([]));
    expect(waste).toContain('<td colspan="3" class="empty">No completed waste dumps for this date</td>');
    expect(waste).not.toContain('Each dump, in time order');expect(waste).not.toContain('Dumps by truck');
    expect(waste).toContain('Total completed dumps: 0');
  });
  it('lists a long day without limit and keeps the numbering to the last dump',()=>{
    const many=Array.from({length:30},(_,index)=>dump(`m${index}`,`${String(7+Math.floor(index/3)).padStart(2,'0')}:${String((index%3)*17).padStart(2,'0')}`,SOIL,PIT,'112233','R. Haddad'));
    const waste=section(dailyHtml(many));
    expect([...waste.matchAll(/<tr><td class="number">(\d+)<\/td><td>\d\d:\d\d<\/td>/g)].length).toBe(30);
    expect(waste).toContain('<tr><td class="number">30</td>');
  });
});

describe('the Project Completion report',()=>{
  const waste:ProjectCompletionWasteDump[]=[
    {...dump('a','09:00',SOIL,PIT,'112233','R. Haddad','Wet day','2026-10-02'),workDate:'2026-10-02'},
    {...dump('c','08:00',DEBRIS,LANDFILL,null,null,null,'2026-10-03'),workDate:'2026-10-03'},
    {...dump('b','14:00',SOIL,PIT,'445566','K. Nasr',null,'2026-10-02'),workDate:'2026-10-02'},
  ];
  const html=buildProjectCompletionHtml(project as never,[],[],waste,company as never,null,[]).replace(/\s+/g,' ');
  it('numbers every dump in date and time order and adds the Notes column',()=>{
    const appendix=html.slice(html.indexOf('APPENDIX B'));
    expect(appendix).toContain('<th class="number">No.</th><th>Date</th><th>Time</th><th>Material</th><th>Location</th><th>Truck</th><th>Driver</th><th>Notes</th>');
    expect([...appendix.matchAll(/<tr><td class="number">(\d+)<\/td><td>[^<]*<\/td><td>(\d\d:\d\d)<\/td>/g)].map(match=>[Number(match[1]),match[2]])).toEqual([[1,'09:00'],[2,'14:00'],[3,'08:00']]);
    expect(appendix.indexOf('Wet day')).toBeLessThan(appendix.indexOf('445566'));
    expect(appendix).toContain('style="white-space:pre-wrap">Wet day</td>');
    expect(appendix).toContain('<td>&mdash;</td><td>&mdash;</td><td style="white-space:pre-wrap">&mdash;</td>');
  });
  it('keeps the widths at 100% and the empty message across all eight columns',()=>{
    const colgroup=html.slice(html.indexOf('APPENDIX B')).match(/<colgroup>.*?<\/colgroup>/)![0];
    expect([...colgroup.matchAll(/width:(\d+)%/g)].reduce((sum,match)=>sum+Number(match[1]),0)).toBe(100);
    expect(buildProjectCompletionHtml(project as never,[],[],[],company as never,null,[])).toContain('<td colspan="8" class="empty">No active waste dumps</td>');
  });
});

describe('what is read from the database',()=>{
  it('reads only the Active dumps of the project and day, in time order, with their notes',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    const now='2026-10-10T08:00:00.000Z';
    db.raw.exec(`INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('other','customer','Other Road','Aley','active','2026-08-01','${now}','${now}',0);`);
    const insert=(id:string,project:string,workDate:string,dumped:string,status:string,notes:string|null)=>db.raw.prepare(`INSERT INTO waste_dumps (id,project_id,work_date,dumped_at,material_type,dump_location,truck_plate,driver_name,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,project,workDate,dumped,'Soil','Pit','112233','R. Haddad',notes,status,now,now);
    insert('late','road','2026-10-10','2026-10-10T14:00:00','Active','  Second trip  ');insert('early','road','2026-10-10','2026-10-10T07:00:00','Active',null);
    insert('gone','road','2026-10-10','2026-10-10T09:00:00','Cancelled','Duplicate');insert('elsewhere','other','2026-10-10','2026-10-10T08:00:00','Active',null);insert('yesterday','road','2026-10-09','2026-10-09T08:00:00','Active',null);
    const repository=new SqliteProjectReportRepository(db as never);
    const dumps=await repository.listLinkedWasteDumps('road','2026-10-10');
    expect(dumps.map(value=>[value.id,value.notes])).toEqual([['early',null],['late','Second trip']]);
    expect((await repository.listProjectWasteDumps('road')).map(value=>[value.id,value.notes])).toEqual([['yesterday',null],['early',null],['late','Second trip']]);
  });
  it('adds the note to the Excel waste sheet without changing the other columns',()=>{
    const sheets=dailyReportWorkbookSheets(report as never,project as never,[],[],day,[],company as never);
    const rows=sheets.find(sheet=>sheet.name==='Waste Dumps')!.rows;
    expect(rows[1]).toMatchObject({'Record ID':'d1',Material:SOIL,Location:PIT,Driver:'Walid Khoury','Truck Plate':'B 884211',Notes:'First load of the day'});
  });
});
