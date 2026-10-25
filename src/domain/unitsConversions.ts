/**
 * DEC-526. The small pure rules of the Units & Conversions screen: how a stored quantity reads, what a search matches, how a
 * conversion reads as an equation, and which tab's Add button is available. Nothing here reads or writes data.
 */
import type { ConversionOption, MeasurementUnit } from './loads';

/** A list shows its search field only once it holds more than this many items. */
export const SEARCH_THRESHOLD = 8;
export const needsSearch = (count: number) => count > SEARCH_THRESHOLD;

/** Grouped, trailing-zero-free rendering of a stored quantity, which SQLite keeps as a REAL. */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const [whole = '0', fraction] = Number(value.toFixed(6)).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

const normalise = (value: string) => value.trim().toLocaleLowerCase('en-US');

/** A unit matches by name or symbol; an empty search matches everything. */
export function unitMatches(unit: Pick<MeasurementUnit, 'name' | 'symbol'>, search: string): boolean {
  const query = normalise(search);
  return !query || `${unit.name} ${unit.symbol}`.toLocaleLowerCase('en-US').includes(query);
}

/** A conversion matches by its name or by either unit's name or symbol. */
export function conversionMatches(value: Pick<ConversionOption, 'name' | 'inputUnitName' | 'inputUnitSymbol' | 'outputUnitName' | 'outputUnitSymbol'>, search: string): boolean {
  const query = normalise(search);
  return !query || `${value.name} ${value.inputUnitName} ${value.inputUnitSymbol} ${value.outputUnitName} ${value.outputUnitSymbol}`.toLocaleLowerCase('en-US').includes(query);
}

/** The rule as the screen prints it: "1,000 kg = 1 t". */
export function conversionEquation(value: Pick<ConversionOption, 'inputQuantity' | 'inputUnitSymbol' | 'outputQuantity' | 'outputUnitSymbol'>) {
  const left = formatQuantity(value.inputQuantity), right = formatQuantity(value.outputQuantity);
  return { left, leftSymbol: value.inputUnitSymbol, right, rightSymbol: value.outputUnitSymbol, text: `${left} ${value.inputUnitSymbol} = ${right} ${value.outputUnitSymbol}` };
}

export const decimalsText = (places: number) => `${places} decimal${places === 1 ? '' : 's'}`;

export type UnitsTab = 'units' | 'conversions';

/** What the one fixed Add button says and whether it can be used. A conversion needs at least one active unit to start from. */
export function addAction(tab: UnitsTab, activeUnitCount: number): { label: string; enabled: boolean; hint: string | null } {
  if (tab === 'units') return { label: 'Add unit', enabled: true, hint: null };
  return activeUnitCount > 0
    ? { label: 'Add conversion', enabled: true, hint: null }
    : { label: 'Add conversion', enabled: false, hint: 'Add at least one active unit before creating a conversion.' };
}

/** The label of the collapsed Inactive row, for example "Inactive units · 1". */
export const inactiveLabel = (tab: UnitsTab, count: number) => `Inactive ${tab} · ${count}`;
