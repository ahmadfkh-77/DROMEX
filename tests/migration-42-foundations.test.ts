import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';

class TestDatabase {
  readonly raw:DatabaseSync;
  constructor(){this.raw=new DatabaseSync(':memory:');}
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}
const NOW='2026-09-01T00:00:00.000Z';
const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

describe('migration 42: fresh install',()=>{
  it('reaches the current version with no existing data',async()=>{
    const db=new TestDatabase();databases.push(db);
    await migrateDatabase(db as never);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect(db.raw.prepare('SELECT COUNT(*) count FROM foundations').get()).toMatchObject({count:0});
    expect(db.raw.prepare('SELECT COUNT(*) count FROM construction_sections').get()).toMatchObject({count:0});
    expect(db.raw.prepare('SELECT COUNT(*) count FROM foundation_composition_records').get()).toMatchObject({count:0});
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });
});

describe('migration 42: upgrading a version 41 database with an existing wall/base pair',()=>{
  async function seedVersion41(){
    const db=new TestDatabase();databases.push(db);
    // Bring the db through the full real migration chain once (so every earlier migration's shape is
    // genuine and wall_bases/wall_base_composition_records exist, empty, in their real v41 shape),
    // then reverse only migration 42's own additions to reconstruct a version-41 database, and seed a
    // wall+base into that reconstructed shape. wall_bases and wall_base_composition_records
    // themselves are never touched by migration 42 (see its own comment), so they need no rebuilding.
    await migrateDatabase(db as never);
    db.raw.exec('PRAGMA foreign_keys=OFF;');
    db.raw.exec(`
      DROP TABLE foundation_composition_records;
      DROP TABLE foundations;
      DROP TABLE construction_sections;
      DROP INDEX idx_walls_foundation;
      ALTER TABLE walls DROP COLUMN foundation_id;
      PRAGMA user_version=41;
    `);
    db.raw.exec('PRAGMA foreign_keys=ON;');
    db.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
      INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
      INSERT INTO walls (id,project_id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,allowance_percent,net_volume_m3,planned_volume_m3,notes,base_required,created_at,updated_at)
        VALUES ('wall_a','road','Retaining wall A','rubble_masonry','retaining',20,4,.8,.4,0,0,48,48,NULL,1,'${NOW}','${NOW}');
      INSERT INTO walls (id,project_id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,allowance_percent,net_volume_m3,planned_volume_m3,notes,base_required,created_at,updated_at)
        VALUES ('wall_legacy','road','Old wall B','rubble_masonry','retaining',10,2,.5,.5,0,0,10,10,NULL,0,'${NOW}','${NOW}');
      INSERT INTO wall_bases (id,wall_id,reference,location,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,concrete_purpose,quantity,quantity_unit,manual_override,status,constructed_on,curing_started_on,notes,created_at,updated_at,foundation_mode,stone_core_mode,stone_core_position_x,stone_core_position_y)
        VALUES ('base_a','wall_a','Base A','Km 2+150',22,.8,1.2,1.2,0,21.12,21.12,'ready_mix','footing',21.12,'m3',0,'curing','2026-09-01','2026-09-01','Poured in one lift','${NOW}','${NOW}','composite','simple',.5,.5);
      INSERT INTO wall_base_composition_records (id,base_id,wall_id,material_type,quantity_m3,recorded_on,notes,created_at,updated_at)
        VALUES ('rec_1','base_a','wall_a','stone',10,'2026-09-02','First delivery','${NOW}','${NOW}');
    `);
    return db;
  }

  it('copies wall_bases into an independent foundations table, preserving every value and id, and leaves wall_bases itself in place, untouched',async()=>{
    const db=await seedVersion41();
    await migrateDatabase(db as never);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    const foundation=db.raw.prepare('SELECT * FROM foundations WHERE id=?').get('base_a') as Record<string,unknown>;
    expect(foundation).toMatchObject({
      id:'base_a',project_id:'road',legacy_wall_id:'wall_a',reference:'Base A',location:'Km 2+150',
      length_m:22,net_volume_m3:21.12,material_type:'ready_mix',status:'curing',foundation_mode:'composite',stone_core_mode:'simple',
    });
    expect(foundation.construction_section_id).toBe('section_legacy_road');
    const section=db.raw.prepare('SELECT * FROM construction_sections WHERE id=?').get('section_legacy_road') as Record<string,unknown>;
    expect(section).toMatchObject({project_id:'road',name:'Legacy Section',name_key:'legacy section'});
    // wall_bases is a superseded, inert remnant -- never dropped, so migrations 39-41 stay safe to replay.
    const legacyRow=db.raw.prepare('SELECT * FROM wall_bases WHERE id=?').get('base_a') as Record<string,unknown>;
    expect(legacyRow).toMatchObject({id:'base_a',reference:'Base A'});
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });

  it('links the existing wall through walls.foundation_id and enforces one wall per foundation',async()=>{
    const db=await seedVersion41();
    await migrateDatabase(db as never);
    const wall=db.raw.prepare('SELECT foundation_id FROM walls WHERE id=?').get('wall_a') as {foundation_id:string};
    expect(wall.foundation_id).toBe('base_a');
    expect(()=>db.raw.exec("UPDATE walls SET foundation_id='base_a' WHERE id='wall_legacy'")).toThrow();
  });

  it('leaves a legacy wall (no base) with no foundation, inventing nothing',async()=>{
    const db=await seedVersion41();
    await migrateDatabase(db as never);
    const legacy=db.raw.prepare('SELECT foundation_id,base_required FROM walls WHERE id=?').get('wall_legacy') as {foundation_id:string|null;base_required:number};
    expect(legacy.foundation_id).toBeNull();
    expect(legacy.base_required).toBe(0);
  });

  it('copies composition records into the new foundation_composition_records table, preserving every value',async()=>{
    const db=await seedVersion41();
    await migrateDatabase(db as never);
    const record=db.raw.prepare('SELECT * FROM foundation_composition_records WHERE id=?').get('rec_1') as Record<string,unknown>;
    expect(record).toMatchObject({foundation_id:'base_a',material_type:'stone',quantity_m3:10,notes:'First delivery'});
    expect('wall_id' in record).toBe(false);
    // The old row is left in place too, as an inert historical remnant.
    expect(db.raw.prepare('SELECT * FROM wall_base_composition_records WHERE id=?').get('rec_1')).toMatchObject({base_id:'base_a'});
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });

  it('is idempotent: running migrateDatabase again changes nothing further',async()=>{
    const db=await seedVersion41();
    await migrateDatabase(db as never);
    const before=db.raw.prepare('SELECT * FROM foundations WHERE id=?').get('base_a');
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT * FROM foundations WHERE id=?').get('base_a')).toEqual(before);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
  });

  // Regression: a database already fully migrated to the current version, whose PRAGMA user_version
  // is manually reset to an earlier one (as several older migration tests do, to replay just their own
  // step) must not corrupt wall_bases/wall_base_composition_records -- migrations 39-41 recreate them
  // with IF NOT EXISTS, assuming their original shape is exactly what a fresh chain would produce.
  it('replaying from an earlier version on an already-current database never fails, and never corrupts the legacy tables',async()=>{
    const db=await seedVersion41();
    await migrateDatabase(db as never); // now fully current
    db.raw.exec('PRAGMA user_version = 25;');
    await expect(migrateDatabase(db as never)).resolves.toBeUndefined();
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });
});

describe('migration 42: a version 41 database with no bases at all',()=>{
  it('upgrades cleanly, creating no legacy section and no foundation',async()=>{
    const db=new TestDatabase();databases.push(db);
    await migrateDatabase(db as never);
    db.raw.exec('PRAGMA foreign_keys=OFF;');
    db.raw.exec(`
      DROP TABLE foundation_composition_records;
      DROP TABLE foundations;
      DROP TABLE construction_sections;
      DROP INDEX idx_walls_foundation;
      ALTER TABLE walls DROP COLUMN foundation_id;
      PRAGMA user_version=41;
    `);
    db.raw.exec('PRAGMA foreign_keys=ON;');
    db.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
      INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
      INSERT INTO walls (id,project_id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,allowance_percent,net_volume_m3,planned_volume_m3,notes,base_required,created_at,updated_at)
        VALUES ('wall_legacy','road','Old wall B','rubble_masonry','retaining',10,2,.5,.5,0,0,10,10,NULL,0,'${NOW}','${NOW}');
    `);
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT COUNT(*) count FROM foundations').get()).toMatchObject({count:0});
    expect(db.raw.prepare('SELECT COUNT(*) count FROM construction_sections').get()).toMatchObject({count:0});
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });
});
