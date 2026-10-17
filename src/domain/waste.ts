import type {DriverProfile,Project,TruckProfile} from './loads';
export type WasteDumpStatus='Active'|'Cancelled';
/** A waste dump counts at a Location: a project or a company site. */
export type WasteLocationType='project'|'company_site';
export type WasteLocation={type:WasteLocationType;id:string};
export type WasteDump={id:string;/** Set for a dump at a project; null at a company site. */projectId:string|null;projectName:string|null;/** Set for a dump at a company site, with its name as it was when counted. */companySiteId?:string|null;companySiteName?:string|null;workDate:string;dumpedAt:string;materialType:string|null;dumpLocation:string|null;truckProfileId:string|null;truckPlate:string|null;driverProfileId:string|null;driverName:string|null;notes:string|null;status:WasteDumpStatus;cancellationReason:string|null;cancelledAt:string|null;createdAt:string;updatedAt:string};
export type WasteDumpDraft={materialType:string;dumpLocation:string;truckProfileId:string;driverProfileId:string;notes:string};
export type WasteCounterPreset={id:string;projectId:string|null;companySiteId?:string|null;driverProfileId:string;driverName:string;truckProfileId:string;truckPlate:string;materialType:string|null;dumpLocation:string|null;notes:string|null;createdAt:string;updatedAt:string};
export type WasteCounterDraft={driverProfileId:string;truckProfileId:string;materialType:string;dumpLocation:string;notes:string};
export type WasteSite={id:string;name:string};
export type WasteSetup={projects:Project[];/** Active company sites, the other kind of Location. */companySites?:WasteSite[];drivers:DriverProfile[];trucks:TruckProfile[]};
/** A running summary for one company site over the dates asked for: a site is never completed, so it has no project summary. */
export type WasteSiteSummary={site:WasteSite;fromDate:string|null;toDate:string|null;activeCount:number;cancelledCount:number;daysWithDumps:number;byMaterial:{label:string;count:number}[];byDriver:{label:string;count:number}[];byLocation:{label:string;count:number}[];firstDumpAt:string|null;lastDumpAt:string|null};
export type WasteProjectSummary={project:Project;startDate:string|null;endDate:string|null;activeCount:number;cancelledCount:number;byMaterial:{label:string;count:number}[];byLocation:{label:string;count:number}[];firstDumpAt:string|null;lastDumpAt:string|null;dailyReportCount:number;deliveredLoadCount:number;deliveredLoads:{label:string;quantity:number;unit:string;loads:number}[];recordedWorkMinutes:number;photoCount:number;issueDays:number};
export const emptyWasteDumpDraft:WasteDumpDraft={materialType:'',dumpLocation:'',truckProfileId:'',driverProfileId:'',notes:''};
export const emptyWasteCounterDraft:WasteCounterDraft={driverProfileId:'',truckProfileId:'',materialType:'',dumpLocation:'',notes:''};
export function normalizeWasteLabel(value:string|null,fallback:string):string{return value?.trim()||fallback;}
export function wasteCounterCount(dumps:WasteDump[],counter:Pick<WasteCounterPreset,'driverProfileId'|'truckProfileId'>,workDate:string):number{return dumps.filter(dump=>dump.status==='Active'&&dump.workDate===workDate&&dump.driverProfileId===counter.driverProfileId&&dump.truckProfileId===counter.truckProfileId).length;}

/** The Location a dump or counter belongs to, as one value: a project or a company site, with its display name and a key that is unique across both. */
export function wasteLocationOf(value:{projectId:string|null;projectName?:string|null;companySiteId?:string|null;companySiteName?:string|null}):{type:WasteLocationType;id:string;name:string;key:string}{
  if(value.projectId)return{type:'project',id:value.projectId,name:value.projectName??'Project',key:`project:${value.projectId}`};
  const id=value.companySiteId??'';return{type:'company_site',id,name:value.companySiteName??'Company site',key:`site:${id}`};
}
export const wasteLocationKey=(location:WasteLocation):string=>location.type==='project'?`project:${location.id}`:`site:${location.id}`;
export function parseWasteLocationKey(key:string):WasteLocation|null{
  if(key.startsWith('project:')&&key.length>8)return{type:'project',id:key.slice(8)};
  if(key.startsWith('site:')&&key.length>5)return{type:'company_site',id:key.slice(5)};
  return null;
}
/** A caller may still pass a bare project id. */
export const asWasteLocation=(value:WasteLocation|string):WasteLocation=>typeof value==='string'?{type:'project',id:value}:value;
export const wasteLocationLabels:Record<WasteLocationType,string>={project:'Project',company_site:'Company site'};
