import {DatabaseSync} from 'node:sqlite';
import {afterEach, describe, expect, it} from 'vitest';

import {DATABASE_VERSION, migrateDatabase} from '../src/data/database/migrations';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';

class TestDatabase {
  readonly raw: DatabaseSync;
  constructor() { this.raw = new DatabaseSync(':memory:'); }
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const result = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid)}); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

const NOW = '2026-09-18T00:00:00.000Z';
const databases: TestDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

async function seededDatabase() {
  const db = new TestDatabase(); databases.push(db);
  await migrateDatabase(db as never);
  db.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
  `);
  const walls = new SqliteWallRepository(db as never);
  const section = await walls.createConstructionSection({projectId: 'road', name: 'Section A', location: '', description: ''});
  const foundation = await walls.createFoundation({
    projectId: 'road', constructionSectionId: section.id, reference: 'Foundation A', location: '', lengthM: 20, heightM: 1,
    bottomThicknessM: 1.5, topThicknessM: 1.5, deductionM3: 0, materialType: 'ready_mix', concretePurpose: 'footing',
    customPurposeId: null, quantity: 30, quantityUnit: 'm3', manualOverride: true, consumptionDate: '2026-09-01', notes: '',
  });
  const wall = await walls.saveWall({
    projectId: 'road', name: 'Retaining wall A', system: 'cyclopean_concrete', purpose: 'retaining', lengthM: 20, heightM: 4,
    bottomThicknessM: 0.8, topThicknessM: 0.4, deductionM3: 0, allowancePercent: 0, notes: '', foundationId: foundation.id,
  });
  return {db, walls, section, foundation, wall};
}

describe('migration 43: fresh install', () => {
  it('reaches version 43 with an empty cyclopean_lifts table and no foreign-key violations', async () => {
    const db = new TestDatabase(); databases.push(db);
    await migrateDatabase(db as never);
    expect(DATABASE_VERSION).toBe(43);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version: number}).user_version).toBe(43);
    expect(db.raw.prepare('SELECT COUNT(*) count FROM cyclopean_lifts').get()).toMatchObject({count: 0});
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });
});

describe('migration 43: schema constraints', () => {
  it('rejects a lift with both a foundation_id and a wall_id', async () => {
    const {db, foundation, wall} = await seededDatabase();
    expect(() => db.raw.exec(`
      INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,wall_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,created_at,updated_at)
      VALUES ('bad','foundation','${foundation.id}','${wall.id}',1,'Lift 1',0,10,1,1,1,10,'${NOW}','${NOW}')
    `)).toThrow();
  });
  it('rejects a lift with neither a foundation_id nor a wall_id', async () => {
    const {db} = await seededDatabase();
    expect(() => db.raw.exec(`
      INSERT INTO cyclopean_lifts (id,parent_type,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,created_at,updated_at)
      VALUES ('bad','foundation',1,'Lift 1',0,10,1,1,1,10,'${NOW}','${NOW}')
    `)).toThrow();
  });
  it('rejects a foundation-typed lift pointed at a wall id', async () => {
    const {db, wall} = await seededDatabase();
    expect(() => db.raw.exec(`
      INSERT INTO cyclopean_lifts (id,parent_type,wall_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,created_at,updated_at)
      VALUES ('bad','foundation','${wall.id}',1,'Lift 1',0,10,1,1,1,10,'${NOW}','${NOW}')
    `)).toThrow();
  });
  it('rejects a duplicate sequence within the same foundation', async () => {
    const {db, foundation} = await seededDatabase();
    db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,created_at,updated_at) VALUES ('l1','foundation','${foundation.id}',1,'Lift 1',0,10,1,1,1,10,'${NOW}','${NOW}')`);
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,created_at,updated_at) VALUES ('l2','foundation','${foundation.id}',1,'Lift 2',0,10,1,1,1,10,'${NOW}','${NOW}')`)).toThrow();
  });
  it('allows the same sequence number reused across two different parents', async () => {
    const {db, foundation, wall} = await seededDatabase();
    db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,created_at,updated_at) VALUES ('l1','foundation','${foundation.id}',1,'Lift 1',0,10,1,1,1,10,'${NOW}','${NOW}')`);
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,wall_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,created_at,updated_at) VALUES ('l2','wall','${wall.id}',1,'Lift 1',0,10,4,.8,.4,10,'${NOW}','${NOW}')`)).not.toThrow();
  });
  it('rejects an invalid status', async () => {
    const {db, foundation} = await seededDatabase();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,status,created_at,updated_at) VALUES ('bad','foundation','${foundation.id}',1,'Lift 1',0,10,1,1,1,10,'inspected','${NOW}','${NOW}')`)).toThrow();
  });
  it('rejects an invalid concrete calculation method', async () => {
    const {db, foundation} = await seededDatabase();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,concrete_calculation_method,created_at,updated_at) VALUES ('bad','foundation','${foundation.id}',1,'Lift 1',0,10,1,1,1,10,'guessed','${NOW}','${NOW}')`)).toThrow();
  });
});

describe('migration 43: the status column can never disagree with the phase columns', () => {
  it('rejects status=planned with a Stone actual quantity recorded', async () => {
    const {db, foundation} = await seededDatabase();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,status,stone_actual_quantity_m3,created_at,updated_at) VALUES ('bad2','foundation','${foundation.id}',2,'Lift 2',0,10,1,1,1,10,'planned',6,'${NOW}','${NOW}')`)).toThrow();
  });
  it('rejects status=planned with only a Stone work date recorded', async () => {
    const {db, foundation} = await seededDatabase();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,status,stone_work_date,created_at,updated_at) VALUES ('bad3','foundation','${foundation.id}',3,'Lift 3',0,10,1,1,1,10,'planned','2026-09-02','${NOW}','${NOW}')`)).toThrow();
  });
  it('rejects status=stone_placed with no Stone recorded at all', async () => {
    const {db, foundation} = await seededDatabase();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,status,created_at,updated_at) VALUES ('bad4','foundation','${foundation.id}',4,'Lift 4',0,10,1,1,1,10,'stone_placed','${NOW}','${NOW}')`)).toThrow();
  });
  it('rejects status=completed with no concrete phase recorded', async () => {
    const {db, foundation} = await seededDatabase();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,status,stone_actual_quantity_m3,created_at,updated_at) VALUES ('bad5','foundation','${foundation.id}',5,'Lift 5',0,10,1,1,1,10,'completed',6,'${NOW}','${NOW}')`)).toThrow();
  });
  it('rejects status=stone_placed when a concrete actual quantity is already recorded', async () => {
    const {db, foundation} = await seededDatabase();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,status,stone_actual_quantity_m3,concrete_actual_ready_mix_m3,created_at,updated_at) VALUES ('bad6','foundation','${foundation.id}',6,'Lift 6',0,10,1,1,1,10,'stone_placed',6,4,'${NOW}','${NOW}')`)).toThrow();
  });
  it('accepts a valid row in each of the three statuses', async () => {
    const {db, foundation} = await seededDatabase();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,status,created_at,updated_at) VALUES ('ok_planned','foundation','${foundation.id}',10,'Lift A',0,10,1,1,1,10,'planned','${NOW}','${NOW}')`)).not.toThrow();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,status,stone_actual_quantity_m3,created_at,updated_at) VALUES ('ok_stone','foundation','${foundation.id}',11,'Lift B',0,10,1,1,1,10,'stone_placed',6,'${NOW}','${NOW}')`)).not.toThrow();
    expect(() => db.raw.exec(`INSERT INTO cyclopean_lifts (id,parent_type,foundation_id,sequence,reference,start_elevation_m,length_m,height_m,bottom_thickness_m,top_thickness_m,net_lift_volume_m3,status,stone_actual_quantity_m3,concrete_calculation_method,concrete_actual_ready_mix_m3,created_at,updated_at) VALUES ('ok_complete','foundation','${foundation.id}',12,'Lift C',0,10,1,1,1,10,'completed',6,'estimated_matrix',4,'${NOW}','${NOW}')`)).not.toThrow();
  });
});

describe('migration 43: upgrade paths from earlier versions do not corrupt existing data', () => {
  const earlierVersions = [36, 37, 38, 39, 40, 41, 42];
  for (const version of earlierVersions) {
    it(`replays cleanly from a database reset to version ${version} after real seeded data exists`, async () => {
      const {db, foundation, wall, section} = await seededDatabase();
      const before = {
        foundation: db.raw.prepare('SELECT * FROM foundations WHERE id=?').get(foundation.id),
        wall: db.raw.prepare('SELECT * FROM walls WHERE id=?').get(wall.id),
        section: db.raw.prepare('SELECT * FROM construction_sections WHERE id=?').get(section.id),
      };
      // Established replay technique already used by this suite's own migration 42 regression test:
      // every migration step is idempotent (CREATE TABLE IF NOT EXISTS / addColumnIfMissing), so
      // resetting PRAGMA user_version on an already-current database and rerunning is a safe way to
      // exercise "upgrading from version N" without hand-reconstructing each historical schema shape.
      db.raw.exec(`PRAGMA user_version = ${version};`);
      await expect(migrateDatabase(db as never)).resolves.toBeUndefined();
      expect((db.raw.prepare('PRAGMA user_version').get() as {user_version: number}).user_version).toBe(43);
      expect(db.raw.prepare('SELECT * FROM foundations WHERE id=?').get(foundation.id)).toEqual(before.foundation);
      expect(db.raw.prepare('SELECT * FROM walls WHERE id=?').get(wall.id)).toEqual(before.wall);
      expect(db.raw.prepare('SELECT * FROM construction_sections WHERE id=?').get(section.id)).toEqual(before.section);
      expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
    });
  }

  it('never rewrites migrations 37-42: their tables keep their original column shape', async () => {
    const {db} = await seededDatabase();
    const walllayersColumns = db.raw.prepare('PRAGMA table_info(wall_layers)').all().map((c: unknown) => (c as {name: string}).name);
    expect(walllayersColumns).toContain('phase_order');
    const basesColumns = db.raw.prepare('PRAGMA table_info(wall_bases)').all().map((c: unknown) => (c as {name: string}).name);
    expect(basesColumns).toContain('foundation_mode');
  });

  it('is idempotent: running migrateDatabase again changes nothing further', async () => {
    const {db, foundation} = await seededDatabase();
    const before = db.raw.prepare('SELECT * FROM foundations WHERE id=?').get(foundation.id);
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT * FROM foundations WHERE id=?').get(foundation.id)).toEqual(before);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version: number}).user_version).toBe(43);
  });
});

describe('migration 43: legacy single-core data is untouched', () => {
  it('leaves foundation_composition_records and foundation single-core columns exactly as they were', async () => {
    const {db, walls, foundation} = await seededDatabase();
    await walls.setFoundationMode(foundation.id, 'composite', 'simple');
    await walls.addFoundationCompositionRecord({foundationId: foundation.id, materialType: 'stone', quantityM3: 10, recordedOn: '2026-09-02', notes: 'First delivery'});
    const before = db.raw.prepare('SELECT * FROM foundations WHERE id=?').get(foundation.id);
    const beforeRecords = db.raw.prepare('SELECT * FROM foundation_composition_records WHERE foundation_id=?').all(foundation.id);
    await db.raw.exec('PRAGMA user_version = 42;');
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT * FROM foundations WHERE id=?').get(foundation.id)).toEqual(before);
    expect(db.raw.prepare('SELECT * FROM foundation_composition_records WHERE foundation_id=?').all(foundation.id)).toEqual(beforeRecords);
    expect(db.raw.prepare('SELECT COUNT(*) count FROM cyclopean_lifts WHERE foundation_id=?').get(foundation.id)).toMatchObject({count: 0});
  });
});
