import {describe,expect,it} from 'vitest';

import {allocateDieselBatches,fillCost,formatBatchNumber,previewTankFill,type BatchInput,type FillInput,type GaugeInput} from '../src/domain/fuelBatches';

/** DEC-492. Derived first-in-first-out allocation of diesel fills to numbered batches. */
const batch=(sequence:number,arrivedAt:string,deliveredLitres:number,pricePerLitreUsd:number|null=1,extra:Partial<BatchInput>={}):BatchInput=>({id:`b${sequence}`,batchNumber:formatBatchNumber(2026,sequence),arrivedAt,deliveredLitres,pricePerLitreUsd,status:'Active',...extra});
const fill=(id:string,confirmedAt:string,litres:number,preferredBatchId:string|null=null):FillInput=>({id,confirmedAt,litres,preferredBatchId});
const dip=(id:string,confirmedAt:string,litres:number):GaugeInput=>({id,confirmedAt,litres});
const run=(batches:BatchInput[],fills:FillInput[]=[],gauges:GaugeInput[]=[])=>allocateDieselBatches({batches,fills,gauges});
const summary=(result:ReturnType<typeof run>,id:string)=>result.batches.find(value=>value.id===id)!;

describe('batch numbers',()=>{
  it('formats DSL-YYYY-NNNNN with five digits and widens past 99999',()=>{
    expect(formatBatchNumber(2026,4)).toBe('DSL-2026-00004');
    expect(formatBatchNumber(2026,99999)).toBe('DSL-2026-99999');
    expect(formatBatchNumber(2027,100000)).toBe('DSL-2027-100000');
  });
});

describe('first in, first out',()=>{
  it('takes a fill from the oldest open batch and keeps the tank equal to the batch remainders',()=>{
    const result=run([batch(4,'2026-10-01T08:00:00Z',1000),batch(5,'2026-10-03T08:00:00Z',1000)],[fill('f1','2026-10-03T09:00:00Z',160)]);
    expect(result.fills.f1!.portions).toEqual([{batchId:'b4',batchNumber:'DSL-2026-00004',litres:160,kind:'fill'}]);
    expect(summary(result,'b4')).toMatchObject({filledLitres:160,remainingLitres:840,status:'in_use'});
    expect(summary(result,'b5')).toMatchObject({filledLitres:0,remainingLitres:1000,status:'waiting'});
    expect(result.tankLitres).toBe(1840);
    expect(result.overfillAlert).toBe(false);
  });

  it('splits a fill across batches and closes the first at zero',()=>{
    const result=run([batch(4,'2026-10-01T08:00:00Z',1000),batch(5,'2026-10-03T08:00:00Z',1000)],[fill('f1','2026-10-03T09:00:00Z',660),fill('f2','2026-10-03T10:00:00Z',400)]);
    expect(result.fills.f2!.portions.map(value=>[value.batchId,value.litres])).toEqual([['b4',340],['b5',60]]);
    expect(summary(result,'b4')).toMatchObject({remainingLitres:0,status:'closed'});
    expect(summary(result,'b5')).toMatchObject({remainingLitres:940,status:'in_use'});
    expect(result.tankLitres).toBe(940);
  });

  it('respects a batch the user chose and then continues first in, first out',()=>{
    const batches=[batch(4,'2026-10-01T08:00:00Z',100),batch(5,'2026-10-02T08:00:00Z',100),batch(6,'2026-10-03T08:00:00Z',100)];
    const result=run(batches,[fill('f1','2026-10-03T09:00:00Z',130,'b5')]);
    expect(result.fills.f1!.portions.map(value=>[value.batchId,value.litres])).toEqual([['b5',100],['b4',30]]);
    expect(summary(result,'b5').status).toBe('closed');
    expect(summary(result,'b4')).toMatchObject({remainingLitres:70,status:'in_use'});
  });

  it('ignores a chosen batch that is empty, cancelled or has not arrived yet',()=>{
    const batches=[batch(4,'2026-10-01T08:00:00Z',100),batch(5,'2026-10-05T08:00:00Z',100),batch(6,'2026-10-02T08:00:00Z',100,1,{status:'Cancelled'})];
    const result=run(batches,[fill('f1','2026-10-03T09:00:00Z',40,'b5'),fill('f2','2026-10-03T10:00:00Z',10,'b6')]);
    expect(result.fills.f1!.portions.map(value=>value.batchId)).toEqual(['b4']);
    expect(result.fills.f2!.portions.map(value=>value.batchId)).toEqual(['b4']);
    expect(result.batches.find(value=>value.id==='b6')).toMatchObject({status:'cancelled',remainingLitres:0});
  });

  it('allocates in date order whatever order the fills are supplied in',()=>{
    const a=[fill('late','2026-10-04T09:00:00Z',70),fill('early','2026-10-02T09:00:00Z',70)];
    const result=run([batch(4,'2026-10-01T08:00:00Z',100),batch(5,'2026-10-01T09:00:00Z',100)],a);
    expect(result.fills.early!.portions.map(value=>[value.batchId,value.litres])).toEqual([['b4',70]]);
    expect(result.fills.late!.portions.map(value=>[value.batchId,value.litres])).toEqual([['b4',30],['b5',40]]);
  });
});

describe('overfill',()=>{
  it('saves the excess as a shortfall and raises the alert without blocking',()=>{
    const result=run([batch(4,'2026-10-01T08:00:00Z',100)],[fill('f1','2026-10-02T09:00:00Z',130)]);
    expect(result.fills.f1).toMatchObject({shortfallLitres:30,outstandingShortfallLitres:30});
    expect(result.fills.f1!.portions.map(value=>value.litres)).toEqual([100]);
    expect(result.outstandingShortfallLitres).toBe(30);
    expect(result.overfillAlert).toBe(true);
    expect(result.tankLitres).toBe(0);
    expect(summary(result,'b4').status).toBe('closed');
  });

  it('is resolved by a later delivery, whose first litres cover the fuel already used',()=>{
    const result=run([batch(4,'2026-10-01T08:00:00Z',100),batch(5,'2026-10-05T08:00:00Z',1000)],[fill('f1','2026-10-02T09:00:00Z',130)]);
    expect(result.fills.f1!.portions.map(value=>[value.batchId,value.litres,value.kind])).toEqual([['b4',100,'fill'],['b5',30,'cover']]);
    expect(result.fills.f1).toMatchObject({shortfallLitres:30,outstandingShortfallLitres:0});
    expect(summary(result,'b5')).toMatchObject({filledLitres:30,remainingLitres:970});
    expect(result.overfillAlert).toBe(false);
    expect(result.tankLitres).toBe(970);
  });

  it('is resolved when the missing delivery is entered with an earlier date',()=>{
    const fills=[fill('f1','2026-10-02T09:00:00Z',130)];
    expect(run([batch(4,'2026-10-01T08:00:00Z',100)],fills).overfillAlert).toBe(true);
    const fixed=run([batch(4,'2026-10-01T08:00:00Z',100),batch(5,'2026-10-02T07:00:00Z',200)],fills);
    expect(fixed.overfillAlert).toBe(false);
    expect(fixed.fills.f1!.portions.map(value=>[value.batchId,value.litres])).toEqual([['b4',100],['b5',30]]);
  });
});

describe('dip readings',()=>{
  const batches=()=>[batch(4,'2026-10-01T08:00:00Z',1000),batch(5,'2026-10-02T08:00:00Z',1000)];

  it('records a lower dip as a visible adjustment on the oldest open batch, keeping both figures',()=>{
    const result=run(batches(),[fill('f1','2026-10-02T09:00:00Z',640)],[dip('g1','2026-10-03T07:00:00Z',1340)]);
    expect(result.adjustments).toEqual([{gaugeId:'g1',batchId:'b4',litres:-20,calculatedLitres:1360,dipLitres:1340,confirmedAt:'2026-10-03T07:00:00Z'}]);
    expect(summary(result,'b4')).toMatchObject({adjustmentLitres:-20,remainingLitres:340});
    expect(result.tankLitres).toBe(1340);
  });

  it('can take exactly what is left of the oldest batch, which then closes',()=>{
    const result=run(batches(),[fill('f1','2026-10-02T09:00:00Z',900)],[dip('g1','2026-10-03T07:00:00Z',1000)]);
    expect(result.adjustments.map(value=>[value.batchId,value.litres])).toEqual([['b4',-100]]);
    expect(summary(result,'b4')).toMatchObject({remainingLitres:0,status:'closed'});
    expect(result.tankLitres).toBe(1000);
  });

  it('spills across batches when one batch cannot absorb the difference',()=>{
    const result=run(batches(),[fill('f1','2026-10-02T09:00:00Z',950)],[dip('g1','2026-10-03T07:00:00Z',800)]);
    expect(result.adjustments.map(value=>[value.batchId,value.litres])).toEqual([['b4',-50],['b5',-200]]);
    expect(summary(result,'b4')).toMatchObject({remainingLitres:0,status:'closed'});
    expect(summary(result,'b5').remainingLitres).toBe(800);
    expect(result.tankLitres).toBe(800);
  });

  it('adds a higher dip to the oldest open batch',()=>{
    const result=run(batches(),[],[dip('g1','2026-10-03T07:00:00Z',2100)]);
    expect(result.adjustments).toEqual([expect.objectContaining({batchId:'b4',litres:100,calculatedLitres:2000,dipLitres:2100})]);
    expect(result.tankLitres).toBe(2100);
  });

  it('records nothing when the dip matches the batches',()=>{
    const result=run(batches(),[],[dip('g1','2026-10-03T07:00:00Z',2000)]);
    expect(result.adjustments).toEqual([]);
  });

  it('clears an outstanding shortfall, as a gauge reading resets the tank balance',()=>{
    const result=run([batch(4,'2026-10-01T08:00:00Z',100)],[fill('f1','2026-10-02T09:00:00Z',130)],[dip('g1','2026-10-03T07:00:00Z',0)]);
    expect(result.fills.f1).toMatchObject({shortfallLitres:30,outstandingShortfallLitres:0});
    expect(result.overfillAlert).toBe(false);
  });
});

describe('cost from batch prices',()=>{
  it('prices each portion at its own batch price and counts unpriced litres openly',()=>{
    const batches=[batch(4,'2026-10-01T08:00:00Z',340,1.1),batch(5,'2026-10-02T08:00:00Z',1000,null)];
    const result=run(batches,[fill('f1','2026-10-03T09:00:00Z',400)]);
    expect(fillCost(result.fills.f1!,result.batches)).toEqual({pricedLitres:340,unpricedLitres:60,costUsd:374,fullyPriced:false});
  });

  it('is fully priced when every portion has a price',()=>{
    const batches=[batch(4,'2026-10-01T08:00:00Z',100,1.1),batch(5,'2026-10-02T08:00:00Z',100,1.3)];
    const result=run(batches,[fill('f1','2026-10-03T09:00:00Z',150)]);
    expect(fillCost(result.fills.f1!,result.batches)).toEqual({pricedLitres:150,unpricedLitres:0,costUsd:175,fullyPriced:true});
  });

  it('counts a shortfall as unpriced litres, never as zero cost',()=>{
    const result=run([batch(4,'2026-10-01T08:00:00Z',100,1)],[fill('f1','2026-10-02T09:00:00Z',130)]);
    expect(fillCost(result.fills.f1!,result.batches)).toMatchObject({pricedLitres:100,unpricedLitres:30,fullyPriced:false});
  });
});

describe('preview before saving a fill',()=>{
  it('shows the batch portions, which batch closes, and the tank after the fill',()=>{
    const batches=[batch(4,'2026-10-01T08:00:00Z',1000),batch(5,'2026-10-03T08:00:00Z',1000)];
    const existing=[fill('f0','2026-10-03T07:00:00Z',660)];
    const preview=previewTankFill({batches,fills:existing,gauges:[]},{litres:400,preferredBatchId:null,at:'2026-10-03T12:00:00Z'});
    expect(preview.portions).toEqual([
      {batchId:'b4',batchNumber:'DSL-2026-00004',litres:340,closesBatch:true,remainingAfterLitres:0,statusBefore:'in_use'},
      {batchId:'b5',batchNumber:'DSL-2026-00005',litres:60,closesBatch:false,remainingAfterLitres:940,statusBefore:'waiting'},
    ]);
    expect(preview).toMatchObject({shortfallLitres:0,tankBeforeLitres:1340,tankAfterLitres:940,overfillAlert:false});
  });

  it('warns when the fill exceeds all diesel and still lists what is available',()=>{
    const preview=previewTankFill({batches:[batch(4,'2026-10-01T08:00:00Z',100)],fills:[],gauges:[]},{litres:130,preferredBatchId:null,at:'2026-10-03T12:00:00Z'});
    expect(preview).toMatchObject({shortfallLitres:30,tankBeforeLitres:100,tankAfterLitres:0,overfillAlert:true});
  });
});
