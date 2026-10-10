import type { ConfirmedLoad } from './loads';
import { loadNumberLabel } from './loadNumberSeries';
import { loadLocalDate } from './loadCorrection';
import { plantSupplierName } from './loadSupplier';

/**
 * Phase 5. The Load History export: the company loads a person is looking at in Load History, as a list
 * PDF. Only Active loads are ever listed or counted; a cancelled load stays in the app, marked, and its number is
 * never reused. The Supplier column reads the Plant Company's real name as issued on the load (see plantSupplierName).
 */
export const NOT_RECORDED = 'Not recorded';

/** The short noun a corrected field is called in the Status column ("Truck changed"). */
const FIELD_NOUN: Record<string, string> = {
  'Record date': 'Date', Customer: 'Customer', Project: 'Project', 'Destination address': 'Destination', Item: 'Item',
  'Driver / Operator': 'Driver', 'Truck plate': 'Truck', 'Requested quantity kg': 'Quantity', 'Empty weight kg': 'Quantity',
  'Full weight kg': 'Quantity', 'Direct quantity': 'Quantity', Unit: 'Unit', Conversion: 'Unit', 'Unit price': 'Price', Notes: 'Notes',
  'Driver signature': 'Signature', 'Supplier signature': 'Signature',
};

/** Confirmed, or Corrected with what was ever changed: "Truck, price changed". Older loads without a history read Confirmed. */
export function loadHistoryStatus(load: Pick<ConfirmedLoad, 'correctionHistory'>): { label: 'Confirmed' | 'Corrected'; note: string | null } {
  const history = load.correctionHistory ?? [];
  if (!history.length) return { label: 'Confirmed', note: null };
  const nouns: string[] = [];
  for (const entry of history) for (const change of entry.changes ?? []) {
    const noun = FIELD_NOUN[change.field] ?? change.field;
    if (!nouns.includes(noun)) nouns.push(noun);
  }
  if (!nouns.length) return { label: 'Corrected', note: null };
  const [first, ...rest] = nouns;
  return { label: 'Corrected', note: `${[first, ...rest.map((value) => value.toLowerCase())].join(', ')} changed` };
}

export type LoadHistoryPdfRow = {
  recordedAt: string;
  /** The generated load number; null on a load confirmed before numbers existed (shown as a legacy load). */
  loadNumber: string | null;
  loadNumberLabel: string;
  transaction: string;
  item: string;
  supplier: string;
  customer: string;
  driver: string | null;
  truckPlate: string | null;
  quantityText: string;
  unitSymbol: string;
  statusLabel: 'Confirmed' | 'Corrected';
  statusNote: string | null;
};

const quantity = (value: number) => String(Math.round(value * 1000) / 1000);

/** Active loads only, newest first, ready to print. A missing driver or plate is null so the template can say Not recorded. */
export function loadHistoryRows(loads: ConfirmedLoad[], currentPlantName?: string | null): LoadHistoryPdfRow[] {
  return loads
    .filter((load) => load.status !== 'Cancelled')
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt) || b.transactionNumber.localeCompare(a.transactionNumber))
    .map((load) => {
      const status = loadHistoryStatus(load);
      return {
        recordedAt: load.confirmedAt,
        loadNumber: load.loadNumber ?? null,
        loadNumberLabel: load.loadNumber ? loadNumberLabel(load.loadNumber) : 'Legacy load',
        transaction: load.transactionNumber,
        item: load.itemName,
        supplier: plantSupplierName(load.companyName, currentPlantName) ?? NOT_RECORDED,
        customer: load.customerName,
        driver: load.driverName?.trim() || null,
        truckPlate: load.truckPlate?.trim() || null,
        quantityText: `${quantity(load.billedQuantity)} ${load.outputUnitSymbol}`.trim(),
        unitSymbol: load.outputUnitSymbol,
        statusLabel: status.label,
        statusNote: status.note,
      };
    });
}

/** Whole-list quantity per unit; units are never added together. */
export function loadHistoryUnitTotals(loads: ConfirmedLoad[]): { unitSymbol: string; quantity: number; loadCount: number }[] {
  const totals = new Map<string, { unitSymbol: string; quantity: number; loadCount: number }>();
  for (const load of loads) {
    if (load.status === 'Cancelled') continue;
    const current = totals.get(load.outputUnitSymbol) ?? { unitSymbol: load.outputUnitSymbol, quantity: 0, loadCount: 0 };
    current.quantity += load.billedQuantity;
    current.loadCount += 1;
    totals.set(load.outputUnitSymbol, current);
  }
  return [...totals.values()].map((value) => ({ ...value, quantity: Math.round(value.quantity * 1000) / 1000 }));
}

export type LoadHistoryFilters = { fromDate: string; toDate: string; customer: string; item: string };

/** The summary strip: Period, Customer, Items, Status and how many loads are listed. */
export function loadHistorySummary(filters: LoadHistoryFilters, listed: number): { period: string; customer: string; items: string; status: string; listed: string } {
  const day = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const period = filters.fromDate && filters.toDate ? `${day(filters.fromDate)} – ${day(filters.toDate)}` : filters.fromDate ? `From ${day(filters.fromDate)}` : filters.toDate ? `Until ${day(filters.toDate)}` : 'All dates';
  return { period, customer: filters.customer || 'All customers', items: filters.item || 'All items', status: 'Active loads', listed: String(listed) };
}

/** The loads the export would list for what is on screen: cancelled loads are never part of a PDF. */
export function exportableLoads(filtered: ConfirmedLoad[]): ConfirmedLoad[] {
  return filtered.filter((load) => load.status !== 'Cancelled');
}

/** True when the visible filters point at exactly one project, so "remember for this project" makes sense. */
export function singleProjectId(loads: ConfirmedLoad[]): string | null {
  const ids = new Set(loads.map((load) => load.projectId ?? ''));
  return ids.size === 1 && [...ids][0] ? [...ids][0]! : null;
}

export function loadHistoryFileName(filters: Pick<LoadHistoryFilters, 'fromDate' | 'toDate'>, generatedAt: string): string {
  const part = filters.fromDate || filters.toDate ? `${filters.fromDate || 'start'}_to_${filters.toDate || 'today'}` : loadLocalDate(generatedAt);
  return `Load-History-${part}.pdf`;
}

