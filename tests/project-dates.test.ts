import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { SqliteLoadRepository } from '../src/data/repositories/SqliteLoadRepository';
import { validateProjectStartDate } from '../src/domain/loads';

class TestDatabase {
  readonly raw = new DatabaseSync(':memory:');
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const result = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({ changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

describe('validateProjectStartDate', () => {
  it('rejects an invalid or non-existent date', () => {
    expect(validateProjectStartDate('2026-13-40', { endDate: null })).toContain('Start date must be a valid date.');
    expect(validateProjectStartDate('not-a-date', { endDate: null })).toContain('Start date must be a valid date.');
    expect(validateProjectStartDate('2026-02-30', { endDate: null })).toContain('Start date must be a valid date.');
  });

  it('rejects a future date', () => {
    const future = new Date(); future.setFullYear(future.getFullYear() + 1);
    const iso = `${future.getFullYear()}-01-01`;
    expect(validateProjectStartDate(iso, { endDate: null })).toContain('Start date cannot be in the future.');
  });

  it('accepts a valid past date with no end date set', () => {
    expect(validateProjectStartDate('2020-01-01', { endDate: null })).toEqual([]);
  });

  it('rejects a start date after the project end date', () => {
    expect(validateProjectStartDate('2026-08-10', { endDate: '2026-08-01' })).toContain("Start date cannot be after the project's end date.");
  });

  it('accepts a start date on or before the project end date', () => {
    expect(validateProjectStartDate('2026-08-01', { endDate: '2026-08-01' })).toEqual([]);
  });
});

describe('SqliteLoadRepository.updateProjectStartDate', () => {
  const databases: TestDatabase[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  async function setup(startDate = '2026-07-01') {
    const database = new TestDatabase();
    databases.push(database);
    await migrateDatabase(database as never);
    const now = '2026-08-01T00:00:00.000Z';
    database.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer_1','company','Road Works Ltd',0,1,'${now}','${now}');
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at) VALUES ('project_1','customer_1','Road Project','Beirut','active','${startDate}','${now}','${now}');
    `);
    return { database, repository: new SqliteLoadRepository(database as never) };
  }

  it('moves the start date earlier with no linked-record check', async () => {
    const { repository } = await setup();
    const updated = await repository.updateProjectStartDate('project_1', '2026-06-01');
    expect(updated.startDate).toBe('2026-06-01');
  });

  it('moves the start date later when no linked record would be excluded', async () => {
    const { repository } = await setup();
    const updated = await repository.updateProjectStartDate('project_1', '2026-07-15');
    expect(updated.startDate).toBe('2026-07-15');
  });

  it('rejects a future start date and leaves the project unchanged', async () => {
    const { repository } = await setup();
    await expect(repository.updateProjectStartDate('project_1', '2999-01-01')).rejects.toThrow('Start date cannot be in the future.');
    const project = (await repository.listProjects()).find((p) => p.id === 'project_1');
    expect(project?.startDate).toBe('2026-07-01');
  });

  it('rejects updating a project that does not exist', async () => {
    const { repository } = await setup();
    await expect(repository.updateProjectStartDate('missing', '2026-06-01')).rejects.toThrow('Project was not found.');
  });

  it('blocks moving the start date later when a confirmed load exists before the new date, and leaves the load and project untouched', async () => {
    const { database, repository } = await setup();
    database.raw.exec('PRAGMA foreign_keys=OFF;');
    database.raw.exec(`INSERT INTO loads (id,transaction_number,confirmed_at,project_id,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,payment_status,company_name)
      VALUES ('load_1','20260705-A-00001','2026-07-05T09:00:00.000Z','project_1','customer_1','Road Works Ltd','item_1','Asphalt','Produced','Driver A','A111',10000,30000,20000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',20,20,'Unpaid','DROMEX');`);
    await expect(repository.updateProjectStartDate('project_1', '2026-07-15')).rejects.toThrow(/2026-07-05/);
    const project = (await repository.listProjects()).find((p) => p.id === 'project_1');
    expect(project?.startDate).toBe('2026-07-01');
    const load = database.raw.prepare('SELECT confirmed_at,transaction_number FROM loads WHERE id=?').get('load_1') as { confirmed_at: string; transaction_number: string };
    expect(load.confirmed_at).toBe('2026-07-05T09:00:00.000Z');
    expect(load.transaction_number).toBe('20260705-A-00001');
  });

  it('blocks moving the start date later when a daily report exists before the new date', async () => {
    const { database, repository } = await setup();
    const now = '2026-07-10T00:00:00.000Z';
    database.raw.exec(`INSERT INTO daily_project_reports (id,project_id,work_date,work_description,created_at,updated_at) VALUES ('report_1','project_1','2026-07-08','Site prep','${now}','${now}');`);
    await expect(repository.updateProjectStartDate('project_1', '2026-07-15')).rejects.toThrow(/daily report.*2026-07-08/i);
  });

  it('blocks moving the start date later when a waste dump exists before the new date', async () => {
    const { database, repository } = await setup();
    const now = '2026-07-06T00:00:00.000Z';
    database.raw.exec(`INSERT INTO waste_dumps (id,project_id,work_date,dumped_at,created_at,updated_at) VALUES ('waste_1','project_1','2026-07-06','${now}','${now}','${now}');`);
    await expect(repository.updateProjectStartDate('project_1', '2026-07-15')).rejects.toThrow(/waste dump.*2026-07-06/i);
  });

  it('is not blocked by a linked record on or after the proposed new start date', async () => {
    const { database, repository } = await setup();
    database.raw.exec('PRAGMA foreign_keys=OFF;');
    database.raw.exec(`INSERT INTO loads (id,transaction_number,confirmed_at,project_id,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,payment_status,company_name)
      VALUES ('load_1','20260720-A-00001','2026-07-20T09:00:00.000Z','project_1','customer_1','Road Works Ltd','item_1','Asphalt','Produced','Driver A','A111',10000,30000,20000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',20,20,'Unpaid','DROMEX');`);
    const updated = await repository.updateProjectStartDate('project_1', '2026-07-15');
    expect(updated.startDate).toBe('2026-07-15');
  });
});
