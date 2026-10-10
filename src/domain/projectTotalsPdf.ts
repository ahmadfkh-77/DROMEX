import type {RecordSnapshot} from './businessDocuments';
import {formatCents} from './recordFormat';

/**
 * Project Totals PDF: the Customer and Supplier boxes under the header, and the price columns of the
 * delivered-loads sections. Pure wording rules, so the PDF and its tests read the same words. Nothing
 * here calculates a total, and a missing value is "Not recorded", never blank and never zero.
 */
export const NOT_RECORDED='Not recorded';
export const INTERNAL_PROJECT='Internal project';

export type CustomerBox={label:string;note:string|null};

/**
 * A project always links to one customer (`projects.customer_id`). The owner's own company is that
 * customer for the owner's own projects (DEC-006), so its projects read "Internal project".
 */
export function customerBox(customer:{name:string;isOwnCompany:boolean}|null|undefined):CustomerBox{
  if(!customer||!customer.name.trim())return {label:NOT_RECORDED,note:null};
  if(customer.isOwnCompany)return {label:INTERNAL_PROJECT,note:'Customer is the own company'};
  return {label:customer.name.trim(),note:null};
}

/** The supplier of one record: the issuing company's real name on an own load, the outside supplier on an incoming one; null when unknown. */
export function supplierNameOf(record:{snapshot:Pick<RecordSnapshot,'recordType'|'partyName'>;details?:{supplierName?:string|null}}):string|null{
  const issued=record.details?.supplierName?.trim();
  if(issued)return issued;
  return record.snapshot.recordType==='supplier_load'?record.snapshot.partyName.trim()||null:null;
}

export type SupplierBox={label:string;names:string[]};

/**
 * Whoever issued the material in the exported period: the Plant Company by its real name (as issued on each own
 * load) and every outside supplier. It never depends on the Header company picker.
 */
export function supplierBox(records:readonly {snapshot:Pick<RecordSnapshot,'recordType'|'partyName'>;details?:{supplierName?:string|null}}[]):SupplierBox{
  const names=[...new Set(records.map(record=>supplierNameOf(record)).filter((name):name is string=>Boolean(name)))]
    .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true}));
  if(!names.length)return {label:'None in this period',names:[]};
  if(names.length===1)return {label:names[0]!,names:[]};
  return {label:`Multiple suppliers (${names.length})`,names};
}

/** The price exactly as recorded; an unpriced record is never shown as $0.00. */
export function priceAsRecorded(record:Pick<RecordSnapshot,'unitPriceCents'|'priceBasis'|'unitSymbol'>):string{
  if(record.unitPriceCents==null)return 'No price recorded';
  return record.priceBasis==='whole'?`${formatCents(record.unitPriceCents)} for the whole delivery`:`${formatCents(record.unitPriceCents)} per ${record.unitSymbol}`;
}

/** "VAT 11% · $1,683.87", or the total alone when the record has no VAT rate. */
export function vatAndTotal(record:Pick<RecordSnapshot,'totalCents'|'vatRateBasisPoints'>):string{
  if(record.totalCents==null)return NOT_RECORDED;
  return record.vatRateBasisPoints?`VAT ${record.vatRateBasisPoints/100}% · ${formatCents(record.totalCents)}`:formatCents(record.totalCents);
}

/** Who drove: "Driver · plate" for our own driver, or the supplier's own delivery. */
export function deliveredByLabel(details:{driverName:string|null;truckPlate:string|null;deliveredBy:'company'|'supplier'|null}|undefined):{main:string;sub:string|null}{
  if(!details)return {main:NOT_RECORDED,sub:null};
  if(details.deliveredBy==='supplier')return {main:'Supplier delivering',sub:details.truckPlate?`Plate ${details.truckPlate}`:null};
  const person=details.driverName,plate=details.truckPlate;
  if(!person&&!plate)return {main:NOT_RECORDED,sub:null};
  return {main:person??plate!,sub:person&&plate?plate:null};
}

/** Whole-period quantity per unit for a set of records; units are never added together. */
export function unitTotals(records:readonly {snapshot:Pick<RecordSnapshot,'unitKey'|'unitSymbol'|'quantity'>}[]):{unitKey:string;unitSymbol:string;quantity:number;count:number}[]{
  const byUnit=new Map<string,{unitKey:string;unitSymbol:string;quantity:number;count:number}>();
  for(const {snapshot} of records){
    const entry=byUnit.get(snapshot.unitKey)??{unitKey:snapshot.unitKey,unitSymbol:snapshot.unitSymbol,quantity:0,count:0};
    entry.quantity=Math.round((entry.quantity+snapshot.quantity)*1e6)/1e6;entry.count+=1;byUnit.set(snapshot.unitKey,entry);
  }
  return [...byUnit.values()].sort((a,b)=>a.unitSymbol.localeCompare(b.unitSymbol,undefined,{numeric:true}));
}

/** The Company Settings contact line under the company name on a PDF: address, phone, email, Tax/VAT. Nothing when none is saved. */
export function companyContactLine(company:{address:string|null;phone:string|null;email:string|null;taxVatNumber:string|null}):string|null{
  const parts=[company.address,company.phone,company.email,company.taxVatNumber?.trim()?`Tax/VAT: ${company.taxVatNumber.trim()}`:null].map(value=>value?.trim()).filter(Boolean);
  return parts.length?parts.join(' · '):null;
}

/** "Transaction 20261005-A-00123 · ASP series": the prefix is read from the saved number itself (ASP-00001), never invented. */
export function companyLoadReference(record:Pick<RecordSnapshot,'reference'|'loadNumber'>):string{
  const prefix=record.loadNumber?.match(/^(.+?)-\d+$/)?.[1]??null;
  return prefix?`Transaction ${record.reference} · ${prefix} series`:`Transaction ${record.reference}`;
}
