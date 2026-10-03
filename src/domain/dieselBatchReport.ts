import {localDateKey,type FuelMovement} from './fuel';
import {batchStatusLabels,type BatchDetail,type DieselBatchOverview} from './fuelBatches';
import {buildFillRows,fuelDayLabel,groupFillsByDay,type DayFillRow} from './fuelBatchViews';
import {costSummaryLabel,formatLitres,formatMoney} from './fuelFillForm';

/**
 * DEC-492, Screen F. The content of the Diesel Batch Report PDF for a batch, project, site, station or
 * date range: computed here so it can be tested, then printed by the template. Gasoline is not part of
 * a diesel report; records from before batches and outside station fills keep their own source label.
 */
export type DieselReportFilter={batchId?:string;projectId?:string;companySiteId?:string;stationId?:string;/** Only fills with no destination. */unassigned?:boolean;fromDate?:string;toDate?:string;includePrices:boolean};
type Named={id:string;name:string};
export type DieselReportInput={movements:FuelMovement[];overview:DieselBatchOverview;names:{projects:Named[];companySites:Named[];stations:Named[]};filter:DieselReportFilter;exportedAt:string};

export type DieselReportRow={date:string;equipment:string;type:string;source:string;litres:string;price?:string;cost?:string};
export type DieselReportDay={label:string;total:number;totalText:string;rows:DieselReportRow[]};
export type DieselReportDestination={name:string;typeLabel:string;total:number;totalText:string;totalLabel:string;days:DieselReportDay[]};
export type DieselReportSection={title:'PROJECTS'|'COMPANY SITES'|'UNASSIGNED';destinations:DieselReportDestination[]};
export type DieselBatchReport={
  scopeLabel:string;
  metadata:{label:string;value:string}[];
  summary:{deliveredLitres:number;filledLitres:number;adjustmentLitres:number;remainingLitres:number;filteredNote:string|null};
  sections:DieselReportSection[];
  batchTotals:{batchNumber:string;delivered:string;deliveryDetail:string;filled:string;adjustments:string;remaining:string;status:string}[];
  tank:{litres:string;overfill:string};
  destinationTotals:{label:string;litres:string}[];
  adjustments:{label:string;detail:string}[];
  pricesIncluded:boolean;
  empty:boolean;
  fileName:string;
};

const round=(value:number)=>Math.round(value*1000)/1000;
const clock=(iso:string)=>{const value=new Date(iso);return `${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`;};

export function buildDieselBatchReport({movements,overview,names,filter,exportedAt}:DieselReportInput):DieselBatchReport{
  const byId=new Map(movements.map(movement=>[movement.id,movement]));
  const scoped=filter.batchId?overview.batches.find(batch=>batch.id===filter.batchId):undefined;
  const allRows=buildFillRows(movements.filter(movement=>movement.fuelType!=='gasoline'),overview,filter.batchId?{batchId:filter.batchId}:{});
  const rows=allRows.filter(row=>
    (!filter.projectId||(row.destinationType==='project'&&row.destinationId===filter.projectId))&&
    (!filter.companySiteId||(row.destinationType==='company_site'&&row.destinationId===filter.companySiteId))&&
    (!filter.stationId||row.stationId===filter.stationId)&&
    (!filter.unassigned||row.destinationType==='unassigned')&&
    (!filter.fromDate||row.day>=filter.fromDate)&&(!filter.toDate||row.day<=filter.toDate));
  const destinationFilter=Boolean(filter.projectId||filter.companySiteId||filter.stationId||filter.unassigned);

  // The batches the report is about: the one batch, or those that supplied the fills shown and, with only
  // a date filter, those that arrived inside the dates.
  const supplying=new Set(rows.flatMap(row=>row.batchIds));
  const batches:BatchDetail[]=scoped?[scoped]:overview.batches.filter(batch=>supplying.has(batch.id)||(!destinationFilter&&(filter.fromDate||filter.toDate)&&(!filter.fromDate||localDateKey(batch.arrivedAt)>=filter.fromDate)&&(!filter.toDate||localDateKey(batch.arrivedAt)<=filter.toDate))||(!destinationFilter&&!filter.fromDate&&!filter.toDate));
  const counted=batches.filter(batch=>batch.status!=='cancelled');
  const filled=round(rows.reduce((sum,row)=>sum+row.litres,0));

  const price=(row:DayFillRow):{price:string;cost:string}=>{
    const movement=byId.get(row.id)!;
    if(scoped){const value=scoped.pricePerLitreUsd;return value==null?{price:'Unpriced',cost:'Unpriced'}:{price:formatMoney(value),cost:formatMoney(Math.round(row.litres*value*100)/100)};}
    const batchInfo=overview.fills[row.id];
    if(batchInfo)return {price:batchInfo.cost.fullyPriced&&batchInfo.cost.costUsd!=null?formatMoney(Math.round(batchInfo.cost.costUsd/movement.litres*100)/100):'Unpriced',cost:costSummaryLabel(batchInfo.cost)};
    return {price:movement.pricePerLitreUsd==null?'Unpriced':formatMoney(movement.pricePerLitreUsd),cost:movement.consumptionCostUsd==null?'Unpriced':formatMoney(movement.consumptionCostUsd)};
  };

  const sections:DieselReportSection[]=[];
  for(const [type,title,typeLabel,totalLabel] of [['project','PROJECTS','PROJECT','Project total'],['company_site','COMPANY SITES','SITE','Site total'],['unassigned','UNASSIGNED','UNASSIGNED','Unassigned total']] as const){
    const ofType=rows.filter(row=>row.destinationType===type);
    if(!ofType.length)continue;
    const groups=new Map<string,DayFillRow[]>();
    for(const row of ofType){const key=`${row.destinationId??row.destinationName}`;groups.set(key,[...(groups.get(key)??[]),row]);}
    const destinations=[...groups.values()].map(list=>{
      const total=round(list.reduce((sum,row)=>sum+row.litres,0));
      return {
        name:list[0]!.destinationName,typeLabel,total,totalText:formatLitres(total),totalLabel,
        days:groupFillsByDay(list,{byDestination:false}).map(card=>({label:card.label,total:card.total,totalText:formatLitres(card.total),rows:card.groups[0]!.rows.map(row=>{
          const base:DieselReportRow={date:`${card.label} · ${clock(row.confirmedAt)}`,equipment:row.equipmentName,type:row.equipmentType,source:row.source.text,litres:formatLitres(row.litres)};
          return filter.includePrices?{...base,...price(row)}:base;
        })})),
      };
    }).sort((a,b)=>a.name.localeCompare(b.name));
    sections.push({title,destinations});
  }

  const nameOf=(list:Named[],id?:string)=>id?list.find(item=>item.id===id)?.name??'Selected':undefined;
  const dateRange=filter.fromDate||filter.toDate?`${filter.fromDate?fuelDayLabel(filter.fromDate):'The start'} – ${filter.toDate?fuelDayLabel(filter.toDate):'Today'}`:'All dates';
  const exported=`${fuelDayLabel(localDateKey(exportedAt))}, ${clock(exportedAt)}`;
  const scopeLabel=scoped?`${scoped.batchNumber} · Invoice ${scoped.invoiceNumber??'not recorded'}`:destinationFilter?'Batches that supplied the filtered fills':filter.fromDate||filter.toDate?'Batches and fills in the date range':'All batches';
  const fileName=scoped?`Diesel-Batch-Report-${scoped.batchNumber}.pdf`:filter.fromDate||filter.toDate?`Diesel-Batch-Report-${filter.fromDate??'start'}-to-${filter.toDate??localDateKey(exportedAt)}.pdf`:`Diesel-Batch-Report-${localDateKey(exportedAt)}.pdf`;

  const destinationTotals=sections.flatMap(section=>section.destinations.map(destination=>({label:`${destination.name} (${destination.typeLabel==='PROJECT'?'Project':destination.typeLabel==='SITE'?'Site':'Unassigned'})`,litres:destination.totalText})));
  if(destinationTotals.length)destinationTotals.push({label:'Total filled',litres:formatLitres(filled)});

  return {
    scopeLabel,
    metadata:[
      {label:'Batch',value:scoped?scoped.batchNumber:'All batches'},{label:'Exported',value:exported},
      {label:'Project filter',value:filter.unassigned?'Unassigned only':nameOf(names.projects,filter.projectId)??'All projects'},{label:'Site filter',value:filter.unassigned?'Unassigned only':nameOf(names.companySites,filter.companySiteId)??'All sites'},
      {label:'Station filter',value:nameOf(names.stations,filter.stationId)??'All stations'},{label:'Date range',value:dateRange},{label:'Prices',value:filter.includePrices?'Included':'Excluded'},
    ],
    summary:{
      deliveredLitres:round(counted.reduce((sum,batch)=>sum+batch.deliveredLitres,0)),filledLitres:filled,
      adjustmentLitres:round(counted.reduce((sum,batch)=>sum+batch.adjustmentLitres,0)),remainingLitres:round(counted.reduce((sum,batch)=>sum+batch.remainingLitres,0)),
      filteredNote:destinationFilter||filter.fromDate||filter.toDate?'Filled counts only the fills that match the filters.':null,
    },
    sections,
    batchTotals:batches.map(batch=>({
      batchNumber:batch.batchNumber,delivered:formatLitres(batch.deliveredLitres),
      deliveryDetail:[batch.kind==='opening'?(batch.openingBasis==='calculated'?'Opening stock · Calculated (no dip reading)':'Opening stock · From a dip reading'):`Invoice ${batch.invoiceNumber??'not recorded'}`,batch.supplierName,fuelDayLabel(localDateKey(batch.arrivedAt))].filter(Boolean).join(' · '),
      filled:formatLitres(batch.filledLitres),adjustments:formatLitres(batch.adjustmentLitres),remaining:formatLitres(batch.remainingLitres),status:batchStatusLabels[batch.status],
    })),
    tank:{litres:formatLitres(overview.tankLitres),overfill:overview.overfillAlert?`${formatLitres(overview.outstandingShortfallLitres)} filled with no diesel left in any batch`:'None'},
    destinationTotals,
    adjustments:overview.adjustments.filter(adjustment=>batches.some(batch=>batch.id===adjustment.batchId)).map(adjustment=>({
      label:`Dip adjustment · ${fuelDayLabel(localDateKey(adjustment.confirmedAt))} · ${adjustment.batchNumber}`,
      detail:`Calculated remaining ${formatLitres(adjustment.calculatedLitres)} · Dip reading ${formatLitres(adjustment.dipLitres)} · Adjustment ${formatLitres(adjustment.litres)}`,
    })),
    pricesIncluded:filter.includePrices,
    empty:rows.length===0,
    fileName,
  };
}
