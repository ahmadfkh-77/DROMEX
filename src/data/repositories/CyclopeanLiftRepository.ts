import type {
  ConcreteMatrixPhaseDraft, CyclopeanLift, CyclopeanLiftDraft, LegacyCompositeStage, LiftReconciliation, StonePhaseDraft,
} from '../../domain/wallCyclopeanLift';

export interface CyclopeanLiftRepository {
  listLiftsForFoundation(foundationId: string): Promise<CyclopeanLift[]>;
  listLiftsForWall(wallId: string): Promise<CyclopeanLift[]>;
  getLift(id: string): Promise<CyclopeanLift | null>;
  /** Refused if the new lift's structural volume would exceed the parent's remaining envelope, or its sequence collides with an existing lift on the same parent. */
  createLift(draft: CyclopeanLiftDraft): Promise<CyclopeanLift>;
  /** Reasoned correction of the lift's own geometry/reference/notes; never moves it to a different parent. */
  correctLift(id: string, draft: {reference: string; startElevationM: number; geometry: CyclopeanLiftDraft['geometry']; notes: string; correctionReason: string}): Promise<CyclopeanLift>;
  /** Adds or replaces this lift's Stone phase. Refused if the calculated Stone volume would exceed the lift's own net volume. */
  saveStonePhase(liftId: string, draft: StonePhaseDraft): Promise<CyclopeanLift>;
  /** Adds or replaces this lift's concrete matrix phase; refused before a Stone phase exists. */
  saveConcreteMatrixPhase(liftId: string, draft: ConcreteMatrixPhaseDraft): Promise<CyclopeanLift>;
  /**
   * Reassigns sequence numbers only among the lifts of one parent that are still `planned`; every
   * other lift (`stone_placed` or `completed`) keeps its historical sequence untouched. Refused
   * unless `orderedLiftIds` is exactly the full set of that parent's current `planned` lifts, so a
   * lift already under construction can never be silently displaced.
   */
  reorderPlannedLifts(parentType: 'foundation' | 'wall', parentId: string, orderedLiftIds: string[]): Promise<CyclopeanLift[]>;
  reconcileFoundation(foundationId: string): Promise<LiftReconciliation>;
  reconcileWall(wallId: string): Promise<LiftReconciliation>;
  /** Read-only. Null when the foundation has no legacy single-core data recorded (or already uses only lifts). */
  getLegacyCompositeStage(foundationId: string): Promise<LegacyCompositeStage | null>;
}
