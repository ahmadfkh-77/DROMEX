import {localDateKey} from './fuel';
import {fuelDayLabel} from './fuelBatchViews';
import {formatStockQuantity,formatUsd,stockPriceText,stockStatusLabels,isOpenStockBatch,type StockBatch,type StockItemOverview,type StockOverview,type StockUseRecord} from './stock';

/**
 * The Stock Report: what came in, what was used and what is left, for one item or for all Stock, over the dates asked for. The batches table
 * lists the deliveries that arrived in the period (their used and left figures are the batch's own, to date); the uses table lists the uses
 * dated in the period, each with its source. Received and Used are for the period; On hand is what is left now. Every unit stays on its own:
 * bags, tons and gallons are never added together. Cancelled batches and cancelled uses are listed and never counted. Prices are only
 * included when asked for. Everything here only reads records.
 */
export type StockReportFilter={itemId?:string;fromDate?:string;toDate?:string;includePrices:boolean};
export type StockReportBatchRow={batchNumber:string;date:string;supplier:string;invoice:string;quantity:string;used:string;remaining:string;status:string;price?:string;amount?:string};
export type StockReportUseRow={date:string;source:string;batches:string;quantity:string;status:string;note:string};
export type StockReportItem={
  itemId:string;name:string;unit:string;received:string;used:string;onHand:string;openBatches:number;
  batches:StockReportBatchRow[];uses:StockReportUseRow[];cancelledNote:string|null;
};
export type StockReport={
  title:string;scopeLabel:string;rangeLabel:string;pricesIncluded:boolean;exportedAt:string;isSingle:boolean;
  items:StockReportItem[];summary:{item:string;unit:string;received:string;used:string;onHand:string;openBatches:number}[];
  /** True when there is nothing to put on a page. */
  empty:boolean;fileName:string;
};

const round3=(value:number)=>Math.round(value*1000)/1000;
const inRange=(day:string,filter:Pick<StockReportFilter,'fromDate'|'toDate'>)=>(!filter.fromDate||day>=filter.fromDate)&&(!filter.toDate||day<=filter.toDate);
const safe=(value:string)=>value.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'Stock';

export function stockRangeLabel(filter:Pick<StockReportFilter,'fromDate'|'toDate'>):string{
  if(!filter.fromDate&&!filter.toDate)return 'All dates';
  if(!filter.fromDate)return `Until ${fuelDayLabel(filter.toDate!)}`;
  if(!filter.toDate)return `From ${fuelDayLabel(filter.fromDate)}`;
  return filter.fromDate===filter.toDate?fuelDayLabel(filter.fromDate):`${fuelDayLabel(filter.fromDate)} – ${fuelDayLabel(filter.toDate)}`;
}

/** Which batches and uses of an item fall in the period, and the period's totals. */
export function stockItemInRange(item:StockItemOverview,filter:Pick<StockReportFilter,'fromDate'|'toDate'>){
  const batches=item.batches.filter(batch=>inRange(localDateKey(new Date(batch.arrivedAt)),filter));
  const uses=item.uses.filter(use=>inRange(use.usedOn,filter));
  const received=round3(batches.filter(batch=>batch.recordStatus==='Active').reduce((sum,batch)=>sum+batch.quantity,0));
  const used=round3(uses.filter(use=>use.status==='Active').reduce((sum,use)=>sum+use.quantity,0));
  return {batches,uses,received,used};
}

/** Where a use came from, in words. Uses recorded by hand are the only kind until rules count loads. */
export const stockUseSource=(_use:StockUseRecord):string=>'By hand';

function batchRow(batch:StockBatch,unit:string,includePrices:boolean):StockReportBatchRow{
  const cancelled=batch.recordStatus==='Cancelled';
  const row:StockReportBatchRow={
    batchNumber:batch.batchNumber,date:fuelDayLabel(localDateKey(new Date(batch.arrivedAt))),supplier:batch.supplierName??'No supplier',invoice:batch.invoiceNumber??'Not recorded',
    quantity:formatStockQuantity(batch.quantity,unit),used:cancelled?'—':formatStockQuantity(batch.usedQuantity,unit),remaining:cancelled?'—':formatStockQuantity(batch.remainingQuantity,unit),status:stockStatusLabels[batch.status],
  };
  if(includePrices){
    row.price=stockPriceText(batch,unit);
    row.amount=batch.totalUsd==null?'Unpriced':`${formatUsd(batch.totalUsd)}${batch.vatRatePercent?` incl. VAT ${batch.vatRatePercent}%`:''}`;
  }
  return row;
}

function useRow(use:StockUseRecord,unit:string):StockReportUseRow{
  return {
    date:fuelDayLabel(use.usedOn),source:stockUseSource(use),batches:use.lines.map(line=>`${line.batchNumber} ${formatStockQuantity(line.quantity,unit)}`).join(', ')||'—',
    quantity:formatStockQuantity(use.quantity,unit),status:use.status==='Cancelled'?`Cancelled: ${use.cancellationReason??''}`.trim():'Counted',note:use.note??'',
  };
}

export function buildStockReport(overview:StockOverview,filter:StockReportFilter,exportedAt=new Date().toISOString()):StockReport{
  const chosen=filter.itemId?overview.items.filter(item=>item.itemId===filter.itemId):overview.items;
  const isSingle=Boolean(filter.itemId);
  const items=chosen.map((item):StockReportItem=>{
    const scoped=stockItemInRange(item,filter);
    const cancelledBatches=scoped.batches.filter(batch=>batch.recordStatus==='Cancelled').length,cancelledUses=scoped.uses.filter(use=>use.status==='Cancelled').length;
    return {
      itemId:item.itemId,name:item.itemName,unit:item.unitSymbol,received:formatStockQuantity(scoped.received,item.unitSymbol),used:formatStockQuantity(scoped.used,item.unitSymbol),
      onHand:formatStockQuantity(item.totalRemaining,item.unitSymbol),openBatches:item.batches.filter(isOpenStockBatch).length,
      batches:scoped.batches.map(batch=>batchRow(batch,item.unitSymbol,filter.includePrices)),uses:scoped.uses.map(use=>useRow(use,item.unitSymbol)),
      cancelledNote:cancelledBatches||cancelledUses?`${cancelledBatches?`${cancelledBatches} cancelled batch${cancelledBatches===1?'':'es'}`:''}${cancelledBatches&&cancelledUses?' and ':''}${cancelledUses?`${cancelledUses} cancelled use${cancelledUses===1?'':'s'}`:''} listed, not counted.`:null,
    };
  });
  const rangeLabel=stockRangeLabel(filter);
  const name=isSingle?items[0]?.name??'Item':'All Stock';
  const from=filter.fromDate??'start',to=filter.toDate??localDateKey(new Date(exportedAt));
  return {
    title:isSingle?'Stock Report':'Stock Summary',scopeLabel:name,rangeLabel,pricesIncluded:filter.includePrices,exportedAt,isSingle,items,
    summary:items.map(item=>({item:item.name,unit:item.unit,received:item.received,used:item.used,onHand:item.onHand,openBatches:item.openBatches})),
    empty:items.length===0,fileName:`DROMEX-Stock-${isSingle?`Report-${safe(name)}`:'Summary'}-${from}-to-${to}.pdf`,
  };
}

export type StockPeriod='all'|'week'|'month'|'custom';
const two=(value:number)=>String(value).padStart(2,'0');
const dayKey=(date:Date)=>`${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}`;
/** All dates, this week (Monday to Sunday), this month, or exactly the dates chosen on the calendar (swapped if reversed; either may be left open). */
export function stockRangeFor(period:StockPeriod,today:string,custom?:{fromDate?:string;toDate?:string}):Pick<StockReportFilter,'fromDate'|'toDate'>{
  const [year=0,month=1,day=1]=today.split('-').map(Number),now=new Date(year,month-1,day);
  if(period==='week'){const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-((now.getDay()+6)%7));const sunday=new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+6);return{fromDate:dayKey(monday),toDate:dayKey(sunday)};}
  if(period==='month')return{fromDate:dayKey(new Date(now.getFullYear(),now.getMonth(),1)),toDate:dayKey(new Date(now.getFullYear(),now.getMonth()+1,0))};
  if(period==='custom'){const from=custom?.fromDate||undefined,to=custom?.toDate||undefined;return from&&to&&from>to?{fromDate:to,toDate:from}:{fromDate:from,toDate:to};}
  return{};
}
