import type {StockBatch,StockBatchDraft,StockBatchEditDraft,StockOverview,StockSetup,StockUseDraft,StockUseRecord} from '../../domain/stock';

/** Stock (Phase 1): any Catalog item as stock, its delivery batches, and hand-recorded use. UI calls this; SQLite persists it. */
export interface StockRepository{
  getSetup():Promise<StockSetup>;
  getOverview():Promise<StockOverview>;
  /** Records a delivery. The first delivery of an item also adds it to Stock, in the item's default unit or the unit chosen on the form. */
  recordBatch(draft:StockBatchDraft):Promise<StockBatch>;
  /** Changes a batch. A new quantity or date needs a reason, and the old values are kept in the batch's correction history. */
  editBatch(id:string,draft:StockBatchEditDraft):Promise<StockBatch>;
  /** Cancels a batch with a reason; it stays visible as Cancelled and is never counted. A batch with recorded use cannot be cancelled. */
  cancelBatch(id:string,reason:string):Promise<StockBatch>;
  /** Records a use by hand, taken from the oldest open batches first. Fails when there is not enough in stock for that day. */
  recordUse(draft:StockUseDraft):Promise<StockUseRecord>;
  /** Cancels a recorded use with a reason by adding reversal rows; the original rows stay as history. */
  cancelUse(groupId:string,reason:string):Promise<void>;
}
