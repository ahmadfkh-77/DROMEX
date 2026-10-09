import type {FuelDestinationType} from './fuel';
import {localDateKey} from './fuel';
import type {BatchDetail} from './fuelBatches';
import {purchaseDestination,purchaseDestinationName,type QuarryPurchase} from './quarry';
import {supplierDieselDeliveries,type SupplierDieselSummary} from './supplierDiesel';

/**
 * DEC-506. The PDF of what one supplier delivered. It is headed "Totals" with the supplier's name in bold, groups the
 * Active loads by where they went (each project, each company site, unassigned) and lists every load with its number
 * and prefix, exactly as recorded. Units are never added together, a missing price is "Unpriced" (never $0), cancelled
 * loads are left out, and diesel is its own litres section. It is an export only: no record changes.
 */
export const NOT_RECORDED='Not recorded';
export type SupplierPdfFilters={fromDate?:string;toDate?:string;/** Item ids; empty or absent = every material. */itemIds?:string[];/** Destination keys (see purchaseDestination); empty or absent = everywhere. */destinationKeys?:string[];includePrices:boolean;includeDiesel:boolean};

export type SupplierPdfLoad={id:string;reference:string;recordedAt:string;item:string;quantityText:string;driver:string;ticket:string|null;status:'Active'|'Corrected';statusNote:string|null;unitPrice?:string;total?:string};
export type SupplierPdfTotal={item:string;unitSymbol:string;quantity:number;quantityText:string;count:number};
export type SupplierPdfDestination={key:string;type:FuelDestinationType;name:string;label:string;loads:SupplierPdfLoad[];totals:SupplierPdfTotal[];unpricedCount:number};
export type SupplierPdfDiesel={rows:{date:string;batchNumber:string;invoice:string;litres:string;price?:string;amount?:string}[];totalLitres:string;batchCount:number;amount?:string;unpricedNote:string|null};
export type SupplierDeliveriesPdf={
  supplierName:string;generatedAt:string;
  meta:{label:string;value:string}[];
  destinations:SupplierPdfDestination[];
  totals:SupplierPdfTotal[];
  loadCount:number;
  diesel:SupplierPdfDiesel|null;
  includePrices:boolean;
  empty:boolean;
  fileName:string;
};

const round=(value:number)=>Math.round(value*1000000)/1000000;
const quantityText=(value:number,unitSymbol:string)=>`${Math.round(value*1000)/1000} ${unitSymbol}`.trim();
const money=(value:number)=>`$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** "10 Sep 2026", the same on every device (no locale-dependent month names). */
export const pdfDayLabel=(day:string)=>{const [year,month,date]=day.slice(0,10).split('-').map(Number);return year&&month&&date?`${date} ${MONTHS[month-1]} ${year}`:day;};
const dayLabel=pdfDayLabel;
const ORDER:Record<FuelDestinationType,number>={project:0,company_site:1,unassigned:2};

/** What the Export PDF sheet offers for one supplier: its materials and where they went, with counts. */
export function supplierPdfChoices(purchases:readonly QuarryPurchase[],supplierId:string){
  const own=purchases.filter(purchase=>purchase.supplierId===supplierId&&purchase.status==='Active');
  const items=new Map<string,{id:string;name:string;unitSymbol:string;quantity:number;count:number}>(),destinations=new Map<string,{key:string;type:FuelDestinationType;name:string;count:number}>();
  for(const purchase of own){
    const itemKey=`${purchase.itemId}|${purchase.unitId}`,item=items.get(itemKey)??{id:purchase.itemId,name:purchase.itemName,unitSymbol:purchase.unitSymbol,quantity:0,count:0};
    item.quantity=round(item.quantity+purchase.quantityCubicMetres);item.count+=1;items.set(itemKey,item);
    const destination=purchaseDestination(purchase),existing=destinations.get(destination.key)??{key:destination.key,type:destination.type,name:purchaseDestinationName(purchase)??'Unassigned',count:0};
    existing.count+=1;destinations.set(destination.key,existing);
  }
  return {
    items:[...items.values()].sort((a,b)=>a.name.localeCompare(b.name)),
    destinations:[...destinations.values()].sort((a,b)=>ORDER[a.type]-ORDER[b.type]||a.name.localeCompare(b.name)),
  };
}

export function buildSupplierDeliveriesPdf(input:{supplierId:string;supplierName:string;purchases:readonly QuarryPurchase[];batches?:readonly BatchDetail[];filters:SupplierPdfFilters;generatedAt:string}):SupplierDeliveriesPdf{
  const {filters}=input;
  const itemSet=new Set(filters.itemIds??[]),destinationSet=new Set(filters.destinationKeys??[]);
  const loads=input.purchases.filter(purchase=>{
    if(purchase.supplierId!==input.supplierId||purchase.status!=='Active')return false;
    const day=localDateKey(purchase.confirmedAt);
    if(filters.fromDate&&day<filters.fromDate)return false;
    if(filters.toDate&&day>filters.toDate)return false;
    if(itemSet.size&&!itemSet.has(purchase.itemId))return false;
    if(destinationSet.size&&!destinationSet.has(purchaseDestination(purchase).key))return false;
    return true;
  });
  const addTotal=(map:Map<string,SupplierPdfTotal>,purchase:QuarryPurchase)=>{
    const key=`${purchase.itemId}|${purchase.unitId}`,current=map.get(key)??{item:purchase.itemName,unitSymbol:purchase.unitSymbol,quantity:0,quantityText:'',count:0};
    current.quantity=round(current.quantity+purchase.quantityCubicMetres);current.count+=1;map.set(key,current);
  };
  const finish=(map:Map<string,SupplierPdfTotal>)=>[...map.values()].map(total=>({...total,quantityText:quantityText(total.quantity,total.unitSymbol)})).sort((a,b)=>a.item.localeCompare(b.item)||a.unitSymbol.localeCompare(b.unitSymbol));
  const groups=new Map<string,{key:string;type:FuelDestinationType;name:string;purchases:QuarryPurchase[]}>();
  const overall=new Map<string,SupplierPdfTotal>();
  for(const purchase of loads){
    const destination=purchaseDestination(purchase),group=groups.get(destination.key)??{key:destination.key,type:destination.type,name:purchaseDestinationName(purchase)??'Unassigned',purchases:[]};
    group.purchases.push(purchase);groups.set(destination.key,group);addTotal(overall,purchase);
  }
  const destinations=[...groups.values()].sort((a,b)=>ORDER[a.type]-ORDER[b.type]||a.name.localeCompare(b.name)).map((group):SupplierPdfDestination=>{
    const totals=new Map<string,SupplierPdfTotal>();
    for(const purchase of group.purchases)addTotal(totals,purchase);
    const label=group.type==='company_site'?`${group.name} (Site)`:group.type==='unassigned'?'Unassigned deliveries':group.name;
    return {
      key:group.key,type:group.type,name:group.name,label,totals:finish(totals),
      unpricedCount:group.purchases.filter(purchase=>purchase.unitPriceUsd==null||purchase.finalTotalUsd==null).length,
      loads:[...group.purchases].sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt)||a.purchaseNumber.localeCompare(b.purchaseNumber)).map((purchase):SupplierPdfLoad=>{
        const edited=purchase.correctionHistory.length>0;
        const base:SupplierPdfLoad={
          id:purchase.id,reference:purchase.purchaseNumber,recordedAt:purchase.confirmedAt,item:purchase.itemName,quantityText:quantityText(purchase.quantityCubicMetres,purchase.unitSymbol),
          driver:purchase.deliveryMethod==='supplier'?(purchase.truckPlate.trim()?`Supplier Delivering · ${purchase.truckPlate.trim()}`:'Supplier Delivering'):[purchase.driverName,purchase.truckPlate].map(value=>value.trim()).filter(Boolean).join(' · ')||NOT_RECORDED,
          ticket:purchase.supplierTicketNumber?.trim()||null,status:edited?'Corrected':'Active',statusNote:edited?'Corrected after confirmation':null,
        };
        return filters.includePrices?{...base,unitPrice:purchase.unitPriceUsd==null?'Unpriced':money(purchase.unitPriceUsd),total:purchase.finalTotalUsd==null?'Unpriced':money(purchase.finalTotalUsd)}:base;
      }),
    };
  });

  let diesel:SupplierPdfDiesel|null=null;
  if(filters.includeDiesel&&input.batches){
    const summary:SupplierDieselSummary=supplierDieselDeliveries(input.batches,input.supplierId,{fromDate:filters.fromDate,toDate:filters.toDate});
    if(summary.batchCount){
      diesel={
        batchCount:summary.batchCount,totalLitres:`${summary.totalLitres.toLocaleString('en-US',{maximumFractionDigits:3})} L`,unpricedNote:summary.unpricedNote,
        amount:filters.includePrices?(summary.pricedAmountUsd==null?'Unpriced':money(summary.pricedAmountUsd)):undefined,
        rows:summary.rows.map(row=>{const base={date:dayLabel(row.day),batchNumber:row.batchNumber,invoice:row.invoiceNumber??NOT_RECORDED.toLowerCase(),litres:`${row.litres.toLocaleString('en-US',{maximumFractionDigits:3})} L`};return filters.includePrices?{...base,price:row.pricePerLitreUsd==null?'Unpriced':money(row.pricePerLitreUsd),amount:row.totalUsd==null?'Unpriced':money(row.totalUsd)}:base;}),
      };
    }
  }

  const choices=supplierPdfChoices(input.purchases,input.supplierId);
  const materialNames=[...new Set(choices.items.filter(item=>itemSet.has(item.id)).map(item=>item.name))];
  const destinationNames=choices.destinations.filter(destination=>destinationSet.has(destination.key)).map(destination=>destination.type==='company_site'?`${destination.name} (Site)`:destination.name);
  const period=filters.fromDate||filters.toDate?`${filters.fromDate?dayLabel(filters.fromDate):'The start'} – ${filters.toDate?dayLabel(filters.toDate):'Today'}`:'All dates';
  const safe=(value:string)=>value.replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'')||'Supplier';
  return {
    supplierName:input.supplierName,generatedAt:input.generatedAt,
    meta:[
      {label:'Dates',value:period},{label:'Destinations',value:destinationNames.length?destinationNames.join(', '):'All projects and sites'},
      {label:'Materials',value:materialNames.length?materialNames.join(', '):'All'},{label:'Prices',value:filters.includePrices?'Included (recorded prices only)':'Excluded'},
    ],
    destinations,totals:finish(overall),loadCount:loads.length,diesel,includePrices:filters.includePrices,
    empty:!loads.length&&!diesel,
    fileName:`Totals-${safe(input.supplierName)}-${filters.fromDate||filters.toDate?`${filters.fromDate||'start'}_to_${filters.toDate||'today'}`:localDateKey(input.generatedAt)}.pdf`,
  };
}
