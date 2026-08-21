import type {DriverProfile,Project,TruckProfile} from './loads';
export type WasteDumpStatus='Active'|'Cancelled';
export type WasteDump={id:string;projectId:string;projectName:string;workDate:string;dumpedAt:string;materialType:string|null;dumpLocation:string|null;truckProfileId:string|null;truckPlate:string|null;driverProfileId:string|null;driverName:string|null;notes:string|null;status:WasteDumpStatus;cancellationReason:string|null;cancelledAt:string|null;createdAt:string;updatedAt:string};
export type WasteDumpDraft={materialType:string;dumpLocation:string;truckProfileId:string;driverProfileId:string;notes:string};
export type WasteCounterPreset={id:string;projectId:string;driverProfileId:string;driverName:string;truckProfileId:string;truckPlate:string;materialType:string|null;dumpLocation:string|null;notes:string|null;createdAt:string;updatedAt:string};
export type WasteCounterDraft={driverProfileId:string;truckProfileId:string;materialType:string;dumpLocation:string;notes:string};
export type WasteSetup={projects:Project[];drivers:DriverProfile[];trucks:TruckProfile[]};
export type WasteProjectSummary={project:Project;startDate:string|null;endDate:string|null;activeCount:number;cancelledCount:number;byMaterial:{label:string;count:number}[];byLocation:{label:string;count:number}[];firstDumpAt:string|null;lastDumpAt:string|null;dailyReportCount:number;deliveredLoadCount:number;deliveredLoads:{label:string;quantity:number;unit:string;loads:number}[];recordedWorkMinutes:number;photoCount:number;issueDays:number};
export const emptyWasteDumpDraft:WasteDumpDraft={materialType:'',dumpLocation:'',truckProfileId:'',driverProfileId:'',notes:''};
export const emptyWasteCounterDraft:WasteCounterDraft={driverProfileId:'',truckProfileId:'',materialType:'',dumpLocation:'',notes:''};
export function normalizeWasteLabel(value:string|null,fallback:string):string{return value?.trim()||fallback;}
export function wasteCounterCount(dumps:WasteDump[],counter:Pick<WasteCounterPreset,'driverProfileId'|'truckProfileId'>,workDate:string):number{return dumps.filter(dump=>dump.status==='Active'&&dump.workDate===workDate&&dump.driverProfileId===counter.driverProfileId&&dump.truckProfileId===counter.truckProfileId).length;}
