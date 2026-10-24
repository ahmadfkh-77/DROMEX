/**
 * DEC-525. The lines of the Supplier Load correction page ("tap a line to correct it") and how many of them were changed.
 * Pure, so the page, the review and the tests all read the same text. Nothing here saves anything.
 */
import { calculateQuarryPurchase, purchaseDestination, type QuarryCorrectionDraft, type QuarryPurchase, type QuarrySetup } from './quarry';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar day (on this phone) of a saved timestamp, as YYYY-MM-DD. The day a load counts on is always this local day. */
export function localDateOf(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 2026-10-24 as 24 Oct 2026; anything that is not a date is returned as typed. */
export function formatCorrectionDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}` : value;
}

/** The correction form a saved load starts from: every field as it is now, with no reason yet. */
export function quarryCorrectionDraft(purchase: QuarryPurchase): QuarryCorrectionDraft {
  return {
    recordDate: localDateOf(purchase.confirmedAt), supplierId: purchase.supplierId, projectId: purchase.projectId ?? '',
    destinationType: purchaseDestination(purchase).type, companySiteId: purchase.companySiteId ?? '', itemId: purchase.itemId, unitId: purchase.unitId,
    quantityCubicMetres: String(purchase.quantityCubicMetres), pieces: purchase.pieces ? String(purchase.pieces) : '',
    diameterMm: purchase.diameterMm == null ? '' : String(purchase.diameterMm), lengthPerBarM: purchase.lengthPerBarM == null ? '' : String(purchase.lengthPerBarM),
    calculatedWeightKg: purchase.calculatedWeightKg == null ? '' : String(purchase.calculatedWeightKg), weightSource: purchase.weightSource ?? '',
    deliveryMethod: purchase.deliveryMethod, driverId: purchase.deliveryMethod === 'company' ? purchase.driverId : '', truckId: purchase.deliveryMethod === 'company' ? purchase.truckId : '',
    supplierTruckPlate: purchase.deliveryMethod === 'supplier' ? purchase.truckPlate : '', supplierTicketNumber: purchase.supplierTicketNumber ?? '',
    priceBasis: purchase.priceBasis, unitPriceUsd: purchase.unitPriceUsd == null ? '' : purchase.unitPriceUsd.toFixed(2),
    vatMode: purchase.vatMode, customVatRatePercent: purchase.vatMode === 'custom' ? String(purchase.vatRatePercent ?? 0) : '', vatInclusive: purchase.vatInclusive,
    notes: purchase.notes ?? '', correctionReason: '',
  };
}

/** Which small sheet a line opens. Quantity opens the same sheet for the Quantity and Pieces lines. */
export type CorrectionSheet = 'date' | 'supplier' | 'place' | 'item' | 'quantity' | 'delivery' | 'ticket' | 'price' | 'notes';
export type CorrectionLine = { key: string; label: string; value: string; sheet: CorrectionSheet; signature: string };

const clean = (value: string | undefined) => (value ?? '').trim();
const numberText = (value: string | undefined) => { const text = clean(value).replace(',', '.'); const parsed = Number(text); return text && Number.isFinite(parsed) ? String(parsed) : text; };
const money = (value: number) => `$${value.toFixed(2)}`;

export function correctionLines(draft: QuarryCorrectionDraft, setup: QuarrySetup): CorrectionLine[] {
  const supplier = setup.suppliers.find((value) => value.id === draft.supplierId)?.name ?? 'Not chosen';
  const item = setup.items.find((value) => value.id === draft.itemId)?.name ?? 'Not chosen';
  const unit = setup.units.find((value) => value.id === draft.unitId)?.symbol ?? '';
  const type = draft.destinationType ?? (draft.projectId ? 'project' : 'unassigned');
  const place = type === 'project'
    ? `Project · ${setup.projects.find((value) => value.id === draft.projectId)?.name ?? 'Not chosen'}`
    : type === 'company_site' ? `Company Site · ${(setup.companySites ?? []).find((value) => value.id === draft.companySiteId)?.name ?? 'Not chosen'}` : 'Unassigned';
  const placeId = type === 'project' ? draft.projectId : type === 'company_site' ? (draft.companySiteId ?? '') : '';
  const pieces = clean(draft.pieces);
  const driver = setup.drivers.find((value) => value.id === draft.driverId)?.name ?? 'Not chosen';
  const plate = setup.trucks.find((value) => value.id === draft.truckId)?.plate ?? 'no truck';
  const supplierPlate = clean(draft.supplierTruckPlate);
  const delivery = draft.deliveryMethod === 'company' ? `Our driver · ${driver} · ${plate}` : `Supplier delivering · ${supplierPlate || 'no plate'}`;
  const price = numberText(draft.unitPriceUsd);
  const vatText = draft.vatMode === 'none' ? 'No VAT' : `${draft.vatMode === 'custom' ? numberText(draft.customVatRatePercent) : setup.vatRatePercent}% VAT ${draft.vatInclusive ? 'included' : 'excluded'}`;
  const priceText = price ? `${money(Number(price))} ${draft.priceBasis === 'whole' ? 'as a whole' : `per ${unit || 'unit'}`} · ${vatText}` : 'Unpriced';
  return [
    { key: 'date', label: 'Date', value: formatCorrectionDate(draft.recordDate), sheet: 'date', signature: draft.recordDate },
    { key: 'supplier', label: 'Supplier', value: supplier, sheet: 'supplier', signature: draft.supplierId },
    { key: 'place', label: 'Delivered to', value: place, sheet: 'place', signature: `${type}|${placeId}` },
    { key: 'item', label: 'Item', value: item, sheet: 'item', signature: draft.itemId },
    { key: 'quantity', label: 'Quantity', value: `${numberText(draft.quantityCubicMetres) || '—'} ${unit}`.trim(), sheet: 'quantity', signature: [numberText(draft.quantityCubicMetres), draft.unitId, numberText(draft.diameterMm), numberText(draft.lengthPerBarM), numberText(draft.calculatedWeightKg), draft.weightSource ?? ''].join('|') },
    { key: 'pieces', label: 'Pieces', value: pieces ? `${pieces} piece${pieces === '1' ? '' : 's'}` : 'Not recorded', sheet: 'quantity', signature: pieces },
    { key: 'delivery', label: 'Delivery', value: delivery, sheet: 'delivery', signature: draft.deliveryMethod === 'company' ? `company|${draft.driverId}|${draft.truckId}` : `supplier|${supplierPlate}` },
    { key: 'ticket', label: 'Ticket / invoice', value: clean(draft.supplierTicketNumber) || 'Not recorded', sheet: 'ticket', signature: clean(draft.supplierTicketNumber) },
    { key: 'price', label: 'Price', value: priceText, sheet: 'price', signature: [draft.priceBasis, price, draft.vatMode, draft.vatMode === 'custom' ? numberText(draft.customVatRatePercent) : '', draft.vatInclusive ? 'in' : 'ex'].join('|') },
    { key: 'notes', label: 'Notes', value: clean(draft.notes) || 'None', sheet: 'notes', signature: clean(draft.notes) },
  ];
}

/** The total and VAT of the form as it stands: null while the load has no price. */
export function correctionTotals(draft: QuarryCorrectionDraft, setup: QuarrySetup): { subtotal: number | null; vatRatePercent: number | null; vatAmount: number | null; total: number | null } {
  const calculation = calculateQuarryPurchase({ ...draft, photos: [] }, setup.vatRatePercent);
  return { subtotal: calculation.subtotalUsd, vatRatePercent: calculation.vatRatePercent, vatAmount: calculation.vatAmountUsd, total: calculation.finalTotalUsd };
}

export type ChangedLine = { key: string; label: string; was: string; now: string; sheet: CorrectionSheet };

/** The lines whose content differs from the saved load, with the old and the new text. The review and the "N changes" count use this. */
export function changedCorrectionLines(base: QuarryCorrectionDraft, current: QuarryCorrectionDraft, setup: QuarrySetup): ChangedLine[] {
  const before = correctionLines(base, setup);
  return correctionLines(current, setup).flatMap((line, index) => {
    const original = before[index]!;
    return original.signature === line.signature ? [] : [{ key: line.key, label: line.label, was: original.value, now: line.value, sheet: line.sheet }];
  });
}

/** Active payments keep the supplier fixed; the repository enforces it, this only lets the page say so before the Review. */
export function supplierLocked(purchase: Pick<QuarryPurchase, 'paymentStatus'>): boolean {
  return purchase.paymentStatus === 'Partially Paid' || purchase.paymentStatus === 'Paid' || purchase.paymentStatus === 'Overpaid';
}
