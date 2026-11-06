import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteBitumenRepository} from '../src/data/repositories/SqliteBitumenRepository';
import type {BitumenDeliveryDraft} from '../src/domain/bitumen';
import {buildBitumenBatchReport} from '../src/domain/bitumenBatchReport';
import {loadsText,mixMadeForLines,type BitumenUseRow} from '../src/domain/bitumenUse';
import {buildBitumenBatchHtml} from '../src/services/bitumenBatchTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-527. The total of the asphalt mix behind a bitumen batch: on the Bitumen Batch Report (the Mix column total and the
 * "from N asphalt loads" figure) and on the batch page. The mix is its own figure in tons; it is never added to kilograms,
 * and a load that is not counted (cancelled, reversed) is in neither total.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const COMPANY={companyName:'Fakih & Sons',logo:null,contactLine:'Nabatieh · +961 70 000 000'};

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('medco','Medco',1,'${SEED_TIME}','${SEED_TIME}');`);
  const repository=new SqliteBitumenRepository(db as never);
  vi.setSystemTime(new Date('2026-10-19T12:30:00'));
  const batch=await repository.recordDelivery({recordDate:'2026-10-19',supplierId:'medco',invoiceNumber:'D10026X195',ticketNumber:'42481',gradeId:'bitumen_grade_60_70',kg:'26400',priceBasis:'per_ton',price:'610',vat:{mode:'none',ratePercent:''},notes:''} as BitumenDeliveryDraft);
  const row=(id:string,loadId:string,kind:'use'|'reversal',mixKg:number,kg:number):BitumenUseRow=>({id,createdAt:'2026-10-20T10:00:00',loadId,batchId:batch.id,kind,kg,mixKg,ruleAggregateKg:1000,ruleBitumenKg:40,loadNumber:`ASP-${loadId}`,loadConfirmedAt:'2026-10-20T09:00:00',itemName:'Asphalt',note:null});
  return {batch,row};
}
const html=(report:ReturnType<typeof buildBitumenBatchReport>)=>buildBitumenBatchHtml(report,COMPANY);

describe('the mix total behind a batch (pure)',()=>{
  it('adds the mix of the counted loads, in kg, without float noise, and counts them',()=>{
    expect(mixMadeForLines([])).toEqual({mixKg:0,loads:0});
    expect(mixMadeForLines([{mixKg:100.1},{mixKg:200.2}])).toEqual({mixKg:300.3,loads:2});
    expect(mixMadeForLines([{mixKg:123000},{mixKg:49745},{mixKg:31200}])).toEqual({mixKg:203945,loads:3});
  });
  it('says load and loads',()=>{
    expect(loadsText(1)).toBe('1 load');
    expect(loadsText(0)).toBe('0 loads');
    expect(loadsText(13)).toBe('13 loads');
  });
});

describe('the Bitumen Batch Report',()=>{
  it('totals the mix in tons beside the bitumen in kg, and says what the used figure came from',async()=>{
    const {batch,row}=await setup();
    const report=buildBitumenBatchReport(batch,{includePrices:false,exportedAt:'2026-10-25T17:48:00',useRows:[row('1','049','use',123000,4920),row('2','048','use',49745,1989.8),row('3','047','use',31200,1248)]});
    expect(report.use).toMatchObject({mixTotal:'203.945 t',loadCount:3,total:'8,157.8 kg'});
    expect(report.use!.rows.map(value=>value.mix)).toEqual(['123 t','49.745 t','31.2 t']);
    expect(report.figures[1]!.tons).toBe('from 3 asphalt loads · 203.945 t of mix');
  });
  it('prints the mix total in the Mix column of the closing row, under the same column',async()=>{
    const {batch,row}=await setup();
    const report=buildBitumenBatchReport(batch,{includePrices:false,useRows:[row('1','049','use',123000,4920),row('2','048','use',49745,1989.8),row('3','047','use',31200,1248)]});
    const page=html(report);
    expect(page).toContain('<tr class="tot"><td colspan="2">Estimated use · 3 loads · 1 day</td><td class="num">203.945 t</td><td></td><td class="num">8,157.8 kg</td></tr>');
    expect(page).toContain('from 3 asphalt loads · 203.945 t of mix');
  });
  it('uses the singular for one load',async()=>{
    const {batch,row}=await setup();
    const report=buildBitumenBatchReport(batch,{includePrices:false,useRows:[row('1','049','use',123000,4920)]});
    expect(report.use).toMatchObject({mixTotal:'123 t',loadCount:1});
    expect(report.figures[1]!.tons).toBe('from 1 asphalt load · 123 t of mix');
    expect(html(report)).toContain('Estimated use · 1 load · 1 day</td>');
  });
  it('leaves a load that was cancelled (counted, then reversed) out of both totals',async()=>{
    const {batch,row}=await setup();
    const report=buildBitumenBatchReport(batch,{includePrices:false,useRows:[row('1','049','use',123000,4920),row('2','050','use',40000,1600),row('3','050','reversal',40000,-1600)]});
    expect(report.use).toMatchObject({mixTotal:'123 t',loadCount:1,total:'4,920 kg'});
    expect(report.use!.rows.map(value=>value.load)).toEqual(['ASP-049']);
  });
  it('shows no mix total when no load is counted, and the page is otherwise as before',async()=>{
    const {batch}=await setup();
    const report=buildBitumenBatchReport(batch,{includePrices:false});
    expect(report.use).toBeNull();
    expect(report.figures[1]!.tons).not.toContain('of mix');
    expect(html(report)).not.toContain('of mix');
    expect(html(report)).not.toContain('USE FROM ASPHALT LOADS');
  });
  it('is the same with prices on: the mix total is on the page either way',async()=>{
    const {batch,row}=await setup();
    const report=buildBitumenBatchReport(batch,{includePrices:true,useRows:[row('1','049','use',123000,4920)]});
    expect(html(report)).toContain('<td class="num">123 t</td><td></td><td class="num">4,920 kg</td></tr>');
  });
});

describe('the Bitumen Batch Report by day (DEC-542)',()=>{
  const at=(row:BitumenUseRow,confirmedAt:string):BitumenUseRow=>({...row,loadConfirmedAt:confirmedAt});
  async function rowsAcrossDays(){
    const {batch,row}=await setup();
    const rows=[
      at(row('1','049','use',45000,1800),'2026-10-20T15:40:00'),at(row('2','048','use',38250,1530),'2026-10-20T11:05:00'),
      at(row('3','047','use',40000,1600),'2026-10-19T09:30:00'),
      at(row('4','046','use',36000,1440),'2026-10-17T10:15:00'),
    ];
    return {batch,rows};
  }
  it('groups the loads by the day they were confirmed, newest day first, each day with its mix and bitumen totals',async()=>{
    const {batch,rows}=await rowsAcrossDays();
    const report=buildBitumenBatchReport(batch,{includePrices:false,useRows:rows});
    expect(report.use!.days.map(day=>[day.date,day.count,day.mix,day.kg])).toEqual([
      ['Tue 20 Oct 2026',2,'83.25 t','3,330 kg'],['Mon 19 Oct 2026',1,'40 t','1,600 kg'],['Sat 17 Oct 2026',1,'36 t','1,440 kg'],
    ]);
  });
  it('lists the loads of a day newest first, with their time, and keeps the flat rows',async()=>{
    const {batch,rows}=await rowsAcrossDays();
    const use=buildBitumenBatchReport(batch,{includePrices:false,useRows:rows}).use!;
    expect(use.days[0]!.rows.map(value=>[value.time,value.load])).toEqual([['15:40','ASP-049'],['11:05','ASP-048']]);
    expect(use.rows).toHaveLength(4);
  });
  it('makes the day totals add up to the closing row',async()=>{
    const {batch,rows}=await rowsAcrossDays();
    const use=buildBitumenBatchReport(batch,{includePrices:false,useRows:rows}).use!;
    expect(use).toMatchObject({loadCount:4,dayCount:3,mixTotal:'159.25 t',total:'6,370 kg'});
    expect(3330+1600+1440).toBe(6370);
  });
  it('prints a tinted day row with the day totals above its loads, and the closing row with the number of days',async()=>{
    const {batch,rows}=await rowsAcrossDays();
    const page=html(buildBitumenBatchReport(batch,{includePrices:false,useRows:rows}));
    expect(page).toContain('<tr class="day"><td colspan="2">Tue 20 Oct 2026 <span class="sep">· 2 loads · day total</span></td><td class="num">83.25 t</td><td></td><td class="num">3,330 kg</td></tr>');
    expect(page).toContain('<span class="sep">· 1 load · day total</span>');
    expect(page.indexOf('Tue 20 Oct 2026 <span')).toBeLessThan(page.indexOf('ASP-049'));
    expect(page.indexOf('ASP-048')).toBeLessThan(page.indexOf('Mon 19 Oct 2026 <span'));
    expect(page).toContain('<th>Time</th>');
    expect(page).toContain('Estimated use · 4 loads · 3 days</td><td class="num">159.25 t</td><td></td><td class="num">6,370 kg</td></tr>');
  });
  it('shows no day groups when no load is counted, and leaves a day with only reversed loads out',async()=>{
    const {batch,row}=await setup();
    const reversed=[at(row('1','050','use',40000,1600),'2026-10-18T10:00:00'),at(row('2','050','reversal',40000,-1600),'2026-10-18T10:00:00'),at(row('3','051','use',30000,1200),'2026-10-19T10:00:00')];
    const use=buildBitumenBatchReport(batch,{includePrices:false,useRows:reversed}).use!;
    expect(use.days.map(day=>day.date)).toEqual(['Mon 19 Oct 2026']);
    expect(buildBitumenBatchReport(batch,{includePrices:false}).use).toBeNull();
  });
});

describe('the batch page (static checks)',()=>{
  const panels=readFileSync('src/ui/components/BitumenUsePanels.tsx','utf8');
  const screen=readFileSync('src/ui/screens/BitumenScreen.tsx','utf8');
  it('shows the loads, the asphalt mix in tons and the bitumen in kg in the total strip at the top of the card (DEC-542 replaces the bottom lines)',()=>{
    expect(panels).toContain('ALL DAYS · ESTIMATE');
    expect(panels).toContain('{totals.loads}');
    expect(panels).toContain('{tonText(totals.mixKg)}');
    expect(panels).toContain('{kgText(totals.bitumenKg)}');
    expect(panels).toContain('useTotals(lines)');
  });
  it('says the loads and the mix under the Est. used figure, only when use is estimated from loads',()=>{
    expect(screen).toContain("note={estimated&&mix.loads>0?`${loadsText(mix.loads)} · ${formatTons(mix.mixKg)} of mix`:undefined}");
    expect(screen).toContain('mixMadeForLines(useLinesForBatch(overview.useRows??[],batch.id))');
  });
});
