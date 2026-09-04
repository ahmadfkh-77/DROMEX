import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { SqliteLoadRepository } from '../src/data/repositories/SqliteLoadRepository';
import type { LoadDraft } from '../src/domain/loads';

class TestDatabase {
  readonly raw = new DatabaseSync(':memory:');
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const result = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({ changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

const baseDraft: LoadDraft = {
  recordDate: '2026-08-25', customerId: 'customer_1', projectId: '', destinationAddress: 'Beirut site',
  itemId: 'item_1', driverId: 'driver_1', truckId: 'truck_1', driverName: 'Ali Driver', truckPlate: 'B123',
  quantityMethod: 'weighbridge', requestedQuantityKg: '', emptyWeightKg: '10000', fullWeightKg: '30000',
  conversionId: 'conversion_kg_ton', directQuantity: '', directUnitId: '', unitPriceUsd: '50', notes: 'Original notes',
};

describe('SqliteLoadRepository correction and cancellation', () => {
  const databases: TestDatabase[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  async function setup() {
    const database = new TestDatabase();
    databases.push(database);
    await migrateDatabase(database as never);
    const now = '2026-08-01T00:00:00.000Z';
    database.raw.exec(`
      INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX Test Co','${now}');
      INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1000,'${now}');
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer_1','company','Road Works Ltd',0,1,'${now}','${now}');
      INSERT INTO categories (id,name,is_active,created_at,updated_at) VALUES ('category_1','Produced',1,'${now}','${now}');
      INSERT INTO catalog_items (id,category_id,name,loads_enabled,is_active,created_at,updated_at) VALUES ('item_1','category_1','Asphalt',1,1,'${now}','${now}');
      INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at) VALUES ('driver_1','Ali Driver',1,'${now}','${now}');
      INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck_1','B123',1,'${now}','${now}');
    `);
    const repository = new SqliteLoadRepository(database as never);
    const confirmed = await repository.confirmLoad(baseDraft);
    return { database, repository, confirmed };
  }

  async function activePaymentCents(database: TestDatabase, loadId: string) {
    const row = database.raw.prepare("SELECT COALESCE(SUM(amount_usd_cents),0) total FROM payment_entries WHERE load_id=? AND status='Active'").get(loadId) as { total: number };
    return row.total;
  }

  it('confirms a load with safe status defaults ready for correction/cancellation', async () => {
    const { confirmed } = await setup();
    expect(confirmed).toMatchObject({ status: 'Active', cancellationReason: null, cancelledAt: null, correctionHistory: [], billedQuantity: 20, finalTotalUsd: 1100, paymentStatus: 'Unpaid' });
  });

  describe('correction', () => {
    it('requires a non-empty correction reason', async () => {
      const { repository, confirmed } = await setup();
      await expect(repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), unitPriceUsd: '55', correctionReason: '' })).rejects.toThrow('Correction reason is required.');
      await expect(repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), unitPriceUsd: '55', correctionReason: '   ' })).rejects.toThrow('Correction reason is required.');
    });

    it('rejects a correction that changes nothing', async () => {
      const { repository, confirmed } = await setup();
      await expect(repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), correctionReason: 'No real change' })).rejects.toThrow('No information was changed.');
    });

    it('records a before/after diff in correction history and preserves the original transaction number', async () => {
      const { repository, confirmed } = await setup();
      const corrected = await repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), fullWeightKg: '31000', unitPriceUsd: '55', correctionReason: 'Reweighed after transcription error' });
      expect(corrected.transactionNumber).toBe(confirmed.transactionNumber);
      expect(corrected.confirmedAt).toBe(confirmed.confirmedAt);
      expect(corrected.customerName).toBe(confirmed.customerName);
      expect(corrected.correctionHistory).toHaveLength(1);
      const entry = corrected.correctionHistory[0]!;
      expect(entry.reason).toBe('Reweighed after transcription error');
      expect(entry.correctedBy).toBe('Admin');
      expect(entry.changes).toContainEqual({ field: 'Full weight kg', originalValue: '30000', newValue: '31000' });
      expect(entry.changes).toContainEqual({ field: 'Unit price', originalValue: '50', newValue: '55' });
      expect(entry.changes.some((change) => change.field === 'Notes')).toBe(false);
      expect(corrected.netWeightKg).toBe(21000);
      expect(corrected.billedQuantity).toBe(21);
      expect(corrected.finalTotalUsd).toBe(1270.5);
    });

    it('persists the correction and its history to the database', async () => {
      const { database, repository, confirmed } = await setup();
      await repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), notes: 'Corrected notes', correctionReason: 'Fix notes' });
      const row = database.raw.prepare('SELECT notes, correction_history_json FROM loads WHERE id=?').get(confirmed.id) as { notes: string; correction_history_json: string };
      expect(row.notes).toBe('Corrected notes');
      expect(JSON.parse(row.correction_history_json)).toHaveLength(1);
    });

    it('writes an atomic sync_outbox entry for the correction', async () => {
      const { database, repository, confirmed } = await setup();
      await repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), unitPriceUsd: '60', correctionReason: 'Price update' });
      const rows = database.raw.prepare("SELECT operation FROM sync_outbox WHERE entity_type='load' AND entity_id=? ORDER BY created_at DESC").all(confirmed.id) as { operation: string }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]!.operation).toBe('upsert');
    });

    it('updates loads.updated_at atomically with the correction and includes it in the sync payload, while preserving the transaction number and snapshot', async () => {
      const { database, repository, confirmed } = await setup();
      const before = database.raw.prepare('SELECT updated_at FROM loads WHERE id=?').get(confirmed.id) as { updated_at: string | null };
      expect(before.updated_at).toBeNull();
      const corrected = await repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), unitPriceUsd: '65', correctionReason: 'Timestamp check' });
      const row = database.raw.prepare('SELECT updated_at, correction_history_json FROM loads WHERE id=?').get(confirmed.id) as { updated_at: string | null; correction_history_json: string };
      expect(row.updated_at).not.toBeNull();
      const historyEntry = JSON.parse(row.correction_history_json)[0] as { correctedAt: string };
      // Same operation, same timestamp: updated_at and the appended history entry's correctedAt must be written together, not independently.
      expect(row.updated_at).toBe(historyEntry.correctedAt);
      const outboxPayload = JSON.parse((database.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='load' AND entity_id=? ORDER BY rowid DESC LIMIT 1").get(confirmed.id) as { payload_json: string }).payload_json) as { updatedAt?: string };
      expect(outboxPayload.updatedAt).toBe(row.updated_at);
      expect(corrected.transactionNumber).toBe(confirmed.transactionNumber);
      expect(corrected.confirmedAt).toBe(confirmed.confirmedAt);
      expect(corrected.customerName).toBe(confirmed.customerName);
      expect(corrected.itemName).toBe(confirmed.itemName);
    });

    it('blocks changing a paid load to Unpriced while active payments exist', async () => {
      const { database, repository, confirmed } = await setup();
      database.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at) VALUES ('payment_1','load','${confirmed.id}',50000,'2026-08-02','Active','2026-08-02T00:00:00.000Z')`);
      await expect(repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), unitPriceUsd: '', correctionReason: 'Trying to remove the price' })).rejects.toThrow('A load with active payments cannot be corrected to Unpriced.');
    });

    it('preserves Partially Paid / Paid / Overpaid calculations through a price correction', async () => {
      const { database, repository, confirmed } = await setup();
      database.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at) VALUES ('payment_1','load','${confirmed.id}',60000,'2026-08-02','Active','2026-08-02T00:00:00.000Z')`);
      const partiallyPaid = await repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), unitPriceUsd: '55', correctionReason: 'Price correction, still partially paid' });
      expect(partiallyPaid.finalTotalUsd).toBe(1210);
      expect(partiallyPaid.paymentStatus).toBe('Partially Paid');
      const overpaid = await repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), unitPriceUsd: '25', correctionReason: 'Price correction that creates an overpayment' });
      expect(overpaid.paymentStatus).toBe('Overpaid');
      expect(await activePaymentCents(database, confirmed.id)).toBe(60000);
    });

    it('blocks correcting an already-cancelled load', async () => {
      const { repository, confirmed } = await setup();
      await repository.cancelLoad(confirmed.id, 'Duplicate entry');
      await expect(repository.correctLoad(confirmed.id, { ...draftFromConfirmed(confirmed), unitPriceUsd: '99', correctionReason: 'Should not be allowed' })).rejects.toThrow('A cancelled load cannot be corrected.');
    });
  });

  describe('cancellation', () => {
    it('requires a non-empty cancellation reason', async () => {
      const { repository, confirmed } = await setup();
      await expect(repository.cancelLoad(confirmed.id, '')).rejects.toThrow('Cancellation reason is required.');
      await expect(repository.cancelLoad(confirmed.id, '   ')).rejects.toThrow('Cancellation reason is required.');
    });

    it('blocks cancellation while active payments exist', async () => {
      const { database, repository, confirmed } = await setup();
      database.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at) VALUES ('payment_1','load','${confirmed.id}',50000,'2026-08-02','Active','2026-08-02T00:00:00.000Z')`);
      await expect(repository.cancelLoad(confirmed.id, 'Mistaken entry')).rejects.toThrow('Cancel all active payments for this load first.');
    });

    it('succeeds once the payment has been cancelled through the existing payment workflow', async () => {
      const { database, repository, confirmed } = await setup();
      database.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at) VALUES ('payment_1','load','${confirmed.id}',50000,'2026-08-02','Active','2026-08-02T00:00:00.000Z')`);
      await expect(repository.cancelLoad(confirmed.id, 'Mistaken entry')).rejects.toThrow('Cancel all active payments for this load first.');
      database.raw.exec("UPDATE payment_entries SET status='Cancelled', cancellation_reason='Reversed', cancelled_at='2026-08-03T00:00:00.000Z' WHERE id='payment_1'");
      const cancelled = await repository.cancelLoad(confirmed.id, 'Mistaken entry');
      expect(cancelled.status).toBe('Cancelled');
    });

    it('persists cancelled status and cancellation metadata while preserving the transaction number and snapshot, never deleting the row', async () => {
      const { database, repository, confirmed } = await setup();
      const cancelled = await repository.cancelLoad(confirmed.id, 'Duplicate truck entry');
      expect(cancelled).toMatchObject({ status: 'Cancelled', cancellationReason: 'Duplicate truck entry', transactionNumber: confirmed.transactionNumber, customerName: confirmed.customerName, billedQuantity: confirmed.billedQuantity, finalTotalUsd: confirmed.finalTotalUsd });
      expect(cancelled.cancelledAt).not.toBeNull();
      const row = database.raw.prepare('SELECT id FROM loads WHERE id=?').get(confirmed.id);
      expect(row).not.toBeNull();
    });

    it('updates loads.updated_at atomically with the cancellation and includes it in the sync payload, while preserving the transaction number and snapshot', async () => {
      const { database, repository, confirmed } = await setup();
      const before = database.raw.prepare('SELECT updated_at FROM loads WHERE id=?').get(confirmed.id) as { updated_at: string | null };
      expect(before.updated_at).toBeNull();
      const cancelled = await repository.cancelLoad(confirmed.id, 'Duplicate truck entry');
      const row = database.raw.prepare('SELECT updated_at, cancelled_at FROM loads WHERE id=?').get(confirmed.id) as { updated_at: string | null; cancelled_at: string | null };
      expect(row.updated_at).not.toBeNull();
      // Same operation, same timestamp: updated_at and cancelled_at come from one generated value written in the same UPDATE.
      expect(row.updated_at).toBe(row.cancelled_at);
      const outboxPayload = JSON.parse((database.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='load' AND entity_id=? ORDER BY rowid DESC LIMIT 1").get(confirmed.id) as { payload_json: string }).payload_json) as { updatedAt?: string };
      expect(outboxPayload.updatedAt).toBe(row.updated_at);
      expect(cancelled.transactionNumber).toBe(confirmed.transactionNumber);
      expect(cancelled.confirmedAt).toBe(confirmed.confirmedAt);
      expect(cancelled.customerName).toBe(confirmed.customerName);
      expect(cancelled.billedQuantity).toBe(confirmed.billedQuantity);
    });

    it('rejects cancelling an already-cancelled load', async () => {
      const { repository, confirmed } = await setup();
      await repository.cancelLoad(confirmed.id, 'First cancellation');
      await expect(repository.cancelLoad(confirmed.id, 'Second attempt')).rejects.toThrow('This load is already cancelled.');
    });

    it('never modifies the payment record automatically', async () => {
      const { database, repository, confirmed } = await setup();
      database.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,cancellation_reason,cancelled_at,created_at) VALUES ('payment_1','load','${confirmed.id}',50000,'2026-08-02','Cancelled','Reversed','2026-08-03T00:00:00.000Z','2026-08-02T00:00:00.000Z')`);
      const before = database.raw.prepare('SELECT amount_usd_cents,status,cancellation_reason,cancelled_at FROM payment_entries WHERE id=?').get('payment_1');
      await repository.cancelLoad(confirmed.id, 'Mistaken entry');
      const after = database.raw.prepare('SELECT amount_usd_cents,status,cancellation_reason,cancelled_at FROM payment_entries WHERE id=?').get('payment_1');
      expect(after).toEqual(before);
    });

    it('does not add a reactivation path', async () => {
      const { repository } = await setup();
      expect((repository as unknown as Record<string, unknown>).reactivateLoad).toBeUndefined();
    });
  });
});

function draftFromConfirmed(confirmed: { requestedQuantityKg: number | null; emptyWeightKg: number | null; fullWeightKg: number | null; directQuantity: number | null; unitPriceUsd: number | null; destinationAddress: string | null; notes: string | null }) {
  return {
    requestedQuantityKg: confirmed.requestedQuantityKg == null ? '' : String(confirmed.requestedQuantityKg),
    emptyWeightKg: confirmed.emptyWeightKg == null ? '' : String(confirmed.emptyWeightKg),
    fullWeightKg: confirmed.fullWeightKg == null ? '' : String(confirmed.fullWeightKg),
    directQuantity: confirmed.directQuantity == null ? '' : String(confirmed.directQuantity),
    unitPriceUsd: confirmed.unitPriceUsd == null ? '' : String(confirmed.unitPriceUsd),
    destinationAddress: confirmed.destinationAddress ?? '',
    notes: confirmed.notes ?? '',
  };
}
