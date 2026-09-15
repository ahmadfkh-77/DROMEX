export type FuelMovementType='gauge'|'delivery'|'fill';
// DEC-392. Diesel is the stored, balanced fuel; gasoline is fill-only and never affects the tank.
export type FuelType='diesel'|'gasoline';
export const fuelTypeLabels:Record<FuelType,string>={diesel:'Diesel',gasoline:'Gasoline'};
// DEC-438. Where a fill's fuel went. Stored lower-case like the other type-like values; purchases and
// gauge readings have no destination.
export type FuelDestinationType='project'|'company_site'|'unassigned';
export const fuelDestinationLabels:Record<FuelDestinationType,string>={project:'Project',company_site:'Company Site',unassigned:'Unassigned'};
export const fuelDestinationOptions:{id:FuelDestinationType;label:string}[]=(['project','company_site','unassigned'] as const).map(id=>({id,label:fuelDestinationLabels[id]}));
export type CompanySite={id:string;name:string;isActive:boolean;createdAt:string;updatedAt:string};
// DEC-393. Reasoned correction audit, mirroring the company-load and supplier-load model.
export type FuelCorrectionChange={field:string;originalValue:string|null;newValue:string|null};
export type FuelCorrectionEntry={correctedAt:string;correctedBy:string;reason:string;changes:FuelCorrectionChange[]};
export type FuelMovementStatus='Active'|'Cancelled';
export type FuelEquipmentType='machine'|'truck';
export type FuelOption={id:string;name:string;detail?:string;startDate?:string;endDate?:string|null};
export type FuelPriceRecord={id:string;fuelType:FuelType;pricePerLitreUsd:number;effectiveAt:string;changedBy:string;reason:string|null;createdAt:string};
export type FuelSetup={suppliers:FuelOption[];machines:FuelOption[];trucks:FuelOption[];equipment:FuelOption[];projects:FuelOption[];companySites:CompanySite[];vatRatePercent:number;currentFuelPrice:FuelPriceRecord|null;fuelPriceHistory:FuelPriceRecord[];fuelPrices:Record<FuelType,{current:FuelPriceRecord|null;history:FuelPriceRecord[]}>};
export type FuelMovement={id:string;type:FuelMovementType;fuelType:FuelType;correctionHistory:FuelCorrectionEntry[];confirmedAt:string;litres:number;previousBalanceLitres:number|null;differenceLitres:number|null;supplierId:string|null;supplierName:string|null;equipmentType?:FuelEquipmentType;equipmentId:string|null;equipmentName:string|null;projectId:string|null;projectName:string|null;destinationType?:FuelDestinationType|null;companySiteId?:string|null;companySiteName?:string|null;companySiteIsActive?:boolean|null;ticketNumber:string|null;odometerReading:string|null;reason:string|null;notes:string|null;fuelPriceHistoryId:string|null;pricePerLitreUsd:number|null;priceOverrideReason:string|null;consumptionCostUsd:number|null;subtotalUsd:number|null;vatRatePercent:number|null;vatAmountUsd:number|null;finalTotalUsd:number|null;paymentStatus:string;status:FuelMovementStatus;cancellationReason:string|null;cancelledAt:string|null;balanceAfterLitres:number};
export type FuelOverview={currentBalanceLitres:number;hasKnownBalance:boolean;latestGauge:FuelMovement|null;movements:FuelMovement[]};
export type ProjectEquipmentFuelUsage={equipmentId:string|null;equipmentName:string;totalLitres:number;totalCostUsd:number;unpricedLitres:number;fillCount:number;fills:FuelMovement[]};
export type FuelMovementFilters={projectId?:string;equipmentId?:string;type?:FuelMovementType|'all';status?:FuelMovementStatus|'all';fromDate?:string;toDate?:string};
export type FuelDeliveryDraft={recordDate:string;litres:string;supplierId:string;ticketNumber:string;pricePerLitreUsd:string;updateCurrentPrice:boolean;notes:string};
// destinationType and companySiteId are optional so a draft saved before DEC-438 still resolves:
// its destination is derived from projectId.
export type FuelFillDraft={recordDate:string;fuelType:FuelType;litres:string;equipmentType:FuelEquipmentType;equipmentId:string;destinationType?:FuelDestinationType;projectId:string;companySiteId?:string;odometerReading:string;pricePerLitreUsd:string;priceOverrideReason:string;notes:string};
export type FuelGaugeDraft={recordDate:string;actualLitres:string;reason:string;notes:string};
export type FuelPriceDraft={fuelType:FuelType;pricePerLitreUsd:string;reason:string};
export type FuelFillCorrectionDraft=FuelFillDraft&{correctionReason:string};
export type FuelDeliveryCorrectionDraft=Omit<FuelDeliveryDraft,'updateCurrentPrice'>&{correctionReason:string};
export const emptyFuelDelivery:FuelDeliveryDraft={recordDate:localDateKey(new Date()),litres:'',supplierId:'',ticketNumber:'',pricePerLitreUsd:'',updateCurrentPrice:true,notes:''};
export const emptyFuelFill:FuelFillDraft={recordDate:localDateKey(new Date()),fuelType:'diesel',litres:'',equipmentType:'machine',equipmentId:'',destinationType:'unassigned',projectId:'',companySiteId:'',odometerReading:'',pricePerLitreUsd:'',priceOverrideReason:'',notes:''};
export const emptyFuelGauge:FuelGaugeDraft={recordDate:localDateKey(new Date()),actualLitres:'',reason:'',notes:''};
export const emptyFuelPrice:FuelPriceDraft={fuelType:'diesel',pricePerLitreUsd:'',reason:''};

const decimal=(value:string)=>Number(value.trim().replace(',','.'));
const decimalFormat=(value:string)=>/^\d+([.,]\d+)?$/.test(value.trim());
export function validatePositiveLitres(value:string):number{const parsed=decimal(value);if(!decimalFormat(value)||!Number.isFinite(parsed)||parsed<=0)throw new Error('Litres must be a number greater than zero.');return parsed;}
export function validateGaugeLitres(value:string):number{const parsed=decimal(value);if(!decimalFormat(value)||!Number.isFinite(parsed)||parsed<0)throw new Error('Actual gauge litres must be a number zero or greater.');return parsed;}
export function validateFuelPrice(value:string,required=false):number|null{if(!value.trim()){if(required)throw new Error('Fuel price per litre is required.');return null;}const parsed=decimal(value);if(!Number.isFinite(parsed)||parsed<0||!/^\d+([.,]\d{1,2})?$/.test(value.trim()))throw new Error('Price per litre must be zero or greater with no more than two decimals.');return parsed;}
export function calculateFuelDelivery(litres:number,priceText:string,vatRatePercent:number){const price=validateFuelPrice(priceText);if(price==null)return{pricePerLitreUsd:null,subtotalUsd:null,vatAmountUsd:null,finalTotalUsd:null};const subtotal=Math.round(litres*price*100)/100;const vat=Math.round(subtotal*vatRatePercent)/100;return{pricePerLitreUsd:price,subtotalUsd:subtotal,vatAmountUsd:vat,finalTotalUsd:Math.round((subtotal+vat)*100)/100};}
export function calculateFuelFillCost(litres:number,priceText:string):{pricePerLitreUsd:number|null;consumptionCostUsd:number|null}{const price=validateFuelPrice(priceText);return{pricePerLitreUsd:price,consumptionCostUsd:price==null?null:Math.round(litres*price*100)/100};}

// The tank holds diesel only (DEC-392), so the running balance is computed from diesel movements
// alone. A gasoline fill is a purchase-and-consume event with no stock effect: it passes through
// carrying the diesel balance unchanged, and never contributes previous/difference litres.
export function applyFuelLedger(movements:Omit<FuelMovement,'balanceAfterLitres'>[]):FuelMovement[]{let balance=0;return [...movements].sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt)).map(movement=>{let previousBalanceLitres=movement.previousBalanceLitres;let differenceLitres=movement.differenceLitres;if(movement.status==='Active'&&movement.fuelType==='diesel'){if(movement.type==='gauge'){previousBalanceLitres=balance;differenceLitres=movement.litres-balance;balance=movement.litres;}else if(movement.type==='delivery')balance+=movement.litres;else balance-=movement.litres;}return{...movement,previousBalanceLitres,differenceLitres,balanceAfterLitres:balance};});}

export function groupProjectFuelByEquipment(movements:FuelMovement[],projectId:string):ProjectEquipmentFuelUsage[]{
  const groups=new Map<string,ProjectEquipmentFuelUsage>();
  movements.filter(value=>value.type==='fill'&&value.status==='Active'&&value.projectId===projectId).forEach(fill=>{const key=`${fill.equipmentType}:${fill.equipmentId??`name:${fill.equipmentName??'Unknown equipment'}`}`;const current=groups.get(key)??{equipmentId:key,equipmentName:fill.equipmentName??'Unknown equipment',totalLitres:0,totalCostUsd:0,unpricedLitres:0,fillCount:0,fills:[]};current.totalLitres+=fill.litres;current.totalCostUsd+=fill.consumptionCostUsd??0;if(fill.consumptionCostUsd==null)current.unpricedLitres+=fill.litres;current.fillCount+=1;current.fills.push(fill);groups.set(key,current);});
  return [...groups.values()].map(group=>({...group,fills:[...group.fills].sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt))})).sort((a,b)=>b.totalLitres-a.totalLitres||a.equipmentName.localeCompare(b.equipmentName));
}

export function filterFuelMovements(movements:FuelMovement[],filters:FuelMovementFilters):FuelMovement[]{return movements.filter(value=>(!filters.projectId||value.projectId===filters.projectId)&&(!filters.equipmentId||value.equipmentId===filters.equipmentId)&&(!filters.type||filters.type==='all'||value.type===filters.type)&&(!filters.status||filters.status==='all'||value.status===filters.status)&&(!filters.fromDate||localDateKey(value.confirmedAt)>=filters.fromDate)&&(!filters.toDate||localDateKey(value.confirmedAt)<=filters.toDate));}

// DEC-438. The one place a fill's destination and its links are decided. The chosen type wins and
// every link it does not use is cleared, so a hidden selection left in a form can never be stored.
export type ResolvedFuelDestination={destinationType:FuelDestinationType;projectId:string|null;companySiteId:string|null};
export function resolveFuelDestination(input:{destinationType?:FuelDestinationType;projectId?:string|null;companySiteId?:string|null}):ResolvedFuelDestination{
  const projectId=input.projectId?.trim()||null,companySiteId=input.companySiteId?.trim()||null;
  const destinationType=input.destinationType??(projectId?'project':'unassigned');
  if(destinationType==='project'){if(!projectId)throw new Error('Select a project for this fuel destination.');return{destinationType,projectId,companySiteId:null};}
  if(destinationType==='company_site'){if(!companySiteId)throw new Error('Select a company site for this fuel destination.');return{destinationType,projectId:null,companySiteId};}
  if(destinationType==='unassigned')return{destinationType,projectId:null,companySiteId:null};
  throw new Error('Choose a valid fuel destination.');
}
/** A fill stored before DEC-438, or read without the column, is placed by its project link. */
export function fillDestinationType(movement:Pick<FuelMovement,'destinationType'|'projectId'>):FuelDestinationType{return movement.destinationType??(movement.projectId?'project':'unassigned');}
/** Display form of a company site name: trimmed and internally collapsed, case preserved. */
export function normalizeCompanySiteName(name:string):string{return name.trim().replace(/\s+/g,' ');}
/** Duplicate-detection key: the same trim, collapse, and case-fold rule customers and consulting agencies use. */
export function companySiteKey(name:string):string{return normalizeCompanySiteName(name).toLocaleLowerCase('en-US');}
/**
 * Sites a fill's company-site selector may offer: every active site, plus the site the record already
 * uses when that site has since been deactivated, so correcting other fields never forces a move.
 */
export function companySiteChoices(sites:CompanySite[],currentSiteId:string|null):{id:string;label:string;detail?:string}[]{
  return sites.filter(site=>site.isActive||site.id===currentSiteId).map(site=>site.isActive?{id:site.id,label:site.name}:{id:site.id,label:site.name,detail:'Inactive site kept from this record'});
}
export function describeFuelDestination(value:{destinationType:FuelDestinationType;projectName:string|null;companySiteName:string|null}):string{
  if(value.destinationType==='project')return `Project: ${value.projectName??'Unknown project'}`;
  if(value.destinationType==='company_site')return `Company Site: ${value.companySiteName??'Unknown company site'}`;
  return 'Unassigned';
}

const money=(value:number)=>`$${value.toFixed(2)}`;
/** A missing price is never shown as $0.00: a destination with no priced fill has no cost to show. */
export function fuelUsageCostLabel(usage:{pricedCostUsd:number;pricedFillCount:number}):string{return usage.pricedFillCount>0?money(usage.pricedCostUsd):'Cost unavailable';}
export function fillCostLabel(fill:{consumptionCostUsd:number|null}):string{return fill.consumptionCostUsd==null?'Cost unavailable':money(fill.consumptionCostUsd);}

export type FuelDestinationFilter='all'|FuelDestinationType;
export type FuelUsageTotals={totalLitres:number;pricedCostUsd:number;unpricedLitres:number;unpricedFillCount:number;fillCount:number};
export type FuelDestinationUsage=FuelUsageTotals&{key:string;destinationType:FuelDestinationType;destinationId:string|null;name:string;isActive:boolean;pricedFillCount:number;fuelTypes:Record<FuelType,{litres:number;fillCount:number}>;fills:FuelMovement[]};
export type FuelDestinationReview={groups:FuelDestinationUsage[];totals:FuelUsageTotals};
const destinationOrder:Record<FuelDestinationType,number>={project:0,company_site:1,unassigned:2};
const roundCents=(value:number)=>Math.round(value*100)/100;
const roundLitres=(value:number)=>Math.round(value*1000)/1000;

/**
 * DEC-438. Active equipment fills grouped by where the fuel went: each project, each company site,
 * and Unassigned. Purchases, gauge readings, and cancelled fills are never counted. Unpriced fills
 * add litres but no cost. `query` matches a destination name (keeping all its fills) or a fill's
 * equipment or notes (keeping only matching fills); totals always describe exactly the fills shown,
 * so the groups reconcile with the overall total.
 */
export function groupFuelUsageByDestination(movements:FuelMovement[],options:{filter?:FuelDestinationFilter;query?:string}={}):FuelDestinationReview{
  const filter=options.filter??'all',query=(options.query??'').trim().toLocaleLowerCase('en-US');
  const groups=new Map<string,FuelDestinationUsage>();
  for(const fill of movements){
    if(fill.type!=='fill'||fill.status!=='Active')continue;
    const destinationType=fillDestinationType(fill);
    if(filter!=='all'&&destinationType!==filter)continue;
    const destinationId=destinationType==='project'?fill.projectId:destinationType==='company_site'?fill.companySiteId??null:null;
    const name=destinationType==='project'?fill.projectName??'Unknown project':destinationType==='company_site'?fill.companySiteName??'Unknown company site':'Unassigned';
    if(query&&!name.toLocaleLowerCase('en-US').includes(query)&&!`${fill.equipmentName??''}\n${fill.notes??''}`.toLocaleLowerCase('en-US').includes(query))continue;
    const key=destinationType==='unassigned'?'unassigned':`${destinationType}:${destinationId??name}`;
    const group=groups.get(key)??{key,destinationType,destinationId,name,isActive:destinationType!=='company_site'||fill.companySiteIsActive!==false,totalLitres:0,pricedCostUsd:0,pricedFillCount:0,unpricedLitres:0,unpricedFillCount:0,fillCount:0,fuelTypes:{diesel:{litres:0,fillCount:0},gasoline:{litres:0,fillCount:0}},fills:[]};
    group.totalLitres+=fill.litres;group.fillCount+=1;
    group.fuelTypes[fill.fuelType].litres+=fill.litres;group.fuelTypes[fill.fuelType].fillCount+=1;
    if(fill.consumptionCostUsd==null){group.unpricedLitres+=fill.litres;group.unpricedFillCount+=1;}else{group.pricedCostUsd+=fill.consumptionCostUsd;group.pricedFillCount+=1;}
    group.fills.push(fill);groups.set(key,group);
  }
  const ordered=[...groups.values()].map(group=>({...group,totalLitres:roundLitres(group.totalLitres),pricedCostUsd:roundCents(group.pricedCostUsd),unpricedLitres:roundLitres(group.unpricedLitres),fuelTypes:{diesel:{...group.fuelTypes.diesel,litres:roundLitres(group.fuelTypes.diesel.litres)},gasoline:{...group.fuelTypes.gasoline,litres:roundLitres(group.fuelTypes.gasoline.litres)}},fills:[...group.fills].sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt))}))
    .sort((a,b)=>destinationOrder[a.destinationType]-destinationOrder[b.destinationType]||b.totalLitres-a.totalLitres||a.name.localeCompare(b.name));
  const totals=ordered.reduce<FuelUsageTotals>((sum,group)=>({totalLitres:sum.totalLitres+group.totalLitres,pricedCostUsd:sum.pricedCostUsd+group.pricedCostUsd,unpricedLitres:sum.unpricedLitres+group.unpricedLitres,unpricedFillCount:sum.unpricedFillCount+group.unpricedFillCount,fillCount:sum.fillCount+group.fillCount}),{totalLitres:0,pricedCostUsd:0,unpricedLitres:0,unpricedFillCount:0,fillCount:0});
  return{groups:ordered,totals:{...totals,totalLitres:roundLitres(totals.totalLitres),pricedCostUsd:roundCents(totals.pricedCostUsd),unpricedLitres:roundLitres(totals.unpricedLitres)}};
}

export type FuelPeriodTotals={purchasedLitres:number;purchaseCostUsd:number;consumedLitres:number;consumptionCostUsd:number;unpricedFillLitres:number};
export type FuelCostBreakdown={id:string;name:string;litres:number;costUsd:number;unpricedLitres:number;fillCount:number};
export type FuelDashboard={today:FuelPeriodTotals;month:FuelPeriodTotals;destinations:FuelDestinationUsage[];equipment:FuelCostBreakdown[]};
export function localDateKey(value:string|Date):string{const date=value instanceof Date?value:new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function periodTotals(movements:FuelMovement[],predicate:(date:string)=>boolean):FuelPeriodTotals{return movements.filter(v=>v.status==='Active'&&predicate(localDateKey(v.confirmedAt))).reduce((total,v)=>{if(v.type==='delivery'){total.purchasedLitres+=v.litres;total.purchaseCostUsd+=v.finalTotalUsd??0;}else if(v.type==='fill'){total.consumedLitres+=v.litres;total.consumptionCostUsd+=v.consumptionCostUsd??0;if(v.consumptionCostUsd==null)total.unpricedFillLitres+=v.litres;}return total;},{purchasedLitres:0,purchaseCostUsd:0,consumedLitres:0,consumptionCostUsd:0,unpricedFillLitres:0});}
function equipmentBreakdown(fills:FuelMovement[]):FuelCostBreakdown[]{const result=new Map<string,FuelCostBreakdown>();for(const fill of fills){const groupKey=fill.equipmentId??`unassigned:${fill.equipmentName??'equipment'}`;const current=result.get(groupKey)??{id:fill.equipmentId??'',name:fill.equipmentName??'Unknown equipment',litres:0,costUsd:0,unpricedLitres:0,fillCount:0};current.litres+=fill.litres;current.costUsd+=fill.consumptionCostUsd??0;if(fill.consumptionCostUsd==null)current.unpricedLitres+=fill.litres;current.fillCount+=1;result.set(groupKey,current);}return [...result.values()].sort((a,b)=>b.litres-a.litres||a.name.localeCompare(b.name));}
export function buildFuelDashboard(movements:FuelMovement[],now=new Date()):FuelDashboard{const today=localDateKey(now),month=today.slice(0,7),activeMonthFills=movements.filter(v=>v.status==='Active'&&v.type==='fill'&&localDateKey(v.confirmedAt).startsWith(month));return{today:periodTotals(movements,date=>date===today),month:periodTotals(movements,date=>date.startsWith(month)),destinations:groupFuelUsageByDestination(activeMonthFills).groups,equipment:equipmentBreakdown(activeMonthFills)};}
