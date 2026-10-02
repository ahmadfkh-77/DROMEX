import type {LoadNumberPreview,LoadNumberSeries,LoadNumberSeriesDraft} from '../../domain/loadNumberSeries';

/** DEC-487 (6). Owner-managed Company Load Number Series. Changes affect future loads only. */
export interface LoadNumberSeriesRepository {
  /** Every series, default first, with assigned items, issued count and the next number in `year`. */
  listSeries(year?: number): Promise<LoadNumberSeries[]>;
  createSeries(draft: LoadNumberSeriesDraft): Promise<LoadNumberSeries>;
  updateSeries(id: string, draft: LoadNumberSeriesDraft): Promise<LoadNumberSeries>;
  setSeriesActive(id: string, isActive: boolean): Promise<void>;
  /** null (or the default series) returns the item to the default series. */
  assignItem(itemId: string, seriesId: string | null): Promise<void>;
  /** The number the next load of this item would receive on that record date; nothing is consumed. */
  previewNextLoadNumber(itemId: string, recordDate: string): Promise<LoadNumberPreview>;
}
