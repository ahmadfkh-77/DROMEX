import {fuelDayLabel} from './fuelBatchViews';
import {localDateKey} from './fuel';
import {bitumenStatusLabels,formatKg,formatTons,formatUsd,priceBasisLabels,type BitumenBatch} from './bitumen';
import {fillCostLabel,fillDestinationTotals,fillRowsForBatch,cancelledFillNote,groupFillsByDay,destinationTypeLabel,fillTimeText,type FillRow} from './bitumenFillViews';
import {fillCost,type BitumenFill} from './bitumenFills';
import {groupUseByDay,loadsText,mixMadeForLines,useLinesForBatch,type BitumenAdjustment,type BitumenUseRow} from './bitumenUse';

/**
 * The Bitumen Batch Report: one batch, one A4 page. The facts of the batch, its figures in kg with tons beside them, the delivery
 * detail (the weighbridge ticket only when it was filled in), the price when prices are included, and the batch's history, including
 * every correction with its reason and a cancellation with its reason. All text is prepared here so the template only lays it out.
 * Kilograms, tons and money are never added together.
 */
export type BitumenReportFigure={label:string;kg:string;tons:string;strong:boolean};
export type BitumenReportHistoryRow={date:string;event:string;kg:string};
/** DEC-542. One day of the use section: the day's loads, newest first, with the day's own totals. */
export type BitumenReportUseDay={date:string;count:number;mix:string;kg:string;rows:BitumenReportUseRow[]};
export type BitumenReportUseRow={date:string;time:string;load:string;item:string;mix:string;rule:string;kg:string};
export type BitumenReportAdjustmentRow={date:string;reason:string;kg:string};
/** DEC-557. One fill of the fills section: this batch's part of it. `cost` is null when prices are not included. */
export type BitumenReportFillRow={time:string;truck:string;destination:string;layer:string|null;ticket:string;kg:string;cost:string|null;cancelled:boolean;note:string|null;split:string|null};
export type BitumenReportFillDay={date:string;count:number;kg:string;cost:string|null;rows:BitumenReportFillRow[]};
export type BitumenReportFills={byDestination:{name:string;count:number;kg:string;cost:string|null}[];days:BitumenReportFillDay[];fillCount:number;dayCount:number;cancelledCount:number;total:string;totalCost:string|null};
export type BitumenBatchReport={
  batchNumber:string;
  exportedAt:string;
  cancelled:boolean;
  summary:{label:string;value:string}[];
  /** True when the batch's use is estimated from asphalt rules; the figures and the section say so. */
  estimated:boolean;
  figures:BitumenReportFigure[];
  /** The loads that took bitumen from this batch (a cancelled load nets to zero and is not listed); null when there is no use. */
  use:null|{rows:BitumenReportUseRow[];days:BitumenReportUseDay[];dayCount:number;total:string;/** DEC-527. The tons of asphalt mix behind the counted loads, and how many loads. */mixTotal:string;loadCount:number};
  adjustments:null|{rows:BitumenReportAdjustmentRow[]};
  /** DEC-557. The fills taken from this batch, placed before the asphalt use; null when the batch has no fill. */
  fills:BitumenReportFills|null;
  detail:{headers:string[];values:string[]};
  /** Present only when prices are included. */
  price:null|{headers:string[];values:string[];lines:{label:string;value:string;strong:boolean}[]};
  cancellation:null|{when:string;reason:string};
  /** Set while the batch is closed by hand: the day, what was left over and why. */
  closure:null|{closedOn:string;leftover:string;reason:string};
  history:BitumenReportHistoryRow[];
  remainingLabel:string;
  pricesIncluded:boolean;
  fileName:string;
};

const signed=(kg:number)=>`${kg>0?'+':kg<0?'−':''}${Math.abs(kg).toLocaleString('en-US',{maximumFractionDigits:3})}`;
const stamp=(iso:string)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?iso:`${fuelDayLabel(localDateKey(date))}, ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};

export function buildBitumenBatchReport(batch:BitumenBatch,options:{includePrices:boolean;exportedAt?:string;/** Use rows and adjustments of the whole overview; only this batch's are read. */useRows?:readonly BitumenUseRow[];adjustments?:readonly BitumenAdjustment[];/** DEC-557. Every fill of the overview; only this batch's are read. */fills?:readonly BitumenFill[];estimated?:boolean}):BitumenBatchReport{
  const cancelled=batch.recordStatus==='Cancelled';
  const exportedAt=options.exportedAt??new Date().toISOString();
  const remaining=cancelled?0:batch.remainingKg;
  const lines=options.useRows?useLinesForBatch(options.useRows,batch.id):[];
  const mix=mixMadeForLines(lines);
  const adjustmentRows=(options.adjustments??[]).filter(value=>value.batchId===batch.id);
  const estimated=Boolean(options.estimated)||lines.length>0||adjustmentRows.length>0;
  const fillRows=options.fills?fillRowsForBatch(options.fills,batch.id):[];
  const hasFills=fillRows.length>0;
  const figures:BitumenReportFigure[]=[
    {label:'Delivered',kg:formatKg(batch.deliveredKg),tons:cancelled?'not counted':formatTons(batch.deliveredKg),strong:false},
    ...(hasFills?[{label:'Taken by fills',kg:formatKg(batch.filledKg??0),tons:formatTons(batch.filledKg??0),strong:false}]:[]),
    {label:hasFills?(estimated?'Est. used by asphalt loads':'Used by asphalt loads'):estimated?'Est. used':'Used',kg:formatKg(batch.usedKg),tons:estimated&&lines.length?`from ${lines.length} asphalt load${lines.length===1?'':'s'} · ${formatTons(mix.mixKg)} of mix`:formatTons(batch.usedKg),strong:false},
    {label:'Adjustments',kg:formatKg(batch.adjustmentKg),tons:adjustmentRows.length?`${adjustmentRows.length} adjustment${adjustmentRows.length===1?'':'s'}`:formatTons(batch.adjustmentKg),strong:false},
    {label:estimated?'Est. remaining':'Remaining',kg:formatKg(remaining),tons:cancelled?'cancelled':formatTons(remaining),strong:!cancelled},
  ];
  const dayText=(iso:string)=>fuelDayLabel(localDateKey(new Date(iso)));
  const timeText=(iso:string)=>{const date=new Date(iso);return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};
  const ruleOf=(line:{ruleAggregateKg:number;ruleBitumenKg:number})=>`${line.ruleBitumenKg.toLocaleString('en-US',{maximumFractionDigits:3})} kg per ${(line.ruleAggregateKg/1000).toLocaleString('en-US',{maximumFractionDigits:3})} t`;
  const useRow=(line:(typeof lines)[number])=>({date:dayText(line.loadConfirmedAt),time:timeText(line.loadConfirmedAt),load:line.loadNumber??'Load',item:line.itemName,mix:formatTons(line.mixKg),rule:ruleOf(line),kg:formatKg(line.kg)});
  const dayGroups=groupUseByDay(lines,'');
  const fills=hasFills?buildFillsSection(fillRows,options.includePrices):null;
  const use=lines.length?{
    rows:lines.map(useRow),
    days:dayGroups.map(group=>({date:fuelDayLabel(group.day),count:group.count,mix:formatTons(group.mixKg),kg:formatKg(group.bitumenKg),rows:group.lines.map(useRow)})),
    dayCount:dayGroups.length,
    total:formatKg(lines.reduce((sum,line)=>sum+line.kg,0)),
    mixTotal:formatTons(mix.mixKg),loadCount:mix.loads,
  }:null;
  const adjustments=adjustmentRows.length?{rows:adjustmentRows.map(value=>({date:dayText(value.createdAt),reason:value.reason,kg:`${value.kg>0?'+':value.kg<0?'−':''}${Math.abs(value.kg).toLocaleString('en-US',{maximumFractionDigits:3})}`}))}:null;
  // The weighbridge ticket is a column only when it was filled in; so is nothing else that is empty and optional.
  const detailHeaders=['Supplier','Invoice no.',...(batch.ticketNumber?['Weighbridge ticket']:[]),'Recorded'];
  const detailValues=[batch.supplierName??'Not recorded',batch.invoiceNumber??'Not recorded',...(batch.ticketNumber?[batch.ticketNumber]:[]),stamp(batch.createdAt)];
  const price=!options.includePrices?null:{
    headers:['Price basis','Price','Per kg','Per ton'],
    values:batch.priceUsd==null||!batch.priceBasis?['Unpriced','Unpriced','Unpriced','Unpriced']:[
      priceBasisLabels[batch.priceBasis],batch.priceBasis==='whole'?`${formatUsd(batch.priceUsd)} as a whole`:`${formatUsd(batch.priceUsd)} / ${batch.priceBasis==='per_ton'?'t':'kg'}`,
      batch.pricePerTonUsd==null?'—':formatUsd(batch.pricePerTonUsd/1000),batch.pricePerTonUsd==null?'—':formatUsd(batch.pricePerTonUsd),
    ],
    lines:batch.subtotalUsd==null||batch.totalUsd==null?[{label:'Total',value:'Unpriced',strong:true}]:[
      {label:batch.priceBasis==='per_ton'?`Subtotal (${formatTons(batch.deliveredKg)} × ${formatUsd(batch.priceUsd??0)})`:'Subtotal',value:formatUsd(batch.subtotalUsd),strong:false},
      {label:batch.vatRatePercent?`VAT ${batch.vatRatePercent}%`:'VAT',value:batch.vatRatePercent?formatUsd(Math.round((batch.totalUsd-batch.subtotalUsd)*100)/100):'None applied',strong:false},
      {label:'Total',value:formatUsd(batch.totalUsd),strong:true},
    ],
  };
  const history:BitumenReportHistoryRow[]=[{date:fuelDayLabel(localDateKey(new Date(batch.arrivedAt))),event:'Delivery received',kg:signed(batch.deliveredKg)}];
  for(const row of [...fillRows].sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt)||a.enteredAt.localeCompare(b.enteredAt))){
    history.push({date:fuelDayLabel(row.day),event:`Fill · Truck ${row.truckName} · ${row.destinationName}`,kg:signed(-row.kg)});
    if(row.cancelled)history.push({date:row.cancelledAt?dayText(row.cancelledAt):fuelDayLabel(row.day),event:`Fill cancelled · Truck ${row.truckName} · reason: ${row.cancellationReason??'Not recorded'}`,kg:signed(row.kg)});
  }
  for(const entry of batch.correctionHistory){
    history.push({date:fuelDayLabel(localDateKey(new Date(entry.at))),event:`Corrected: ${entry.changes.map(change=>`${change.field} ${change.before} → ${change.after}`).join('; ')} · reason: ${entry.reason}`,kg:''});
  }
  if(cancelled&&batch.cancelledAt)history.push({date:fuelDayLabel(localDateKey(new Date(batch.cancelledAt))),event:'Batch cancelled',kg:signed(-batch.deliveredKg)});
  for(const entry of batch.closureHistory??[]){
    history.push({date:fuelDayLabel(entry.closedOn),event:`Closed by hand with ${formatKg(entry.leftover)} left · reason: ${entry.reason}`,kg:''});
    if(entry.reopenedAt)history.push({date:fuelDayLabel(localDateKey(new Date(entry.reopenedAt))),event:`Reopened · reason: ${entry.reopenReason??''}`,kg:''});
  }
  return {
    batchNumber:batch.batchNumber,exportedAt,cancelled,
    summary:[
      {label:'Batch',value:batch.batchNumber},{label:'Supplier',value:batch.supplierName??'Not recorded'},{label:'Grade',value:batch.gradeName},
      {label:'Arrived',value:fuelDayLabel(localDateKey(new Date(batch.arrivedAt)))},{label:'Status',value:bitumenStatusLabels[batch.status]},
    ],
    estimated,figures,use,adjustments,fills,detail:{headers:detailHeaders,values:detailValues},price,
    cancellation:cancelled&&batch.cancelledAt?{when:stamp(batch.cancelledAt),reason:batch.cancellationReason??'Not recorded'}:null,
    closure:batch.closure?{closedOn:fuelDayLabel(batch.closure.closedOn),leftover:formatKg(batch.closure.leftover),reason:batch.closure.reason}:null,
    history,remainingLabel:formatKg(remaining),pricesIncluded:options.includePrices,
    fileName:`Bitumen-Batch-Report-${batch.batchNumber}.pdf`,
  };
}

const kgText=(kg:number)=>formatKg(kg);
/** The cost of a set of fill rows: priced kg at each batch's own price, an unpriced part said in words and never counted as zero. */
const costOf=(rows:readonly FillRow[])=>fillCostLabel(fillCost(rows.map(row=>({batchId:row.batchId,kg:row.kg,pricePerKgUsd:row.pricePerKgUsd}))));

/** DEC-557. The fills section: by destination, then by day (newest first). A cancelled fill is listed and never counted. */
function buildFillsSection(rows:readonly FillRow[],includePrices:boolean):BitumenReportFills{
  const active=rows.filter(row=>!row.cancelled);
  const days=groupFillsByDay(rows,'').map(day=>{
    const dayRows=day.groups.flatMap(group=>group.rows).sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt)||b.enteredAt.localeCompare(a.enteredAt));
    return {date:day.label,count:dayRows.filter(row=>!row.cancelled).length,kg:kgText(day.total),cost:includePrices?costOf(dayRows.filter(row=>!row.cancelled)):null,
      rows:dayRows.map((row):BitumenReportFillRow=>({time:fillTimeText(row.confirmedAt,row.enteredAt,row.day),truck:row.truckName,destination:row.destinationName,layer:row.layerNote,ticket:row.ticketNumber??'Not recorded',kg:kgText(row.kg),
        cost:includePrices?(row.cancelled?null:costOf([row])):null,cancelled:row.cancelled,note:cancelledFillNote(row),split:row.split?`part of a ${kgText(row.totalKg)} fill`:null}))};
  });
  const byDestination=fillDestinationTotals(rows).map(total=>({name:total.type==='unassigned'?'Unassigned':`${destinationTypeLabel[total.type]} · ${total.name}`,count:active.filter(row=>row.destinationKey===total.key).length,kg:kgText(total.kg),
    cost:includePrices?costOf(active.filter(row=>row.destinationKey===total.key)):null}));
  const totalKg=active.reduce((sum,row)=>sum+row.kg,0);
  return {byDestination,days,fillCount:active.length,dayCount:days.length,cancelledCount:rows.length-active.length,total:kgText(Math.round(totalKg*1000)/1000),totalCost:includePrices?costOf(active):null};
}
