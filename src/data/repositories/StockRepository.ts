import type {StockRule,StockRuleDraft,StockRulesSetup,StockSyncResult} from '../../domain/stockRules';
import type {StockBatch,StockBatchDraft,StockBatchEditDraft,StockLinkableLoad,StockOverview,StockSetup,StockUseDraft,StockUseRecord} from '../../domain/stock';

/** Stock (Phase 1): any Catalog item as stock, its delivery batches, and hand-recorded use. UI calls this; SQLite persists it. */
export interface StockRepository{
  getSetup():Promise<StockSetup>;
  getOverview():Promise<StockOverview>;
  /** Records a delivery. The first delivery of an item also adds it to Stock, in the item's default unit or the unit chosen on the form. */
  recordBatch(draft:StockBatchDraft):Promise<StockBatch>;
  /** The active Supplier Loads of an item that are not in Stock yet, oldest first, so a delivery recorded there can be linked instead of typed again. */
  listLinkableLoads(itemId:string):Promise<StockLinkableLoad[]>;
  /** Makes one Stock batch from each chosen Supplier Load, copying its supplier, day, quantity, ticket and saved price and VAT. A load links once, and the loads must be of one item and one unit. */
  recordBatchesFromLoads(loadIds:string[]):Promise<StockBatch[]>;
  /** Changes a batch. A new quantity or date needs a reason, and the old values are kept in the batch's correction history. */
  editBatch(id:string,draft:StockBatchEditDraft):Promise<StockBatch>;
  /** Cancels a batch with a reason; it stays visible as Cancelled and is never counted. A batch with recorded use cannot be cancelled. */
  cancelBatch(id:string,reason:string):Promise<StockBatch>;
  /** Records a use by hand, taken from the oldest open batches first. Fails when there is not enough in stock for that day. */
  recordUse(draft:StockUseDraft):Promise<StockUseRecord>;
  /** Closes an open batch by hand, even with some left, on a chosen day and with a reason. The leftover is kept with the closure. */
  closeBatch(batchId:string,closedOn:string,reason:string):Promise<StockOverview>;
  /** Reopens a batch that was closed by hand, with a reason. Uses counted before stay where they are. */
  reopenBatch(batchId:string,reason:string):Promise<StockOverview>;
  /** The company printed on a report when no Header company was picked, read from Company Settings like the receipts. */
  getCompanyIdentity():Promise<{name:string;logoUri:string|null;contactLine:string|null}>;
  /** The items a rule can watch, the units, the Stock materials a rule can list, and the rules saved so far with every version. */
  getRulesSetup():Promise<StockRulesSetup>;
  /** Creates a rule, or (with a rule id) adds a new version of it from a date. Loads already counted keep the amounts they were counted with. */
  saveRule(draft:StockRuleDraft):Promise<StockRule>;
  setRuleEnabled(ruleId:string,enabled:boolean):Promise<void>;
  /** Counts new loads, reverses cancelled ones and applies corrections and typed amounts. Safe to run any time and as often as wanted. */
  syncUse():Promise<StockSyncResult>;
  /** Records the real amount one load used of one material, with a reason; the rule itself is not changed. */
  adjustLoadUse(loadId:string,stockItemId:string,quantity:string,reason:string):Promise<void>;
  /** Cancels a recorded use with a reason by adding reversal rows; the original rows stay as history. */
  cancelUse(groupId:string,reason:string):Promise<void>;
}
