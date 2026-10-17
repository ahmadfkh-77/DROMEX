import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteStockRepository} from '../src/data/repositories/SqliteStockRepository';
import {buildStockReport,stockRangeFor,stockRangeLabel,type StockReportFilter} from '../src/domain/stockReport';
import type {StockBatchDraft,StockOverview} from '../src/domain/stock';
import {buildStockReportHtml} from '../src/services/stockReportTemplate';
import {stockWorkbookSheets} from '../src/services/stockWorkbook';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * The Stock Report (PDF) and the Stock workbook (Excel): one item or all Stock, for a period, with or without prices. Received and Used are
 * for the period, On hand is now, every unit stays on its own, and a cancelled batch or use is listed and never counted.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-16T09:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const read=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;
const company={companyName:'DROMEX <Plant> & Co',logo:null,contactLine:'Saida · 03 123 456'};

async function build(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT OR REPLACE INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1100,'${SEED_TIME}');
    INSERT INTO company_settings (id,company_name,address,phone,updated_at) VALUES ('company','Plant Co','Saida','03 111 222','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('salam','Al Salam',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('mat','Materials','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('cement','mat','Cement','unit_kg',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('sand','mat','Sand','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const repository=new SqliteStockRepository(db as never);
  const batch=(extra:Partial<StockBatchDraft>)=>repository.recordBatch({itemId:'cement',unitId:'',recordDate:'2026-10-03',supplierId:'salam',invoiceNumber:'INV-1',quantity:'300',priceBasis:'per_unit',price:'',vat:{mode:'none',ratePercent:''},notes:'',...extra});
  const first=await batch({});
  const second=await batch({recordDate:'2026-10-12',quantity:'350',invoiceNumber:'INV-2',price:'6.2',vat:{mode:'universal',ratePercent:''}});
  const cancelled=await batch({recordDate:'2026-10-13',quantity:'50',invoiceNumber:'INV-X'});
  await repository.cancelBatch(cancelled.id,'Entered twice');
  await batch({itemId:'sand',recordDate:'2026-10-05',quantity:'40',price:'12',invoiceNumber:'S-1'});
  const useA=await repository.recordUse({itemId:'cement',quantity:'310',usedOn:'2026-10-14',note:'Wall panels'});
  const useB=await repository.recordUse({itemId:'cement',quantity:'8',usedOn:'2026-10-15',note:'Typed twice'});
  await repository.cancelUse(useB.groupId,'Entered twice');
  await repository.recordUse({itemId:'sand',quantity:'5',usedOn:'2026-10-15',note:''});
  return {db,repository,first,second,useA,overview:await repository.getOverview()};
}
const filter=(extra:Partial<StockReportFilter>={}):StockReportFilter=>({includePrices:false,...extra});

describe('the report model',()=>{
  it('reports one item: period totals, on hand now, batches that arrived in the period and uses dated in it',async()=>{
    const {overview}=await build();
    const report=buildStockReport(overview,filter({itemId:'cement',fromDate:'2026-10-10',toDate:'2026-10-16'}),'2026-10-16T09:00:00.000Z');
    expect(report).toMatchObject({title:'Stock Report',scopeLabel:'Cement',isSingle:true,empty:false,pricesIncluded:false});
    const item=report.items[0]!;
    expect(item).toMatchObject({name:'Cement',unit:'kg',received:'350 kg',used:'310 kg',onHand:'340 kg',openBatches:1});
    expect(item.batches.map(row=>row.batchNumber)).toEqual(['CEM-0002','CEM-0003']);
    expect(item.uses.map(row=>[row.quantity,row.status]).sort()).toEqual([['310 kg','Counted'],['8 kg','Cancelled: Entered twice']]);
    expect(item.cancelledNote).toBe('1 cancelled batch and 1 cancelled use listed, not counted.');
    expect(report.fileName).toBe('DROMEX-Stock-Report-Cement-2026-10-10-to-2026-10-16.pdf');
  });
  it('counts a cancelled batch and a cancelled use as nothing, and shows a cancelled batch as cancelled',async()=>{
    const {overview}=await build();
    const all=buildStockReport(overview,filter({itemId:'cement'}));
    expect(all.items[0]).toMatchObject({received:'650 kg',used:'310 kg',onHand:'340 kg'});
    const cancelled=all.items[0]!.batches.find(row=>row.batchNumber==='CEM-0003')!;
    expect(cancelled).toMatchObject({status:'Cancelled',used:'—',remaining:'—',quantity:'50 kg'});
  });
  it('summarises all Stock with each unit on its own line, never added together',async()=>{
    const {overview}=await build();
    const report=buildStockReport(overview,filter());
    expect(report).toMatchObject({title:'Stock Summary',scopeLabel:'All Stock',isSingle:false});
    expect(report.summary).toEqual([
      {item:'Cement',unit:'kg',received:'650 kg',used:'310 kg',onHand:'340 kg',openBatches:1},
      {item:'Sand',unit:'t',received:'40 t',used:'5 t',onHand:'35 t',openBatches:1}]);
    expect(report.fileName).toBe('DROMEX-Stock-Summary-start-to-2026-10-16.pdf');
  });
  it('includes prices only when asked, with VAT only where a batch has it and Unpriced for no price',async()=>{
    const {overview}=await build();
    const without=buildStockReport(overview,filter({itemId:'cement'}));
    expect(without.items[0]!.batches[0]).not.toHaveProperty('price');
    const withPrices=buildStockReport(overview,filter({itemId:'cement',includePrices:true}));
    const rows=withPrices.items[0]!.batches;
    expect(rows.find(row=>row.batchNumber==='CEM-0001')).toMatchObject({price:'Unpriced',amount:'Unpriced'});
    expect(rows.find(row=>row.batchNumber==='CEM-0002')).toMatchObject({price:'$6.20 / kg',amount:'$2,408.70 incl. VAT 11%'});
    expect(withPrices.pricesIncluded).toBe(true);
  });
  it('has nothing to export when Stock is empty, but a single item always exports',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    const empty=await new SqliteStockRepository(db as never).getOverview();
    expect(buildStockReport(empty,filter()).empty).toBe(true);
    const {overview}=await build();
    const quiet=buildStockReport(overview,filter({itemId:'sand',fromDate:'2026-01-01',toDate:'2026-01-31'}));
    expect(quiet.empty).toBe(false);expect(quiet.items[0]).toMatchObject({received:'0 t',used:'0 t',onHand:'35 t'});expect(quiet.items[0]!.batches).toEqual([]);
  });
});

describe('the period',()=>{
  it('is all dates, this week (Monday to Sunday), this month, or the calendar dates chosen, swapped if reversed',()=>{
    expect(stockRangeFor('all','2026-10-16')).toEqual({});
    expect(stockRangeFor('week','2026-10-16')).toEqual({fromDate:'2026-10-12',toDate:'2026-10-18'});
    expect(stockRangeFor('month','2026-10-16')).toEqual({fromDate:'2026-10-01',toDate:'2026-10-31'});
    expect(stockRangeFor('custom','2026-10-16',{fromDate:'2026-10-10',toDate:'2026-10-16'})).toEqual({fromDate:'2026-10-10',toDate:'2026-10-16'});
    expect(stockRangeFor('custom','2026-10-16',{fromDate:'2026-10-16',toDate:'2026-10-10'})).toEqual({fromDate:'2026-10-10',toDate:'2026-10-16'});
    expect(stockRangeFor('custom','2026-10-16',{fromDate:'2026-10-10'})).toEqual({fromDate:'2026-10-10',toDate:undefined});
  });
  it('is labelled in words, and a single day is one date',()=>{
    expect(stockRangeLabel({})).toBe('All dates');
    expect(stockRangeLabel({fromDate:'2026-10-10',toDate:'2026-10-16'})).toContain('–');
    expect(stockRangeLabel({fromDate:'2026-10-16',toDate:'2026-10-16'})).not.toContain('–');
    expect(stockRangeLabel({toDate:'2026-10-16'})).toMatch(/^Until /);expect(stockRangeLabel({fromDate:'2026-10-10'})).toMatch(/^From /);
  });
});

describe('the PDF',()=>{
  it('lays out one item without a summary table, with totals, batches and uses',async()=>{
    const {overview}=await build();
    const html=buildStockReportHtml(buildStockReport(overview,filter({itemId:'cement'}),'2026-10-16T09:00:00.000Z'),company);
    expect(html).toContain('<h1>Stock Report</h1>');expect(html).toContain('On hand now');expect(html).toContain('BATCHES');expect(html).toContain('USES');expect(html).toContain('CEM-0002');expect(html).toContain('Wall panels');
    expect(html).not.toContain('STOCK ON HAND');expect(html).not.toContain('<th class="num">Price</th>');
    expect(html).toContain('Cancelled: Entered twice');expect(html).toContain('A cancelled batch or use is listed and never counted.');
  });
  it('opens a report for all Stock with the summary table and puts each item on its own page',async()=>{
    const {overview}=await build();
    const html=buildStockReportHtml(buildStockReport(overview,filter()),company);
    expect(html).toContain('<h1>Stock Summary</h1>');expect(html).toContain('STOCK ON HAND');expect(html).toContain('Each unit is shown on its own line');
    expect(html.match(/<section class="pb">/g)?.length).toBe(2);
  });
  it('adds price and amount columns only with prices, and escapes names',async()=>{
    const {overview}=await build();
    const html=buildStockReportHtml(buildStockReport(overview,filter({itemId:'cement',includePrices:true})),company);
    expect(html).toContain('<th class="num">Price</th>');expect(html).toContain('<th class="num">Amount</th>');expect(html).toContain('$2,408.70 incl. VAT 11%');expect(html).toContain('with prices');
    expect(html).toContain('DROMEX &lt;Plant&gt; &amp; Co');expect(html).not.toContain('<Plant>');
  });
});

describe('the Excel workbook',()=>{
  const sheets=(overview:StockOverview,extra:Partial<StockReportFilter>={})=>stockWorkbookSheets(overview,filter(extra),{name:'Plant Co'},'2026-10-16T09:00:00.000Z');
  it('has a sheet of totals, batches and uses with stable ids and numeric quantities',async()=>{
    const {overview,first}=await build();
    const result=sheets(overview);
    expect(result.map(sheet=>sheet.name)).toEqual(['Report Info','Stock Summary','Batches','Uses','Data Dictionary']);
    const summary=result.find(sheet=>sheet.name==='Stock Summary')!.rows;
    expect(summary).toEqual([
      {'Item ID':'cement',Item:'Cement',Unit:'kg','Received (Period)':650,'Used (Period)':310,'On Hand Now':340,'Open Batches':1},
      {'Item ID':'sand',Item:'Sand',Unit:'t','Received (Period)':40,'Used (Period)':5,'On Hand Now':35,'Open Batches':1}]);
    const batches=result.find(sheet=>sheet.name==='Batches')!.rows;
    expect(batches).toHaveLength(4);
    expect(batches.find(row=>row['Batch ID']===first.id)).toMatchObject({'Batch Number':'CEM-0001','Item ID':'cement',Quantity:300,'Used To Date':300,Remaining:0,'Date Received':'2026-10-03',Supplier:'Al Salam','Supplier ID':'salam'});
    expect(batches.find(row=>row['Batch Number']==='CEM-0003')).toMatchObject({Status:'Cancelled','Used To Date':null,Remaining:null,'Cancellation Reason':'Entered twice'});
    const uses=result.find(sheet=>sheet.name==='Uses')!.rows;
    expect(uses).toHaveLength(3);
    expect(uses.find(row=>row.Note==='Wall panels')).toMatchObject({Date:'2026-10-14','Item ID':'cement',Quantity:310,Source:'By hand',Status:'Counted',Batches:expect.stringContaining('CEM-0001')});
    expect(uses.find(row=>row.Note==='Typed twice')).toMatchObject({Status:'Cancelled','Cancellation Reason':'Entered twice'});
  });
  it('adds price and VAT columns only with prices, and keeps Unpriced empty rather than zero',async()=>{
    const {overview}=await build();
    expect(Object.keys(sheets(overview).find(sheet=>sheet.name==='Batches')!.rows[0]!)).not.toContain('Price USD');
    const rows=sheets(overview,{includePrices:true}).find(sheet=>sheet.name==='Batches')!.rows;
    expect(rows.find(row=>row['Batch Number']==='CEM-0001')).toMatchObject({'Price USD':null,'VAT %':null,'Total USD':null});
    expect(rows.find(row=>row['Batch Number']==='CEM-0002')).toMatchObject({'Price Basis':'per_unit','Price USD':6.2,'VAT %':11,'Subtotal USD':2170,'Total USD':2408.7});
  });
  it('follows the item and the period, and explains its columns',async()=>{
    const {overview}=await build();
    const result=sheets(overview,{itemId:'cement',fromDate:'2026-10-10',toDate:'2026-10-16'});
    expect(result.find(sheet=>sheet.name==='Stock Summary')!.rows).toHaveLength(1);
    expect(result.find(sheet=>sheet.name==='Batches')!.rows.map(row=>row['Batch Number'])).toEqual(['CEM-0002','CEM-0003']);
    expect(result.find(sheet=>sheet.name==='Report Info')!.rows).toEqual(expect.arrayContaining([{Metric:'Scope',Value:'Cement'},{Metric:'Prices',Value:'Excluded'},{Metric:'Company',Value:'Plant Co'}]));
    const dictionary=result.find(sheet=>sheet.name==='Data Dictionary')!.rows;
    expect(dictionary.length).toBeGreaterThanOrEqual(6);expect(JSON.stringify(dictionary)).toContain('never added together');
  });
});

describe('the repository and the screens',()=>{
  it('reads the company for a report from Company Settings',async()=>{
    const {repository}=await build();
    expect(await repository.getCompanyIdentity()).toEqual({name:'Plant Co',logoUri:null,contactLine:'Saida · 03 111 222'});
  });
  it('offers the export on the Stock list and on each item, with calendar dates and both formats',()=>{
    const panel=read('src/ui/components/StockExportPanel.tsx'),screen=read('src/ui/screens/StockScreen.tsx'),exporter=read('src/services/documentExport.ts');
    expect(panel).toContain('<DatePickerField label="From"');expect(panel).toContain('<DatePickerField label="To"');expect(panel).toContain('label="Export PDF"');expect(panel).toContain('label="Export Excel"');
    expect(panel).toContain('useExportHeader(null)');expect(panel).toContain("{id:'without',label:'Without prices'},{id:'with',label:'With prices'}");
    expect(screen).toContain('Stock report (PDF or Excel)');expect(screen).toContain('<StockExportPanel repository={repository} overview={overview} itemId={item.itemId}/>');
    expect(exporter).toContain('export async function exportAndShareStockReport(');
  });
});
