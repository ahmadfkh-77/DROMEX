import type { QuarryCorrectionDraft, QuarryPurchase, QuarryPurchaseDraft, QuarrySetup, Supplier, SupplierDraft } from '../../domain/quarry';

export interface QuarryRepository {
  getSetup(): Promise<QuarrySetup>;
  createSupplier(draft: SupplierDraft): Promise<Supplier>;
  updateSupplier(id:string,draft:SupplierDraft):Promise<Supplier>;
  confirmPurchase(draft: QuarryPurchaseDraft): Promise<QuarryPurchase>;
  /** One delivery note with several items: each item is its own Supplier Load, saved all or none, linked by one delivery group id. */
  confirmDelivery(drafts: QuarryPurchaseDraft[]): Promise<QuarryPurchase[]>;
  incrementPurchase(sourcePurchaseId:string,quantityCubicMetres:number):Promise<QuarryPurchase>;
  listPurchases(): Promise<QuarryPurchase[]>;
  correctPurchase(id:string,draft:QuarryCorrectionDraft):Promise<QuarryPurchase>;
  cancelPurchase(id:string,reason:string):Promise<QuarryPurchase>;
  reactivatePurchase(id:string,draft:QuarryCorrectionDraft):Promise<QuarryPurchase>;
}
