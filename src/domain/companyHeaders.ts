import type {SignerDisplay, SignerSnapshot} from './documentSigners';
import type {ConfirmedLoad} from './loads';
import {companyContactLine} from './projectTotalsPdf';

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

/**
 * Phase 3. The loaded record as a PDF, preview or printed slip should show it under the chosen header
 * company. Only the company name, logo, contact details, footer and the supplier signature line change;
 * every number, quantity, price and signature the load was confirmed with is read from the record as is.
 * The Plant Company returns the record exactly as confirmed (its own header and supplier signature snapshot), so
 * reprinting an old receipt never changes it when the company profile is edited later. The Project Company shows
 * its own header and signer, or no supplier line when it has none. The original record is never changed.
 */
export function applyHeaderCompany(record: ConfirmedLoad, header: HeaderCompany): ConfirmedLoad {
  if (header.kind === 'plant') return record;
  return {
    ...record,
    companyName: header.name,
    companyAddress: header.address,
    companyPhone: header.phone,
    companyEmail: header.email,
    companyTaxVatNumber: header.taxVatNumber,
    companyReceiptFooter: header.footer,
    companyLogoUri: header.logoUri,
    supplierSignature: header.signer,
  };
}

/**
 * Phase 5. What every list and report PDF needs from the chosen Header company: the name, the logo and the one
 * contact line printed under the name. It changes nothing in a record.
 */
/**
 * DEC-506. What the person chose to print in one PDF's header: the logo on or off, a name to print instead, and which
 * contact details to include. The defaults print the header company exactly as saved.
 */
export type HeaderCustomization = { showLogo: boolean; name: string; address: boolean; phone: boolean; email: boolean; taxVatNumber: boolean };
export const defaultHeaderCustomization: HeaderCustomization = { showLogo: true, name: '', address: true, phone: true, email: true, taxVatNumber: true };
export function customizedListHeader(header: HeaderCompany, custom: HeaderCustomization): { companyName: string; logoUri: string | null; contactLine: string | null } {
  return {
    companyName: custom.name.trim() || header.name,
    logoUri: custom.showLogo ? header.logoUri : null,
    contactLine: companyContactLine({ address: custom.address ? header.address : null, phone: custom.phone ? header.phone : null, email: custom.email ? header.email : null, taxVatNumber: custom.taxVatNumber ? header.taxVatNumber : null }),
  };
}
export function listHeaderFrom(header: HeaderCompany): { companyName: string; logoUri: string | null; contactLine: string | null } {
  return { companyName: header.name, logoUri: header.logoUri, contactLine: companyContactLine({ address: header.address, phone: header.phone, email: header.email, taxVatNumber: header.taxVatNumber }) };
}
