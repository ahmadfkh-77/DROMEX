import type {EligibleRecordQuery} from './businessDocuments';
import {COMPANY_SUPPLIER_KEY,LEGACY_SERIES_KEY,NO_PROJECT_KEY,type CompanyTotalsFilters} from './companyTotals';

/** The eligible-record queries a totals node maps to: one or both sides, narrowed like the node. */
export function queriesFor(filters:CompanyTotalsFilters,presetKeys?:string[]):EligibleRecordQuery[]{
  const base:Omit<EligibleRecordQuery,'side'>={fromDate:filters.fromDate||undefined,toDate:filters.toDate||undefined,itemKey:filters.itemKey||undefined,unitKey:filters.unitKey||undefined,inclusion:filters.inclusion,
    projectId:filters.projectKey?(filters.projectKey===NO_PROJECT_KEY?'':filters.projectKey):undefined,recordKeys:presetKeys};
  const customer:EligibleRecordQuery={...base,side:'customer',customerKeys:filters.customerKeys.length?filters.customerKeys:undefined,seriesId:filters.seriesId&&filters.seriesId!==LEGACY_SERIES_KEY?filters.seriesId:undefined};
  const supplier:EligibleRecordQuery={...base,side:'supplier',partyId:filters.supplierKey.startsWith('id:')?filters.supplierKey.slice(3):undefined};
  if(filters.view==='used')return [];
  // A chosen customer means company loads only; a supplier chosen as well can match nothing.
  if(filters.customerKeys.length)return filters.supplierKey.startsWith('id:')?[]:[customer];
  if(filters.supplierKey===COMPANY_SUPPLIER_KEY||filters.seriesId)return [customer];
  if(filters.supplierKey)return [supplier];
  return [customer,supplier];
}

