import type {FuelType} from './fuel';

/**
 * DEC-481. Project Totals: a project-specific operational ledger built from grouped repository
 * aggregates. The rules it enforces are the point of the module:
 *
 * - Delivered and used are different facts and are never one number. Supplier deliveries and company
 *   (receipt) deliveries of the same catalog item in the same unit are both deliveries to the project,
 *   so they add up to "Delivered". Daily Report material records marked Used, and those marked
 *   Transported, are each their own measure.
 * - Quantities are only added within one unit (by stable unit id). Nothing converts units.
 * - A difference is shown only where the same item has both a delivered and a used quantity in the
 *   same unit, and never while a supplier filter narrows deliveries to one supplier.
 * - Fuel is totalled per fuel type. Construction materials (wall consumption records, Lift actuals,
 *   legacy foundation records) are listed per source and never added across sources or to Daily Report
 *   usage, because the same pour may have been recorded in more than one of them and no record links
 *   one to another.
 */
export type DeliverySource = 'supplier_delivery' | 'company_delivery';
export type UsageMovement = 'used' | 'transported';
export type ConstructionSource = 'wall_consumption' | 'lift_stone' | 'lift_ready_mix' | 'foundation_legacy';

export type DeliveryTotal = { source: DeliverySource; itemKey: string; itemName: string; supplierKey: string; supplierName: string; unitKey: string; unitSymbol: string; quantity: number; recordCount: number };
export type UsageTotal = { movement: UsageMovement; itemKey: string; itemName: string; unitKey: string; unitSymbol: string; quantity: number; recordCount: number };
export type FuelTotal = { fuelType: FuelType; equipmentName: string; litres: number; recordCount: number };
export type ConstructionTotal = { source: ConstructionSource; materialKey: string; materialLabel: string; unitKey: string; unitSymbol: string; quantity: number; recordCount: number };
export type ProjectTotalsData = { deliveries: DeliveryTotal[]; usage: UsageTotal[]; fuel: FuelTotal[]; construction: ConstructionTotal[] };

export type TotalsView = 'all' | 'delivered' | 'used';
export type ProjectTotalsFilters = { fromDate: string; toDate: string; itemKey: string; supplierKey: string; unitKey: string; view: TotalsView };
export const emptyTotalsFilters = (): ProjectTotalsFilters => ({ fromDate: '', toDate: '', itemKey: '', supplierKey: '', unitKey: '', view: 'all' });

export const deliverySourceLabels: Record<DeliverySource, string> = { supplier_delivery: 'Supplier deliveries', company_delivery: 'Company deliveries' };
export const constructionSourceLabels: Record<ConstructionSource, string> = {
  wall_consumption: 'Wall consumption records',
  lift_stone: 'Lift Stone (actual)',
  lift_ready_mix: 'Lift Ready Mix (actual)',
  foundation_legacy: 'Legacy foundation records',
};

export type Measure = { quantity: number; recordCount: number };
export type ItemLedgerUnit = {
  unitKey: string; unitSymbol: string;
  delivered: (Measure & { sources: { source: DeliverySource; quantity: number; recordCount: number }[] }) | null;
  used: Measure | null;
  transported: Measure | null;
  /** Delivered minus recorded use, only when both exist for this item and unit. Not an inventory balance. */
  difference: number | null;
};
export type ItemLedgerSupplier = { supplierKey: string; supplierName: string; source: DeliverySource; units: (Measure & { unitKey: string; unitSymbol: string })[] };
export type ItemLedgerEntry = { itemKey: string; itemName: string; units: ItemLedgerUnit[]; suppliers: ItemLedgerSupplier[]; recordCount: number; usageHiddenBySupplierFilter: boolean };

/** Rounds away binary floating-point noise; recorded quantities carry at most six decimals. */
const clean = (value: number) => Math.round(value * 1e6) / 1e6;
const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const sourceRank: Record<DeliverySource, number> = { supplier_delivery: 0, company_delivery: 1 };
const add = (measure: Measure | null, quantity: number, recordCount: number): Measure => ({ quantity: clean((measure?.quantity ?? 0) + quantity), recordCount: (measure?.recordCount ?? 0) + recordCount });

export function buildItemLedger(data: ProjectTotalsData, filters: ProjectTotalsFilters): ItemLedgerEntry[] {
  const supplierFiltered = Boolean(filters.supplierKey);
  const keep = (row: { itemKey: string; unitKey: string }) => (!filters.itemKey || row.itemKey === filters.itemKey) && (!filters.unitKey || row.unitKey === filters.unitKey);
  const deliveries = filters.view === 'used' ? [] : data.deliveries.filter((row) => keep(row) && (!supplierFiltered || row.supplierKey === filters.supplierKey));
  const usage = filters.view === 'delivered' || supplierFiltered ? [] : data.usage.filter(keep);
  const showTransported = filters.view !== 'used';

  const items = new Map<string, { itemName: string; units: Map<string, ItemLedgerUnit>; suppliers: Map<string, ItemLedgerSupplier>; recordCount: number }>();
  const item = (key: string, name: string) => { const existing = items.get(key); if (existing) return existing; const created = { itemName: name, units: new Map(), suppliers: new Map(), recordCount: 0 }; items.set(key, created); return created; };
  const unit = (entry: ReturnType<typeof item>, key: string, symbol: string) => { const existing = entry.units.get(key); if (existing) return existing; const created: ItemLedgerUnit = { unitKey: key, unitSymbol: symbol, delivered: null, used: null, transported: null, difference: null }; entry.units.set(key, created); return created; };

  for (const row of deliveries) {
    const entry = item(row.itemKey, row.itemName); entry.recordCount += row.recordCount;
    const target = unit(entry, row.unitKey, row.unitSymbol);
    const sources: { source: DeliverySource; quantity: number; recordCount: number }[] = [...(target.delivered?.sources ?? [])];
    const index = sources.findIndex((value) => value.source === row.source);
    if (index >= 0) sources[index] = { source: row.source, ...add(sources[index]!, row.quantity, row.recordCount) };
    else sources.push({ source: row.source, quantity: clean(row.quantity), recordCount: row.recordCount });
    target.delivered = { ...add(target.delivered, row.quantity, row.recordCount), sources: sources.sort((a, b) => sourceRank[a.source] - sourceRank[b.source]) };
    const supplier = entry.suppliers.get(row.supplierKey) ?? { supplierKey: row.supplierKey, supplierName: row.supplierName, source: row.source, units: [] };
    const units = [...supplier.units];
    const at = units.findIndex((value) => value.unitKey === row.unitKey);
    if (at >= 0) units[at] = { ...units[at]!, ...add(units[at]!, row.quantity, row.recordCount) };
    else units.push({ unitKey: row.unitKey, unitSymbol: row.unitSymbol, quantity: clean(row.quantity), recordCount: row.recordCount });
    entry.suppliers.set(row.supplierKey, { ...supplier, units: units.sort((a, b) => byLabel(a.unitSymbol, b.unitSymbol)) });
  }
  for (const row of usage) {
    if (row.movement === 'transported' && !showTransported) continue;
    const entry = item(row.itemKey, row.itemName); entry.recordCount += row.recordCount;
    const target = unit(entry, row.unitKey, row.unitSymbol);
    if (row.movement === 'used') target.used = add(target.used, row.quantity, row.recordCount);
    else target.transported = add(target.transported, row.quantity, row.recordCount);
  }

  return [...items.entries()].map(([itemKey, entry]) => ({
    itemKey, itemName: entry.itemName, recordCount: entry.recordCount, usageHiddenBySupplierFilter: supplierFiltered,
    units: [...entry.units.values()]
      .map((value) => ({ ...value, difference: value.delivered && value.used ? clean(value.delivered.quantity - value.used.quantity) : null }))
      .sort((a, b) => byLabel(a.unitSymbol, b.unitSymbol) || a.unitKey.localeCompare(b.unitKey)),
    suppliers: [...entry.suppliers.values()].sort((a, b) => sourceRank[a.source] - sourceRank[b.source] || byLabel(a.supplierName, b.supplierName)),
  }))
    .filter((entry) => filters.view !== 'used' || entry.units.some((value) => value.used))
    .sort((a, b) => byLabel(a.itemName, b.itemName) || a.itemKey.localeCompare(b.itemKey));
}

export type FuelSummary = { fuelType: FuelType; litres: number; recordCount: number; equipment: { equipmentName: string; litres: number; recordCount: number }[] };

export function summarizeFuel(rows: readonly FuelTotal[]): FuelSummary[] {
  const byType = new Map<FuelType, FuelSummary>();
  for (const row of rows) {
    const current = byType.get(row.fuelType) ?? { fuelType: row.fuelType, litres: 0, recordCount: 0, equipment: [] };
    const equipment = [...current.equipment];
    const at = equipment.findIndex((value) => value.equipmentName === row.equipmentName);
    if (at >= 0) equipment[at] = { equipmentName: row.equipmentName, litres: clean(equipment[at]!.litres + row.litres), recordCount: equipment[at]!.recordCount + row.recordCount };
    else equipment.push({ equipmentName: row.equipmentName, litres: clean(row.litres), recordCount: row.recordCount });
    byType.set(row.fuelType, { ...current, litres: clean(current.litres + row.litres), recordCount: current.recordCount + row.recordCount, equipment: equipment.sort((a, b) => b.litres - a.litres || byLabel(a.equipmentName, b.equipmentName)) });
  }
  return [...byType.values()].sort((a, b) => a.fuelType.localeCompare(b.fuelType));
}

export type ConstructionSummary = { materialKey: string; materialLabel: string; unitKey: string; unitSymbol: string; sources: { source: ConstructionSource; quantity: number; recordCount: number }[] };
const constructionRank: Record<ConstructionSource, number> = { wall_consumption: 0, lift_stone: 1, lift_ready_mix: 2, foundation_legacy: 3 };

export function summarizeConstruction(rows: readonly ConstructionTotal[]): ConstructionSummary[] {
  const groups = new Map<string, ConstructionSummary>();
  for (const row of rows) {
    const key = `${row.materialKey}\u0000${row.unitKey}`;
    const current = groups.get(key) ?? { materialKey: row.materialKey, materialLabel: row.materialLabel, unitKey: row.unitKey, unitSymbol: row.unitSymbol, sources: [] };
    const sources = [...current.sources];
    const at = sources.findIndex((value) => value.source === row.source);
    if (at >= 0) sources[at] = { source: row.source, quantity: clean(sources[at]!.quantity + row.quantity), recordCount: sources[at]!.recordCount + row.recordCount };
    else sources.push({ source: row.source, quantity: clean(row.quantity), recordCount: row.recordCount });
    groups.set(key, { ...current, sources: sources.sort((a, b) => constructionRank[a.source] - constructionRank[b.source]) });
  }
  return [...groups.values()].sort((a, b) => byLabel(a.materialLabel, b.materialLabel) || byLabel(a.unitSymbol, b.unitSymbol));
}

/** A quantity as printed beside its unit: up to three decimals, trailing zeros dropped, never rounded to a false zero. */
export function formatTotalQuantity(quantity: number, unitSymbol: string): string {
  const rounded = Math.round(quantity * 1000) / 1000;
  const text = rounded === 0 && quantity !== 0 ? quantity.toPrecision(2) : String(rounded);
  return `${text} ${unitSymbol}`.trim();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pretty = (value: string) => { const [year, month, day] = value.split('-').map(Number); return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`; };

/** The period every total on the screen covers; always shown next to a total. */
export function describeTotalsRange(fromDate: string, toDate: string): string {
  if (fromDate && toDate) return `${pretty(fromDate)} – ${pretty(toDate)}`;
  if (fromDate) return `From ${pretty(fromDate)}`;
  if (toDate) return `Up to ${pretty(toDate)}`;
  return 'All recorded dates';
}

const validDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
};

export function validateTotalsFilters(filters: ProjectTotalsFilters): string[] {
  if ((filters.fromDate && !validDate(filters.fromDate)) || (filters.toDate && !validDate(filters.toDate))) return ['Enter valid dates.'];
  if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) return ['The start date must be on or before the end date.'];
  return [];
}

export type TotalsChoice = { id: string; label: string };

/** Filter choices drawn from the recorded data itself, so archived items and suppliers stay selectable. */
export function totalsFilterChoices(data: ProjectTotalsData): { items: TotalsChoice[]; suppliers: TotalsChoice[]; units: TotalsChoice[] } {
  const unique = (entries: TotalsChoice[]) => [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort((a, b) => byLabel(a.label, b.label));
  return {
    items: unique([...data.deliveries, ...data.usage].map((row) => ({ id: row.itemKey, label: row.itemName }))),
    suppliers: unique(data.deliveries.map((row) => ({ id: row.supplierKey, label: row.supplierName }))),
    units: unique([...data.deliveries, ...data.usage].map((row) => ({ id: row.unitKey, label: row.unitSymbol }))),
  };
}
