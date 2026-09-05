import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { SqliteFinancialRepository } from '../src/data/repositories/SqliteFinancialRepository';

class TestDatabase {
  readonly raw = new DatabaseSync(':memory:');
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const result = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({ changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

type ReferencePayment = { id: string; target_type: string; target_id: string; amount_usd_cents: number; status: string };

// Reproduces the pre-index algorithm: one full scan of the ordered payment list per target.
const REFERENCE_PAYMENT_SQL = `SELECT id,target_type,CASE target_type WHEN 'load' THEN load_id WHEN 'quarryPurchase' THEN quarry_purchase_id WHEN 'fuelDelivery' THEN fuel_movement_id ELSE opening_balance_id END target_id,amount_usd_cents,payment_date,status,created_at FROM payment_entries ORDER BY payment_date DESC,created_at DESC`;

const loadColumns = 'id,transaction_number,confirmed_at,project_id,project_name,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,unit_price_usd_cents,final_total_usd_cents,payment_status,company_name,status';

describe('financial overview payment indexing', () => {
  const databases: TestDatabase[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  async function base() {
    const database = new TestDatabase();
    databases.push(database);
    await migrateDatabase(database as never);
    const now = '2026-08-19T00:00:00.000Z';
    database.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer_1','company','Road Works Ltd',0,1,'${now}','${now}');
      INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('supplier_1','Quarry Co',1,'${now}','${now}');
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('project_1','customer_1','Road Project','Beirut','active','2026-07-01','${now}','${now}',0);
      INSERT INTO categories (id,name,created_at,updated_at) VALUES ('category_1','Produced','${now}','${now}');
      INSERT INTO catalog_items (id,category_id,name,loads_enabled,is_active,created_at,updated_at) VALUES ('item_1','category_1','Asphalt',1,1,'${now}','${now}');
    `);
    database.raw.exec('PRAGMA foreign_keys=OFF;');
    return { database, now };
  }

  function insertLoad(database: TestDatabase, id: string, reference: string, confirmedAt: string, totalCents: number | null, status = 'Active') {
    const paymentStatusValue = totalCents === null ? 'Unpriced' : totalCents === 0 ? 'No Payment Due' : 'Unpaid';
    database.raw.prepare(`INSERT INTO loads (${loadColumns}) VALUES (${loadColumns.split(',').map(() => '?').join(',')})`).run(
      id, reference, confirmedAt, 'project_1', 'Road Project', 'customer_1', 'Road Works Ltd', 'item_1', 'Asphalt', 'Produced',
      'Driver A', 'A111', 10000, 30000, 20000, 'conv_1', 'Kilograms to metric tons', '1000 kg = 1 t', 't', 20, 20,
      totalCents === null ? null : 2500, totalCents, paymentStatusValue, 'DROMEX', status,
    );
  }

  function insertPayment(database: TestDatabase, id: string, targetType: string, targetId: string, cents: number, paymentDate: string, createdAt: string, status = 'Active') {
    const column = targetType === 'load' ? 'load_id' : targetType === 'quarryPurchase' ? 'quarry_purchase_id' : targetType === 'fuelDelivery' ? 'fuel_movement_id' : 'opening_balance_id';
    database.raw.prepare(`INSERT INTO payment_entries (id,target_type,${column},amount_usd_cents,payment_date,status,cancellation_reason,cancelled_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, targetType, targetId, cents, paymentDate, status, status === 'Cancelled' ? 'Recorded twice' : null, status === 'Cancelled' ? createdAt : null, createdAt);
  }

  async function mixedDataset() {
    const { database, now } = await base();
    insertLoad(database, 'load_priced', '20260819-A-00001', '2026-08-19T10:00:00.000Z', 100000);
    insertLoad(database, 'load_second', '20260819-A-00002', '2026-08-18T10:00:00.000Z', 60000);
    insertLoad(database, 'load_zero', '20260819-A-00003', '2026-08-17T10:00:00.000Z', 0);
    insertLoad(database, 'load_unpriced', '20260819-A-00004', '2026-08-16T10:00:00.000Z', null);
    insertLoad(database, 'load_cancelled', '20260819-A-00005', '2026-08-15T10:00:00.000Z', 40000, 'Cancelled');
    database.raw.exec(`INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,item_id,item_name,category_name,quantity_cubic_metres,driver_profile_id,driver_name,truck_profile_id,truck_plate,unit_price_usd_cents,final_total_usd_cents,payment_status,status,unit_symbol) VALUES ('purchase_1','SL-1','2026-08-19T09:00:00.000Z','supplier_1','Quarry Co','item_1','Gravel','Purchased',6,'driver_1','Driver B','truck_1','B222',3000,18000,'Unpaid','Active','m³');`);
    database.raw.exec(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,supplier_id,supplier_name,final_total_usd_cents,payment_status,status,created_at) VALUES ('fuel_1','delivery','2026-08-19T08:00:00.000Z',300,'supplier_1','Quarry Co',90000,'Unpaid','Active','${now}');`);
    database.raw.exec(`INSERT INTO opening_balances (id,party_type,customer_id,supplier_id,party_name,original_amount_usd_cents,as_of_date,reference,notes,created_at) VALUES ('opening_1','customer','customer_1',NULL,'Road Works Ltd',250000,'2026-01-01',NULL,NULL,'${now}');`);
    // Several payments on one target, out of insertion order, plus a cancelled one that must stay visible but uncounted.
    insertPayment(database, 'pay_a', 'load', 'load_priced', 20000, '2026-08-19', '2026-08-19T12:00:00.000Z');
    insertPayment(database, 'pay_b', 'load', 'load_priced', 15000, '2026-08-20', '2026-08-20T09:00:00.000Z');
    insertPayment(database, 'pay_c', 'load', 'load_priced', 5000, '2026-08-19', '2026-08-19T18:00:00.000Z');
    insertPayment(database, 'pay_d', 'load', 'load_priced', 9000, '2026-08-18', '2026-08-18T09:00:00.000Z', 'Cancelled');
    insertPayment(database, 'pay_e', 'load', 'load_second', 60000, '2026-08-18', '2026-08-18T10:00:00.000Z');
    insertPayment(database, 'pay_f', 'quarryPurchase', 'purchase_1', 18000, '2026-08-19', '2026-08-19T11:00:00.000Z');
    insertPayment(database, 'pay_g', 'fuelDelivery', 'fuel_1', 40000, '2026-08-19', '2026-08-19T11:30:00.000Z');
    insertPayment(database, 'pay_h', 'openingBalance', 'opening_1', 250000, '2026-08-19', '2026-08-19T13:00:00.000Z');
    return { database, repository: new SqliteFinancialRepository(database as never) };
  }

  it('links every target to exactly the payments the pre-index scan would have found, in the same order', async () => {
    const { database, repository } = await mixedDataset();
    const overview = await repository.getOverview();
    const reference = database.raw.prepare(REFERENCE_PAYMENT_SQL).all() as ReferencePayment[];
    expect(overview.targets.length).toBeGreaterThan(0);
    for (const target of overview.targets) {
      const expected = reference.filter((payment) => payment.target_type === target.type && payment.target_id === target.id);
      expect(target.payments.map((payment) => payment.id)).toEqual(expected.map((payment) => payment.id));
      expect(target.payments.map((payment) => payment.amountUsd)).toEqual(expected.map((payment) => payment.amount_usd_cents / 100));
      const activeCents = expected.filter((payment) => payment.status === 'Active').reduce((sum, payment) => sum + payment.amount_usd_cents, 0);
      expect(Math.round(target.paidUsd * 100)).toBe(activeCents);
    }
  });

  it('preserves totals, statuses, overpaid handling and result ordering', async () => {
    const { repository } = await mixedDataset();
    const overview = await repository.getOverview();
    expect(overview.targets.map((target) => target.id)).toEqual(['load_priced', 'purchase_1', 'fuel_1', 'load_second', 'load_zero', 'opening_1']);
    const priced = overview.targets.find((target) => target.id === 'load_priced');
    // $1000 billed, $400 active payments ($90 cancelled and excluded), one cancelled entry still visible.
    expect(priced).toMatchObject({ totalUsd: 1000, paidUsd: 400, remainingUsd: 600, overpaidUsd: 0, status: 'Partially Paid' });
    expect(priced?.payments).toHaveLength(4);
    expect(priced?.payments.filter((payment) => payment.status === 'Cancelled').map((payment) => payment.id)).toEqual(['pay_d']);
    expect(overview.targets.find((target) => target.id === 'load_second')).toMatchObject({ paidUsd: 600, remainingUsd: 0, status: 'Paid' });
    expect(overview.targets.find((target) => target.id === 'load_zero')).toMatchObject({ totalUsd: 0, paidUsd: 0, status: 'No Payment Due' });
    expect(overview.targets.some((target) => target.id === 'load_unpriced')).toBe(false);
    expect(overview.targets.some((target) => target.id === 'load_cancelled')).toBe(false);
  });

  it('keeps payments on their own target when different record types share an id', async () => {
    const { database } = await base();
    const now = '2026-08-19T00:00:00.000Z';
    insertLoad(database, 'shared_1', '20260819-A-00001', '2026-08-19T10:00:00.000Z', 100000);
    database.raw.exec(`INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,item_id,item_name,category_name,quantity_cubic_metres,driver_profile_id,driver_name,truck_profile_id,truck_plate,unit_price_usd_cents,final_total_usd_cents,payment_status,status,unit_symbol) VALUES ('shared_1','SL-1','2026-08-19T09:00:00.000Z','supplier_1','Quarry Co','item_1','Gravel','Purchased',6,'driver_1','Driver B','truck_1','B222',3000,18000,'Unpaid','Active','m³');`);
    database.raw.exec(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,supplier_id,supplier_name,final_total_usd_cents,payment_status,status,created_at) VALUES ('shared_1','delivery','2026-08-19T08:00:00.000Z',300,'supplier_1','Quarry Co',90000,'Unpaid','Active','${now}');`);
    database.raw.exec(`INSERT INTO opening_balances (id,party_type,customer_id,supplier_id,party_name,original_amount_usd_cents,as_of_date,reference,notes,created_at) VALUES ('shared_1','customer','customer_1',NULL,'Road Works Ltd',250000,'2026-01-01',NULL,NULL,'${now}');`);
    insertPayment(database, 'pay_load', 'load', 'shared_1', 10000, '2026-08-19', '2026-08-19T12:00:00.000Z');
    insertPayment(database, 'pay_purchase', 'quarryPurchase', 'shared_1', 1800, '2026-08-19', '2026-08-19T12:01:00.000Z');
    insertPayment(database, 'pay_fuel', 'fuelDelivery', 'shared_1', 9000, '2026-08-19', '2026-08-19T12:02:00.000Z');
    insertPayment(database, 'pay_opening', 'openingBalance', 'shared_1', 25000, '2026-08-19', '2026-08-19T12:03:00.000Z');
    const overview = await new SqliteFinancialRepository(database as never).getOverview();
    const byType = new Map(overview.targets.map((target) => [target.type, target]));
    expect(byType.get('load')?.payments.map((payment) => payment.id)).toEqual(['pay_load']);
    expect(byType.get('quarryPurchase')?.payments.map((payment) => payment.id)).toEqual(['pay_purchase']);
    expect(byType.get('fuelDelivery')?.payments.map((payment) => payment.id)).toEqual(['pay_fuel']);
    expect(byType.get('openingBalance')?.payments.map((payment) => payment.id)).toEqual(['pay_opening']);
  });

  // Guard against reintroducing the per-target payment scan. At this size the indexed read is a few
  // tens of milliseconds while a full scan per target is ~12,000 x 6,000 = 72M comparisons, which
  // measured in seconds before the fix. The budget is deliberately loose so a slow machine still
  // passes on the linear implementation but a quadratic one cannot.
  it('reads a large overview without a per-target payment scan', async () => {
    const { database, now } = await base();
    const loadStatement = database.raw.prepare(`INSERT INTO loads (${loadColumns}) VALUES (${loadColumns.split(',').map(() => '?').join(',')})`);
    const paymentStatement = database.raw.prepare(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at) VALUES (?,'load',?,?,?,'Active',?)`);
    database.raw.exec('BEGIN');
    for (let index = 0; index < 12000; index += 1) {
      loadStatement.run(`load_${index}`, `TXN-${index}`, '2026-08-19T10:00:00.000Z', 'project_1', 'Road Project', 'customer_1', 'Road Works Ltd', 'item_1', 'Asphalt', 'Produced', 'Driver A', 'A111', 10000, 30000, 20000, 'conv_1', 'Kilograms to metric tons', '1000 kg = 1 t', 't', 20, 20, 2500, 100000, 'Unpaid', 'DROMEX', 'Active');
      if (index % 2 === 0) paymentStatement.run(`pay_${index}`, `load_${index}`, 50000, '2026-08-19', now);
    }
    database.raw.exec('COMMIT');
    const repository = new SqliteFinancialRepository(database as never);
    const started = performance.now();
    const overview = await repository.getOverview();
    const elapsed = performance.now() - started;
    expect(overview.targets).toHaveLength(12000);
    expect(overview.targets.filter((target) => target.payments.length === 1)).toHaveLength(6000);
    expect(elapsed).toBeLessThan(1500);
  });
});
