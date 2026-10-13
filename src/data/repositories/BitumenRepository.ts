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
  addGrade(name:string):Promise<BitumenGrade>;
  setGradeActive(id:string,isActive:boolean):Promise<void>;
}
