import type {SQLiteDatabase} from 'expo-sqlite';

import {
  headerKindOrDefault,
  validateProjectCompanyDraft,
  type HeaderCompany,
  type HeaderCompanyKind,
  type PlantHeaderExtras,
  type PlantHeaderExtrasDraft,
  type ProjectCompanyDraft,
  type ProjectCompanyProfile,
} from '../../domain/companyHeaders';
import {signerSnapshot, type SignerDisplay, type SignerSnapshot} from '../../domain/documentSigners';
import {planLoadNameUpdate, validateLoadNameUpdate, type CompanyDetails, type LoadNameStatus, type LoadNameUpdateInput, type LoadNameUpdateRecord} from '../../domain/loadCompanyName';
import type {CompanyHeaderRepository} from './CompanyHeaderRepository';
import {defaultDeliverySignature, signerFromRow} from './SqliteDocumentSignerRepository';

type SignerRowInput = Parameters<typeof signerFromRow>[0];
type ProfileRow = {
  customer_id: string; logo_uri: string | null; address: string | null; phone: string | null; email: string | null;
  tax_vat_number: string | null; registration_number: string | null; receipt_footer: string | null;
  signer_id: string | null; signer_display: SignerDisplay | null; updated_at: string;
};
type CustomerRow = { id: string; name: string; is_active: number; merged_into_id: string | null; is_own_company?: number };
type PlantRow = {
  company_name: string; logo_uri: string | null; address: string | null; phone: string | null; email: string | null;
  tax_vat_number: string | null; receipt_footer: string | null; registration_number: string | null;
  header_signer_id: string | null; header_signer_display: SignerDisplay | null;
};

const clean = (value: string): string | null => value.trim().replace(/\s+/g, ' ') || null;

/** The signature copy a header carries, or null when the signer was disabled or removed since. A cleared drawing falls back to Name only. */
async function signerCopy(db: SQLiteDatabase, signerId: string, display: SignerDisplay): Promise<SignerSnapshot | null> {
  const row = await db.getFirstAsync<SignerRowInput & { is_active: number }>('SELECT * FROM document_signers WHERE id = ?', signerId);
  if (!row || row.is_active !== 1) return null;
  const signer = signerFromRow(row);
  return signerSnapshot(signer, display === 'name_with_signature' && signer.signature.length ? 'name_with_signature' : 'name_only');
}

/**
 * Phase 2. The supplier signature a NEW load carries: the Plant Company's default signer (Company setups),
 * otherwise the Delivery Authorization default signer. `note` explains a Plant Company signer that cannot sign.
 */
export async function supplierSignatureForNewLoad(db: SQLiteDatabase): Promise<{ signature: SignerSnapshot | null; note: string | null }> {
  const plant = await db.getFirstAsync<{ header_signer_id: string | null; header_signer_display: SignerDisplay | null }>("SELECT header_signer_id, header_signer_display FROM company_settings WHERE id = 'company'");
  let note: string | null = null;
  if (plant?.header_signer_id) {
    const copy = await signerCopy(db, plant.header_signer_id, plant.header_signer_display ?? 'name_only');
    if (copy) return { signature: copy, note: null };
    note = 'The Plant Company signer is disabled or missing, so it cannot sign.';
  }
  return { signature: await defaultDeliverySignature(db), note };
}

export class SqliteCompanyHeaderRepository implements CompanyHeaderRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getPlantExtras(): Promise<PlantHeaderExtras> {
    const row = await this.db.getFirstAsync<{ registration_number: string | null; header_signer_id: string | null; header_signer_display: SignerDisplay | null }>(
      "SELECT registration_number, header_signer_id, header_signer_display FROM company_settings WHERE id = 'company'");
    return { registrationNumber: row?.registration_number ?? null, signerId: row?.header_signer_id ?? null, signerDisplay: row?.header_signer_display ?? null };
  }

  async savePlantExtras(draft: PlantHeaderExtrasDraft): Promise<PlantHeaderExtras> {
    if (draft.signerDisplay && !draft.signerId) throw new Error('Choose a signer before choosing how the signature shows.');
    if (draft.signerId) await this.requireUsableSigner(draft.signerId, draft.signerDisplay ?? 'name_only');
    const result = await this.db.runAsync(
      "UPDATE company_settings SET registration_number = ?, header_signer_id = ?, header_signer_display = ? WHERE id = 'company'",
      clean(draft.registrationNumber), draft.signerId, draft.signerId ? draft.signerDisplay ?? 'name_only' : null);
    if (!result.changes) throw new Error('Save the Plant Company name first.');
    return this.getPlantExtras();
  }

  async getProjectCompany(): Promise<ProjectCompanyProfile | null> {
    const row = await this.db.getFirstAsync<ProfileRow>("SELECT * FROM project_company_profile WHERE id = 'project'");
    if (!row) return null;
    const customer = await this.effectiveCustomer(row.customer_id);
    return {
      customerId: customer?.id ?? row.customer_id,
      customerName: customer?.name ?? 'Customer not found',
      customerIsActive: customer ? customer.is_active === 1 : false,
      logoUri: row.logo_uri, address: row.address, phone: row.phone, email: row.email,
      taxVatNumber: row.tax_vat_number, registrationNumber: row.registration_number, receiptFooter: row.receipt_footer,
      signerId: row.signer_id, signerDisplay: row.signer_display, updatedAt: row.updated_at,
    };
  }

  async saveProjectCompany(draft: ProjectCompanyDraft): Promise<ProjectCompanyProfile> {
    const issue = validateProjectCompanyDraft(draft)[0];
    if (issue) throw new Error(issue);
    const customer = await this.db.getFirstAsync<CustomerRow>('SELECT id, name, is_active, merged_into_id, is_own_company FROM customers WHERE id = ?', draft.customerId);
    if (!customer) throw new Error('The chosen customer was not found.');
    // DEC-508. Only the own-company customer is named here; any other customer keeps the name it was given in Customers.
    const newName = customer.is_own_company === 1 && draft.customerName !== undefined ? draft.customerName.trim().replace(/\s+/g, ' ') : null;
    if (newName !== null && !newName) throw new Error('Enter the company name.');
    if (newName !== null && newName !== customer.name) {
      const clash = await this.db.getFirstAsync<{ name: string }>('SELECT name FROM customers WHERE id <> ? AND is_active = 1 AND name = ? COLLATE NOCASE', customer.id, newName);
      if (clash) throw new Error(`A customer named "${clash.name}" already exists. Choose a different name.`);
    }
    if (customer.is_active !== 1 && !customer.merged_into_id) throw new Error('The chosen customer is archived. Choose an active customer.');
    if (draft.signerId) await this.requireUsableSigner(draft.signerId, draft.signerDisplay ?? 'name_only');
    const now = new Date().toISOString();
    // Only project_company_profile is written. customers, loads, payments and projects are never touched.
    await this.db.withTransactionAsync(async () => {
      if (newName !== null && newName !== customer.name) {
        // Only the customer's current name changes. Loads, receipts and documents keep the name they were made with.
        await this.db.runAsync('UPDATE customers SET name = ?, updated_at = ? WHERE id = ?', newName, now, customer.id);
        await this.enqueue('customer', customer.id, { id: customer.id, name: newName, updatedAt: now });
      }
      await this.db.runAsync(
        `INSERT INTO project_company_profile (id, customer_id, logo_uri, address, phone, email, tax_vat_number, registration_number, receipt_footer, signer_id, signer_display, created_at, updated_at)
         VALUES ('project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET customer_id = excluded.customer_id, logo_uri = excluded.logo_uri, address = excluded.address,
           phone = excluded.phone, email = excluded.email, tax_vat_number = excluded.tax_vat_number, registration_number = excluded.registration_number,
           receipt_footer = excluded.receipt_footer, signer_id = excluded.signer_id, signer_display = excluded.signer_display, updated_at = excluded.updated_at`,
        draft.customerId, draft.logoUri, clean(draft.address), clean(draft.phone), clean(draft.email), clean(draft.taxVatNumber),
        clean(draft.registrationNumber), clean(draft.receiptFooter), draft.signerId, draft.signerId ? draft.signerDisplay ?? 'name_only' : null, now, now);
      await this.enqueue('projectCompanyProfile', 'project', { id: 'project', customerId: draft.customerId, signerId: draft.signerId, updatedAt: now });
    });
    const saved = await this.getProjectCompany();
    if (!saved) throw new Error('The Project Company was not saved.');
    return saved;
  }

  async removeProjectCompany(): Promise<void> {
    const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync("DELETE FROM project_company_profile WHERE id = 'project'");
      // A project that remembered the Project Company header falls back to the Plant Company.
      await this.db.runAsync("UPDATE projects SET header_company = NULL WHERE header_company = 'project'");
      await this.enqueue('projectCompanyProfile', 'project', { id: 'project', deleted: true, updatedAt: now });
    });
  }

  async getProjectHeaderDefault(projectId: string): Promise<HeaderCompanyKind> {
    const row = await this.db.getFirstAsync<{ header_company: string | null; customer_id: string | null }>('SELECT header_company, customer_id FROM projects WHERE id = ?', projectId);
    if (row?.header_company) return headerKindOrDefault(row.header_company);
    // DEC-507. No remembered choice: a project of the customer that is the Project Company starts on the Project Company header.
    const company = row?.customer_id ? await this.getProjectCompany() : null;
    if (company && row?.customer_id) {
      const owner = await this.effectiveCustomer(row.customer_id);
      if (owner && owner.id === company.customerId) return 'project';
    }
    return 'plant';
  }

  async setProjectHeaderDefault(projectId: string, kind: HeaderCompanyKind | null): Promise<void> {
    if (kind === 'project' && !(await this.getProjectCompany())) throw new Error('Set up the Project Company before using it as a default.');
    const result = await this.db.runAsync('UPDATE projects SET header_company = ? WHERE id = ?', kind, projectId);
    if (!result.changes) throw new Error('The project was not found.');
    await this.enqueue('projectHeaderDefault', projectId, { projectId, headerCompany: kind, updatedAt: new Date().toISOString() });
  }

  async resolveHeader(kind: HeaderCompanyKind): Promise<HeaderCompany> {
    const project = kind === 'project' ? await this.getProjectCompany() : null;
    if (project) {
      const signer = project.signerId ? await this.signerFor(project.signerId, project.signerDisplay ?? 'name_only') : null;
      return {
        kind: 'project', name: project.customerName, logoUri: project.logoUri, address: project.address, phone: project.phone, email: project.email,
        taxVatNumber: project.taxVatNumber, registrationNumber: project.registrationNumber, footer: project.receiptFooter, signer,
        note: project.customerIsActive ? null : 'The linked customer is archived. The header still prints from the saved details.',
      };
    }
    const plant = await this.db.getFirstAsync<PlantRow>(
      `SELECT company_name, logo_uri, address, phone, email, tax_vat_number, receipt_footer, registration_number, header_signer_id, header_signer_display
       FROM company_settings WHERE id = 'company'`);
    const signer = plant?.header_signer_id ? await this.signerFor(plant.header_signer_id, plant.header_signer_display ?? 'name_only') : null;
    return {
      kind: 'plant', name: plant?.company_name ?? '', logoUri: plant?.logo_uri ?? null, address: plant?.address ?? null, phone: plant?.phone ?? null,
      email: plant?.email ?? null, taxVatNumber: plant?.tax_vat_number ?? null, registrationNumber: plant?.registration_number ?? null,
      footer: plant?.receipt_footer ?? null, signer,
      note: kind === 'project' ? 'The Project Company is not set up, so the Plant Company header was used.' : null,
    };
  }

  /** A customer merged into another is followed to its surviving record, so the header stays attached to a live customer. */
  private async effectiveCustomer(id: string): Promise<CustomerRow | null> {
    let current = await this.db.getFirstAsync<CustomerRow>('SELECT id, name, is_active, merged_into_id FROM customers WHERE id = ?', id);
    for (let hops = 0; current?.merged_into_id && hops < 5; hops += 1) {
      const next = await this.db.getFirstAsync<CustomerRow>('SELECT id, name, is_active, merged_into_id FROM customers WHERE id = ?', current.merged_into_id);
      if (!next) break;
      current = next;
    }
    return current;
  }

  private async requireUsableSigner(signerId: string, display: SignerDisplay): Promise<void> {
    const row = await this.db.getFirstAsync<SignerRowInput & { is_active: number }>('SELECT * FROM document_signers WHERE id = ?', signerId);
    if (!row) throw new Error('The selected signer was not found.');
    if (row.is_active !== 1) throw new Error('The selected signer is disabled. Choose another signer.');
    signerSnapshot(signerFromRow(row), display);
  }

  private signerFor(signerId: string, display: SignerDisplay): Promise<SignerSnapshot | null> { return signerCopy(this.db, signerId, display); }

  /** The Plant Company name and the details a load saves with it. */
  private async plantNameAndDetails(): Promise<{ name: string; details: CompanyDetails }> {
    const row = await this.db.getFirstAsync<{ company_name: string; address: string | null; phone: string | null; email: string | null; tax_vat_number: string | null; receipt_footer: string | null }>(
      "SELECT company_name, address, phone, email, tax_vat_number, receipt_footer FROM company_settings WHERE id = 'company'");
    return { name: row?.company_name?.trim() ?? '', details: { address: row?.address ?? null, phone: row?.phone ?? null, email: row?.email ?? null, taxVatNumber: row?.tax_vat_number ?? null, receiptFooter: row?.receipt_footer ?? null } };
  }

  private async loadFacts() {
    const rows = await this.db.getAllAsync<{ id: string; company_name: string | null; company_address: string | null; company_phone: string | null; company_email: string | null; company_tax_vat_number: string | null; company_receipt_footer: string | null }>(
      'SELECT id, company_name, company_address, company_phone, company_email, company_tax_vat_number, company_receipt_footer FROM loads');
    return rows.map((row) => ({ id: row.id, companyName: row.company_name ?? '', address: row.company_address, phone: row.company_phone, email: row.company_email, taxVatNumber: row.company_tax_vat_number, receiptFooter: row.company_receipt_footer }));
  }

  /** How many of my loads carry another name than the current Plant Company, by name. Read-only. */
  async getLoadNameStatus(includeDetails: boolean): Promise<LoadNameStatus> {
    const plant = await this.plantNameAndDetails();
    return planLoadNameUpdate(await this.loadFacts(), plant.name, plant.details, includeDetails).status;
  }

  /**
   * The one explicit update of the name (and, when asked, the address, phone, email, Tax/VAT number and receipt footer) saved
   * on my loads, cancelled and archived loads included. All or nothing, with one audit row per old name. It touches no other column.
   */
  async updateLoadCompanyName(input: LoadNameUpdateInput): Promise<{ updated: number; records: LoadNameUpdateRecord[] }> {
    const plant = await this.plantNameAndDetails();
    const issues = validateLoadNameUpdate(plant.name, input);
    if (issues.length) throw new Error(issues.join('\n'));
    const note = input.note.trim().replace(/\s+/g, ' ') || null;
    const records: LoadNameUpdateRecord[] = [];
    let updated = 0;
    await this.db.withTransactionAsync(async () => {
      const plan = planLoadNameUpdate(await this.loadFacts(), plant.name, plant.details, input.includeDetails);
      if (!plan.ids.length) throw new Error('All loads already carry this name.');
      const now = new Date().toISOString();
      for (const id of plan.ids) {
        if (input.includeDetails) {
          await this.db.runAsync('UPDATE loads SET company_name = ?, company_address = ?, company_phone = ?, company_email = ?, company_tax_vat_number = ?, company_receipt_footer = ? WHERE id = ?',
            plant.name, plant.details.address, plant.details.phone, plant.details.email, plant.details.taxVatNumber, plant.details.receiptFooter, id);
        } else await this.db.runAsync('UPDATE loads SET company_name = ? WHERE id = ?', plant.name, id);
        updated += 1;
      }
      for (const group of plan.status.groups) {
        const id = `name_update_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        await this.db.runAsync('INSERT INTO load_company_name_updates (id, updated_at, old_name, new_name, loads_count, details_included, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, now, group.oldName, plant.name, group.count, input.includeDetails ? 1 : 0, note);
        records.push({ id, updatedAt: now, oldName: group.oldName, newName: plant.name, loadsCount: group.count, detailsIncluded: input.includeDetails, note, detailsOnly: group.detailsOnly });
      }
      await this.enqueue('loadCompanyNameUpdate', records[0]!.id, { loads: updated, newName: plant.name, includeDetails: input.includeDetails, groups: records.map((record) => ({ oldName: record.oldName, count: record.loadsCount })), updatedAt: now });
    });
    return { updated, records };
  }

  async listLoadNameUpdates(): Promise<LoadNameUpdateRecord[]> {
    const rows = await this.db.getAllAsync<{ id: string; updated_at: string; old_name: string; new_name: string; loads_count: number; details_included: number; note: string | null }>(
      'SELECT id, updated_at, old_name, new_name, loads_count, details_included, note FROM load_company_name_updates ORDER BY updated_at DESC, old_name');
    return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at, oldName: row.old_name, newName: row.new_name, loadsCount: row.loads_count, detailsIncluded: row.details_included === 1, note: row.note, detailsOnly: row.old_name === row.new_name }));
  }

  private async enqueue(entityType: string, entityId: string, payload: unknown): Promise<void> {
    await this.db.runAsync("INSERT INTO sync_outbox (entity_type, entity_id, operation, payload_json, created_at) VALUES (?, ?, 'upsert', ?, ?)",
      entityType, entityId, JSON.stringify(payload), new Date().toISOString());
  }
}
