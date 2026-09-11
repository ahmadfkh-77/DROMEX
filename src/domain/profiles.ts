export type CustomerType = 'individual' | 'company';

export type CustomerDraft = {
  type: CustomerType;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  taxVatNumber?: string;
  notes?: string;
};

export type Customer = {
  id: string;
  type: CustomerType;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxVatNumber: string | null;
  notes: string | null;
  isOwnCompany: boolean;
  isActive: boolean;
  mergedIntoId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Company & VAT owns these and only these (DEC-397). The document-header values are deliberately
 * absent: a screen that cannot name a column cannot blank it, which is what keeps Company & VAT from
 * wiping PDF Settings on its next save.
 */
export type CompanySettingsDraft = {
  companyName: string;
  logoUri?: string | null;
  address?: string;
  phone?: string;
  email?: string;
  taxVatNumber?: string;
  receiptFooter?: string;
  vatRatePercent: number;
};

/** PDF Settings owns these and only these (DEC-397, DEC-398). `ministryName` is the English value. */
export type PdfSettingsDraft = {
  ministryName?: string | null;
  ministryNameAr?: string | null;
  ministryLogoUri?: string | null;
  consultingAgencyName?: string | null;
  consultingAgencyNameAr?: string | null;
  customHeaderEn?: string | null;
  customHeaderAr?: string | null;
};

export type CompanySettings = {
  companyName: string;
  logoUri: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxVatNumber: string | null;
  receiptFooter: string | null;
  // DEC-398. `ministryName` and `consultingAgencyName` are the English values; the legacy column
  // names are kept so existing rows and the backup format are untouched.
  ministryName: string | null;
  ministryNameAr: string | null;
  ministryLogoUri: string | null;
  // DEC-391, as amended by DEC-399. Global, optional, and deliberately outside
  // consultantSignoffState: an agency name never makes a sign-off complete or incomplete, and since
  // DEC-399 it no longer depends on the sign-off being enabled at all.
  consultingAgencyName: string | null;
  consultingAgencyNameAr: string | null;
  customHeaderEn: string | null;
  customHeaderAr: string | null;
  vatRatePercent: number;
  updatedAt: string | null;
};

export type DocumentHeaderKind = 'ministry' | 'consultingAgency' | 'customHeader';
/** What a header can actually draw, so the editor can say precisely what is missing (DEC-402). */
export type DocumentHeaderConfigured = {english: boolean; arabic: boolean; logo: boolean};
const filled = (value: string | null | undefined) => (value ?? '').trim().length > 0;
export function documentHeaderConfigured(settings: Partial<CompanySettings>, kind: DocumentHeaderKind): DocumentHeaderConfigured {
  if (kind === 'ministry') return {english: filled(settings.ministryName), arabic: filled(settings.ministryNameAr), logo: filled(settings.ministryLogoUri)};
  if (kind === 'consultingAgency') return {english: filled(settings.consultingAgencyName), arabic: filled(settings.consultingAgencyNameAr), logo: false};
  return {english: filled(settings.customHeaderEn), arabic: filled(settings.customHeaderAr), logo: false};
}
/** True when a header would render nothing at all, whichever language or logo it relies on. */
export function documentHeaderIsEmpty(settings: Partial<CompanySettings>, kind: DocumentHeaderKind): boolean {
  const state = documentHeaderConfigured(settings, kind);
  return !state.english && !state.arabic && !state.logo;
}

// Which parts of the optional Ministry header are configured (DEC-389). A report may switch the
// header on at any time; this decides what the PDF can actually render and what the editor must
// warn about. Both values are optional by design, so 'not-configured' is a normal state.
export type MinistryHeaderState = 'not-configured' | 'name-only' | 'logo-only' | 'complete';
export function ministryHeaderState(config: {ministryName?: string | null; ministryLogoUri?: string | null}): MinistryHeaderState {
  const hasName = (config.ministryName ?? '').trim().length > 0;
  const hasLogo = (config.ministryLogoUri ?? '').trim().length > 0;
  if (hasName && hasLogo) return 'complete';
  if (hasName) return 'name-only';
  if (hasLogo) return 'logo-only';
  return 'not-configured';
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function phonesPossiblyMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 7 || right.length < 7) return false;
  return left.endsWith(right) || right.endsWith(left);
}

function normalizeTax(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLocaleLowerCase('en-US');
}

export function validateCustomerDraft(draft: CustomerDraft): string[] {
  const issues: string[] = [];
  if (draft.type !== 'individual' && draft.type !== 'company') {
    issues.push('Select Individual or Company.');
  }
  if (!normalizeText(draft.name)) issues.push('Customer name is required.');
  return issues;
}

export function findPotentialCustomerDuplicates(
  draft: CustomerDraft,
  customers: Customer[],
): Customer[] {
  const name = normalizeText(draft.name);
  const phone = normalizePhone(draft.phone ?? '');
  const tax = normalizeTax(draft.taxVatNumber ?? '');

  return customers.filter((customer) => {
    const candidateName = normalizeText(customer.name);
    const nameMatches =
      Boolean(name) &&
      (candidateName === name || candidateName.includes(name) || name.includes(candidateName));
    const phoneMatches = phonesPossiblyMatch(phone, normalizePhone(customer.phone ?? ''));
    const taxMatches =
      Boolean(tax) && normalizeTax(customer.taxVatNumber ?? '') === tax;
    return nameMatches || phoneMatches || taxMatches;
  });
}

export function validateCompanySettings(draft: CompanySettingsDraft): string[] {
  const issues: string[] = [];
  if (!normalizeText(draft.companyName)) issues.push('Company name is required.');
  if (!Number.isFinite(draft.vatRatePercent) || draft.vatRatePercent < 0 || draft.vatRatePercent > 100) {
    issues.push('VAT rate must be between 0 and 100.');
  }
  return issues;
}

/**
 * A consulting agency saved once and reused across projects and reports (DEC-417). `nameEn` is
 * required for every newly created agency; it may be empty only for one legacy case: a global
 * `consulting_agency_name`/`_ar` value that existed before this feature and had no English name at
 * all (DEC-416). That empty state is preserved honestly rather than filled with an invented
 * placeholder or a copy of the Arabic text.
 */
export type ConsultingAgency = {
  id: string;
  nameEn: string;
  nameAr: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConsultingAgencyDraft = { nameEn: string; nameAr?: string | null };

/**
 * The normalized duplicate-detection key (DEC-417). Trims, collapses repeated internal
 * whitespace, and case-folds — the same rule `normalizeText` already applies for customer
 * duplicate detection, reused rather than reimplemented so the two never silently diverge.
 *
 * This is the value SQLite's UNIQUE index actually enforces uniqueness on. The repository is the
 * only place that may compute it and write it to storage; a create/update draft must never carry
 * a `name_en_key` in from UI input, and the migration that seeds the initial legacy agency must
 * compute the key through this same function so a later manual entry of the same name is caught
 * as a duplicate rather than silently diverging from the seeded row.
 */
export function normalizeAgencyKey(nameEn: string): string {
  return normalizeText(nameEn);
}

/** The stored display form of an English agency name: trimmed and internally collapsed, but not
 * case-folded — case is part of how the name reads, and is preserved for display even though the
 * uniqueness key ignores it. */
export function normalizeAgencyName(nameEn: string): string {
  return nameEn.trim().replace(/\s+/g, ' ');
}

export function validateConsultingAgencyDraft(draft: ConsultingAgencyDraft): string[] {
  const issues: string[] = [];
  if (!normalizeAgencyName(draft.nameEn)) issues.push('English agency name is required.');
  return issues;
}

/**
 * Presentation-only fallback (DEC-416): when an agency's English name is empty — the one legacy
 * case a migration can produce — its Arabic name is shown instead so the agency is still
 * identifiable in every picker and list. This never changes what is stored; `nameEn` stays `''`.
 */
export function consultingAgencyDisplayLabel(agency: Pick<ConsultingAgency, 'nameEn' | 'nameAr'>): string {
  const en = agency.nameEn.trim();
  if (en) return en;
  const ar = (agency.nameAr ?? '').trim();
  if (ar) return ar;
  return 'Unnamed agency';
}

/** True for the one legacy case where an agency has no English name yet and should be flagged for
 * completion when edited. Newly created agencies can never reach this state (DEC-417): creation
 * requires a non-empty English name. */
export function consultingAgencyNeedsEnglishName(agency: Pick<ConsultingAgency, 'nameEn'>): boolean {
  return !agency.nameEn.trim();
}

/** A resolved agency reference, as carried by a project's or report's current assignment. `isActive`
 * reflects the agency's own state, independent of whether that assignment is still selectable. */
export type ConsultingAgencyOption = { id: string; nameEn: string; nameAr: string | null; isActive: boolean };

/**
 * Builds the set of agencies a picker may offer (DEC-417): every active agency, plus the record's
 * currently assigned agency even when that one has since been deactivated — so an inactive agency
 * already on a project or report stays visible and selectable as "keep this," never silently
 * dropped from its own field. No other inactive agency is offered for a new selection.
 */
export function resolveConsultingAgencySelectorOptions(
  active: ConsultingAgencyOption[],
  current: ConsultingAgencyOption | null,
): ConsultingAgencyOption[] {
  if (!current || current.isActive || active.some((option) => option.id === current.id)) return active;
  return [...active, current];
}
