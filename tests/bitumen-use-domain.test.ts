import {describe,expect,it} from 'vitest';

import {adjustmentFor,bitumenForMix,mixKgForLoad,planMoveLoad,reconcileBitumenUse,rulePercent,useLinesForBatch,type BitumenRule,type BitumenUseRow,type UseBatch,type UseLoad} from '../src/domain/bitumenUse';

/** The pure counting of bitumen use: the rule, which batch a load draws from, reversals, corrections, and what cannot be counted. */
const RULE:BitumenRule={itemId:'base',itemName:'Asphalt Mix – Base',enabled:true,aggregateKg:1600,bitumenKg:50,countFrom:'2026-10-01'};
const batch=(id:string,arrivedDay:string,deliveredKg:number,extra:Partial<UseBatch>={}):UseBatch=>({id,arrivedDay,active:true,deliveredKg,adjustmentKg:0,...extra});
const load=(id:string,mixKg:number|null,extra:Partial<UseLoad>={}):UseLoad=>({id,itemId:'base',itemName:'Asphalt Mix – Base',loadNumber:`ASP-${id}`,confirmedAt:'2026-10-13T09:00:00',active:true,mixKg,...extra});
const stored=(rows:ReturnType<typeof reconcileBitumenUse>['rows']):BitumenUseRow[]=>rows.map((row,index)=>({...row,id:`u${index}`,createdAt:`2026-10-13T10:0${index}:00`}));
const run=(over:Partial<Parameters<typeof reconcileBitumenUse>[0]>)=>reconcileBitumenUse({rules:[RULE],loads:[],existing:[],batches:[batch('b1','2026-10-12',20000)],usingBatchId:null,...over});

describe('the rule',()=>{
  it('takes 50 kg of bitumen for every 1.6 t of mix, and shows the percentage',()=>{
    expect(bitumenForMix(40000,1600,50)).toBe(1250);expect(bitumenForMix(24000,1600,50)).toBe(750);expect(bitumenForMix(1000,1600,50)).toBe(31.25);
    expect(rulePercent(1600,50)).toBe(3.125);expect(rulePercent(1600,56)).toBe(3.5);
  });
  it('uses the net weight of a weighbridge load, and the typed or billed tons or kg of a direct load',()=>{
    const base={quantityMethod:'weighbridge' as const,netWeightKg:40000,directQuantity:null,directUnitSymbol:null,billedQuantity:null,outputUnitSymbol:null};
    expect(mixKgForLoad(base)).toBe(40000);
    expect(mixKgForLoad({...base,quantityMethod:'direct',netWeightKg:null,directQuantity:24,directUnitSymbol:'t'})).toBe(24000);
    expect(mixKgForLoad({...base,quantityMethod:'direct',netWeightKg:null,directQuantity:1500,directUnitSymbol:'kg'})).toBe(1500);
    expect(mixKgForLoad({...base,quantityMethod:'direct',netWeightKg:null,directQuantity:30,directUnitSymbol:'m³',billedQuantity:30,outputUnitSymbol:'t'})).toBe(30000);
    expect(mixKgForLoad({...base,quantityMethod:'direct',netWeightKg:null,directQuantity:30,directUnitSymbol:'m³',billedQuantity:30,outputUnitSymbol:'m³'})).toBeNull();
    expect(mixKgForLoad({...base,netWeightKg:null})).toBeNull();
  });
});

describe('counting a load',()=>{
  it('takes the bitumen from the oldest open batch and keeps the rule it used',()=>{
    const {rows,attention}=run({loads:[load('123',40000)]});
    expect(rows).toEqual([expect.objectContaining({loadId:'123',batchId:'b1',kind:'use',kg:1250,mixKg:40000,ruleAggregateKg:1600,ruleBitumenKg:50})]);
    expect(attention).toEqual([]);
  });
  it('takes it from the batch in use first, when the owner chose one',()=>{
    const {rows}=run({loads:[load('1',16000)],batches:[batch('b1','2026-10-12',20000),batch('b2','2026-10-13',8000)],usingBatchId:'b2'});
    expect(rows.map(row=>[row.batchId,row.kg])).toEqual([['b2',500]]);
  });
  it('ignores a load before the "count from" day, and a load of an item that is not ticked',()=>{
    expect(run({loads:[load('old',40000,{confirmedAt:'2026-09-30T09:00:00'})]}).rows).toEqual([]);
    expect(run({loads:[load('other',40000,{itemId:'binder'})]}).rows).toEqual([]);
    expect(run({loads:[load('1',40000)],rules:[{...RULE,enabled:false}]}).rows).toEqual([]);
  });
  it('does not count the same load twice',()=>{
    const first=run({loads:[load('1',40000)]});
    expect(run({loads:[load('1',40000)],existing:stored(first.rows)}).rows).toEqual([]);
  });
  it('keeps the rule of loads already counted when the rule changes, and uses the new rule for new loads',()=>{
    const first=run({loads:[load('1',40000)]});
    const changed={...RULE,bitumenKg:55};
    const next=run({rules:[changed],loads:[load('1',40000,{mixKg:48000}),load('2',16000)],existing:stored(first.rows)});
    // The first load grows from 40 t to 48 t and still uses 50 kg per 1.6 t; the new load uses 55 kg per 1.6 t.
    expect(next.rows).toEqual([expect.objectContaining({loadId:'1',kind:'correction',kg:250,ruleBitumenKg:50}),expect.objectContaining({loadId:'2',kind:'use',kg:550,ruleBitumenKg:55})]);
  });
});

describe('batches running out',()=>{
  it('continues in the next batch, and only from batches that had arrived by the load day',()=>{
    const batches=[batch('b1','2026-10-12',1000),batch('b2','2026-10-13',8000),batch('b3','2026-10-20',8000)];
    const {rows}=run({loads:[load('1',40000)],batches});
    expect(rows.map(row=>[row.batchId,row.kg])).toEqual([['b1',1000],['b2',250]]);
  });
  it('records what no batch can cover as uncovered and lists it for attention',()=>{
    const {rows,attention}=run({loads:[load('1',40000)],batches:[batch('b1','2026-10-12',1000)]});
    expect(rows.map(row=>[row.batchId,row.kg])).toEqual([['b1',1000],[null,250]]);
    expect(attention).toEqual([expect.objectContaining({loadId:'1',kind:'uncovered',kg:250})]);
  });
  it('counts a load that is earlier than every batch as uncovered',()=>{
    const {rows}=run({loads:[load('1',16000,{confirmedAt:'2026-10-10T09:00:00'})]});
    expect(rows).toEqual([expect.objectContaining({batchId:null,kg:500})]);
  });
  it('takes the real-amount adjustment into account',()=>{
    const {rows}=run({loads:[load('1',40000)],batches:[batch('b1','2026-10-12',1000,{adjustmentKg:-900})]});
    expect(rows.map(row=>[row.batchId,row.kg])).toEqual([['b1',100],[null,1150]]);
  });
  it('lists a load that cannot be turned into a weight, instead of guessing',()=>{
    const {rows,attention}=run({loads:[load('1',null)]});
    expect(rows).toEqual([]);
    expect(attention).toEqual([expect.objectContaining({loadId:'1',kind:'not_countable'})]);
  });
});

describe('cancelled, corrected and reactivated loads',()=>{
  const counted=()=>stored(run({loads:[load('1',40000)],batches:[batch('b1','2026-10-12',20000),batch('b2','2026-10-12',8000)]}).rows);
  it('reverses a cancelled load automatically, and a net of zero hides it from the batch lines',()=>{
    const first=counted();
    const {rows}=run({loads:[load('1',40000,{active:false})],existing:first});
    expect(rows).toEqual([expect.objectContaining({kind:'reversal',batchId:'b1',kg:-1250,note:'Load cancelled'})]);
    expect(useLinesForBatch([...first,...stored(rows)],'b1')).toEqual([]);
  });
  it('adds only the difference when a load is corrected up or down',()=>{
    const first=counted();
    expect(run({loads:[load('1',48000)],existing:first}).rows.map(row=>[row.kind,row.kg])).toEqual([['correction',250]]);
    expect(run({loads:[load('1',32000)],existing:first}).rows.map(row=>[row.kind,row.kg,row.note])).toEqual([['reversal',-250,'Load corrected']]);
  });
  it('counts a reactivated load again with its first rule',()=>{
    const first=counted();
    const reversed=stored(run({loads:[load('1',40000,{active:false})],existing:first}).rows).map((row,index)=>({...row,id:`r${index}`}));
    const again=run({loads:[load('1',40000)],existing:[...first,...reversed]});
    expect(again.rows).toEqual([expect.objectContaining({kind:'correction',kg:1250,note:'Load counted again',ruleBitumenKg:50})]);
  });
  it('never leaves a cancelled load counted when its item is no longer ticked',()=>{
    const first=counted();
    const {rows}=run({rules:[{...RULE,enabled:false}],loads:[load('1',40000,{active:false})],existing:first});
    expect(rows.map(row=>[row.kind,row.kg])).toEqual([['reversal',-1250]]);
  });
});

describe('moving a load and adjusting',()=>{
  it('moves the whole use of a load to another batch with reversals and a moved line',()=>{
    const first=stored(run({loads:[load('1',40000)],batches:[batch('b1','2026-10-12',1000),batch('b2','2026-10-12',8000)]}).rows);
    expect(first.map(row=>[row.batchId,row.kg])).toEqual([['b1',1000],['b2',250]]);
    const moved=planMoveLoad(first,'b2');
    expect(moved.map(row=>[row.batchId,row.kind,row.kg])).toEqual([['b1','reversal',-1000],['b2','moved',1000]]);
  });
  it('finds the adjustment between the estimate and the real amount',()=>{
    expect(adjustmentFor(18000,17900)).toBe(-100);expect(adjustmentFor(18000,18050)).toBe(50);expect(adjustmentFor(18000,18000)).toBe(0);
  });
  it('lists the loads of a batch, latest load first, with their rule',()=>{
    const rows=stored(run({loads:[load('1',40000),load('2',24000,{confirmedAt:'2026-10-13T11:00:00'})]}).rows);
    const lines=useLinesForBatch(rows,'b1');
    expect(lines.map(line=>[line.loadNumber,line.kg,line.ruleAggregateKg,line.ruleBitumenKg])).toEqual([['ASP-2',750,1600,50],['ASP-1',1250,1600,50]]);
  });
});
