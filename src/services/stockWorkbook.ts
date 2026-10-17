import type {WorkbookRow} from '../domain/businessReports';
import {localDateKey} from '../domain/fuel';
import {stockItemInRange,stockRangeLabel,stockUseSource,type StockReportFilter} from '../domain/stockReport';
import {stockStatusLabels,isOpenStockBatch,type StockOverview} from '../domain/stock';
import {buildWorkbookFromSheets,type SheetSpec} from './businessWorkbook';

/**
 * The Stock workbook: the same facts as the Stock Report, as Excel sheets with stable identifiers, numeric quantity columns and a data
 * dictionary. One sheet of Stock totals, one of batches, one of uses. Quantities stay numbers in their own unit and are never added across
 * items. Prices and VAT columns are only present when prices are included. It reads records and changes none.
 */
const round3=(value:number)=>Math.round(value*1000)/1000;

export function stockWorkbookSheets(overview:StockOverview,filter:StockReportFilter,company:{name:string},exportedAt=new Date().toISOString()):SheetSpec[]{
  const items=filter.itemId?overview.items.filter(item=>item.itemId===filter.itemId):overview.items;
  const summary:WorkbookRow[]=[],batches:WorkbookRow[]=[],uses:WorkbookRow[]=[];
  for(const item of items){
    const scoped=stockItemInRange(item,filter);
    summary.push({'Item ID':item.itemId,Item:item.itemName,Unit:item.unitSymbol,'Received (Period)':scoped.received,'Used (Period)':scoped.used,'On Hand Now':item.totalRemaining,'Open Batches':item.batches.filter(isOpenStockBatch).length});
    for(const batch of scoped.batches){
      const cancelled=batch.recordStatus==='Cancelled';
      const row:WorkbookRow={'Batch ID':batch.id,'Batch Number':batch.batchNumber,'Item ID':item.itemId,Item:item.itemName,Unit:item.unitSymbol,'Date Received':localDateKey(new Date(batch.arrivedAt)),'Supplier ID':batch.supplierId??'',Supplier:batch.supplierName??'','Invoice Number':batch.invoiceNumber??'',Quantity:batch.quantity,'Used To Date':cancelled?null:batch.usedQuantity,Remaining:cancelled?null:batch.remainingQuantity,Status:stockStatusLabels[batch.status],'Cancellation Reason':batch.cancellationReason??'',Notes:batch.notes??''};
      row['Closed On']=batch.closure?.closedOn??'';row['Left Over When Closed']=batch.closure?batch.closure.leftover:null;row['Closing Reason']=batch.closure?.reason??'';
      if(filter.includePrices){row['Price Basis']=batch.priceBasis??'';row['Price USD']=batch.priceUsd;row['VAT %']=batch.vatRatePercent;row['Subtotal USD']=batch.subtotalUsd;row['Total USD']=batch.totalUsd;}
      batches.push(row);
    }
    for(const use of scoped.uses)uses.push({'Use ID':use.groupId,Date:use.usedOn,'Item ID':item.itemId,Item:item.itemName,Unit:item.unitSymbol,Quantity:round3(use.quantity),Source:use.source==='load'?'Load':'By hand','Load Number':use.loadNumber,'Load Quantity':use.loadQuantity,'Load Unit':use.loadUnit,'Rule Amount':use.ruleAmount,'Rule Per Quantity':use.rulePerQuantity,'Source Detail':stockUseSource(use),'Adjusted Reason':use.adjustedReason??'',Batches:use.lines.map(line=>`${line.batchNumber}: ${line.quantity}`).join('; '),Status:use.status==='Cancelled'?'Cancelled':'Counted','Cancellation Reason':use.cancellationReason??'',Note:use.note??''});
  }
  const dictionary:WorkbookRow[]=[
    {Sheet:'Stock Summary',Column:'Received (Period)',Meaning:'Quantity of the batches that arrived in the period, in the item\'s own unit. Cancelled batches are not counted.'},
    {Sheet:'Stock Summary',Column:'Used (Period)',Meaning:'Quantity of the uses dated in the period. Cancelled uses are not counted.'},
    {Sheet:'Stock Summary',Column:'On Hand Now',Meaning:'What is left now in the open batches, whatever the period.'},
    {Sheet:'Batches',Column:'Used To Date / Remaining',Meaning:'The batch\'s own figures to date; empty for a cancelled batch.'},
    {Sheet:'Batches',Column:'Closed On / Left Over When Closed / Closing Reason',Meaning:'Only for a batch the Owner closed by hand while some was left: the day, what was left, in the unit of the item, and why. Empty for a batch that closed by itself or is still open.'},
    {Sheet:'Batches',Column:'Price USD / VAT % / Total USD',Meaning:'Only with prices included. Empty means Unpriced, never zero. VAT is present only where the batch was saved with VAT.'},
    {Sheet:'Uses',Column:'Quantity',Meaning:'The whole use in the item\'s unit; Batches shows how it was split across batches, oldest first.'},
    {Sheet:'Uses',Column:'Source',Meaning:'By hand, or Load: counted from a confirmed load by a usage rule. Source Detail says which load and the rate it used.'},
    {Sheet:'Uses',Column:'Load Quantity / Rule Amount / Rule Per Quantity',Meaning:'For a use from a load: the quantity of the load, and the amount of this material the rule takes for each Rule Per Quantity of it, as it was when the load was counted.'},
    {Sheet:'All sheets',Column:'Unit',Meaning:'Every item keeps its own unit. Quantities of different items are never added together.'},
  ];
  const info:WorkbookRow[]=[{Metric:'Report',Value:filter.itemId?'Stock Report':'Stock Summary'},{Metric:'Company',Value:company.name},{Metric:'Scope',Value:filter.itemId?items[0]?.itemName??'Item':'All Stock'},{Metric:'Period',Value:stockRangeLabel(filter)},{Metric:'Prices',Value:filter.includePrices?'Included':'Excluded'},{Metric:'Exported At',Value:exportedAt}];
  return [{name:'Report Info',rows:info},{name:'Stock Summary',rows:summary},{name:'Batches',rows:batches},{name:'Uses',rows:uses},{name:'Data Dictionary',rows:dictionary}];
}

export const buildStockWorkbook=(overview:StockOverview,filter:StockReportFilter,company:{name:string},exportedAt?:string):Uint8Array=>buildWorkbookFromSheets(stockWorkbookSheets(overview,filter,company,exportedAt));
