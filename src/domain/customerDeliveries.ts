import type {CompanyTotalsRecord} from '../data/repositories/CompanyTotalsRepository';
import {emptyCompanyTotalsFilters,type CompanyTotalsFilters} from './companyTotals';
import {NOT_RECORDED} from './projectTotalsPdf';
import {formatRecordedAt,recordTitle} from './recordFormat';
import {describeTotalsRange,formatTotalQuantity} from './projectTotals';

/**
 * The customer page's "Delivered to this customer": the Company Totals filter narrowed to one customer, plus the page's
 * own date range, project and material. Nothing here calculates a total: the figures come from the same grouped SQL as every
 * other Totals screen, so the page, the PDF and Company Totals always agree.
 */
export type CustomerDeliveryScope={fromDate:string;toDate:string;projectKey:string;itemKey:string};
export const emptyCustomerDeliveryScope=():CustomerDeliveryScope=>({fromDate:'',toDate:'',projectKey:'',itemKey:''});

export function customerDeliveryFilters(customerId:string,scope:CustomerDeliveryScope):CompanyTotalsFilters{
  return {...emptyCompanyTotalsFilters(),customerKeys:[customerId],fromDate:scope.fromDate,toDate:scope.toDate,projectKey:scope.projectKey,itemKey:scope.itemKey,view:'delivered'};
}

/** How many of the page's own filters are on (the customer itself is the page, not a filter). */
export const countCustomerDeliveryFilters=(scope:CustomerDeliveryScope):number=>[scope.fromDate||scope.toDate,scope.projectKey,scope.itemKey].filter(Boolean).length;

/** The filter line printed on the PDF, so the export says exactly what it covers. */
export function customerDeliveryLabels(customerName:string,scope:CustomerDeliveryScope,names:{project?:string|null;item?:string|null}):string[]{
  return [describeTotalsRange(scope.fromDate,scope.toDate),`Customer: ${customerName}`,
    ...(scope.projectKey&&names.project?[`Project: ${names.project}`]:[]),...(scope.itemKey&&names.item?[`Item: ${names.item}`]:[])];
}

/** One delivered load as the history lists it: no money, "Not recorded" instead of a blank, legacy loads labelled as such. */
export type DeliveredLoadLine={title:string;legacy:boolean;transaction:string;when:string;material:string;project:string;destination:string;status:'Active';destinationRecorded:boolean};
export function describeDeliveredLoad(record:CompanyTotalsRecord):DeliveredLoadLine{
  const s=record.snapshot,destination=record.details?.destination?.trim()||null;
  return {title:recordTitle(s),legacy:!s.loadNumber,transaction:s.reference,when:formatRecordedAt(s.recordedAt),
    material:`${s.itemName} · ${formatTotalQuantity(s.quantity,s.unitSymbol)}`,project:s.projectName??'No project',destination:destination??NOT_RECORDED,destinationRecorded:destination!=null,status:'Active'};
}
