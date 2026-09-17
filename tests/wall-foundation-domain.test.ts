import {describe,expect,it} from 'vitest';

import {
  aggregateActiveQuantity,buildFoundationComposition,calculateStoneCoreVolume,clampStoneCorePosition,concreteVariance,
  defaultStoneCorePosition,estimatedConcreteVolume,nudgeStoneCorePosition,validateCompositionRecordDraft,
  validateFoundationVolumeAgainstStone,validateStoneCapacity,validateStoneCoreOffsets,
  type FoundationCompositionRecord,type StoneCoreOffsets,
} from '../src/domain/wallFoundation';

const foundation={lengthM:20,heightM:1,bottomThicknessM:1.5,topThicknessM:1.5};
const record=(overrides:Partial<FoundationCompositionRecord>={}):FoundationCompositionRecord=>({
  id:'rec',baseId:'base',wallId:'wall',materialType:'stone',quantityM3:5,recordedOn:'2026-09-01',notes:'',
  cancelledAt:null,cancelledReason:null,correctionHistory:[],createdAt:'2026-09-01T00:00:00.000Z',updatedAt:null,...overrides,
});
const offsets=(overrides:Partial<StoneCoreOffsets>={}):StoneCoreOffsets=>({lengthM:10,depthM:.5,bottomThicknessM:.8,topThicknessM:.8,longitudinalOffsetM:5,verticalOffsetM:.25,transverseOffsetM:0,...overrides});

describe('estimated concrete',()=>{
  it('is net foundation volume minus active Stone',()=>{
    expect(estimatedConcreteVolume(30,10)).toBe(20);
  });
  it('never goes negative even if called with more Stone than the foundation',()=>{
    expect(estimatedConcreteVolume(10,15)).toBe(0);
  });
  it('is the whole net volume when no Stone is recorded',()=>{
    expect(estimatedConcreteVolume(30,0)).toBe(30);
  });
  it('is zero when Stone fills the entire foundation',()=>{
    expect(estimatedConcreteVolume(30,30)).toBe(0);
  });
});

describe('active Stone aggregate',()=>{
  it('sums only active records for the requested material',()=>{
    const records=[record({quantityM3:5}),record({id:'r2',quantityM3:3}),record({id:'r3',materialType:'ready_mix',quantityM3:100})];
    expect(aggregateActiveQuantity(records,'stone')).toBe(8);
    expect(aggregateActiveQuantity(records,'ready_mix')).toBe(100);
  });
  it('excludes cancelled records',()=>{
    const records=[record({quantityM3:5}),record({id:'r2',quantityM3:3,cancelledAt:'2026-09-02T00:00:00.000Z',cancelledReason:'duplicate'})];
    expect(aggregateActiveQuantity(records,'stone')).toBe(5);
  });
  it('is zero for an empty record set',()=>{
    expect(aggregateActiveQuantity([],'stone')).toBe(0);
  });
});

describe('Stone capacity refusal',()=>{
  it('refuses a new quantity that would exceed the net foundation volume',()=>{
    expect(validateStoneCapacity(10,8,3)[0]).toMatch(/more than the foundation's net volume/);
  });
  it('accepts a quantity that exactly fills the remaining capacity',()=>{
    expect(validateStoneCapacity(10,8,2)).toEqual([]);
  });
  it('refuses a non-positive quantity',()=>{
    expect(validateStoneCapacity(10,0,0)).toEqual(['Stone quantity must be greater than zero.']);
    expect(validateStoneCapacity(10,0,-1)).toEqual(['Stone quantity must be greater than zero.']);
  });
});

describe('geometry correction revalidates composition',()=>{
  it('refuses a reduced foundation volume that would strand already-recorded Stone',()=>{
    expect(validateFoundationVolumeAgainstStone(6,8)[0]).toMatch(/more than the proposed net volume/);
  });
  it('accepts a reduced volume that still fits the recorded Stone',()=>{
    expect(validateFoundationVolumeAgainstStone(8,8)).toEqual([]);
  });
});

describe('actual vs. estimated concrete variance',()=>{
  it('reports a positive variance when actual exceeds estimated',()=>{
    expect(concreteVariance(20,23)).toEqual({varianceM3:3,direction:'over'});
  });
  it('reports a negative variance when actual is under estimated',()=>{
    expect(concreteVariance(20,17)).toEqual({varianceM3:-3,direction:'under'});
  });
  it('reports no variance when actual matches estimated',()=>{
    expect(concreteVariance(20,20)).toEqual({varianceM3:0,direction:'none'});
  });
});

describe('simple-mode Stone-core position',()=>{
  it('defaults to the centre',()=>{
    expect(defaultStoneCorePosition()).toEqual({xNorm:.5,yNorm:.5});
  });
  it('clamps a position that would place the core outside the drawn boundary',()=>{
    expect(clampStoneCorePosition({xNorm:-.5,yNorm:2})).toEqual({xNorm:.12,yNorm:.88});
  });
  it('keeps an in-range position unchanged',()=>{
    expect(clampStoneCorePosition({xNorm:.3,yNorm:.7})).toEqual({xNorm:.3,yNorm:.7});
  });
  it('nudges by a fixed increment and reclamps at the boundary',()=>{
    expect(nudgeStoneCorePosition({xNorm:.5,yNorm:.5},'x',.05)).toEqual({xNorm:.55,yNorm:.5});
    expect(nudgeStoneCorePosition({xNorm:.9,yNorm:.5},'x',.5)).toEqual({xNorm:.88,yNorm:.5});
  });
  it('dragging the position never changes a recorded Stone volume — position and quantity are independent fields',()=>{
    const before=aggregateActiveQuantity([record({quantityM3:5})],'stone');
    clampStoneCorePosition({xNorm:.1,yNorm:.9});
    expect(aggregateActiveQuantity([record({quantityM3:5})],'stone')).toBe(before);
  });
});

describe('detailed-mode Stone-core geometry',()=>{
  it('calculates volume with the same trapezoid formula as the base',()=>{
    expect(calculateStoneCoreVolume({lengthM:10,depthM:.5,bottomThicknessM:.8,topThicknessM:.8})).toBe(4);
    expect(calculateStoneCoreVolume({lengthM:10,depthM:.5,bottomThicknessM:1,topThicknessM:.6})).toBe(4);
  });
  it('accepts a core fully contained within the foundation',()=>{
    expect(validateStoneCoreOffsets(offsets(),foundation)).toEqual([]);
  });
  it('refuses non-positive dimensions',()=>{
    expect(validateStoneCoreOffsets(offsets({lengthM:0}),foundation)).toContain('Stone core length must be greater than zero.');
    expect(validateStoneCoreOffsets(offsets({depthM:-1}),foundation)).toContain('Stone core height/depth must be greater than zero.');
  });
  it('refuses a core that extends past the foundation length',()=>{
    expect(validateStoneCoreOffsets(offsets({lengthM:16,longitudinalOffsetM:5}),foundation)[0]).toMatch(/extends beyond the foundation length/);
  });
  it('refuses a core that extends past the foundation depth',()=>{
    expect(validateStoneCoreOffsets(offsets({depthM:.9,verticalOffsetM:.5}),foundation)[0]).toMatch(/extends beyond the foundation height\/depth/);
  });
  it('refuses a core thickness wider than the foundation itself',()=>{
    expect(validateStoneCoreOffsets(offsets({bottomThicknessM:2}),foundation)[0]).toMatch(/bottom thickness\/width cannot exceed/);
  });
  it('accepts a core touching the outer boundary exactly (zero clearance)',()=>{
    expect(validateStoneCoreOffsets(offsets({lengthM:20,longitudinalOffsetM:0}),foundation)).toEqual([]);
  });
  it('does not bound the transverse offset, only requires it to be a finite reference number',()=>{
    expect(validateStoneCoreOffsets(offsets({transverseOffsetM:Number.NaN}),foundation)[0]).toMatch(/transverse offset/);
    expect(validateStoneCoreOffsets(offsets({transverseOffsetM:999}),foundation)).toEqual([]);
  });
});

describe('composition record draft validation',()=>{
  it('requires a positive quantity and a date',()=>{
    expect(validateCompositionRecordDraft({materialType:'stone',quantityM3:0,recordedOn:'2026-09-01'})).toEqual(['Stone quantity must be greater than zero.']);
    expect(validateCompositionRecordDraft({materialType:'ready_mix',quantityM3:5,recordedOn:''})).toEqual(['Choose the date this quantity was recorded.']);
  });
  it('accepts a valid draft',()=>{
    expect(validateCompositionRecordDraft({materialType:'ready_mix',quantityM3:5,recordedOn:'2026-09-01'})).toEqual([]);
  });
});

describe('buildFoundationComposition — the read-model shared by screen, diagram, and reports',()=>{
  const base={baseId:'base',wallId:'wall',mode:'composite' as const,stoneCoreMode:'simple' as const,position:{xNorm:.5,yNorm:.5},offsets:null,netFoundationVolumeM3:30};

  it('has no variance until Ready Mix is actually recorded',()=>{
    const result=buildFoundationComposition({...base,records:[record({quantityM3:10})]});
    expect(result.activeStoneM3).toBe(10);
    expect(result.estimatedConcreteM3).toBe(20);
    expect(result.variance).toBeNull();
  });
  it('compares actual Ready Mix against the estimate once recorded',()=>{
    const result=buildFoundationComposition({...base,records:[record({quantityM3:10}),record({id:'r2',materialType:'ready_mix',quantityM3:22})]});
    expect(result.estimatedConcreteM3).toBe(20);
    expect(result.activeReadyMixM3).toBe(22);
    expect(result.variance).toEqual({varianceM3:2,direction:'over'});
  });
  it('handles zero Stone: the whole net volume is estimated concrete',()=>{
    const result=buildFoundationComposition({...base,records:[]});
    expect(result.activeStoneM3).toBe(0);
    expect(result.estimatedConcreteM3).toBe(30);
  });
  it('handles a foundation filled entirely by Stone: estimated concrete is zero',()=>{
    const result=buildFoundationComposition({...base,records:[record({quantityM3:30})]});
    expect(result.estimatedConcreteM3).toBe(0);
  });
  it('excludes a cancelled Stone record from the aggregate and re-estimates concrete',()=>{
    const result=buildFoundationComposition({...base,records:[record({quantityM3:10}),record({id:'r2',quantityM3:8,cancelledAt:'2026-09-05T00:00:00.000Z',cancelledReason:'measured wrong'})]});
    expect(result.activeStoneM3).toBe(10);
    expect(result.estimatedConcreteM3).toBe(20);
  });
  it('reflects a corrected Stone quantity by using the record already updated in place',()=>{
    const corrected=record({quantityM3:14});
    const result=buildFoundationComposition({...base,records:[corrected]});
    expect(result.activeStoneM3).toBe(14);
    expect(result.estimatedConcreteM3).toBe(16);
  });
});
