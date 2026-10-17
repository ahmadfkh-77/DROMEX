import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteBitumenRepository} from '../src/data/repositories/SqliteBitumenRepository';
import type {BitumenDeliveryDraft} from '../src/domain/bitumen';
import {buildBitumenBatchReport} from '../src/domain/bitumenBatchReport';
import {buildBitumenBatchHtml,bitumenTableWidths} from '../src/services/bitumenBatchTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/** The Bitumen Batch Report: one batch on one A4 page, without or with prices, and a cancelled batch says why. */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const COMPANY={companyName:'Fakih & Sons',logo:null,contactLine:'Nabatieh · +961 70 000 000'};

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('khayat','Khayat <Al> Sabouri',1,'${SEED_TIME}','${SEED_TIME}');`);
  const repository=new SqliteBitumenRepository(db as never);
  const draft=(extra:Partial<BitumenDeliveryDraft>={}):BitumenDeliveryDraft=>({recordDate:'2026-10-13',supplierId:'khayat',invoiceNumber:'55912',ticketNumber:'T-8841',gradeId:'bitumen_grade_60_70',kg:'8000',priceBasis:'per_ton',price:'610',vat:{mode:'none',ratePercent:''},notes:'',...extra});
  const deliver=(extra:Partial<BitumenDeliveryDraft>={})=>{vi.setSystemTime(new Date('2026-10-13T09:40:00'));return repository.recordDelivery(draft(extra));};
  return {repository,deliver,draft};
}
const html=(report:ReturnType<typeof buildBitumenBatchReport>)=>buildBitumenBatchHtml(report,COMPANY);

describe('the report content',()=>{
  it('lists the batch facts, the four figures in kg with tons, and the delivery detail',async()=>{
    const {deliver}=await setup();
    const report=buildBitumenBatchReport(await deliver(),{includePrices:false,exportedAt:'2026-10-13T11:20:00'});
    expect(report.summary.map(item=>item.value)).toEqual(['BIT-2026-00001','Khayat <Al> Sabouri','60/70','Tue 13 Oct 2026','Open · In use']);
    expect(report.figures.map(figure=>[figure.label,figure.kg,figure.tons])).toEqual([['Delivered','8,000 kg','8 t'],['Used','0 kg','0 t'],['Adjustments','0 kg','0 t'],['Remaining','8,000 kg','8 t']]);
    expect(report.detail.headers).toEqual(['Supplier','Invoice no.','Weighbridge ticket','Recorded']);
    expect(report.history).toEqual([{date:'Tue 13 Oct 2026',event:'Delivery received',kg:'+8,000'}]);
    expect(report.price).toBeNull();
    expect(report.fileName).toBe('Bitumen-Batch-Report-BIT-2026-00001.pdf');
  });
  it('leaves out the weighbridge ticket column when it was not filled in',async()=>{
    const {deliver}=await setup();
    const report=buildBitumenBatchReport(await deliver({ticketNumber:''}),{includePrices:false});
    expect(report.detail.headers).toEqual(['Supplier','Invoice no.','Recorded']);
    expect(html(report)).not.toContain('Weighbridge ticket');
  });
  it('adds the price block only when prices are included, and says Unpriced when there is none',async()=>{
    const {deliver}=await setup();
    const priced=buildBitumenBatchReport(await deliver(),{includePrices:true});
    expect(priced.price!.values).toEqual(['Per ton','$610.00 / t','$0.61','$610.00']);
    expect(priced.price!.lines.map(line=>[line.label,line.value])).toEqual([['Subtotal (8 t × $610.00)','$4,880.00'],['VAT','None applied'],['Total','$4,880.00']]);
    const unpriced=buildBitumenBatchReport(await deliver({price:''}),{includePrices:true});
    expect(unpriced.price!.values).toEqual(['Unpriced','Unpriced','Unpriced','Unpriced']);
    expect(unpriced.price!.lines).toEqual([{label:'Total',value:'Unpriced',strong:true}]);
    expect(html(buildBitumenBatchReport(await deliver(),{includePrices:false}))).not.toContain('>PRICE<');
  });
  it('shows a correction with its reason and a cancellation with its reason',async()=>{
    const {deliver,repository,draft}=await setup();
    const batch=await deliver();
    vi.setSystemTime(new Date('2026-10-13T10:00:00'));
    await repository.editBatch(batch.id,{...draft({kg:'7800'}),reason:'Ticket re-read'});
    const cancelled=await repository.cancelBatch(batch.id,'Entered twice by mistake');
    const report=buildBitumenBatchReport(cancelled,{includePrices:false});
    expect(report.cancelled).toBe(true);
    expect(report.history.map(row=>row.event)).toEqual(['Delivery received',expect.stringContaining('Quantity 8,000 kg → 7,800 kg · reason: Ticket re-read'),'Batch cancelled']);
    expect(report.history.at(-1)!.kg).toBe('−7,800');
    expect(report.cancellation).toMatchObject({reason:'Entered twice by mistake'});
    expect(report.figures.at(-1)).toMatchObject({kg:'0 kg',tons:'cancelled',strong:false});
    const page=html(report);
    expect(page).toContain('CANCELLED');expect(page).toContain('WHY IT WAS CANCELLED');expect(page).toContain('Entered twice by mistake');
  });
});

describe('the printed page',()=>{
  it('is A4 with the running title, Page X of Y, the company on the left and the title on the right',async()=>{
    const {deliver}=await setup();
    const page=html(buildBitumenBatchReport(await deliver(),{includePrices:false}));
    expect(page).toContain('size:A4');expect(page).toContain('counter(page)');expect(page).toContain('counter(pages)');
    expect(page).toContain('Fakih & Sons · Bitumen Batch Report · BIT-2026-00001');
    const body=page.indexOf('<body>');
    const order=['Fakih &amp; Sons','Nabatieh · +961 70 000 000','Bitumen Batch Report','BATCH FIGURES','DELIVERY DETAIL','HISTORY'].map(text=>page.indexOf(text,body));
    expect(order.every(index=>index>=0)).toBe(true);
    expect([...order].sort((a,b)=>a-b)).toEqual(order);
  });
  it('gives every table widths that add up to exactly 100',async()=>{
    const {deliver}=await setup();
    for(const includePrices of [false,true]){
      const page=html(buildBitumenBatchReport(await deliver(),{includePrices}));
      const groups=[...page.matchAll(/<colgroup>(.*?)<\/colgroup>/g)];
      expect(groups.length).toBeGreaterThanOrEqual(includePrices?4:2);
      for(const group of groups)expect([...group[1]!.matchAll(/width:(\d+)%/g)].reduce((sum,width)=>sum+Number(width[1]),0)).toBe(100);
    }
    expect(bitumenTableWidths(['A','B'],['x','y']).reduce((a,b)=>a+b,0)).toBe(100);
  });
  it('escapes names, keeps kg and tons apart, and says it is not an invoice',async()=>{
    const {deliver}=await setup();
    const page=html(buildBitumenBatchReport(await deliver(),{includePrices:false}));
    expect(page).toContain('Khayat &lt;Al&gt; Sabouri');
    expect(page).not.toContain('<Al>');
    expect(page).toContain('never added to kilograms');expect(page).toContain('not an invoice or bill');
    expect(page).toContain('Prices are not included in this report.');
  });
});
