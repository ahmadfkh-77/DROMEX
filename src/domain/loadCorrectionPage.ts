/**
 * DEC-536. The lines of the Company Load correction page ("tap a line to correct it", the same page as the Supplier Load correction,
 * DEC-525) and which of them were changed. Pure, so the page, the review and the tests all read the same text. Nothing here saves
 * anything: the history entry a correction saves is still built by `correctionChanges`.
 */
import { correctionLocks, correctionToLoadDraft, correctionVatRate, correctedUnitSymbol } from './loadCorrection';
import { calculateLoad, type ConfirmedLoad, type LoadCorrectionDraft, type LoadSetupOptions } from './loads';
import { truckCrewRoleLabel } from './people';
import { formatCorrectionDate } from './supplierCorrection';

/** Which small sheet a line opens. */
export type LoadCorrectionSheet = 'date' | 'customer' | 'place' | 'item' | 'target' | 'quantity' | 'conversion' | 'driver' | 'truck' | 'price' | 'notes';
export type LoadCorrectionLine = { key: string; label: string; value: string; sheet: LoadCorrectionSheet; signature: string; locked: boolean };
export type LoadCorrectionTarget = { label: string; signature: string };

const clean = (value: string | undefined | null) => (value ?? '').trim().replace(/\s+/g, ' ');
const numberText = (value: string | undefined) => { const text = clean(value).replace(',', '.'); const parsed = Number(text); return text && Number.isFinite(parsed) ? String(parsed) : text; };
const money = (value: number) => `$${value.toFixed(2)}`;

function vatRateOf(selected: ConfirmedLoad, form: LoadCorrectionDraft, options: LoadSetupOptions): number {
  try { return correctionVatRate(selected, form, options.companySettings.vatRatePercent); } catch { return selected.vatRatePercent ?? 0; }
}

/** The target this load will count toward after the correction, as a line: kept while the project and the material still fit, otherwise Not linked. */
export function correctedTargetKept(selected: ConfirmedLoad, form: LoadCorrectionDraft): boolean {
  const effective = correctionToLoadDraft(selected, form);
  return effective.projectId === (selected.projectId ?? '') && effective.itemId === (selected.itemId ?? '');
}

/**
 * The lines in the order of the page. `target` is null when the line is hidden (the project has no targets and the load is not linked).
 * `activePaymentCents` decides which lines show Locked, the same locks the repository enforces.
 */
export function loadCorrectionLines(selected: ConfirmedLoad, form: LoadCorrectionDraft, options: LoadSetupOptions, target: LoadCorrectionTarget | null, activePaymentCents = 0): LoadCorrectionLine[] {
  const effective = correctionToLoadDraft(selected, form);
  const locks = correctionLocks(activePaymentCents);
  const isDirect = selected.quantityMethod === 'direct';
  const conversion = options.conversions.find((value) => value.id === effective.conversionId);
  const vatRate = vatRateOf(selected, form, options);
  const calc = calculateLoad(effective, conversion, vatRate);
  const customer = options.customers.find((value) => value.id === effective.customerId)?.name ?? selected.customerName;
  const project = effective.projectId ? options.projects.find((value) => value.id === effective.projectId) : undefined;
  const item = options.items.find((value) => value.id === effective.itemId)?.name ?? selected.itemName;
  const unit = options.units.find((value) => value.id === effective.directUnitId)?.symbol ?? '';
  const person = options.drivers.find((value) => value.id === effective.driverId);
  const driverName = clean(effective.driverName);
  const truck = options.trucks.find((value) => value.id === effective.truckId);
  const plate = effective.truckPlate.trim().toUpperCase();
  const priceText = numberText(effective.unitPriceUsd);
  const billedUnit = correctedUnitSymbol(effective, options) || 'unit';
  const vatText = vatRate > 0 ? `${vatRate}% VAT` : 'No VAT';
  const place = effective.projectId ? `Project · ${project?.name ?? selected.projectName ?? 'Not chosen'}` : `Address · ${clean(effective.destinationAddress) || 'Not given'}`;
  const quantity = isDirect ? `${numberText(effective.directQuantity) || '—'} ${unit}`.trim() : calc.netWeightKg == null ? '—' : `Net ${calc.netWeightKg} kg`;
  const lines: LoadCorrectionLine[] = [
    { key: 'date', label: 'Date', value: formatCorrectionDate(effective.recordDate), sheet: 'date', signature: effective.recordDate, locked: false },
    { key: 'customer', label: 'Customer', value: customer, sheet: 'customer', signature: effective.customerId, locked: locks.customer },
    { key: 'place', label: 'Delivered to', value: place, sheet: 'place', signature: `${effective.projectId}|${effective.projectId ? '' : clean(effective.destinationAddress)}`, locked: locks.project },
    { key: 'item', label: 'Item', value: item, sheet: 'item', signature: effective.itemId, locked: false },
  ];
  if (target) lines.push({ key: 'target', label: 'Counts toward target', value: target.label, sheet: 'target', signature: target.signature, locked: false });
  lines.push(
    { key: 'quantity', label: 'Quantity', value: quantity, sheet: 'quantity', signature: isDirect ? `${numberText(effective.directQuantity)}|${effective.directUnitId}` : `${numberText(effective.requestedQuantityKg)}|${numberText(effective.emptyWeightKg)}|${numberText(effective.fullWeightKg)}`, locked: false },
    { key: 'conversion', label: 'Converted', value: conversion ? `${conversion.name} · ${calc.billedQuantity == null ? '—' : calc.billedQuantity.toFixed(conversion.decimalPlaces)} ${conversion.outputUnitSymbol}` : 'None', sheet: 'conversion', signature: effective.conversionId, locked: locks.unit },
    { key: 'driver', label: 'Driver', value: driverName ? `${driverName} · ${effective.driverId ? truckCrewRoleLabel(person?.role) : 'typed for this load'}` : 'Not chosen', sheet: 'driver', signature: `${effective.driverId}|${effective.driverId ? '' : driverName}`, locked: false },
    { key: 'truck', label: 'Truck', value: plate ? `${plate}${truck?.makeModel ? ` · ${truck.makeModel}` : ''}` : 'Not chosen', sheet: 'truck', signature: `${effective.truckId}|${effective.truckId ? '' : plate}`, locked: false },
    { key: 'price', label: 'Price', value: priceText ? `${money(Number(priceText))} per ${billedUnit} · ${vatText}` : 'Unpriced', sheet: 'price', signature: `${priceText}|${priceText ? vatRate : ''}`, locked: locks.price },
    { key: 'notes', label: 'Notes', value: clean(effective.notes) || 'None', sheet: 'notes', signature: clean(effective.notes), locked: false },
  );
  return lines;
}

/** The total and VAT of the form as it stands: null while the load has no price. */
export function loadCorrectionTotals(selected: ConfirmedLoad, form: LoadCorrectionDraft, options: LoadSetupOptions): { subtotal: number | null; vatRatePercent: number; vatAmount: number | null; total: number | null } {
  const effective = correctionToLoadDraft(selected, form);
  const vatRate = vatRateOf(selected, form, options);
  const calc = calculateLoad(effective, options.conversions.find((value) => value.id === effective.conversionId), vatRate);
  return { subtotal: calc.subtotalUsd, vatRatePercent: vatRate, vatAmount: calc.vatAmountUsd, total: calc.finalTotalUsd };
}

export type ChangedLoadCorrectionLine = { key: string; label: string; was: string; now: string; sheet: LoadCorrectionSheet };

/** The lines whose content differs from the saved load, with the old and the new text. The crossed-out values on the page use this. */
export function changedLoadCorrectionLines(before: LoadCorrectionLine[], after: LoadCorrectionLine[]): ChangedLoadCorrectionLine[] {
  return after.flatMap((line) => {
    const original = before.find((value) => value.key === line.key);
    if (!original) return [{ key: line.key, label: line.label, was: 'Not linked', now: line.value, sheet: line.sheet }];
    return original.signature === line.signature ? [] : [{ key: line.key, label: line.label, was: original.value, now: line.value, sheet: line.sheet }];
  });
}

/** The sheet a validation message belongs to, so a sheet shows only its own problems. */
const sheetRules: [LoadCorrectionSheet, RegExp][] = [
  ['date', /record date/i], ['customer', /saved customer|another customer/i], ['place', /project|destination address/i], ['item', /load-enabled item/i],
  ['quantity', /direct quantity|quantity unit|weight|requested quantity/i], ['conversion', /conversion/i], ['driver', /driver|operator/i], ['truck', /truck/i],
  ['price', /price|vat/i],
];
export const loadCorrectionIssueSheet = (issue: string): LoadCorrectionSheet | null => sheetRules.find(([, rule]) => rule.test(issue))?.[0] ?? null;

/** True when saving would change anything about the load the person can see. */
export const loadCorrectionBarLabel = (changes: number) => (changes ? `${changes} CHANGE${changes === 1 ? '' : 'S'}` : 'TOTAL');
