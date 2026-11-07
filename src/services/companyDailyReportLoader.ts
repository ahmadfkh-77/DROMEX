import type {BitumenRepository} from '../data/repositories/BitumenRepository';
import type {CompanyTotalsRecord,CompanyTotalsRepository} from '../data/repositories/CompanyTotalsRepository';
import type {DayRecordsRepository} from '../data/repositories/DayRecordsRepository';
import type {StockRepository} from '../data/repositories/StockRepository';
import type {AttendanceRepository} from '../data/repositories/AttendanceRepository';
import {buildAttendanceSheet} from '../domain/attendance';
import type {ContractQuantitiesRepository} from '../data/repositories/ContractQuantitiesRepository';
import type {FuelRepository} from '../data/repositories/FuelRepository';
import type {WasteRepository} from '../data/repositories/WasteRepository';
import type {RecordSnapshot} from '../domain/businessDocuments';
import {loadUseDetail,USE_EPSILON,type BitumenUseRow} from '../domain/bitumenUse';
import type {ContractTargetRow} from '../domain/contractQuantities';
import {emptyCompanyTotalsFilters} from '../domain/companyTotals';
import {applyContractSwitches,buildCompanyDailyReport,type DayArrival,withAttendance,localDay,type CompanyDailyReport,type DayFill,type DayLoadOut,type DaySupplierLoad,type DayWasteDump} from '../domain/companyDailyReport';

/** The repositories the report reads. All of them are only read: the report never changes stock, loads, batches or targets. */
export type CompanyDailyReportSources={
  totals:Pick<CompanyTotalsRepository,'listRecords'>;
  fuel:Pick<FuelRepository,'getOverview'>;
  waste:Pick<WasteRepository,'listWasteHistory'>;
  bitumen:Pick<BitumenRepository,'getOverview'>;
  /** Optional: Contract Quantities, for the per-project Contract target table (every switch starts OFF). */
  contract?:Pick<ContractQuantitiesRepository,'targetTableOn'>;
  /** Optional: the daily who-worked-where sheet (DEC-544). */
  attendance?:Pick<AttendanceRepository,'listDay'>;
  /** Optional: Stock batches received that day. */
  stock?:Pick<StockRepository,'getOverview'>;
  /** Optional: the day's issues and daily reports (counts only). */
  dayRecords?:Pick<DayRecordsRepository,'listIssues'|'listDailyReports'>;
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

/** The price the record itself kept (cents, before VAT). A record without a recorded price stays Unpriced, never zero. */
const pricesOf=(s:RecordSnapshot):{priceBasis:'per_unit'|'whole'|null;unitPriceCents:number|null;amountCents:number|null}=>({priceBasis:s.subtotalCents==null?null:s.priceBasis,unitPriceCents:s.unitPriceCents,amountCents:s.subtotalCents});
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
      projectId:s.projectId,projectName:s.projectName,siteId:null,siteName:null,truckPlate:r.details?.truckPlate??null,driverName:r.details?.driverName??null,bitumenKg:use.kg,bitumenApplies:use.applies,...pricesOf(s)};
  });
  const supplierLoads:DaySupplierLoad[]=records.filter(isSupplier).map(r=>{
    const s=r.snapshot;const siteId=r.details?.siteId??null;
    return {id:s.recordId,status:r.status,time:s.recordedAt,number:s.reference,itemName:s.itemName,unitSymbol:s.unitSymbol,quantity:s.quantity,supplierName:s.partyName||null,
      deliveredBy:r.details?.deliveredBy??null,driverName:r.details?.driverName??null,projectId:siteId?null:s.projectId,projectName:siteId?null:s.projectName,siteId,siteName:siteId?s.projectName:null,
      truckPlate:r.details?.truckPlate??null,ticket:s.supplierReference,...pricesOf(s)};
  });
  const fills:DayFill[]=fuel.movements.filter(m=>m.type==='fill'&&localDay(m.confirmedAt)===day).map(m=>({
    id:m.id,status:m.status,time:m.confirmedAt,givenTo:m.equipmentName??'Unknown equipment',equipmentType:m.equipmentType??null,fuelType:m.fuelType,operatorName:null,litres:m.litres,
    projectId:m.projectId,projectName:m.projectName,siteId:m.projectId?null:m.companySiteId??null,siteName:m.projectId?null:m.companySiteName??null,
    unitPriceCents:m.pricePerLitreUsd==null?null:Math.round(m.pricePerLitreUsd*100),amountCents:m.consumptionCostUsd==null?null:Math.round(m.consumptionCostUsd*100),priceBasis:m.consumptionCostUsd==null?null:'per_unit'}));
  const wasteDumps:DayWasteDump[]=dumps.map(d=>({
    id:d.id,status:d.status,time:d.dumpedAt,material:d.materialType,area:d.dumpLocation,truckPlate:d.truckPlate,driverName:d.driverName,
    projectId:d.projectId,projectName:d.projectName,siteId:d.projectId?null:d.companySiteId??null,siteName:d.projectId?null:d.companySiteName??null}));

  // Deliveries into company stock: diesel and other fuel, bitumen batches and Stock batches. Active only; priced as the record kept them (before VAT).
  const cents=(usd:number|null|undefined)=>usd==null?null:Math.round(usd*100);
  const arrivals:DayArrival[]=[
    ...fuel.movements.filter(m=>m.type==='delivery'&&localDay(m.confirmedAt)===day).map((m):DayArrival=>({id:m.id,status:m.status,time:m.confirmedAt,kind:'fuel',material:m.fuelType,unitSymbol:'L',quantity:m.litres,supplierName:m.supplierName,detail:m.ticketNumber,
      priceBasis:m.subtotalUsd==null?null:'per_unit',unitPriceCents:cents(m.pricePerLitreUsd),amountCents:cents(m.subtotalUsd)})),
    ...bitumen.batches.filter(b=>localDay(b.arrivedAt)===day).map((b):DayArrival=>({id:b.id,status:b.recordStatus==='Cancelled'?'Cancelled':'Active',time:b.arrivedAt,kind:'bitumen',material:'Bitumen',unitSymbol:'kg',quantity:b.deliveredKg,supplierName:b.supplierName,detail:b.gradeName,
      priceBasis:b.subtotalUsd==null?null:'whole',unitPriceCents:null,amountCents:cents(b.subtotalUsd)})),
    ...(sources.stock?(await sources.stock.getOverview()).items.flatMap(item=>item.batches.filter(b=>localDay(b.arrivedAt)===day).map((b):DayArrival=>({id:b.id,status:b.recordStatus==='Cancelled'?'Cancelled':'Active',time:b.arrivedAt,kind:'stock',material:item.itemName,unitSymbol:item.unitSymbol,quantity:b.quantity,supplierName:b.supplierName,detail:null,
      priceBasis:b.subtotalUsd==null?null:b.priceBasis==='per_unit'?'per_unit':'whole',unitPriceCents:b.priceBasis==='per_unit'?cents(b.priceUsd):null,amountCents:cents(b.subtotalUsd)}))):[]),
  ];
  const issues=sources.dayRecords?await sources.dayRecords.listIssues(day):[];
  const dailyReports=sources.dayRecords?await sources.dayRecords.listDailyReports(day):[];
  let report=buildCompanyDailyReport(day,{loadsOut,supplierLoads,fills,dumps:wasteDumps,arrivals,issues,dailyReports});
  if(sources.attendance)report=withAttendance(report,buildAttendanceSheet(await sources.attendance.listDay(day)));
  if(!sources.contract)return report;
  const targets:Record<string,{rows:ContractTargetRow[]}>={};
  for(const place of report.places){if(place.kind!=='project')continue;const projectId=place.key.slice('project:'.length);targets[projectId]={rows:await sources.contract.targetTableOn(projectId,day)};}
  return applyContractSwitches(report,targets,{});
}
