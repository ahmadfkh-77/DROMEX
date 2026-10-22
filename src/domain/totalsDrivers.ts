import type {CompanyTotalsRecord} from '../data/repositories/CompanyTotalsRepository';

/**
 * Totals PDF, driver filter. A company load stores its driver as a text snapshot (a saved driver or a name typed for that
 * load), so drivers are told apart by that name, ignoring case and surrounding spaces (the same rule the totals query uses). The filter only changes which company loads
 * are listed and, when the Owner asks for it, the one Total number; no record is changed.
 */
export type DriverChoice = {key: string; name: string; plates: string[]; loadCount: number};

/** 'Not recorded' loads have no driver: they can never be ticked, so they are never listed on a driver PDF. */
export const driverKeyOf = (name: string | null | undefined): string => (name ?? '').trim().toLowerCase();

export const isCompanyLoadRecord = (record: CompanyTotalsRecord): boolean => record.snapshot.recordType === 'company_load';

/** The drivers who drove the Active company loads in these records, most loads first, then by name. */
export function driverChoices(records: readonly CompanyTotalsRecord[]): DriverChoice[] {
  const byKey = new Map<string, DriverChoice>();
  for (const record of records) {
    if (!isCompanyLoadRecord(record) || record.status === 'Cancelled') continue;
    const name = (record.details?.driverName ?? '').trim();
    const key = driverKeyOf(name);
    if (!key) continue;
    const entry = byKey.get(key) ?? {key, name, plates: [], loadCount: 0};
    entry.loadCount += 1;
    const plate = (record.details?.truckPlate ?? '').trim();
    if (plate && !entry.plates.includes(plate)) entry.plates.push(plate);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.loadCount - a.loadCount || a.name.localeCompare(b.name));
}

/** Active company loads of the ticked drivers. An empty selection keeps every record, as the PDF works without the filter. */
export function recordsOfDrivers(records: readonly CompanyTotalsRecord[], keys: readonly string[]): CompanyTotalsRecord[] {
  if (!keys.length) return [...records];
  const wanted = new Set(keys);
  return records.filter((record) => isCompanyLoadRecord(record) && wanted.has(driverKeyOf(record.details?.driverName)));
}

/** "Walid Khoury, Ali Kazem, Rami Saleh" in the order the choices are listed; an unknown key is skipped. */
export function driverNamesLabel(choices: readonly DriverChoice[], keys: readonly string[]): string {
  const wanted = new Set(keys);
  return choices.filter((choice) => wanted.has(choice.key)).map((choice) => choice.name).join(', ');
}

export type DriverGroup = {key: string; name: string; plates: string[]; records: CompanyTotalsRecord[]};

/** The listed loads grouped by driver, oldest first inside each group, groups in name order. */
export function groupRecordsByDriver(records: readonly CompanyTotalsRecord[]): DriverGroup[] {
  const groups = new Map<string, DriverGroup>();
  for (const record of records) {
    const name = (record.details?.driverName ?? '').trim();
    const key = driverKeyOf(name);
    const group = groups.get(key) ?? {key, name: name || 'No driver recorded', plates: [], records: []};
    group.records.push(record);
    const plate = (record.details?.truckPlate ?? '').trim();
    if (plate && !group.plates.includes(plate)) group.plates.push(plate);
    groups.set(key, group);
  }
  const byTime = (a: CompanyTotalsRecord, b: CompanyTotalsRecord) => a.snapshot.recordedAt.localeCompare(b.snapshot.recordedAt) || a.snapshot.reference.localeCompare(b.snapshot.reference, undefined, {numeric: true});
  return [...groups.values()].map((group) => ({...group, records: [...group.records].sort(byTime)})).sort((a, b) => a.name.localeCompare(b.name));
}
