import type { DriverProfile, TruckProfile } from './loads';

export type Supplier = { id: string; name: string; phone: string | null; email: string | null; address: string | null; taxVatNumber: string | null; notes: string | null; isActive: boolean };
export type SupplierDraft = { name: string; phone?: string; email?: string; address?: string; taxVatNumber?: string; notes?: string };
export type QuarryItem = { id: string; name: string; internalCode: string | null; categoryName: string };
export type QuarrySetup = { suppliers: Supplier[]; items: QuarryItem[]; drivers: DriverProfile[]; trucks: TruckProfile[]; vatRatePercent: number };
export type QuarryPurchaseDraft = { supplierId: string; itemId: string; quantityCubicMetres: string; driverId: string; truckId: string; supplierTicketNumber: string; unitPriceUsd: string; notes: string; photos: string[] };
export type QuarryCorrectionDraft = Pick<QuarryPurchaseDraft,'quantityCubicMetres'|'driverId'|'truckId'|'supplierTicketNumber'|'unitPriceUsd'|'notes'>;
export type QuarryCalculation = { subtotalUsd: number | null; vatAmountUsd: number | null; finalTotalUsd: number | null };
export type QuarryPurchase = { id: string; purchaseNumber: string; confirmedAt: string; supplierId:string; supplierName: string; itemId:string; itemName: string; itemCode: string | null; categoryName: string; quantityCubicMetres: number; driverId:string; driverName: string; truckId:string; truckPlate: string; supplierTicketNumber: string | null; unitPriceUsd: number | null; subtotalUsd: number | null; vatRatePercent: number | null; vatAmountUsd: number | null; finalTotalUsd: number | null; paymentStatus: 'Unpriced' | 'No Payment Due' | 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overpaid'; notes: string | null; photos: string[];status:'Active'|'Cancelled';cancellationReason:string|null;cancelledAt:string|null };

export const emptyQuarryPurchaseDraft: QuarryPurchaseDraft = { supplierId: '', itemId: '', quantityCubicMetres: '', driverId: '', truckId: '', supplierTicketNumber: '', unitPriceUsd: '', notes: '', photos: [] };

export function calculateQuarryPurchase(draft: QuarryPurchaseDraft, vatRatePercent: number): QuarryCalculation {
  if (!draft.unitPriceUsd.trim()) return { subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
  const price = Number(draft.unitPriceUsd.replace(',', '.')); const quantity = Number(draft.quantityCubicMetres);
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity <= 0) return { subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
  const subtotalCents = Math.round(quantity * price * 100); const vatCents = Math.round(subtotalCents * vatRatePercent / 100);
  return { subtotalUsd: subtotalCents / 100, vatAmountUsd: vatCents / 100, finalTotalUsd: (subtotalCents + vatCents) / 100 };
}

export function validateQuarryPurchase(draft: QuarryPurchaseDraft, setup: QuarrySetup): string[] {
  const issues: string[] = [];
  if (!setup.suppliers.some((value) => value.id === draft.supplierId)) issues.push('Select a quarry / supplier.');
  if (!setup.items.some((value) => value.id === draft.itemId)) issues.push('Select an item enabled for quarry purchases.');
  const quantity = Number(draft.quantityCubicMetres); if (!Number.isInteger(quantity) || quantity <= 0) issues.push('Quantity must be a positive whole number of cubic metres.');
  if (!setup.drivers.some((value) => value.id === draft.driverId)) issues.push('Select a driver.');
  if (!setup.trucks.some((value) => value.id === draft.truckId)) issues.push('Select a truck.');
  if (draft.unitPriceUsd.trim()) { const price = Number(draft.unitPriceUsd.replace(',', '.')); if (!Number.isFinite(price) || price < 0) issues.push('Price per m³ must be zero or more.'); }
  return issues;
}
