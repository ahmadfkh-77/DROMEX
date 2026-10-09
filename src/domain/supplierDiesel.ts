import {localDateKey} from './fuel';
import type {BatchDetail} from './fuelBatches';

/**
 * DEC-506. What one supplier delivered as diesel, read from the numbered batches. Litres are kept apart from
 * material quantities (never added to tons or m³). A batch belongs to one supplier. A priced batch adds its
 * recorded delivery total (with VAT) to the amount; an unpriced batch is counted and listed as Unpriced and is
 * never treated as zero. A cancelled batch is not counted, and an Opening stock batch is not a purchase.
 */
export type SupplierDieselRow={batchId:string;batchNumber:string;day:string;litres:number;invoiceNumber:string|null;pricePerLitreUsd:number|null;totalUsd:number|null;priced:boolean};
export type SupplierDieselSummary={
  supplierId:string;rows:SupplierDieselRow[];batchCount:number;totalLitres:number;
  /** Total of the priced batches only. Null when none is priced. */
  pricedAmountUsd:number|null;pricedCount:number;unpricedCount:number;unpricedLitres:number;cancelledCount:number;
  /** "2 unpriced batches", or null when every batch is priced. */
  unpricedNote:string|null;
};
export type SupplierDieselRange={fromDate?:string;toDate?:string};
const round3=(value:number)=>Math.round(value*1000)/1000;
const round2=(value:number)=>Math.round(value*100)/100;

export function supplierDieselDeliveries(batches:readonly BatchDetail[],supplierId:string,range:SupplierDieselRange={}):SupplierDieselSummary{
  const own=batches.filter(batch=>batch.kind==='delivery'&&batch.supplierId===supplierId).filter(batch=>{
    const day=localDateKey(batch.arrivedAt);
    return (!range.fromDate||day>=range.fromDate)&&(!range.toDate||day<=range.toDate);
  });
  const active=own.filter(batch=>batch.status!=='cancelled');
  const rows=[...active].sort((a,b)=>b.arrivedAt.localeCompare(a.arrivedAt)||b.batchNumber.localeCompare(a.batchNumber)).map((batch):SupplierDieselRow=>({
    batchId:batch.id,batchNumber:batch.batchNumber,day:localDateKey(batch.arrivedAt),litres:batch.deliveredLitres,invoiceNumber:batch.invoiceNumber,
    pricePerLitreUsd:batch.pricePerLitreUsd,totalUsd:batch.finalTotalUsd??null,priced:batch.pricePerLitreUsd!=null&&batch.finalTotalUsd!=null,
  }));
  const priced=rows.filter(row=>row.priced),unpriced=rows.filter(row=>!row.priced);
  const unpricedNote=unpriced.length?`${unpriced.length} unpriced batch${unpriced.length===1?'':'es'}`:null;
  return {
    supplierId,rows,batchCount:rows.length,totalLitres:round3(rows.reduce((sum,row)=>sum+row.litres,0)),
    pricedAmountUsd:priced.length?round2(priced.reduce((sum,row)=>sum+(row.totalUsd??0),0)):null,pricedCount:priced.length,unpricedCount:unpriced.length,
    unpricedLitres:round3(unpriced.reduce((sum,row)=>sum+row.litres,0)),cancelledCount:own.length-active.length,unpricedNote,
  };
}
