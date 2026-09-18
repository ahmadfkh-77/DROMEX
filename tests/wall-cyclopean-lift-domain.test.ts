import {describe, expect, it} from 'vitest';

import {
  calculateVolumeSnapshot, concreteMatrixVariance, deriveLiftStatus, diffCyclopeanLift, estimatedConcreteMatrixVolume,
  orderLiftsBySequence, reconcileLifts, validateConcretePhaseLink, validateEstimatedConcreteMatrixVolume,
  validateLiftAllocation, validateLiftSequence, validateStatusConsistency, validateStoneAgainstLiftEnvelope, validateVolumeDimensions,
  type ConcreteMatrixPhase, type CyclopeanLift, type StonePhase, type VolumeDimensions,
} from '../src/domain/wallCyclopeanLift';

const dims = (overrides: Partial<VolumeDimensions> = {}): VolumeDimensions => ({
  lengthM: 10, heightM: 1, bottomThicknessM: 1, topThicknessM: 1, deductionM3: 0, ...overrides,
});

const stonePhase = (overrides: Partial<StonePhase> = {}): StonePhase => ({
  calculationSnapshot: null, calculatedStoneVolumeM3: 0, actualStoneQuantityM3: null, manualOverride: false,
  workDate: null, position: null, offsets: null, notes: '', ...overrides,
});

const concretePhase = (liftId: string, overrides: Partial<ConcreteMatrixPhase> = {}): ConcreteMatrixPhase => ({
  liftId, calculationMethod: 'estimated_matrix', estimatedMatrixVolumeM3: 0, independentCalculation: null,
  actualReadyMixQuantityM3: null, manualOverride: false, purpose: 'structural', workDate: null, notes: '', ...overrides,
});

const lift = (overrides: Partial<CyclopeanLift> = {}): CyclopeanLift => ({
  id: 'lift-1', parentType: 'foundation', parentId: 'foundation-1', sequence: 1, reference: 'Lift 1',
  startElevationM: 0, geometry: dims(), netLiftVolumeM3: 10, stonePhase: stonePhase(), concretePhase: null, status: 'planned',
  notes: '', correctionHistory: [], createdAt: '2026-09-18T00:00:00.000Z', updatedAt: null, ...overrides,
});

describe('lift volume calculation', () => {
  it('computes gross and net volume for a constant-thickness lift', () => {
    expect(calculateVolumeSnapshot(dims({lengthM: 10, heightM: 1, bottomThicknessM: 1, topThicknessM: 1}))).toEqual({
      lengthM: 10, heightM: 1, bottomThicknessM: 1, topThicknessM: 1, deductionM3: 0, grossVolumeM3: 10, netVolumeM3: 10,
    });
  });
  it('computes the trapezoid average for a tapered lift', () => {
    const snapshot = calculateVolumeSnapshot(dims({lengthM: 10, heightM: 1, bottomThicknessM: 1.2, topThicknessM: 0.8}));
    expect(snapshot.grossVolumeM3).toBe(10);
    expect(snapshot.netVolumeM3).toBe(10);
  });
  it('subtracts deductions from the gross volume', () => {
    const snapshot = calculateVolumeSnapshot(dims({lengthM: 10, heightM: 1, bottomThicknessM: 1, topThicknessM: 1, deductionM3: 2}));
    expect(snapshot.grossVolumeM3).toBe(10);
    expect(snapshot.netVolumeM3).toBe(8);
  });
});

describe('lift dimension validation', () => {
  it('rejects a zero or negative length, height, or thickness', () => {
    expect(validateVolumeDimensions(dims({lengthM: 0}))[0]).toMatch(/Length/);
    expect(validateVolumeDimensions(dims({heightM: -1}))[0]).toMatch(/Height/);
    expect(validateVolumeDimensions(dims({bottomThicknessM: 0}))[0]).toMatch(/Bottom thickness/);
    expect(validateVolumeDimensions(dims({topThicknessM: -0.1}))[0]).toMatch(/Top thickness/);
  });
  it('rejects a non-finite or negative deduction', () => {
    expect(validateVolumeDimensions(dims({deductionM3: -1}))[0]).toMatch(/Deduction cannot be negative/);
    expect(validateVolumeDimensions(dims({deductionM3: Number.NaN}))[0]).toMatch(/Deduction cannot be negative/);
  });
  it('rejects a deduction greater than the gross volume', () => {
    expect(validateVolumeDimensions(dims({lengthM: 10, heightM: 1, bottomThicknessM: 1, topThicknessM: 1, deductionM3: 11}))[0]).toMatch(/Deduction cannot exceed the gross volume/);
  });
  it('accepts valid dimensions with no issues', () => {
    expect(validateVolumeDimensions(dims())).toEqual([]);
  });
});

describe('Stone calculated volume against the lift envelope', () => {
  it('accepts Stone volume within the lift net volume', () => {
    expect(validateStoneAgainstLiftEnvelope(10, 6)).toEqual([]);
  });
  it('rejects Stone calculated volume greater than net lift volume', () => {
    expect(validateStoneAgainstLiftEnvelope(10, 11)[0]).toMatch(/cannot exceed this lift's net structural volume/);
  });
  it('rejects a non-finite Stone volume', () => {
    expect(validateStoneAgainstLiftEnvelope(10, Number.NaN)[0]).toMatch(/finite number/);
  });
});

describe('estimated concrete matrix volume', () => {
  it('is net lift volume minus calculated Stone volume', () => {
    expect(estimatedConcreteMatrixVolume(10, 6)).toBe(4);
  });
  it('is the full net lift volume when no Stone is calculated', () => {
    expect(estimatedConcreteMatrixVolume(10, 0)).toBe(10);
  });
  it('is not clamped: it can go negative when Stone exceeds the lift volume', () => {
    expect(estimatedConcreteMatrixVolume(10, 15)).toBe(-5);
  });
});

describe('negative estimated concrete is rejected, not hidden', () => {
  it('accepts a non-negative estimate', () => {
    expect(validateEstimatedConcreteMatrixVolume(4)).toEqual([]);
    expect(validateEstimatedConcreteMatrixVolume(0)).toEqual([]);
  });
  it('rejects a negative estimate', () => {
    expect(validateEstimatedConcreteMatrixVolume(-5)[0]).toMatch(/cannot be negative/);
  });
});

describe('concrete calculation method', () => {
  it('records estimated_matrix as a distinct method from independent', () => {
    const estimated = concretePhase('lift-1', {calculationMethod: 'estimated_matrix', estimatedMatrixVolumeM3: 4});
    const independent = concretePhase('lift-1', {calculationMethod: 'independent', independentCalculation: calculateVolumeSnapshot(dims())});
    expect(estimated.calculationMethod).toBe('estimated_matrix');
    expect(independent.calculationMethod).toBe('independent');
    expect(independent.independentCalculation?.netVolumeM3).toBe(10);
  });
});

describe('actual Ready Mix variance', () => {
  it('reports a positive variance when actual exceeds the estimate', () => {
    expect(concreteMatrixVariance(4, 5)).toEqual({varianceM3: 1, direction: 'over'});
  });
  it('reports a negative variance when actual is under the estimate', () => {
    expect(concreteMatrixVariance(4, 3)).toEqual({varianceM3: -1, direction: 'under'});
  });
  it('reports no variance when actual matches the estimate exactly', () => {
    expect(concreteMatrixVariance(4, 4)).toEqual({varianceM3: 0, direction: 'none'});
  });
  it('never rejects an actual quantity for merely differing from the estimate', () => {
    expect(() => concreteMatrixVariance(4, 100)).not.toThrow();
    expect(concreteMatrixVariance(4, 100).direction).toBe('over');
  });
});

describe('lift status: honest, never presumes completion', () => {
  it('is planned before any Stone is recorded', () => {
    expect(deriveLiftStatus(lift())).toBe('planned');
  });
  it('is stone_placed (Concrete fill pending) once Stone is recorded but concrete phase is missing', () => {
    expect(deriveLiftStatus(lift({stonePhase: stonePhase({actualStoneQuantityM3: 6, workDate: '2026-09-01'})}))).toBe('stone_placed');
  });
  it('stays stone_placed when a concrete phase exists but carries no actual quantity or work date yet', () => {
    const withStone = lift({stonePhase: stonePhase({actualStoneQuantityM3: 6, workDate: '2026-09-01'})});
    expect(deriveLiftStatus({...withStone, concretePhase: concretePhase('lift-1')})).toBe('stone_placed');
  });
  it('is completed once the concrete phase carries an actual quantity or work date', () => {
    const withStone = lift({stonePhase: stonePhase({actualStoneQuantityM3: 6, workDate: '2026-09-01'})});
    expect(deriveLiftStatus({...withStone, concretePhase: concretePhase('lift-1', {actualReadyMixQuantityM3: 4})})).toBe('completed');
  });
});

describe('stored status must never disagree with the phase data', () => {
  it('accepts a valid planned lift (no Stone recorded)', () => {
    expect(validateStatusConsistency(lift({status: 'planned'}))).toEqual([]);
  });
  it('accepts a valid stone_placed lift (Stone recorded, concrete pending)', () => {
    const withStone = lift({status: 'stone_placed', stonePhase: stonePhase({actualStoneQuantityM3: 6, workDate: '2026-09-01'})});
    expect(validateStatusConsistency(withStone)).toEqual([]);
  });
  it('accepts a valid completed lift (Stone and concrete both recorded)', () => {
    const complete = lift({status: 'completed', stonePhase: stonePhase({actualStoneQuantityM3: 6, workDate: '2026-09-01'}), concretePhase: concretePhase('lift-1', {actualReadyMixQuantityM3: 4})});
    expect(validateStatusConsistency(complete)).toEqual([]);
  });
  it('rejects a lift stored as planned but carrying recorded Stone fields', () => {
    const bad = lift({status: 'planned', stonePhase: stonePhase({actualStoneQuantityM3: 6, workDate: '2026-09-01'})});
    expect(validateStatusConsistency(bad)[0]).toMatch(/disagrees with the Stone\/concrete phase data.*implies 'stone_placed'/);
  });
  it('rejects a lift stored as stone_placed with no Stone actually recorded', () => {
    const bad = lift({status: 'stone_placed'});
    expect(validateStatusConsistency(bad)[0]).toMatch(/implies 'planned'/);
  });
  it('rejects a lift stored as completed with no concrete phase recorded', () => {
    const bad = lift({status: 'completed', stonePhase: stonePhase({actualStoneQuantityM3: 6, workDate: '2026-09-01'})});
    expect(validateStatusConsistency(bad)[0]).toMatch(/implies 'stone_placed'/);
  });
  it('rejects a lift stored as completed with a concrete phase carrying neither an actual quantity nor a work date', () => {
    const bad = lift({status: 'completed', stonePhase: stonePhase({actualStoneQuantityM3: 6, workDate: '2026-09-01'}), concretePhase: concretePhase('lift-1')});
    expect(validateStatusConsistency(bad)[0]).toMatch(/implies 'stone_placed'/);
  });
});

describe('deterministic sequence and stable ids', () => {
  it('orders lifts by sequence regardless of array order', () => {
    const lifts = [lift({id: 'l3', sequence: 3}), lift({id: 'l1', sequence: 1}), lift({id: 'l2', sequence: 2})];
    expect(orderLiftsBySequence(lifts).map(l => l.id)).toEqual(['l1', 'l2', 'l3']);
  });
  it('keeps stable, distinct ids across lifts', () => {
    const lifts = [lift({id: 'l1', sequence: 1}), lift({id: 'l2', sequence: 2})];
    expect(new Set(lifts.map(l => l.id)).size).toBe(2);
  });
  it('refuses a duplicate sequence number within the same parent', () => {
    const lifts = [lift({id: 'l1', sequence: 1}), lift({id: 'l2', sequence: 1})];
    expect(validateLiftSequence(lifts)[0]).toMatch(/used by more than one lift/);
  });
  it('accepts unique sequence numbers', () => {
    const lifts = [lift({id: 'l1', sequence: 1}), lift({id: 'l2', sequence: 2})];
    expect(validateLiftSequence(lifts)).toEqual([]);
  });
});

describe('concrete phase linked to the correct lift id', () => {
  it('accepts a concrete phase linked to its own lift', () => {
    expect(validateConcretePhaseLink(concretePhase('lift-1'), lift({id: 'lift-1'}))).toEqual([]);
  });
  it('refuses a concrete phase whose liftId points to a different lift (Lift 2 concrete must never attach to Lift 1 Stone)', () => {
    const lift1Stone = lift({id: 'lift-1', sequence: 1});
    const lift2Concrete = concretePhase('lift-2');
    expect(validateConcretePhaseLink(lift2Concrete, lift1Stone)[0]).toMatch(/linked to lift lift-2, not lift lift-1/);
  });
});

describe('multiple and incomplete lifts', () => {
  it('allows a later lift to be planned while an earlier concrete fill is pending', () => {
    const lift1 = lift({id: 'l1', sequence: 1, stonePhase: stonePhase({actualStoneQuantityM3: 5, workDate: '2026-09-01'})});
    const lift2 = lift({id: 'l2', sequence: 2});
    expect(deriveLiftStatus(lift1)).toBe('stone_placed');
    expect(deriveLiftStatus(lift2)).toBe('planned');
  });
});

describe('lift allocation against the parent envelope', () => {
  it('accepts a new lift that fits within the remaining envelope', () => {
    expect(validateLiftAllocation(30, [10, 10], 10)).toEqual([]);
  });
  it('rejects a non-positive proposed lift volume', () => {
    expect(validateLiftAllocation(30, [], 0)).toEqual(['Lift structural volume must be greater than zero.']);
  });
  it('refuses over-allocation instead of silently clamping it', () => {
    expect(validateLiftAllocation(20, [10, 5], 10)[0]).toMatch(/more than the available structural envelope/);
  });
});

describe('parent reconciliation: foundation', () => {
  it('reports remaining unallocated structural volume and material totals', () => {
    const lift1 = lift({
      id: 'l1', sequence: 1, netLiftVolumeM3: 10,
      stonePhase: stonePhase({calculatedStoneVolumeM3: 6, actualStoneQuantityM3: 6.2}),
      concretePhase: concretePhase('l1', {estimatedMatrixVolumeM3: 4, actualReadyMixQuantityM3: 4.5}),
    });
    const lift2 = lift({
      id: 'l2', sequence: 2, netLiftVolumeM3: 8,
      stonePhase: stonePhase({calculatedStoneVolumeM3: 5, actualStoneQuantityM3: 5}),
      concretePhase: null,
    });
    const reconciliation = reconcileLifts(30, [lift1, lift2]);
    expect(reconciliation.totalAllocatedLiftVolumeM3).toBe(18);
    expect(reconciliation.remainingUnallocatedVolumeM3).toBe(12);
    expect(reconciliation.overAllocated).toBe(false);
    expect(reconciliation.totalCalculatedStoneM3).toBe(11);
    expect(reconciliation.totalActualStoneM3).toBe(11.2);
    expect(reconciliation.totalEstimatedConcreteM3).toBe(4);
    expect(reconciliation.totalActualReadyMixM3).toBe(4.5);
    expect(reconciliation.totalVarianceM3).toBe(0.5);
  });
  it('detects over-allocation across a foundation parent', () => {
    const lift1 = lift({id: 'l1', sequence: 1, netLiftVolumeM3: 20});
    const lift2 = lift({id: 'l2', sequence: 2, netLiftVolumeM3: 15});
    const reconciliation = reconcileLifts(30, [lift1, lift2]);
    expect(reconciliation.overAllocated).toBe(true);
    expect(reconciliation.overAllocationM3).toBe(5);
  });
});

describe('parent reconciliation: wall', () => {
  it('reconciles lifts belonging to a wall parent the same way as a foundation parent', () => {
    const wallLift = lift({id: 'w1', sequence: 1, parentType: 'wall', parentId: 'wall-1', netLiftVolumeM3: 12, stonePhase: stonePhase({calculatedStoneVolumeM3: 7})});
    const reconciliation = reconcileLifts(20, [wallLift]);
    expect(reconciliation.totalAllocatedLiftVolumeM3).toBe(12);
    expect(reconciliation.remainingUnallocatedVolumeM3).toBe(8);
    expect(reconciliation.totalCalculatedStoneM3).toBe(7);
  });
});

describe('correction-ready before/after values', () => {
  it('produces no diff when nothing changed', () => {
    const a = lift();
    expect(diffCyclopeanLift(a, a)).toEqual([]);
  });
  it('reports field-level before/after changes without mutating the original lift', () => {
    const before = lift({reference: 'Lift 1', notes: 'original'});
    const after = {...before, reference: 'Lift 1 (corrected)', notes: 'updated'};
    const diff = diffCyclopeanLift(before, after);
    expect(diff).toEqual(expect.arrayContaining([
      {field: 'Reference', originalValue: 'Lift 1', newValue: 'Lift 1 (corrected)'},
      {field: 'Notes', originalValue: 'original', newValue: 'updated'},
    ]));
    expect(before.reference).toBe('Lift 1');
    expect(before.notes).toBe('original');
  });
  it('reports a Stone quantity correction', () => {
    const before = lift({stonePhase: stonePhase({actualStoneQuantityM3: 5})});
    const after = {...before, stonePhase: stonePhase({actualStoneQuantityM3: 6})};
    expect(diffCyclopeanLift(before, after)).toEqual(expect.arrayContaining([
      {field: 'Stone actual quantity (m³)', originalValue: '5', newValue: '6'},
    ]));
  });
});
