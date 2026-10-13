import {localDateKey} from './fuel';
import type {BitumenAdjustment,BitumenUseRow} from './bitumenUse';

/**
 * Bitumen batches (Phase B). A batch is one delivery of bitumen, tracked in kilograms. Phase B records deliveries, lists the batches,
 * lets the owner choose the batch in use, and handles correction and cancellation; the asphalt rule and the automatic use come in a
 * later phase, so for now nothing has been used and a batch's remaining kg equals what was delivered plus any adjustment.
 *
 * Everything here is pure; the repository decides what to load and what to persist.
 */
export type BitumenPriceBasis='per_ton'|'per_kg'|'whole';
export type BitumenBatchStatus='in_use'|'waiting'|'closed'|'cancelled';
export type BitumenRecordStatus='Active'|'Cancelled';

export type BitumenGrade={id:string;name:string;isActive:boolean};
export type BitumenSupplier={id:string;name:string};
export type BitumenSetup={suppliers:BitumenSupplier[];grades:BitumenGrade[];vatRatePercent:number};

/** What the Record delivery form sends. Quantity and price are text so the form can show what was typed. */
export type BitumenDeliveryDraft={recordDate:string;supplierId:string;invoiceNumber:string;ticketNumber:string;gradeId:string;kg:string;priceBasis:BitumenPriceBasis;price:string;vat:boolean;notes:string};
export type BitumenEditDraft=BitumenDeliveryDraft&{reason:string};
export const emptyBitumenDelivery:BitumenDeliveryDraft={recordDate:localDateKey(new Date()),supplierId:'',invoiceNumber:'',ticketNumber:'',gradeId:'',kg:'',priceBasis:'per_ton',price:'',vat:false,notes:''};

export type BitumenCorrectionEntry={at:string;reason:string;changes:{field:string;before:string;after:string}[]};

export type BitumenBatch={
  id:string;batchNumber:string;arrivedAt:string;
  supplierId:string|null;supplierName:string|null;gradeId:string|null;gradeName:string;
  invoiceNumber:string|null;ticketNumber:string|null;notes:string|null;
  deliveredKg:number;usedKg:number;adjustmentKg:number;remainingKg:number;
  priceBasis:BitumenPriceBasis|null;priceUsd:number|null;vatRatePercent:number|null;subtotalUsd:number|null;totalUsd:number|null;
  /** The recorded price expressed per ton whatever basis it was entered in; null for a whole-batch price or Unpriced. */
  pricePerTonUsd:number|null;
  priced:boolean;
  status:BitumenBatchStatus;recordStatus:BitumenRecordStatus;
  cancellationReason:string|null;cancelledAt:string|null;correctionHistory:BitumenCorrectionEntry[];createdAt:string;
};
export type BitumenOverview={
  /** The open batch the owner chose to use first, or null when the oldest open batch is the one in use. */
  usingBatchId:string|null;
  totalRemainingKg:number;
  batches:BitumenBatch[];
  /** Every use row (uses, reversals, corrections and moves) and the owner's adjustments; empty until asphalt rules are used. */
  useRows?:BitumenUseRow[];
  adjustments?:BitumenAdjustment[];
  /** How many asphalt items are ticked. When it is above zero the figures are estimates and are labelled so. */
  rulesEnabled?:number;
};

export const bitumenStatusLabels:Record<BitumenBatchStatus,string>={in_use:'Open · In use',waiting:'Open · Waiting',closed:'Closed',cancelled:'Cancelled'};
export const priceBasisLabels:Record<BitumenPriceBasis,string>={per_ton:'Per ton',per_kg:'Per kg',whole:'As a whole'};
export const BIT_EPSILON=0.0005;

const round2=(value:number)=>Math.round(value*100)/100;
const round3=(value:number)=>Math.round(value*1000)/1000;
const decimal=(value:string)=>Number(value.trim().replace(',','.'));
const decimalFormat=(value:string)=>/^\d+([.,]\d+)?$/.test(value.trim());

export function formatBitumenBatchNumber(year:number,sequence:number):string{return `BIT-${year}-${String(sequence).padStart(5,'0')}`;}
export function validatePositiveKg(value:string):number{const parsed=decimal(value);if(!decimalFormat(value)||!Number.isFinite(parsed)||parsed<=0)throw new Error('Quantity must be a number of kg greater than zero.');return round3(parsed);}
export function validateBitumenPrice(value:string):number|null{
  if(!value.trim())return null;
  const parsed=decimal(value);
  if(!Number.isFinite(parsed)||parsed<0||!/^\d+([.,]\d{1,2})?$/.test(value.trim()))throw new Error('Price must be zero or greater with no more than two decimals.');
  return parsed;
}
export const formatKg=(kg:number)=>`${kg.toLocaleString('en-US',{maximumFractionDigits:3})} kg`;
export const formatTons=(kg:number)=>`${(kg/1000).toLocaleString('en-US',{maximumFractionDigits:3})} t`;
export const formatUsd=(value:number)=>`$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export const priceText=(batch:Pick<BitumenBatch,'priceBasis'|'priceUsd'>)=>batch.priceUsd==null||!batch.priceBasis?'Unpriced':batch.priceBasis==='whole'?`${formatUsd(batch.priceUsd)} as a whole`:`${formatUsd(batch.priceUsd)} / ${batch.priceBasis==='per_ton'?'t':'kg'}`;

/**
 * Subtotal, VAT and total of a delivery. The price is per ton, per kg or for the whole batch. No price means Unpriced: the amounts are
 * null and are never treated as zero. VAT is applied only when the form asked for it.
 */
export function calculateBitumenPrice(kg:number,basis:BitumenPriceBasis,priceText:string,vatRatePercent:number):{priceUsd:number|null;subtotalUsd:number|null;vatAmountUsd:number|null;totalUsd:number|null;pricePerTonUsd:number|null}{
  const price=validateBitumenPrice(priceText);
  if(price==null)return {priceUsd:null,subtotalUsd:null,vatAmountUsd:null,totalUsd:null,pricePerTonUsd:null};
  const subtotal=round2(basis==='per_ton'?kg/1000*price:basis==='per_kg'?kg*price:price);
  const vat=round2(subtotal*vatRatePercent/100);
  const perTon=basis==='per_ton'?price:basis==='per_kg'?round2(price*1000):null;
  return {priceUsd:price,subtotalUsd:subtotal,vatAmountUsd:vat,totalUsd:round2(subtotal+vat),pricePerTonUsd:perTon};
}

/** The same figures as above for a form that is being filled in: null while the quantity or price is not yet valid. */
export function previewBitumenPrice(draft:Pick<BitumenDeliveryDraft,'kg'|'priceBasis'|'price'|'vat'>,vatRatePercent:number){
  try{return calculateBitumenPrice(validatePositiveKg(draft.kg),draft.priceBasis,draft.price,draft.vat?vatRatePercent:0);}catch{return null;}
}

/**
 * Sets each batch's status and the overview totals. Active batches are open while they have bitumen left; the first open one (by
 * arrival, then number) is in use. A batch that was cancelled is kept and labelled Cancelled. Phase B has no use yet, so the used
 * figure is always passed in as 0 by the repository.
 */
export function buildBitumenOverview(batches:Omit<BitumenBatch,'status'|'remainingKg'>[],usingBatchId:string|null):BitumenOverview{
  const sorted=[...batches].sort((a,b)=>a.arrivedAt.localeCompare(b.arrivedAt)||a.batchNumber.localeCompare(b.batchNumber));
  const withRemaining=sorted.map(batch=>({...batch,remainingKg:round3(batch.deliveredKg+batch.adjustmentKg-batch.usedKg)}));
  const isOpen=(batch:{recordStatus:BitumenRecordStatus;remainingKg:number})=>batch.recordStatus==='Active'&&batch.remainingKg>BIT_EPSILON;
  const first=withRemaining.find(isOpen);
  let list:BitumenBatch[]=withRemaining.map(batch=>({...batch,status:batch.recordStatus==='Cancelled'?'cancelled':!isOpen(batch)?'closed':batch===first?'in_use':'waiting'}));
  // The owner's choice is honoured only while that batch is still open; otherwise the oldest open batch is in use.
  const chosen=usingBatchId?list.find(batch=>batch.id===usingBatchId&&(batch.status==='in_use'||batch.status==='waiting')):undefined;
  let effective:string|null=null;
  if(chosen){
    effective=chosen.id;
    list=list.map(batch=>batch.id===chosen.id?{...batch,status:'in_use' as const}:batch.status==='in_use'?{...batch,status:'waiting' as const}:batch);
    const moved=list.find(batch=>batch.id===chosen.id)!;
    const without=list.filter(batch=>batch.id!==chosen.id);
    const at=without.findIndex(batch=>batch.status==='waiting'||batch.status==='in_use');
    list=at<0?[...without,moved]:[...without.slice(0,at),moved,...without.slice(at)];
  }
  const totalRemainingKg=round3(list.filter(batch=>batch.status==='in_use'||batch.status==='waiting').reduce((sum,batch)=>sum+batch.remainingKg,0));
  return {usingBatchId:effective,totalRemainingKg,batches:list};
}

/** The line on the Home card: the batch in use and what is left. */
export function bitumenHomeBadge(overview:BitumenOverview):string|null{
  const using=overview.batches.find(batch=>batch.status==='in_use');
  return using?`${using.batchNumber} in use`:null;
}

export const isOpenBatch=(batch:Pick<BitumenBatch,'status'>)=>batch.status==='in_use'||batch.status==='waiting';

export type SupplierBitumenRow={batchId:string;batchNumber:string;gradeName:string;day:string;kg:number;invoiceNumber:string|null;pricePerTonUsd:number|null;priceLabel:string;priced:boolean;totalUsd:number|null};
export type SupplierBitumenSummary={supplierId:string;batchCount:number;totalKg:number;pricedAmountUsd:number|null;unpricedNote:string|null;cancelledCount:number;rows:SupplierBitumenRow[]};

/**
 * What one supplier delivered in bitumen. Kilograms only: never added to tons, litres or any material quantity. A priced batch adds its
 * recorded total (with VAT where it was applied) to the amount; an unpriced batch is counted and listed as Unpriced and never treated
 * as zero. A cancelled batch is not counted.
 */
export function supplierBitumenDeliveries(batches:readonly BitumenBatch[],supplierId:string):SupplierBitumenSummary{
  const own=batches.filter(batch=>batch.supplierId===supplierId);
  const active=own.filter(batch=>batch.recordStatus==='Active');
  const rows=[...active].sort((a,b)=>b.arrivedAt.localeCompare(a.arrivedAt)||b.batchNumber.localeCompare(a.batchNumber)).map((batch):SupplierBitumenRow=>({
    batchId:batch.id,batchNumber:batch.batchNumber,gradeName:batch.gradeName,day:localDateKey(batch.arrivedAt),kg:batch.deliveredKg,invoiceNumber:batch.invoiceNumber,
    pricePerTonUsd:batch.pricePerTonUsd,priceLabel:priceText(batch),priced:batch.priced,totalUsd:batch.totalUsd,
  }));
  const pricedRows=rows.filter(row=>row.priced&&row.totalUsd!=null);
  const unpriced=rows.length-pricedRows.length;
  return {
    supplierId,batchCount:rows.length,totalKg:round3(rows.reduce((sum,row)=>sum+row.kg,0)),
    pricedAmountUsd:pricedRows.length?round2(pricedRows.reduce((sum,row)=>sum+(row.totalUsd??0),0)):null,
    unpricedNote:unpriced?`${unpriced} Unpriced`:null,cancelledCount:own.length-active.length,rows,
  };
}
