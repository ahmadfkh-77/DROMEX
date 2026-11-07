/**
 * Quantity Targets (DEC-522, Phase A: rules and calculations only).
 *
 * A project is bid on quantities from the tender. A target holds one allowed quantity in one unit, linked to one or more Catalog
 * materials. This module works out what has been used, what is left and which warning applies. Honesty rule: the used quantity is always
 * the real one -- active loads linked to the item plus visible, reasoned adjustments -- and the status "Complete" never changes it.
 * Units are never converted: a load in another unit is listed as not counted. Nothing here blocks a load.
 */

import {localDateKey} from './fuel';

export type ContractItemStatus='in_progress'|'complete';

export type ContractItem={
  id:string;projectId:string;name:string;
  unitId:string;unitSymbol:string;
  /** The allowed target quantity, above zero. */
  quantity:number;
  /** Optional target price per unit, in USD. */
  unitPriceUsd:number|null;
  /** Catalog materials this item may count. Links that are never used are kept. */
  materialIds:string[];
  status:ContractItemStatus;
  /** The day the item was finished (YYYY-MM-DD); null while in progress. */
  completedOn:string|null;
  cancelledAt:string|null;
};

/** A load as the contract rules see it: a company load or a supplier load, in its own unit. */
export type ContractLoad={
  id:string;source:'company'|'supplier';reference:string;
  materialId:string;unitId:string;unitSymbol:string;
  /** Null when the load has no quantity; such a load is listed as not counted. */
  quantity:number|null;
  /** The day the load was delivered (YYYY-MM-DD). */
  date:string;
  status:'Active'|'Cancelled';
  /** The target the Owner chose for this load, or null when it is not linked to one. */
  contractItemId:string|null;
};

/** A hand adjustment of the used quantity: its own line, plus or minus, with a reason. It never changes a load. */
export type ContractAdjustment={id:string;contractItemId:string;amount:number;reason:string;createdAt:string};

export type ContractNotCountedReason='unit_differs'|'no_quantity';
export type ContractWarning='none'|'near'|'full'|'over';

export type ContractUsage={
  allowed:number;
  fromLoads:number;
  adjustments:ContractAdjustment[];
  adjustmentsTotal:number;
  used:number;
  remaining:number;
  /** One decimal, for display. The warning below uses the true ratio, not this rounded number. */
  percentUsed:number;
  overContract:boolean;
  overBy:number;
  warning:ContractWarning;
  valueUsedUsd:number|null;
  valueRemainingUsd:number|null;
  /** target quantity × target price, and the over-target quantity × price; null without a price. */
  contractValueUsd:number|null;
  valueOverUsd:number|null;
  countedLoads:ContractLoad[];
  notCounted:{load:ContractLoad;reason:ContractNotCountedReason}[];
  /** What is left of the allowed quantity (never below zero). For a finished item this is the recorded leftover. */
  leftover:number;
  /** leftover × target price; null without a price. */
  savingUsd:number|null;
  /** True while the item is still in progress: the saving is then an estimate, not a result. */
  savingIsEstimate:boolean;
  /** Counted loads dated after the item was finished. They still count; the item is flagged. */
  lateLoads:ContractLoad[];
};

export const CONTRACT_NEAR_RATIO=0.9;
const EPSILON=1e-9;
const round6=(value:number)=>Math.round(value*1e6)/1e6;
const round1=(value:number)=>Math.round(value*1000)/10;
const roundMoney=(value:number)=>Math.round(value*100)/100;

/** Why an active load linked to the item is left out of Used, or null when it counts. */
export function notCountedReason(item:Pick<ContractItem,'unitId'>,load:ContractLoad):ContractNotCountedReason|null{
  if(load.unitId!==item.unitId)return 'unit_differs';
  if(load.quantity===null||!Number.isFinite(load.quantity)||load.quantity<=0)return 'no_quantity';
  return null;
}

export function computeContractUsage(item:ContractItem,loads:readonly ContractLoad[],adjustments:readonly ContractAdjustment[]):ContractUsage{
  const countedLoads:ContractLoad[]=[],notCounted:ContractUsage['notCounted']=[];
  for(const load of loads){
    if(load.contractItemId!==item.id||load.status!=='Active')continue;
    const reason=notCountedReason(item,load);
    if(reason)notCounted.push({load,reason});else countedLoads.push(load);
  }
  const own=adjustments.filter(value=>value.contractItemId===item.id);
  const fromLoads=round6(countedLoads.reduce((sum,load)=>sum+load.quantity!,0));
  const adjustmentsTotal=round6(own.reduce((sum,value)=>sum+value.amount,0));
  const used=round6(fromLoads+adjustmentsTotal);
  const ratio=used/item.quantity;
  const overContract=used>item.quantity+EPSILON;
  const warning:ContractWarning=overContract?'over':Math.abs(used-item.quantity)<=EPSILON?'full':ratio>=CONTRACT_NEAR_RATIO-EPSILON?'near':'none';
  const remaining=Math.max(0,round6(item.quantity-used));
  const leftover=remaining;
  const price=item.unitPriceUsd;
  const complete=item.status==='complete';
  return{
    allowed:item.quantity,fromLoads,adjustments:[...own],adjustmentsTotal,used,remaining,percentUsed:round1(ratio),
    overContract,overBy:overContract?round6(used-item.quantity):0,warning,
    valueUsedUsd:price===null?null:roundMoney(used*price),valueRemainingUsd:price===null?null:roundMoney(remaining*price),
    contractValueUsd:price===null?null:roundMoney(item.quantity*price),valueOverUsd:price===null?null:roundMoney((overContract?used-item.quantity:0)*price),
    countedLoads,notCounted,leftover,savingUsd:price===null?null:roundMoney(leftover*price),savingIsEstimate:!complete,
    lateLoads:complete&&item.completedOn?countedLoads.filter(load=>load.date>item.completedOn!):[],
  };
}

/* ── Validation ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export function validateContractReason(reason:string,what:string):string{
  const value=reason.trim().replace(/\s+/g,' ');
  if(!value)throw new Error(`Enter the reason for ${what} this target.`);
  return value;
}

const typedNumber=(value:string):number|null=>{const text=value.trim().replace(',','.');if(!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text))return null;const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;};

export type ContractItemDraft={name:string;unitId:string;quantity:string;unitPriceUsd:string;materialIds:string[]};
export type ContractItemValues={name:string;unitId:string;quantity:number;unitPriceUsd:number|null;materialIds:string[]};

export function validateContractItemDraft(draft:ContractItemDraft):{ok:true;value:ContractItemValues}|{ok:false;errors:string[]}{
  const errors:string[]=[];
  const name=draft.name.trim().replace(/\s+/g,' ');
  if(!name)errors.push('Enter the target name.');
  if(!draft.unitId)errors.push('Choose the unit.');
  const quantity=typedNumber(draft.quantity);
  if(quantity===null||quantity<=0)errors.push('The target quantity must be greater than zero.');
  let unitPriceUsd:number|null=null;
  if(draft.unitPriceUsd.trim()){const price=typedNumber(draft.unitPriceUsd);if(price===null||price<0)errors.push('Enter the target price as a number, zero or more.');else unitPriceUsd=price;}
  const materialIds=[...new Set(draft.materialIds)];
  if(!materialIds.length)errors.push('Link at least one material.');
  return errors.length?{ok:false,errors}:{ok:true,value:{name,unitId:draft.unitId,quantity:quantity!,unitPriceUsd,materialIds}};
}

/** A plus or minus amount with a reason. The used quantity can never be taken below zero: that would state a false number. */
export function validateContractAdjustment(input:{amount:string;reason:string},usage:Pick<ContractUsage,'used'>):{amount:number;reason:string}{
  const amount=typedNumber(input.amount);
  if(amount===null||amount===0)throw new Error('Enter an amount other than zero (plus or minus).');
  const reason=validateContractReason(input.reason,'adjusting');
  if(round6(usage.used+amount)<0)throw new Error('An adjustment cannot take the used quantity below zero.');
  return{amount:round6(amount),reason};
}

/* ── Audited changes: every change is a history entry, never an overwrite ───────────────────────────────────────────────────── */

export type ContractHistoryKind='created'|'edited'|'finished'|'reopened'|'cancelled'|'adjusted'|'load_linked'|'load_moved'|'load_unlinked';
export type ContractHistoryEntry={kind:ContractHistoryKind;contractItemId:string;reason:string|null;createdAt:string;details:Record<string,unknown>};

function validDay(day:string):boolean{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
  const[year,month,date]=day.split('-').map(Number) as [number,number,number];
  const value=new Date(year,month-1,date);
  return value.getFullYear()===year&&value.getMonth()===month-1&&value.getDate()===date;
}

export function finishContractItem(item:ContractItem,usage:Pick<ContractUsage,'used'|'leftover'|'savingUsd'>,completedOn:string,now:Date=new Date()):{item:ContractItem;entry:ContractHistoryEntry}{
  if(item.cancelledAt)throw new Error('A cancelled target cannot be finished.');
  if(item.status==='complete')throw new Error('This target is already finished.');
  if(!validDay(completedOn))throw new Error('Choose a valid day.');
  return{
    item:{...item,status:'complete',completedOn},
    entry:{kind:'finished',contractItemId:item.id,reason:null,createdAt:now.toISOString(),details:{completedOn,used:usage.used,leftover:usage.leftover,savingUsd:usage.savingUsd}},
  };
}

export function reopenContractItem(item:ContractItem,reason:string,now:Date=new Date()):{item:ContractItem;entry:ContractHistoryEntry}{
  if(item.status!=='complete')throw new Error('This target is not finished.');
  const clean=validateContractReason(reason,'reopening');
  return{
    item:{...item,status:'in_progress',completedOn:null},
    entry:{kind:'reopened',contractItemId:item.id,reason:clean,createdAt:now.toISOString(),details:{previousCompletedOn:item.completedOn}},
  };
}

export function cancelContractItem(item:ContractItem,reason:string,now:Date=new Date()):{item:ContractItem;entry:ContractHistoryEntry}{
  if(item.cancelledAt)throw new Error('This target is already cancelled.');
  const clean=validateContractReason(reason,'cancelling');
  return{item:{...item,cancelledAt:now.toISOString()},entry:{kind:'cancelled',contractItemId:item.id,reason:clean,createdAt:now.toISOString(),details:{}}};
}

export type ContractItemChanges=Partial<Pick<ContractItem,'name'|'unitId'|'unitSymbol'|'quantity'|'unitPriceUsd'|'materialIds'>>;
const EDITABLE:(keyof ContractItemChanges)[]=['name','unitId','unitSymbol','quantity','unitPriceUsd','materialIds'];
const sameValue=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/**
 * Edits an item as a new audited change. Once the item has counted loads or adjustments (`hasHistory`), a reason is required; the old
 * and new values of every changed field are kept in the entry. A change that alters nothing is refused.
 */
export function applyContractItemEdit(item:ContractItem,changes:ContractItemChanges,context:{hasHistory:boolean;reason:string;now?:Date}):{item:ContractItem;entry:ContractHistoryEntry}{
  const now=context.now??new Date();
  const diff:Record<string,{from:unknown;to:unknown}>={};
  for(const key of EDITABLE){if(changes[key]!==undefined&&!sameValue(changes[key],item[key]))diff[key]={from:item[key],to:changes[key]};}
  if(!Object.keys(diff).length)throw new Error('There is nothing to change.');
  const next={...item,...Object.fromEntries(Object.entries(diff).map(([key,value])=>[key,value.to]))} as ContractItem;
  const check=validateContractItemDraft({name:next.name,unitId:next.unitId,quantity:String(next.quantity),unitPriceUsd:next.unitPriceUsd===null?'':String(next.unitPriceUsd),materialIds:next.materialIds});
  if(!check.ok)throw new Error(check.errors[0]);
  const reason=context.hasHistory?validateContractReason(context.reason,'changing'):context.reason.trim().replace(/\s+/g,' ')||null;
  return{item:{...next,name:check.value.name},entry:{kind:'edited',contractItemId:item.id,reason,createdAt:now.toISOString(),details:{changes:diff}}};
}

/* ── Choosing the target for a load ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * The targets of a project a load of this material could count toward. Exactly one candidate is preselected (visible and
 * changeable); with several the Owner picks; with none the load is saved as not linked. A finished item stays selectable, because a
 * load after Finish still counts as used; a cancelled one does not.
 */
export function candidateContractItems(items:readonly ContractItem[],projectId:string|null,materialId:string):{candidates:ContractItem[];preselectedId:string|null}{
  if(!projectId)return{candidates:[],preselectedId:null};
  const candidates=items.filter(value=>value.projectId===projectId&&!value.cancelledAt&&value.materialIds.includes(materialId));
  return{candidates,preselectedId:candidates.length===1?candidates[0]!.id:null};
}

/* ── Loads counted, grouped by day ──────────────────────────────────────────────────────────────────────────────────────────── */

export type ContractLoadDay<T extends ContractLoad>={
  day:string;
  loads:{load:T;notCountedReason:ContractNotCountedReason|null}[];
  /** The total of the loads that count, in the item's unit. Not-counted loads are listed but never added. */
  countedQuantity:number;countedCount:number;notCountedCount:number;
};

/**
 * The active loads linked to an item, one group per delivery day, newest day first; within a day the input order is kept. Cancelled
 * loads are returned apart, because they are left out of Used.
 */
export function groupContractLoadsByDay<T extends ContractLoad>(item:Pick<ContractItem,'id'|'unitId'>,loads:readonly T[]):{days:ContractLoadDay<T>[];cancelled:T[]}{
  const byDay=new Map<string,ContractLoadDay<T>>(),cancelled:T[]=[];
  for(const load of loads){
    if(load.contractItemId!==item.id)continue;
    if(load.status!=='Active'){cancelled.push(load);continue;}
    const reason=notCountedReason(item,load);
    const day=byDay.get(load.date)??{day:load.date,loads:[],countedQuantity:0,countedCount:0,notCountedCount:0};
    day.loads.push({load,notCountedReason:reason});
    if(reason)day.notCountedCount+=1;else{day.countedCount+=1;day.countedQuantity=round6(day.countedQuantity+load.quantity!);}
    byDay.set(load.date,day);
  }
  return{days:[...byDay.values()].sort((a,b)=>b.day.localeCompare(a.day)),cancelled};
}

/* ── Project summary ────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type ContractRow={item:ContractItem;usage:ContractUsage};
export type ContractProjectSummary={
  itemCount:number;
  /** Items whose work is marked Complete (a status; it says nothing about the quantity used). */
  completeCount:number;
  /** The average percent used, or null with no items. Weighted by target value when every item has a price, otherwise by item. */
  overallPercentUsed:number|null;
  overallBasis:'value'|'items';
  /** The saving of finished items only: a result, never an estimate. */
  totalSavingUsd:number;
  /** What the items still in progress would save if finished now. Shown as an estimate. */
  estimatedSavingUsd:number;
  savings:{itemId:string;name:string;unitSymbol:string;leftover:number;savingUsd:number}[];
  overruns:{itemId:string;name:string;unitSymbol:string;overBy:number;percentUsed:number}[];
};

export function summarizeContractProject(rows:readonly ContractRow[]):ContractProjectSummary{
  const live=rows.filter(row=>!row.item.cancelledAt);
  const priced=live.length>0&&live.every(row=>row.item.unitPriceUsd!==null);
  let overallPercentUsed:number|null=null;
  if(live.length){
    overallPercentUsed=priced
      ?round1(live.reduce((sum,row)=>sum+row.usage.used*row.item.unitPriceUsd!,0)/live.reduce((sum,row)=>sum+row.item.quantity*row.item.unitPriceUsd!,0))
      :round1(live.reduce((sum,row)=>sum+row.usage.used/row.item.quantity,0)/live.length);
  }
  const finished=live.filter(row=>row.item.status==='complete');
  const savings=finished.filter(row=>(row.usage.savingUsd??0)>0)
    .map(row=>({itemId:row.item.id,name:row.item.name,unitSymbol:row.item.unitSymbol,leftover:row.usage.leftover,savingUsd:row.usage.savingUsd!}))
    .sort((a,b)=>b.savingUsd-a.savingUsd);
  const overruns=live.filter(row=>row.usage.overContract)
    .map(row=>({itemId:row.item.id,name:row.item.name,unitSymbol:row.item.unitSymbol,overBy:row.usage.overBy,percentUsed:row.usage.percentUsed}))
    .sort((a,b)=>b.percentUsed-a.percentUsed);
  return{
    itemCount:live.length,completeCount:finished.length,overallPercentUsed,overallBasis:priced?'value':'items',
    totalSavingUsd:roundMoney(finished.reduce((sum,row)=>sum+(row.usage.savingUsd??0),0)),
    estimatedSavingUsd:roundMoney(live.filter(row=>row.item.status==='in_progress').reduce((sum,row)=>sum+(row.usage.savingUsd??0),0)),
    savings,overruns,
  };
}

/** Everything the Daily Report needs to know about one target: the item with the loads and adjustments that point at it. */
export type ContractDayEntry={item:ContractItem;loads:readonly ContractLoad[];adjustments:readonly ContractAdjustment[]};
/** One target on a Daily Report: `usage` is as of the work date, `usedToday` is what that day added (counted loads plus adjustments dated that day). */
export type ContractDayProgress={item:ContractItem;usage:ContractUsage;usedToday:number;notCountedToday:number};
export type ContractDayReport={
  /** Targets that received a load or an adjustment on the work date, in the order given. */
  targets:ContractDayProgress[];
  /** All live targets as of the work date, so the whole-project percent never depends on which targets moved that day. */
  summary:ContractProjectSummary;
};

/**
 * One target as of the end of `asOf` (YYYY-MM-DD), or as it is now when `asOf` is null: later loads and adjustments are ignored and a target
 * finished after that day was still in progress then. The one place the as-of rule lives, for the Daily Report and the Totals PDF.
 */
export function contractUsageAsOf(entry:ContractDayEntry,asOf:string|null):{item:ContractItem;adjustments:ContractAdjustment[];usage:ContractUsage}{
  if(asOf===null)return{item:entry.item,adjustments:[...entry.adjustments],usage:computeContractUsage(entry.item,entry.loads,entry.adjustments)};
  const item:ContractItem=entry.item.status==='complete'&&entry.item.completedOn&&entry.item.completedOn>asOf
    ?{...entry.item,status:'in_progress',completedOn:null}:entry.item;
  const adjustments=entry.adjustments.filter(value=>localDateKey(new Date(value.createdAt))<=asOf);
  return{item,adjustments,usage:computeContractUsage(item,entry.loads.filter(load=>load.date<=asOf),adjustments)};
}

/** A target as the Project Totals PDF prints it (DEC-539): its own figures, as of the To date or today. */
export type ContractTotalsTarget={
  id:string;name:string;unitSymbol:string;materialIds:string[];
  quantity:number;/** What counts toward the target: loads linked to it plus adjustments, never the material's Delivered figure. */counted:number;
  percentUsed:number;warning:ContractWarning;overBy:number;
};

/** Live targets for the Totals PDF, each with its own figures; cancelled targets are left out. */
export function contractTotalsTargets(entries:readonly ContractDayEntry[],asOf:string|null):ContractTotalsTarget[]{
  return entries.filter(entry=>!entry.item.cancelledAt).map(entry=>{
    const {item,usage}=contractUsageAsOf(entry,asOf);
    return{id:item.id,name:item.name,unitSymbol:item.unitSymbol,materialIds:[...item.materialIds],quantity:item.quantity,counted:usage.used,percentUsed:usage.percentUsed,warning:usage.warning,overBy:usage.overBy};
  });
}

/**
 * Daily Report progress (DEC-537). Everything is read as of the end of `workDate`: later loads and adjustments are ignored, so an issued
 * report keeps the percent it had that day. A target finished after that day was still in progress then. Cancelled targets are left out.
 */
export function dailyContractProgress(entries:readonly ContractDayEntry[],workDate:string):ContractDayReport{
  const rows:ContractRow[]=[],targets:ContractDayProgress[]=[];
  for(const entry of entries){
    if(entry.item.cancelledAt)continue;
    const {item,adjustments,usage}=contractUsageAsOf(entry,workDate);
    rows.push({item,usage});
    const adjustedToday=adjustments.filter(value=>value.contractItemId===item.id&&localDateKey(new Date(value.createdAt))===workDate);
    const countedToday=usage.countedLoads.filter(load=>load.date===workDate);
    const notCountedToday=usage.notCounted.filter(value=>value.load.date===workDate).length;
    if(!countedToday.length&&!adjustedToday.length&&!notCountedToday)continue;
    const usedToday=round6(countedToday.reduce((sum,load)=>sum+load.quantity!,0)+adjustedToday.reduce((sum,value)=>sum+value.amount,0));
    targets.push({item,usage,usedToday,notCountedToday});
  }
  return{targets,summary:summarizeContractProject(rows)};
}

/** One live target as the Company Daily Report prints it, as of the end of the work date: the same usage rules as the Daily Report (DEC-537). */
export type ContractTargetRow={itemId:string;name:string;unitSymbol:string;quantity:number;usedBefore:number;usedToday:number;used:number;percentUsed:number;left:number;overBy:number;warning:ContractWarning};

/**
 * Every live target of one project as of the end of `workDate`, whether or not it moved that day (the Daily Report lists only the ones that moved).
 * Used = counted loads plus reasoned adjustments; loads in another unit are not counted and never converted. Nothing is computed here that
 * the Contract Quantities rules do not already compute: this only splits `used` into before today and today.
 */
export function dailyContractTargetTable(entries:readonly ContractDayEntry[],workDate:string):ContractTargetRow[]{
  const rows:ContractTargetRow[]=[];
  for(const entry of entries){
    if(entry.item.cancelledAt)continue;
    const {item,adjustments,usage}=contractUsageAsOf(entry,workDate);
    const adjustedToday=adjustments.filter(value=>value.contractItemId===item.id&&localDateKey(new Date(value.createdAt))===workDate);
    const usedToday=round6(usage.countedLoads.filter(load=>load.date===workDate).reduce((sum,load)=>sum+load.quantity!,0)+adjustedToday.reduce((sum,value)=>sum+value.amount,0));
    rows.push({itemId:item.id,name:item.name,unitSymbol:item.unitSymbol,quantity:item.quantity,usedBefore:round6(usage.used-usedToday),usedToday,used:usage.used,percentUsed:usage.percentUsed,left:usage.leftover,overBy:usage.overBy,warning:usage.warning});
  }
  return rows;
}

/** DEC-540. Every live target with its final figures, plus the whole-project percent: what the Completed Project Report prints. */
export type ContractFinalReport={targets:{item:ContractItem;usage:ContractUsage}[];summary:ContractProjectSummary};

/** Final figures as they stand now (the project is completed, so no later load can arrive); cancelled targets are left out. */
export function finalContractReport(entries:readonly ContractDayEntry[]):ContractFinalReport{
  const rows:ContractRow[]=entries.filter(entry=>!entry.item.cancelledAt).map(entry=>{const {item,usage}=contractUsageAsOf(entry,null);return{item,usage};});
  return{targets:rows,summary:summarizeContractProject(rows)};
}

/**
 * The one check the load flows make (DEC-522 Phase C): with several fitting items the Owner must pick one, or Not linked (''); with one it is
 * preselected and with none the load saves unlinked, so neither asks anything. Returns the message, or null when the load can be saved.
 */
export function contractChoiceIssue(candidates:readonly ContractItem[],value:string|undefined):string|null{
  return candidates.length>1&&value===undefined?'Choose the target this load counts toward, or Not linked.':null;
}

/* ── Words for the screens ──────────────────────────────────────────────────────────────────────────────────────────────────── */

const historyLabels:Record<ContractHistoryKind,string>={created:'Created',edited:'Edited',finished:'Finished',reopened:'Reopened',cancelled:'Cancelled',adjusted:'Adjusted',load_linked:'Load linked',load_moved:'Load moved',load_unlinked:'Load removed'};
export const contractHistoryLabel=(kind:ContractHistoryKind)=>historyLabels[kind];

const usd=(value:number|null)=>value===null?'not set':`$${value.toFixed(2)}`;
const num=(value:number)=>String(Number(value.toFixed(3)));

/** The lines shown before an edit is saved ("Target quantity 500 → 550 m³"), so the Owner sees exactly what changes. */
export function contractChangeLines(item:ContractItem,next:Pick<ContractItem,'name'|'unitId'|'unitSymbol'|'quantity'|'unitPriceUsd'|'materialIds'>,materialNames:Record<string,string>):string[]{
  const lines:string[]=[];
  if(next.name!==item.name)lines.push(`Name ${item.name} → ${next.name}`);
  if(next.unitId!==item.unitId)lines.push(`Unit ${item.unitSymbol} → ${next.unitSymbol}`);
  if(next.quantity!==item.quantity)lines.push(`Target quantity ${num(item.quantity)} → ${num(next.quantity)} ${next.unitSymbol}`);
  if(next.unitPriceUsd!==item.unitPriceUsd)lines.push(`Target price ${usd(item.unitPriceUsd)} → ${usd(next.unitPriceUsd)}`);
  const name=(id:string)=>materialNames[id]??id;
  const added=next.materialIds.filter(id=>!item.materialIds.includes(id)),removed=item.materialIds.filter(id=>!next.materialIds.includes(id));
  if(added.length)lines.push(`Materials added: ${added.map(name).join(', ')}`);
  if(removed.length)lines.push(`Materials removed: ${removed.map(name).join(', ')}`);
  return lines;
}

/** The Adjust dialog preview: Used and percent after a plus (add) or minus (take) amount, or null while the amount is not a number above zero. */
export function adjustmentPreview(usage:Pick<ContractUsage,'used'|'allowed'>,direction:'add'|'take',amountText:string):{amount:string;usedAfter:number;percentAfter:number}|null{
  const value=typedNumber(amountText);
  if(value===null||value<=0)return null;
  const usedAfter=round6(usage.used+(direction==='take'?-value:value));
  return{amount:`${direction==='take'?'-':''}${amountText.trim().replace(',','.')}`,usedAfter,percentAfter:round1(usedAfter/usage.allowed)};
}

/* ── Counts toward target in a company load correction (DEC-536) ─────────────────────────────── */

/** What a correction needs to know about a target to decide whether a load may count toward it. */
export type ContractLinkFacts={id:string;projectId:string;cancelled:boolean;materialIds:readonly string[]};

/**
 * What a correction does to a company load's target link. A target named in the correction (an id, or ''/null for Not linked) is used as
 * given, and is refused when it is cancelled, belongs to another project, or does not list the load's material. With no target named the
 * existing link is kept, and removed automatically when the corrected project or material no longer fits it (Option 1, DEC-522).
 */
export function plannedContractLink(input:{current:string|null;requested:string|null|undefined;projectId:string|null;itemId:string;itemName?:string;targets:readonly ContractLinkFacts[]}):{final:string|null;automatic:'project'|'material'|null;problem:string|null}{
  const find=(id:string)=>input.targets.find(target=>target.id===id);
  if(input.requested!==undefined){
    const wanted=input.requested||null;
    if(!wanted)return{final:null,automatic:null,problem:null};
    const target=find(wanted);
    const problem=!target?'The chosen target was not found.'
      :target.cancelled?'The chosen target is cancelled. Choose another or Not linked.'
      :target.projectId!==input.projectId?'The chosen target belongs to another project.'
      :!target.materialIds.includes(input.itemId)?`${input.itemName??'This material'} is not one of the materials of the chosen target.`:null;
    return problem?{final:null,automatic:null,problem}:{final:wanted,automatic:null,problem:null};
  }
  if(!input.current)return{final:null,automatic:null,problem:null};
  const target=find(input.current);
  if(!target||target.projectId!==input.projectId)return{final:null,automatic:'project',problem:null};
  if(!target.materialIds.includes(input.itemId))return{final:null,automatic:'material',problem:null};
  return{final:input.current,automatic:null,problem:null};
}
