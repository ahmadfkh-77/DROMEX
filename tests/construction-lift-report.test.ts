import {describe,expect,it} from 'vitest';

import {
  buildLiftReportGroup,liftHasActivityOn,liftsAsOf,projectLiftAsOf,
} from '../src/domain/constructionLiftReport';
import type {ConstructionLift} from '../src/domain/wallConstructionLift';

const snapshot=(net:number)=>({lengthM:5,heightM:.4,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0,grossVolumeM3:net,netVolumeM3:net});

const lift=(overrides:Partial<ConstructionLift>={}):ConstructionLift=>({
  id:'lift-1',parentType:'foundation',parentId:'f1',sequence:1,reference:'Lift 1',startElevationM:0,
  geometry:{lengthM:10,heightM:.5,bottomThicknessM:1,topThicknessM:1,deductionM3:0},netLiftVolumeM3:5,
  stonePhase:{calculationSnapshot:snapshot(2),calculatedStoneVolumeM3:2,actualStoneQuantityM3:2,manualOverride:false,
    workDate:'2026-09-10',position:{xNorm:.5,yNorm:.5},offsets:null,notes:''},
  concretePhase:null,status:'stone_placed',notes:'',correctionHistory:[],
  createdAt:'2026-09-09T08:00:00.000Z',updatedAt:null,...overrides,
});

const completed=(overrides:Partial<ConstructionLift>={})=>lift({
  status:'completed',
  concretePhase:{liftId:'lift-1',calculationMethod:'estimated_matrix',estimatedMatrixVolumeM3:3,independentCalculation:null,
    actualReadyMixQuantityM3:3.4,manualOverride:false,purpose:'Matrix fill',workDate:'2026-09-12',notes:''},
  ...overrides,
});

describe('projectLiftAsOf — a Daily Report never shows the future',()=>{
  it('hides a lift created after the report date entirely',()=>{
    expect(projectLiftAsOf(lift({createdAt:'2026-09-20T08:00:00.000Z'}),'2026-09-10')).toBeNull();
  });

  it('shows a lift created on the report date itself',()=>{
    expect(projectLiftAsOf(lift({createdAt:'2026-09-10T08:00:00.000Z'}),'2026-09-10')).not.toBeNull();
  });

  it('shows a lift whose Stone comes later as Planned, with no Stone quantity at all',()=>{
    const projected=projectLiftAsOf(lift({stonePhase:{...lift().stonePhase,workDate:'2026-09-15'}}),'2026-09-10')!;
    expect(projected.status).toBe('planned');
    expect(projected.stonePhase.actualStoneQuantityM3).toBeNull();
    expect(projected.stonePhase.calculatedStoneVolumeM3).toBe(0);
    expect(projected.stonePhase.calculationSnapshot).toBeNull();
    expect(projected.stonePhase.workDate).toBeNull();
  });

  it('shows Stone placed on the report date as Concrete fill pending',()=>{
    const projected=projectLiftAsOf(lift(),'2026-09-10')!;
    expect(projected.status).toBe('stone_placed');
    expect(projected.stonePhase.actualStoneQuantityM3).toBe(2);
  });

  it('shows a lift whose concrete was poured later as still pending on the earlier date',()=>{
    const projected=projectLiftAsOf(completed(),'2026-09-11')!;
    expect(projected.status).toBe('stone_placed');
    expect(projected.concretePhase).toBeNull();
  });

  it('shows the lift as completed once the concrete work date has arrived',()=>{
    const projected=projectLiftAsOf(completed(),'2026-09-12')!;
    expect(projected.status).toBe('completed');
    expect(projected.concretePhase?.actualReadyMixQuantityM3).toBe(3.4);
  });

  it('never leaks concrete without its Stone, even if the concrete date is somehow earlier',()=>{
    // The lift itself already exists, so the only thing under test is the Stone-before-concrete rule.
    const odd=completed({createdAt:'2026-09-01T08:00:00.000Z',stonePhase:{...lift().stonePhase,workDate:'2026-09-20'},
      concretePhase:{...completed().concretePhase!,workDate:'2026-09-05'}});
    const projected=projectLiftAsOf(odd,'2026-09-06')!;
    expect(projected.status).toBe('planned');
    expect(projected.concretePhase).toBeNull();
  });

  it('hides a correction recorded after the report date and keeps earlier ones',()=>{
    const withCorrections=lift({correctionHistory:[
      {correctedAt:'2026-09-10T09:00:00.000Z',correctedBy:'Owner',reason:'Truck count re-checked',changes:[]},
      {correctedAt:'2026-09-14T09:00:00.000Z',correctedBy:'Owner',reason:'Later re-measure',changes:[]},
    ]});
    const projected=projectLiftAsOf(withCorrections,'2026-09-11')!;
    expect(projected.correctionHistory).toHaveLength(1);
    expect(projected.correctionHistory[0]!.reason).toBe('Truck count re-checked');
  });

  it('falls back to the creation date when a phase carries no work date of its own',()=>{
    const undated=lift({stonePhase:{...lift().stonePhase,workDate:null},createdAt:'2026-09-09T08:00:00.000Z'});
    expect(projectLiftAsOf(undated,'2026-09-09')!.status).toBe('stone_placed');
    expect(projectLiftAsOf(undated,'2026-09-08')).toBeNull();
  });

  it('keeps the stored status consistent with the projected phases, using the domain rule',()=>{
    const projected=projectLiftAsOf(completed(),'2026-09-11')!;
    expect(projected.status).toBe('stone_placed');
    expect(projected.concretePhase).toBeNull();
  });
});

describe('liftsAsOf and activity detection',()=>{
  it('drops future lifts and keeps construction order',()=>{
    const visible=liftsAsOf([
      lift({id:'c',sequence:3,createdAt:'2026-09-20T08:00:00.000Z'}),
      lift({id:'b',sequence:2}),lift({id:'a',sequence:1}),
    ],'2026-09-10');
    expect(visible.map(value=>value.sequence)).toEqual([1,2]);
  });

  it('reports a date on which a lift had Stone, concrete, creation or correction activity',()=>{
    expect(liftHasActivityOn(lift(),'2026-09-10')).toBe(true);
    expect(liftHasActivityOn(completed(),'2026-09-12')).toBe(true);
    expect(liftHasActivityOn(lift(),'2026-09-09')).toBe(true);
    expect(liftHasActivityOn(lift(),'2026-09-11')).toBe(false);
    expect(liftHasActivityOn(lift({correctionHistory:[{correctedAt:'2026-09-13T09:00:00.000Z',correctedBy:'Owner',reason:'r',changes:[]}]}),'2026-09-13')).toBe(true);
  });
});

describe('buildLiftReportGroup — totals come from the existing domain reconciliation',()=>{
  const group=(asOf:string,lifts:ConstructionLift[],net=20)=>
    buildLiftReportGroup({parentType:'foundation',parentId:'f1',parentReference:'Foundation F1',parentNetVolumeM3:net,lifts,asOf});

  it('reconciles only the lifts visible on the report date',()=>{
    const result=group('2026-09-11',[lift({id:'a',sequence:1}),lift({id:'b',sequence:2,createdAt:'2026-09-20T08:00:00.000Z'})]);
    expect(result.lifts).toHaveLength(1);
    expect(result.reconciliation.totalAllocatedLiftVolumeM3).toBe(5);
    expect(result.reconciliation.remainingUnallocatedVolumeM3).toBe(15);
  });

  it('excludes a later concrete pour from the actual Ready Mix total',()=>{
    expect(group('2026-09-11',[completed()]).reconciliation.totalActualReadyMixM3).toBe(0);
    expect(group('2026-09-12',[completed()]).reconciliation.totalActualReadyMixM3).toBe(3.4);
  });

  it('flags over-allocation through the domain reconciliation rather than its own arithmetic',()=>{
    const result=group('2026-09-11',[lift({id:'a',sequence:1}),lift({id:'b',sequence:2})],8);
    expect(result.reconciliation.overAllocated).toBe(true);
    expect(result.reconciliation.overAllocationM3).toBe(2);
  });

  it('is empty, not absent, when the parent has no visible lifts yet',()=>{
    const result=group('2026-09-01',[lift()]);
    expect(result.lifts).toHaveLength(0);
    expect(result.reconciliation.totalAllocatedLiftVolumeM3).toBe(0);
  });

  it('carries the parent identity so a foundation lift can never be read as a wall lift',()=>{
    const result=group('2026-09-11',[lift()]);
    expect(result.parentType).toBe('foundation');
    expect(result.parentReference).toBe('Foundation F1');
  });
});
