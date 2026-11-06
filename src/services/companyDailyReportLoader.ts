import type {BitumenRepository} from '../data/repositories/BitumenRepository';
import type {CompanyTotalsRecord,CompanyTotalsRepository} from '../data/repositories/CompanyTotalsRepository';
import type {FuelRepository} from '../data/repositories/FuelRepository';
import type {WasteRepository} from '../data/repositories/WasteRepository';
import {loadUseDetail,USE_EPSILON,type BitumenUseRow} from '../domain/bitumenUse';
import {emptyCompanyTotalsFilters} from '../domain/companyTotals';
import {buildCompanyDailyReport,localDay,type CompanyDailyReport,type DayFill,type DayLoadOut,type DaySupplierLoad,type DayWasteDump} from '../domain/companyDailyReport';

/** The repositories the report reads. All of them are only read: the report never changes stock, loads, batches or targets. */
export type CompanyDailyReportSources={
  totals:Pick<CompanyTotalsRepository,'listRecords'>;
  fuel:Pick<FuelRepository,'getOverview'>;
  waste:Pick<WasteRepository,'listWasteHistory'>;
  bitumen:Pick<BitumenRepository,'getOverview'>;
};

/**
 * Bitumen used by one company load, from the existing engine (domain/bitumenUse.ts), not recomputed here.
 * Null ("-") when the load has no bitumen rows, its mix or rule is unknown, or part of it is not covered by a batch.
 */
export function bitumenForLoad(rows:readonly BitumenUseRow[]):{applies:boolean;kg:number|null}{
  const detail=loadUseDetail(rows);
  if(!detail)return {applies:false,kg:null};
  if(detail.mixKg<=0||detail.ruleAggregateKg<=0||detail.uncoveredKg>USE_EPSILON)return {applies:true,kg:null};
  const kg=Math.round(detail.byBatch.reduce((sum,batch)=>sum+batch.kg,0)*1000)/1000;
  return {applies:true,kg};
}

const isSupplier=(record:CompanyTotalsRecord)=>record.snapshot.recordType==='supplier_load';

export async function loadCompanyDailyReport(day:string,sources:CompanyDailyReportSources):Promise<CompanyDailyReport>{
  const [records,fuel,dumps,bitumen]=await Promise.all([
    sources.totals.listRecords({...emptyCompanyTotalsFilters(),fromDate:day,toDate:day},1000),
    sources.fuel.getOverview(),
    sources.waste.listWasteHistory(day,day),
    sources.bitumen.getOverview(),
  ]);

  const useByLoad=new Map<string,BitumenUseRow[]>();
  for(const row of bitumen.useRows??[]){const list=useByLoad.get(row.loadId);if(list)list.push(row);else useByLoad.set(row.loadId,[row]);}

  const loadsOut:DayLoadOut[]=records.filter(r=>!isSupplier(r)).map(r=>{
    const s=r.snapshot;const use=bitumenForLoad(useByLoad.get(s.recordId)??[]);
    return {id:s.recordId,status:r.status,time:s.recordedAt,loadNumber:s.loadNumber??s.reference,itemName:s.itemName,unitSymbol:s.unitSymbol,quantity:s.quantity,
      projectId:s.projectId,projectName:s.projectName,siteId:null,siteName:null,truckPlate:r.details?.truckPlate??null,driverName:r.details?.driverName??null,bitumenKg:use.kg,bitumenApplies:use.applies};
  });
  const supplierLoads:DaySupplierLoad[]=records.filter(isSupplier).map(r=>{
    const s=r.snapshot;const siteId=r.details?.siteId??null;
    return {id:s.recordId,status:r.status,time:s.recordedAt,number:s.reference,itemName:s.itemName,unitSymbol:s.unitSymbol,quantity:s.quantity,supplierName:s.partyName||null,
      deliveredBy:r.details?.deliveredBy??null,projectId:siteId?null:s.projectId,projectName:siteId?null:s.projectName,siteId,siteName:siteId?s.projectName:null,
      truckPlate:r.details?.truckPlate??null,ticket:s.supplierReference};
  });
  const fills:DayFill[]=fuel.movements.filter(m=>m.type==='fill'&&localDay(m.confirmedAt)===day).map(m=>({
    id:m.id,status:m.status,time:m.confirmedAt,givenTo:m.equipmentName??'Unknown equipment',fuelType:m.fuelType,operatorName:null,litres:m.litres,
    projectId:m.projectId,projectName:m.projectName,siteId:m.projectId?null:m.companySiteId??null,siteName:m.projectId?null:m.companySiteName??null}));
  const wasteDumps:DayWasteDump[]=dumps.map(d=>({
    id:d.id,status:d.status,time:d.dumpedAt,material:d.materialType,area:d.dumpLocation,truckPlate:d.truckPlate,driverName:d.driverName,
    projectId:d.projectId,projectName:d.projectName,siteId:d.projectId?null:d.companySiteId??null,siteName:d.projectId?null:d.companySiteName??null}));

  return buildCompanyDailyReport(day,{loadsOut,supplierLoads,fills,dumps:wasteDumps});
}
