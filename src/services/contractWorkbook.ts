import type {WorkbookRow} from '../domain/businessReports';
import type {ContractReport} from '../domain/contractReport';
import {buildWorkbookFromSheets,type SheetSpec} from './businessWorkbook';

/**
 * DEC-522 Phase E. The Contract Quantities workbook: the same facts as the PDF, as Excel sheets with numeric columns and a data dictionary.
 * Each item keeps its own unit and quantities of different units are never added. Price, leftover and saving columns exist only with prices;
 * every used quantity and percent is identical in both versions.
 */
export function contractWorkbookSheets(report:ContractReport,company:{name:string}):SheetSpec[]{
  const prices=report.includePrices;
  const items:WorkbookRow[]=report.rows.map(row=>{
    const value:WorkbookRow={Item:row.name,Materials:row.materials,Unit:row.unit,'Contract Quantity':row.contract,'From Loads':row.fromLoads,Adjustments:row.adjustments,Used:row.used,Remaining:row.remaining,'% Used':row.percentUsed,Status:row.status};
    if(prices){value['Contract Price USD']=row.contractPriceUsd;value['Leftover']=row.leftover;value['Saving USD']=row.savingUsd;value['Saving Is Estimate']=row.savingUsd===null?'':row.savingIsEstimate?'Yes':'No';}
    return value;
  });
  const notCounted:WorkbookRow[]=report.notCounted.map(value=>({Load:value.load,Item:value.item,Quantity:value.quantity,Why:value.why}));
  const info:WorkbookRow[]=[
    {Metric:'Report',Value:report.title},{Metric:'Company',Value:company.name},{Metric:'Project',Value:report.project.name},{Metric:'Customer',Value:report.project.customerName},
    {Metric:'As of',Value:report.generatedAt},{Metric:'Prices',Value:prices?'Included':'Excluded'},
    {Metric:'Quantity used, whole project (%)',Value:report.summary.overallPercentUsed},{Metric:'Basis',Value:report.summary.basis==='value'?'Weighted by contract value':'Average of items'},
    {Metric:'Items complete',Value:report.summary.itemsComplete},
    ...(prices?[{Metric:'Saving, finished items (USD)',Value:report.summary.totalSavingUsd},{Metric:'Estimated saving, items in progress (USD)',Value:report.summary.estimatedSavingUsd}]:[]),
  ];
  const dictionary:WorkbookRow[]=[
    {Sheet:'Contract Items',Column:'From Loads / Adjustments / Used',Meaning:'Used is the quantity from the Active loads linked to the item plus the adjustments, each with a reason. All three are in the item\'s unit.'},
    {Sheet:'Contract Items',Column:'% Used',Meaning:'Used ÷ Contract Quantity, one decimal. It is the true quantity used and does not change when an item is marked Complete.'},
    {Sheet:'Contract Items',Column:'Status',Meaning:'The work status: In progress, Over contract or Complete with its day. It is separate from % Used.'},
    ...(prices?[{Sheet:'Contract Items',Column:'Leftover / Saving USD',Meaning:'Leftover is what was not used (never below zero); Saving is Leftover × Contract Price, empty without a price. An item still in progress is marked as an estimate.'}]:[]),
    {Sheet:'Not Counted',Column:'Why',Meaning:'A linked load in another unit, or without a quantity. It is never converted or added to Used.'},
    {Sheet:'All sheets',Column:'Unit',Meaning:'Every item keeps its own unit. Quantities of different units are never added together.'},
  ];
  return [{name:'Report Info',rows:info},{name:'Contract Items',rows:items},{name:'Not Counted',rows:notCounted},{name:'Data Dictionary',rows:dictionary}];
}

export const buildContractWorkbook=(report:ContractReport,company:{name:string}):Uint8Array=>buildWorkbookFromSheets(contractWorkbookSheets(report,company));
