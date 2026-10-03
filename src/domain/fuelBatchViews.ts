import {localDateKey,type FuelDestinationType,type FuelMovement} from './fuel';
import type {BatchDetail,DieselBatchOverview,FillBatchInfo} from './fuelBatches';
import {formatLitres} from './fuelFillForm';

/**
 * DEC-492, Screens A, C, D and E of the approved design. Everything the fuel screens show about a fill,
 * a day, a batch or a project, computed once here so every screen and the PDF say the same thing.
 */
const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const round=(value:number)=>Math.round(value*1000)/1000;

/** "Sat 3 Oct 2026" for a local YYYY-MM-DD date. */
export function fuelDayLabel(day:string):string{
  const [year=0,month=1,date=1]=day.split('-').map(Number);
  const value=new Date(year,month-1,date);
  return `${WEEKDAYS[value.getDay()]} ${date} ${MONTHS[month-1]} ${year}`;
}

export type FillSourceKind='tank_batch'|'station'|'before'|'gasoline';
export type FillSource={kind:FillSourceKind;text:string};

/** D2. Where a fill's fuel came from, always written out. */
export function fillSourceTag(movement:Pick<FuelMovement,'fuelSource'|'fuelType'|'fuelStationName'>,batchInfo:FillBatchInfo|undefined):FillSource{
  if(movement.fuelSource==='station')return {kind:'station',text:`Outside station · ${movement.fuelStationName??'Station not recorded'}`};
  if(movement.fuelType==='gasoline')return {kind:'gasoline',text:'Gasoline'};
  if(batchInfo){
    const numbers=[...new Set(batchInfo.portions.map(portion=>portion.batchNumber))];
    if(!numbers.length)return {kind:'tank_batch',text:'Tank · No diesel left · Overfill Alert'};
    return {kind:'tank_batch',text:numbers.length>1?`Tank · ${numbers.join(' + ')} · Split`:`Tank · ${numbers[0]}`};
  }
  return {kind:'before',text:'Before batches'};
}

/** "340 L from DSL-2026-00004 · 60 L from DSL-2026-00005" when a fill came from more than one place. */
export function splitLine(batchInfo:FillBatchInfo|undefined):string|null{
  if(!batchInfo)return null;
  const parts=batchInfo.portions.map(portion=>`${formatLitres(portion.litres)} from ${portion.batchNumber}`);
  if(batchInfo.outstandingShortfallLitres>0)parts.push(`${formatLitres(batchInfo.outstandingShortfallLitres)} not covered by any batch`);
  return parts.length>1?parts.join(' · '):null;
}

export type DayFillRow={
  id:string;day:string;confirmedAt:string;time:string;litres:number;
  equipmentLabel:string;equipmentName:string;equipmentType:'Machine'|'Truck';destinationType:FuelDestinationType;destinationId:string|null;destinationName:string;
  source:FillSource;detail:string|null;splitLine:string|null;
  /** Every batch this fill drew from, in order. */
  batchIds:string[];
  stationId:string|null;
};

const time=(iso:string)=>{const value=new Date(iso);return `${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`;};
const odometer=(value:string)=>/^\d+$/.test(value.trim())?value.trim().replace(/\B(?=(\d{3})+(?!\d))/g,','):value.trim();

/**
 * One row per Active equipment fill. With `batchId`, only the fills that drew from that batch, each with
 * the litres it took from that batch (the split line still shows the whole fill).
 */
export function buildFillRows(movements:FuelMovement[],overview:DieselBatchOverview,options:{batchId?:string}={}):DayFillRow[]{
  const rows:DayFillRow[]=[];
  for(const movement of movements){
    if(movement.type!=='fill'||movement.status!=='Active')continue;
    const batchInfo=overview.fills[movement.id];
    let litres=movement.litres;
    if(options.batchId){
      const own=batchInfo?.portions.filter(portion=>portion.batchId===options.batchId)??[];
      if(!own.length)continue;
      litres=round(own.reduce((sum,portion)=>sum+portion.litres,0));
    }
    const destinationType=movement.destinationType??(movement.projectId?'project':'unassigned');
    const destinationName=destinationType==='project'?movement.projectName??'Unknown project':destinationType==='company_site'?movement.companySiteName??'Unknown company site':'Unassigned';
    const detail=movement.fuelSource==='station'&&movement.ticketNumber?`Receipt ${movement.ticketNumber}`:movement.odometerReading?.trim()?`Odometer ${odometer(movement.odometerReading)}`:null;
    rows.push({
      id:movement.id,day:localDateKey(movement.confirmedAt),confirmedAt:movement.confirmedAt,time:time(movement.confirmedAt),litres,
      equipmentLabel:`${movement.equipmentName??'Unknown equipment'} · ${movement.equipmentType==='truck'?'Truck':'Machine'}`,equipmentName:movement.equipmentName??'Unknown equipment',equipmentType:movement.equipmentType==='truck'?'Truck':'Machine',
      destinationType,destinationId:destinationType==='project'?movement.projectId:destinationType==='company_site'?movement.companySiteId??null:null,destinationName,
      source:fillSourceTag(movement,batchInfo),detail,splitLine:splitLine(batchInfo),batchIds:[...new Set(batchInfo?.portions.map(portion=>portion.batchId)??[])],stationId:movement.fuelSource==='station'?movement.fuelStationId??null:null,
    });
  }
  return rows;
}

export type DayGroup={type:FuelDestinationType|'all';key:string;name:string;total:number;rows:DayFillRow[]};
export type DayCard={day:string;label:string;total:number;groups:DayGroup[]};
const ORDER:Record<FuelDestinationType,number>={project:0,company_site:1,unassigned:2};

/** D1a. Exactly one card per day, newest first; inside, projects, then company sites, then unassigned. */
export function groupFillsByDay(rows:DayFillRow[],options:{byDestination:boolean}):DayCard[]{
  const days=new Map<string,DayFillRow[]>();
  for(const row of rows)days.set(row.day,[...(days.get(row.day)??[]),row]);
  return [...days.entries()].sort(([a],[b])=>b.localeCompare(a)).map(([day,dayRows])=>{
    const sorted=[...dayRows].sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt));
    const total=round(sorted.reduce((sum,row)=>sum+row.litres,0));
    if(!options.byDestination)return {day,label:fuelDayLabel(day),total,groups:[{type:'all',key:'all',name:'',total,rows:sorted}]};
    const groups=new Map<string,DayGroup>();
    for(const row of sorted){
      const key=row.destinationType==='unassigned'?'unassigned':`${row.destinationType}:${row.destinationId??row.destinationName}`;
      const group=groups.get(key)??{type:row.destinationType,key,name:row.destinationName,total:0,rows:[]};
      group.rows.push(row);group.total=round(group.total+row.litres);groups.set(key,group);
    }
    const ordered=[...groups.values()].sort((a,b)=>ORDER[a.type as FuelDestinationType]-ORDER[b.type as FuelDestinationType]||a.name.localeCompare(b.name));
    return {day,label:fuelDayLabel(day),total,groups:ordered};
  });
}

export type DestinationTotal={type:FuelDestinationType;name:string;litres:number};

/** Screen C, "Totals by destination": projects, company sites, then unassigned, alphabetically. */
export function batchDestinationTotals(rows:DayFillRow[]):DestinationTotal[]{
  const totals=new Map<string,DestinationTotal>();
  for(const row of rows){
    const key=`${row.destinationType}:${row.destinationId??row.destinationName}`;
    const total=totals.get(key)??{type:row.destinationType,name:row.destinationName,litres:0};
    total.litres=round(total.litres+row.litres);totals.set(key,total);
  }
  return [...totals.values()].sort((a,b)=>ORDER[a.type]-ORDER[b.type]||a.name.localeCompare(b.name));
}

const statusWord:Record<BatchDetail['status'],string>={in_use:'In use',waiting:'Waiting',closed:'Closed',cancelled:'Cancelled'};

/** Screen A, the navy tank card: one row per open batch. */
export function tankCardRows(overview:DieselBatchOverview):{id:string;label:string;value:string}[]{
  return overview.batches.filter(batch=>batch.status==='in_use'||batch.status==='waiting').map(batch=>({id:batch.id,label:`${batch.batchNumber} · ${statusWord[batch.status]}`,value:formatLitres(batch.remainingLitres)}));
}

/** The compact Home entry point. Nothing until diesel batch tracking has started. */
export function fuelHomeBadge(overview:DieselBatchOverview):string|null{
  if(!overview.started)return null;
  const inUse=overview.batches.find(batch=>batch.status==='in_use');
  const tail=overview.overfillAlert?'Overfill Alert':inUse?`${inUse.batchNumber} in use`:'No open batch';
  return `${formatLitres(overview.tankLitres)} in tank · ${tail}`;
}

export type BatchListFilter={status?:'open'|'closed'|'cancelled';projectId?:string;companySiteId?:string;fromDate?:string;toDate?:string;search?:string};

/** Filters the batch list. A project or site keeps the batches that supplied it; dates are the arrival date. */
export function filterBatchList(batches:BatchDetail[],rows:DayFillRow[],filter:BatchListFilter):BatchDetail[]{
  const supplied=(batchId:string,type:FuelDestinationType,id:string)=>rows.some(row=>row.destinationType===type&&row.destinationId===id&&row.batchIds.includes(batchId));
  const query=filter.search?.trim().toLocaleLowerCase('en-US')??'';
  return batches.filter(batch=>{
    if(filter.status==='open'&&batch.status!=='in_use'&&batch.status!=='waiting')return false;
    if(filter.status==='closed'&&batch.status!=='closed')return false;
    if(filter.status==='cancelled'&&batch.status!=='cancelled')return false;
    const arrived=localDateKey(batch.arrivedAt);
    if(filter.fromDate&&arrived<filter.fromDate)return false;
    if(filter.toDate&&arrived>filter.toDate)return false;
    if(filter.projectId&&!supplied(batch.id,'project',filter.projectId))return false;
    if(filter.companySiteId&&!supplied(batch.id,'company_site',filter.companySiteId))return false;
    if(query&&!`${batch.batchNumber} ${batch.invoiceNumber??''}`.toLocaleLowerCase('en-US').includes(query))return false;
    return true;
  });
}

export type ProjectSourceTotal={key:string;label:string;litres:number};
export type ProjectFuelSummary={
  totalLitres:number;tankBatchLitres:number;beforeBatchesLitres:number;stationLitres:number;gasolineLitres:number;
  costUsd:number|null;unpricedLitres:number;fillCount:number;equipmentCount:number;dayCount:number;bySource:ProjectSourceTotal[];
};

/** Screen E. A project's fuel by source, with priced cost and the unpriced litres counted openly. */
export function projectFuelSummary(projectId:string,movements:FuelMovement[],overview:DieselBatchOverview):ProjectFuelSummary{
  const fills=movements.filter(movement=>movement.type==='fill'&&movement.status==='Active'&&movement.projectId===projectId);
  let tank=0,before=0,station=0,gasoline=0,cost=0,priced=0,unpriced=0;
  const byBatch=new Map<string,number>(),byStation=new Map<string,number>(),equipment=new Set<string>(),days=new Set<string>();
  for(const fill of fills){
    const batchInfo=overview.fills[fill.id],source=fillSourceTag(fill,batchInfo);
    equipment.add(`${fill.equipmentType}:${fill.equipmentId??fill.equipmentName}`);days.add(localDateKey(fill.confirmedAt));
    if(source.kind==='tank_batch'&&batchInfo){
      tank+=fill.litres;
      for(const portion of batchInfo.portions)byBatch.set(portion.batchId,round((byBatch.get(portion.batchId)??0)+portion.litres));
      if(batchInfo.cost.costUsd!=null){cost+=batchInfo.cost.costUsd;priced+=1;}
      unpriced+=batchInfo.cost.unpricedLitres;
      continue;
    }
    if(source.kind==='station'){station+=fill.litres;const name=fill.fuelStationName??'Station not recorded';byStation.set(name,round((byStation.get(name)??0)+fill.litres));}
    else if(source.kind==='gasoline')gasoline+=fill.litres;
    else before+=fill.litres;
    if(fill.consumptionCostUsd!=null){cost+=fill.consumptionCostUsd;priced+=1;}else unpriced+=fill.litres;
  }
  const bySource:ProjectSourceTotal[]=[];
  for(const batch of overview.batches){const litres=byBatch.get(batch.id);if(litres)bySource.push({key:`batch:${batch.id}`,label:`${batch.batchNumber} · Invoice ${batch.invoiceNumber??'not recorded'}`,litres});}
  if(before>0)bySource.push({key:'before',label:'Before batches',litres:round(before)});
  if(gasoline>0)bySource.push({key:'gasoline',label:'Gasoline',litres:round(gasoline)});
  for(const [name,litres] of [...byStation.entries()].sort(([a],[b])=>a.localeCompare(b)))bySource.push({key:`station:${name}`,label:`Outside station · ${name}`,litres});
  return {
    totalLitres:round(tank+before+station+gasoline),tankBatchLitres:round(tank),beforeBatchesLitres:round(before),stationLitres:round(station),gasolineLitres:round(gasoline),
    costUsd:priced>0?Math.round(cost*100)/100:null,unpricedLitres:round(unpriced),fillCount:fills.length,equipmentCount:equipment.size,dayCount:days.size,bySource,
  };
}
