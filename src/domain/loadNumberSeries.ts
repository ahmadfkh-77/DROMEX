/**
 * DEC-487 (6)-(7), DEC-491. Company Load Number Series.
 *
 * Every company load confirmed from this release carries one generated load number, taken from the series its item is assigned to, or from the default `LOAD`
 * series when the item has none (or its series is inactive). The number belongs to the load forever:
 * corrections, cancellation, restore and later configuration never change or reuse it. Loads confirmed
 * before series existed keep no number and are labelled as legacy -- nothing is backfilled.
 *
 * DEC-491. Numbers issued by builds 23 to 25 are `{PREFIX}-{YYYY}-{NNN}` and stay exactly as issued. New
 * numbers are `{PREFIX}-{NNNNN}`: a five-digit lifetime count per series that never restarts, which
 * continues from the number of loads the series had already issued.
 *
 * A load number is a separate identifier from the transaction number shared by the Receipt and the
 * Delivery Authorization (DEC-107), and from supplier references, invoices and bills.
 */
export type LoadNumberSeries = {
  id: string;
  prefix: string;
  displayName: string;
  isDefault: boolean;
  isActive: boolean;
  /** Loads already carrying a number from this series' prefix. */
  issuedCount: number;
  /** A prefix that loads already carry can no longer be edited. */
  prefixLocked: boolean;
  itemIds: string[];
  /** The number the next load in this series would receive in the listed year. */
  nextNumber: string;
  createdAt: string;
  updatedAt: string;
};

export type LoadNumberSeriesDraft = { prefix: string; displayName: string; itemIds: string[] };
export type LoadNumberPreview = { seriesId: string; prefix: string; displayName: string; loadNumber: string };

export const LEGACY_LOAD_NUMBER_LABEL = 'Legacy load — no generated load number';
export const DEFAULT_SERIES_ID = 'series_load';
export const SERIES_NAME_MAX = 60;

export function normalizeSeriesPrefix(value: string): string {
  return value.trim().toLocaleUpperCase('en-US');
}

/** DEC-491. The number a load receives now: prefix and a five-digit lifetime count, widening past 99999. */
export function formatSeriesNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(5, '0')}`;
}

/** The PREFIX-YEAR-NNN format issued by builds 23 to 25 (DEC-487). Kept for those numbers and their tests. */
export function formatLoadNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(3, '0')}`;
}

/** What every screen and export prints for a load's number. */
export function loadNumberLabel(loadNumber: string | null | undefined): string {
  return loadNumber || LEGACY_LOAD_NUMBER_LABEL;
}

/** The calendar year of a `YYYY-MM-DD` record date (or an ISO date-time). */
export function recordYear(recordDate: string): number {
  const year = Number(recordDate.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error('The load record date is not valid.');
  return year;
}

export function validateSeriesDraft(draft: Pick<LoadNumberSeriesDraft, 'prefix' | 'displayName'>, existing: readonly { id: string; prefix: string }[], editingId?: string): string[] {
  const issues: string[] = [];
  const prefix = normalizeSeriesPrefix(draft.prefix);
  if (!/^[A-Z]{2,5}$/.test(prefix)) issues.push('The prefix must be 2 to 5 letters A–Z.');
  else if (existing.some((series) => series.id !== editingId && normalizeSeriesPrefix(series.prefix) === prefix)) issues.push(`Another series already uses the prefix ${prefix}.`);
  const name = draft.displayName.trim().replace(/\s+/g, ' ');
  if (!name) issues.push('Enter a display name.');
  else if (name.length > SERIES_NAME_MAX) issues.push(`The display name must be ${SERIES_NAME_MAX} characters or fewer.`);
  return issues;
}
