import {localDateKey} from './fuel';
import {stockPriceText,type StockBatch,type StockOverview} from './stock';

/** A Stock batch with the item and unit it is counted in, so a supplier's page can list it without reading the whole Stock overview. */
export type SupplierStockBatch=StockBatch&{itemName:string;unitSymbol:string};
export type SupplierStockRow={batchId:string;batchNumber:string;itemName:string;unitSymbol:string;day:string;quantity:number;invoiceNumber:string|null;priceLabel:string;priced:boolean;totalUsd:number|null};
export type SupplierStockSummary={supplierId:string;batchCount:number;pricedAmountUsd:number|null;unpricedNote:string|null;cancelledCount:number;rows:SupplierStockRow[]};

const round2=(value:number)=>Math.round(value*100)/100;

export function flattenStockBatches(overview:StockOverview):SupplierStockBatch[]{
  return overview.items.flatMap(item=>item.batches.map(batch=>({...batch,itemName:item.itemName,unitSymbol:item.unitSymbol})));
}

/**
 * One supplier's Stock deliveries: the batches recorded in Stock for that supplier. A batch made from a Supplier Load is left out, because the
 * load already shows that delivery, so nothing is listed or counted twice. A record, not a second invoice: it creates no payable. A priced
 * batch adds its recorded total (with VAT where applied); an unpriced one is counted and listed as Unpriced, never as zero. Quantities of
 * different items and units are never added together, so the block shows no quantity total.
 */
export function supplierStockDeliveries(batches:readonly SupplierStockBatch[],supplierId:string):SupplierStockSummary{
  const own=batches.filter(batch=>batch.supplierId===supplierId&&!batch.sourcePurchaseId);
  const active=own.filter(batch=>batch.recordStatus==='Active');
  const rows=[...active].sort((a,b)=>b.arrivedAt.localeCompare(a.arrivedAt)||b.batchNumber.localeCompare(a.batchNumber)).map((batch):SupplierStockRow=>({
    batchId:batch.id,batchNumber:batch.batchNumber,itemName:batch.itemName,unitSymbol:batch.unitSymbol,day:localDateKey(batch.arrivedAt),quantity:batch.quantity,invoiceNumber:batch.invoiceNumber,
    priceLabel:stockPriceText(batch,batch.unitSymbol),priced:batch.priced,totalUsd:batch.totalUsd,
  }));
  const pricedRows=rows.filter(row=>row.priced&&row.totalUsd!=null);
  const unpriced=rows.length-pricedRows.length;
  return{supplierId,batchCount:rows.length,pricedAmountUsd:pricedRows.length?round2(pricedRows.reduce((sum,row)=>sum+(row.totalUsd??0),0)):null,unpricedNote:unpriced?`${unpriced} Unpriced`:null,cancelledCount:own.length-active.length,rows};
}

/** Supplier Load id to the number of the active Stock batch made from it, for the In Stock tag on a load. */
export function stockTagsByPurchase(batches:readonly SupplierStockBatch[]):Map<string,string>{
  const tags=new Map<string,string>();
  for(const batch of batches)if(batch.sourcePurchaseId&&batch.recordStatus==='Active')tags.set(batch.sourcePurchaseId,batch.batchNumber);
  return tags;
}
