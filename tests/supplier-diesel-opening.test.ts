import {describe,expect,it} from 'vitest';

import {supplierDieselDeliveries} from '../src/domain/supplierDiesel';
import type {BatchDetail} from '../src/domain/fuelBatches';

/**
 * The first batch of a plant is often saved as Opening stock (what was in the tank when batches began). When the owner saved a
 * supplier on it, that supplier delivered it: it counts in the supplier's diesel history, tagged "opening stock", with its amount
 * as litres × price. A batch with no supplier, another supplier's batch and a cancelled batch are never counted.
 */
const batch=(over:Partial<BatchDetail>):BatchDetail=>({id:'b1',batchNumber:'DSL-2026-00001',arrivedAt:'2026-10-07T08:00:00',deliveredLitres:3303,pricePerLitreUsd:null,finalTotalUsd:null,kind:'opening',invoiceNumber:null,supplierId:'khayat',supplierName:'Khayat Al Sabouri',status:'in_use',...over} as BatchDetail);

describe('a supplier\'s diesel history',()=>{
  it('counts an opening batch that has the supplier saved on it, tagged as opening stock',()=>{
    const summary=supplierDieselDeliveries([batch({})],'khayat');
    expect(summary.batchCount).toBe(1);expect(summary.totalLitres).toBe(3303);
    expect(summary.rows[0]).toMatchObject({batchNumber:'DSL-2026-00001',opening:true,batchLabel:'DSL-2026-00001 (opening stock)',litres:3303,invoiceNumber:null,priced:false,totalUsd:null});
    expect(summary.unpricedNote).toBe('1 unpriced batch');
  });
  it('gives an opening batch with a price an amount of litres × price, and keeps a delivery\'s recorded total with VAT',()=>{
    const summary=supplierDieselDeliveries([batch({pricePerLitreUsd:0.9}),batch({id:'b2',batchNumber:'DSL-2026-00002',kind:'delivery',deliveredLitres:1000,pricePerLitreUsd:1,finalTotalUsd:1110,arrivedAt:'2026-10-09T08:00:00'})],'khayat');
    expect(summary.batchCount).toBe(2);expect(summary.totalLitres).toBe(4303);
    expect(summary.rows.map(row=>[row.batchLabel,row.totalUsd,row.priced])).toEqual([['DSL-2026-00002',1110,true],['DSL-2026-00001 (opening stock)',2972.7,true]]);
    expect(summary.pricedAmountUsd).toBe(4082.7);expect(summary.unpricedNote).toBeNull();
  });
  it('never counts a batch with no supplier, another supplier\'s batch or a cancelled batch',()=>{
    const summary=supplierDieselDeliveries([batch({supplierId:null,supplierName:null}),batch({id:'b2',supplierId:'other'}),batch({id:'b3',status:'cancelled'})],'khayat');
    expect(summary.batchCount).toBe(0);expect(summary.rows).toEqual([]);expect(summary.cancelledCount).toBe(1);
  });
  it('follows the date range by the day the batch arrived',()=>{
    expect(supplierDieselDeliveries([batch({})],'khayat',{fromDate:'2026-10-08'}).batchCount).toBe(0);
    expect(supplierDieselDeliveries([batch({})],'khayat',{fromDate:'2026-10-07',toDate:'2026-10-07'}).batchCount).toBe(1);
  });
});

describe('the Suppliers screen',()=>{
  it('lists a supplier that has only diesel, opening-stock batches included, in the Delivery Summary',()=>{
    const screen=require('node:fs').readFileSync('src/ui/screens/QuarryPurchasesScreen.tsx','utf8') as string;
    expect(screen).toContain("if(batch.status==='cancelled'||!batch.supplierId||known.has(batch.supplierId)||extra.has(batch.supplierId))continue;");
    expect(screen).not.toContain("batch.kind!=='delivery'||batch.status==='cancelled'");
    expect(screen).toContain('{row.day} · {row.batchLabel}');
  });
});
