import type {BitumenRule,BitumenRuleDraft,BitumenUseSetup,SyncResult} from '../../domain/bitumenUse';
import type {BitumenBatch,BitumenDeliveryDraft,BitumenEditDraft,BitumenGrade,BitumenOverview,BitumenSetup} from '../../domain/bitumen';

/** Bitumen batches (Phase B): deliveries in kg, the batch in use, correction and cancellation. UI calls this; SQLite persists it. */
export interface BitumenRepository{
  getSetup():Promise<BitumenSetup>;
  getOverview():Promise<BitumenOverview>;
  recordDelivery(draft:BitumenDeliveryDraft):Promise<BitumenBatch>;
  /** Changes a batch. A new quantity or date needs a reason, and the old values are kept in the batch's correction history. */
  editBatch(id:string,draft:BitumenEditDraft):Promise<BitumenBatch>;
  /** Cancels a batch with a reason; it stays visible as Cancelled and is never counted. */
  cancelBatch(id:string,reason:string):Promise<BitumenBatch>;
  /** Chooses the open batch to use first, or null to go back to the oldest open batch first. */
  setUsingBatch(batchId:string|null):Promise<BitumenOverview>;
  /** The company printed on the batch report when no Header company was picked, read from Company Settings like the receipts. */
  getCompanyIdentity():Promise<{name:string;logoUri:string|null;contactLine:string|null}>;
  /** The items a rule can be set for, the load-number series that group them, and the rules saved so far. */
  getUseSetup():Promise<BitumenUseSetup>;
  /** Saves the rule for one item (ticked or not): how much bitumen per how much mix, and the day counting starts. */
  saveRule(draft:BitumenRuleDraft):Promise<BitumenRule>;
  /** Ticks every item of a load-number series, keeping any rule already saved and giving new ones the default. */
  enableSeries(seriesId:string,countFrom:string):Promise<BitumenRule[]>;
  /** Counts new loads, reverses cancelled ones and applies corrections. Safe to run any time and as often as wanted. */
  syncUse():Promise<SyncResult>;
  /** Moves a load's whole use to another open batch. */
  moveLoad(loadId:string,toBatchId:string):Promise<BitumenOverview>;
  /** Records the real amount left in a batch, as an adjustment with a reason. */
  adjustBatch(batchId:string,realRemainingKg:string,reason:string):Promise<BitumenOverview>;
  addGrade(name:string):Promise<BitumenGrade>;
  setGradeActive(id:string,isActive:boolean):Promise<void>;
}
