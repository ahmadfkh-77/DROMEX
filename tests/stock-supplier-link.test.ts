import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {SqliteStockRepository} from '../src/data/repositories/SqliteStockRepository';
import {emptyQuarryPurchaseDraft,type QuarryPurchaseDraft} from '../src/domain/quarry';
import {batchPriceFromLoad} from '../src/domain/stock';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Stock Phase 1: a Supplier Load can be linked into Stock without typing it again. The batch copies the load once and keeps its own saved
 * numbers; a load links once; a linked load cannot be cancelled until its Stock batch is; cancelling the batch frees the load again.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-19T09:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('dromex','DROMEX S.A.R.L',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('mat','Materials','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES
      ('cement','mat','Cement bags','unit_piece',1,1,'${SEED_TIME}','${SEED_TIME}'),('sand','mat','Sand','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const quarry=new SqliteQuarryRepository(db as never);
  const stock=new SqliteStockRepository(db as never);
  const draft=(extra:Partial<QuarryPurchaseDraft>={}):QuarryPurchaseDraft=>({...emptyQuarryPurchaseDraft,recordDate:'2026-09-08',supplierId:'dromex',projectId:'road',itemId:'cement',unitId:'unit_piece',quantityCubicMetres:'100',deliveryMethod:'supplier',supplierTruckPlate:'778899',supplierTicketNumber:'4471',...extra});
  return {db,quarry,stock,draft};
}
const batchRow=(db:SqliteTestDatabase,id:string)=>db.raw.prepare('SELECT * FROM stock_batches WHERE id=?').get(id) as Record<string,unknown>;

describe('what a batch copies from a load (pure)',()=>{
  it('copies the saved subtotal, VAT rate and total, and shows the price without VAT',()=>{
    expect(batchPriceFromLoad({quantity:100,priceBasis:'per_unit',unitPriceCents:520,subtotalCents:52000,vatBasisPoints:1100,totalCents:57720})).toEqual({priceBasis:'per_unit',priceCents:520,vatBasisPoints:1100,subtotalCents:52000,totalCents:57720});
    expect(batchPriceFromLoad({quantity:4,priceBasis:'whole',unitPriceCents:90000,subtotalCents:90000,vatBasisPoints:0,totalCents:90000})).toEqual({priceBasis:'whole',priceCents:90000,vatBasisPoints:null,subtotalCents:90000,totalCents:90000});
  });
  it('keeps a load with no price Unpriced, never zero',()=>{
    expect(batchPriceFromLoad({quantity:50,priceBasis:'per_unit',unitPriceCents:null,subtotalCents:null,vatBasisPoints:null,totalCents:null})).toBeNull();
  });
  it('shows the VAT-free price per unit even when the load was entered with VAT included',()=>{
    expect(batchPriceFromLoad({quantity:20,priceBasis:'per_unit',unitPriceCents:111,subtotalCents:2000,vatBasisPoints:1100,totalCents:2220})?.priceCents).toBe(100);
  });
});

describe('migration 65',()=>{
  it('adds the source column and the active-only unique index, and keeps the version current',async()=>{
    const {db}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(65);
    expect((db.raw.prepare('PRAGMA table_info(stock_batches)').all() as {name:string}[]).some(column=>column.name==='source_purchase_id')).toBe(true);
    expect((db.raw.prepare("SELECT sql FROM sqlite_master WHERE name='idx_stock_batches_source_purchase'").get() as {sql:string}).sql).toContain("status = 'Active'");
  });
});

describe('listing the loads that can be linked',()=>{
  it('lists active loads of the item that are not in Stock yet, oldest first',async()=>{
    const {quarry,stock,draft}=await setup();
    const second=await quarry.confirmPurchase(draft({recordDate:'2026-09-16',supplierTicketNumber:'4502'}));
    const first=await quarry.confirmPurchase(draft());
    await quarry.confirmPurchase(draft({itemId:'sand',unitId:'unit_ton'}));
    const cancelled=await quarry.confirmPurchase(draft({recordDate:'2026-09-20'}));
    await quarry.cancelPurchase(cancelled.id,'Entered twice');
    const list=await stock.listLinkableLoads('cement');
    expect(list.map(load=>load.id)).toEqual([first.id,second.id]);
    expect(list[0]).toMatchObject({purchaseNumber:first.purchaseNumber,supplierName:'DROMEX S.A.R.L',destinationName:'Mountain Road',quantity:100,unitSymbol:'pc',invoiceNumber:'4471',priced:false,totalUsd:null,usable:true,unusableReason:null});
  });
  it('marks a load whose unit differs from the unit the item is stocked in',async()=>{
    const {quarry,stock,draft}=await setup();
    const inPieces=await quarry.confirmPurchase(draft());
    await stock.recordBatchesFromLoads([inPieces.id]);
    const inTons=await quarry.confirmPurchase(draft({unitId:'unit_ton',recordDate:'2026-09-17'}));
    const [load]=await stock.listLinkableLoads('cement');
    expect(load).toMatchObject({id:inTons.id,usable:false});
    expect(load!.unusableReason).toContain('is in Stock in pc');
  });
});

describe('making batches from loads',()=>{
  it('makes one numbered batch per load, oldest first, copying the load and adding the item to Stock in the load\'s unit',async()=>{
    const {db,quarry,stock,draft}=await setup();
    const later=await quarry.confirmPurchase(draft({recordDate:'2026-09-16',supplierTicketNumber:'4502',quantityCubicMetres:'50'}));
    const earlier=await quarry.confirmPurchase(draft({unitPriceUsd:'5.20',vatMode:'custom',customVatRatePercent:'11'}));
    const batches=await stock.recordBatchesFromLoads([later.id,earlier.id]);
    expect(batches.map(batch=>batch.batchNumber)).toEqual(['CEM-0001','CEM-0002']);
    expect(batches[0]).toMatchObject({quantity:100,supplierId:'dromex',supplierName:'DROMEX S.A.R.L',invoiceNumber:'4471',priceBasis:'per_unit',priceUsd:5.2,vatRatePercent:11,subtotalUsd:520,totalUsd:577.2,priced:true,recordStatus:'Active',sourcePurchaseId:earlier.id});
    expect(batches[0]!.arrivedAt).toBe(earlier.confirmedAt);
    expect(batches[1]).toMatchObject({quantity:50,invoiceNumber:'4502',priced:false,priceUsd:null,totalUsd:null,sourcePurchaseId:later.id});
    expect(db.raw.prepare("SELECT unit_symbol,prefix FROM stock_items WHERE item_id='cement'").get()).toEqual({unit_symbol:'pc',prefix:'CEM'});
    expect(batchRow(db,batches[0]!.id).source_purchase_id).toBe(earlier.id);
    expect((await stock.listLinkableLoads('cement'))).toEqual([]);
  });
  it('queues the new batches for sync like any other Stock batch',async()=>{
    const {db,quarry,stock,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    const [batch]=await stock.recordBatchesFromLoads([load.id]);
    const rows=db.raw.prepare("SELECT entity_id,payload_json FROM sync_outbox WHERE entity_type='stockBatch'").all() as {entity_id:string;payload_json:string}[];
    expect(rows.map(row=>row.entity_id)).toContain(batch!.id);
    expect(JSON.parse(rows.find(row=>row.entity_id===batch!.id)!.payload_json).sourcePurchaseId).toBe(load.id);
  });
  it('links a load only once',async()=>{
    const {quarry,stock,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    await stock.recordBatchesFromLoads([load.id]);
    await expect(stock.recordBatchesFromLoads([load.id])).rejects.toThrow(`Supplier Load ${load.purchaseNumber} is already in Stock as CEM-0001.`);
  });
  it('refuses nothing chosen, a cancelled load, loads of two items and loads in two units, and changes nothing when it refuses',async()=>{
    const {db,quarry,stock,draft}=await setup();
    const cement=await quarry.confirmPurchase(draft());
    const sand=await quarry.confirmPurchase(draft({itemId:'sand',unitId:'unit_ton'}));
    const cancelled=await quarry.confirmPurchase(draft({recordDate:'2026-09-09'}));
    await quarry.cancelPurchase(cancelled.id,'Duplicate');
    const tons=await quarry.confirmPurchase(draft({unitId:'unit_ton',recordDate:'2026-09-10'}));
    await expect(stock.recordBatchesFromLoads([])).rejects.toThrow('Choose at least one Supplier Load.');
    await expect(stock.recordBatchesFromLoads([cancelled.id])).rejects.toThrow('is cancelled, so it cannot go into Stock');
    await expect(stock.recordBatchesFromLoads([cement.id,sand.id])).rejects.toThrow('Link the loads of one item at a time.');
    await expect(stock.recordBatchesFromLoads([cement.id,tons.id])).rejects.toThrow('different units');
    await expect(stock.recordBatchesFromLoads(['missing'])).rejects.toThrow('was not found');
    expect(db.raw.prepare('SELECT COUNT(*) n FROM stock_batches').get()).toEqual({n:0});
    expect(db.raw.prepare('SELECT COUNT(*) n FROM stock_items').get()).toEqual({n:0});
  });
  it('refuses a load in another unit than the item is already stocked in',async()=>{
    const {quarry,stock,draft}=await setup();
    await stock.recordBatchesFromLoads([(await quarry.confirmPurchase(draft())).id]);
    const tons=await quarry.confirmPurchase(draft({unitId:'unit_ton',recordDate:'2026-09-17'}));
    await expect(stock.recordBatchesFromLoads([tons.id])).rejects.toThrow('is in Stock in pc');
  });
});

describe('after a load is linked',()=>{
  it('keeps the batch\'s own numbers when the load is corrected later',async()=>{
    const {db,quarry,stock,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    const [batch]=await stock.recordBatchesFromLoads([load.id]);
    await quarry.correctPurchase(load.id,{...draft({quantityCubicMetres:'90'}),correctionReason:'Counted again at the gate'});
    expect(batchRow(db,batch!.id)).toMatchObject({quantity:100,invoice_number:'4471'});
  });
  it('cannot be cancelled until its Stock batch is cancelled, and then can',async()=>{
    const {quarry,stock,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    const [batch]=await stock.recordBatchesFromLoads([load.id]);
    await expect(quarry.cancelPurchase(load.id,'Entered by mistake')).rejects.toThrow('This supplier load is in Stock as CEM-0001. Cancel that Stock batch first.');
    expect((await quarry.listPurchases()).find(value=>value.id===load.id)?.status).toBe('Active');
    await stock.cancelBatch(batch!.id,'Linked by mistake');
    expect((await quarry.cancelPurchase(load.id,'Entered by mistake')).status).toBe('Cancelled');
  });
  it('is offered again, and can be linked again, once its batch is cancelled',async()=>{
    const {quarry,stock,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    const [batch]=await stock.recordBatchesFromLoads([load.id]);
    await stock.cancelBatch(batch!.id,'Linked by mistake');
    expect((await stock.listLinkableLoads('cement')).map(value=>value.id)).toEqual([load.id]);
    const [again]=await stock.recordBatchesFromLoads([load.id]);
    expect(again).toMatchObject({batchNumber:'CEM-0002',sourcePurchaseId:load.id});
  });
  it('shows the source on a batch recorded in Stock as none',async()=>{
    const {stock}=await setup();
    const batch=await stock.recordBatch({itemId:'sand',unitId:'',recordDate:'2026-10-12',supplierId:'dromex',invoiceNumber:'',quantity:'20',priceBasis:'per_unit',price:'',vat:{mode:'none',ratePercent:''},notes:''});
    expect(batch.sourcePurchaseId).toBeNull();
  });
});
