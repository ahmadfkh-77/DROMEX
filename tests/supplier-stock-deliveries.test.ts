import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

import type {StockOverview} from '../src/domain/stock';
import {flattenStockBatches,stockTagsByPurchase,supplierStockDeliveries,type SupplierStockBatch} from '../src/domain/supplierStock';

/**
 * Stock deliveries on a supplier's page (Phase 3): the batches recorded in Stock for that supplier, never a batch made from a Supplier Load (the
 * load already shows it), never added into a quantity total, and no payable. A linked load carries an In Stock tag.
 */
const batch=(extra:Partial<SupplierStockBatch>):SupplierStockBatch=>({
  id:'b1',itemId:'oil',itemName:'Engine oil',unitSymbol:'gal',batchNumber:'ENG-0001',arrivedAt:'2026-10-12T09:00:00',supplierId:'gulf',supplierName:'Gulf Lubricants',invoiceNumber:'9981',notes:null,
  quantity:4,usedQuantity:0,remainingQuantity:4,priceBasis:'per_unit',priceUsd:20,vatRatePercent:null,subtotalUsd:80,totalUsd:80,priced:true,status:'in_use',recordStatus:'Active',
  cancellationReason:null,cancelledAt:null,correctionHistory:[],createdAt:'2026-10-12T09:00:00',closure:null,closureHistory:[],sourcePurchaseId:null,sourcePurchaseNumber:null,...extra,
} as SupplierStockBatch);

describe('a supplier\'s Stock deliveries',()=>{
  it('lists the batches recorded in Stock for that supplier, newest first, and leaves out other suppliers',()=>{
    const summary=supplierStockDeliveries([batch({id:'a',batchNumber:'ENG-0001',arrivedAt:'2026-10-01T09:00:00'}),batch({id:'b',batchNumber:'ENG-0002',arrivedAt:'2026-10-12T09:00:00'}),batch({id:'c',supplierId:'other',supplierName:'Other'})],'gulf');
    expect(summary.rows.map(row=>row.batchNumber)).toEqual(['ENG-0002','ENG-0001']);
    expect(summary).toMatchObject({supplierId:'gulf',batchCount:2});
    expect(summary.rows[0]).toMatchObject({itemName:'Engine oil',unitSymbol:'gal',quantity:4,invoiceNumber:'9981',priceLabel:'$20.00 / gal',day:'2026-10-12'});
  });
  it('does not list a batch made from a Supplier Load, because the load shows that delivery',()=>{
    const summary=supplierStockDeliveries([batch({id:'a'}),batch({id:'linked',batchNumber:'ENG-0002',sourcePurchaseId:'load1',sourcePurchaseNumber:'SL-1'})],'gulf');
    expect(summary.rows.map(row=>row.batchId)).toEqual(['a']);
    expect(summary.batchCount).toBe(1);
  });
  it('adds the recorded total of priced batches only, counts an unpriced one, and never treats it as zero',()=>{
    const summary=supplierStockDeliveries([batch({id:'a',totalUsd:80}),batch({id:'b',totalUsd:111,priced:true}),batch({id:'c',priced:false,priceBasis:null,priceUsd:null,totalUsd:null})],'gulf');
    expect(summary.pricedAmountUsd).toBe(191);
    expect(summary.unpricedNote).toBe('1 Unpriced');
    expect(summary.rows.find(row=>row.batchId==='c')).toMatchObject({priced:false,priceLabel:'Unpriced',totalUsd:null});
    expect(supplierStockDeliveries([batch({priced:false,priceBasis:null,priceUsd:null,totalUsd:null})],'gulf').pricedAmountUsd).toBeNull();
  });
  it('counts a cancelled batch but does not list or add it',()=>{
    const summary=supplierStockDeliveries([batch({id:'a'}),batch({id:'x',recordStatus:'Cancelled',status:'cancelled',totalUsd:500})],'gulf');
    expect(summary).toMatchObject({batchCount:1,cancelledCount:1,pricedAmountUsd:80});
    expect(summary.rows.map(row=>row.batchId)).toEqual(['a']);
  });
  it('gives no quantity total, since items and units are never added together',()=>{
    const summary=supplierStockDeliveries([batch({id:'a'}),batch({id:'b',itemName:'Cement bags',unitSymbol:'pc',quantity:200})],'gulf');
    expect(Object.keys(summary)).not.toContain('totalQuantity');
    expect(summary.rows.map(row=>`${row.quantity} ${row.unitSymbol}`).sort()).toEqual(['200 pc','4 gal']);
  });
});

describe('the In Stock tag and the Stock overview',()=>{
  it('maps a load to the active batch made from it, and ignores a cancelled batch',()=>{
    const tags=stockTagsByPurchase([batch({id:'a',batchNumber:'CEM-0001',sourcePurchaseId:'load1'}),batch({id:'b',batchNumber:'CEM-0002',sourcePurchaseId:'load2',recordStatus:'Cancelled'}),batch({id:'c'})]);
    expect([...tags.entries()]).toEqual([['load1','CEM-0001']]);
  });
  it('flattens the overview with each batch\'s item and unit',()=>{
    const overview={items:[{itemId:'oil',itemName:'Engine oil',unitSymbol:'gal',unitName:'Gallon',prefix:'ENG',totalRemaining:4,totalReceived:4,totalUsed:0,uses:[],batches:[batch({})]}]} as unknown as StockOverview;
    expect(flattenStockBatches(overview)).toEqual([expect.objectContaining({batchNumber:'ENG-0001',itemName:'Engine oil',unitSymbol:'gal'})]);
  });
});

describe('wired on the Supplier Loads screen',()=>{
  const read=(path:string)=>readFileSync(path,'utf8');
  it('shows the block in the delivery summary and in purchase history, with the In Stock tag on a load',()=>{
    const screen=read('src/ui/screens/QuarryPurchasesScreen.tsx');
    expect(screen.split('<SupplierStockBlock').length-1).toBe(2);
    for(const text of ['stockTagsByPurchase','In Stock · {stockBatchNumber}','onOpenStockBatch'])expect(screen).toContain(text);
    expect(read('src/ui/DromexApp.tsx')).toContain('onOpenStockBatch=');
    expect(read('src/ui/screens/StockScreen.tsx')).toContain('initialBatchId');
  });
});
