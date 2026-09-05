import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CompanySettings,
  CompanySettingsDraft,
  Customer,
  CustomerDraft,
  CustomerType,
} from '../../domain/profiles';
import { validateCompanySettings, validateCustomerDraft } from '../../domain/profiles';
import type { DemoArchiveStatus, ProfileRepository } from './ProfileRepository';

const demoProjectWhere = "id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%' OR id LIKE 'test_report_project_%'";
const demoLoadWhere = "id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%' OR id LIKE 'test_filter_load_%'";

type CustomerRow = {
  id: string;
  customer_type: CustomerType;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_vat_number: string | null;
  notes: string | null;
  is_own_company: number;
  is_active: number;
  merged_into_id: string | null;
  created_at: string;
  updated_at: string;
};

type SettingsRow = {
  company_name: string;
  logo_uri: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_vat_number: string | null;
  receipt_footer: string | null;
  ministry_name: string | null;
  ministry_logo_uri: string | null;
  consulting_agency_name: string | null;
  updated_at: string;
  vat_rate_basis_points: number | null;
};

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clean(value: string | undefined): string | null {
  const cleaned = value?.trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned : null;
}

function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    type: row.customer_type,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxVatNumber: row.tax_vat_number,
    notes: row.notes,
    isOwnCompany: row.is_own_company === 1,
    isActive: row.is_active === 1,
    mergedIntoId: row.merged_into_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteProfileRepository implements ProfileRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async listCustomers(): Promise<Customer[]> {
    const rows = await this.db.getAllAsync<CustomerRow>(
      `SELECT * FROM customers
       WHERE merged_into_id IS NULL
       ORDER BY is_active DESC, is_own_company DESC, name COLLATE NOCASE`,
    );
    return rows.map(rowToCustomer);
  }

  async createCustomer(draft: CustomerDraft): Promise<Customer> {
    const issue = validateCustomerDraft(draft)[0];
    if (issue) throw new Error(issue);
    const now = new Date().toISOString();
    const customer: Customer = {
      id: makeId('customer'),
      type: draft.type,
      name: draft.name.trim().replace(/\s+/g, ' '),
      phone: clean(draft.phone),
      email: clean(draft.email),
      address: clean(draft.address),
      taxVatNumber: clean(draft.taxVatNumber),
      notes: clean(draft.notes),
      isOwnCompany: false,
      isActive: true,
      mergedIntoId: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.withTransactionAsync(async () => {
      await this.insertCustomer(customer);
      await this.enqueue('customer', customer.id, customer);
    });
    return customer;
  }

  async setCustomerActive(id: string, isActive: boolean): Promise<Customer> {
    const current = await this.db.getFirstAsync<CustomerRow>(
      'SELECT * FROM customers WHERE id = ?',
      id,
    );
    if (!current) throw new Error('Customer was not found.');
    if (current.is_own_company === 1 && !isActive) {
      throw new Error('The own-company customer cannot be deactivated here.');
    }
    const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        'UPDATE customers SET is_active = ?, updated_at = ? WHERE id = ?',
        isActive ? 1 : 0,
        now,
        id,
      );
      await this.enqueue('customer', id, { ...rowToCustomer(current), isActive, updatedAt: now });
    });
    return { ...rowToCustomer(current), isActive, updatedAt: now };
  }

  async getCompanySettings(): Promise<CompanySettings> {
    const row = await this.db.getFirstAsync<SettingsRow>(
      `SELECT company_name, logo_uri, address, phone, email, tax_vat_number,
              receipt_footer, ministry_name, ministry_logo_uri, consulting_agency_name, company_settings.updated_at,
              tax_settings.vat_rate_basis_points
       FROM company_settings
       LEFT JOIN tax_settings ON tax_settings.id = 'tax'
       WHERE company_settings.id = 'company'`,
    );
    if (!row) {
      return {
        companyName: '',
        logoUri: null,
        address: null,
        phone: null,
        email: null,
        taxVatNumber: null,
        receiptFooter: null,
        ministryName: null,
        ministryLogoUri: null,
        consultingAgencyName: null,
        vatRatePercent: 0,
        updatedAt: null,
      };
    }
    return {
      companyName: row.company_name,
      logoUri: row.logo_uri,
      address: row.address,
      phone: row.phone,
      email: row.email,
      taxVatNumber: row.tax_vat_number,
      receiptFooter: row.receipt_footer,
      ministryName: row.ministry_name,
      ministryLogoUri: row.ministry_logo_uri,
      consultingAgencyName: row.consulting_agency_name,
      vatRatePercent: (row.vat_rate_basis_points ?? 0) / 100,
      updatedAt: row.updated_at,
    };
  }

  async saveCompanySettings(draft: CompanySettingsDraft): Promise<CompanySettings> {
    const issue = validateCompanySettings(draft)[0];
    if (issue) throw new Error(issue);
    const now = new Date().toISOString();
    const settings: CompanySettings = {
      companyName: draft.companyName.trim().replace(/\s+/g, ' '),
      logoUri: draft.logoUri ?? null,
      address: clean(draft.address),
      phone: clean(draft.phone),
      email: clean(draft.email),
      taxVatNumber: clean(draft.taxVatNumber),
      receiptFooter: clean(draft.receiptFooter),
      ministryName: clean(draft.ministryName ?? undefined),
      ministryLogoUri: draft.ministryLogoUri ?? null,
      consultingAgencyName: clean(draft.consultingAgencyName ?? undefined),
      vatRatePercent: draft.vatRatePercent,
      updatedAt: now,
    };

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO company_settings (
          id, company_name, logo_uri, address, phone, email, tax_vat_number,
          receipt_footer, ministry_name, ministry_logo_uri, consulting_agency_name, updated_at
        ) VALUES ('company', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          company_name = excluded.company_name,
          logo_uri = excluded.logo_uri,
          address = excluded.address,
          phone = excluded.phone,
          email = excluded.email,
          tax_vat_number = excluded.tax_vat_number,
          receipt_footer = excluded.receipt_footer,
          ministry_name = excluded.ministry_name,
          ministry_logo_uri = excluded.ministry_logo_uri,
          consulting_agency_name = excluded.consulting_agency_name,
          updated_at = excluded.updated_at`,
        settings.companyName,
        settings.logoUri,
        settings.address,
        settings.phone,
        settings.email,
        settings.taxVatNumber,
        settings.receiptFooter,
        settings.ministryName,
        settings.ministryLogoUri,
        settings.consultingAgencyName,
        now,
      );
      await this.db.runAsync(
        `INSERT INTO tax_settings (id, vat_rate_basis_points, updated_at)
         VALUES ('tax', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           vat_rate_basis_points = excluded.vat_rate_basis_points,
           updated_at = excluded.updated_at`,
        Math.round(settings.vatRatePercent * 100),
        now,
      );

      const ownRow = await this.db.getFirstAsync<CustomerRow>(
        'SELECT * FROM customers WHERE is_own_company = 1',
      );
      let ownCustomer: Customer;
      if (ownRow) {
        await this.db.runAsync(
          `UPDATE customers SET customer_type = 'company', name = ?, phone = ?, email = ?,
            address = ?, tax_vat_number = ?, is_active = 1, updated_at = ? WHERE id = ?`,
          settings.companyName,
          settings.phone,
          settings.email,
          settings.address,
          settings.taxVatNumber,
          now,
          ownRow.id,
        );
        ownCustomer = {
          ...rowToCustomer(ownRow),
          type: 'company',
          name: settings.companyName,
          phone: settings.phone,
          email: settings.email,
          address: settings.address,
          taxVatNumber: settings.taxVatNumber,
          isActive: true,
          updatedAt: now,
        };
      } else {
        ownCustomer = {
          id: makeId('customer'),
          type: 'company',
          name: settings.companyName,
          phone: settings.phone,
          email: settings.email,
          address: settings.address,
          taxVatNumber: settings.taxVatNumber,
          notes: 'Own company customer profile',
          isOwnCompany: true,
          isActive: true,
          mergedIntoId: null,
          createdAt: now,
          updatedAt: now,
        };
        await this.insertCustomer(ownCustomer);
      }

      await this.enqueue('companySettings', 'company', settings);
      await this.enqueue('taxSettings', 'tax', { vatRatePercent: settings.vatRatePercent });
      await this.enqueue('customer', ownCustomer.id, ownCustomer);
    });

    return settings;
  }

  async getDemoArchiveStatus(): Promise<DemoArchiveStatus> {
    const [projects, loads] = await Promise.all([
      this.db.getFirstAsync<{ total: number; archived: number }>(`SELECT COUNT(*) total, COALESCE(SUM(is_archived),0) archived FROM projects WHERE ${demoProjectWhere}`),
      this.db.getFirstAsync<{ total: number; archived: number }>(`SELECT COUNT(*) total, COALESCE(SUM(is_archived),0) archived FROM loads WHERE ${demoLoadWhere}`),
    ]);
    const projectCount = projects?.total ?? 0, loadCount = loads?.total ?? 0;
    const archivedProjects = projects?.archived ?? 0, archivedLoads = loads?.archived ?? 0;
    return { projects: projectCount, loads: loadCount, archivedProjects, archivedLoads, isArchived: projectCount + loadCount > 0 && archivedProjects === projectCount && archivedLoads === loadCount };
  }

  async setDemoRecordsArchived(archived: boolean): Promise<DemoArchiveStatus> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`UPDATE projects SET is_archived = ?, status = CASE WHEN ? = 1 THEN 'completed' ELSE status END, updated_at = ? WHERE ${demoProjectWhere}`, archived ? 1 : 0, archived ? 1 : 0, new Date().toISOString());
      await this.db.runAsync(`UPDATE loads SET is_archived = ? WHERE ${demoLoadWhere}`, archived ? 1 : 0);
    });
    return this.getDemoArchiveStatus();
  }

  private async insertCustomer(customer: Customer): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO customers (
        id, customer_type, name, phone, email, address, tax_vat_number, notes,
        is_own_company, is_active, merged_into_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      customer.id,
      customer.type,
      customer.name,
      customer.phone,
      customer.email,
      customer.address,
      customer.taxVatNumber,
      customer.notes,
      customer.isOwnCompany ? 1 : 0,
      customer.isActive ? 1 : 0,
      customer.mergedIntoId,
      customer.createdAt,
      customer.updatedAt,
    );
  }

  private async enqueue(entityType: string, entityId: string, payload: unknown): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO sync_outbox (entity_type, entity_id, operation, payload_json, created_at)
       VALUES (?, ?, 'upsert', ?, ?)`,
      entityType,
      entityId,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
  }
}
