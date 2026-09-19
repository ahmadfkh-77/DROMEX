import type {SQLiteDatabase} from 'expo-sqlite';
import {
  aggregateActiveQuantity, buildFoundationComposition, estimatedConcreteVolume, type StoneCoreMode,
} from '../../domain/wallFoundation';
import {
  buildConcreteMatrixPhase, buildStonePhase, calculateVolumeSnapshot, concreteMatrixVariance, deriveLiftStatus,
  diffCyclopeanLift, orderLiftsBySequence, reconcileLifts, validateCyclopeanLiftDraft, validateConcreteMatrixPhaseDraft,
  validateLiftAllocation, validateStatusConsistency, validateStonePhaseDraft, validateVolumeDimensions,
  type ConcreteMatrixPhase, type ConcreteMatrixPhaseDraft, type CyclopeanLift, type CyclopeanLiftDraft,
  type LegacyCompositeStage, type LiftReconciliation, type LiftStoneOffsets, type LiftStonePosition,
  type StonePhase, type StonePhaseDraft, type VolumeDimensions, type VolumeSnapshot,
} from '../../domain/wallCyclopeanLift';
import type {WallCorrectionEntry} from '../../domain/walls';
import type {CyclopeanLiftRepository} from './CyclopeanLiftRepository';

export type LiftRow = {
  id: string; parent_type: 'foundation' | 'wall'; foundation_id: string | null; wall_id: string | null;
  sequence: number; reference: string; start_elevation_m: number;
  length_m: number; height_m: number; bottom_thickness_m: number; top_thickness_m: number; deduction_m3: number; net_lift_volume_m3: number;
  status: 'planned' | 'stone_placed' | 'completed';
  stone_calc_length_m: number | null; stone_calc_height_m: number | null; stone_calc_bottom_thickness_m: number | null; stone_calc_top_thickness_m: number | null;
  stone_calc_deduction_m3: number | null; stone_calc_gross_volume_m3: number | null; stone_calc_net_volume_m3: number | null;
  stone_calculated_volume_m3: number; stone_actual_quantity_m3: number | null; stone_manual_override: number; stone_work_date: string | null;
  stone_position_x: number | null; stone_position_y: number | null; stone_offsets_json: string | null; stone_notes: string | null;
  concrete_calculation_method: 'estimated_matrix' | 'independent' | null; concrete_estimated_matrix_volume_m3: number | null;
  concrete_calc_length_m: number | null; concrete_calc_height_m: number | null; concrete_calc_bottom_thickness_m: number | null; concrete_calc_top_thickness_m: number | null;
  concrete_calc_deduction_m3: number | null; concrete_calc_gross_volume_m3: number | null; concrete_calc_net_volume_m3: number | null;
  concrete_actual_ready_mix_m3: number | null; concrete_manual_override: number; concrete_purpose: string | null; concrete_work_date: string | null; concrete_notes: string | null;
  notes: string | null; correction_history_json: string | null; created_at: string; updated_at: string | null;
};
type FoundationRow = {id: string; project_id: string; net_volume_m3: number; foundation_mode: 'single' | 'composite'};
type WallRow = {id: string; project_id: string; net_volume_m3: number};

const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const parseCorrections = (value: string | null): WallCorrectionEntry[] => { try { const parsed = JSON.parse(value ?? '[]') as unknown; return Array.isArray(parsed) ? parsed as WallCorrectionEntry[] : []; } catch { return []; } };
const parseOffsets = (value: string | null): LiftStoneOffsets | null => { if (!value) return null; try { return JSON.parse(value) as LiftStoneOffsets; } catch { return null; } };
const snapshotFromColumns = (length: number | null, height: number | null, bottom: number | null, top: number | null, deduction: number | null, gross: number | null, net: number | null): VolumeSnapshot | null =>
  net == null ? null : {lengthM: length!, heightM: height!, bottomThicknessM: bottom!, topThicknessM: top!, deductionM3: deduction!, grossVolumeM3: gross!, netVolumeM3: net};

/**
 * Exported so this fail-closed guard can be exercised directly against a fabricated, deliberately
 * corrupt row -- the migration's own CHECK constraints already refuse such a row from ever being
 * written, but this is the second, independent line of defense the correction requires: hydration
 * itself must never silently return an aggregate whose stored status disagrees with its phase data,
 * regardless of how such a row came to exist (a hand-edited database, a future bug, a downgraded
 * app reading data written by a newer one, etc.).
 */
export function cyclopeanLiftFromRow(row: LiftRow): CyclopeanLift {
  const lift = liftFromRow(row);
  const issue = validateStatusConsistency(lift)[0];
  if (issue) throw new Error(issue);
  return lift;
}

function liftFromRow(row: LiftRow): CyclopeanLift {
  const stonePhase: StonePhase = {
    calculationSnapshot: snapshotFromColumns(row.stone_calc_length_m, row.stone_calc_height_m, row.stone_calc_bottom_thickness_m, row.stone_calc_top_thickness_m, row.stone_calc_deduction_m3, row.stone_calc_gross_volume_m3, row.stone_calc_net_volume_m3),
    calculatedStoneVolumeM3: row.stone_calculated_volume_m3, actualStoneQuantityM3: row.stone_actual_quantity_m3,
    manualOverride: row.stone_manual_override === 1, workDate: row.stone_work_date,
    position: row.stone_position_x != null && row.stone_position_y != null ? {xNorm: row.stone_position_x, yNorm: row.stone_position_y} as LiftStonePosition : null,
    offsets: parseOffsets(row.stone_offsets_json), notes: row.stone_notes ?? '',
  };
  const concretePhase: ConcreteMatrixPhase | null = row.concrete_calculation_method == null ? null : {
    liftId: row.id, calculationMethod: row.concrete_calculation_method, estimatedMatrixVolumeM3: row.concrete_estimated_matrix_volume_m3 ?? 0,
    independentCalculation: snapshotFromColumns(row.concrete_calc_length_m, row.concrete_calc_height_m, row.concrete_calc_bottom_thickness_m, row.concrete_calc_top_thickness_m, row.concrete_calc_deduction_m3, row.concrete_calc_gross_volume_m3, row.concrete_calc_net_volume_m3),
    actualReadyMixQuantityM3: row.concrete_actual_ready_mix_m3, manualOverride: row.concrete_manual_override === 1,
    purpose: row.concrete_purpose ?? '', workDate: row.concrete_work_date, notes: row.concrete_notes ?? '',
  };
  const lift: CyclopeanLift = {
    id: row.id, parentType: row.parent_type, parentId: (row.parent_type === 'foundation' ? row.foundation_id : row.wall_id)!,
    sequence: row.sequence, reference: row.reference, startElevationM: row.start_elevation_m,
    geometry: {lengthM: row.length_m, heightM: row.height_m, bottomThicknessM: row.bottom_thickness_m, topThicknessM: row.top_thickness_m, deductionM3: row.deduction_m3},
    netLiftVolumeM3: row.net_lift_volume_m3, stonePhase, concretePhase, status: row.status, notes: row.notes ?? '',
    correctionHistory: parseCorrections(row.correction_history_json), createdAt: row.created_at, updatedAt: row.updated_at,
  };
  return lift;
}

export class SqliteCyclopeanLiftRepository implements CyclopeanLiftRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async listLiftsForFoundation(foundationId: string): Promise<CyclopeanLift[]> {
    const rows = await this.db.getAllAsync<LiftRow>('SELECT * FROM cyclopean_lifts WHERE foundation_id=?', foundationId);
    return orderLiftsBySequence(rows.map(cyclopeanLiftFromRow));
  }
  async listLiftsForWall(wallId: string): Promise<CyclopeanLift[]> {
    const rows = await this.db.getAllAsync<LiftRow>('SELECT * FROM cyclopean_lifts WHERE wall_id=?', wallId);
    return orderLiftsBySequence(rows.map(cyclopeanLiftFromRow));
  }
  async getLift(liftId: string): Promise<CyclopeanLift | null> {
    const row = await this.db.getFirstAsync<LiftRow>('SELECT * FROM cyclopean_lifts WHERE id=?', liftId);
    return row ? cyclopeanLiftFromRow(row) : null;
  }
  private async requireLiftRow(liftId: string): Promise<LiftRow> {
    const row = await this.db.getFirstAsync<LiftRow>('SELECT * FROM cyclopean_lifts WHERE id=?', liftId);
    if (!row) throw new Error('Cyclopean Lift was not found.');
    return row;
  }
  private async parentNetVolume(parentType: 'foundation' | 'wall', parentId: string): Promise<number> {
    if (parentType === 'foundation') {
      const row = await this.db.getFirstAsync<FoundationRow>('SELECT id,project_id,net_volume_m3,foundation_mode FROM foundations WHERE id=?', parentId);
      if (!row) throw new Error('Foundation was not found.');
      return row.net_volume_m3;
    }
    const row = await this.db.getFirstAsync<WallRow>('SELECT id,project_id,net_volume_m3 FROM walls WHERE id=?', parentId);
    if (!row) throw new Error('Wall was not found.');
    return row.net_volume_m3;
  }

  async createLift(draft: CyclopeanLiftDraft): Promise<CyclopeanLift> {
    const issue = validateCyclopeanLiftDraft(draft)[0]; if (issue) throw new Error(issue);
    const parentNetVolumeM3 = await this.parentNetVolume(draft.parentType, draft.parentId);
    const snapshot = calculateVolumeSnapshot(draft.geometry);
    const existing = draft.parentType === 'foundation' ? await this.listLiftsForFoundation(draft.parentId) : await this.listLiftsForWall(draft.parentId);
    const allocationIssue = validateLiftAllocation(parentNetVolumeM3, existing.map(l => l.netLiftVolumeM3), snapshot.netVolumeM3)[0];
    if (allocationIssue) throw new Error(allocationIssue);
    const recordId = id('lift'), now = new Date().toISOString();
    try {
      await this.db.withTransactionAsync(async () => {
        await this.db.runAsync(
          `INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,wall_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,net_lift_volume_m3,status,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'planned',?,?)`,
          recordId, draft.parentType, draft.parentType === 'foundation' ? draft.parentId : null, draft.parentType === 'wall' ? draft.parentId : null,
          draft.sequence, draft.reference.trim(), draft.startElevationM, snapshot.lengthM, snapshot.heightM, snapshot.bottomThicknessM, snapshot.topThicknessM,
          snapshot.deductionM3, snapshot.netVolumeM3, now, now,
        );
        await this.enqueue('cyclopeanLift', recordId, {id: recordId, ...draft, ...snapshot, updatedAt: now}, now);
      });
    } catch (cause) {
      if (cause instanceof Error && /idx_cyclopean_lifts_(foundation|wall)_seq/.test(cause.message)) {
        throw new Error(`Sequence ${draft.sequence} is already used by another lift on this ${draft.parentType}.`);
      }
      throw cause;
    }
    return this.requireLift(recordId);
  }

  private async requireLift(liftId: string): Promise<CyclopeanLift> { return cyclopeanLiftFromRow(await this.requireLiftRow(liftId)); }

  async correctLift(liftId: string, draft: {reference: string; startElevationM: number; geometry: VolumeDimensions; notes: string; correctionReason: string}): Promise<CyclopeanLift> {
    const reason = draft.correctionReason.trim(); if (!reason) throw new Error('A correction reason is required.');
    const before = await this.requireLift(liftId);
    const dimensionIssue = validateVolumeDimensions(draft.geometry)[0]; if (dimensionIssue) throw new Error(dimensionIssue);
    const snapshot = calculateVolumeSnapshot(draft.geometry);
    const parentNetVolumeM3 = await this.parentNetVolume(before.parentType, before.parentId);
    const siblings = (before.parentType === 'foundation' ? await this.listLiftsForFoundation(before.parentId) : await this.listLiftsForWall(before.parentId)).filter(l => l.id !== liftId);
    const allocationIssue = validateLiftAllocation(parentNetVolumeM3, siblings.map(l => l.netLiftVolumeM3), snapshot.netVolumeM3)[0];
    if (allocationIssue) throw new Error(allocationIssue);
    const after: CyclopeanLift = {...before, reference: draft.reference.trim(), startElevationM: draft.startElevationM, geometry: draft.geometry, netLiftVolumeM3: snapshot.netVolumeM3, notes: draft.notes.trim()};
    const changes = diffCyclopeanLift(before, after);
    if (!changes.length) throw new Error('Nothing changed. Edit at least one value before saving a correction.');
    const now = new Date().toISOString(), history = [...before.correctionHistory, {correctedAt: now, correctedBy: 'Owner', reason, changes}];
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE cyclopean_lifts SET reference=?,start_elevation_m=?,length_m=?,height_m=?,bottom_thickness_m=?,top_thickness_m=?,deduction_m3=?,net_lift_volume_m3=?,notes=?,correction_history_json=?,updated_at=? WHERE id=?`,
        after.reference, after.startElevationM, snapshot.lengthM, snapshot.heightM, snapshot.bottomThicknessM, snapshot.topThicknessM, snapshot.deductionM3, snapshot.netVolumeM3, after.notes || null, JSON.stringify(history), now, liftId,
      );
      await this.enqueue('cyclopeanLift', liftId, {...after, correctionHistory: history, updatedAt: now}, now);
    });
    return this.requireLift(liftId);
  }

  async saveStonePhase(liftId: string, draft: StonePhaseDraft): Promise<CyclopeanLift> {
    const row = await this.requireLiftRow(liftId);
    const before = cyclopeanLiftFromRow(row);
    const issue = validateStonePhaseDraft(draft, before.netLiftVolumeM3)[0]; if (issue) throw new Error(issue);
    const phase = buildStonePhase(draft);
    const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE cyclopean_lifts SET
          stone_calc_length_m=?,stone_calc_height_m=?,stone_calc_bottom_thickness_m=?,stone_calc_top_thickness_m=?,stone_calc_deduction_m3=?,stone_calc_gross_volume_m3=?,stone_calc_net_volume_m3=?,
          stone_calculated_volume_m3=?,stone_actual_quantity_m3=?,stone_manual_override=?,stone_work_date=?,stone_position_x=?,stone_position_y=?,stone_offsets_json=?,stone_notes=?,
          status=?,updated_at=? WHERE id=?`,
        phase.calculationSnapshot?.lengthM ?? null, phase.calculationSnapshot?.heightM ?? null, phase.calculationSnapshot?.bottomThicknessM ?? null, phase.calculationSnapshot?.topThicknessM ?? null,
        phase.calculationSnapshot?.deductionM3 ?? null, phase.calculationSnapshot?.grossVolumeM3 ?? null, phase.calculationSnapshot?.netVolumeM3 ?? null,
        phase.calculatedStoneVolumeM3, phase.actualStoneQuantityM3, phase.manualOverride ? 1 : 0, phase.workDate,
        phase.position?.xNorm ?? null, phase.position?.yNorm ?? null, phase.offsets ? JSON.stringify(phase.offsets) : null, phase.notes || null,
        deriveLiftStatus({stonePhase: phase, concretePhase: before.concretePhase}), now, liftId,
      );
      await this.enqueue('cyclopeanLiftStonePhase', liftId, {liftId, ...phase, updatedAt: now}, now);
    });
    return this.requireLift(liftId);
  }

  async saveConcreteMatrixPhase(liftId: string, draft: ConcreteMatrixPhaseDraft): Promise<CyclopeanLift> {
    const row = await this.requireLiftRow(liftId);
    const before = cyclopeanLiftFromRow(row);
    if (before.stonePhase.actualStoneQuantityM3 == null && before.stonePhase.workDate == null) {
      throw new Error('Record this lift\'s Stone phase before its concrete matrix fill.');
    }
    const issue = validateConcreteMatrixPhaseDraft(draft, before.netLiftVolumeM3, before.stonePhase.calculatedStoneVolumeM3)[0]; if (issue) throw new Error(issue);
    const phase = buildConcreteMatrixPhase(liftId, draft, before.netLiftVolumeM3, before.stonePhase.calculatedStoneVolumeM3);
    const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE cyclopean_lifts SET
          concrete_calculation_method=?,concrete_estimated_matrix_volume_m3=?,
          concrete_calc_length_m=?,concrete_calc_height_m=?,concrete_calc_bottom_thickness_m=?,concrete_calc_top_thickness_m=?,concrete_calc_deduction_m3=?,concrete_calc_gross_volume_m3=?,concrete_calc_net_volume_m3=?,
          concrete_actual_ready_mix_m3=?,concrete_manual_override=?,concrete_purpose=?,concrete_work_date=?,concrete_notes=?,
          status=?,updated_at=? WHERE id=?`,
        phase.calculationMethod, phase.estimatedMatrixVolumeM3,
        phase.independentCalculation?.lengthM ?? null, phase.independentCalculation?.heightM ?? null, phase.independentCalculation?.bottomThicknessM ?? null, phase.independentCalculation?.topThicknessM ?? null,
        phase.independentCalculation?.deductionM3 ?? null, phase.independentCalculation?.grossVolumeM3 ?? null, phase.independentCalculation?.netVolumeM3 ?? null,
        phase.actualReadyMixQuantityM3, phase.manualOverride ? 1 : 0, phase.purpose || null, phase.workDate, phase.notes || null,
        deriveLiftStatus({stonePhase: before.stonePhase, concretePhase: phase}), now, liftId,
      );
      await this.enqueue('cyclopeanLiftConcretePhase', liftId, {...phase, updatedAt: now}, now);
    });
    return this.requireLift(liftId);
  }

  /**
   * Sequence numbers are reassigned only among the exact set of lifts still `planned`; a
   * `stone_placed` or `completed` lift keeps its historical sequence untouched, and the whole call
   * is refused unless every currently-planned lift for this parent is named, so none can be silently
   * displaced by an incomplete list.
   */
  async reorderPlannedLifts(parentType: 'foundation' | 'wall', parentId: string, orderedLiftIds: string[]): Promise<CyclopeanLift[]> {
    const all = parentType === 'foundation' ? await this.listLiftsForFoundation(parentId) : await this.listLiftsForWall(parentId);
    const planned = all.filter(l => l.status === 'planned');
    const plannedIds = new Set(planned.map(l => l.id));
    if (orderedLiftIds.some(liftId => !plannedIds.has(liftId))) throw new Error('Only lifts that are still planned can be reordered.');
    if (orderedLiftIds.length !== planned.length || new Set(orderedLiftIds).size !== planned.length) {
      throw new Error('Reordering must name exactly the parent\'s current planned lifts, once each.');
    }
    const availableSequences = planned.map(l => l.sequence).sort((a, b) => a - b);
    const placeholderBase = Math.max(0, ...all.map(l => l.sequence)) + 1000;
    const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      // A direct final-value update can collide with another planned lift still holding that exact
      // sequence mid-loop (the unique index is per-statement, not deferred), so every lift is first
      // moved to a placeholder sequence no real lift on this parent uses, then given its real new one.
      for (const [index, liftId] of orderedLiftIds.entries()) {
        await this.db.runAsync('UPDATE cyclopean_lifts SET sequence=?,updated_at=? WHERE id=?', placeholderBase + index + 1, now, liftId);
      }
      for (const [index, liftId] of orderedLiftIds.entries()) {
        await this.db.runAsync('UPDATE cyclopean_lifts SET sequence=?,updated_at=? WHERE id=?', availableSequences[index]!, now, liftId);
      }
      await this.enqueue('cyclopeanLiftReorder', parentId, {parentType, parentId, orderedLiftIds, updatedAt: now}, now);
    });
    return parentType === 'foundation' ? this.listLiftsForFoundation(parentId) : this.listLiftsForWall(parentId);
  }

  async reconcileFoundation(foundationId: string): Promise<LiftReconciliation> {
    const parentNetVolumeM3 = await this.parentNetVolume('foundation', foundationId);
    return reconcileLifts(parentNetVolumeM3, await this.listLiftsForFoundation(foundationId));
  }
  async reconcileWall(wallId: string): Promise<LiftReconciliation> {
    const parentNetVolumeM3 = await this.parentNetVolume('wall', wallId);
    return reconcileLifts(parentNetVolumeM3, await this.listLiftsForWall(wallId));
  }

  /** DEC-466. Read-only: a foundation still using the pre-DEC-466 single Stone core model is never converted into fabricated lifts. */
  async getLegacyCompositeStage(foundationId: string): Promise<LegacyCompositeStage | null> {
    const row = await this.db.getFirstAsync<FoundationRow & {stone_core_mode: string | null; stone_core_position_x: number | null; stone_core_position_y: number | null; stone_core_offsets_json: string | null}>(
      'SELECT id,project_id,net_volume_m3,foundation_mode,stone_core_mode,stone_core_position_x,stone_core_position_y,stone_core_offsets_json FROM foundations WHERE id=?', foundationId,
    );
    if (!row || row.foundation_mode !== 'composite') return null;
    type CompositionRow = {id: string; foundation_id: string; material_type: 'stone' | 'ready_mix'; quantity_m3: number; recorded_on: string; notes: string | null; cancelled_at: string | null; cancelled_reason: string | null; correction_history_json: string | null; created_at: string; updated_at: string | null};
    const records = (await this.db.getAllAsync<CompositionRow>('SELECT * FROM foundation_composition_records WHERE foundation_id=?', foundationId)).map(record => ({
      id: record.id, foundationId: record.foundation_id, materialType: record.material_type, quantityM3: record.quantity_m3, recordedOn: record.recorded_on,
      notes: record.notes ?? '', cancelledAt: record.cancelled_at, cancelledReason: record.cancelled_reason, correctionHistory: parseCorrections(record.correction_history_json),
      createdAt: record.created_at, updatedAt: record.updated_at,
    }));
    const composition = buildFoundationComposition({
      foundationId, mode: 'composite', stoneCoreMode: row.stone_core_mode as StoneCoreMode | null, position: null, offsets: null,
      netFoundationVolumeM3: row.net_volume_m3, records,
    });
    return {
      foundationId, label: 'Imported legacy composite stage', netFoundationVolumeM3: row.net_volume_m3,
      activeStoneM3: composition.activeStoneM3, estimatedConcreteM3: composition.estimatedConcreteM3, activeReadyMixM3: composition.activeReadyMixM3, variance: composition.variance,
    };
  }

  private async enqueue(entity: string, entityId: string, payload: unknown, now: string) {
    await this.db.runAsync(`INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)`, entity, entityId, 'upsert', JSON.stringify(payload), now);
  }
}

// Re-exported for callers that only need to derive a variance for display without a full phase save.
export {concreteMatrixVariance, aggregateActiveQuantity, estimatedConcreteVolume};
