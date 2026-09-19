import {DatabaseSync} from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteCyclopeanLiftRepository} from '../src/data/repositories/SqliteCyclopeanLiftRepository';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';

class TestDatabase {
  readonly raw: DatabaseSync;
  constructor(target = ':memory:') { this.raw = new DatabaseSync(target); }
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const result = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid)}); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

const NOW = '2026-09-18T00:00:00.000Z';
const tempFiles: string[] = [];
afterEach(() => { for (const file of tempFiles.splice(0)) { try { fs.rmSync(file, {force: true}); } catch { /* already gone */ } } });

/**
 * DROMEX's real backup path (SqliteBackupRepository) uses expo-sqlite's serializeAsync /
 * backupDatabaseAsync -- a whole-file binary copy, the same operation SQLite's own `VACUUM INTO`
 * performs and the same one this smoke test exercises here (expo-sqlite is unavailable under this
 * Node test runtime). Because it is a whole-database copy, no table-specific backup code was needed
 * for migration 43 -- this test only confirms that expectation holds for cyclopean_lifts specifically.
 */
describe('backup/restore smoke test: whole-database copy preserves Cyclopean Lifts', () => {
  it('a full database copy round-trips every part of the lift aggregate', async () => {
    const db = new TestDatabase();
    await migrateDatabase(db as never);
    db.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
      INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
    `);
    const walls = new SqliteWallRepository(db as never);
    const lifts = new SqliteCyclopeanLiftRepository(db as never);
    const section = await walls.createConstructionSection({projectId: 'road', name: 'Section A', location: '', description: ''});
    const foundation = await walls.createFoundation({
      projectId: 'road', constructionSectionId: section.id, reference: 'Foundation A', location: '', lengthM: 20, heightM: 3,
      bottomThicknessM: 1.5, topThicknessM: 1.5, deductionM3: 0, materialType: 'ready_mix', concretePurpose: 'footing',
      customPurposeId: null, quantity: 90, quantityUnit: 'm3', manualOverride: true, consumptionDate: '2026-09-01', notes: '',
    });
    const lift = await lifts.createLift({parentType: 'foundation', parentId: foundation.id, sequence: 1, reference: 'Lift 1', startElevationM: 0, geometry: {lengthM: 20, heightM: 1, bottomThicknessM: 1.5, topThicknessM: 1.5, deductionM3: 0}, notes: 'Backup smoke test lift'});
    await lifts.saveStonePhase(lift.id, {calculationDimensions: {lengthM: 20, heightM: 1, bottomThicknessM: 0.9, topThicknessM: 0.9, deductionM3: 0}, actualStoneQuantityM3: 17.5, manualOverride: true, workDate: '2026-09-02', position: {xNorm: 0.4, yNorm: 0.5}, offsets: null, notes: 'First lift Stone'});
    await lifts.saveConcreteMatrixPhase(lift.id, {calculationMethod: 'estimated_matrix', independentDimensions: null, actualReadyMixQuantityM3: 11.8, manualOverride: true, purpose: 'structural', workDate: '2026-09-03', notes: 'First lift pour'});
    await lifts.correctLift(lift.id, {reference: 'Lift 1 (corrected)', startElevationM: 0, geometry: lift.geometry, notes: 'renamed after survey', correctionReason: 'Reference corrected after site survey'});
    const before = await lifts.getLift(lift.id);

    const backupPath = path.join(os.tmpdir(), `dromex-cyclopean-lift-backup-smoke-${Date.now()}.sqlite`);
    tempFiles.push(backupPath);
    db.raw.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    db.close();

    const restored = new TestDatabase(backupPath);
    const restoredLifts = new SqliteCyclopeanLiftRepository(restored as never);
    const after = await restoredLifts.getLift(lift.id);
    restored.close();

    expect(after).toEqual(before);
    expect(after?.reference).toBe('Lift 1 (corrected)');
    expect(after?.correctionHistory).toHaveLength(1);
    expect(after?.stonePhase).toMatchObject({calculatedStoneVolumeM3: 18, actualStoneQuantityM3: 17.5, manualOverride: true, position: {xNorm: 0.4, yNorm: 0.5}});
    expect(after?.concretePhase).toMatchObject({estimatedMatrixVolumeM3: 12, actualReadyMixQuantityM3: 11.8, manualOverride: true, purpose: 'structural'});
    expect(after?.status).toBe('completed');
  });
});
