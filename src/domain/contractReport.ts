import {contractTrackingLabel,contractTrackingMode,type ContractItem,type ContractProjectSummary,type ContractUsage} from './contractQuantities';
import {localDateKey} from './fuel';

/**
 * DEC-522 Phase E. The Quantity Targets report, shared by the PDF and the Excel workbook. With prices it is the internal "Contract
 * Quantities and Savings" report; without prices it is client-safe: prices, values, leftovers and savings are left out, and nothing else
 * changes. Honesty rule: every used quantity and percent is the true one (loads plus visible adjustments) in both versions, and the work
 * status is a separate column. Units are never converted or added together, so there is no grand total of quantities.
 */
export type ContractReportInput={item:ContractItem;usage:ContractUsage;materials:{id?:string;name:string}[]};
export type ContractReportRow={
  name:string;materials:string;unit:string;
  /** DEC-556: AUTOMATIC, LINKED MANUAL or MANUAL. */
  tracking:string;manual:boolean;
  /** Sum of the site entries (manual modes), or null for an automatic target. */
  siteEntries:number|null;
  /** Linked manual only: what the loads delivered, in each material's own unit, never added to used. Empty otherwise. */
  delivered:string;
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
  /** DEC-556: the entries logged by hand for each manual target, oldest first; empty when every target is automatic. */
  siteEntries:{name:string;tracking:string;unit:string;total:number;entries:{date:string;amount:number;note:string;totalAfter:number}[]}[];
  trackedBySiteEntries:number;
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
    const status=complete?(usage.overContract?'Complete · over target':`Complete ${item.completedOn?day(item.completedOn):''}`.trim()):usage.overContract?'Over target':'In progress';
    return{
      name:item.name,materials:materials.map(material=>material.name).join(', '),unit:item.unitSymbol,
      tracking:contractTrackingLabel(contractTrackingMode(item)),manual:contractTrackingMode(item)!=='automatic',
      siteEntries:contractTrackingMode(item)==='automatic'?null:usage.siteEntriesTotal,
      delivered:contractTrackingMode(item)==='linked_manual'?usage.deliveredFromLoads.map(row=>`${amount(row.quantity)} ${row.unitSymbol} ${materials.find(material=>material.id===row.materialId)?.name??''}`.trim()).join('; '):'',
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
  const siteEntries=live.filter(({item})=>contractTrackingMode(item)!=='automatic').map(({item,usage})=>{
    let running=0;
    return{name:item.name,tracking:contractTrackingLabel(contractTrackingMode(item)),unit:item.unitSymbol,total:usage.siteEntriesTotal,
      entries:usage.siteEntries.map(entry=>{running=Math.round((running+entry.amount)*1e6)/1e6;return{date:entry.entryDate,amount:entry.amount,note:entry.kind==='opening'?(entry.note?`Opening value · ${entry.note}`:'Opening value'):entry.note??'',totalAfter:running};})};
  });
  const unitOf=new Map(live.map(row=>[row.item.id,row.item.unitSymbol]));
  const notes=[
    'Used = quantity from loads plus adjustments, each shown in its own column. A LINKED MANUAL or MANUAL target uses its site entries instead of loads. Units are never converted or added together.',
    '"% used" is the true quantity used. "Complete" is the work status and does not change it.',
    'Only Active loads count; a cancelled load is left out. A load in another unit, or without a quantity, is listed under Not counted.',
    ...(prices?['Saving = leftover × target price, only for an item with a price. * Estimate: the item is still in progress.']:[]),
  ];
  const date=localDateKey(new Date(generatedAt));
  return{
    title:prices?'Quantity Targets and Savings':'Quantity Targets',
    fileName:`DROMEX-Quantity-Targets-${safe(project.name)}-${prices?'With':'Without'}-Prices-${date}.pdf`,
    empty:live.length===0,includePrices:prices,generatedAt,project,
    summary:{overallPercentUsed:summary.overallPercentUsed,basis:summary.overallBasis,itemsComplete:`${summary.completeCount} of ${summary.itemCount}`,
      totalSavingUsd:prices?summary.totalSavingUsd:null,estimatedSavingUsd:prices?summary.estimatedSavingUsd:null},
    rows:reportRows,siteEntries,trackedBySiteEntries:siteEntries.length,
    savings:prices?summary.savings.map(value=>({name:value.name,leftover:`${amount(value.leftover)} ${value.unitSymbol}`,savingUsd:value.savingUsd})):[],
    overruns:summary.overruns.map(value=>({name:value.name,overBy:`${amount(value.overBy)} ${unitOf.get(value.itemId)??value.unitSymbol}`,percentUsed:value.percentUsed})),
    notCounted,notes,
  };
}
