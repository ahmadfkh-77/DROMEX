/**
 * DEC-478. Owner-defined resource directories such as Engineers, Surveyors, Pickups or Generators.
 *
 * The first version is deliberately small: a directory has a name and an optional description, and
 * each entry has a name, an optional identifier and optional notes. There are no custom fields. Both
 * live in two generic tables linked by stable ids; no directory ever gets a table of its own.
 */
export type CustomDirectory = {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomDirectoryEntry = {
  id: string;
  directoryId: string;
  name: string;
  identifier: string | null;
  notes: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** One active directory and its active entries: what a new Daily Report may select from. */
export type CustomDirectoryOption = { directory: CustomDirectory; entries: CustomDirectoryEntry[] };

export type CustomDirectoryDraft = { name: string; description?: string };
export type CustomDirectoryEntryDraft = { name: string; identifier?: string; notes?: string };

export const CUSTOM_DIRECTORY_NAME_MAX = 60;
export const CUSTOM_DIRECTORY_DESCRIPTION_MAX = 200;
export const CUSTOM_ENTRY_NAME_MAX = 80;
export const CUSTOM_ENTRY_IDENTIFIER_MAX = 60;
export const CUSTOM_ENTRY_NOTES_MAX = 500;
export const CUSTOM_REPORT_NOTE_MAX = 300;

/** Display form: trimmed, internal whitespace collapsed, case kept. */
export function normalizeCustomDirectoryText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/** Duplicate key for directory names and for entry names within one directory. */
export function customDirectoryNameKey(value: string): string {
  return normalizeCustomDirectoryText(value).toLocaleLowerCase('en-US');
}

export function validateCustomDirectoryDraft(draft: CustomDirectoryDraft): string[] {
  const issues: string[] = [];
  const name = normalizeCustomDirectoryText(draft.name);
  if (!name) issues.push('Directory name is required.');
  else if (name.length > CUSTOM_DIRECTORY_NAME_MAX) issues.push(`Directory name must be ${CUSTOM_DIRECTORY_NAME_MAX} characters or fewer.`);
  if ((draft.description ?? '').trim().length > CUSTOM_DIRECTORY_DESCRIPTION_MAX) issues.push(`Description must be ${CUSTOM_DIRECTORY_DESCRIPTION_MAX} characters or fewer.`);
  return issues;
}

export function validateCustomDirectoryEntryDraft(draft: CustomDirectoryEntryDraft): string[] {
  const issues: string[] = [];
  const name = normalizeCustomDirectoryText(draft.name);
  if (!name) issues.push('Name is required.');
  else if (name.length > CUSTOM_ENTRY_NAME_MAX) issues.push(`Name must be ${CUSTOM_ENTRY_NAME_MAX} characters or fewer.`);
  if (normalizeCustomDirectoryText(draft.identifier).length > CUSTOM_ENTRY_IDENTIFIER_MAX) issues.push(`Identifier must be ${CUSTOM_ENTRY_IDENTIFIER_MAX} characters or fewer.`);
  if ((draft.notes ?? '').trim().length > CUSTOM_ENTRY_NOTES_MAX) issues.push(`Notes must be ${CUSTOM_ENTRY_NOTES_MAX} characters or fewer.`);
  return issues;
}

/**
 * What a Daily Report keeps about one selected entry. It is copied when the entry is selected and is
 * never re-read from the directory, so renaming, re-identifying or archiving the entry later leaves
 * the report exactly as it was issued.
 */
export type CustomResourceSnapshotEntry = { entryId: string; name: string; identifier: string | null; note: string | null };
export type CustomResourceSnapshot = { directoryId: string; directoryName: string; entries: CustomResourceSnapshotEntry[] };

/**
 * Adds one entry to a report's snapshot. A directory group is created the first time one of its
 * entries is selected and placed by `directoryOrder` (the directory ids in their display order);
 * entries keep the order they were selected in. When a group already exists its recorded directory
 * name is kept even if the directory has since been renamed, so one report never shows the same
 * directory under two names.
 */
export function addCustomResourceEntry(
  snapshots: readonly CustomResourceSnapshot[],
  directory: Pick<CustomDirectory, 'id' | 'name'>,
  entry: Pick<CustomDirectoryEntry, 'id' | 'name' | 'identifier'>,
  directoryOrder: readonly string[],
): CustomResourceSnapshot[] {
  const existing = snapshots.find((group) => group.directoryId === directory.id);
  if (existing?.entries.some((value) => value.entryId === entry.id)) return [...snapshots];
  const copied: CustomResourceSnapshotEntry = {
    entryId: entry.id,
    name: normalizeCustomDirectoryText(entry.name),
    identifier: normalizeCustomDirectoryText(entry.identifier) || null,
    note: null,
  };
  if (existing) {
    return snapshots.map((group) => group.directoryId === directory.id ? { ...group, entries: [...group.entries, copied] } : group);
  }
  const rank = (id: string) => { const index = directoryOrder.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  const next = [...snapshots, { directoryId: directory.id, directoryName: normalizeCustomDirectoryText(directory.name), entries: [copied] }];
  return next
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group.directoryId) - rank(b.group.directoryId) || a.index - b.index)
    .map(({ group }) => group);
}

export function removeCustomResourceEntry(snapshots: readonly CustomResourceSnapshot[], directoryId: string, entryId: string): CustomResourceSnapshot[] {
  return snapshots
    .map((group) => group.directoryId === directoryId ? { ...group, entries: group.entries.filter((value) => value.entryId !== entryId) } : group)
    .filter((group) => group.entries.length > 0);
}

export function setCustomResourceNote(snapshots: readonly CustomResourceSnapshot[], directoryId: string, entryId: string, note: string): CustomResourceSnapshot[] {
  const clean = note.trim().slice(0, CUSTOM_REPORT_NOTE_MAX);
  return snapshots.map((group) => group.directoryId !== directoryId ? group : {
    ...group,
    entries: group.entries.map((value) => value.entryId === entryId ? { ...value, note: clean || null } : value),
  });
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/**
 * Reads stored snapshot JSON defensively. A malformed group or entry is dropped rather than failing
 * the whole report, and a group with no entries is omitted, which is also how an issued PDF omits an
 * empty directory.
 */
export function normalizeCustomResourceSnapshots(value: unknown): CustomResourceSnapshot[] {
  if (!Array.isArray(value)) return [];
  const groups: CustomResourceSnapshot[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const group = raw as Record<string, unknown>;
    const directoryId = text(group.directoryId), directoryName = text(group.directoryName);
    if (!directoryId || !directoryName || !Array.isArray(group.entries)) continue;
    const entries: CustomResourceSnapshotEntry[] = [];
    for (const rawEntry of group.entries) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const item = rawEntry as Record<string, unknown>;
      const entryId = text(item.entryId), name = text(item.name);
      if (!entryId || !name || entries.some((existing) => existing.entryId === entryId)) continue;
      entries.push({ entryId, name, identifier: text(item.identifier) || null, note: text(item.note).slice(0, CUSTOM_REPORT_NOTE_MAX) || null });
    }
    if (entries.length) groups.push({ directoryId, directoryName, entries });
  }
  return groups;
}
