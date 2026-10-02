import type {InclusionCounts,InclusionFilter} from './businessDocuments';
export {summarizeInclusionCounts} from './businessDocuments';
export type {InclusionCounts} from './businessDocuments';

/**
 * DEC-487 (1). Home → Totals (company-wide), Project → Totals and Company Load Totals.
 *
 * These are live views over the canonical records and never store a figure. The rules:
 * - Delivered = Active Supplier Loads + Active, non-archived company loads. Used (and Transported) come
 *   from Daily Report material lines. Delivered and used are separate measures, never one number.
 * - Quantities are added only within one unit (stable unit key); nothing converts units.
 * - A company load is shown as "Company loads — own deliveries", never as a supplier; a company load with
 *   no project sits under "No project — direct customer deliveries". Use is not recorded per supplier,
 *   so it is shown at material and project level only.
 * - Each record is counted in exactly one leaf (material, project, supplier, unit), so every level adds
 *   up to the level above it.
 * - Recorded value adds only priced records and always says how many were unpriced.
 * - Inclusion counts come from the shared document links (DEC-487 (3)).
 */
export const NO_PROJECT_KEY = '__none__';
export const NO_PROJECT_LABEL = 'No project — direct customer deliveries';
export const COMPANY_SUPPLIER_KEY = 'company';
export const COMPANY_SUPPLIER_LABEL = 'Company loads — own deliveries';
export const LEGACY_SERIES_KEY = 'legacy';
export const LEGACY_SERIES_LABEL = 'Legacy loads — no generated load number';

export type TotalsView = 'all' | 'delivered' | 'used';
export type CompanyTotalsFilters = {
  fromDate: string; toDate: string; itemKey: string;
  /** A project id, NO_PROJECT_KEY, or '' for all projects. */
  projectKey: string;
  /** 'id:<supplier>', COMPANY_SUPPLIER_KEY, or '' for all. */
  supplierKey: string;
  unitKey: string; view: TotalsView;
  /** A series id, LEGACY_SERIES_KEY, or ''. Narrows to company loads. */
  seriesId: string;
  inclusion: InclusionFilter;
};
export const emptyCompanyTotalsFilters = (): CompanyTotalsFilters => ({ fromDate: '', toDate: '', itemKey: '', projectKey: '', supplierKey: '', unitKey: '', view: 'all', seriesId: '', inclusion: 'all' });

export type DeliverySource = 'supplier_delivery' | 'company_delivery';
export type CompanyDeliveryRow = {
  source: DeliverySource; itemKey: string; itemName: string; projectKey: string; projectName: string;
  supplierKey: string; supplierName: string; unitKey: string; unitSymbol: string;
  quantity: number; recordCount: number; valueCents: number | null; pricedCount: number; inclusion: InclusionCounts;
};
export type CompanyUsageRow = { movement: 'used' | 'transported'; itemKey: string; itemName: string; projectKey: string; projectName: string; unitKey: string; unitSymbol: string; quantity: number; recordCount: number };
export type CompanyTotalsData = { deliveries: CompanyDeliveryRow[]; usage: CompanyUsageRow[]; usageHiddenReason: string | null };

export type Measure = { quantity: number; recordCount: number };
export type UnitMeasures = { unitKey: string; unitSymbol: string; delivered: Measure | null; used: Measure | null; transported: Measure | null };
export type RecordedValue = { totalCents: number | null; pricedCount: number; unpricedCount: number };
export type SupplierNode = { supplierKey: string; supplierName: string; source: DeliverySource; units: (Measure & { unitKey: string; unitSymbol: string })[]; value: RecordedValue; inclusion: InclusionCounts };
export type ProjectNode = { projectKey: string; projectName: string; units: UnitMeasures[]; value: RecordedValue; inclusion: InclusionCounts; suppliers: SupplierNode[] };
export type MaterialNode = { itemKey: string; itemName: string; units: UnitMeasures[]; value: RecordedValue; inclusion: InclusionCounts; projects: ProjectNode[] };

const clean = (value: number) => Math.round(value * 1e6) / 1e6;
const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
export const emptyInclusion = (): InclusionCounts => ({ total: 0, included: 0, inDraft: 0, open: 0, includedIn: [] });
const addInclusion = (a: InclusionCounts, b: InclusionCounts): InclusionCounts => ({ total: a.total + b.total, included: a.included + b.included, inDraft: a.inDraft + b.inDraft, open: a.open + b.open, includedIn: [...new Set([...a.includedIn, ...b.includedIn])].sort() });
const emptyValue = (): RecordedValue => ({ totalCents: null, pricedCount: 0, unpricedCount: 0 });
const addValue = (value: RecordedValue, row: CompanyDeliveryRow): RecordedValue => ({ totalCents: row.valueCents == null ? value.totalCents : (value.totalCents ?? 0) + row.valueCents, pricedCount: value.pricedCount + row.pricedCount, unpricedCount: value.unpricedCount + row.recordCount - row.pricedCount });
const addMeasure = (measure: Measure | null, quantity: number, recordCount: number): Measure => ({ quantity: clean((measure?.quantity ?? 0) + quantity), recordCount: (measure?.recordCount ?? 0) + recordCount });

function unitOf(units: Map<string, UnitMeasures>, key: string, symbol: string): UnitMeasures {
  const existing = units.get(key); if (existing) return existing;
  const created: UnitMeasures = { unitKey: key, unitSymbol: symbol, delivered: null, used: null, transported: null }; units.set(key, created); return created;
}
const sortUnits = <T extends { unitSymbol: string; unitKey: string }>(values: Iterable<T>) => [...values].sort((a, b) => byLabel(a.unitSymbol, b.unitSymbol) || a.unitKey.localeCompare(b.unitKey));
const projectOrder = (a: { projectKey: string; projectName: string }, b: { projectKey: string; projectName: string }) => Number(a.projectKey === NO_PROJECT_KEY) - Number(b.projectKey === NO_PROJECT_KEY) || byLabel(a.projectName, b.projectName);

/** Material → Project → Supplier, hiding anything with no records. */
export function buildMaterialTree(data: CompanyTotalsData): MaterialNode[] {
  type P = { projectName: string; units: Map<string, UnitMeasures>; value: RecordedValue; inclusion: InclusionCounts; suppliers: Map<string, SupplierNode> };
  type M = { itemName: string; units: Map<string, UnitMeasures>; value: RecordedValue; inclusion: InclusionCounts; projects: Map<string, P> };
  const items = new Map<string, M>();
  const material = (key: string, name: string) => { const found = items.get(key); if (found) return found; const made: M = { itemName: name, units: new Map(), value: emptyValue(), inclusion: emptyInclusion(), projects: new Map() }; items.set(key, made); return made; };
  const project = (entry: M, key: string, name: string) => { const found = entry.projects.get(key); if (found) return found; const made: P = { projectName: name, units: new Map(), value: emptyValue(), inclusion: emptyInclusion(), suppliers: new Map() }; entry.projects.set(key, made); return made; };
  for (const row of data.deliveries) {
    const item = material(row.itemKey, row.itemName); const place = project(item, row.projectKey, row.projectName);
    for (const target of [unitOf(item.units, row.unitKey, row.unitSymbol), unitOf(place.units, row.unitKey, row.unitSymbol)]) target.delivered = addMeasure(target.delivered, row.quantity, row.recordCount);
    item.value = addValue(item.value, row); place.value = addValue(place.value, row);
    item.inclusion = addInclusion(item.inclusion, row.inclusion); place.inclusion = addInclusion(place.inclusion, row.inclusion);
    const supplier = place.suppliers.get(row.supplierKey) ?? { supplierKey: row.supplierKey, supplierName: row.supplierName, source: row.source, units: [], value: emptyValue(), inclusion: emptyInclusion() };
    const units = [...supplier.units]; const at = units.findIndex((value) => value.unitKey === row.unitKey);
    if (at >= 0) units[at] = { ...units[at]!, ...addMeasure(units[at]!, row.quantity, row.recordCount) };
    else units.push({ unitKey: row.unitKey, unitSymbol: row.unitSymbol, quantity: clean(row.quantity), recordCount: row.recordCount });
    place.suppliers.set(row.supplierKey, { ...supplier, units: sortUnits(units), value: addValue(supplier.value, row), inclusion: addInclusion(supplier.inclusion, row.inclusion) });
  }
  for (const row of data.usage) {
    const item = material(row.itemKey, row.itemName); const place = project(item, row.projectKey, row.projectName);
    for (const target of [unitOf(item.units, row.unitKey, row.unitSymbol), unitOf(place.units, row.unitKey, row.unitSymbol)]) {
      if (row.movement === 'used') target.used = addMeasure(target.used, row.quantity, row.recordCount);
      else target.transported = addMeasure(target.transported, row.quantity, row.recordCount);
    }
  }
  return [...items.entries()].map(([itemKey, entry]) => ({
    itemKey, itemName: entry.itemName, units: sortUnits(entry.units.values()), value: entry.value, inclusion: entry.inclusion,
    projects: [...entry.projects.entries()].map(([projectKey, place]) => ({
      projectKey, projectName: place.projectName, units: sortUnits(place.units.values()), value: place.value, inclusion: place.inclusion,
      suppliers: [...place.suppliers.values()].sort((a, b) => Number(a.source === 'company_delivery') - Number(b.source === 'company_delivery') || byLabel(a.supplierName, b.supplierName)),
    })).sort(projectOrder),
  })).sort((a, b) => byLabel(a.itemName, b.itemName) || a.itemKey.localeCompare(b.itemKey));
}

/** How many filters narrow the totals; a From/To range counts once. */
export function countCompanyFilters(filters: CompanyTotalsFilters): number {
  return [filters.fromDate || filters.toDate, filters.itemKey, filters.projectKey, filters.supplierKey, filters.unitKey, filters.view !== 'all', filters.seriesId, filters.inclusion !== 'all'].filter(Boolean).length;
}

// ---- Company Load Totals ------------------------------------------------------------------------

export type CompanyLoadTotalRow = {
  seriesKey: string; seriesLabel: string; itemKey: string; itemName: string; projectKey: string; projectName: string;
  unitKey: string; unitSymbol: string; status: 'Active' | 'Cancelled'; quantity: number; loadCount: number;
};
export type UnitQuantity = { unitKey: string; unitSymbol: string; quantity: number; loadCount: number };
export type CompanyLoadProjectNode = { projectKey: string; projectName: string; loadCount: number; units: UnitQuantity[]; cancelledCount: number };
export type CompanyLoadGroupNode = { key: string; label: string; loadCount: number; units: UnitQuantity[]; cancelledCount: number; cancelledUnits: UnitQuantity[]; projects: CompanyLoadProjectNode[] };

/**
 * Company Load Totals: Series (or Item) → Project. Active loads make the totals; cancelled loads are
 * counted beside them and never added in. Units stay separate.
 */
export function buildCompanyLoadTree(rows: readonly CompanyLoadTotalRow[], groupBy: 'series' | 'item'): CompanyLoadGroupNode[] {
  const groups = new Map<string, { label: string; units: Map<string, UnitQuantity>; cancelled: Map<string, UnitQuantity>; projects: Map<string, { projectName: string; units: Map<string, UnitQuantity>; cancelledCount: number }> }>();
  const add = (map: Map<string, UnitQuantity>, row: CompanyLoadTotalRow) => { const found = map.get(row.unitKey) ?? { unitKey: row.unitKey, unitSymbol: row.unitSymbol, quantity: 0, loadCount: 0 }; map.set(row.unitKey, { ...found, quantity: clean(found.quantity + row.quantity), loadCount: found.loadCount + row.loadCount }); };
  for (const row of rows) {
    const key = groupBy === 'series' ? row.seriesKey : row.itemKey;
    const group = groups.get(key) ?? { label: groupBy === 'series' ? row.seriesLabel : row.itemName, units: new Map(), cancelled: new Map(), projects: new Map() };
    groups.set(key, group);
    const place = group.projects.get(row.projectKey) ?? { projectName: row.projectName, units: new Map(), cancelledCount: 0 };
    group.projects.set(row.projectKey, place);
    if (row.status === 'Active') { add(group.units, row); add(place.units, row); }
    else { add(group.cancelled, row); place.cancelledCount += row.loadCount; }
  }
  const count = (map: Map<string, UnitQuantity>) => [...map.values()].reduce((sum, value) => sum + value.loadCount, 0);
  return [...groups.entries()].map(([key, group]) => ({
    key, label: group.label, loadCount: count(group.units), units: sortUnits(group.units.values()), cancelledCount: count(group.cancelled), cancelledUnits: sortUnits(group.cancelled.values()),
    projects: [...group.projects.entries()].map(([projectKey, place]) => ({ projectKey, projectName: place.projectName, loadCount: count(place.units), units: sortUnits(place.units.values()), cancelledCount: place.cancelledCount }))
      .filter((place) => place.loadCount || place.cancelledCount).sort(projectOrder),
  })).sort((a, b) => Number(a.key === LEGACY_SERIES_KEY) - Number(b.key === LEGACY_SERIES_KEY) || byLabel(a.label, b.label));
}

/** Records, document status and recorded value across every material. Quantities are never added here: materials differ. */
export function treeTotals(tree: readonly MaterialNode[]): { materialCount: number; inclusion: InclusionCounts; value: RecordedValue } {
  let inclusion = emptyInclusion(); let value = emptyValue();
  for (const item of tree) {
    inclusion = addInclusion(inclusion, item.inclusion);
    value = { totalCents: item.value.totalCents == null ? value.totalCents : (value.totalCents ?? 0) + item.value.totalCents, pricedCount: value.pricedCount + item.value.pricedCount, unpricedCount: value.unpricedCount + item.value.unpricedCount };
  }
  return { materialCount: tree.length, inclusion, value };
}

/**
 * DEC-481's "Delivered minus recorded use", per unit, only where that unit has both measures. It is not
 * an inventory balance: only what was recorded as delivered and as used.
 */
export function unitDifferences(units: readonly UnitMeasures[]): { unitKey: string; unitSymbol: string; difference: number }[] {
  return units.filter((unit) => unit.delivered && unit.used).map((unit) => ({ unitKey: unit.unitKey, unitSymbol: unit.unitSymbol, difference: clean(unit.delivered!.quantity - unit.used!.quantity) }));
}
