import {fuelDayLabel} from './fuelBatchViews';
import {wasteLocationOf,type WasteDump,type WasteLocationType} from './waste';

/**
 * Waste dump history grouped the way Fuel history groups by day: one group per day, newest first, with the day total; inside a
 * day each project (with its location under it), each driver's dumps in that project, and the project total; then the period
 * totals per driver. A waste dump has no quantity or unit, so every total is a COUNT of dumps. Only Active dumps are ever counted
 * or listed; cancelled ones are counted separately so the screen can say how many were left out.
 */
export type WasteHistoryRow = WasteDump & { projectLocation: string | null };
export type WastePreset = 'week' | 'month' | 'custom';
export type WasteRange = { fromDate: string; toDate: string };

export const NO_DRIVER = 'No driver';

const two = (value: number) => String(value).padStart(2, '0');
const dayKey = (date: Date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
const parse = (day: string) => { const [year = 0, month = 1, date = 1] = day.split('-').map(Number); return new Date(year, month - 1, date); };

/** This week is Monday to Sunday and contains `today`; this month is the calendar month; custom is exactly what was chosen (swapped if reversed). */
export function wasteRangeFor(preset: WastePreset, today: string, custom?: { fromDate?: string; toDate?: string }): WasteRange {
  const now = parse(today);
  if (preset === 'week') {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { fromDate: dayKey(monday), toDate: dayKey(sunday) };
  }
  if (preset === 'month') return { fromDate: dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), toDate: dayKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  const from = custom?.fromDate || '0000-01-01', to = custom?.toDate || '9999-12-31';
  return from <= to ? { fromDate: from, toDate: to } : { fromDate: to, toDate: from };
}

/** "Mon 5 Oct – Sun 11 Oct 2026", or "All dates" for an open custom range. */
export function wasteRangeLabel(range: WasteRange): string {
  const open = (value: string) => value.startsWith('0000') || value.startsWith('9999');
  if (open(range.fromDate) && open(range.toDate)) return 'All dates';
  if (open(range.fromDate)) return `Until ${fuelDayLabel(range.toDate)}`;
  if (open(range.toDate)) return `From ${fuelDayLabel(range.fromDate)}`;
  return `${fuelDayLabel(range.fromDate)} – ${fuelDayLabel(range.toDate)}`;
}

export type WasteDriverLine = { key: string; name: string; count: number };
/** One Location in the history: a project or a company site. `projectName` holds the location's name and `projectId` is null at a site. */
export type WasteProjectBlock = { locationKey: string; locationType: WasteLocationType; projectId: string | null; projectName: string; location: string | null; drivers: WasteDriverLine[]; total: number };
export type WasteDayGroup = { day: string; label: string; total: number; projects: WasteProjectBlock[] };
export type WasteHistory = {
  range: WasteRange;
  days: WasteDayGroup[];
  /** Each driver inside each project over the whole period. */
  periodProjects: WasteProjectBlock[];
  /** Each driver over all projects. */
  periodDrivers: WasteDriverLine[];
  total: number;
  /** Cancelled dumps inside the range and filter: not counted anywhere. */
  cancelledCount: number;
};

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const driverKey = (row: WasteHistoryRow) => row.driverProfileId ?? (row.driverName?.trim() ? `name:${row.driverName.trim().toLowerCase()}` : 'none');
const driverName = (row: WasteHistoryRow) => row.driverName?.trim() || NO_DRIVER;

function blocks(rows: readonly WasteHistoryRow[]): WasteProjectBlock[] {
  const projects = new Map<string, { block: WasteProjectBlock; drivers: Map<string, WasteDriverLine> }>();
  for (const row of rows) {
    const where = wasteLocationOf(row);
    const entry = projects.get(where.key) ?? { block: { locationKey: where.key, locationType: where.type, projectId: row.projectId, projectName: where.name, location: row.projectLocation?.trim() || null, drivers: [], total: 0 }, drivers: new Map() };
    const line = entry.drivers.get(driverKey(row)) ?? { key: driverKey(row), name: driverName(row), count: 0 };
    line.count += 1;
    // A driver whose name was typed on some dumps and not on others keeps the name that was typed.
    if (line.name === NO_DRIVER && driverName(row) !== NO_DRIVER) line.name = driverName(row);
    entry.drivers.set(line.key, line);
    entry.block.total += 1;
    projects.set(where.key, entry);
  }
  return [...projects.values()].map(({ block, drivers }) => ({ ...block, drivers: [...drivers.values()].sort((a, b) => b.count - a.count || byName(a.name, b.name)) }))
    .sort((a, b) => byName(a.projectName, b.projectName));
}

/** `scope` is a Location key (`project:<id>` or `site:<id>`); a bare project id still works. */
export function buildWasteHistory(rows: readonly WasteHistoryRow[], range: WasteRange, scope?: string): WasteHistory {
  const key = scope && !scope.includes(':') ? `project:${scope}` : scope;
  const inScope = rows.filter((row) => row.workDate >= range.fromDate && row.workDate <= range.toDate && (!key || wasteLocationOf(row).key === key));
  const active = inScope.filter((row) => row.status === 'Active');
  const days = new Map<string, WasteHistoryRow[]>();
  for (const row of active) days.set(row.workDate, [...(days.get(row.workDate) ?? []), row]);
  const dayGroups = [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, dayRows]): WasteDayGroup => ({ day, label: fuelDayLabel(day), total: dayRows.length, projects: blocks(dayRows) }));
  const drivers = new Map<string, WasteDriverLine>();
  for (const row of active) {
    const line = drivers.get(driverKey(row)) ?? { key: driverKey(row), name: driverName(row), count: 0 };
    line.count += 1;
    if (line.name === NO_DRIVER && driverName(row) !== NO_DRIVER) line.name = driverName(row);
    drivers.set(line.key, line);
  }
  return {
    range, days: dayGroups, periodProjects: blocks(active),
    periodDrivers: [...drivers.values()].sort((a, b) => b.count - a.count || byName(a.name, b.name)),
    total: active.length, cancelledCount: inScope.length - active.length,
  };
}

export const dumpsText = (count: number) => `${count} dump${count === 1 ? '' : 's'}`;
