import {formatKg,formatUsd} from './bitumen';
import type {BitumenBatch} from './bitumen';
import type {BitumenFill,BitumenFillDestinationType,FillCost,FillPlan} from './bitumenFills';
import {localDateKey} from './fuel';
import {fuelDayLabel} from './fuelBatchViews';
import type {PreviewLine} from './fuelFillForm';

/**
 * DEC-557. What the bitumen screens show about fills, kept apart from the screens so it can be tested: the rows of one batch, the
 * day cards (newest first, grouped by destination), the destination totals, the batch figures and bar, and the "Before you save" lines.
 * A cancelled fill is listed (never hidden) but never counted in any total.
 */
const round3=(value:number)=>Math.round(value*1000)/1000;
const EPS=0.0005;

export type FillRow={
  fillId:string;batchId:string;day:string;confirmedAt:string;enteredAt:string;truckName:string;
  destinationKey:string;destinationType:BitumenFillDestinationType;destinationName:string;
  layerNote:string|null;ticketNumber:string|null;notes:string|null;
  /** The kg this batch gave, and the batch price per kg it was costed at (null when Unpriced). */kg:number;pricePerKgUsd:number|null;/** The whole fill, which is more than `kg` when it was split across batches. */totalKg:number;split:boolean;
  cancelled:boolean;cancellationReason:string|null;cancelledAt:string|null;
};

export const destinationTypeLabel:Record<BitumenFillDestinationType,string>={project:'Project',company_site:'Company Site',unassigned:'Unassigned'};

export function fillDestination(fill:Pick<BitumenFill,'destinationType'|'projectId'|'projectName'|'companySiteId'|'companySiteName'>):{key:string;name:string}{
  if(fill.destinationType==='project')return {key:`project:${fill.projectId??fill.projectName??''}`,name:fill.projectName??'Project'};
  if(fill.destinationType==='company_site')return {key:`site:${fill.companySiteId??fill.companySiteName??''}`,name:fill.companySiteName??'Company site'};
  return {key:'unassigned',name:'Unassigned'};
}

/** Every fill that took bitumen from this batch, newest first. A split fill appears with this batch's part and says it was split. */
export function fillRowsForBatch(fills:readonly BitumenFill[],batchId:string):FillRow[]{
  const rows:FillRow[]=[];
  for(const fill of fills){
    const portion=fill.portions.find(value=>value.batchId===batchId);
    if(!portion)continue;
    const destination=fillDestination(fill);
    rows.push({fillId:fill.id,batchId,day:fill.recordDate,confirmedAt:fill.confirmedAt,enteredAt:fill.enteredAt,truckName:fill.truckName,destinationKey:destination.key,destinationType:fill.destinationType,destinationName:destination.name,
      layerNote:fill.layerNote,ticketNumber:fill.ticketNumber,notes:fill.notes,kg:portion.kg,pricePerKgUsd:portion.pricePerKgUsd,totalKg:fill.totalKg,split:fill.portions.length>1,cancelled:fill.status==='Cancelled',cancellationReason:fill.cancellationReason,cancelledAt:fill.cancelledAt});
  }
  return rows.sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt)||b.enteredAt.localeCompare(a.enteredAt));
}

export const activeFillKg=(rows:readonly Pick<FillRow,'kg'|'cancelled'>[])=>round3(rows.filter(row=>!row.cancelled).reduce((sum,row)=>sum+row.kg,0));

export type FillDestinationGroup={key:string;type:BitumenFillDestinationType;name:string;total:number;rows:FillRow[]};
export type FillDay={day:string;label:string;isToday:boolean;total:number;groups:FillDestinationGroup[]};

const byDestination=(a:{type:BitumenFillDestinationType;name:string},b:{type:BitumenFillDestinationType;name:string})=>(a.type==='unassigned'?1:0)-(b.type==='unassigned'?1:0)||a.name.localeCompare(b.name);

/** One card per day, newest first; inside a day one group per destination with its own total, and newest fill first. Totals skip cancelled fills. */
export function groupFillsByDay(rows:readonly FillRow[],today:string=localDateKey(new Date())):FillDay[]{
  const days=new Map<string,FillRow[]>();
  for(const row of rows)days.set(row.day,[...(days.get(row.day)??[]),row]);
  return [...days.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([day,list])=>{
    const groups=new Map<string,FillDestinationGroup>();
    for(const row of list){
      const group=groups.get(row.destinationKey)??{key:row.destinationKey,type:row.destinationType,name:row.destinationName,total:0,rows:[]};
      group.rows.push(row);if(!row.cancelled)group.total=round3(group.total+row.kg);
      groups.set(row.destinationKey,group);
    }
    const ordered=[...groups.values()].sort(byDestination);
    return {day,label:fuelDayLabel(day),isToday:day===today,total:round3(ordered.reduce((sum,group)=>sum+group.total,0)),groups:ordered};
  });
}

export type FillDestinationTotal={key:string;type:BitumenFillDestinationType;name:string;kg:number};
/** Where this batch's fills went, biggest first and Unassigned last. Cancelled fills are not counted. */
export function fillDestinationTotals(rows:readonly FillRow[]):FillDestinationTotal[]{
  const map=new Map<string,FillDestinationTotal>();
  for(const row of rows){
    if(row.cancelled)continue;
    const current=map.get(row.destinationKey)??{key:row.destinationKey,type:row.destinationType,name:row.destinationName,kg:0};
    map.set(row.destinationKey,{...current,kg:round3(current.kg+row.kg)});
  }
  return [...map.values()].sort((a,b)=>(a.type==='unassigned'?1:0)-(b.type==='unassigned'?1:0)||b.kg-a.kg||a.name.localeCompare(b.name));
}

export type BatchFillFigures={deliveredKg:number;fillsKg:number;asphaltKg:number;adjustmentKg:number;remainingKg:number;/** Shares of the delivered kg, 0 to 1, so fills and asphalt never overlap on the bar. */fillsShare:number;asphaltShare:number};
export function batchFillFigures(batch:Pick<BitumenBatch,'deliveredKg'|'filledKg'|'usedKg'|'adjustmentKg'|'remainingKg'>):BatchFillFigures{
  const fills=batch.filledKg??0,total=batch.deliveredKg>0?batch.deliveredKg:1;
  const fillsShare=Math.min(1,Math.max(0,fills/total)),asphaltShare=Math.min(1-fillsShare,Math.max(0,batch.usedKg/total));
  return {deliveredKg:batch.deliveredKg,fillsKg:fills,asphaltKg:batch.usedKg,adjustmentKg:batch.adjustmentKg,remainingKg:batch.remainingKg,fillsShare,asphaltShare};
}

/** The line under a batch on the list: "Fills X kg · Asphalt loads (est.) Y kg · Adjustment Z kg". Adjustment is left out when there is none. */
export function batchFillLine(batch:Pick<BitumenBatch,'filledKg'|'usedKg'|'adjustmentKg'>):string{
  const parts=[`Fills ${formatKg(batch.filledKg??0)}`,`Asphalt loads (est.) ${formatKg(batch.usedKg)}`];
  if(Math.abs(batch.adjustmentKg)>EPS)parts.push(`Adjustment ${batch.adjustmentKg<0?'−':'+'}${formatKg(Math.abs(batch.adjustmentKg))}`);
  return parts.join(' · ');
}

export function fillCostLabel(cost:FillCost):string{
  if(cost.costUsd==null)return 'Unpriced';
  return cost.fullyPriced?formatUsd(cost.costUsd):`${formatUsd(cost.costUsd)} + ${formatKg(cost.unpricedKg)} Unpriced`;
}

/** The "Before you save" lines: one per batch it takes from, the total, and the cost; or, over the limit, what the batches hold and by how much it is over. */
export function fillPreviewLines(plan:FillPlan):PreviewLine[]{
  if(plan.issue==='over_limit'){
    const holds=round3(plan.totalKg-plan.overByKg);
    return [
      {label:'Open batches hold',value:formatKg(holds),kind:'detail'},
      {label:'Over by',note:'Save is blocked. Lower the amount, or record the new delivery first.',value:formatKg(plan.overByKg),kind:'alert'},
    ];
  }
  if(plan.issue)return [];
  const lines:PreviewLine[]=plan.portions.map((portion):PreviewLine=>({
    label:`From ${portion.batchNumber}`,
    note:portion.closesBatch?`uses the last ${formatKg(portion.kg)} · batch closes`:`${formatKg(portion.remainingAfterKg)} left in this batch`,
    value:formatKg(portion.kg),kind:'portion',
  }));
  lines.push({label:`Total fill${plan.portions.length>1?' · shown as one fill, split':''}`,value:formatKg(plan.totalKg),kind:'total'});
  lines.push({label:'Cost',value:fillCostLabel(plan.cost),kind:'detail'});
  return lines;
}

/** A cancelled fill says so in words, with its reason. */
export const cancelledFillNote=(row:Pick<FillRow,'cancelled'|'cancellationReason'>):string|null=>row.cancelled?`Cancelled${row.cancellationReason?` · ${row.cancellationReason}`:''} · not counted`:null;

export function fillTimeText(confirmedAt:string,enteredAt:string,day:string):string{
  // The chosen day carries the time of day it was entered; a back-dated fill shows the time it was really entered.
  void day;const date=new Date(enteredAt||confirmedAt);
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}
