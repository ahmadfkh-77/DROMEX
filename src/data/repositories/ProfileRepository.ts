import type {
  CompanySettings,
  CompanySettingsDraft,
  PdfSettingsDraft,
  Customer,
  CustomerDraft,
  ConsultingAgency,
  ConsultingAgencyDraft,
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

  // DEC-417. Reusable, per-project consulting agencies, replacing the single global free-text pair.
  // Never physically deleted: setConsultingAgencyActive(id, false) is the only removal path.
  listConsultingAgencies(): Promise<ConsultingAgency[]>;
  createConsultingAgency(draft: ConsultingAgencyDraft): Promise<ConsultingAgency>;
  updateConsultingAgency(id: string, draft: ConsultingAgencyDraft): Promise<ConsultingAgency>;
  setConsultingAgencyActive(id: string, isActive: boolean): Promise<ConsultingAgency>;
}
