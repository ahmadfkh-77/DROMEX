import type {DeliverySource,ProjectTotalsData,UsageMovement} from '../../domain/projectTotals';

/** Inclusive calendar-date bounds; an empty string means unbounded on that side. */
export type TotalsDateRange = { fromDate: string; toDate: string };

export type ContributingRecordQuery = TotalsDateRange & (
  | { kind: 'delivery'; itemKey: string; unitKey: string; supplierKey?: string; source?: DeliverySource }
  | { kind: 'usage'; movement: UsageMovement; itemKey: string; unitKey: string }
);
export type ContributingRecord = { id: string; reference: string; date: string; party: string | null; quantity: number; unitSymbol: string; source: DeliverySource | 'report_material' };

/**
 * DEC-481. Project Totals aggregates. Every figure is computed by a grouped SQL query over the canonical
 * record tables -- cancelled and archived records excluded -- so no screen loads every record to add
 * them up. Delivered, used, fuel and construction figures come back separately and are never combined
 * here; domain/projectTotals.ts decides how they may be presented together.
 */
export interface ProjectTotalsRepository {
  getProjectTotals(projectId: string, range: TotalsDateRange): Promise<ProjectTotalsData>;
  /** The newest records behind one delivered or used total, capped for display. */
  listContributingRecords(projectId: string, query: ContributingRecordQuery, limit?: number): Promise<ContributingRecord[]>;
}
