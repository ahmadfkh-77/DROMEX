import type {SignerDisplay, SignerSnapshot} from './documentSigners';

/**
 * Phase 1 (Receipts, Load History and PDFs). A PDF can be headed by one of two companies:
 * - `plant`: the Plant Company, the existing Company profile (company_settings). It makes the receipts.
 * - `project`: the Project Company, a customer that owns the project. It is LINKED to an existing
 *   customer by id and only adds header details; it never changes the customer or any record.
 * Choosing a header changes ONLY the PDF header (name, logo, contact details) and the signature.
 */
export type HeaderCompanyKind = 'plant' | 'project';
export const HEADER_COMPANY_LABELS: Record<HeaderCompanyKind, string> = { plant: 'Plant Company', project: 'Project Company' };

/** What the Plant Company adds to the existing Company profile. */
export type PlantHeaderExtras = { registrationNumber: string | null; signerId: string | null; signerDisplay: SignerDisplay | null };
export type PlantHeaderExtrasDraft = { registrationNumber: string; signerId: string | null; signerDisplay: SignerDisplay | null };

export type ProjectCompanyDraft = {
  customerId: string;
  logoUri: string | null;
  address: string;
  phone: string;
  email: string;
  taxVatNumber: string;
  registrationNumber: string;
  receiptFooter: string;
  signerId: string | null;
  signerDisplay: SignerDisplay | null;
};

export type ProjectCompanyProfile = {
  /** The customer this header belongs to, after following any merge (see the repository). */
  customerId: string;
  /** The customer's CURRENT name: renaming the customer renames the header, and never breaks the link. */
  customerName: string;
  customerIsActive: boolean;
  logoUri: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxVatNumber: string | null;
  registrationNumber: string | null;
  receiptFooter: string | null;
  signerId: string | null;
  signerDisplay: SignerDisplay | null;
  updatedAt: string;
};

/** A header ready to print: what a PDF reads, whichever company was chosen. */
export type HeaderCompany = {
  kind: HeaderCompanyKind;
  name: string;
  logoUri: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxVatNumber: string | null;
  registrationNumber: string | null;
  footer: string | null;
  signer: SignerSnapshot | null;
  /** Set when the Plant Company was used although the Project Company was asked for, or the customer is archived. */
  note: string | null;
};

export function validateProjectCompanyDraft(draft: ProjectCompanyDraft): string[] {
  const issues: string[] = [];
  if (!draft.customerId.trim()) issues.push('Choose which customer the Project Company is.');
  if (draft.email.trim() && !/^\S+@\S+\.\S+$/.test(draft.email.trim())) issues.push('Enter a valid email address or leave it empty.');
  if (draft.signerDisplay && !draft.signerId) issues.push('Choose a signer before choosing how the signature shows.');
  return issues;
}

/** A project with no stored choice, or an unknown stored value, defaults to the Plant Company. */
export function headerKindOrDefault(stored: string | null | undefined): HeaderCompanyKind {
  return stored === 'project' ? 'project' : 'plant';
}

export type ProjectCompanyState = 'not_set_up' | 'ready' | 'customer_archived';
export function projectCompanyState(profile: Pick<ProjectCompanyProfile, 'customerIsActive'> | null): ProjectCompanyState {
  if (!profile) return 'not_set_up';
  return profile.customerIsActive ? 'ready' : 'customer_archived';
}

/** The Project Company can only head a PDF once it is set up; otherwise the Plant Company is used. */
export function effectiveHeaderKind(requested: HeaderCompanyKind, projectCompanySetUp: boolean): HeaderCompanyKind {
  return requested === 'project' && !projectCompanySetUp ? 'plant' : requested;
}

export const HEADER_PICKER_HELPER = 'Its name, logo, contact details and signature go on this PDF. Records and numbers do not change. Remembered for this project.';
