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

// DEC-099 / FR-054: a blank price means Unpriced and stays out of financial totals, while an
// intentional $0.00 price is a real zero-value order that must appear with no payment due.
describe('zero-value records in the financial overview', () => {
  const databases: TestDatabase[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  const loadColumns = 'id,transaction_number,confirmed_at,project_id,project_name,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,unit_price_usd_cents,final_total_usd_cents,payment_status,company_name,status';

  async function setup() {
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
    // Priced load: $1000 total, unpaid.
    database.raw.exec(`INSERT INTO loads (${loadColumns})
      VALUES ('load_priced','20260819-A-00001','2026-08-19T10:00:00.000Z','project_1','Road Project','customer_1','Road Works Ltd','item_1','Asphalt','Produced','Driver A','A111',10000,30000,20000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',20,20,50000,100000,'Unpaid','DROMEX','Active');`);
    // Intentional $0.00 load: a confirmed zero-value order, no payment due.
    database.raw.exec(`INSERT INTO loads (${loadColumns})
      VALUES ('load_zero','20260819-A-00002','2026-08-19T11:00:00.000Z','project_1','Road Project','customer_1','Road Works Ltd','item_1','Asphalt','Produced','Driver A','A111',5000,15000,10000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',10,10,0,0,'No Payment Due','DROMEX','Active');`);
    // Blank price: Unpriced, excluded from financial totals.
    database.raw.exec(`INSERT INTO loads (${loadColumns})
      VALUES ('load_unpriced','20260819-A-00003','2026-08-19T12:00:00.000Z','project_1','Road Project','customer_1','Road Works Ltd','item_1','Asphalt','Produced','Driver A','A111',5000,13000,8000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',8,8,NULL,NULL,'Unpriced','DROMEX','Active');`);
    // Cancelled zero-value load: still excluded, cancellation outranks inclusion.
    database.raw.exec(`INSERT INTO loads (${loadColumns},cancellation_reason,cancelled_at)
      VALUES ('load_zero_cancelled','20260819-A-00004','2026-08-19T13:00:00.000Z','project_1','Road Project','customer_1','Road Works Ltd','item_1','Asphalt','Produced','Driver A','A111',5000,12000,7000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',7,7,0,0,'No Payment Due','DROMEX','Cancelled','Duplicate entry','2026-08-19T14:00:00.000Z');`);
    database.raw.exec(`INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,item_id,item_name,category_name,quantity_cubic_metres,driver_profile_id,driver_name,truck_profile_id,truck_plate,unit_price_usd_cents,final_total_usd_cents,payment_status,status,unit_symbol)
      VALUES ('purchase_zero','SL-00001','2026-08-19T10:30:00.000Z','supplier_1','Quarry Co','item_1','Gravel','Purchased',4,'driver_1','Driver B','truck_1','B222',0,0,'No Payment Due','Active','m³');`);
    database.raw.exec(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,supplier_id,supplier_name,final_total_usd_cents,payment_status,status,created_at)
      VALUES ('fuel_zero','delivery','2026-08-19T09:00:00.000Z',200,'supplier_1','Quarry Co',0,'No Payment Due','Active','${now}');`);
    return { database, repository: new SqliteFinancialRepository(database as never) };
  }

  it('includes an intentional $0.00 load as a zero-value order with no payment due', async () => {
    const { repository } = await setup();
    const overview = await repository.getOverview();
    const zero = overview.targets.find((target) => target.id === 'load_zero');
    expect(zero).toBeTruthy();
    expect(zero).toMatchObject({ totalUsd: 0, paidUsd: 0, remainingUsd: 0, overpaidUsd: 0, status: 'No Payment Due' });
    expect(zero?.projectId).toBe('project_1');
  });

  it('still excludes a blank-priced Unpriced load from financial records', async () => {
    const { repository } = await setup();
    const overview = await repository.getOverview();
    expect(overview.targets.some((target) => target.id === 'load_unpriced')).toBe(false);
  });

  it('still excludes a cancelled zero-value load', async () => {
    const { repository } = await setup();
    const overview = await repository.getOverview();
    expect(overview.targets.some((target) => target.id === 'load_zero_cancelled')).toBe(false);
  });

  it('leaves the priced load and customer money totals unchanged', async () => {
    const { repository } = await setup();
    const overview = await repository.getOverview();
    const priced = overview.targets.find((target) => target.id === 'load_priced');
    expect(priced).toMatchObject({ totalUsd: 1000, paidUsd: 0, remainingUsd: 1000, status: 'Unpaid' });
    const customerTargets = overview.targets.filter((target) => target.partyType === 'customer' && target.partyId === 'customer_1');
    expect(customerTargets).toHaveLength(2);
    expect(customerTargets.reduce((sum, target) => sum + target.totalUsd, 0)).toBe(1000);
    expect(customerTargets.reduce((sum, target) => sum + target.paidUsd, 0)).toBe(0);
    expect(customerTargets.reduce((sum, target) => sum + target.remainingUsd, 0)).toBe(1000);
  });

  it('keeps zero-value records out of the needs-attention set', async () => {
    const { repository } = await setup();
    const overview = await repository.getOverview();
    const attention = overview.targets.filter((target) => target.remainingUsd > 0);
    expect(attention.map((target) => target.id)).toEqual(['load_priced']);
  });

  it('includes zero-value supplier purchases and fuel deliveries on the same rule', async () => {
    const { repository } = await setup();
    const overview = await repository.getOverview();
    expect(overview.targets.find((target) => target.id === 'purchase_zero')).toMatchObject({ type: 'quarryPurchase', totalUsd: 0, remainingUsd: 0, status: 'No Payment Due' });
    expect(overview.targets.find((target) => target.id === 'fuel_zero')).toMatchObject({ type: 'fuelDelivery', totalUsd: 0, remainingUsd: 0, status: 'No Payment Due' });
  });
});
