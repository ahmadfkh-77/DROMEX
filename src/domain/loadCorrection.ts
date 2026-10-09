import type { SignerDisplay } from './documentSigners';
import {
  calculateLoad,
  directConversionLines,
  emptyLoadDraft,
  validateLoadDraft,
  type ConfirmedLoad,
  type LoadCorrectionChange,
  type LoadCorrectionDraft,
  type LoadDraft,
  type LoadSetupOptions,
} from './loads';
import { truckCrewRoleLabel } from './people';

/**
 * Phase 4. Full correction of a confirmed load. Everything about a load can be corrected, but never by editing
 * the confirmed record directly: the repository saves the load as it was, applies the correction, and keeps both.
 * These pure rules are shared by the Correct this load screen and the repository, so what the screen lists as
 * "changed" is exactly what is saved in the history.
 */

const clean = (value: string | null | undefined): string | null => (value ?? '').trim().replace(/\s+/g, ' ') || null;
const text = (value: number | null | undefined): string => (value == null ? '' : String(value));
const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

/** The local calendar date of a load's confirmation (the record date), as yyyy-mm-dd. */
export function loadLocalDate(confirmedAt: string): string {
  const date = new Date(confirmedAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** True when a correction uses any of the Phase 4 fields (the full form) rather than the older partial one. */
export function isFullCorrection(draft: LoadCorrectionDraft): boolean {
  return [draft.recordDate, draft.customerId, draft.projectId, draft.itemId, draft.driverName, draft.truckId, draft.truckPlate, draft.conversionId, draft.directUnitId, draft.driverSignaturePaths, draft.supplierSignature].some((value) => value !== undefined);
}

/** A direct load that did not use a conversion keeps a retained internal conversion that must not be shown or chosen. */
function plainDirect(selected: ConfirmedLoad): boolean {
  return selected.quantityMethod === 'direct' && !directConversionLines(selected);
}

/** The correction form exactly as the load is today: nothing changed. */
export function correctionBaseline(selected: ConfirmedLoad): LoadCorrectionDraft {
  return {
    requestedQuantityKg: text(selected.requestedQuantityKg),
    emptyWeightKg: text(selected.emptyWeightKg),
    fullWeightKg: text(selected.fullWeightKg),
    directQuantity: text(selected.directQuantity),
    unitPriceUsd: selected.unitPriceUsd == null ? '' : selected.unitPriceUsd.toFixed(2),
    destinationAddress: selected.destinationAddress ?? '',
    notes: selected.notes ?? '',
    correctionReason: '',
    driverId: selected.driverId ?? '',
    driverName: selected.driverName,
    recordDate: loadLocalDate(selected.confirmedAt),
    customerId: selected.customerId ?? '',
    projectId: selected.projectId ?? '',
    itemId: selected.itemId ?? '',
    truckId: selected.truckId ?? '',
    truckPlate: selected.truckPlate,
    conversionId: plainDirect(selected) ? '' : selected.conversionId ?? '',
    directUnitId: selected.directUnitId ?? '',
  };
}

function driverChanged(selected: ConfirmedLoad, draft: LoadCorrectionDraft): boolean {
  if (draft.driverName === undefined) return false;
  const id = draft.driverId ?? '';
  return id !== (selected.driverId ?? '') || (!id && clean(draft.driverName) !== clean(selected.driverName));
}

/** The corrected load as a Make Receipt style draft, so the same checks and calculations apply. */
export function correctionToLoadDraft(selected: ConfirmedLoad, draft: LoadCorrectionDraft): LoadDraft {
  const base = correctionBaseline(selected);
  const signatureCleared = draft.driverSignaturePaths === undefined && driverChanged(selected, draft);
  return {
    ...emptyLoadDraft,
    recordDate: draft.recordDate ?? base.recordDate!,
    customerId: draft.customerId ?? base.customerId!,
    projectId: draft.projectId ?? base.projectId!,
    destinationAddress: draft.destinationAddress,
    itemId: draft.itemId ?? base.itemId!,
    driverId: draft.driverName !== undefined ? draft.driverId ?? '' : draft.driverId || base.driverId!,
    driverName: draft.driverName ?? base.driverName!,
    truckId: draft.truckPlate !== undefined ? draft.truckId ?? '' : base.truckId!,
    truckPlate: draft.truckPlate ?? base.truckPlate!,
    quantityMethod: selected.quantityMethod,
    requestedQuantityKg: draft.requestedQuantityKg,
    emptyWeightKg: draft.emptyWeightKg,
    fullWeightKg: draft.fullWeightKg,
    conversionId: draft.conversionId ?? base.conversionId!,
    directQuantity: draft.directQuantity,
    directUnitId: draft.directUnitId ?? base.directUnitId!,
    unitPriceUsd: draft.unitPriceUsd,
    notes: draft.notes,
    driverSignaturePaths: signatureCleared ? [] : draft.driverSignaturePaths ?? selected.signaturePaths,
  };
}

/** Which fields are locked while the load has active payments: money and attribution never move under a payment. */
export function correctionLocks(activePaymentCents: number): { customer: boolean; project: boolean; unit: boolean; price: boolean } {
  const locked = activePaymentCents > 0;
  return { customer: locked, project: locked, unit: locked, price: locked };
}

const samePrice = (a: string, b: string) => {
  const parse = (value: string) => { const t = value.trim().replace(',', '.'); return t ? Number(t) : null; };
  return parse(a) === parse(b);
};

/**
 * Every reason this correction cannot be saved. Empty means it can. Mirrors the checks Make Receipt applies, plus
 * the payment lock; the record date is only checked when the date itself is being changed.
 */
export function validateLoadCorrection(selected: ConfirmedLoad, draft: LoadCorrectionDraft, options: LoadSetupOptions, activePaymentCents: number): string[] {
  const effective = correctionToLoadDraft(selected, draft);
  const base = correctionToLoadDraft(selected, correctionBaseline(selected));
  let issues = validateLoadDraft(effective, options);
  if (effective.recordDate === base.recordDate) issues = issues.filter((issue) => !/^(Record date|The record date)/.test(issue));
  const locks = correctionLocks(activePaymentCents);
  const moved = [
    locks.customer && effective.customerId !== base.customerId ? 'customer' : null,
    locks.project && effective.projectId !== base.projectId ? 'project' : null,
    locks.unit && (effective.conversionId !== base.conversionId || effective.directUnitId !== base.directUnitId) ? 'unit' : null,
    locks.price && !samePrice(effective.unitPriceUsd, base.unitPriceUsd) ? 'price' : null,
  ].filter((value): value is string => value != null);
  if (moved.length) issues.push(`The ${moved.join(', ')} cannot change while this load has active payments. Cancel the payments first.`);
  return issues;
}

/** The unit symbol the corrected load will be counted in. */
export function correctedUnitSymbol(effective: LoadDraft, options: LoadSetupOptions): string | null {
  const conversion = options.conversions.find((value) => value.id === effective.conversionId);
  if (effective.quantityMethod === 'direct' && !conversion) return options.units.find((value) => value.id === effective.directUnitId)?.symbol ?? null;
  return conversion?.outputUnitSymbol ?? null;
}

/**
 * The fields this correction changes, each with what it was and what it becomes. Used for the CHANGED tags and
 * the list above the reason, and saved as the history entry. Only fields that really differ are returned.
 */
export function correctionChanges(selected: ConfirmedLoad, draft: LoadCorrectionDraft, options: LoadSetupOptions, signerLabel: (selection: { signerId: string; display: SignerDisplay }) => string = (selection) => selection.signerId): LoadCorrectionChange[] {
  const effective = correctionToLoadDraft(selected, draft);
  const isDirect = selected.quantityMethod === 'direct';
  const conversion = options.conversions.find((value) => value.id === effective.conversionId);
  const calc = calculateLoad(effective, conversion, selected.vatRatePercent ?? 0);
  const priceText = effective.unitPriceUsd.trim().replace(',', '.');
  const price = priceText ? Number(priceText) : null;
  const person = options.drivers.find((value) => value.id === effective.driverId);
  const rows: [string, string | null, string | null][] = [
    ['Record date', loadLocalDate(selected.confirmedAt), effective.recordDate],
    ['Customer', selected.customerName, options.customers.find((value) => value.id === effective.customerId)?.name ?? selected.customerName],
    ['Project', selected.projectName, effective.projectId ? options.projects.find((value) => value.id === effective.projectId)?.name ?? selected.projectName : null],
    ['Destination address', selected.destinationAddress, clean(effective.destinationAddress)],
    ['Item', selected.itemName, options.items.find((value) => value.id === effective.itemId)?.name ?? selected.itemName],
    ['Driver / Operator', `${selected.driverName} (${truckCrewRoleLabel(selected.driverRole)})`, `${clean(effective.driverName) ?? ''} (${truckCrewRoleLabel(effective.driverId ? person?.role : null)})`],
    ['Truck plate', selected.truckPlate, effective.truckPlate.trim().toUpperCase()],
  ];
  if (isDirect) rows.push(['Direct quantity', text(selected.directQuantity), text(calc.billedQuantity == null ? null : Number(effective.directQuantity.trim().replace(',', '.')))]);
  else {
    rows.push(['Requested quantity kg', text(selected.requestedQuantityKg) || null, effective.requestedQuantityKg.trim() || null]);
    rows.push(['Empty weight kg', text(selected.emptyWeightKg), effective.emptyWeightKg.trim()]);
    rows.push(['Full weight kg', text(selected.fullWeightKg), effective.fullWeightKg.trim()]);
  }
  rows.push(['Unit', selected.outputUnitSymbol, correctedUnitSymbol(effective, options)]);
  rows.push(['Conversion', plainDirect(selected) ? 'None' : selected.conversionName ?? 'None', conversion ? conversion.name : 'None']);
  rows.push(['Unit price', selected.unitPriceUsd == null ? null : String(selected.unitPriceUsd), price == null ? null : String(price)]);
  rows.push(['Notes', selected.notes, clean(effective.notes)]);
  const before = selected.signaturePaths;
  const after = effective.driverSignaturePaths;
  if (!same(before, after)) rows.push(['Driver signature', before.length ? 'Signed' : 'Unsigned', after.length ? (before.length ? 'Re-signed' : 'Signed') : 'Unsigned']);
  if (draft.supplierSignature !== undefined) {
    const was = selected.supplierSignature ? `${selected.supplierSignature.name}${selected.supplierSignature.display === 'name_only' ? ' (name only)' : ''}` : 'None';
    const now = draft.supplierSignature ? signerLabel(draft.supplierSignature) : 'None';
    rows.push(['Supplier signature', was, now]);
  }
  return rows.filter(([, was, now]) => (was ?? null) !== (now ?? null)).map(([field, originalValue, newValue]) => ({ field, originalValue: originalValue === '' ? null : originalValue, newValue: newValue === '' ? null : newValue }));
}

/** Everything the Correct this load screen needs to know about one load besides the load itself. */
export type LoadCorrectionContext = {
  /** The usual setup lists, plus this load's own customer, project, item, conversion, unit, person and truck even when they are no longer offered for new loads. */
  options: LoadSetupOptions;
  activePaymentCount: number;
  activePaymentCents: number;
  /** Saved originals, oldest first: version n is the load exactly as it was before correction n. */
  versions: { version: number; correctedAt: string; reason: string }[];
  /** How many issued documents (statements, invoices) include this load. They keep their own copy. */
  issuedDocumentCount: number;
};
