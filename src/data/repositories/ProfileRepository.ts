import type {
  CompanySettings,
  CompanySettingsDraft,
  Customer,
  CustomerDraft,
} from '../../domain/profiles';

export type DemoArchiveStatus = {
  projects: number;
  loads: number;
  archivedProjects: number;
  archivedLoads: number;
  isArchived: boolean;
};

export interface ProfileRepository {
  listCustomers(): Promise<Customer[]>;
  createCustomer(draft: CustomerDraft): Promise<Customer>;
  setCustomerActive(id: string, isActive: boolean): Promise<Customer>;
  getCompanySettings(): Promise<CompanySettings>;
  saveCompanySettings(draft: CompanySettingsDraft): Promise<CompanySettings>;
  getDemoArchiveStatus(): Promise<DemoArchiveStatus>;
  setDemoRecordsArchived(archived: boolean): Promise<DemoArchiveStatus>;
}
