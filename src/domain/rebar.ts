/**
 * The rebar calculator. It only SUGGESTS a weight: a calculated weight is never saved over a weight the owner typed
 * unless the owner taps "Use calculated weight". Everything is calculated at full precision; rounding happens only
 * when a number is shown or when a calculated weight is accepted as the quantity (to 0.1 kg, so the totals add up
 * exactly as printed).
 *
 *   area (mm²)   = π / 4 × d²
 *   kg per meter = area ÷ 1,000,000 × density      (d² ÷ 162 is only a rough check and is not used)
 *   meters       = pieces × length per bar
 *   weight (kg)  = meters × kg per meter
 */
export const DEFAULT_STEEL_DENSITY = 7850;
export const DEFAULT_STEEL_DIAMETERS: readonly number[] = [8, 10, 12, 14, 16, 18, 20, 25, 32];
export const LENGTH_QUICK_CHOICES: readonly number[] = [6, 12];

export type SteelSettings = { densityKgM3: number; diameters: number[] };
export const defaultSteelSettings = (): SteelSettings => ({ densityKgM3: DEFAULT_STEEL_DENSITY, diameters: [...DEFAULT_STEEL_DIAMETERS] });

export type WeightSource = 'typed' | 'calculated';

export function kgPerMeter(diameterMm: number, densityKgM3: number): number {
  return (Math.PI / 4) * diameterMm * diameterMm / 1_000_000 * densityKgM3;
}

export type RebarLineInput = { diameterMm: number; lengthPerBarM: number; pieces: number };
export type RebarLineResult = { kgPerMeter: number; meters: number; weightKg: number };

const positive = (value: number) => Number.isFinite(value) && value > 0;

/** null when the line is incomplete (a missing or non-positive diameter, length or pieces). */
export function calculateRebarLine(input: RebarLineInput, densityKgM3: number): RebarLineResult | null {
  if (!positive(input.diameterMm) || !positive(input.lengthPerBarM) || !positive(input.pieces) || !positive(densityKgM3)) return null;
  const perMeter = kgPerMeter(input.diameterMm, densityKgM3);
  const meters = input.pieces * input.lengthPerBarM;
  return { kgPerMeter: perMeter, meters, weightKg: meters * perMeter };
}

export type RebarTotals = { meters: number; pieces: number; weightKg: number; lines: number };
export function rebarTotals(results: readonly ({ pieces: number } & RebarLineResult)[]): RebarTotals {
  return results.reduce<RebarTotals>((sum, line) => ({ meters: sum.meters + line.meters, pieces: sum.pieces + line.pieces, weightKg: sum.weightKg + line.weightKg, lines: sum.lines + 1 }), { meters: 0, pieces: 0, weightKg: 0, lines: 0 });
}

/** A calculated weight accepted as the quantity is kept to 0.1 kg, exactly as it is printed everywhere. */
export const acceptedWeightKg = (calculatedKg: number) => Math.round(calculatedKg * 10) / 10;

export type WeightDifference = { kg: number; percent: number };
/** used − calculated, and that as a share of the calculated weight. null when there is nothing to compare. */
export function weightDifference(calculatedKg: number | null | undefined, usedKg: number | null | undefined): WeightDifference | null {
  if (calculatedKg == null || usedKg == null || !positive(calculatedKg) || !Number.isFinite(usedKg)) return null;
  const kg = usedKg - calculatedKg;
  return { kg, percent: kg / calculatedKg * 100 };
}

/** "Calculated 451.3 kg, entered 460 kg, difference 8.7 kg (1.9%)"; null when they agree to 0.1 kg or nothing was calculated. */
export function comparisonText(calculatedKg: number | null | undefined, usedKg: number | null | undefined): string | null {
  const difference = weightDifference(calculatedKg, usedKg);
  if (!difference || calculatedKg == null || usedKg == null) return null;
  if (Math.abs(difference.kg) < 0.05) return null;
  return `Calculated ${formatKg(calculatedKg)} kg, entered ${formatKg(usedKg)} kg, difference ${formatKg(Math.abs(difference.kg))} kg (${Math.abs(difference.percent).toFixed(1)}%)`;
}

/** One decimal, trailing ".0" dropped for a whole number typed by the owner (270, not 270.0). */
export function formatKg(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
/** Always one decimal, for the calculator results (185.0). */
export const formatKgFixed = (value: number) => (Math.round(value * 10) / 10).toFixed(1);
export const formatPerMeter = (value: number) => value.toFixed(3);
export const formatMeters = (value: number) => String(Math.round(value * 100) / 100);

/**
 * Shares one supplier total across the items in proportion to their calculated weights, each to 0.1 kg and adding
 * up to the total exactly (the largest remainders take the spare tenths). Returns null when there is nothing to share.
 */
export function splitTotalProportionally(totalKg: number, calculatedKg: readonly number[]): number[] | null {
  const sum = calculatedKg.reduce((a, b) => a + b, 0);
  if (!positive(totalKg) || !calculatedKg.length || !positive(sum) || calculatedKg.some((value) => !(value >= 0))) return null;
  const tenths = Math.round(totalKg * 10);
  const exact = calculatedKg.map((value) => value / sum * tenths);
  const floors = exact.map(Math.floor);
  let spare = tenths - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) { if (spare <= 0) break; floors[index]! += 1; spare -= 1; }
  return floors.map((value) => value / 10);
}

/** "Rebar 12 mm" → 12; "Ø14" or "14mm bar" → 14; null when the name carries no diameter. */
export function diameterFromName(name: string): number | null {
  const match = name.match(/(\d+(?:[.,]\d+)?)\s*mm\b/i) ?? name.match(/[Øø]\s*(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]!.replace(',', '.'));
  return positive(value) ? value : null;
}

/** An item can use the calculator when its category is steel (the category name carries "steel" or "rebar"). */
export const isSteelCategory = (categoryName: string) => /steel|rebar|حديد/i.test(categoryName);

/** True when a weight that came from the calculator no longer matches its inputs, so the app must ask before changing it. */
export function calculatedWeightChanged(source: WeightSource | null | undefined, savedCalculatedKg: number | null | undefined, now: RebarLineResult | null): boolean {
  if (source !== 'calculated' || savedCalculatedKg == null || !now) return false;
  return Math.abs(now.weightKg - savedCalculatedKg) > 1e-6;
}

export function validateSteelSettings(settings: SteelSettings): string[] {
  const issues: string[] = [];
  if (!Number.isFinite(settings.densityKgM3) || settings.densityKgM3 < 1000 || settings.densityKgM3 > 20000) issues.push('Density must be a number of kg/m³ between 1,000 and 20,000.');
  if (!settings.diameters.length) issues.push('Keep at least one diameter in the list.');
  if (settings.diameters.some((value) => !Number.isFinite(value) || value <= 0 || value > 200)) issues.push('Diameters must be numbers of mm between 0 and 200.');
  return issues;
}

/** "8, 10, 12" → [8, 10, 12]: sorted, without duplicates; anything that is not a positive number is dropped. */
export function parseDiameterList(text: string): number[] {
  const values = text.split(/[\s,;]+/).map((part) => Number(part.replace(',', '.'))).filter((value) => positive(value));
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * Typing a weight saves it exactly as typed. When a calculation already exists the weight is marked typed (the calculated
 * figure stays beside it for the comparison); with no calculation nothing about its source changes.
 */
export const sourceAfterTyping = (calculatedWeightKg: string | undefined, source: '' | WeightSource | undefined): '' | WeightSource => (calculatedWeightKg?.trim() ? 'typed' : (source ?? ''));

/** What "Use calculated weight" puts into an item: the calculated weight to 0.1 kg as the quantity, the full-precision figure beside it, source calculated. */
export const calculatedPatch = (calculatedKg: number) => ({ quantity: String(acceptedWeightKg(calculatedKg)), calc: String(calculatedKg), source: 'calculated' as WeightSource });
