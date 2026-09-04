import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { SqliteBusinessReportRepository } from '../src/data/repositories/SqliteBusinessReportRepository';
import { SqliteFinancialRepository } from '../src/data/repositories/SqliteFinancialRepository';
import { SqliteProjectReportRepository } from '../src/data/repositories/SqliteProjectReportRepository';
import { SqliteWorkspaceRepository } from '../src/data/repositories/SqliteWorkspaceRepository';

class TestDatabase {
  readonly raw = new DatabaseSync(':memory:');
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const result = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({ changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

describe('B3A: cancelled loads excluded from active aggregates, retained in search and raw export', () => {
  const databases: TestDatabase[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  async function setup() {
    const database = new TestDatabase();
    databases.push(database);
    await migrateDatabase(database as never);
    const now = '2026-08-19T00:00:00.000Z';
    database.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer_1','company','Road Works Ltd',0,1,'${now}','${now}');
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('project_1','customer_1','Road Project','Beirut','active','2026-07-01','${now}','${now}',0);
      INSERT INTO categories (id,name,created_at,updated_at) VALUES ('category_1','Produced','${now}','${now}');
      INSERT INTO catalog_items (id,category_id,name,loads_enabled,is_active,created_at,updated_at) VALUES ('item_1','category_1','Asphalt',1,1,'${now}','${now}');
    `);
    database.raw.exec('PRAGMA foreign_keys=OFF;');
    // Active load: $1000 total, $300 paid, confirmed 2026-08-19.
    database.raw.exec(`INSERT INTO loads (id,transaction_number,confirmed_at,project_id,project_name,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,unit_price_usd_cents,final_total_usd_cents,payment_status,company_name,status)
      VALUES ('load_active','20260819-A-00001','2026-08-19T10:00:00.000Z','project_1','Road Project','customer_1','Road Works Ltd','item_1','Asphalt','Produced','Driver A','A111',10000,30000,20000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',20,20,50000,100000,'Unpaid','DROMEX','Active');`);
    // Cancelled load: $500 total, same day, same project.
    database.raw.exec(`INSERT INTO loads (id,transaction_number,confirmed_at,project_id,project_name,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,unit_price_usd_cents,final_total_usd_cents,payment_status,company_name,status,cancellation_reason,cancelled_at)
      VALUES ('load_cancelled','20260819-A-00002','2026-08-19T11:00:00.000Z','project_1','Road Project','customer_1','Road Works Ltd','item_1','Asphalt','Produced','Driver A','A111',5000,15000,10000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',10,10,50000,50000,'Unpaid','DROMEX','Cancelled','Duplicate entry','2026-08-19T12:00:00.000Z');`);
    database.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at) VALUES ('payment_1','load','load_active',30000,'2026-08-19','Active','${now}');`);
    return { database };
  }

  it('keeps the active load counted in project metrics and the activity timeline, excludes the cancelled one', async () => {
    const { database } = await setup();
    const repository = new SqliteWorkspaceRepository(database as never);
    const snapshot = await repository.getProjectWorkspace('project_1');
    expect(snapshot.metrics.loads).toBe(1);
    expect(snapshot.metrics.netTonnes).toBeCloseTo(20, 6);
    const timeline = await repository.listProjectActivities('project_1');
    const loadActivities = timeline.filter((entry) => entry.type === 'Load');
    expect(loadActivities.map((entry) => entry.title)).toEqual(['20260819-A-00001']);
  });

  it('excludes the cancelled load from unpriced and outstanding attention counts', async () => {
    const { database } = await setup();
    const repository = new SqliteWorkspaceRepository(database as never);
    const attention = await repository.getAttentionSnapshot();
    // Both loads are priced (payment_status='Unpaid'), so unpriced stays 0; outstanding must count only the active one.
    expect(attention.unpricedLoads).toBe(0);
    expect(attention.outstandingRecords).toBe(1);
  });

  it('keeps both loads searchable, and marks only the cancelled one CANCELLED in its subtitle', async () => {
    const { database } = await setup();
    const repository = new SqliteWorkspaceRepository(database as never);
    const results = await repository.search('20260819-A-0000');
    const active = results.find((r) => r.title === '20260819-A-00001');
    const cancelled = results.find((r) => r.title === '20260819-A-00002');
    expect(active).toBeTruthy();
    expect(cancelled).toBeTruthy();
    expect(active?.subtitle.startsWith('CANCELLED')).toBe(false);
    expect(cancelled?.subtitle.startsWith('CANCELLED · ')).toBe(true);
  });

  it('excludes the cancelled load from Financials targets while the active load and its payment remain correct', async () => {
    const { database } = await setup();
    const repository = new SqliteFinancialRepository(database as never);
    const overview = await repository.getOverview();
    expect(overview.targets.some((t) => t.id === 'load_cancelled')).toBe(false);
    const activeTarget = overview.targets.find((t) => t.id === 'load_active');
    expect(activeTarget).toMatchObject({ totalUsd: 1000, paidUsd: 300, remainingUsd: 700, status: 'Partially Paid' });
  });

  it('excludes the cancelled load from daily-report and project-completion load linkage', async () => {
    const { database } = await setup();
    const repository = new SqliteProjectReportRepository(database as never);
    const linked = await repository.listLinkedLoads('project_1', '2026-08-19');
    expect(linked.map((l) => l.transactionNumber)).toEqual(['20260819-A-00001']);
    const completion = await repository.listProjectLoads('project_1');
    expect(completion.map((l) => l.transactionNumber)).toEqual(['20260819-A-00001']);
  });

  it('keeps the cancelled load in the raw business-report export, marked, but excludes it from customer/project aggregate totals', async () => {
    const { database } = await setup();
    const repository = new SqliteBusinessReportRepository(database as never);
    const data = await repository.getReportData();
    expect(data.loads).toHaveLength(2);
    const activeRow = data.loads.find((row) => row['Record ID'] === 'load_active');
    const cancelledRow = data.loads.find((row) => row['Record ID'] === 'load_cancelled');
    expect(activeRow?.['Record Status']).toBe('Active');
    expect(activeRow?.['Cancellation Reason']).toBeNull();
    expect(cancelledRow?.['Record Status']).toBe('Cancelled');
    expect(cancelledRow?.['Cancellation Reason']).toBe('Duplicate entry');
    const customerRow = data.customers.find((row) => row['Customer ID'] === 'customer_1');
    expect(customerRow?.['Total Billed USD']).toBe(1000);
    const projectRow = data.projects.find((row) => row['Project ID'] === 'project_1');
    expect(projectRow?.['Load Quantities by Item / Unit']).toBe('Asphalt (t): 20.000');
  });

  it('does not modify the payment record while running every B3A query', async () => {
    const { database } = await setup();
    const before = database.raw.prepare('SELECT amount_usd_cents,status,payment_date FROM payment_entries WHERE id=?').get('payment_1');
    const workspace = new SqliteWorkspaceRepository(database as never);
    const financial = new SqliteFinancialRepository(database as never);
    const reports = new SqliteProjectReportRepository(database as never);
    const business = new SqliteBusinessReportRepository(database as never);
    await workspace.getProjectWorkspace('project_1');
    await workspace.getAttentionSnapshot();
    await workspace.search('road');
    await financial.getOverview();
    await reports.listLinkedLoads('project_1', '2026-08-19');
    await reports.listProjectLoads('project_1');
    await business.getReportData();
    const after = database.raw.prepare('SELECT amount_usd_cents,status,payment_date FROM payment_entries WHERE id=?').get('payment_1');
    expect(after).toEqual(before);
  });
});
