/**
 * DEC-476. The People directory: one record per person, each with exactly one current directory role.
 *
 * Workers, Drivers and Operators used to be separate lists. They are now one table (the legacy
 * `driver_profiles` table, which keeps its name so every existing foreign key stays valid), so a
 * person whose job changes is edited, not duplicated. Historical records never read the current role:
 * a Daily Report stores the name inside the Workers, Drivers or Operators list it was selected into,
 * and a receipt stores its own role snapshot (DEC-477).
 */
export type PersonRole = 'worker' | 'driver' | 'operator';
export const personRoles: readonly PersonRole[] = ['worker', 'driver', 'operator'];
export const personRoleLabels: Record<PersonRole, string> = { worker: 'Worker', driver: 'Driver', operator: 'Operator' };
export const personRolePluralLabels: Record<PersonRole, string> = { worker: 'Workers', driver: 'Drivers', operator: 'Operators' };

/** One entry in a person's role history, appended by the repository whenever the role changes. */
export type PersonRoleChange = { changedAt: string; fromRole: PersonRole; toRole: PersonRole };

export type PersonProfile = {
  id: string;
  name: string;
  role: PersonRole;
  /** A trade or position such as Mason or Site foreman. Free text, never a directory role. */
  jobTitle: string | null;
  phone: string | null;
  licenseNumber: string | null;
  notes: string | null;
  isActive: boolean;
  roleHistory: PersonRoleChange[];
  createdAt: string;
  updatedAt: string;
};

export type PersonDraft = {
  name: string;
  role: PersonRole;
  jobTitle?: string;
  phone?: string;
  licenseNumber?: string;
  notes?: string;
};

export const PERSON_NAME_MAX = 80;

/** The stored display form of a name: trimmed with internal whitespace collapsed; case is kept. */
export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * The duplicate-detection key: the display form, case-folded. It is the same rule customer and
 * consulting-agency duplicate detection already use (domain/profiles.ts), so two spellings that
 * differ only by case or spacing are one person.
 */
export function personNameKey(value: string): string {
  return normalizePersonName(value).toLocaleLowerCase('en-US');
}

export function isPersonRole(value: unknown): value is PersonRole {
  return value === 'worker' || value === 'driver' || value === 'operator';
}

export function validatePersonDraft(draft: PersonDraft): string[] {
  const issues: string[] = [];
  const name = normalizePersonName(draft.name);
  if (!name) issues.push('Name is required.');
  else if (name.length > PERSON_NAME_MAX) issues.push(`Name must be ${PERSON_NAME_MAX} characters or fewer.`);
  if (!isPersonRole(draft.role)) issues.push('Choose Worker, Driver, or Operator.');
  return issues;
}

/**
 * The person a draft would duplicate, whatever that person's role or active state, or null.
 *
 * Duplicates that already existed before the directories were unified (a worker and a driver who
 * share a name) are kept rather than merged, because merging would decide on the Owner's behalf that
 * two records are one human being. Such a person can still be edited as long as the name itself is
 * not changed into a collision, which is why an unchanged name is always accepted while editing.
 */
export function findPersonNameConflict(draft: Pick<PersonDraft, 'name'> & Partial<PersonDraft>, people: readonly PersonProfile[], editingId?: string | null): PersonProfile | null {
  const key = personNameKey(draft.name);
  if (!key) return null;
  if (editingId) {
    const current = people.find((person) => person.id === editingId);
    if (current && personNameKey(current.name) === key) return null;
  }
  return people.find((person) => person.id !== editingId && personNameKey(person.name) === key) ?? null;
}

/** People who share a normalized name with someone else: legacy duplicates the UI flags for review. */
export function possibleDuplicatePersonIds(people: readonly PersonProfile[]): Set<string> {
  const byKey = new Map<string, string[]>();
  for (const person of people) {
    const key = personNameKey(person.name);
    byKey.set(key, [...(byKey.get(key) ?? []), person.id]);
  }
  return new Set([...byKey.values()].filter((ids) => ids.length > 1).flat());
}

export type PeopleRoleFilter = 'all' | PersonRole;

const digits = (value: string | null) => (value ?? '').replace(/\D/g, '');

/** Role filter plus a search across name, job title, phone (digits only) and licence. */
export function filterPeople(people: readonly PersonProfile[], filter: PeopleRoleFilter, query: string): PersonProfile[] {
  const text = query.trim().toLocaleLowerCase('en-US');
  const queryDigits = digits(query);
  return people.filter((person) => {
    if (filter !== 'all' && person.role !== filter) return false;
    if (!text) return true;
    const haystack = [person.name, person.jobTitle, person.phone, person.licenseNumber].filter(Boolean).join(' ').toLocaleLowerCase('en-US');
    if (haystack.includes(text)) return true;
    return queryDigits.length >= 3 && digits(person.phone).includes(queryDigits);
  });
}

/** Active people per role, for the filter chips. Inactive people are listed separately. */
export function peopleRoleCounts(people: readonly PersonProfile[]): Record<PeopleRoleFilter, number> {
  const active = people.filter((person) => person.isActive);
  return {
    all: active.length,
    worker: active.filter((person) => person.role === 'worker').length,
    driver: active.filter((person) => person.role === 'driver').length,
    operator: active.filter((person) => person.role === 'operator').length,
  };
}

/** The confirmation shown before a role change is saved, or null when the role is unchanged. */
export function describeRoleChange(person: Pick<PersonProfile, 'name' | 'role'>, nextRole: PersonRole): string | null {
  if (person.role === nextRole) return null;
  return `${normalizePersonName(person.name)} will move from ${personRoleLabels[person.role]} to ${personRoleLabels[nextRole]}. `
    + `New selections will offer this person as ${personRoleLabels[nextRole] === 'Operator' ? 'an' : 'a'} ${personRoleLabels[nextRole]}. `
    + `Existing Daily Reports and receipts keep the role recorded when they were made.`;
}

/** DEC-477. The two roles a person driving a truck on a receipt can hold. */
export type TruckCrewRole = 'driver' | 'operator';

export function isTruckCrewEligible(person: Pick<PersonProfile, 'role' | 'isActive'>): boolean {
  return person.isActive && (person.role === 'driver' || person.role === 'operator');
}

/**
 * How a receipt names the role its person served in. A receipt made before DEC-477 has no role
 * snapshot; it is shown as Driver because the field could only ever hold a Driver at that time.
 */
export function truckCrewRoleLabel(role: TruckCrewRole | null | undefined): 'Driver' | 'Operator' {
  return role === 'operator' ? 'Operator' : 'Driver';
}
