/**
 * The name on my loads. A company load saves the company name, and the company details, it was issued with. PDFs and Excel
 * always print the CURRENT Plant Company name; this is the explicit one-time action that also updates what is saved on the
 * loads (cancelled and archived loads included, so the history reads the same). It never touches customer names, outside
 * supplier names, load numbers, quantities, prices, payments, signatures or dates.
 */
export type CompanyDetails = { address: string | null; phone: string | null; email: string | null; taxVatNumber: string | null; receiptFooter: string | null };
export const emptyCompanyDetails: CompanyDetails = { address: null, phone: null, email: null, taxVatNumber: null, receiptFooter: null };

/** Trimmed; blank is the same as nothing. */
const normal = (value: string | null | undefined) => value?.trim() || null;

export function detailsDiffer(saved: CompanyDetails, current: CompanyDetails): boolean {
  return (['address', 'phone', 'email', 'taxVatNumber', 'receiptFooter'] as const).some((key) => normal(saved[key]) !== normal(current[key]));
}

export type LoadNameGroup = { oldName: string; count: number; /** The name is already current; only the saved details differ. */ detailsOnly: boolean };
export type LoadNameStatus = { currentName: string; totalLoads: number; groups: LoadNameGroup[]; needing: number };

type LoadFacts = { id: string; companyName: string } & CompanyDetails;

/** Which loads would change, grouped by the name they carry. A name that differs always counts; the details count only when asked for. */
export function planLoadNameUpdate(loads: readonly LoadFacts[], currentName: string, currentDetails: CompanyDetails, includeDetails: boolean): { status: LoadNameStatus; ids: string[] } {
  const target = currentName.trim();
  const groups = new Map<string, LoadNameGroup>();
  const ids: string[] = [];
  for (const load of loads) {
    const nameDiffers = load.companyName.trim() !== target;
    const detailsOnly = !nameDiffers && includeDetails && detailsDiffer(load, currentDetails);
    if (!nameDiffers && !detailsOnly) continue;
    ids.push(load.id);
    const label = load.companyName.trim() || '(no name saved)';
    const key = `${detailsOnly ? 'details' : 'name'}\u0000${label}`;
    const group = groups.get(key) ?? { oldName: label, count: 0, detailsOnly };
    group.count += 1; groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => Number(a.detailsOnly) - Number(b.detailsOnly) || b.count - a.count || a.oldName.localeCompare(b.oldName));
  return { status: { currentName: target, totalLoads: loads.length, groups: ordered, needing: ids.length }, ids };
}

export type LoadNameUpdateInput = { includeDetails: boolean; note: string };
export type LoadNameUpdateRecord = { id: string; updatedAt: string; oldName: string; newName: string; loadsCount: number; detailsIncluded: boolean; note: string | null; detailsOnly: boolean };

export function validateLoadNameUpdate(currentName: string, input: LoadNameUpdateInput): string[] {
  const issues: string[] = [];
  if (!currentName.trim()) issues.push('Save the Plant Company name first.');
  if (input.note.trim().length > 300) issues.push('The note can be at most 300 characters.');
  return issues;
}
