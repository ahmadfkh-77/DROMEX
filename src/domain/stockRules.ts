import {localDateKey} from './fuel';
import {STOCK_EPSILON,type StockUseRow} from './stock';

/**
 * Stock usage rules. A rule belongs to one item delivered on receipts (Ready-mix C30) and lists the Stock materials that one unit of it uses
 * (7 cement bags and 0.45 t of sand per 1 m3). A rule is never edited in place: each change is a new dated version, and a load keeps the rate
 * it was first counted with. Each confirmed load of the item takes its materials out of Stock, oldest batch first and carrying on into the next
 * batch; a cancelled or corrected load is reversed or adjusted by more rows, never by rewriting one; the owner can type the real amount of one
 * load. A load is never blocked: what Stock cannot cover is listed as a shortage and counted when a delivery is recorded.
 *
 * Everything here is pure; the repository loads the records and saves the rows this module plans.
 */
export type StockRuleLine={stockItemId:string;amount:number};
export type StockRuleVersion={id:string;effectiveFrom:string;perQuantity:number;lines:StockRuleLine[];createdAt:string};
export type StockRule={id:string;loadItemId:string;loadItemName:string;unitSymbol:string;enabled:boolean;versions:StockRuleVersion[]};

/** A confirmed load as counting sees it. `quantity` is in `unitSymbol`, or null when it cannot be known. */
export type RuleLoad={id:string;itemId:string;itemName:string;loadNumber:string|null;confirmedAt:string;active:boolean;quantity:number|null;unitSymbol:string|null};
export type RuleBatch={id:string;itemId:string;arrivedDay:string;active:boolean;quantity:number;/** When the Owner closed this batch by hand. A load confirmed after it is never taken from this batch. */closedAt?:string|null};
export type RuleOverride={loadId:string;stockItemId:string;quantity:number;reason:string;createdAt:string};

/** A row to save, without the id and time the repository adds. */
export type NewStockUseRow={
  groupId:string;itemId:string;batchId:string;kind:'use'|'reversal';quantity:number;usedOn:string;note:string|null;
  loadId:string;loadNumber:string|null;loadQuantity:number;loadUnit:string;ruleId:string|null;ruleVersionId:string|null;rulePerQuantity:number;ruleAmount:number;
};
export type StockAttention={loadId:string;loadNumber:string|null;loadItemName:string;stockItemId:string|null;kind:'short'|'not_countable';quantity:number;note:string};
export type StockReconcileResult={rows:NewStockUseRow[];attention:StockAttention[]};

const round3=(value:number)=>Math.round(value*1000)/1000;
export const loadUseGroupId=(loadId:string,stockItemId:string)=>`load_${loadId}_${stockItemId}`;

/** The version in force on a day: the latest one that starts on or before it. None means the rule had not begun. */
export function versionOn(rule:Pick<StockRule,'versions'>,day:string):StockRuleVersion|null{
  return [...rule.versions].filter(version=>version.effectiveFrom<=day).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom)||b.createdAt.localeCompare(a.createdAt))[0]??null;
}
/** The version to show as the rule today: the one in force on `today`, or the next to start when none has yet. */
export function currentVersion(rule:Pick<StockRule,'versions'>,today:string):StockRuleVersion|null{
  return versionOn(rule,today)??[...rule.versions].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom))[0]??null;
}
/** What a quantity of the load item takes of one material: `amount` for every `perQuantity`. */
export const materialForLoad=(quantity:number,perQuantity:number,amount:number)=>round3(quantity/perQuantity*amount);

const sameUnit=(a:string|null|undefined,b:string|null|undefined)=>(a??'').trim().toLowerCase()===(b??'').trim().toLowerCase()&&(a??'').trim()!=='';

export function reconcileStockUse(input:{rules:readonly StockRule[];loads:readonly RuleLoad[];rows:readonly StockUseRow[];batches:readonly RuleBatch[];overrides:readonly RuleOverride[]}):StockReconcileResult{
  const rules=new Map(input.rules.filter(rule=>rule.enabled).map(rule=>[rule.loadItemId,rule]));
  const batches=input.batches.filter(batch=>batch.active).sort((a,b)=>a.arrivedDay.localeCompare(b.arrivedDay)||a.id.localeCompare(b.id));
  const remaining=new Map(batches.map(batch=>[batch.id,round3(batch.quantity)]));
  const history=new Map<string,StockUseRow[]>();
  const keysByLoad=new Map<string,Set<string>>();
  for(const row of input.rows){
    if(remaining.has(row.batchId))remaining.set(row.batchId,round3((remaining.get(row.batchId)??0)-row.quantity));
    if(row.source==='load'&&row.loadId){
      const key=`${row.loadId}|${row.itemId}`;
      history.set(key,[...(history.get(key)??[]),row]);
      keysByLoad.set(row.loadId,(keysByLoad.get(row.loadId)??new Set()).add(row.itemId));
    }
  }
  const overrides=new Map<string,RuleOverride>();
  for(const override of [...input.overrides].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))overrides.set(`${override.loadId}|${override.stockItemId}`,override);

  const rows:NewStockUseRow[]=[];
  const attention:StockAttention[]=[];
  const loads=[...input.loads].sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt)||a.id.localeCompare(b.id));
  for(const load of loads){
    const rule=rules.get(load.itemId);
    const day=localDateKey(new Date(load.confirmedAt));
    const version=rule?versionOn(rule,day):null;
    const materials=new Set<string>([...(keysByLoad.get(load.id)??[]),...(rule&&version?version.lines.map(line=>line.stockItemId):[])]);
    for(const stockItemId of materials){
      const key=`${load.id}|${stockItemId}`;
      const past=history.get(key)??[];
      const first=past[0];
      const line=version?.lines.find(value=>value.stockItemId===stockItemId);
      const snapshot=first&&first.rulePerQuantity!=null&&first.ruleAmount!=null?{perQuantity:first.rulePerQuantity,amount:first.ruleAmount,ruleId:first.ruleId??null,versionId:first.ruleVersionId??null,unit:first.loadUnit??rule?.unitSymbol??''}:rule&&version&&line?{perQuantity:version.perQuantity,amount:line.amount,ruleId:rule.id,versionId:version.id,unit:rule.unitSymbol}:null;
      if(!snapshot)continue;
      const existingNet=round3(past.reduce((sum,row)=>sum+row.quantity,0));
      if(load.quantity==null||!sameUnit(load.unitSymbol,snapshot.unit)){
        if(load.active&&existingNet<=STOCK_EPSILON)attention.push({loadId:load.id,loadNumber:load.loadNumber,loadItemName:load.itemName,stockItemId,kind:'not_countable',quantity:0,note:`This load is not counted in ${snapshot.unit}, the unit of the rule, so its materials cannot be calculated. Add a conversion for the item, or record the use by hand.`});
        continue;
      }
      const override=overrides.get(key);
      const desired=load.active?(override?round3(override.quantity):materialForLoad(load.quantity,snapshot.perQuantity,snapshot.amount)):0;
      const delta=round3(desired-existingNet);
      const base={groupId:loadUseGroupId(load.id,stockItemId),itemId:stockItemId,usedOn:day,loadId:load.id,loadNumber:load.loadNumber,loadQuantity:load.quantity,loadUnit:snapshot.unit,ruleId:snapshot.ruleId,ruleVersionId:snapshot.versionId,rulePerQuantity:snapshot.perQuantity,ruleAmount:snapshot.amount};
      const added:NewStockUseRow[]=[];
      if(delta>STOCK_EPSILON){
        const note=override?`Adjusted: ${override.reason}`:past.length?(past.some(row=>row.kind==='reversal')&&existingNet<=STOCK_EPSILON?'Load counted again':'Load corrected'):null;
        let need=delta;
        for(const batch of batches){
          if(need<=STOCK_EPSILON)break;
          if(batch.itemId!==stockItemId||batch.arrivedDay>day)continue;
          if(batch.closedAt&&load.confirmedAt>batch.closedAt)continue;
          const take=round3(Math.min(need,remaining.get(batch.id)??0));
          if(take<=STOCK_EPSILON)continue;
          added.push({...base,batchId:batch.id,kind:'use',quantity:take,note});
          remaining.set(batch.id,round3((remaining.get(batch.id)??0)-take));
          need=round3(need-take);
        }
      }else if(delta<-STOCK_EPSILON){
        // Take the difference back from the most recent batch first.
        const perBatch=new Map<string,number>();
        for(const row of past)perBatch.set(row.batchId,round3((perBatch.get(row.batchId)??0)+row.quantity));
        let back=-delta;
        for(const batchId of [...new Set([...past].reverse().map(row=>row.batchId))]){
          if(back<=STOCK_EPSILON)break;
          const take=round3(Math.min(back,perBatch.get(batchId)??0));
          if(take<=STOCK_EPSILON)continue;
          added.push({...base,batchId,kind:'reversal',quantity:-take,note:!load.active?'Load cancelled':override?`Adjusted: ${override.reason}`:'Load corrected'});
          if(remaining.has(batchId))remaining.set(batchId,round3((remaining.get(batchId)??0)+take));
          back=round3(back-take);
        }
      }
      rows.push(...added);
      const short=round3(desired-(existingNet+added.reduce((sum,row)=>sum+row.quantity,0)));
      if(desired>0&&short>STOCK_EPSILON)attention.push({loadId:load.id,loadNumber:load.loadNumber,loadItemName:load.itemName,stockItemId,kind:'short',quantity:short,note:'Not enough in stock. It is counted automatically when a delivery is recorded.'});
    }
  }
  return {rows,attention};
}

/** What the rule form sends. Quantities are text so the form can show what was typed; the date is chosen on the calendar. */
export type StockRuleDraft={
  /** Set when editing a rule: the change becomes a new version from `effectiveFrom`. */
  ruleId?:string;loadItemId:string;/** The unit the rule is per (m3). It is fixed once the rule exists. */unitId:string;perQuantity:string;effectiveFrom:string;
  lines:{stockItemId:string;amount:string}[];
};
export const emptyStockRuleDraft:StockRuleDraft={loadItemId:'',unitId:'',perQuantity:'1',effectiveFrom:localDateKey(new Date()),lines:[]};
/** An item delivered on receipts, that a rule can watch. */
export type StockRuleLoadItem={id:string;name:string;categoryName:string;unitId:string|null;unitSymbol:string|null;hasRule:boolean;/** Bitumen already counts this item from its loads. */bitumen:boolean};
export type StockRuleMaterial={id:string;name:string;unitSymbol:string};
export type StockRulesSetup={loadItems:StockRuleLoadItem[];units:{id:string;name:string;symbol:string}[];materials:StockRuleMaterial[];rules:StockRule[]};
export type StockSyncResult={added:number;attention:StockAttention[]};
