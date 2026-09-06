import type {
  CompanySettings,
  CompanySettingsDraft,
  PdfSettingsDraft,
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
  /** DEC-397. Owns the document-header values only; it can never alter company identity. */
  savePdfSettings(draft: PdfSettingsDraft): Promise<CompanySettings>;
  getDemoArchiveStatus(): Promise<DemoArchiveStatus>;
  setDemoRecordsArchived(archived: boolean): Promise<DemoArchiveStatus>;
}
