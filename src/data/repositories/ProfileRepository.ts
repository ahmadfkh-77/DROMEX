import type {
  CompanySettings,
  CompanySettingsDraft,
  Customer,
  CustomerDraft,
} from '../../domain/profiles';

export interface ProfileRepository {
  listCustomers(): Promise<Customer[]>;
  createCustomer(draft: CustomerDraft): Promise<Customer>;
  setCustomerActive(id: string, isActive: boolean): Promise<Customer>;
  getCompanySettings(): Promise<CompanySettings>;
  saveCompanySettings(draft: CompanySettingsDraft): Promise<CompanySettings>;
}
