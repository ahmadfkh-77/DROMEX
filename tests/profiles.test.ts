import { describe, expect, it } from 'vitest';

import {
  findPotentialCustomerDuplicates,
  type Customer,
  validateCompanySettings,
  validateCustomerDraft,
} from '../src/domain/profiles';

const existingCustomer: Customer = {
  id: 'customer_1',
  type: 'company',
  name: 'Cedars Contracting',
  phone: '+961 70 123 456',
  email: 'office@example.com',
  address: 'Beirut',
  taxVatNumber: 'VAT-7788',
  notes: null,
  isOwnCompany: false,
  isActive: true,
  mergedIntoId: null,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

describe('customer profiles', () => {
  it('requires a customer type and name but permits blank optional details', () => {
    expect(validateCustomerDraft({ type: 'individual', name: ' ' })).toEqual([
      'Customer name is required.',
    ]);
    expect(validateCustomerDraft({ type: 'company', name: 'DROMEX Customer' })).toEqual([]);
  });

  it('finds possible duplicates by normalized name, phone, or Tax/VAT number', () => {
    expect(
      findPotentialCustomerDuplicates(
        { type: 'company', name: 'cedars contracting', phone: '', taxVatNumber: '' },
        [existingCustomer],
      ),
    ).toEqual([existingCustomer]);
    expect(
      findPotentialCustomerDuplicates(
        { type: 'individual', name: 'Different', phone: '70-123-456' },
        [existingCustomer],
      ),
    ).toEqual([existingCustomer]);
    expect(
      findPotentialCustomerDuplicates(
        { type: 'company', name: 'Different', taxVatNumber: 'vat 7788' },
        [existingCustomer],
      ),
    ).toEqual([existingCustomer]);
  });
});

describe('company settings', () => {
  it('requires the company name and accepts a VAT rate from zero through 100 percent', () => {
    expect(validateCompanySettings({ companyName: '', vatRatePercent: 11 })).toEqual([
      'Company name is required.',
    ]);
    expect(validateCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11 })).toEqual([]);
    expect(validateCompanySettings({ companyName: 'DROMEX', vatRatePercent: 101 })).toEqual([
      'VAT rate must be between 0 and 100.',
    ]);
  });
});
