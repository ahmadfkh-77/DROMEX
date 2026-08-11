import type { QuarryCorrectionDraft, QuarryPurchase, QuarryPurchaseDraft, QuarrySetup, Supplier, SupplierDraft } from '../../domain/quarry';

export interface QuarryRepository {
  getSetup(): Promise<QuarrySetup>;
  createSupplier(draft: SupplierDraft): Promise<Supplier>;
  confirmPurchase(draft: QuarryPurchaseDraft): Promise<QuarryPurchase>;
  listPurchases(): Promise<QuarryPurchase[]>;
  correctPurchase(id:string,draft:QuarryCorrectionDraft):Promise<QuarryPurchase>;
  cancelPurchase(id:string,reason:string):Promise<QuarryPurchase>;
}
