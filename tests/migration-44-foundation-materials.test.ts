import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';
import {validateFoundationDraft,type FoundationDraft} from '../src/domain/foundations';

/**
 * DEC-468. Migration 44 and the corrected Foundation workflow: a foundation records a structural
 * envelope, never a material consumption. Top-level material/quantity/unit become optional, an
 * existing populated record is preserved byte-for-byte, and actual Stone and concrete are recorded
 * only through Lift phases.
 */
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

const NOW='2026-09-18T00:00:00.000Z';
const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function seeded(){
  const db=new TestDatabase();databases.push(db);
  await migrateDatabase(db as never);
  db.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
  `);
  const walls=new SqliteWallRepository(db as never);
  const section=await walls.createConstructionSection({projectId:'road',name:'Section A',location:'Km 3+000',description:''});
  return {db,walls,section};
}

/** The new, normal shape: identity and geometry only, with no material consumption claimed. */
const plannedDraft=(sectionId:string,overrides:Partial<FoundationDraft>={}):FoundationDraft=>({
  projectId:'road',constructionSectionId:sectionId,reference:'Foundation F1',location:'North abutment',
  lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0,
  materialType:null,concretePurpose:null,customPurposeId:null,
  quantity:null,quantityUnit:null,manualOverride:false,consumptionDate:null,notes:'',...overrides,
});

/** A pre-DEC-468 foundation that really does carry a top-level material record. */
const legacyDraft=(sectionId:string,overrides:Partial<FoundationDraft>={}):FoundationDraft=>plannedDraft(sectionId,{
  reference:'Legacy Foundation',materialType:'ready_mix',concretePurpose:'footing',
  quantity:9,quantityUnit:'m3',manualOverride:true,consumptionDate:'2026-09-01',...overrides,
});

describe('migration 44: schema',()=>{
  it('advances the database version',async()=>{
    expect(DATABASE_VERSION).toBe(45);
    const {db}=await seeded();
    expect((await db.getFirstAsync<{user_version:number}>('PRAGMA user_version'))?.user_version).toBe(45);
  });

  it('makes the three legacy material columns nullable and keeps every other column',async()=>{
    const {db}=await seeded();
    const columns=await db.getAllAsync<{name:string;notnull:number}>('PRAGMA table_info(foundations)');
    const byName=new Map(columns.map(column=>[column.name,column]));
    for(const optional of ['material_type','quantity','quantity_unit'])expect(byName.get(optional)?.notnull).toBe(0);
    for(const required of ['id','project_id','construction_section_id','reference','length_m','height_m','bottom_thickness_m','top_thickness_m','gross_volume_m3','net_volume_m3','status','created_at'])
      expect(byName.get(required)?.notnull).toBe(1);
    for(const kept of ['legacy_wall_id','location','deduction_m3','concrete_purpose','custom_purpose_id','custom_purpose_label','manual_override','consumption_date','constructed_on','curing_started_on','cured_on','curing_note','notes','correction_history_json','foundation_mode','stone_core_mode','stone_core_position_x','stone_core_position_y','stone_core_offsets_json','updated_at'])
      expect(byName.has(kept)).toBe(true);
  });

  it('keeps the foundation indexes and the wall foreign key intact',async()=>{
    const {db}=await seeded();
    const indexes=await db.getAllAsync<{name:string}>("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='foundations'");
    for(const name of ['idx_foundations_project','idx_foundations_section','idx_foundations_legacy_wall'])
      expect(indexes.some(index=>index.name===name)).toBe(true);
    const wallsSql=(await db.getFirstAsync<{sql:string}>("SELECT sql FROM sqlite_master WHERE type='table' AND name='walls'"))!.sql;
    expect(wallsSql).toContain('REFERENCES foundations(id)');
  });

  it('refuses a partial material combination at the database level',async()=>{
    const {db,section}=await seeded();
    const insert=(material:string|null,quantity:number|null,unit:string|null)=>db.raw.prepare(
      `INSERT INTO foundations (id,project_id,construction_section_id,reference,location,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,quantity,quantity_unit,manual_override,status,correction_history_json,created_at)
       VALUES (?, 'road', ?, 'Partial', NULL, 10, 1, 1, 1, 0, 10, 10, ?, ?, ?, 0, 'planned', '[]', ?)`,
    ).run(`partial_${material}_${quantity}_${unit}`,section.id,material,quantity,unit,NOW);
    expect(()=>insert('ready_mix',null,null)).toThrow();
    expect(()=>insert(null,9,null)).toThrow();
    expect(()=>insert(null,null,'m3')).toThrow();
    expect(()=>insert('ready_mix',9,null)).toThrow();
    expect(()=>insert(null,null,null)).not.toThrow();
    expect(()=>insert('ready_mix',9,'m3')).not.toThrow();
  });

  it('still refuses a zero, negative, or out-of-range populated value at the database level',async()=>{
    const {db,section}=await seeded();
    const insert=(material:string,quantity:number,unit:string)=>db.raw.prepare(
      `INSERT INTO foundations (id,project_id,construction_section_id,reference,location,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,quantity,quantity_unit,manual_override,status,correction_history_json,created_at)
       VALUES (?, 'road', ?, 'Bad', NULL, 10, 1, 1, 1, 0, 10, 10, ?, ?, ?, 0, 'planned', '[]', ?)`,
    ).run(`bad_${material}_${quantity}_${unit}`,section.id,material,quantity,unit,NOW);
    expect(()=>insert('ready_mix',0,'m3')).toThrow();
    expect(()=>insert('ready_mix',-5,'m3')).toThrow();
    expect(()=>insert('gravel',9,'m3')).toThrow();
    expect(()=>insert('ready_mix',9,'litres')).toThrow();
  });
});

describe('migration 44: existing data is preserved exactly',()=>{
  it('replays the 43 to 44 step over real rows without changing one value',async()=>{
    const {db,walls,section}=await seeded();
    const populated=await walls.createFoundation(legacyDraft(section.id));
    const planned=await walls.createFoundation(plannedDraft(section.id,{reference:'Planned F2'}));
    const before=await db.getAllAsync<Record<string,unknown>>('SELECT * FROM foundations ORDER BY id');
    expect(before).toHaveLength(2);

    // The same replay assumption migrations 37-43 rely on (DEC-465): reset the version and run again.
    await db.execAsync('PRAGMA user_version = 43');
    await migrateDatabase(db as never);

    const after=await db.getAllAsync<Record<string,unknown>>('SELECT * FROM foundations ORDER BY id');
    expect(after).toEqual(before);
    expect((await db.getFirstAsync<{user_version:number}>('PRAGMA user_version'))?.user_version).toBe(45);
    expect((await walls.getFoundation(populated.id))?.quantity).toBe(9);
    expect((await walls.getFoundation(planned.id))?.quantity).toBeNull();
  });

  it('never rewrites a legacy foundation into the new shape',async()=>{
    const {db,walls,section}=await seeded();
    const legacy=await walls.createFoundation(legacyDraft(section.id));
    await db.execAsync('PRAGMA user_version = 43');
    await migrateDatabase(db as never);
    const reloaded=(await walls.getFoundation(legacy.id))!;
    expect(reloaded.materialType).toBe('ready_mix');
    expect(reloaded.quantity).toBe(9);
    expect(reloaded.quantityUnit).toBe('m3');
    expect(reloaded.concretePurpose).toBe('footing');
    expect(reloaded.consumptionDate).toBe('2026-09-01');
    expect(reloaded.manualOverride).toBe(true);
  });

  it('leaves migrations 1 to 43 untouched in the source file',()=>{
    const source=readFileSync(join(__dirname,'..','src/data/database/migrations.ts'),'utf8');
    expect(source).toContain('quantity REAL NOT NULL CHECK (quantity > 0)');
    expect(source).toContain('currentVersion = 43;');
    expect(source).toContain('currentVersion = 44;');
    expect(source).not.toContain('ALTER TABLE wall_bases');
  });
});

describe('a planned foundation needs no material consumption',()=>{
  it('accepts a draft with identity and geometry only',()=>{
    expect(validateFoundationDraft(plannedDraft('section'))).toEqual([]);
  });

  it('saves and round-trips with every legacy material field null',async()=>{
    const {walls,section}=await seeded();
    const created=await walls.createFoundation(plannedDraft(section.id));
    expect(created.materialType).toBeNull();
    expect(created.quantity).toBeNull();
    expect(created.quantityUnit).toBeNull();
    expect(created.concretePurpose).toBeNull();
    expect(created.customPurposeId).toBeNull();
    expect(created.consumptionDate).toBeNull();
    const reloaded=(await walls.getFoundation(created.id))!;
    expect(reloaded).toMatchObject({materialType:null,quantity:null,quantityUnit:null,consumptionDate:null});
  });

  it('never copies the calculated structural volume into the quantity',async()=>{
    const {walls,section}=await seeded();
    const created=await walls.createFoundation(plannedDraft(section.id));
    expect(created.netVolumeM3).toBe(9);
    expect(created.quantity).toBeNull();
    expect(created.quantity).not.toBe(created.netVolumeM3);
  });

  it('still calculates the structural envelope from the geometry',async()=>{
    const {walls,section}=await seeded();
    const created=await walls.createFoundation(plannedDraft(section.id));
    expect(created.grossVolumeM3).toBe(9);
    expect(created.netVolumeM3).toBe(9);
  });

  it('keeps a populated material record valid',()=>{
    expect(validateFoundationDraft(legacyDraft('section'))).toEqual([]);
  });

  it('rejects a partial combination of material, quantity and unit',()=>{
    for(const partial of [
      {materialType:'ready_mix' as const},{quantity:9},{quantityUnit:'m3' as const},
      {materialType:'ready_mix' as const,quantity:9},{materialType:'stone' as const,quantityUnit:'m3' as const},
    ]){
      const issues=validateFoundationDraft(plannedDraft('section',partial));
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.join(' ')).toMatch(/together|all three/i);
    }
  });

  it('rejects a zero or negative populated quantity',()=>{
    for(const quantity of [0,-4]){
      const issues=validateFoundationDraft(legacyDraft('section',{quantity}));
      expect(issues.join(' ')).toMatch(/greater than zero/i);
    }
  });

  it('rejects a purpose or consumption date recorded with no material at all',()=>{
    expect(validateFoundationDraft(plannedDraft('section',{concretePurpose:'footing'})).length).toBeGreaterThan(0);
    expect(validateFoundationDraft(plannedDraft('section',{consumptionDate:'2026-09-01'})).length).toBeGreaterThan(0);
  });

  it('still rejects impossible geometry without mentioning material',()=>{
    const issues=validateFoundationDraft(plannedDraft('section',{lengthM:0}));
    expect(issues.join(' ')).toMatch(/length/i);
    expect(issues.join(' ')).not.toMatch(/quantity/i);
  });

  it('still rejects a deduction that swallows the envelope',()=>{
    expect(validateFoundationDraft(plannedDraft('section',{deductionM3:99})).length).toBeGreaterThan(0);
  });

  it('leaves the legacy per-wall base rule completely unchanged',async()=>{
    const {validateWallBase}=await import('../src/domain/wallBase');
    const base={reference:'Base',location:'',lengthM:10,heightM:1,bottomThicknessM:1,topThicknessM:1,deductionM3:0,
      materialType:'ready_mix' as const,concretePurpose:'footing' as const,customPurposeId:null,
      quantity:null,quantityUnit:'m3' as const,manualOverride:false,consumptionDate:null,notes:''};
    expect(validateWallBase(base).join(' ')).toMatch(/quantity must be greater than zero/i);
  });
});

describe('correcting a foundation never erases a legacy material record',()=>{
  it('keeps the legacy values when only geometry is corrected',async()=>{
    const {walls,section}=await seeded();
    const legacy=await walls.createFoundation(legacyDraft(section.id));
    const corrected=await walls.correctFoundation(legacy.id,{
      ...legacyDraft(section.id),lengthM:32,correctionReason:'Re-measured on site',
    });
    expect(corrected.lengthM).toBe(32);
    expect(corrected.materialType).toBe('ready_mix');
    expect(corrected.quantity).toBe(9);
    expect(corrected.quantityUnit).toBe('m3');
  });

  it('allows a planned foundation to be corrected while still carrying no material',async()=>{
    const {walls,section}=await seeded();
    const planned=await walls.createFoundation(plannedDraft(section.id));
    const corrected=await walls.correctFoundation(planned.id,{
      ...plannedDraft(section.id),heightM:.5,correctionReason:'Depth corrected',
    });
    expect(corrected.heightM).toBe(.5);
    expect(corrected.quantity).toBeNull();
    expect(corrected.materialType).toBeNull();
  });
});

describe('structural envelope and lift consumption are never double counted',()=>{
  it('reconciles lifts without reading the foundation quantity at all',async()=>{
    const {db,walls,section}=await seeded();
    const {SqliteConstructionLiftRepository}=await import('../src/data/repositories/SqliteConstructionLiftRepository');
    const lifts=new SqliteConstructionLiftRepository(db as never);
    const legacy=await walls.createFoundation(legacyDraft(section.id,{quantity:9,lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75}));
    const before=await lifts.reconcileFoundation(legacy.id);
    expect(before.totalCalculatedStoneM3).toBe(0);
    expect(before.totalActualReadyMixM3).toBe(0);
    expect(before.totalAllocatedLiftVolumeM3).toBe(0);
    // The foundation's own legacy 9 m³ is never counted as lift consumption.
    expect(before.remainingUnallocatedVolumeM3).toBe(9);
  });
});
