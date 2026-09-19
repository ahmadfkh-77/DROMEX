import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteConstructionLiftRepository} from '../src/data/repositories/SqliteConstructionLiftRepository';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';

/**
 * DEC-473. Migration 45 renames the Lift table from cyclopean_lifts to construction_lifts.
 *
 * The rename happens before this feature was ever released, but Expo development databases on the
 * Owner's own device already hold real Lifts, so the migration is held to the same standard as any
 * other: every row survives, nothing is rebuilt, and the old name is gone from the active schema.
 * These tests drive the migration from both realistic starting points -- a database that stopped at
 * 43 and one that stopped at 44 -- as well as a fresh install.
 */
class TestDatabase{
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

const TODAY=new Date().toISOString().slice(0,10);
const tables=(db:TestDatabase)=>db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>(row as {name:string}).name);
const indexes=(db:TestDatabase)=>db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row=>(row as {name:string}).name);

/** A migrated database holding two real Lifts on a foundation, exactly as the device would. */
async function seededWithLifts(){
  const db=new TestDatabase();databases.push(db);
  await migrateDatabase(db as never);
  db.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
    INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',0);
  `);
  const walls=new SqliteWallRepository(db as never);
  const lifts=new SqliteConstructionLiftRepository(db as never);
  const section=await walls.createConstructionSection({projectId:'road',name:'Section A',location:'Km 3+000',description:''});
  const foundation=await walls.createFoundation({
    projectId:'road',constructionSectionId:section.id,reference:'Foundation F1',location:'North abutment',
    lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0,
    materialType:null,concretePurpose:null,customPurposeId:null,
    quantity:null,quantityUnit:null,manualOverride:false,consumptionDate:null,notes:'',
  });
  for(const sequence of [1,2]){
    const lift=await lifts.createLift({parentType:'foundation',parentId:foundation.id,sequence,reference:`Lift ${sequence}`,
      startElevationM:(sequence-1)*.2,geometry:{lengthM:30,heightM:.2,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},notes:''});
    await lifts.saveStonePhase(lift.id,{calculationDimensions:{lengthM:30,heightM:.2,bottomThicknessM:.375,topThicknessM:.375,deductionM3:0},
      actualStoneQuantityM3:2.25,manualOverride:false,workDate:TODAY,position:null,offsets:null,notes:''});
  }
  return {db,walls,lifts,foundation};
}

/**
 * Winds a fully migrated database back to the state it had at `version`, with the Lift table under
 * its pre-rename name and its four original index names. This is how a device that last ran build 19
 * actually looks; the rows themselves are left exactly as the repository wrote them.
 */
function rewindToVersion(db:TestDatabase,version:number){
  db.raw.exec(`
    ALTER TABLE construction_lifts RENAME TO cyclopean_lifts;
    DROP INDEX IF EXISTS idx_construction_lifts_foundation_seq;
    DROP INDEX IF EXISTS idx_construction_lifts_wall_seq;
    DROP INDEX IF EXISTS idx_construction_lifts_foundation;
    DROP INDEX IF EXISTS idx_construction_lifts_wall;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cyclopean_lifts_foundation_seq ON cyclopean_lifts(foundation_id, sequence) WHERE foundation_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cyclopean_lifts_wall_seq ON cyclopean_lifts(wall_id, sequence) WHERE wall_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_cyclopean_lifts_foundation ON cyclopean_lifts(foundation_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_cyclopean_lifts_wall ON cyclopean_lifts(wall_id, sequence);
    PRAGMA user_version = ${version};
  `);
}

describe('migration 45: fresh install',()=>{
  it('reaches version 45 with construction_lifts and no cyclopean_lifts',async()=>{
    const db=new TestDatabase();databases.push(db);
    await migrateDatabase(db as never);
    expect(DATABASE_VERSION).toBe(45);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(45);
    expect(tables(db)).toContain('construction_lifts');
    expect(tables(db)).not.toContain('cyclopean_lifts');
    expect(db.raw.prepare('SELECT COUNT(*) count FROM construction_lifts').get()).toMatchObject({count:0});
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });

  it('carries the four indexes across under their new names',async()=>{
    const db=new TestDatabase();databases.push(db);
    await migrateDatabase(db as never);
    for(const name of ['idx_construction_lifts_foundation_seq','idx_construction_lifts_wall_seq','idx_construction_lifts_foundation','idx_construction_lifts_wall'])
      expect(indexes(db)).toContain(name);
    expect(indexes(db).filter(name=>name.includes('cyclopean'))).toEqual([]);
  });
});

describe.each([43,44])('migration 45: upgrading a version %i database',(version)=>{
  it('preserves every Lift row byte for byte',async()=>{
    const {db}=await seededWithLifts();
    const before=db.raw.prepare('SELECT * FROM construction_lifts ORDER BY id').all();
    expect(before).toHaveLength(2);

    rewindToVersion(db,version);
    await migrateDatabase(db as never);

    const after=db.raw.prepare('SELECT * FROM construction_lifts ORDER BY id').all();
    expect(after).toEqual(before);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(45);
  });

  it('removes the old table and the old index names from the active schema',async()=>{
    const {db}=await seededWithLifts();
    rewindToVersion(db,version);
    await migrateDatabase(db as never);

    expect(tables(db)).not.toContain('cyclopean_lifts');
    expect(tables(db)).toContain('construction_lifts');
    expect(indexes(db).filter(name=>name.includes('cyclopean'))).toEqual([]);
    expect(indexes(db)).toContain('idx_construction_lifts_foundation_seq');
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });

  it('keeps the repository reading its Lifts afterwards',async()=>{
    const {db,lifts,foundation}=await seededWithLifts();
    rewindToVersion(db,version);
    await migrateDatabase(db as never);

    const reloaded=await lifts.listLiftsForFoundation(foundation.id);
    expect(reloaded.map(lift=>lift.reference)).toEqual(['Lift 1','Lift 2']);
    expect(reloaded.every(lift=>lift.stonePhase.actualStoneQuantityM3===2.25)).toBe(true);
  });

  it('still enforces the unique sequence per parent through the renamed index',async()=>{
    const {db,lifts,foundation}=await seededWithLifts();
    rewindToVersion(db,version);
    await migrateDatabase(db as never);

    await expect(lifts.createLift({parentType:'foundation',parentId:foundation.id,sequence:1,reference:'Duplicate',
      startElevationM:0,geometry:{lengthM:30,heightM:.2,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},notes:''})).rejects.toThrow();
  });
});

describe('migration 45: replaying the chain',()=>{
  it('is safe to run again after migration 43 recreates its historical table',async()=>{
    const {db}=await seededWithLifts();
    const before=db.raw.prepare('SELECT * FROM construction_lifts ORDER BY id').all();

    // Replaying from 36 makes migration 43 create an empty cyclopean_lifts beside the renamed table.
    await db.execAsync('PRAGMA user_version = 36');
    await migrateDatabase(db as never);

    expect(db.raw.prepare('SELECT * FROM construction_lifts ORDER BY id').all()).toEqual(before);
    expect(tables(db)).not.toContain('cyclopean_lifts');
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(45);
  });
});
