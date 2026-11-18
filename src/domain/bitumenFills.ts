/**
 * DEC-557. Bitumen fills: bitumen taken from a batch straight into a truck, measured in kg.
 *
 * A fill takes from the batch the Owner chose to use first, then the oldest open batch, and splits across batches when one runs out.
 * Unlike diesel, the split is decided once, when the fill is saved, and stored as portions: it is never recalculated, so a later change
 * to asphalt-load use can never move a fill. A fill is cancelled with a reason and stays on record; a cancelled fill is simply not
 * counted, which returns its kg to the batch.
 *
 * Everything here is pure; the repository loads the batches and saves the portions this module plans.
 */
export type FillRecordStatus='Active'|'Cancelled';

/** A batch as a fill sees it. `remainingKg` already has adjustments, active fills and estimated asphalt use taken off. */
export type FillBatch={id:string;batchNumber:string;arrivedDay:string;/** Not cancelled. */active:boolean;/** Closed by hand now, or out of bitumen. */closed:boolean;remainingKg:number;/** The batch price per kg, or null when the batch is Unpriced. */pricePerKgUsd:number|null};

export type FillIssue='invalid_quantity'|'future_date'|'before_arrival'|'batch_not_open'|'over_limit';
export type FillPortionPlan={batchId:string;batchNumber:string;kg:number;pricePerKgUsd:number|null;closesBatch:boolean;remainingAfterKg:number};
export type FillCost={costUsd:number|null;pricedKg:number;unpricedKg:number;fullyPriced:boolean};
export type FillPlan={portions:FillPortionPlan[];totalKg:number;/** What the open batches cannot cover. Zero unless the issue is over_limit. */overByKg:number;cost:FillCost;issue:FillIssue|null};

export const FILL_EPSILON=0.0005;
const round2=(value:number)=>Math.round(value*100)/100;
const round3=(value:number)=>Math.round(value*1000)/1000;

/** What a batch has left: delivered, adjusted by real-amount counts, less active fills, less the estimated use from asphalt loads. */
export const batchRemainingKg=(batch:{deliveredKg:number;adjustmentKg:number;filledKg:number;usedKg:number})=>round3(batch.deliveredKg+batch.adjustmentKg-batch.filledKg-batch.usedKg);

/**
 * The cost of a fill from its portions, each at its own batch price. A portion from an Unpriced batch is counted as unpriced kg and is
 * never treated as zero cost.
 */
export function fillCost(portions:readonly {batchId:string;kg:number;pricePerKgUsd:number|null}[]):FillCost{
  let cost=0,priced=0,unpriced=0;
  for(const portion of portions){
    if(portion.pricePerKgUsd==null)unpriced+=portion.kg;
    else{cost+=portion.kg*portion.pricePerKgUsd;priced+=portion.kg;}
  }
  return {costUsd:priced>FILL_EPSILON?round2(cost):null,pricedKg:round3(priced),unpricedKg:round3(unpriced),fullyPriced:unpriced<=FILL_EPSILON&&priced>FILL_EPSILON};
}

export type PlanFillInput={batches:readonly FillBatch[];/** The batch the Owner chose to use first; also the batch picked on the form. */usingBatchId:string|null;kg:number;/** The fill date (local day). */day:string;today:string};

/**
 * What a fill would do, for the "Before you save" panel and for saving. Only open, active batches that had arrived by the fill date can
 * give bitumen. If they cannot cover the whole fill the result is `over_limit` with how much is missing, and the portions list what the
 * batches hold; nothing is guessed or hidden.
 */
export function planFill(input:PlanFillInput):FillPlan{
  const empty=(issue:FillIssue,overByKg=0):FillPlan=>({portions:[],totalKg:Number.isFinite(input.kg)?round3(input.kg):0,overByKg,cost:fillCost([]),issue});
  if(!Number.isFinite(input.kg)||input.kg<=FILL_EPSILON)return empty('invalid_quantity');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.day)||input.day>input.today)return empty('future_date');
  const kg=round3(input.kg);
  const open=[...input.batches].filter(batch=>batch.active&&!batch.closed&&batch.remainingKg>FILL_EPSILON).sort((a,b)=>a.arrivedDay.localeCompare(b.arrivedDay)||a.batchNumber.localeCompare(b.batchNumber));
  const chosen=input.usingBatchId?open.find(batch=>batch.id===input.usingBatchId):undefined;
  if(input.usingBatchId&&!chosen)return empty('batch_not_open');
  if(open.length>0&&!open.some(batch=>batch.arrivedDay<=input.day))return empty('before_arrival');
  const eligible=open.filter(batch=>batch.arrivedDay<=input.day);
  const queue=chosen&&chosen.arrivedDay<=input.day?[chosen,...eligible.filter(batch=>batch.id!==chosen.id)]:eligible;
  if(chosen&&chosen.arrivedDay>input.day)return empty('before_arrival');
  const portions:FillPortionPlan[]=[];
  let need=kg;
  for(const batch of queue){
    if(need<=FILL_EPSILON)break;
    const take=round3(Math.min(need,batch.remainingKg));
    if(take<=FILL_EPSILON)continue;
    const after=round3(batch.remainingKg-take);
    portions.push({batchId:batch.id,batchNumber:batch.batchNumber,kg:take,pricePerKgUsd:batch.pricePerKgUsd,closesBatch:after<=FILL_EPSILON,remainingAfterKg:after});
    need=round3(need-take);
  }
  return {portions,totalKg:kg,overByKg:need>FILL_EPSILON?need:0,cost:fillCost(portions),issue:need>FILL_EPSILON?'over_limit':null};
}

/** The messages the form and the repository show for each issue. */
export const fillIssueMessages:Record<FillIssue,string>={
  invalid_quantity:'Quantity must be a number of kg greater than zero.',
  future_date:'The fill date must be today or a past day.',
  before_arrival:'No open batch had arrived by this date. Choose a later date.',
  batch_not_open:'Choose a batch that is still open.',
  over_limit:'This fill is more than all the open batches hold.',
};

/** A fill is cancelled with a reason, once. Returns the message to show, or null when the cancellation may go ahead. */
export function validateFillCancellation(reason:string,status:FillRecordStatus):string|null{
  if(status==='Cancelled')return 'This fill is already cancelled.';
  if(!reason.trim())return 'Enter the reason for cancelling this fill.';
  return null;
}

export type BitumenFillDestinationType='project'|'company_site'|'unassigned';
/** What the Record Fill form sends. The quantity is text so the form can show what was typed; an empty `batchId` means the default batch. */
export type BitumenFillDraft={recordDate:string;truckId:string;batchId:string;destinationType:BitumenFillDestinationType;projectId:string;companySiteId:string;layerNote:string;kg:string;ticketNumber:string;notes:string};
export type BitumenFillPortion={batchId:string;batchNumber:string;kg:number;pricePerKgUsd:number|null};
/** One fill as stored. Truck, destination and batch numbers are the names as they were when the fill was saved. */
export type BitumenFill={
  id:string;/** The local day the Owner chose. */recordDate:string;/** The fill date at the time of day it was entered. */confirmedAt:string;/** When it was really entered. */enteredAt:string;
  truckId:string|null;truckName:string;destinationType:BitumenFillDestinationType;projectId:string|null;projectName:string|null;companySiteId:string|null;companySiteName:string|null;
  layerNote:string|null;ticketNumber:string|null;notes:string|null;totalKg:number;portions:BitumenFillPortion[];cost:FillCost;
  status:FillRecordStatus;cancellationReason:string|null;cancelledAt:string|null;
};
export type BitumenFillOption={id:string;name:string;detail?:string};
export type BitumenFillSetup={trucks:BitumenFillOption[];projects:(BitumenFillOption&{startDate:string|null;endDate:string|null})[];companySites:BitumenFillOption[]};

/** A batch's price per kg for costing a fill, ex VAT: per kg as entered, per ton divided by 1,000, a whole-batch price spread over the delivered kg. Null when Unpriced. */
export function batchPricePerKg(batch:{priceBasis:'per_ton'|'per_kg'|'whole'|null;priceUsd:number|null;subtotalUsd:number|null;deliveredKg:number}):number|null{
  if(batch.priceUsd==null||!batch.priceBasis)return null;
  if(batch.priceBasis==='per_kg')return batch.priceUsd;
  if(batch.priceBasis==='per_ton')return batch.priceUsd/1000;
  return batch.subtotalUsd!=null&&batch.deliveredKg>0?batch.subtotalUsd/batch.deliveredKg:null;
}
