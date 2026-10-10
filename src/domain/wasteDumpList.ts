/**
 * The line-by-line list of waste dumps printed in the Daily Report and in the Project Completion report. Only Active
 * dumps reach it (cancelled ones are filtered where the dumps are read), in time order, numbered from 1. The clock
 * time is the device's local time, the same on every page.
 */
export type ListedDump = { id: string; dumpedAt: string; materialType: string; dumpLocation: string; truckPlate: string | null; driverName: string | null; notes?: string | null };

const two = (value: number) => String(value).padStart(2, '0');

/** "07:42" in local time; empty when the stored value is not a date. */
export function clockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function orderedDumps<T extends { id: string; dumpedAt: string }>(dumps: readonly T[]): T[] {
  return [...dumps].sort((a, b) => a.dumpedAt.localeCompare(b.dumpedAt) || a.id.localeCompare(b.id));
}

export type TruckDumps = { truckPlate: string | null; driverName: string | null; count: number; first: string; last: string };

/**
 * One line per truck (by plate; a dump with no plate is grouped by its driver): how many dumps and the first and last time.
 * When more than one driver used a truck, their names are joined; a dump with no driver does not split the line.
 * Most dumps first, then plate.
 */
export function dumpsByTruck(dumps: readonly ListedDump[]): TruckDumps[] {
  const groups = new Map<string, TruckDumps & { drivers: string[] }>();
  for (const dump of orderedDumps(dumps)) {
    const plate = dump.truckPlate?.trim() || null, driver = dump.driverName?.trim() || null;
    const key = plate ? `plate:${plate.toLowerCase()}` : `driver:${(driver ?? '').toLowerCase()}`;
    const time = clockTime(dump.dumpedAt);
    const current = groups.get(key);
    if (current) {
      current.count += 1; current.last = time;
      if (driver && !current.drivers.some((name) => name.toLowerCase() === driver.toLowerCase())) current.drivers.push(driver);
    } else groups.set(key, { truckPlate: plate, driverName: null, drivers: driver ? [driver] : [], count: 1, first: time, last: time });
  }
  return [...groups.values()].map(({ drivers, ...truck }) => ({ ...truck, driverName: drivers.length ? drivers.join(' / ') : null }))
    .sort((a, b) => b.count - a.count || (a.truckPlate ?? '').localeCompare(b.truckPlate ?? '', undefined, { numeric: true }) || (a.driverName ?? '').localeCompare(b.driverName ?? ''));
}

/** "3 trucks · 07:42 to 14:55"; empty when there are no dumps. */
export function dumpsSummaryLine(dumps: readonly ListedDump[]): string {
  if (!dumps.length) return '';
  const ordered = orderedDumps(dumps), trucks = new Set(dumps.map((dump) => (dump.truckPlate?.trim() || '').toLowerCase()));
  const first = clockTime(ordered[0]!.dumpedAt), last = clockTime(ordered[ordered.length - 1]!.dumpedAt);
  return `${trucks.size} truck${trucks.size === 1 ? '' : 's'} · ${first} to ${last}`;
}
