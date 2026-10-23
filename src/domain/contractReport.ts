import type {ContractItem,ContractProjectSummary,ContractUsage} from './contractQuantities';
import {localDateKey} from './fuel';

/**
 * DEC-522 Phase E. The Contract Quantities report, shared by the PDF and the Excel workbook. With prices it is the internal "Contract
 * Quantities and Savings" report; without prices it is client-safe: prices, values, leftovers and savings are left out, and nothing else
 * changes. Honesty rule: every used quantity and percent is the true one (loads plus visible adjustments) in both versions, and the work
 * status is a separate column. Units are never converted or added together, so there is no grand total of quantities.
 */
export type ContractReportInput={item:ContractItem;usage:ContractUsage;materials:{name:string}[]};
export type ContractReportRow={
  name:string;materials:string;unit:string;
  contract:number;fromLoads:number;adjustments:number;used:number;remaining:number;percentUsed:number;
  status:string;tone:'progress'|'over'|'done';
  /** Null without prices (the client-safe version). */
  contractPriceUsd:number|null;leftover:number|null;savingUsd:number|null;savingIsEstimate:boolean;
};
export type ContractReport={
  title:string;fileName:string;empty:boolean;includePrices:boolean;generatedAt:string;
  project:{name:string;customerName:string;location:string};
  summary:{overallPercentUsed:number|null;basis:'value'|'items';itemsComplete:string;totalSavingUsd:number|null;estimatedSavingUsd:number|null};
  rows:ContractReportRow[];
  savings:{name:string;leftover:string;savingUsd:number}[];
  overruns:{name:string;overBy:string;percentUsed:number}[];
  notCounted:{load:string;item:string;quantity:string;why:string}[];
  notes:string[];
};

const amount=(value:number)=>String(Number(value.toFixed(3)));
const day=(value:string)=>{const[year,month,date]=value.split('-').map(Number) as [number,number,number];return new Date(year,month-1,date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});};
const safe=(value:string)=>value.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'Project';

export function buildContractReport(rows:readonly ContractReportInput[],summary:ContractProjectSummary,project:{name:string;customerName:string;location:string},options:{includePrices:boolean;generatedAt?:string}):ContractReport{
  const prices=options.includePrices,generatedAt=options.generatedAt??new Date().toISOString();
  const live=rows.filter(row=>!row.item.cancelledAt);
  const reportRows=live.map(({item,usage,materials}):ContractReportRow=>{
    const complete=item.status==='complete';
    const status=complete?(usage.overContract?'Complete · over contract':`Complete ${item.completedOn?day(item.completedOn):''}`.trim()):usage.overContract?'Over contract':'In progress';
    return{
      name:item.name,materials:materials.map(material=>material.name).join(', '),unit:item.unitSymbol,
      contract:usage.allowed,fromLoads:usage.fromLoads,adjustments:usage.adjustmentsTotal,used:usage.used,remaining:usage.remaining,percentUsed:usage.percentUsed,
      status,tone:complete?'done':usage.overContract?'over':'progress',
      contractPriceUsd:prices?item.unitPriceUsd:null,leftover:prices?usage.leftover:null,savingUsd:prices?usage.savingUsd:null,savingIsEstimate:usage.savingIsEstimate,
    };
  });
  const notCounted=live.flatMap(({item,usage})=>usage.notCounted.map(entry=>({
    load:`${entry.load.reference} · ${day(entry.load.date)}`,item:item.name,
    quantity:entry.load.quantity===null?'No quantity':`${amount(entry.load.quantity)} ${entry.load.unitSymbol}`,
    why:entry.reason==='unit_differs'?`Unit differs (${entry.load.unitSymbol}, item counts ${item.unitSymbol})`:'No quantity recorded',
  })));
  const unitOf=new Map(live.map(row=>[row.item.id,row.item.unitSymbol]));
  const notes=[
    'Used = quantity from loads plus adjustments, each shown in its own column. Units are never converted or added together.',
    '"% used" is the true quantity used. "Complete" is the work status and does not change it.',
    'Only Active loads count; a cancelled load is left out. A load in another unit, or without a quantity, is listed under Not counted.',
    ...(prices?['Saving = leftover × contract price, only for an item with a price. * Estimate: the item is still in progress.']:[]),
  ];
  const date=localDateKey(new Date(generatedAt));
  return{
    title:prices?'Contract Quantities and Savings':'Contract Quantities',
    fileName:`DROMEX-Contract-Quantities-${safe(project.name)}-${prices?'With':'Without'}-Prices-${date}.pdf`,
    empty:live.length===0,includePrices:prices,generatedAt,project,
    summary:{overallPercentUsed:summary.overallPercentUsed,basis:summary.overallBasis,itemsComplete:`${summary.completeCount} of ${summary.itemCount}`,
      totalSavingUsd:prices?summary.totalSavingUsd:null,estimatedSavingUsd:prices?summary.estimatedSavingUsd:null},
    rows:reportRows,
    savings:prices?summary.savings.map(value=>({name:value.name,leftover:`${amount(value.leftover)} ${value.unitSymbol}`,savingUsd:value.savingUsd})):[],
    overruns:summary.overruns.map(value=>({name:value.name,overBy:`${amount(value.overBy)} ${unitOf.get(value.itemId)??value.unitSymbol}`,percentUsed:value.percentUsed})),
    notCounted,notes,
  };
}
