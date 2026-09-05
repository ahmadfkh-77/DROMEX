import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { SqliteFinancialRepository } from '../src/data/repositories/SqliteFinancialRepository';
import { projectAttentionTargets, projectPaymentEvents, summarizeProjectFinancials, type FinancialTarget } from '../src/domain/financials';

class TestDatabase {
  readonly raw = new DatabaseSync(':memory:');
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const result = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({ changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

const loadColumns = 'id,transaction_number,confirmed_at,project_id,project_name,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,unit_price_usd_cents,final_total_usd_cents,payment_status,company_name,status';

describe('project financial review data layer', () => {
  const databases: TestDatabase[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  async function base() {
    const database = new TestDatabase();
    databases.push(database);
    await migrateDatabase(database as never);
    const now = '2026-08-19T00:00:00.000Z';
    database.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer_1','company','Road Works Ltd',0,1,'${now}','${now}');
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer_2','company','Other Client',0,1,'${now}','${now}');
      INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('supplier_1','Quarry Co',1,'${now}','${now}');
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('project_1','customer_1','Road Project','Beirut','active','2026-07-01','${now}','${now}',0);
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('project_2','customer_2','Bridge Project','Tripoli','completed','2026-06-01','${now}','${now}',0);
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('project_empty','customer_1','Untouched Project','Saida','active','2026-07-01','${now}','${now}',0);
      INSERT INTO categories (id,name,created_at,updated_at) VALUES ('category_1','Produced','${now}','${now}');
      INSERT INTO catalog_items (id,category_id,name,loads_enabled,is_active,created_at,updated_at) VALUES ('item_1','category_1','Asphalt',1,1,'${now}','${now}');
    `);
    database.raw.exec('PRAGMA foreign_keys=OFF;');
    return { database, now, repository: new SqliteFinancialRepository(database as never) };
  }

  function insertLoad(database: TestDatabase, options: { id: string; confirmedAt: string; totalCents: number | null; projectId: string | null; customerId?: string; status?: string }) {
    const { id, confirmedAt, totalCents, projectId, customerId = 'customer_1', status = 'Active' } = options;
    const paymentStatusValue = totalCents === null ? 'Unpriced' : totalCents === 0 ? 'No Payment Due' : 'Unpaid';
    const projectName = projectId === 'project_1' ? 'Road Project' : projectId === 'project_2' ? 'Bridge Project' : projectId ? 'Untouched Project' : null;
    database.raw.prepare(`INSERT INTO loads (${loadColumns}) VALUES (${loadColumns.split(',').map(() => '?').join(',')})`).run(
      id, `TXN-${id}`, confirmedAt, projectId, projectName, customerId, customerId === 'customer_1' ? 'Road Works Ltd' : 'Other Client',
      'item_1', 'Asphalt', 'Produced', 'Driver A', 'A111', 10000, 30000, 20000, 'conv_1', 'Kilograms to metric tons', '1000 kg = 1 t', 't', 20, 20,
      totalCents === null ? null : 2500, totalCents, paymentStatusValue, 'DROMEX', status,
    );
  }

  function insertPayment(database: TestDatabase, id: string, loadId: string, cents: number, paymentDate: string, status = 'Active') {
    database.raw.prepare(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,cancellation_reason,cancelled_at,created_at) VALUES (?,'load',?,?,?,?,?,?,?)`)
      .run(id, loadId, cents, paymentDate, status, status === 'Cancelled' ? 'Recorded twice' : null, status === 'Cancelled' ? `${paymentDate}T12:00:00.000Z` : null, `${paymentDate}T10:00:00.000Z`);
  }

  // One project covering every status plus every exclusion path.
  async function fullProject() {
    const context = await base();
    const { database } = context;
    insertLoad(database, { id: 'unpaid', confirmedAt: '2026-08-10T10:00:00.000Z', totalCents: 100000, projectId: 'project_1' });
    insertLoad(database, { id: 'partial', confirmedAt: '2026-08-11T10:00:00.000Z', totalCents: 200000, projectId: 'project_1' });
    insertLoad(database, { id: 'paid', confirmedAt: '2026-08-12T10:00:00.000Z', totalCents: 50000, projectId: 'project_1' });
    insertLoad(database, { id: 'overpaid', confirmedAt: '2026-08-13T10:00:00.000Z', totalCents: 30000, projectId: 'project_1' });
    insertLoad(database, { id: 'zero', confirmedAt: '2026-08-14T10:00:00.000Z', totalCents: 0, projectId: 'project_1' });
    insertLoad(database, { id: 'unpriced', confirmedAt: '2026-08-15T10:00:00.000Z', totalCents: null, projectId: 'project_1' });
    insertLoad(database, { id: 'cancelled', confirmedAt: '2026-08-16T10:00:00.000Z', totalCents: 90000, projectId: 'project_1', status: 'Cancelled' });
    insertLoad(database, { id: 'other_project', confirmedAt: '2026-08-17T10:00:00.000Z', totalCents: 70000, projectId: 'project_2', customerId: 'customer_2' });
    insertLoad(database, { id: 'no_project', confirmedAt: '2026-08-18T10:00:00.000Z', totalCents: 60000, projectId: null });
    insertPayment(database, 'pay_partial', 'partial', 80000, '2026-08-11');
    insertPayment(database, 'pay_paid', 'paid', 50000, '2026-08-12');
    // Correction later reduced this load's total below what was already collected (DEC-075).
    insertPayment(database, 'pay_over_1', 'overpaid', 30000, '2026-08-13');
    insertPayment(database, 'pay_over_2', 'overpaid', 15000, '2026-08-14');
    insertPayment(database, 'pay_cancelled_entry', 'unpaid', 25000, '2026-08-10', 'Cancelled');
    // Records that must never enter a revenue-only project rollup.
    database.raw.exec(`INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,item_id,item_name,category_name,quantity_cubic_metres,driver_profile_id,driver_name,truck_profile_id,truck_plate,unit_price_usd_cents,final_total_usd_cents,payment_status,status,unit_symbol,project_id,project_name) VALUES ('purchase_1','SL-1','2026-08-11T09:00:00.000Z','supplier_1','Quarry Co','item_1','Gravel','Purchased',6,'driver_1','Driver B','truck_1','B222',3000,18000,'Unpaid','Active','m³','project_1','Road Project');`);
    database.raw.exec(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,supplier_id,supplier_name,project_id,project_name,final_total_usd_cents,payment_status,status,created_at) VALUES ('fuel_1','delivery','2026-08-11T08:00:00.000Z',300,'supplier_1','Quarry Co','project_1','Road Project',90000,'Unpaid','Active','2026-08-11T08:00:00.000Z');`);
    database.raw.exec(`INSERT INTO opening_balances (id,party_type,customer_id,supplier_id,party_name,original_amount_usd_cents,as_of_date,reference,notes,created_at) VALUES ('opening_1','customer','customer_1',NULL,'Road Works Ltd',250000,'2026-01-01',NULL,NULL,'2026-01-01T00:00:00.000Z');`);
    return context;
  }

  it('includes only company loads billed to this project, with correct money totals', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_1');
    expect(summary.targets.map((target) => target.id).sort()).toEqual(['overpaid', 'paid', 'partial', 'unpaid', 'zero']);
    // 1000 + 2000 + 500 + 300 + 0 billed; 800 + 500 + 450 paid; 1000 + 1200 outstanding; 150 overpaid.
    expect(summary.billedUsd).toBe(3800);
    expect(summary.paidUsd).toBe(1750);
    expect(summary.outstandingUsd).toBe(2200);
    expect(summary.overpaidUsd).toBe(150);
    expect(summary.recordCount).toBe(5);
    expect(summary.projectId).toBe('project_1');
  });

  it('reports every payment status present on the project', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_1');
    expect(summary.statusCounts).toEqual({ Unpriced: 0, 'No Payment Due': 1, Unpaid: 1, 'Partially Paid': 1, Paid: 1, Overpaid: 1 });
    const byId = new Map(summary.targets.map((target) => [target.id, target]));
    expect(byId.get('unpaid')).toMatchObject({ totalUsd: 1000, paidUsd: 0, remainingUsd: 1000, status: 'Unpaid' });
    expect(byId.get('partial')).toMatchObject({ totalUsd: 2000, paidUsd: 800, remainingUsd: 1200, status: 'Partially Paid' });
    expect(byId.get('paid')).toMatchObject({ totalUsd: 500, paidUsd: 500, remainingUsd: 0, status: 'Paid' });
    expect(byId.get('overpaid')).toMatchObject({ totalUsd: 300, paidUsd: 450, remainingUsd: 0, overpaidUsd: 150, status: 'Overpaid' });
    expect(byId.get('zero')).toMatchObject({ totalUsd: 0, paidUsd: 0, remainingUsd: 0, status: 'No Payment Due' });
  });

  it('excludes cancelled and unpriced loads from totals but reports them as excluded records', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_1');
    expect(summary.targets.some((target) => target.id === 'cancelled')).toBe(false);
    expect(summary.targets.some((target) => target.id === 'unpriced')).toBe(false);
    expect(summary.excludedCancelledLoads).toBe(1);
    expect(summary.excludedUnpricedLoads).toBe(1);
  });

  it('excludes other projects, unassigned loads, supplier purchases, fuel deliveries and opening balances', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_1');
    expect(summary.targets.some((target) => target.id === 'other_project')).toBe(false);
    expect(summary.targets.some((target) => target.id === 'no_project')).toBe(false);
    expect(summary.targets.every((target) => target.type === 'load')).toBe(true);
    expect(summary.targets.every((target) => target.projectId === 'project_1')).toBe(true);
    expect(summary.targets.every((target) => target.partyType === 'customer' && target.partyId === 'customer_1')).toBe(true);
  });

  it('carries supporting payment detail, keeping cancelled payments visible but uncounted', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_1');
    const unpaid = summary.targets.find((target) => target.id === 'unpaid');
    expect(unpaid?.payments.map((payment) => payment.id)).toEqual(['pay_cancelled_entry']);
    expect(unpaid?.payments[0]).toMatchObject({ status: 'Cancelled', amountUsd: 250, cancellationReason: 'Recorded twice' });
    expect(unpaid?.paidUsd).toBe(0);
    const overpaid = summary.targets.find((target) => target.id === 'overpaid');
    expect(overpaid?.payments.map((payment) => payment.id)).toEqual(['pay_over_2', 'pay_over_1']);
  });

  it('derives period bounds from the project\'s included records', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_1');
    // 2026-08-10 (unpaid) through 2026-08-14 (zero); the 15th/16th records are excluded.
    expect(summary.firstRecordDate).toBe('2026-08-10');
    expect(summary.lastRecordDate).toBe('2026-08-14');
    expect(summary.targets.map((target) => target.recordDate.slice(0, 10))).toEqual(['2026-08-14', '2026-08-13', '2026-08-12', '2026-08-11', '2026-08-10']);
  });

  it('returns a zeroed summary for a project with no financial records', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_empty');
    expect(summary).toMatchObject({ projectId: 'project_empty', billedUsd: 0, paidUsd: 0, outstandingUsd: 0, overpaidUsd: 0, recordCount: 0, firstRecordDate: null, lastRecordDate: null, excludedCancelledLoads: 0, excludedUnpricedLoads: 0 });
    expect(summary.targets).toEqual([]);
    expect(summary.statusCounts).toEqual({ Unpriced: 0, 'No Payment Due': 0, Unpaid: 0, 'Partially Paid': 0, Paid: 0, Overpaid: 0 });
  });

  it('counts an unpriced-only project as excluded rather than as billing', async () => {
    const { database, repository } = await base();
    insertLoad(database, { id: 'unpriced_only', confirmedAt: '2026-08-10T10:00:00.000Z', totalCents: null, projectId: 'project_1' });
    const summary = await repository.getProjectFinancials('project_1');
    expect(summary.recordCount).toBe(0);
    expect(summary.billedUsd).toBe(0);
    expect(summary.excludedUnpricedLoads).toBe(1);
    expect(summary.firstRecordDate).toBeNull();
  });

  it('reconciles exactly with the customer financial view path over getOverview', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_1');
    const overview = await repository.getOverview();
    // The shipped CustomerFinancialView groups a customer's load targets by project.
    const viaCustomer = overview.targets.filter((target) => target.partyType === 'customer' && target.partyId === 'customer_1' && target.type === 'load' && target.projectId === 'project_1');
    expect(summary.targets.map((target) => target.id)).toEqual(viaCustomer.map((target) => target.id));
    expect(summary.billedUsd).toBe(viaCustomer.reduce((sum, target) => sum + target.totalUsd, 0));
    expect(summary.paidUsd).toBe(viaCustomer.reduce((sum, target) => sum + target.paidUsd, 0));
    expect(summary.outstandingUsd).toBe(viaCustomer.reduce((sum, target) => sum + target.remainingUsd, 0));
    expect(summary.overpaidUsd).toBe(viaCustomer.reduce((sum, target) => sum + target.overpaidUsd, 0));
    for (const target of summary.targets) {
      const counterpart = viaCustomer.find((value) => value.id === target.id);
      expect(target).toEqual(counterpart);
    }
  });

  it('leaves getOverview and the other repository methods unchanged', async () => {
    const { repository } = await fullProject();
    const overview = await repository.getOverview();
    // Supplier and fuel records still reach the business-wide overview even though the project rollup omits them.
    expect(overview.targets.some((target) => target.id === 'purchase_1')).toBe(true);
    expect(overview.targets.some((target) => target.id === 'fuel_1')).toBe(true);
    expect(overview.targets.some((target) => target.id === 'opening_1')).toBe(true);
    expect(overview.targets.some((target) => target.id === 'no_project')).toBe(true);
    expect(overview.parties.map((party) => party.id)).toContain('supplier_1');
  });

  it('feeds the review with attention records ordered by the largest outstanding balance', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_1');
    const attention = projectAttentionTargets(summary.targets);
    // Only unsettled records, largest balance first; paid, zero-value and overpaid records drop out.
    expect(attention.map((target) => target.id)).toEqual(['partial', 'unpaid']);
    expect(attention.map((target) => target.remainingUsd)).toEqual([1200, 1000]);
  });

  it('feeds the review with every payment event, newest first, keeping its record', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_1');
    const events = projectPaymentEvents(summary.targets);
    expect(events.map((event) => event.payment.id)).toEqual(['pay_over_2', 'pay_over_1', 'pay_paid', 'pay_partial', 'pay_cancelled_entry']);
    expect(events.map((event) => event.target.id)).toEqual(['overpaid', 'overpaid', 'paid', 'partial', 'unpaid']);
    // Cancelled events stay listed for history even though they add nothing to paid totals.
    expect(events.find((event) => event.payment.id === 'pay_cancelled_entry')?.payment.status).toBe('Cancelled');
  });

  it('gives the review empty attention and payment lists for a project with no records', async () => {
    const { repository } = await fullProject();
    const summary = await repository.getProjectFinancials('project_empty');
    expect(projectAttentionTargets(summary.targets)).toEqual([]);
    expect(projectPaymentEvents(summary.targets)).toEqual([]);
  });

  it('summarizes pure target lists without drifting on repeated cent fractions', () => {
    const target = (id: string, total: number, paid: number, remaining: number, status: FinancialTarget['status'], date: string): FinancialTarget => ({
      id, type: 'load', partyId: 'c', partyName: 'C', partyType: 'customer', reference: id, recordDate: date, projectId: 'p',
      projectName: 'P', projectStatus: 'active', itemName: 'Asphalt', quantity: 1, unitSymbol: 't',
      totalUsd: total, paidUsd: paid, remainingUsd: remaining, overpaidUsd: 0, status, payments: [],
    });
    const targets = Array.from({ length: 300 }, (_, index) => target(`l${index}`, 0.1, 0.03, 0.07, 'Partially Paid', '2026-08-11'));
    const summary = summarizeProjectFinancials('p', targets, { cancelledLoads: 2, unpricedLoads: 3 });
    expect(summary.billedUsd).toBe(30);
    expect(summary.paidUsd).toBe(9);
    expect(summary.outstandingUsd).toBe(21);
    expect(summary.statusCounts['Partially Paid']).toBe(300);
    expect(summary.excludedCancelledLoads).toBe(2);
    expect(summary.excludedUnpricedLoads).toBe(3);
  });
});
