import {normalizeSupervisorText} from './supervisors';

/**
 * DEC-487 (5). Reusable authorized signers for statements, invoices and bills.
 *
 * A signature is stroke data in the same validated JSON form as Supervisor, Consultant and driver
 * signatures (DEC-479): it lives inside the database, is covered by every encrypted backup, and never
 * leaves the device through the sync queue. Issuing a document copies the signer's name, title,
 * department and strokes into the document, so editing, re-signing or disabling the signer later never
 * changes an issued document.
 */
export type DocumentSigner = {
  id: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  signature: string[];
  signatureDamaged: boolean;
  signatureUpdatedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
export type DocumentSignerDraft = { name: string; jobTitle: string; department: string };
export type SignerDisplay = 'name_only' | 'name_with_signature';
export type SignerSnapshot = { signerId: string; name: string; jobTitle: string | null; department: string | null; display: SignerDisplay; signature: string[] };
export type SignerEvent = { id: number; signerId: string; event: 'created' | 'updated' | 'signature_changed' | 'disabled' | 'enabled' | 'used'; documentId: string | null; details: string | null; createdAt: string };

export const SIGNER_NAME_MAX = 80;
export const SIGNER_FIELD_MAX = 80;
export const signerNameKey = (value: string) => normalizeSupervisorText(value).toLocaleLowerCase('en-US');

export function validateSignerDraft(draft: DocumentSignerDraft): string[] {
  const issues: string[] = [];
  const name = normalizeSupervisorText(draft.name);
  if (!name) issues.push('Enter the signer’s printed name.');
  else if (name.length > SIGNER_NAME_MAX) issues.push(`The name must be ${SIGNER_NAME_MAX} characters or fewer.`);
  if (normalizeSupervisorText(draft.jobTitle).length > SIGNER_FIELD_MAX) issues.push(`Job title must be ${SIGNER_FIELD_MAX} characters or fewer.`);
  if (normalizeSupervisorText(draft.department).length > SIGNER_FIELD_MAX) issues.push(`Company or department must be ${SIGNER_FIELD_MAX} characters or fewer.`);
  return issues;
}

/** The copy a document keeps. Name only carries no strokes at all. */
export function signerSnapshot(signer: DocumentSigner, display: SignerDisplay): SignerSnapshot {
  if (display === 'name_with_signature' && !signer.signature.length) throw new Error(`${signer.name} has no saved signature. Choose Name only or draw the signature first.`);
  return { signerId: signer.id, name: signer.name, jobTitle: signer.jobTitle, department: signer.department, display, signature: display === 'name_with_signature' ? [...signer.signature] : [] };
}
