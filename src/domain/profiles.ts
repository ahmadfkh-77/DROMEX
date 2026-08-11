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

export type CompanySettings = {
  companyName: string;
  logoUri: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxVatNumber: string | null;
  receiptFooter: string | null;
  vatRatePercent: number;
  updatedAt: string | null;
};

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
