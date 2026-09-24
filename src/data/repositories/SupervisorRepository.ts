import type {Supervisor,SupervisorDraft} from '../../domain/supervisors';

/**
 * DEC-479. Saved supervisors for the Daily Report Supervisor Sign-off. Profiles are archived, never
 * deleted, and a signature change affects only reports made afterwards: every report keeps its own
 * copy of the strokes it was issued with.
 */
export interface SupervisorRepository {
  /** Every supervisor, active and archived, in display order. */
  listSupervisors(): Promise<Supervisor[]>;
  createSupervisor(draft: SupervisorDraft): Promise<Supervisor>;
  updateSupervisor(id: string, draft: SupervisorDraft): Promise<Supervisor>;
  setSupervisorActive(id: string, isActive: boolean): Promise<void>;
  /**
   * Replaces this supervisor's saved signature with validated stroke data, or removes it when `strokes`
   * is empty. Only this supervisor's row is written; the strokes never enter the sync queue or a log.
   */
  saveSupervisorSignature(id: string, strokes: string[]): Promise<Supervisor>;
}
