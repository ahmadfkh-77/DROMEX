/**
 * DEC-479. Saved supervisors for the Daily Report "Supervisor Sign-off" section.
 *
 * This is independent of the Consultant sign-off, the consulting-agency header, the Ministry header
 * and the company identity; none of those reads or writes a supervisor.
 *
 * A signature is stroke data -- the same list of SVG move/line paths the Consultant and driver
 * signatures already use -- stored inside the database. It is therefore never a file: it cannot be
 * overwritten by another supervisor's file, cannot point outside the app, is included in every
 * encrypted backup automatically, and a report keeps its own copy of the strokes it was issued with.
 */
export type Supervisor = {
  id: string;
  name: string;
  jobTitle: string | null;
  /** Current saved signature strokes; empty when the supervisor has no saved signature. */
  signature: string[];
  /** True when stored signature data could not be read; the UI offers to sign again. */
  signatureDamaged: boolean;
  signatureUpdatedAt: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SupervisorDraft = { name: string; jobTitle?: string };

export const SUPERVISOR_NAME_MAX = 80;
export const SUPERVISOR_TITLE_MAX = 80;
export const SIGNATURE_MAX_STROKES = 200;
export const SIGNATURE_MAX_CHARACTERS = 120_000;

export function normalizeSupervisorText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

export function supervisorNameKey(value: string): string {
  return normalizeSupervisorText(value).toLocaleLowerCase('en-US');
}

export function validateSupervisorDraft(draft: SupervisorDraft): string[] {
  const issues: string[] = [];
  const name = normalizeSupervisorText(draft.name);
  if (!name) issues.push('Supervisor name is required.');
  else if (name.length > SUPERVISOR_NAME_MAX) issues.push(`Supervisor name must be ${SUPERVISOR_NAME_MAX} characters or fewer.`);
  if (normalizeSupervisorText(draft.jobTitle).length > SUPERVISOR_TITLE_MAX) issues.push(`Job title must be ${SUPERVISOR_TITLE_MAX} characters or fewer.`);
  return issues;
}

/**
 * Exactly the stroke form SignaturePad produces: "M x y" followed by any number of " L x y", with
 * decimal coordinates. Nothing else -- no curves, quotes, tags or letters -- can reach a PDF.
 */
const NUMBER = '-?\\d{1,6}(?:\\.\\d{1,4})?';
const STROKE_PATTERN = new RegExp(`^M ${NUMBER} ${NUMBER}(?: L ${NUMBER} ${NUMBER})*$`);

export function isValidSignatureStroke(value: unknown): value is string {
  return typeof value === 'string' && STROKE_PATTERN.test(value);
}

/** The signature equivalent of media type and size validation. */
export function validateSignatureStrokes(strokes: unknown): string[] {
  if (!Array.isArray(strokes) || !strokes.every(isValidSignatureStroke)) return ['The signature data is not valid.'];
  const characters = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
  if (strokes.length > SIGNATURE_MAX_STROKES || characters > SIGNATURE_MAX_CHARACTERS) return ['The signature is too large. Clear it and sign again.'];
  return [];
}

/** Reads a stored signature without ever throwing; unreadable data is reported, never rendered. */
export function parseStoredSignature(json: string | null | undefined): { strokes: string[]; damaged: boolean } {
  try {
    const parsed: unknown = JSON.parse(json || '[]');
    if (validateSignatureStrokes(parsed).length) return { strokes: [], damaged: true };
    return { strokes: [...parsed as string[]], damaged: false };
  } catch {
    return { strokes: [], damaged: true };
  }
}

export type SignoffDisplay = 'name_only' | 'name_with_signature';

/** What a Daily Report keeps for one supervisor sign-off, in the order the supervisors were selected. */
export type SupervisorSignoffSnapshot = {
  supervisorId: string;
  name: string;
  jobTitle: string | null;
  display: SignoffDisplay;
  /** The report's own copy of the strokes; always empty for a name-only sign-off. */
  signature: string[];
};

/**
 * Copies a supervisor into a report. A signature is copied only when it was chosen and the profile
 * actually has a valid one; a supervisor without a signature can only be signed off by name.
 */
export function buildSupervisorSignoff(supervisor: Supervisor, display: SignoffDisplay): SupervisorSignoffSnapshot {
  const hasSignature = supervisor.signature.length > 0 && !supervisor.signatureDamaged && validateSignatureStrokes(supervisor.signature).length === 0;
  const withSignature = display === 'name_with_signature' && hasSignature;
  return {
    supervisorId: supervisor.id,
    name: normalizeSupervisorText(supervisor.name),
    jobTitle: normalizeSupervisorText(supervisor.jobTitle) || null,
    display: withSignature ? 'name_with_signature' : 'name_only',
    signature: withSignature ? [...supervisor.signature] : [],
  };
}

export function addSupervisorSignoff(list: readonly SupervisorSignoffSnapshot[], supervisor: Supervisor, display: SignoffDisplay): SupervisorSignoffSnapshot[] {
  if (list.some((value) => value.supervisorId === supervisor.id)) return [...list];
  return [...list, buildSupervisorSignoff(supervisor, display)];
}

export function removeSupervisorSignoff(list: readonly SupervisorSignoffSnapshot[], supervisorId: string): SupervisorSignoffSnapshot[] {
  return list.filter((value) => value.supervisorId !== supervisorId);
}

export function moveSupervisorSignoff(list: readonly SupervisorSignoffSnapshot[], supervisorId: string, direction: -1 | 1): SupervisorSignoffSnapshot[] {
  const index = list.findIndex((value) => value.supervisorId === supervisorId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/**
 * Changes how one selected supervisor signs off. Choosing name-only discards the report's strokes.
 * Choosing the signature again is a new, deliberate selection, so it copies the profile's current
 * signature; if the profile is no longer available or has no signature, the sign-off stays name-only.
 */
export function setSupervisorSignoffDisplay(
  list: readonly SupervisorSignoffSnapshot[],
  supervisorId: string,
  display: SignoffDisplay,
  supervisors: readonly Supervisor[],
): SupervisorSignoffSnapshot[] {
  return list.map((value) => {
    if (value.supervisorId !== supervisorId) return value;
    if (display === 'name_only') return { ...value, display: 'name_only', signature: [] };
    const profile = supervisors.find((candidate) => candidate.id === supervisorId);
    if (!profile) return { ...value, display: 'name_only', signature: [] };
    const rebuilt = buildSupervisorSignoff(profile, 'name_with_signature');
    return rebuilt.display === 'name_with_signature' ? { ...value, display: rebuilt.display, signature: rebuilt.signature } : { ...value, display: 'name_only', signature: [] };
  });
}

/** Reads stored sign-off JSON defensively; an invalid stroke is never passed on to a document. */
export function normalizeSupervisorSignoffs(value: unknown): SupervisorSignoffSnapshot[] {
  if (!Array.isArray(value)) return [];
  const result: SupervisorSignoffSnapshot[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const supervisorId = typeof item.supervisorId === 'string' ? item.supervisorId.trim() : '';
    const name = normalizeSupervisorText(typeof item.name === 'string' ? item.name : '');
    if (!supervisorId || !name || result.some((existing) => existing.supervisorId === supervisorId)) continue;
    const strokes = Array.isArray(item.signature) ? item.signature.filter(isValidSignatureStroke) : [];
    const withSignature = item.display === 'name_with_signature' && strokes.length > 0;
    result.push({
      supervisorId,
      name,
      jobTitle: normalizeSupervisorText(typeof item.jobTitle === 'string' ? item.jobTitle : '') || null,
      display: withSignature ? 'name_with_signature' : 'name_only',
      signature: withSignature ? strokes : [],
    });
  }
  return result;
}
