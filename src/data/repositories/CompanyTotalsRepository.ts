import type {DocumentLink,InclusionState,RecordSnapshot} from '../../domain/businessDocuments';
import type {CompanyLoadTotalRow,CompanyTotalsData,CompanyTotalsFilters} from '../../domain/companyTotals';

/** One original delivered record behind a total, with its status read from the shared links. */
export type CompanyTotalsRecord = {
  key: string; snapshot: RecordSnapshot; seriesId: string | null; status: 'Active' | 'Cancelled'; cancellationReason: string | null;
  correctionCount: number; links: DocumentLink[]; inclusion: InclusionState;
  /** Read-only list detail (destination, who drove, delivery method); not part of the snapshot. Missing values are null, never blank. */
  details?: {destination: string | null; driverName: string | null; truckPlate: string | null; deliveredBy: 'company' | 'supplier' | null};
};
/** One Daily Report's recorded use of the material behind a Used total. */
export type UsageRecord = { reportId: string; projectId: string; projectName: string; workDate: string; quantity: number; unitSymbol: string };

/** DEC-500 (1). Live company-wide totals; Project Totals use the same queries narrowed to one project. */
export interface CompanyTotalsRepository {
  getCompanyTotals(filters: CompanyTotalsFilters): Promise<CompanyTotalsData>;
  listRecords(filters: CompanyTotalsFilters, limit?: number): Promise<CompanyTotalsRecord[]>;
  listUsageRecords(filters: CompanyTotalsFilters, movement?: 'used' | 'transported', limit?: number): Promise<UsageRecord[]>;
  getCompanyLoadTotals(filters: CompanyTotalsFilters): Promise<CompanyLoadTotalRow[]>;
  listCompanyLoads(filters: CompanyTotalsFilters, status?: 'active' | 'cancelled' | 'all', limit?: number): Promise<CompanyTotalsRecord[]>;
}
