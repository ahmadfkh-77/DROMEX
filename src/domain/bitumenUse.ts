import {localDateKey} from './fuel';

/**
 * Bitumen use from asphalt loads (Phase C). Each confirmed load of an item the owner ticked takes bitumen out of a batch by a rule
 * ("every 1.6 t of mix needs 50 kg of bitumen"). The use is an ESTIMATE, kept as rows: a use, and later a reversal when the load is
 * cancelled or reduced, so nothing is ever rewritten and the history shows why a figure changed. Each row keeps the rule it was
 * counted with, so changing a rule never changes loads already counted.
 *
 * Everything here is pure; the repository loads the records and saves the rows this module plans.
 */
export type BitumenUseKind='use'|'correction'|'reversal'|'moved';

export type BitumenRule={itemId:string;itemName:string;enabled:boolean;aggregateKg:number;bitumenKg:number;/** Loads confirmed before this local day are not counted. */countFrom:string};

/** A load as the counting sees it. `mixKg` is the weight of the mix, or null when it cannot be known. */
export type UseLoad={id:string;itemId:string;itemName:string;loadNumber:string|null;confirmedAt:string;active:boolean;mixKg:number|null};
export type UseBatch={id:string;arrivedDay:string;active:boolean;deliveredKg:number;adjustmentKg:number;/** When the Owner closed this batch by hand. A load confirmed after it is never taken from this batch. */closedAt?:string|null};

export type UseRowInput={
  loadId:string;batchId:string|null;kind:BitumenUseKind;kg:number;mixKg:number;ruleAggregateKg:number;ruleBitumenKg:number;
  loadNumber:string|null;/** When the load was confirmed. */loadConfirmedAt:string;itemName:string;note:string|null;
};
export type BitumenUseRow=UseRowInput&{id:string;createdAt:string};

export type AttentionItem={loadId:string;loadNumber:string|null;itemName:string;kind:'uncovered'|'not_countable';kg:number;note:string};

export const USE_EPSILON=0.0005;
const round3=(value:number)=>Math.round(value*1000)/1000;

/** Bitumen for a mix: `bitumenKg` for every `aggregateKg` of mix. */
export const bitumenForMix=(mixKg:number,aggregateKg:number,bitumenKg:number)=>round3(mixKg/aggregateKg*bitumenKg);

/** The percentage a rule means, for example 50 kg per 1,600 kg is 3.125%. */
export const rulePercent=(aggregateKg:number,bitumenKg:number)=>Math.round(bitumenKg/aggregateKg*100*10000)/10000;

const WEIGHT_UNITS:Record<string,number>={t:1000,ton:1000,tons:1000,tonne:1000,tonnes:1000,kg:1,kgs:1,kilogram:1,kilograms:1};
const unitKg=(symbol:string|null|undefined)=>WEIGHT_UNITS[(symbol??'').trim().toLowerCase()]??null;

/**
 * The weight of a load's mix in kg. A weighbridge load has its net weight. A direct load has the quantity that was typed, when its unit
 * is tons or kg, or else its billed quantity when that is in tons or kg. Any other unit (such as m³) cannot be turned into a weight, so
 * the result is null and the load is listed for attention instead of being guessed.
 */
export function mixKgForLoad(load:{quantityMethod:'weighbridge'|'direct';netWeightKg:number|null;directQuantity:number|null;directUnitSymbol:string|null;billedQuantity:number|null;outputUnitSymbol:string|null}):number|null{
  if(load.quantityMethod==='weighbridge')return load.netWeightKg!=null&&load.netWeightKg>0?load.netWeightKg:null;
  const direct=unitKg(load.directUnitSymbol);
  if(load.directQuantity!=null&&load.directQuantity>0&&direct!=null)return round3(load.directQuantity*direct);
  const billed=unitKg(load.outputUnitSymbol);
  if(load.billedQuantity!=null&&load.billedQuantity>0&&billed!=null)return round3(load.billedQuantity*billed);
  return null;
}

export type ReconcileInput={
  rules:readonly BitumenRule[];
  loads:readonly UseLoad[];
  existing:readonly BitumenUseRow[];
  batches:readonly UseBatch[];
  usingBatchId:string|null;
};
export type ReconcileResult={rows:UseRowInput[];attention:AttentionItem[]};

/**
 * Works out which rows to add so that every load's net use matches what its rule says now: a new load is counted, a cancelled load is
 * reversed, a corrected load adds or removes the difference, and a reactivated load is counted again. The rule a load was first counted
 * with is kept for later changes to that load. Bitumen is taken from the batch in use first, then the oldest open batch, and only from
 * batches that had arrived by the load's day; whatever no batch can cover is recorded as uncovered, never hidden.
 */
export function reconcileBitumenUse(input:ReconcileInput):ReconcileResult{
  const rules=new Map(input.rules.filter(rule=>rule.enabled).map(rule=>[rule.itemId,rule]));
  const batches=[...input.batches].filter(batch=>batch.active).sort((a,b)=>a.arrivedDay.localeCompare(b.arrivedDay));
  const remaining=new Map(batches.map(batch=>[batch.id,round3(batch.deliveredKg+batch.adjustmentKg)]));
  const byLoad=new Map<string,BitumenUseRow[]>();
  for(const row of input.existing){
    if(row.batchId&&remaining.has(row.batchId))remaining.set(row.batchId,round3((remaining.get(row.batchId)??0)-row.kg));
    byLoad.set(row.loadId,[...(byLoad.get(row.loadId)??[]),row]);
  }
  const rows:UseRowInput[]=[];
  const attention:AttentionItem[]=[];
  const loads=[...input.loads].sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt)||a.id.localeCompare(b.id));

  for(const load of loads){
    const history=byLoad.get(load.id)??[];
    const first=history[0];
    const rule=first?{aggregateKg:first.ruleAggregateKg,bitumenKg:first.ruleBitumenKg}:rules.get(load.itemId)?{aggregateKg:rules.get(load.itemId)!.aggregateKg,bitumenKg:rules.get(load.itemId)!.bitumenKg}:null;
    if(!rule)continue;
    if(!first){
      const itemRule=rules.get(load.itemId)!;
      if(localDateKey(new Date(load.confirmedAt))<itemRule.countFrom)continue;
    }
    const existingNet=round3(history.reduce((sum,row)=>sum+row.kg,0));
    const added:UseRowInput[]=[];
    if(load.mixKg==null){
      if(load.active&&existingNet<=USE_EPSILON)attention.push({loadId:load.id,loadNumber:load.loadNumber,itemName:load.itemName,kind:'not_countable',kg:0,note:'The quantity is not in tons or kg, so the bitumen cannot be calculated.'});
      continue;
    }
    const desired=load.active?bitumenForMix(load.mixKg,rule.aggregateKg,rule.bitumenKg):0;
    const delta=round3(desired-existingNet);
    const base={loadId:load.id,mixKg:load.mixKg,ruleAggregateKg:rule.aggregateKg,ruleBitumenKg:rule.bitumenKg,loadNumber:load.loadNumber,loadConfirmedAt:load.confirmedAt,itemName:load.itemName};
    if(delta>USE_EPSILON){
      const kind:BitumenUseKind=history.length?'correction':'use';
      const note=history.length?(history.some(row=>row.kind==='reversal')&&existingNet<=USE_EPSILON?'Load counted again':'Load corrected'):null;
      let need=delta;
      const day=localDateKey(new Date(load.confirmedAt));
      const eligible=batches.filter(batch=>batch.arrivedDay<=day&&(!batch.closedAt||load.confirmedAt<=batch.closedAt)&&(remaining.get(batch.id)??0)>USE_EPSILON);
      const order=[...eligible.filter(batch=>batch.id===input.usingBatchId),...eligible.filter(batch=>batch.id!==input.usingBatchId)];
      for(const batch of order){
        if(need<=USE_EPSILON)break;
        const take=round3(Math.min(need,remaining.get(batch.id)??0));
        if(take<=USE_EPSILON)continue;
        added.push({...base,batchId:batch.id,kind,kg:take,note});
        remaining.set(batch.id,round3((remaining.get(batch.id)??0)-take));
        need=round3(need-take);
      }
      if(need>USE_EPSILON)added.push({...base,batchId:null,kind,kg:need,note:note??'No open batch had enough bitumen'});
    }else if(delta<-USE_EPSILON){
      // Take the difference back from the most recent batch first.
      const perBatch=new Map<string|null,number>();
      for(const row of history)perBatch.set(row.batchId,round3((perBatch.get(row.batchId)??0)+row.kg));
      const order=[...new Set([...history].reverse().map(row=>row.batchId))];
      let back=-delta;
      for(const batchId of order){
        if(back<=USE_EPSILON)break;
        const have=perBatch.get(batchId)??0;
        const take=round3(Math.min(back,have));
        if(take<=USE_EPSILON)continue;
        added.push({...base,batchId,kind:'reversal',kg:-take,note:load.active?'Load corrected':'Load cancelled'});
        if(batchId&&remaining.has(batchId))remaining.set(batchId,round3((remaining.get(batchId)??0)+take));
        back=round3(back-take);
      }
    }
    rows.push(...added);
    // Whatever stays uncovered for this load is listed for attention.
    const uncovered=round3([...history,...added.map(row=>({...row,id:'',createdAt:''}))].filter(row=>row.batchId==null).reduce((sum,row)=>sum+row.kg,0));
    if(uncovered>USE_EPSILON)attention.push({loadId:load.id,loadNumber:load.loadNumber,itemName:load.itemName,kind:'uncovered',kg:uncovered,note:'No open bitumen batch had enough left. Record a delivery, or move the load to a batch.'});
  }
  return {rows,attention};
}

/** The net use of one load in each batch (null is the uncovered part), from its rows. */
export function netByBatch(rows:readonly Pick<BitumenUseRow,'batchId'|'kg'>[]):Map<string|null,number>{
  const map=new Map<string|null,number>();
  for(const row of rows)map.set(row.batchId,round3((map.get(row.batchId)??0)+row.kg));
  return map;
}

/** Rows that move a load's whole use to another batch: the old amounts are reversed and the same total is taken from the new batch. */
export function planMoveLoad(loadRows:readonly BitumenUseRow[],toBatchId:string):UseRowInput[]{
  const first=loadRows[0];
  if(!first)return [];
  const net=netByBatch(loadRows);
  const total=round3([...net.values()].reduce((sum,value)=>sum+value,0));
  if(total<=USE_EPSILON)return [];
  const base={loadId:first.loadId,mixKg:first.mixKg,ruleAggregateKg:first.ruleAggregateKg,ruleBitumenKg:first.ruleBitumenKg,loadNumber:first.loadNumber,loadConfirmedAt:first.loadConfirmedAt,itemName:first.itemName};
  const rows:UseRowInput[]=[];
  for(const [batchId,kg] of net){
    if(kg>USE_EPSILON&&batchId!==toBatchId)rows.push({...base,batchId,kind:'reversal',kg:-kg,note:'Moved to another batch'});
  }
  const alreadyThere=net.get(toBatchId)??0;
  const moving=round3(total-alreadyThere);
  if(moving>USE_EPSILON)rows.push({...base,batchId:toBatchId,kind:'moved',kg:moving,note:'Moved from another batch'});
  return rows;
}

/** One line per load for a batch: its net use there, with the rule it was counted with. A load that nets to zero (cancelled) is not a line. */
export type BatchLoadUse={loadId:string;loadNumber:string|null;loadConfirmedAt:string;itemName:string;mixKg:number;ruleAggregateKg:number;ruleBitumenKg:number;kg:number;lastAt:string};
export function useLinesForBatch(rows:readonly BitumenUseRow[],batchId:string):BatchLoadUse[]{
  const lines=new Map<string,BatchLoadUse>();
  for(const row of rows){
    if(row.batchId!==batchId)continue;
    const current=lines.get(row.loadId);
    lines.set(row.loadId,{loadId:row.loadId,loadNumber:row.loadNumber,loadConfirmedAt:row.loadConfirmedAt,itemName:row.itemName,mixKg:row.mixKg,ruleAggregateKg:row.ruleAggregateKg,ruleBitumenKg:row.ruleBitumenKg,kg:round3((current?.kg??0)+row.kg),lastAt:row.createdAt});
  }
  return [...lines.values()].filter(line=>line.kg>USE_EPSILON).sort((a,b)=>b.loadConfirmedAt.localeCompare(a.loadConfirmedAt)||(b.loadNumber??'').localeCompare(a.loadNumber??''));
}

export type BitumenAdjustment={id:string;batchId:string;kg:number;reason:string;estimatedBefore:number;realAfter:number;createdAt:string};
/** The difference an owner's real amount makes against the estimate. Negative means less is left than estimated. */
export const adjustmentFor=(estimatedRemainingKg:number,realRemainingKg:number)=>round3(realRemainingKg-estimatedRemainingKg);

export type UseSetupItem={id:string;name:string;categoryName:string;seriesId:string|null;seriesPrefix:string|null};
export type UseSetupSeries={id:string;prefix:string;name:string;itemIds:string[]};
/** What the rules screen shows: the items a rule can be set for, the load-number series that group them, and the rules saved so far. */
export type BitumenUseSetup={items:UseSetupItem[];series:UseSetupSeries[];rules:BitumenRule[]};
/** What the rules form sends. The mix is typed in tons and the bitumen in kg, as the owner thinks of the rule. */
export type BitumenRuleDraft={itemId:string;enabled:boolean;aggregateTons:string;bitumenKg:string;countFrom:string};
export type SyncResult={added:number;attention:AttentionItem[]};
export const DEFAULT_RULE={aggregateKg:1600,bitumenKg:50} as const;
