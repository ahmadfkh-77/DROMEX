import {describe,expect,it} from 'vitest';

import {buildBitumenOverview,type BitumenBatch} from '../src/domain/bitumen';
import {batchPricePerKg,batchRemainingKg,fillCost,planFill,validateFillCancellation,type FillBatch} from '../src/domain/bitumenFills';
import {eligibleBatchRooms,planAutoPlaceToday,reconcileBitumenUse,remainingByBatch,type BitumenRule,type BitumenUseRow,type UseBatch,type UseLoad} from '../src/domain/bitumenUse';

/** Bitumen Record Fill, phase 1: the pure rules, and how fills and asphalt-load use share one batch. */
const TODAY='2026-11-18';
const fb=(id:string,arrivedDay:string,remainingKg:number,extra:Partial<FillBatch>={}):FillBatch=>({id,batchNumber:`BIT-${id}`,arrivedDay,active:true,closed:false,remainingKg,pricePerKgUsd:1,...extra});
const plan=(batches:FillBatch[],kg:number,extra:Partial<Parameters<typeof planFill>[0]>={})=>planFill({batches,usingBatchId:null,kg,day:TODAY,today:TODAY,...extra});

describe('planning a fill',()=>{
  it('takes from the oldest open batch first',()=>{
    const result=plan([fb('b2','2026-11-10',5000),fb('b1','2026-11-01',5000)],3000);
    expect(result.issue).toBeNull();
    expect(result.portions).toEqual([expect.objectContaining({batchId:'b1',kg:3000,closesBatch:false,remainingAfterKg:2000})]);
  });
  it('takes from the batch the Owner chose to use first',()=>{
    const result=plan([fb('b1','2026-11-01',5000),fb('b2','2026-11-10',5000)],3000,{usingBatchId:'b2'});
    expect(result.portions.map(p=>p.batchId)).toEqual(['b2']);
  });
  it('splits across two batches when the first runs out and counts as one fill',()=>{
    const result=plan([fb('b1','2026-11-01',2000,{pricePerKgUsd:1}),fb('b2','2026-11-10',5000,{pricePerKgUsd:2})],3500);
    expect(result.issue).toBeNull();
    expect(result.portions.map(p=>[p.batchId,p.kg,p.closesBatch])).toEqual([['b1',2000,true],['b2',1500,false]]);
    expect(result.totalKg).toBe(3500);
    expect(result.cost.costUsd).toBe(5000);
  });
  it('can exactly empty a batch and closes it',()=>{
    const result=plan([fb('b1','2026-11-01',2000)],2000);
    expect(result.issue).toBeNull();
    expect(result.portions[0]).toMatchObject({kg:2000,closesBatch:true,remainingAfterKg:0});
  });
  it('rejects a fill larger than every open batch holds and says by how much',()=>{
    const result=plan([fb('b1','2026-11-01',2000),fb('b2','2026-11-10',1000)],3500);
    expect(result.issue).toBe('over_limit');
    expect(result.overByKg).toBe(500);
  });
  it('never takes from a closed or cancelled batch',()=>{
    const batches=[fb('b1','2026-11-01',9000,{closed:true}),fb('b2','2026-11-02',9000,{active:false}),fb('b3','2026-11-03',1000)];
    expect(plan(batches,1000).portions.map(p=>p.batchId)).toEqual(['b3']);
    const over=plan(batches,1500);
    expect(over.issue).toBe('over_limit');expect(over.overByKg).toBe(500);
    expect(plan(batches,100,{usingBatchId:'b1'}).issue).toBe('batch_not_open');
  });
  it('rejects a quantity that is not above zero',()=>{
    expect(plan([fb('b1','2026-11-01',100)],0).issue).toBe('invalid_quantity');
    expect(plan([fb('b1','2026-11-01',100)],-5).issue).toBe('invalid_quantity');
    expect(plan([fb('b1','2026-11-01',100)],Number.NaN).issue).toBe('invalid_quantity');
  });
  it('rejects a future date and a date before every open batch arrived',()=>{
    expect(plan([fb('b1','2026-11-01',100)],10,{day:'2026-11-19'}).issue).toBe('future_date');
    expect(plan([fb('b1','2026-11-05',100)],10,{day:'2026-11-04'}).issue).toBe('before_arrival');
  });
  it('uses only batches that had arrived by the fill date',()=>{
    const result=plan([fb('b1','2026-11-01',1000),fb('b2','2026-11-10',5000)],1500,{day:'2026-11-05'});
    expect(result.issue).toBe('over_limit');expect(result.overByKg).toBe(500);
  });
  it('shows an unpriced part as Unpriced, never zero',()=>{
    const result=plan([fb('b1','2026-11-01',1000,{pricePerKgUsd:null}),fb('b2','2026-11-02',5000,{pricePerKgUsd:2})],1500);
    expect(result.cost).toEqual({costUsd:1000,pricedKg:500,unpricedKg:1000,fullyPriced:false});
    expect(fillCost([{batchId:'x',kg:300,pricePerKgUsd:null}])).toEqual({costUsd:null,pricedKg:0,unpricedKg:300,fullyPriced:false});
  });
  it('does not guess a portion for an over-limit fill but still lists what the batches hold',()=>{
    const result=plan([fb('b1','2026-11-01',2000)],3000);
    expect(result.portions.reduce((s,p)=>s+p.kg,0)).toBe(2000);
    expect(result.overByKg).toBe(1000);
  });
});

describe('cancelling a fill',()=>{
  it('needs a reason and cannot be done twice',()=>{
    expect(validateFillCancellation('   ','Active')).toMatch(/reason/i);
    expect(validateFillCancellation('Wrong truck','Cancelled')).toMatch(/already cancelled/i);
    expect(validateFillCancellation(' Wrong truck ','Active')).toBeNull();
  });
});

describe('remaining',()=>{
  it('is delivered plus adjustments, less active fills, less estimated asphalt use',()=>{
    expect(batchRemainingKg({deliveredKg:20000,adjustmentKg:-500,filledKg:3000,usedKg:4000})).toBe(12500);
  });
  it('flows through the batch overview, and a cancelled fill (kg back) is simply not counted',()=>{
    const base:Omit<BitumenBatch,'status'|'remainingKg'|'closure'|'closureHistory'>={id:'b1',batchNumber:'BIT-1',arrivedAt:'2026-11-01T08:00:00.000Z',supplierId:null,supplierName:null,gradeId:null,gradeName:'60/70',invoiceNumber:null,ticketNumber:null,notes:null,deliveredKg:20000,usedKg:4000,adjustmentKg:-500,priceBasis:null,priceUsd:null,vatRatePercent:null,subtotalUsd:null,totalUsd:null,pricePerTonUsd:null,priced:false,recordStatus:'Active',cancellationReason:null,cancelledAt:null,correctionHistory:[],createdAt:'2026-11-01T08:00:00.000Z'};
    expect(buildBitumenOverview([{...base,filledKg:3000}],null).batches[0]!.remainingKg).toBe(12500);
    expect(buildBitumenOverview([{...base,filledKg:0}],null).batches[0]!.remainingKg).toBe(15500);
    expect(buildBitumenOverview([base],null).batches[0]!.remainingKg).toBe(15500);
  });
});

describe('fills and asphalt-load use share one batch',()=>{
  const RULE:BitumenRule={itemId:'base',itemName:'Base',enabled:true,aggregateKg:1600,bitumenKg:50,countFrom:'2026-10-01'};
  const ub=(id:string,delivered:number,extra:Partial<UseBatch>={}):UseBatch=>({id,arrivedDay:'2026-11-01',active:true,deliveredKg:delivered,adjustmentKg:0,...extra});
  const load=(id:string,mixKg:number,extra:Partial<UseLoad>={}):UseLoad=>({id,itemId:'base',itemName:'Base',loadNumber:`ASP-${id}`,confirmedAt:'2026-11-10T09:00:00',active:true,mixKg,...extra});
  const stored=(rows:ReturnType<typeof reconcileBitumenUse>['rows']):BitumenUseRow[]=>rows.map((row,index)=>({...row,id:`u${index}`,createdAt:`2026-11-10T10:0${index}:00`}));

  it('asphalt loads cannot overdraw a batch that fills already emptied',()=>{
    // 1,000 kg in the batch, a fill took 800, so a load needing 312.5 kg gets only 200 and 112.5 is listed, not hidden.
    const result=reconcileBitumenUse({rules:[RULE],loads:[load('1',10000)],existing:[],batches:[ub('b1',1000,{fillKg:800})],usingBatchId:null});
    expect(result.rows.map(r=>[r.batchId,r.kg])).toEqual([['b1',200],[null,112.5]]);
    expect(result.attention).toEqual([expect.objectContaining({loadId:'1',kind:'uncovered',kg:112.5})]);
  });
  it('a fill is blocked from taking what asphalt loads already used (the other order)',()=>{
    const first=reconcileBitumenUse({rules:[RULE],loads:[load('1',32000)],existing:[],batches:[ub('b1',1000)],usingBatchId:null});
    const rows=stored(first.rows);                                  // 1,000 kg of use
    const remaining=remainingByBatch([ub('b1',1000)],rows).get('b1')!;
    expect(remaining).toBe(0);
    const result=plan([fb('b1','2026-11-01',remaining)],10);
    expect(result.issue).toBe('over_limit');
  });
  it('reconcile never writes or reverses anything because of a fill, and running it again adds nothing',()=>{
    const batches=[ub('b1',2000)];
    const first=reconcileBitumenUse({rules:[RULE],loads:[load('1',32000)],existing:[],batches,usingBatchId:null});
    const rows=stored(first.rows);                                  // uses 1,000 of the 2,000
    const withFill=[ub('b1',2000,{fillKg:1000})];                   // a fill then empties the batch
    const again=reconcileBitumenUse({rules:[RULE],loads:[load('1',32000)],existing:rows,batches:withFill,usingBatchId:null});
    expect(again.rows).toEqual([]);expect(again.attention).toEqual([]);
  });
  it('a cancelled fill returns its kg, so a load left out earlier is no longer short once re-placed by hand',()=>{
    const full=remainingByBatch([ub('b1',1000,{fillKg:1000})],[]).get('b1');
    const back=remainingByBatch([ub('b1',1000,{fillKg:0})],[]).get('b1');
    expect([full,back]).toEqual([0,1000]);
  });
  it('left-out room and today auto-placement also count fills',()=>{
    expect(eligibleBatchRooms('2026-11-10T09:00:00',[ub('b1',1000,{fillKg:700})],[],null)).toEqual([{id:'b1',remainingKg:300}]);
    const row=(kg:number,batchId:string|null):BitumenUseRow=>({id:`r${kg}`,loadId:'L',batchId,kind:'use',kg,mixKg:1,ruleAggregateKg:1600,ruleBitumenKg:50,loadNumber:'L',loadConfirmedAt:`${TODAY}T08:00:00`,itemName:'Base',note:null,createdAt:`${TODAY}T08:00:00`});
    const planned=planAutoPlaceToday({rows:[row(500,null)],batches:[ub('b1',1000,{fillKg:700})],usingBatchId:null,today:TODAY});
    expect(planned.filter(r=>r.kind==='moved').reduce((s,r)=>s+r.kg,0)).toBe(300);
  });
});

describe('a batch price per kg',()=>{
  it('turns a per-ton, per-kg or whole-batch price into a price per kg, and Unpriced into null',()=>{
    expect(batchPricePerKg({priceBasis:'per_ton',priceUsd:800,subtotalUsd:8000,deliveredKg:10000})).toBe(0.8);
    expect(batchPricePerKg({priceBasis:'per_kg',priceUsd:0.9,subtotalUsd:null,deliveredKg:10000})).toBe(0.9);
    expect(batchPricePerKg({priceBasis:'whole',priceUsd:5000,subtotalUsd:5000,deliveredKg:10000})).toBe(0.5);
    expect(batchPricePerKg({priceBasis:null,priceUsd:null,subtotalUsd:null,deliveredKg:10000})).toBeNull();
  });
});
