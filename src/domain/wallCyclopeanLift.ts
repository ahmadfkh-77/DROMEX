import type {WallCorrectionChange, WallCorrectionEntry} from './walls';

/**
 * DEC-466. The corrected cyclopean construction model. A foundation or wall is built as an ordered
 * series of lifts, not one Stone core sitting inside a single gross volume. Each lift is: place a
 * Stone phase, then pour a concrete matrix fill around/through that same Stone phase. The concrete
 * phase always belongs to its lift through the lift's stable id, never through array position, so a
 * later lift's concrete can never be mistaken for an earlier lift's pour. The legacy single-core
 * model in wallFoundation.ts is untouched here and is not read or written by this module; a later
 * migration phase is responsible for representing old single-core records as an imported legacy
 * composite stage, not as a precisely-dimensioned lift.
 */
export type CyclopeanLiftParentType = 'foundation' | 'wall';
export type ConcreteCalculationMethod = 'estimated_matrix' | 'independent';
/**
 * 'stone_placed' is the honest "Concrete fill pending" state: Stone is recorded, no concrete phase
 * exists yet or its own quantity/work date has not been recorded. 'completed' covers a lift whose
 * concrete phase already carries an actual quantity or work date — the model does not invent a
 * separate reviewed/closed state beyond that, since nothing in this phase distinguishes one.
 */
export type LiftStatus = 'planned' | 'stone_placed' | 'completed';

export type VolumeDimensions = {lengthM: number; heightM: number; bottomThicknessM: number; topThicknessM: number; deductionM3: number};
export type VolumeSnapshot = VolumeDimensions & {grossVolumeM3: number; netVolumeM3: number};

/** Simple mode: a schematic, volume-unaffected position normalized to the lift's drawn boundary. */
export type LiftStonePosition = {xNorm: number; yNorm: number};
/** Detailed mode: real sub-geometry/offsets inside the lift, kept separate from the calculated volume it does not itself determine. */
export type LiftStoneOffsets = {longitudinalOffsetM: number; verticalOffsetM: number; transverseOffsetM: number};

export type StonePhase = {
  calculationSnapshot: VolumeSnapshot | null;
  calculatedStoneVolumeM3: number;
  actualStoneQuantityM3: number | null;
  manualOverride: boolean;
  workDate: string | null;
  position: LiftStonePosition | null;
  offsets: LiftStoneOffsets | null;
  notes: string;
};

export type ConcreteMatrixPhase = {
  liftId: string;
  calculationMethod: ConcreteCalculationMethod;
  estimatedMatrixVolumeM3: number;
  independentCalculation: VolumeSnapshot | null;
  actualReadyMixQuantityM3: number | null;
  manualOverride: boolean;
  purpose: string;
  workDate: string | null;
  notes: string;
};

export type CyclopeanLift = {
  id: string;
  parentType: CyclopeanLiftParentType;
  parentId: string;
  sequence: number;
  reference: string;
  startElevationM: number;
  geometry: VolumeDimensions;
  netLiftVolumeM3: number;
  stonePhase: StonePhase;
  /** Absent (null) while the concrete matrix fill for this lift's Stone phase has not begun. */
  concretePhase: ConcreteMatrixPhase | null;
  /** Always the result of deriveLiftStatus(this) -- persisted so it can be queried/filtered directly, but a repository must recompute and rewrite it on every phase save rather than trust a stale value. */
  status: LiftStatus;
  notes: string;
  correctionHistory: WallCorrectionEntry[];
  createdAt: string;
  updatedAt: string | null;
};

export type ConcreteVarianceDirection = 'over' | 'under' | 'none';
export type ConcreteVariance = {varianceM3: number; direction: ConcreteVarianceDirection};

export type LiftReconciliation = {
  totalAllocatedLiftVolumeM3: number;
  remainingUnallocatedVolumeM3: number;
  overAllocated: boolean;
  overAllocationM3: number;
  totalCalculatedStoneM3: number;
  totalActualStoneM3: number;
  totalEstimatedConcreteM3: number;
  totalActualReadyMixM3: number;
  totalVarianceM3: number;
};

const round = (value: number) => Number(value.toFixed(9));
const positive = (value: number) => Number.isFinite(value) && value > 0;
const EPSILON = 1e-6;

/** Same trapezoid formula used across the wall/foundation/Stone-core geometry, applied to one lift's own dimensions. */
export function calculateVolumeSnapshot(dimensions: VolumeDimensions): VolumeSnapshot {
  const grossVolumeM3 = round(dimensions.lengthM * dimensions.heightM * ((dimensions.bottomThicknessM + dimensions.topThicknessM) / 2));
  const netVolumeM3 = round(grossVolumeM3 - dimensions.deductionM3);
  return {...dimensions, grossVolumeM3, netVolumeM3};
}

/** Rejects impossible geometry outright rather than clamping it into something plausible-looking. */
export function validateVolumeDimensions(dimensions: VolumeDimensions): string[] {
  const issues: string[] = [];
  if (!positive(dimensions.lengthM)) issues.push('Length must be greater than zero.');
  if (!positive(dimensions.heightM)) issues.push('Height must be greater than zero.');
  if (!positive(dimensions.bottomThicknessM)) issues.push('Bottom thickness must be greater than zero.');
  if (!positive(dimensions.topThicknessM)) issues.push('Top thickness must be greater than zero.');
  if (!Number.isFinite(dimensions.deductionM3) || dimensions.deductionM3 < 0) issues.push('Deduction cannot be negative.');
  if (issues.length) return issues;
  const grossVolumeM3 = dimensions.lengthM * dimensions.heightM * ((dimensions.bottomThicknessM + dimensions.topThicknessM) / 2);
  if (dimensions.deductionM3 > grossVolumeM3 + EPSILON) issues.push('Deduction cannot exceed the gross volume.');
  return issues;
}

/** `estimated concrete matrix volume = net lift structural volume - calculated Stone volume`, unclamped. */
export function estimatedConcreteMatrixVolume(netLiftVolumeM3: number, calculatedStoneVolumeM3: number): number {
  return round(netLiftVolumeM3 - calculatedStoneVolumeM3);
}

/** Refuses a Stone calculation that would exceed the lift's own net structural volume, rather than silently clamping it. */
export function validateStoneAgainstLiftEnvelope(netLiftVolumeM3: number, calculatedStoneVolumeM3: number): string[] {
  if (!Number.isFinite(calculatedStoneVolumeM3)) return ['Stone calculated volume must be a finite number.'];
  if (round(calculatedStoneVolumeM3) > round(netLiftVolumeM3) + EPSILON) {
    return [`Stone calculated volume of ${round(calculatedStoneVolumeM3)} m³ cannot exceed this lift's net structural volume of ${round(netLiftVolumeM3)} m³.`];
  }
  return [];
}

/** Flags an impossible estimated-concrete result (only reachable if Stone already exceeds the lift envelope) instead of hiding it. */
export function validateEstimatedConcreteMatrixVolume(estimatedMatrixVolumeM3: number): string[] {
  if (!Number.isFinite(estimatedMatrixVolumeM3)) return ['Estimated concrete matrix volume must be a finite number.'];
  if (estimatedMatrixVolumeM3 < -EPSILON) return [`Estimated concrete matrix volume cannot be negative (${round(estimatedMatrixVolumeM3)} m³). Correct the Stone calculation or the lift geometry first.`];
  return [];
}

/** Never a rejection: an actual quantity is allowed to differ from the estimate, and the difference is always shown. */
export function concreteMatrixVariance(estimatedOrCalculatedM3: number, actualReadyMixM3: number): ConcreteVariance {
  const varianceM3 = round(actualReadyMixM3 - estimatedOrCalculatedM3);
  const direction: ConcreteVarianceDirection = varianceM3 > EPSILON ? 'over' : varianceM3 < -EPSILON ? 'under' : 'none';
  return {varianceM3, direction};
}

/** Honest lift status: Stone-before-concrete, and a Stone-only lift is never shown as complete. */
export function deriveLiftStatus(lift: Pick<CyclopeanLift, 'stonePhase' | 'concretePhase'>): LiftStatus {
  const stoneRecorded = lift.stonePhase.actualStoneQuantityM3 != null || lift.stonePhase.workDate != null;
  if (!stoneRecorded) return 'planned';
  const concreteRecorded = lift.concretePhase != null && (lift.concretePhase.actualReadyMixQuantityM3 != null || lift.concretePhase.workDate != null);
  return concreteRecorded ? 'completed' : 'stone_placed';
}

/**
 * A stored `status` must never be trusted on its own -- it must always equal what the Stone/concrete
 * phase data itself implies. A repository must call this on every hydrated lift and fail closed
 * (never silently return the mismatched aggregate) if it ever disagrees; that should only be
 * reachable through data corruption, since every write always derives status through
 * deriveLiftStatus rather than accepting one from a caller.
 */
export function validateStatusConsistency(lift: Pick<CyclopeanLift, 'status' | 'stonePhase' | 'concretePhase'>): string[] {
  const expected = deriveLiftStatus(lift);
  if (lift.status !== expected) {
    return [`Cyclopean Lift data is inconsistent: stored status '${lift.status}' disagrees with the Stone/concrete phase data, which implies '${expected}'.`];
  }
  return [];
}

/** Sequence numbers must be unique within one parent; duplicates are refused rather than silently reordered. */
export function validateLiftSequence(lifts: Pick<CyclopeanLift, 'id' | 'sequence'>[]): string[] {
  const seen = new Map<number, string>();
  const issues: string[] = [];
  for (const lift of lifts) {
    const owner = seen.get(lift.sequence);
    if (owner !== undefined) issues.push(`Sequence ${lift.sequence} is used by more than one lift (${owner} and ${lift.id}).`);
    else seen.set(lift.sequence, lift.id);
  }
  return issues;
}

/** Deterministic order by sequence number, independent of the array order the lifts were stored or loaded in. */
export function orderLiftsBySequence<T extends Pick<CyclopeanLift, 'sequence'>>(lifts: T[]): T[] {
  return [...lifts].sort((a, b) => a.sequence - b.sequence);
}

/** A concrete matrix phase must attach to the exact lift id it was poured for, never inferred from position. */
export function validateConcretePhaseLink(concretePhase: Pick<ConcreteMatrixPhase, 'liftId'>, lift: Pick<CyclopeanLift, 'id'>): string[] {
  if (concretePhase.liftId === lift.id) return [];
  return [`This concrete matrix phase is linked to lift ${concretePhase.liftId}, not lift ${lift.id}. Attach it to the correct Stone lift.`];
}

/** Refuses a new lift whose structural volume would exceed the parent foundation/wall's remaining envelope. */
export function validateLiftAllocation(parentNetVolumeM3: number, existingLiftVolumesM3: number[], proposedLiftVolumeM3: number): string[] {
  if (!positive(proposedLiftVolumeM3)) return ['Lift structural volume must be greater than zero.'];
  const total = round(existingLiftVolumesM3.reduce((sum, value) => sum + value, 0) + proposedLiftVolumeM3);
  if (total > round(parentNetVolumeM3) + EPSILON) {
    return [`Adding this lift (${round(proposedLiftVolumeM3)} m³) would bring the total allocated lift volume to ${total} m³, more than the available structural envelope of ${round(parentNetVolumeM3)} m³. Reduce the lift geometry or correct the parent geometry first.`];
  }
  return [];
}

/** Rolls a foundation's or wall's full set of lifts up into the capacity/quantity totals the summary screen, PDF, and workbook all share. */
export function reconcileLifts(parentNetVolumeM3: number, lifts: CyclopeanLift[]): LiftReconciliation {
  const totalAllocatedLiftVolumeM3 = round(lifts.reduce((sum, lift) => sum + lift.netLiftVolumeM3, 0));
  const remainingUnallocatedVolumeM3 = round(parentNetVolumeM3 - totalAllocatedLiftVolumeM3);
  const totalCalculatedStoneM3 = round(lifts.reduce((sum, lift) => sum + lift.stonePhase.calculatedStoneVolumeM3, 0));
  const totalActualStoneM3 = round(lifts.reduce((sum, lift) => sum + (lift.stonePhase.actualStoneQuantityM3 ?? 0), 0));
  const totalEstimatedConcreteM3 = round(lifts.reduce((sum, lift) => sum + (lift.concretePhase?.estimatedMatrixVolumeM3 ?? 0), 0));
  const totalActualReadyMixM3 = round(lifts.reduce((sum, lift) => sum + (lift.concretePhase?.actualReadyMixQuantityM3 ?? 0), 0));
  const totalVarianceM3 = round(totalActualReadyMixM3 - totalEstimatedConcreteM3);
  return {
    totalAllocatedLiftVolumeM3,
    remainingUnallocatedVolumeM3,
    overAllocated: remainingUnallocatedVolumeM3 < -EPSILON,
    overAllocationM3: remainingUnallocatedVolumeM3 < -EPSILON ? round(-remainingUnallocatedVolumeM3) : 0,
    totalCalculatedStoneM3,
    totalActualStoneM3,
    totalEstimatedConcreteM3,
    totalActualReadyMixM3,
    totalVarianceM3,
  };
}

const text = (value: unknown): string | null => (value === null || value === undefined || value === '' ? null : String(value));
function correctionFields(lift: CyclopeanLift): [string, string | null][] {
  return [
    ['Reference', text(lift.reference)], ['Start elevation (m)', text(lift.startElevationM)],
    ['Length (m)', text(lift.geometry.lengthM)], ['Height (m)', text(lift.geometry.heightM)],
    ['Bottom thickness (m)', text(lift.geometry.bottomThicknessM)], ['Top thickness (m)', text(lift.geometry.topThicknessM)],
    ['Deductions (m³)', text(lift.geometry.deductionM3)], ['Net lift volume (m³)', text(lift.netLiftVolumeM3)],
    ['Stone calculated volume (m³)', text(lift.stonePhase.calculatedStoneVolumeM3)],
    ['Stone actual quantity (m³)', text(lift.stonePhase.actualStoneQuantityM3)],
    ['Stone manual override', text(lift.stonePhase.manualOverride)], ['Stone work date', text(lift.stonePhase.workDate)],
    ['Concrete calculation method', text(lift.concretePhase?.calculationMethod ?? null)],
    ['Estimated concrete matrix volume (m³)', text(lift.concretePhase?.estimatedMatrixVolumeM3 ?? null)],
    ['Ready Mix actual quantity (m³)', text(lift.concretePhase?.actualReadyMixQuantityM3 ?? null)],
    ['Concrete manual override', text(lift.concretePhase?.manualOverride ?? null)],
    ['Concrete purpose', text(lift.concretePhase?.purpose ?? null)], ['Concrete work date', text(lift.concretePhase?.workDate ?? null)],
    ['Notes', text(lift.notes)],
  ];
}
/** Field-level before/after diff for a reasoned lift correction, following the same audit shape used by loads, supplier loads, and wall consumption. */
export function diffCyclopeanLift(before: CyclopeanLift, after: CyclopeanLift): WallCorrectionChange[] {
  const next = new Map(correctionFields(after));
  return correctionFields(before).flatMap(([field, originalValue]) => {
    const newValue = next.get(field) ?? null;
    return originalValue === newValue ? [] : [{field, originalValue, newValue}];
  });
}

// Phase 2 (DEC-466): repository-facing drafts and builders. The repository never computes a
// calculated volume itself -- it always resolves a draft through these functions first, the same
// separation the foundation/wall repositories already keep from wallFoundation.ts/walls.ts.

export type CyclopeanLiftDraft = {parentType: CyclopeanLiftParentType; parentId: string; sequence: number; reference: string; startElevationM: number; geometry: VolumeDimensions; notes: string};
export type StonePhaseDraft = {calculationDimensions: VolumeDimensions | null; actualStoneQuantityM3: number | null; manualOverride: boolean; workDate: string | null; position: LiftStonePosition | null; offsets: LiftStoneOffsets | null; notes: string};
export type ConcreteMatrixPhaseDraft = {calculationMethod: ConcreteCalculationMethod; independentDimensions: VolumeDimensions | null; actualReadyMixQuantityM3: number | null; manualOverride: boolean; purpose: string; workDate: string | null; notes: string};

export function validateCyclopeanLiftDraft(draft: Pick<CyclopeanLiftDraft, 'reference' | 'geometry' | 'sequence'>): string[] {
  const issues: string[] = [];
  if (!draft.reference.trim()) issues.push('Lift reference/name is required.');
  if (!Number.isInteger(draft.sequence) || draft.sequence < 1) issues.push('Sequence must be a positive whole number.');
  issues.push(...validateVolumeDimensions(draft.geometry));
  return issues;
}

/** A Stone phase with no calculator entry has a calculated volume of zero -- only a directly entered actual quantity, never invented from nothing. */
export function buildStonePhase(draft: StonePhaseDraft): StonePhase {
  const calculationSnapshot = draft.calculationDimensions ? calculateVolumeSnapshot(draft.calculationDimensions) : null;
  return {
    calculationSnapshot, calculatedStoneVolumeM3: calculationSnapshot ? calculationSnapshot.netVolumeM3 : 0,
    actualStoneQuantityM3: draft.actualStoneQuantityM3, manualOverride: draft.manualOverride, workDate: draft.workDate,
    position: draft.position, offsets: draft.offsets, notes: draft.notes.trim(),
  };
}

export function validateStonePhaseDraft(draft: StonePhaseDraft, netLiftVolumeM3: number): string[] {
  if (draft.calculationDimensions) {
    const dimensionIssues = validateVolumeDimensions(draft.calculationDimensions);
    if (dimensionIssues.length) return dimensionIssues;
  }
  return validateStoneAgainstLiftEnvelope(netLiftVolumeM3, buildStonePhase(draft).calculatedStoneVolumeM3);
}

/** Always resolves the estimated matrix requirement, even when the independent method is used, so both figures stay visible side by side. */
export function buildConcreteMatrixPhase(liftId: string, draft: ConcreteMatrixPhaseDraft, netLiftVolumeM3: number, calculatedStoneVolumeM3: number): ConcreteMatrixPhase {
  const estimatedMatrixVolumeM3 = estimatedConcreteMatrixVolume(netLiftVolumeM3, calculatedStoneVolumeM3);
  const independentCalculation = draft.calculationMethod === 'independent' && draft.independentDimensions ? calculateVolumeSnapshot(draft.independentDimensions) : null;
  return {
    liftId, calculationMethod: draft.calculationMethod, estimatedMatrixVolumeM3, independentCalculation,
    actualReadyMixQuantityM3: draft.actualReadyMixQuantityM3, manualOverride: draft.manualOverride,
    purpose: draft.purpose.trim(), workDate: draft.workDate, notes: draft.notes.trim(),
  };
}

export function validateConcreteMatrixPhaseDraft(draft: ConcreteMatrixPhaseDraft, netLiftVolumeM3: number, calculatedStoneVolumeM3: number): string[] {
  if (draft.calculationMethod === 'independent') {
    if (!draft.independentDimensions) return ['Enter dimensions for the independent Ready Mix calculation, or switch to the estimated matrix requirement.'];
    const dimensionIssues = validateVolumeDimensions(draft.independentDimensions);
    if (dimensionIssues.length) return dimensionIssues;
  }
  return validateEstimatedConcreteMatrixVolume(estimatedConcreteMatrixVolume(netLiftVolumeM3, calculatedStoneVolumeM3));
}

/**
 * DEC-466. A read-only, honest stand-in for a foundation still using the pre-DEC-466 single Stone
 * core model: it is never converted into a fabricated ordered lift. `label` is fixed so the UI/PDF
 * always say exactly "Imported legacy composite stage" rather than presenting it as measured lift
 * history.
 */
export type LegacyCompositeStage = {
  foundationId: string; label: 'Imported legacy composite stage';
  netFoundationVolumeM3: number; activeStoneM3: number; estimatedConcreteM3: number; activeReadyMixM3: number; variance: ConcreteVariance | null;
};
