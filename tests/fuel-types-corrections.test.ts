import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { SqliteFuelRepository } from '../src/data/repositories/SqliteFuelRepository';
import { applyFuelLedger, type FuelMovement } from '../src/domain/fuel';

class TestDatabase {
  readonly raw = new DatabaseSync(':memory:');
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const r = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({ changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) }); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

const movement = (over: Partial<Omit<FuelMovement, 'balanceAfterLitres'>>): Omit<FuelMovement, 'balanceAfterLitres'> => ({
  id: 'm', type: 'fill', fuelType: 'diesel', correctionHistory: [], confirmedAt: '2026-08-29T10:00:00.000Z', litres: 0,
  previousBalanceLitres: null, differenceLitres: null, supplierId: null, supplierName: null, equipmentId: null, equipmentName: null,
  projectId: null, projectName: null, ticketNumber: null, odometerReading: null, reason: null, notes: null, fuelPriceHistoryId: null,
  pricePerLitreUsd: null, priceOverrideReason: null, consumptionCostUsd: null, subtotalUsd: null, vatRatePercent: null,
  vatAmountUsd: null, finalTotalUsd: null, paymentStatus: 'Unpriced', status: 'Active', cancellationReason: null, cancelledAt: null,
  ...over,
});

// DEC-392: the tank holds diesel only, so gasoline must never move the balance.
describe('diesel-only fuel ledger', () => {
  it('ignores gasoline fills when computing the tank balance', () => {
    const applied = applyFuelLedger([
      movement({ id: 'gauge', type: 'gauge', litres: 500, confirmedAt: '2026-08-29T08:00:00.000Z' }),
      movement({ id: 'gasoline_fill', fuelType: 'gasoline', litres: 40, confirmedAt: '2026-08-29T09:00:00.000Z' }),
      movement({ id: 'diesel_fill', litres: 100, confirmedAt: '2026-08-29T10:00:00.000Z' }),
    ]);
    expect(applied.find((m) => m.id === 'gauge')?.balanceAfterLitres).toBe(500);
    // The gasoline fill passes through carrying the diesel balance unchanged.
    expect(applied.find((m) => m.id === 'gasoline_fill')?.balanceAfterLitres).toBe(500);
    expect(applied.find((m) => m.id === 'diesel_fill')?.balanceAfterLitres).toBe(400);
    expect(applied.at(-1)?.balanceAfterLitres).toBe(400);
  });

  it('leaves gasoline fills without tank previous/difference figures', () => {
    const applied = applyFuelLedger([
      movement({ id: 'gauge', type: 'gauge', litres: 300, confirmedAt: '2026-08-29T08:00:00.000Z' }),
      movement({ id: 'gas', fuelType: 'gasoline', litres: 25, confirmedAt: '2026-08-29T09:00:00.000Z' }),
    ]);
    const gas = applied.find((m) => m.id === 'gas');
    expect(gas?.previousBalanceLitres).toBeNull();
    expect(gas?.differenceLitres).toBeNull();
  });

  it('still excludes cancelled diesel movements', () => {
    const applied = applyFuelLedger([
      movement({ id: 'gauge', type: 'gauge', litres: 200, confirmedAt: '2026-08-29T08:00:00.000Z' }),
      movement({ id: 'cancelled', litres: 50, status: 'Cancelled', confirmedAt: '2026-08-29T09:00:00.000Z' }),
    ]);
    expect(applied.at(-1)?.balanceAfterLitres).toBe(200);
  });
});

describe('fuel types and corrections in SQLite', () => {
  const databases: TestDatabase[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  async function setup() {
    const database = new TestDatabase();
    databases.push(database);
    await migrateDatabase(database as never);
    const now = '2026-08-29T00:00:00Z';
    database.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${now}','${now}');
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('project','customer','Road','Aley','active','2026-01-01','${now}','${now}',0);
      INSERT INTO machine_profiles (id,name,is_active,created_at,updated_at) VALUES ('machine','Excavator',1,'${now}','${now}');
      INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('supplier','Fuel Co',1,'${now}','${now}');
      INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1100,'${now}');
    `);
    return { database, repository: new SqliteFuelRepository(database as never) };
  }

  const fill = (over: Record<string, unknown> = {}) => ({ fuelType: 'diesel' as const, recordDate: '2026-08-29', equipmentType: 'machine' as const, equipmentId: 'machine', projectId: 'project', litres: '40', odometerReading: '', pricePerLitreUsd: '', priceOverrideReason: '', notes: '', ...over });
  const delivery = (over: Record<string, unknown> = {}) => ({ recordDate: '2026-08-29', litres: '100', supplierId: 'supplier', ticketNumber: 'T-1', pricePerLitreUsd: '', updateCurrentPrice: false, notes: '', ...over });

  it('keeps separate current prices and history for each fuel type', async () => {
    const { repository } = await setup();
    await repository.setCurrentPrice({ fuelType: 'diesel', pricePerLitreUsd: '0.90', reason: 'Diesel' });
    await repository.setCurrentPrice({ fuelType: 'gasoline', pricePerLitreUsd: '1.25', reason: 'Gasoline' });
    const s = await repository.getSetup();
    expect(s.fuelPrices.diesel.current?.pricePerLitreUsd).toBe(0.9);
    expect(s.fuelPrices.gasoline.current?.pricePerLitreUsd).toBe(1.25);
    expect(s.fuelPrices.diesel.history).toHaveLength(1);
    expect(s.fuelPrices.gasoline.history).toHaveLength(1);
    // The legacy field keeps its diesel meaning for existing callers.
    expect(s.currentFuelPrice?.pricePerLitreUsd).toBe(0.9);
  });

  it('records a gasoline fill that does not move the tank balance', async () => {
    const { repository } = await setup();
    await repository.recordGauge({ recordDate: '2026-08-28', actualLitres: '500', reason: 'Opening', notes: '' });
    await repository.recordFill(fill({ fuelType: 'gasoline', litres: '30' }));
    const before = (await repository.getOverview()).currentBalanceLitres;
    expect(before).toBe(500);
    await repository.recordFill(fill({ litres: '100' }));
    expect((await repository.getOverview()).currentBalanceLitres).toBe(400);
  });

  it('defaults pre-existing movements to diesel', async () => {
    const { database, repository } = await setup();
    database.raw.exec(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,created_at) VALUES ('legacy','fill','2026-08-29T10:00:00.000Z',20,'2026-08-29T10:00:00.000Z');`);
    const legacy = (await repository.getOverview()).movements.find((m) => m.id === 'legacy');
    expect(legacy?.fuelType).toBe('diesel');
    expect(legacy?.correctionHistory).toEqual([]);
  });

  it('corrects a fill, records the audit, and recalculates the ledger', async () => {
    const { repository } = await setup();
    // Distinct dates keep the ledger order explicit rather than relying on creation timing.
    await repository.recordGauge({ recordDate: '2026-08-28', actualLitres: '500', reason: 'Opening', notes: '' });
    const created = await repository.recordFill(fill({ litres: '40' }));
    expect((await repository.getOverview()).currentBalanceLitres).toBe(460);
    const corrected = await repository.correctFill(created.id, { ...fill({ litres: '60', pricePerLitreUsd: '0.90' }), correctionReason: 'Wrong litres written on the sheet' });
    expect(corrected.litres).toBe(60);
    expect(corrected.consumptionCostUsd).toBe(54);
    expect((await repository.getOverview()).currentBalanceLitres).toBe(440);
    const entry = corrected.correctionHistory.at(-1);
    expect(entry?.reason).toBe('Wrong litres written on the sheet');
    expect(entry?.changes.find((c) => c.field === 'Litres')).toMatchObject({ originalValue: '40', newValue: '60' });
    expect(entry?.changes.find((c) => c.field === 'Cost')).toMatchObject({ originalValue: null, newValue: '54' });
  });

  it('prices a previously unpriced fill through a correction', async () => {
    const { repository } = await setup();
    const created = await repository.recordFill(fill());
    expect(created.consumptionCostUsd).toBeNull();
    const corrected = await repository.correctFill(created.id, { ...fill({ pricePerLitreUsd: '1.00' }), correctionReason: 'Price received later' });
    expect(corrected.pricePerLitreUsd).toBe(1);
    expect(corrected.consumptionCostUsd).toBe(40);
  });

  it('prices a previously unpriced delivery through a correction', async () => {
    const { repository } = await setup();
    const created = await repository.recordDelivery(delivery());
    expect(created.finalTotalUsd).toBeNull();
    const corrected = await repository.correctDelivery(created.id, { ...delivery({ pricePerLitreUsd: '1.00' }), correctionReason: 'Invoice arrived' });
    expect(corrected.finalTotalUsd).toBe(111);
    expect(corrected.paymentStatus).toBe('Unpaid');
  });

  it('refuses to correct a delivery to Unpriced while active payments exist', async () => {
    const { database, repository } = await setup();
    const created = await repository.recordDelivery(delivery({ pricePerLitreUsd: '1.00' }));
    database.raw.exec(`INSERT INTO payment_entries (id,target_type,fuel_movement_id,amount_usd_cents,payment_date,status,created_at) VALUES ('pay','fuelDelivery','${created.id}',5000,'2026-08-29','Active','2026-08-29T00:00:00Z');`);
    await expect(repository.correctDelivery(created.id, { ...delivery({ pricePerLitreUsd: '' }), correctionReason: 'Remove price' }))
      .rejects.toThrow('active payments');
  });

  it('allows reducing a delivery below what was paid and reports Overpaid', async () => {
    const { database, repository } = await setup();
    const created = await repository.recordDelivery(delivery({ litres: '100', pricePerLitreUsd: '1.00' }));
    database.raw.exec(`INSERT INTO payment_entries (id,target_type,fuel_movement_id,amount_usd_cents,payment_date,status,created_at) VALUES ('pay','fuelDelivery','${created.id}',11100,'2026-08-29','Active','2026-08-29T00:00:00Z');`);
    const corrected = await repository.correctDelivery(created.id, { ...delivery({ litres: '10', pricePerLitreUsd: '1.00' }), correctionReason: 'Wrong quantity' });
    expect(corrected.finalTotalUsd).toBe(11.1);
    expect(corrected.paymentStatus).toBe('Overpaid');
  });

  it('requires a reason for every correction', async () => {
    const { repository } = await setup();
    const created = await repository.recordFill(fill());
    await expect(repository.correctFill(created.id, { ...fill({ litres: '10' }), correctionReason: '   ' })).rejects.toThrow('reason is required');
  });

  it('never corrects a gauge reading or a cancelled movement', async () => {
    const { repository } = await setup();
    const gauge = await repository.recordGauge({ recordDate: '2026-08-29', actualLitres: '500', reason: 'Opening', notes: '' });
    await expect(repository.correctFill(gauge.id, { ...fill(), correctionReason: 'x' })).rejects.toThrow('gauge reading cannot be corrected');
    const created = await repository.recordFill(fill());
    await repository.cancelMovement(created.id, 'Duplicate');
    await expect(repository.correctFill(created.id, { ...fill({ litres: '10' }), correctionReason: 'x' })).rejects.toThrow('cancelled fuel movement cannot be corrected');
  });

  it('keeps unchanged fields out of the audit history', async () => {
    const { repository } = await setup();
    const created = await repository.recordFill(fill({ litres: '40' }));
    const corrected = await repository.correctFill(created.id, { ...fill({ litres: '45' }), correctionReason: 'Adjust litres only' });
    const entry = corrected.correctionHistory.at(-1);
    expect(entry?.changes.map((c) => c.field)).toEqual(['Litres']);
  });
});
