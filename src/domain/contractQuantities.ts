/**
 * Contract Quantities (DEC-522, Phase A: rules and calculations only).
 *
 * A project is bid on quantities from the tender. A contract item holds one allowed quantity in one unit, linked to one or more Catalog
 * materials. This module works out what has been used, what is left and which warning applies. Honesty rule: the used quantity is always
 * the real one -- active loads linked to the item plus visible, reasoned adjustments -- and the status "Complete" never changes it.
 * Units are never converted: a load in another unit is listed as not counted. Nothing here blocks a load.
 */

export type ContractItemStatus='in_progress'|'complete';

export type ContractItem={
  id:string;projectId:string;name:string;
  unitId:string;unitSymbol:string;
  /** The allowed contract quantity, above zero. */
  quantity:number;
  /** Optional contract price per unit, in USD. */
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
  /** The contract item the Owner chose for this load, or null when it is not linked to one. */
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
  countedLoads:ContractLoad[];
  notCounted:{load:ContractLoad;reason:ContractNotCountedReason}[];
  /** What is left of the allowed quantity (never below zero). For a finished item this is the recorded leftover. */
  leftover:number;
  /** leftover × contract price; null without a price. */
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
    countedLoads,notCounted,leftover,savingUsd:price===null?null:roundMoney(leftover*price),savingIsEstimate:!complete,
    lateLoads:complete&&item.completedOn?countedLoads.filter(load=>load.date>item.completedOn!):[],
  };
}

/* ── Validation ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export function validateContractReason(reason:string,what:string):string{
  const value=reason.trim().replace(/\s+/g,' ');
  if(!value)throw new Error(`Enter the reason for ${what} this contract item.`);
  return value;
}

const typedNumber=(value:string):number|null=>{const text=value.trim().replace(',','.');if(!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text))return null;const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;};

export type ContractItemDraft={name:string;unitId:string;quantity:string;unitPriceUsd:string;materialIds:string[]};
export type ContractItemValues={name:string;unitId:string;quantity:number;unitPriceUsd:number|null;materialIds:string[]};

export function validateContractItemDraft(draft:ContractItemDraft):{ok:true;value:ContractItemValues}|{ok:false;errors:string[]}{
  const errors:string[]=[];
  const name=draft.name.trim().replace(/\s+/g,' ');
  if(!name)errors.push('Enter the contract item name.');
  if(!draft.unitId)errors.push('Choose the unit.');
  const quantity=typedNumber(draft.quantity);
  if(quantity===null||quantity<=0)errors.push('The contract quantity must be greater than zero.');
  let unitPriceUsd:number|null=null;
  if(draft.unitPriceUsd.trim()){const price=typedNumber(draft.unitPriceUsd);if(price===null||price<0)errors.push('Enter the contract price as a number, zero or more.');else unitPriceUsd=price;}
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
  if(item.cancelledAt)throw new Error('A cancelled contract item cannot be finished.');
  if(item.status==='complete')throw new Error('This contract item is already finished.');
  if(!validDay(completedOn))throw new Error('Choose a valid day.');
  return{
    item:{...item,status:'complete',completedOn},
    entry:{kind:'finished',contractItemId:item.id,reason:null,createdAt:now.toISOString(),details:{completedOn,used:usage.used,leftover:usage.leftover,savingUsd:usage.savingUsd}},
  };
}

export function reopenContractItem(item:ContractItem,reason:string,now:Date=new Date()):{item:ContractItem;entry:ContractHistoryEntry}{
  if(item.status!=='complete')throw new Error('This contract item is not finished.');
  const clean=validateContractReason(reason,'reopening');
  return{
    item:{...item,status:'in_progress',completedOn:null},
    entry:{kind:'reopened',contractItemId:item.id,reason:clean,createdAt:now.toISOString(),details:{previousCompletedOn:item.completedOn}},
  };
}

export function cancelContractItem(item:ContractItem,reason:string,now:Date=new Date()):{item:ContractItem;entry:ContractHistoryEntry}{
  if(item.cancelledAt)throw new Error('This contract item is already cancelled.');
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

/* ── Choosing the contract item for a load ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * The contract items of a project a load of this material could count toward. Exactly one candidate is preselected (visible and
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
  /** The average percent used, or null with no items. Weighted by contract value when every item has a price, otherwise by item. */
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
    itemCount:live.length,overallPercentUsed,overallBasis:priced?'value':'items',
    totalSavingUsd:roundMoney(finished.reduce((sum,row)=>sum+(row.usage.savingUsd??0),0)),
    estimatedSavingUsd:roundMoney(live.filter(row=>row.item.status==='in_progress').reduce((sum,row)=>sum+(row.usage.savingUsd??0),0)),
    savings,overruns,
  };
}

/**
 * The one check the load flows make (DEC-522 Phase C): with several fitting items the Owner must pick one, or Not linked (''); with one it is
 * preselected and with none the load saves unlinked, so neither asks anything. Returns the message, or null when the load can be saved.
 */
export function contractChoiceIssue(candidates:readonly ContractItem[],value:string|undefined):string|null{
  return candidates.length>1&&value===undefined?'Choose the contract item this load counts toward, or Not linked.':null;
}
