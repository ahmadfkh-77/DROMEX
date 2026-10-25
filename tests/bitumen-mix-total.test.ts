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
    expect(page).toContain('<tr class="tot"><td colspan="2">Estimated use · 3 loads</td><td class="num">203.945 t</td><td></td><td class="num">8,157.8 kg</td></tr>');
    expect(page).toContain('from 3 asphalt loads · 203.945 t of mix');
  });
  it('uses the singular for one load',async()=>{
    const {batch,row}=await setup();
    const report=buildBitumenBatchReport(batch,{includePrices:false,useRows:[row('1','049','use',123000,4920)]});
    expect(report.use).toMatchObject({mixTotal:'123 t',loadCount:1});
    expect(report.figures[1]!.tons).toBe('from 1 asphalt load · 123 t of mix');
    expect(html(report)).toContain('Estimated use · 1 load</td>');
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

describe('the batch page (static checks)',()=>{
  const panels=readFileSync('src/ui/components/BitumenUsePanels.tsx','utf8');
  const screen=readFileSync('src/ui/screens/BitumenScreen.tsx','utf8');
  it('adds an Asphalt mix made line under Estimated use, in tons, with the number of loads',()=>{
    expect(panels).toContain('Asphalt mix made · {loadsText(mix.loads)}');
    expect(panels).toContain('{formatTons(mix.mixKg)}');
    expect(panels.indexOf('Estimated use</Text>')).toBeLessThan(panels.indexOf('Asphalt mix made'));
  });
  it('says the loads and the mix under the Est. used figure, only when use is estimated from loads',()=>{
    expect(screen).toContain("note={estimated&&mix.loads>0?`${loadsText(mix.loads)} · ${formatTons(mix.mixKg)} of mix`:undefined}");
    expect(screen).toContain('mixMadeForLines(useLinesForBatch(overview.useRows??[],batch.id))');
  });
});
