import type {LinkedQuarryLoad} from './projectReports';

/**
 * DEC-480. The single grouping of a day's Supplier Loads, shared by the Daily Report PDF and workbook:
 * Item, then Supplier, then the individual loads.
 *
 * Grouping uses stable ids (item_id, supplier_id, unit_id) and falls back to a normalized name only for
 * a legacy record that has none; the label printed is the one recorded on the first load of the group.
 * Quantities are only ever added within one unit, so a supplier or item that delivered in tonnes and in
 * cubic metres gets one subtotal per unit and never a combined figure.
 */
export type UnitQuantity = { unitKey: string; unitSymbol: string; quantity: number; loadCount: number };
export type SupplierLoadSupplierGroup = {
  supplierKey: string; supplierId: string | null; supplierName: string;
  loads: LinkedQuarryLoad[];
  subtotals: UnitQuantity[];
  /** Sum of the priced loads only; an unpriced load is counted, never treated as zero. */
  pricedTotalUsd: number; unpricedCount: number;
};
export type SupplierLoadItemGroup = {
  itemKey: string; itemId: string | null; itemName: string;
  suppliers: SupplierLoadSupplierGroup[];
  totals: UnitQuantity[];
  pricedTotalUsd: number; unpricedCount: number;
};

const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
/** Rounds away binary floating-point noise; quantities are entered with at most six decimals. */
const clean = (value: number) => Math.round(value * 1e6) / 1e6;
const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const itemKey = (load: LinkedQuarryLoad) => load.itemId ? `id:${load.itemId}` : `name:${normalized(load.itemName)}`;
const supplierKey = (load: LinkedQuarryLoad) => load.supplierId ? `id:${load.supplierId}` : `name:${normalized(load.supplierName)}`;
const unitKey = (load: LinkedQuarryLoad) => load.unitId ?? `symbol:${load.unitSymbol}`;

/** Per-unit quantities for a set of loads, in unit-symbol order. */
export function unitQuantities(loads: readonly LinkedQuarryLoad[]): UnitQuantity[] {
  const byUnit = new Map<string, UnitQuantity>();
  for (const load of loads) {
    const key = unitKey(load);
    const current = byUnit.get(key) ?? { unitKey: key, unitSymbol: load.unitSymbol, quantity: 0, loadCount: 0 };
    byUnit.set(key, { ...current, quantity: clean(current.quantity + load.quantity), loadCount: current.loadCount + 1 });
  }
  return [...byUnit.values()].sort((a, b) => byLabel(a.unitSymbol, b.unitSymbol) || a.unitKey.localeCompare(b.unitKey));
}

function pricing(loads: readonly LinkedQuarryLoad[]) {
  const priced = loads.filter((load) => load.finalTotalUsd != null);
  return { pricedTotalUsd: Math.round(priced.reduce((sum, load) => sum + (load.finalTotalUsd ?? 0), 0) * 100) / 100, unpricedCount: loads.length - priced.length };
}

const byDeliveryOrder = (a: LinkedQuarryLoad, b: LinkedQuarryLoad) =>
  a.confirmedAt.localeCompare(b.confirmedAt) || a.purchaseNumber.localeCompare(b.purchaseNumber, undefined, { numeric: true }) || a.id.localeCompare(b.id);

export function groupSupplierLoads(loads: readonly LinkedQuarryLoad[]): SupplierLoadItemGroup[] {
  const items = new Map<string, LinkedQuarryLoad[]>();
  for (const load of [...loads].sort(byDeliveryOrder)) items.set(itemKey(load), [...(items.get(itemKey(load)) ?? []), load]);
  return [...items.entries()].map(([key, itemLoads]) => {
    const suppliers = new Map<string, LinkedQuarryLoad[]>();
    for (const load of itemLoads) suppliers.set(supplierKey(load), [...(suppliers.get(supplierKey(load)) ?? []), load]);
    const first = itemLoads[0]!;
    return {
      itemKey: key, itemId: first.itemId ?? null, itemName: first.itemName,
      suppliers: [...suppliers.entries()].map(([supplier, supplierLoads]) => ({
        supplierKey: supplier, supplierId: supplierLoads[0]!.supplierId ?? null, supplierName: supplierLoads[0]!.supplierName,
        loads: supplierLoads, subtotals: unitQuantities(supplierLoads), ...pricing(supplierLoads),
      })).sort((a, b) => byLabel(a.supplierName, b.supplierName) || a.supplierKey.localeCompare(b.supplierKey)),
      totals: unitQuantities(itemLoads), ...pricing(itemLoads),
    };
  }).sort((a, b) => byLabel(a.itemName, b.itemName) || a.itemKey.localeCompare(b.itemKey));
}
