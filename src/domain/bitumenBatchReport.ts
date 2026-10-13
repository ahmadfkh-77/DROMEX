import {fuelDayLabel} from './fuelBatchViews';
import {localDateKey} from './fuel';
import {bitumenStatusLabels,formatKg,formatTons,formatUsd,priceBasisLabels,type BitumenBatch} from './bitumen';

/**
 * The Bitumen Batch Report: one batch, one A4 page. The facts of the batch, its figures in kg with tons beside them, the delivery
 * detail (the weighbridge ticket only when it was filled in), the price when prices are included, and the batch's history, including
 * every correction with its reason and a cancellation with its reason. All text is prepared here so the template only lays it out.
 * Kilograms, tons and money are never added together.
 */
export type BitumenReportFigure={label:string;kg:string;tons:string;strong:boolean};
export type BitumenReportHistoryRow={date:string;event:string;kg:string};
export type BitumenBatchReport={
  batchNumber:string;
  exportedAt:string;
  cancelled:boolean;
  summary:{label:string;value:string}[];
  figures:BitumenReportFigure[];
  detail:{headers:string[];values:string[]};
  /** Present only when prices are included. */
  price:null|{headers:string[];values:string[];lines:{label:string;value:string;strong:boolean}[]};
  cancellation:null|{when:string;reason:string};
  history:BitumenReportHistoryRow[];
  remainingLabel:string;
  pricesIncluded:boolean;
  fileName:string;
};

const signed=(kg:number)=>`${kg>0?'+':kg<0?'−':''}${Math.abs(kg).toLocaleString('en-US',{maximumFractionDigits:3})}`;
const stamp=(iso:string)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?iso:`${fuelDayLabel(localDateKey(date))}, ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};

export function buildBitumenBatchReport(batch:BitumenBatch,options:{includePrices:boolean;exportedAt?:string}):BitumenBatchReport{
  const cancelled=batch.recordStatus==='Cancelled';
  const exportedAt=options.exportedAt??new Date().toISOString();
  const remaining=cancelled?0:batch.remainingKg;
  const figures:BitumenReportFigure[]=[
    {label:'Delivered',kg:formatKg(batch.deliveredKg),tons:cancelled?'not counted':formatTons(batch.deliveredKg),strong:false},
    {label:'Used',kg:formatKg(batch.usedKg),tons:formatTons(batch.usedKg),strong:false},
    {label:'Adjustments',kg:formatKg(batch.adjustmentKg),tons:formatTons(batch.adjustmentKg),strong:false},
    {label:'Remaining',kg:formatKg(remaining),tons:cancelled?'cancelled':formatTons(remaining),strong:!cancelled},
  ];
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
  for(const entry of batch.correctionHistory){
    history.push({date:fuelDayLabel(localDateKey(new Date(entry.at))),event:`Corrected: ${entry.changes.map(change=>`${change.field} ${change.before} → ${change.after}`).join('; ')} · reason: ${entry.reason}`,kg:''});
  }
  if(cancelled&&batch.cancelledAt)history.push({date:fuelDayLabel(localDateKey(new Date(batch.cancelledAt))),event:'Batch cancelled',kg:signed(-batch.deliveredKg)});
  return {
    batchNumber:batch.batchNumber,exportedAt,cancelled,
    summary:[
      {label:'Batch',value:batch.batchNumber},{label:'Supplier',value:batch.supplierName??'Not recorded'},{label:'Grade',value:batch.gradeName},
      {label:'Arrived',value:fuelDayLabel(localDateKey(new Date(batch.arrivedAt)))},{label:'Status',value:bitumenStatusLabels[batch.status]},
    ],
    figures,detail:{headers:detailHeaders,values:detailValues},price,
    cancellation:cancelled&&batch.cancelledAt?{when:stamp(batch.cancelledAt),reason:batch.cancellationReason??'Not recorded'}:null,
    history,remainingLabel:formatKg(remaining),pricesIncluded:options.includePrices,
    fileName:`Bitumen-Batch-Report-${batch.batchNumber}.pdf`,
  };
}
