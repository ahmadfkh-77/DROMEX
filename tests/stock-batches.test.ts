import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteStockRepository} from '../src/data/repositories/SqliteStockRepository';
import {
  calculateStockPrice,formatStockBatchNumber,planStockUse,previewStockPrice,stockPrefix,validateStockQuantity,
  type StockBatch,type StockBatchDraft,type StockUseDraft,
} from '../src/domain/stock';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Stock (Phase 1): any Catalog item as stock, batches with an optional price and an optional VAT (never by default), oldest-first use that
 * carries on into the next batch, cancelling a use by reversal, and the rules for editing and cancelling a batch.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-16T09:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const clock=(local:string)=>vi.setSystemTime(new Date(local));

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT OR REPLACE INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1100,'${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('gulf','Gulf Lubricants',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,vat_mode,created_at,updated_at) VALUES ('taxed','Taxed Supplier',1,'universal','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat_stock','Materials','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('oil','cat_stock','Engine oil','unit_kg',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('cement','cat_stock','Cement',NULL,1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('off','cat_stock','Retired item','unit_kg',1,0,'${SEED_TIME}','${SEED_TIME}');
  `);
  const repository=new SqliteStockRepository(db as never);
  const draft=(extra:Partial<StockBatchDraft>={}):StockBatchDraft=>({itemId:'oil',unitId:'',recordDate:'2026-10-12',supplierId:'gulf',invoiceNumber:'INV-1',quantity:'20',priceBasis:'per_unit',price:'',vat:{mode:'none',ratePercent:''},notes:'',...extra});
  const use=(extra:Partial<StockUseDraft>={}):StockUseDraft=>({itemId:'oil',quantity:'3',usedOn:'2026-10-16',note:'',...extra});
  return {db,repository,draft,use};
}

describe('the numbers, prices and the plan (pure)',()=>{
  it('makes a short code from the item name and keeps codes different',()=>{
    expect(stockPrefix('Engine oil',new Set())).toBe('ENG');
    expect(stockPrefix('Cement',new Set())).toBe('CEM');
    expect(stockPrefix('Cement, white',new Set(['CEM']))).toBe('CE2');
    expect(stockPrefix('123',new Set())).toBe('123');
    expect(stockPrefix('é!',new Set())).toBe('EXX');
    expect(formatStockBatchNumber('OIL',7)).toBe('OIL-0007');
  });
  it('accepts a positive quantity and rejects the rest',()=>{
    expect(validateStockQuantity('20')).toBe(20);expect(validateStockQuantity('1,5')).toBe(1.5);expect(validateStockQuantity('0.0004'.replace('0.0004','0.001'))).toBe(0.001);
    for(const bad of ['','0','-1','abc','1e3','0.0001'])expect(()=>validateStockQuantity(bad)).toThrow('greater than zero');
  });
  it('adds VAT only when asked, and a missing price stays Unpriced',()=>{
    expect(calculateStockPrice(20,'per_unit','18.5',0)).toEqual({priceUsd:18.5,subtotalUsd:370,vatAmountUsd:0,totalUsd:370});
    expect(calculateStockPrice(20,'per_unit','18.5',11)).toEqual({priceUsd:18.5,subtotalUsd:370,vatAmountUsd:40.7,totalUsd:410.7});
    expect(calculateStockPrice(20,'whole','300',0)).toMatchObject({subtotalUsd:300,totalUsd:300});
    expect(calculateStockPrice(20,'per_unit','',11)).toEqual({priceUsd:null,subtotalUsd:null,vatAmountUsd:null,totalUsd:null});
    expect(()=>calculateStockPrice(20,'per_unit','1.234',0)).toThrow('two decimals');
    expect(previewStockPrice({quantity:'20',priceBasis:'per_unit',price:'18.5',vat:{mode:'none',ratePercent:''}},11)?.totalUsd).toBe(370);
    expect(previewStockPrice({quantity:'20',priceBasis:'per_unit',price:'18.5',vat:{mode:'universal',ratePercent:''}},11)?.totalUsd).toBe(410.7);
    expect(previewStockPrice({quantity:'20',priceBasis:'per_unit',price:'18.5',vat:{mode:'custom',ratePercent:'5'}},11)?.totalUsd).toBe(388.5);
    expect(previewStockPrice({quantity:'20',priceBasis:'per_unit',price:'18.5',vat:{mode:'custom',ratePercent:'abc'}},11)).toBeNull();
  });
  it('takes from the oldest batch first and carries on into the next',()=>{
    const batch=(id:string,day:string,remaining:number):StockBatch=>({id,itemId:'oil',batchNumber:id,arrivedAt:`${day}T08:00:00.000Z`,supplierId:null,supplierName:null,invoiceNumber:null,notes:null,quantity:remaining,usedQuantity:0,remainingQuantity:remaining,priceBasis:null,priceUsd:null,vatRatePercent:null,subtotalUsd:null,totalUsd:null,priced:false,status:'waiting',recordStatus:'Active',cancellationReason:null,cancelledAt:null,correctionHistory:[],createdAt:'x'});
    const batches=[batch('B2','2026-10-12',50),batch('B1','2026-10-03',4)];
    expect(planStockUse(batches,10,'2026-10-16','gal')).toEqual([{batchId:'B1',quantity:4},{batchId:'B2',quantity:6}]);
    expect(planStockUse(batches,3,'2026-10-16','gal')).toEqual([{batchId:'B1',quantity:3}]);
    expect(planStockUse(batches,4,'2026-10-05','gal')).toEqual([{batchId:'B1',quantity:4}]);
    expect(()=>planStockUse(batches,10,'2026-10-05','gal')).toThrow('Only 4 gal is in stock for that day');
    expect(()=>planStockUse(batches,55,'2026-10-16','gal')).toThrow('Only 54 gal');
  });
});

describe('adding items and recording batches',()=>{
  it('starts with no stock items and offers every active Catalog item',async()=>{
    const {repository}=await setup();
    expect((await repository.getOverview()).items).toEqual([]);
    const items=(await repository.getSetup()).catalogItems;
    expect(items.map(item=>item.id)).toContain('oil');expect(items.map(item=>item.id)).not.toContain('off');
    expect(items.find(item=>item.id==='oil')).toMatchObject({unitSymbol:'kg',inStock:false});
    expect(items.find(item=>item.id==='cement')).toMatchObject({unitSymbol:null,unitId:null});
  });
  it('adds the item on its first batch, numbers batches per item and never adds VAT or a price by default',async()=>{
    const {repository,draft}=await setup();
    const first=await repository.recordBatch(draft());
    expect(first).toMatchObject({batchNumber:'ENG-0001',quantity:20,remainingQuantity:20,status:'in_use',priced:false,vatRatePercent:null,totalUsd:null,supplierName:'Gulf Lubricants'});
    const second=await repository.recordBatch(draft({recordDate:'2026-10-14',quantity:'10'}));
    expect(second).toMatchObject({batchNumber:'ENG-0002',status:'waiting'});
    const overview=await repository.getOverview();
    expect(overview.items).toHaveLength(1);
    expect(overview.items[0]).toMatchObject({itemName:'Engine oil',unitSymbol:'kg',prefix:'ENG',totalRemaining:30,totalReceived:30,totalUsed:0});
    expect((await repository.getSetup()).catalogItems.find(item=>item.id==='oil')?.inStock).toBe(true);
  });
  it('needs a unit for an item that has no default unit, and then keeps it',async()=>{
    const {repository,draft}=await setup();
    await expect(repository.recordBatch(draft({itemId:'cement'}))).rejects.toThrow('Select the unit');
    const batch=await repository.recordBatch(draft({itemId:'cement',unitId:'unit_ton',quantity:'12'}));
    expect(batch.batchNumber).toBe('CEM-0001');
    const item=(await repository.getOverview()).items.find(value=>value.itemId==='cement');
    expect(item).toMatchObject({unitSymbol:'t',unitName:'Metric ton'});
    await expect(repository.recordBatch(draft({itemId:'cement',unitId:'unit_kg',quantity:'5'}))).resolves.toMatchObject({batchNumber:'CEM-0002'});
    expect((await repository.getOverview()).items.find(value=>value.itemId==='cement')?.unitSymbol).toBe('t');
  });
  it('snapshots the price and applies VAT only when chosen',async()=>{
    const {repository,draft}=await setup();
    const plain=await repository.recordBatch(draft({price:'18.5'}));
    expect(plain).toMatchObject({priceUsd:18.5,subtotalUsd:370,totalUsd:370,vatRatePercent:null,priced:true});
    const withVat=await repository.recordBatch(draft({price:'18.5',vat:{mode:'universal',ratePercent:''}}));
    expect(withVat).toMatchObject({subtotalUsd:370,totalUsd:410.7,vatRatePercent:11});
    const noPriceVat=await repository.recordBatch(draft({vat:{mode:'universal',ratePercent:''}}));
    expect(noPriceVat).toMatchObject({priced:false,vatRatePercent:null,totalUsd:null});
    await expect(repository.recordBatch(draft({price:'5',vat:{mode:'custom',ratePercent:''}}))).rejects.toThrow('VAT must be');
  });
  it('applies Own % and starts a new batch from the supplier account',async()=>{
    const {repository,draft}=await setup();
    const own=await repository.recordBatch(draft({price:'18.5',vat:{mode:'custom',ratePercent:'5'}}));
    expect(own).toMatchObject({subtotalUsd:370,totalUsd:388.5,vatRatePercent:5});
    const suppliers=(await repository.getSetup()).suppliers;
    expect(suppliers.find(value=>value.id==='gulf')?.vat).toEqual({mode:'none',ratePercent:null});
    expect(suppliers.find(value=>value.id==='taxed')?.vat).toEqual({mode:'universal',ratePercent:null});
  });
  it('rejects a bad form without saving anything',async()=>{
    const {db,repository,draft}=await setup();
    await expect(repository.recordBatch(draft({quantity:'0'}))).rejects.toThrow('greater than zero');
    await expect(repository.recordBatch(draft({itemId:'off'}))).rejects.toThrow('active item');
    await expect(repository.recordBatch(draft({supplierId:'nobody'}))).rejects.toThrow('active supplier');
    await expect(repository.recordBatch(draft({recordDate:'2026-12-01'}))).rejects.toThrow('today or a valid past date');
    expect((db.raw.prepare('SELECT COUNT(*) c FROM stock_items').get() as {c:number}).c).toBe(0);
    expect((db.raw.prepare('SELECT COUNT(*) c FROM stock_batches').get() as {c:number}).c).toBe(0);
  });
  it('allows a batch without a supplier',async()=>{
    const {repository,draft}=await setup();
    expect(await repository.recordBatch(draft({supplierId:''}))).toMatchObject({supplierId:null,supplierName:null});
  });
});

describe('using stock by hand',()=>{
  it('takes from the oldest batch and carries on into the next one',async()=>{
    const {repository,draft,use}=await setup();
    await repository.recordBatch(draft({recordDate:'2026-10-03',quantity:'4'}));
    await repository.recordBatch(draft({recordDate:'2026-10-12',quantity:'50'}));
    const record=await repository.recordUse(use({quantity:'10',note:'Loader service'}));
    expect(record.lines).toEqual([{batchId:expect.any(String),batchNumber:'ENG-0001',quantity:4},{batchId:expect.any(String),batchNumber:'ENG-0002',quantity:6}]);
    expect(record).toMatchObject({quantity:10,status:'Active',note:'Loader service'});
    const item=(await repository.getOverview()).items[0]!;
    expect(item.totalRemaining).toBe(44);expect(item.totalUsed).toBe(10);
    expect(item.batches.map(batch=>[batch.batchNumber,batch.remainingQuantity,batch.status])).toEqual([['ENG-0001',0,'closed'],['ENG-0002',44,'in_use']]);
  });
  it('refuses to use more than is in stock for that day, and leaves nothing behind',async()=>{
    const {db,repository,draft,use}=await setup();
    await repository.recordBatch(draft({recordDate:'2026-10-12',quantity:'20'}));
    await expect(repository.recordUse(use({quantity:'21'}))).rejects.toThrow('Only 20 kg is in stock');
    await expect(repository.recordUse(use({quantity:'5',usedOn:'2026-10-10'}))).rejects.toThrow('Only 0 kg is in stock for that day');
    await expect(repository.recordUse(use({quantity:'0'}))).rejects.toThrow('greater than zero');
    await expect(repository.recordUse(use({itemId:'cement'}))).rejects.toThrow('not in Stock yet');
    expect((db.raw.prepare('SELECT COUNT(*) c FROM stock_use').get() as {c:number}).c).toBe(0);
  });
  it('puts the stock back by reversal when a use is cancelled, keeping the original rows',async()=>{
    const {db,repository,draft,use}=await setup();
    await repository.recordBatch(draft({quantity:'20'}));
    const record=await repository.recordUse(use({quantity:'8'}));
    await expect(repository.cancelUse(record.groupId,'  ')).rejects.toThrow('reason');
    await repository.cancelUse(record.groupId,'Entered twice');
    const item=(await repository.getOverview()).items[0]!;
    expect(item.totalRemaining).toBe(20);expect(item.totalUsed).toBe(0);
    expect(item.uses[0]).toMatchObject({status:'Cancelled',cancellationReason:'Entered twice',quantity:8});
    expect((db.raw.prepare('SELECT kind,quantity FROM stock_use ORDER BY rowid').all() as {kind:string;quantity:number}[])).toEqual([{kind:'use',quantity:8},{kind:'reversal',quantity:-8}]);
    await expect(repository.cancelUse(record.groupId,'again')).rejects.toThrow('already cancelled');
    await expect(repository.cancelUse('missing','x')).rejects.toThrow('not found');
  });
});

describe('editing and cancelling a batch',()=>{
  it('keeps the old values in the history and asks a reason for a new quantity or date',async()=>{
    const {repository,draft}=await setup();
    const batch=await repository.recordBatch(draft({quantity:'20'}));
    const edit=(extra:Partial<StockBatchDraft>&{reason?:string})=>({...draft(),...extra,reason:extra.reason??''});
    await expect(repository.editBatch(batch.id,edit({quantity:'25'}))).rejects.toThrow('Enter a reason');
    const changed=await repository.editBatch(batch.id,edit({quantity:'25',reason:'Counted again'}));
    expect(changed.quantity).toBe(25);
    expect(changed.correctionHistory[0]).toMatchObject({reason:'Counted again',changes:[{field:'Quantity',before:'20',after:'25'}]});
    const noted=await repository.editBatch(batch.id,edit({quantity:'25',notes:'Pallet 4'}));
    expect(noted.notes).toBe('Pallet 4');expect(noted.correctionHistory).toHaveLength(2);
    expect((await repository.editBatch(batch.id,edit({quantity:'25',notes:'Pallet 4'}))).correctionHistory).toHaveLength(2);
  });
  it('does not let the quantity drop below what was used, or the date pass the first use',async()=>{
    const {repository,draft,use}=await setup();
    const batch=await repository.recordBatch(draft({recordDate:'2026-10-12',quantity:'20'}));
    await repository.recordUse(use({quantity:'8',usedOn:'2026-10-14'}));
    const edit=(extra:Partial<StockBatchDraft>)=>({...draft(),...extra,reason:'fix'});
    await expect(repository.editBatch(batch.id,edit({quantity:'7'}))).rejects.toThrow('cannot be lower');
    await expect(repository.editBatch(batch.id,edit({quantity:'20',recordDate:'2026-10-15'}))).rejects.toThrow('cannot arrive after');
    expect((await repository.editBatch(batch.id,edit({quantity:'8',recordDate:'2026-10-13'}))).remainingQuantity).toBe(0);
    await expect(repository.editBatch(batch.id,{...draft(),itemId:'cement',reason:'x'})).rejects.toThrow('another item');
  });
  it('cancels a batch with a reason, never one that has use, and never counts it afterwards',async()=>{
    const {repository,draft,use}=await setup();
    const first=await repository.recordBatch(draft({recordDate:'2026-10-10',quantity:'20'}));
    const second=await repository.recordBatch(draft({recordDate:'2026-10-12',quantity:'30'}));
    const record=await repository.recordUse(use({quantity:'5'}));
    await expect(repository.cancelBatch(first.id,'wrong')).rejects.toThrow('Cancel those uses first');
    await expect(repository.cancelBatch(second.id,'')).rejects.toThrow('reason');
    const cancelled=await repository.cancelBatch(second.id,'Delivery refused');
    expect(cancelled).toMatchObject({status:'cancelled',recordStatus:'Cancelled',cancellationReason:'Delivery refused'});
    let item=(await repository.getOverview()).items[0]!;
    expect(item.totalRemaining).toBe(15);expect(item.totalReceived).toBe(20);
    await expect(repository.editBatch(second.id,{...draft(),reason:'x'})).rejects.toThrow('cancelled');
    await expect(repository.cancelBatch(second.id,'again')).rejects.toThrow('already cancelled');
    await expect(repository.recordUse(use({quantity:'16'}))).rejects.toThrow('Only 15 kg');
    await repository.cancelUse(record.groupId,'Mistake');
    await repository.cancelBatch(first.id,'No longer needed');
    item=(await repository.getOverview()).items[0]!;
    expect(item.totalRemaining).toBe(0);
  });
});

describe('the database',()=>{
  it('is migrated with the stock tables and queues every change for sync',async()=>{
    const {db,repository,draft,use}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(60);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    const tables=(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'stock_%' ORDER BY name").all() as {name:string}[]).map(row=>row.name);
    expect(tables).toEqual(['stock_batches','stock_items','stock_use']);
    const batch=await repository.recordBatch(draft());
    const record=await repository.recordUse(use());
    await repository.cancelUse(record.groupId,'x');
    await repository.cancelBatch(batch.id,'y');
    const queued=(db.raw.prepare("SELECT entity_type,operation FROM sync_outbox WHERE entity_type LIKE 'stock%' ORDER BY id").all() as {entity_type:string;operation:string}[]).map(row=>row.entity_type);
    expect(queued).toEqual(['stockBatch','stockUse','stockUse','stockBatch']);
  });
  it('keeps Bitumen and the other tables untouched',async()=>{
    const {db}=await setup();
    const tables=(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bitumen_%'").all() as {name:string}[]).map(row=>row.name).sort();
    expect(tables).toEqual(['bitumen_adjustments','bitumen_batch_counters','bitumen_batches','bitumen_grades','bitumen_item_rules','bitumen_settings','bitumen_use']);
  });
});

describe('the Stock screen and Home',()=>{
  const read=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;
  const home=read('src/ui/screens/HomeScreen.tsx'),screen=read('src/ui/screens/StockScreen.tsx'),app=read('src/ui/DromexApp.tsx');
  const section=(title:string)=>{const start=home.indexOf(`title="${title}"`);const end=home.indexOf('</ExpandableMenuSection>',start);return home.slice(start,end);};
  it('adds a Stock entry to the Stock section of Home, after Fuel Tracking and Bitumen Tracking',()=>{
    const stock=section('Stock');
    expect(stock).toContain('title="Fuel Tracking"');expect(stock).toContain('title="Bitumen Tracking"');
    expect(stock.indexOf('number="03" title="Stock"')).toBeGreaterThan(stock.indexOf('title="Bitumen Tracking"'));
    expect(stock).toContain('onPress={props.onOpenStock}');
  });
  it('is reached from Home and goes back to it',()=>{
    expect(app).toContain("onOpenStock={()=>navigate('stock')}");
    expect(app).toContain("screen==='stock'");expect(app).toContain("goBack('home')");
  });
  it('lists Bitumen and Fuel first, then the owner\'s items, with an Add button and nothing pre-made',()=>{
    expect(screen).toContain('title="Bitumen"');expect(screen).toContain('title="Fuel"');
    expect(screen.indexOf('title="Bitumen"')).toBeLessThan(screen.indexOf('overview.items.map'));
    expect(screen).toContain('label="+ Add"');
    expect(screen).toContain('Nothing else in Stock yet');
  });
  it('offers No VAT by default, an optional price and the Catalog when an item is missing',()=>{
    expect(screen).toContain('<VatChoiceControl value={draft.vat}');expect(screen).toContain('No VAT is added unless you choose it.');expect(screen).toContain('startingVatChoice(setup.suppliers.find(value=>value.id===id)?.vat)');
    expect(screen).toContain('Price (optional)');expect(screen).toContain('Supplier (optional)');
    expect(screen).toContain('Not in the list? Add it in the Catalog first');expect(screen).toContain('onPress={onOpenCatalog}');
  });
});
