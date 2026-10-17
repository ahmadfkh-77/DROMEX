import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteStockRepository} from '../src/data/repositories/SqliteStockRepository';
import {activeClosure,closureMoment,closureText,supplyOpenOn,validateClosureReason,type BatchClosure} from '../src/domain/batchClosure';
import {buildBitumenOverview} from '../src/domain/bitumen';
import {buildBitumenBatchReport} from '../src/domain/bitumenBatchReport';
import {stockWorkbookSheets} from '../src/services/stockWorkbook';
import {buildBitumenBatchHtml} from '../src/services/bitumenBatchTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Close a batch by hand (migration 64): the closure rules, the table, the Close and Reopen buttons on Bitumen, Diesel and Stock, and where a
 * closure shows in the Bitumen PDF and the Stock workbook. The behaviour against real databases is tested with each module's own tests.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-17T12:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const read=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;

const closure=(extra:Partial<BatchClosure>={}):BatchClosure=>({id:'c1',batchId:'b1',closedOn:'2026-10-16',closedAt:'2026-10-16T20:59:59.999Z',leftover:120,reason:'Tank changed',createdAt:'2026-10-17T09:00:00.000Z',reopenedAt:null,reopenReason:null,...extra});

describe('the closing rules',()=>{
  it('takes effect now when closing today, and at the end of the day for a past day',()=>{
    const now=new Date('2026-10-17T12:00:00');
    expect(closureMoment('2026-10-17',now)).toBe(now.toISOString());
    expect(closureMoment('2026-10-15',now)).toBe(new Date(2026,9,15,23,59,59,999).toISOString());
    expect(()=>closureMoment('2026-10-18',now)).toThrow('future');
    expect(()=>closureMoment('17/10/2026',now)).toThrow('day');
    expect(()=>closureMoment('2026-02-31',now)).toThrow('valid');
  });
  it('needs a reason, written for closing or for reopening',()=>{
    expect(validateClosureReason('  Tank   changed ')).toBe('Tank changed');
    expect(()=>validateClosureReason(' ')).toThrow('closing this batch');
    expect(()=>validateClosureReason('','reopening')).toThrow('reopening this batch');
  });
  it('keeps only a closure that was not reopened, and says what was left over',()=>{
    const open=closure({id:'c2',reopenedAt:'2026-10-17T10:00:00.000Z',reopenReason:'Oops'});
    expect(activeClosure([open],'b1')).toBeNull();
    expect(activeClosure([open,closure({id:'c3'})],'b1')?.id).toBe('c3');
    expect(activeClosure([closure()],'other')).toBeNull();
    expect(closureText(closure(),value=>`${value} kg`)).toBe('120 kg left over, closed by hand · 2026-10-16 · Tank changed');
    expect(closureText(closure({leftover:0}),value=>`${value} kg`)).toBe('Closed by hand with nothing left · 2026-10-16 · Tank changed');
  });
  it('lets a batch supply only the days up to the day it was closed',()=>{
    expect(supplyOpenOn(null,'2026-12-01')).toBe(true);
    expect(supplyOpenOn(closure(),'2026-10-16')).toBe(true);
    expect(supplyOpenOn(closure(),'2026-10-17')).toBe(false);
  });
});

describe('migration 64',()=>{
  it('adds one closures table that allows one live closure per batch and any number of reopened ones',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(64);
    expect((db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='batch_closures'").all() as {name:string}[]).length).toBe(1);
    const insert=db.raw.prepare("INSERT INTO batch_closures (id,batch_kind,batch_id,closed_on,closed_at,leftover,reason,created_at,reopened_at) VALUES (?,?,?,?,?,?,?,?,?)");
    insert.run('a','stock','b1','2026-10-16','2026-10-16T10:00:00.000Z',5,'x',SEED_TIME,SEED_TIME);
    insert.run('b','stock','b1','2026-10-16','2026-10-16T10:00:00.000Z',5,'x',SEED_TIME,null);
    expect(()=>insert.run('c','stock','b1','2026-10-16','2026-10-16T10:00:00.000Z',5,'x',SEED_TIME,null)).toThrow();
    expect(()=>insert.run('d','other','b2','2026-10-16','2026-10-16T10:00:00.000Z',5,'x',SEED_TIME,null)).toThrow();
    expect(()=>insert.run('e','stock','b3','2026-10-16','2026-10-16T10:00:00.000Z',-1,'x',SEED_TIME,null)).toThrow();
  });
});

describe('the screens',()=>{
  it('offer Close this batch and Reopen this batch on Bitumen, Stock and Diesel, with a reason and the calendar',()=>{
    const cards=read('src/ui/components/BatchClosureCards.tsx');
    expect(cards).toContain('Close ${batchLabel}?');expect(cards).toContain('label="Date closed *"');expect(cards).toContain('label="Reason *"');expect(cards).toContain('label="Close batch"');
    expect(cards).toContain('Reopen ${batchLabel}?');expect(cards).toContain('label="Reopen this batch"');
    for(const file of ['src/ui/screens/BitumenScreen.tsx','src/ui/screens/StockScreen.tsx','src/ui/components/fuel/DieselBatchPage.tsx']){
      const source=read(file);
      expect(source).toContain('<CloseBatchCard');expect(source).toContain('<ReopenBatchCard');expect(source).toContain('<ClosureCard');expect(source).toContain('label="Close this batch"');
    }
    expect(read('src/ui/components/fuel/DieselBatchesPanel.tsx')).toContain('label="Close this batch"');
    expect(read('src/ui/screens/BitumenScreen.tsx')).toContain('repository.closeBatch(batch.id,closedOn,reason)');
    expect(read('src/ui/screens/StockScreen.tsx')).toContain('repository.closeBatch(batch.id,closedOn,reason)');
    expect(read('src/ui/screens/FuelTrackingScreen.tsx')).toContain('repository.closeDieselBatch(value.id,closedOn,reason)');
  });
});

describe('where a closure shows',()=>{
  it('puts a Closed by hand section and history lines in the Bitumen batch PDF',()=>{
    const batch=(over:Partial<Parameters<typeof buildBitumenOverview>[0][number]>={})=>({id:'b1',batchNumber:'BIT-2026-00001',arrivedAt:'2026-10-03T08:00:00.000Z',supplierId:null,supplierName:'Supplier A',gradeId:null,gradeName:'60/70',invoiceNumber:null,ticketNumber:null,notes:null,deliveredKg:20000,usedKg:19880,adjustmentKg:0,priceBasis:null,priceUsd:null,vatRatePercent:null,subtotalUsd:null,totalUsd:null,pricePerTonUsd:null,priced:false,recordStatus:'Active' as const,cancellationReason:null,cancelledAt:null,correctionHistory:[],createdAt:'x',...over});
    const closed=buildBitumenOverview([batch()],null,[closure({closedOn:'2026-10-16'})]).batches[0]!;
    expect(closed.status).toBe('closed');
    const report=buildBitumenBatchReport(closed,{includePrices:false,exportedAt:'2026-10-17T12:00:00.000Z'});
    expect(report.closure).toEqual({closedOn:expect.stringContaining('16'),leftover:'120 kg',reason:'Tank changed'});
    expect(report.history.some(row=>row.event.includes('Closed by hand with 120 kg left · reason: Tank changed'))).toBe(true);
    const html=buildBitumenBatchHtml(report,{companyName:'DROMEX Test',logo:null,contactLine:null});
    expect(html).toContain('CLOSED BY HAND');expect(html).toContain('Left over');
    const normal=buildBitumenBatchReport(buildBitumenOverview([batch()],null,[]).batches[0]!,{includePrices:false});
    expect(normal.closure).toBeNull();expect(buildBitumenBatchHtml(normal,{companyName:'DROMEX Test',logo:null,contactLine:null})).not.toContain('CLOSED BY HAND');
  });
  it('adds the day, the leftover and the reason to the Stock workbook, empty for a batch that was not closed by hand',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    db.raw.exec(`
      INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX Test','${SEED_TIME}');
      INSERT INTO categories (id,name,created_at,updated_at) VALUES ('produced','Produced','${SEED_TIME}','${SEED_TIME}');
      INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('cement','produced','Cement','unit_kg',1,1,'${SEED_TIME}','${SEED_TIME}');
    `);
    const stock=new SqliteStockRepository(db as never);
    const draft={itemId:'cement',unitId:'',recordDate:'2026-10-03',supplierId:'',invoiceNumber:'',quantity:'1000',priceBasis:'per_unit' as const,price:'',vat:{mode:'none' as const,ratePercent:''},notes:''};
    const first=await stock.recordBatch(draft);await stock.recordBatch({...draft,recordDate:'2026-10-12',quantity:'5000'});
    await stock.recordUse({itemId:'cement',quantity:'100',usedOn:'2026-10-10',note:''});
    const overview=await stock.closeBatch(first.id,'2026-10-17','Pallet moved');
    const rows=stockWorkbookSheets(overview,{itemId:'cement',includePrices:false},{name:'Plant Co'},'2026-10-17T12:30:00.000Z').find(sheet=>sheet.name==='Batches')!.rows;
    expect(rows.find(row=>row['Batch Number']===first.batchNumber)).toMatchObject({Status:'Closed','Closed On':'2026-10-17','Left Over When Closed':900,'Closing Reason':'Pallet moved'});
    expect(rows.find(row=>row['Batch Number']!==first.batchNumber)).toMatchObject({'Closed On':'','Left Over When Closed':null,'Closing Reason':''});
    const dictionary=stockWorkbookSheets(overview,{itemId:'cement',includePrices:false},{name:'Plant Co'}).find(sheet=>sheet.name==='Data Dictionary')!.rows;
    expect(dictionary.some(row=>String(row.Column).startsWith('Closed On'))).toBe(true);
  });
});
