import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';
import {summarizeWallConsumption,type WallConsumptionDraft} from '../src/domain/walls';

class TestDatabase {
  readonly raw:DatabaseSync;
  constructor(location=':memory:'){this.raw=new DatabaseSync(location);}
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

const seedProjects=(db:TestDatabase)=>db.raw.exec(`
  INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
  INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
  INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('other','customer','Harbour','Beirut','active','${NOW}','${NOW}',0);
`);

async function setup(){
  const db=new TestDatabase();databases.push(db);
  await migrateDatabase(db as never);seedProjects(db);
  const walls=new SqliteWallRepository(db as never),reports=new SqliteProjectReportRepository(db as never);
  const wallDraft={name:'Retaining wall A',system:'rubble_masonry' as const,purpose:'retaining' as const,lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4,deductionM3:0,allowancePercent:0,notes:''};
  const wallA=await walls.saveWall({...wallDraft,projectId:'road'});
  db.raw.exec('UPDATE walls SET base_required=0');
  const wallB=await walls.saveWall({...wallDraft,projectId:'road',name:'Boundary wall B',system:'reinforced_concrete',purpose:'boundary'});
  const otherWall=await walls.saveWall({...wallDraft,projectId:'other',name:'Harbour wall'});
  db.raw.exec('UPDATE walls SET base_required=0');
  return{db,walls,reports,wallA,wallB,otherWall};
}

const draft=(wallId:string,overrides:Partial<WallConsumptionDraft>={}):WallConsumptionDraft=>({wallId,usedOn:'2026-09-10',type:'ready_mix',concretePurpose:'structural',customPurposeId:null,finishedVolumeM3:4.5,cementBags:null,cementBagKg:null,sandQuantity:null,sandUnit:null,gravelQuantity:null,gravelUnit:null,waterLitres:null,admixtureQuantity:null,admixtureUnit:null,stoneQuantity:null,stoneUnit:null,rebarDiameterMm:null,rebarCount:null,rebarLengthEachM:null,rebarGrade:'',notes:'',volume:null,...overrides});
const stoneCalc={lengthM:18,heightM:4.5,bottomThicknessM:0.9,topThicknessM:0.5,deductionM3:2.5};
const mixCalc={lengthM:10,heightM:2,bottomThicknessM:0.5,topThicknessM:0.5,deductionM3:0};
const count=(db:TestDatabase,sql:string)=>Number((db.raw.prepare(sql).get() as {count:number}).count);

describe('migration 37: wall consumption area, purposes, and corrections',()=>{
  it('keeps migration 37 in the upgrade path below the current version',()=>{expect(DATABASE_VERSION).toBeGreaterThanOrEqual(38);});

  it('emits the version 37 step through execAsync alone, as older installations migrate',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:36})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS wall_concrete_purposes'))).toBe(true);
    for(const column of ['custom_purpose_id','custom_purpose_label','area_length_m','area_height_m','area_deduction_m2','area_gross_m2','area_net_m2','correction_history_json','updated_at'])expect(statements.some(sql=>sql.includes(`ALTER TABLE wall_consumptions ADD COLUMN ${column} `))).toBe(true);
    // Structure only: no data-modifying statement is part of the version 37 step. Bounded to this
    // step's own statements -- later migrations (e.g. DEC-464's independent-foundation copy) may
    // legitimately contain real data-migrating statements of their own.
    const step37=statements.slice(statements.findIndex(sql=>sql.includes('wall_concrete_purposes')),statements.findIndex(sql=>sql.includes('volume_length_m')));
    expect(step37.some(sql=>/^\s*(UPDATE|INSERT|DELETE)\b/im.test(sql))).toBe(false);
    expect(statements.at(-1)).toBe(`PRAGMA user_version = ${DATABASE_VERSION}`);
  });

  it('upgrades a version 36 database without changing existing consumption records, and is safe to re-run',async()=>{
    const db=new TestDatabase();databases.push(db);
    await migrateDatabase(db as never);seedProjects(db);
    // Rebuild the genuine version-36 shape (the migration-21 table, no purpose table) before seeding.
    db.raw.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE wall_consumptions;
      DROP TABLE wall_concrete_purposes;
      CREATE TABLE wall_consumptions (
        id TEXT PRIMARY KEY NOT NULL, wall_id TEXT NOT NULL REFERENCES walls(id), used_on TEXT NOT NULL,
        material_type TEXT NOT NULL CHECK (material_type IN ('ready_mix','site_mix','rebar','stone')),
        concrete_purpose TEXT CHECK (concrete_purpose IN ('structural','filling','cyclopean_matrix','mortar','footing','coping')),
        finished_volume_m3 REAL, cement_bags REAL, cement_bag_kg REAL, sand_quantity REAL, sand_unit TEXT CHECK (sand_unit IN ('m3','tonnes')),
        gravel_quantity REAL, gravel_unit TEXT CHECK (gravel_unit IN ('m3','tonnes')), water_litres REAL, admixture_quantity REAL,
        admixture_unit TEXT CHECK (admixture_unit IN ('litres','kg')), stone_quantity REAL, stone_unit TEXT CHECK (stone_unit IN ('m3','tonnes')),
        rebar_diameter_mm REAL, rebar_count REAL, rebar_length_each_m REAL, total_rebar_length_m REAL, total_rebar_kg REAL, rebar_grade TEXT, notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_wall_consumptions_wall_date ON wall_consumptions(wall_id,used_on DESC,created_at DESC);
      PRAGMA foreign_keys = ON;
    `);
    expect((db.raw.prepare('PRAGMA table_info(wall_consumptions)').all() as {name:string}[]).some(column=>column.name==='area_net_m2')).toBe(false);
    db.raw.exec(`
      INSERT INTO walls (id,project_id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,allowance_percent,net_volume_m3,planned_volume_m3,created_at,updated_at) VALUES ('legacy_wall','road','Old wall','rubble_masonry','retaining',10,3,.6,.4,0,0,15,15,'${NOW}','${NOW}');
      INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,concrete_purpose,finished_volume_m3,created_at) VALUES ('legacy_mix','legacy_wall','2026-08-01','ready_mix','mortar',2.5,'${NOW}');
      INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,stone_quantity,stone_unit,notes,created_at) VALUES ('legacy_stone','legacy_wall','2026-08-01','stone',6,'tonnes','Old note','${NOW}');
    `);
    const before=db.raw.prepare('SELECT id,wall_id,used_on,material_type,concrete_purpose,finished_volume_m3,stone_quantity,stone_unit,notes,created_at FROM wall_consumptions ORDER BY id').all();
    db.raw.exec('PRAGMA user_version = 36;');
    await migrateDatabase(db as never);
    await migrateDatabase(db as never);
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({user_version:DATABASE_VERSION});
    expect(db.raw.prepare('SELECT id,wall_id,used_on,material_type,concrete_purpose,finished_volume_m3,stone_quantity,stone_unit,notes,created_at FROM wall_consumptions ORDER BY id').all()).toEqual(before);
    const detail=await new SqliteWallRepository(db as never).getWall('legacy_wall');
    expect(detail.entries.find(entry=>entry.id==='legacy_stone')).toMatchObject({volume:null,customPurposeId:null,customPurposeLabel:null,correctionHistory:[],updatedAt:null,stoneQuantity:6,stoneUnit:'tonnes'});
    expect(detail.entries.find(entry=>entry.id==='legacy_mix')).toMatchObject({concretePurpose:'mortar',finishedVolumeM3:2.5,volume:null});
    expect(db.raw.prepare('PRAGMA integrity_check').get()).toMatchObject({integrity_check:'ok'});
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });

  it('adds the purpose table, nullable area columns, correction history, and the report lookup index',async()=>{
    const {db}=await setup();
    const columns=(db.raw.prepare('PRAGMA table_info(wall_consumptions)').all() as {name:string;notnull:number;dflt_value:string|null}[]);
    const byName=new Map(columns.map(column=>[column.name,column]));
    for(const name of ['custom_purpose_id','custom_purpose_label','area_length_m','area_height_m','area_deduction_m2','area_gross_m2','area_net_m2','updated_at'])expect(byName.get(name)?.notnull).toBe(0);
    expect(byName.get('correction_history_json')).toMatchObject({notnull:1,dflt_value:"'[]'"});
    expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wall_concrete_purposes'").get()).toBeTruthy();
    expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_wall_concrete_purposes_label_key'").get()).toBeTruthy();
    expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_wall_consumptions_used_on'").get()).toBeTruthy();
  });

  it('enforces area consistency and purpose exclusivity at the database level',async()=>{
    const {db,wallA}=await setup();
    const insert=(columns:string,values:string)=>()=>db.raw.exec(`INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,created_at,${columns}) VALUES ('bad_${Math.random().toString(36).slice(2)}','${wallA.id}','2026-09-10','stone','${NOW}',${values})`);
    expect(insert('stone_quantity,stone_unit,area_length_m,area_height_m,area_deduction_m2,area_gross_m2,area_net_m2','1,\'m3\',10,4,0,40,0')).toThrow();
    expect(insert('stone_quantity,stone_unit,area_length_m,area_height_m,area_deduction_m2,area_gross_m2,area_net_m2','1,\'m3\',10,4,0,40,NULL')).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,rebar_diameter_mm,rebar_count,rebar_length_each_m,area_length_m,area_height_m,area_deduction_m2,area_gross_m2,area_net_m2,created_at) VALUES ('bad_rebar','${wallA.id}','2026-09-10','rebar',12,4,12,10,4,0,40,40,'${NOW}')`)).toThrow();
    db.raw.exec(`INSERT INTO wall_concrete_purposes (id,label,label_key,created_at) VALUES ('p1','Parapet','parapet','${NOW}')`);
    expect(()=>db.raw.exec(`INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,concrete_purpose,custom_purpose_id,custom_purpose_label,finished_volume_m3,created_at) VALUES ('bad_both','${wallA.id}','2026-09-10','ready_mix','structural','p1','Parapet',1,'${NOW}')`)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO wall_concrete_purposes (id,label,label_key,created_at) VALUES ('p2','PARAPET','parapet','${NOW}')`)).toThrow();
  });
});

describe('migration 38: wall consumption volume calculation',()=>{
  it('emits the version 38 step through execAsync alone, as older installations migrate',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:37})};
    await migrateDatabase(db as never);
    for(const column of ['volume_length_m','volume_height_m','volume_bottom_thickness_m','volume_top_thickness_m','volume_deduction_m3','volume_gross_m3','volume_net_m3'])expect(statements.some(sql=>sql.includes(`ALTER TABLE wall_consumptions ADD COLUMN ${column} `))).toBe(true);
    expect(statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS wall_concrete_purposes'))).toBe(false);
    // Structure only: no data-modifying statement is part of the version 38 step. Bounded to this
    // step's own statements -- later migrations (e.g. DEC-464's independent-foundation copy) may
    // legitimately contain real data-migrating statements of their own.
    const step38=statements.slice(statements.findIndex(sql=>sql.includes('volume_length_m')),statements.findIndex(sql=>sql.includes('wall_layers')));
    expect(step38.some(sql=>/^\s*(UPDATE|INSERT|DELETE)\b/im.test(sql))).toBe(false);
    expect(statements.at(-1)).toBe(`PRAGMA user_version = ${DATABASE_VERSION}`);
  });

  it('upgrades a version 37 database, including superseded area test data, without changing any record',async()=>{
    const {db,wallA}=await setup();
    db.raw.exec(`INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,stone_quantity,stone_unit,area_length_m,area_height_m,area_deduction_m2,area_gross_m2,area_net_m2,created_at) VALUES ('v37_area','${wallA.id}','2026-09-10','stone',9,'m3',18,4,10,72,62,'${NOW}')`);
    const before=db.raw.prepare("SELECT * FROM wall_consumptions WHERE id='v37_area'").get();
    db.raw.exec('PRAGMA user_version = 37;');
    await migrateDatabase(db as never);
    await migrateDatabase(db as never);
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({user_version:DATABASE_VERSION});
    expect(db.raw.prepare("SELECT * FROM wall_consumptions WHERE id='v37_area'").get()).toEqual(before);
    expect((await new SqliteWallRepository(db as never).getWall(wallA.id)).entries[0]).toMatchObject({stoneQuantity:9,volume:null});
  });

  it('adds nullable volume columns and enforces a complete, positive, Stone or Ready Mix calculation',async()=>{
    const {db,wallA}=await setup();
    const columns=new Map((db.raw.prepare('PRAGMA table_info(wall_consumptions)').all() as {name:string;notnull:number}[]).map(column=>[column.name,column]));
    for(const name of ['volume_length_m','volume_height_m','volume_bottom_thickness_m','volume_top_thickness_m','volume_deduction_m3','volume_gross_m3','volume_net_m3'])expect(columns.get(name)?.notnull).toBe(0);
    const insert=(type:string,extra:string,values:string)=>()=>db.raw.exec(`INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,created_at,${extra}) VALUES ('bad_${Math.random().toString(36).slice(2)}','${wallA.id}','2026-09-10','${type}','${NOW}',${values})`);
    const cols='stone_quantity,stone_unit,volume_length_m,volume_height_m,volume_bottom_thickness_m,volume_top_thickness_m,volume_deduction_m3,volume_gross_m3,volume_net_m3';
    expect(insert('stone',cols,"1,'m3',10,2,.5,.5,0,10,0")).toThrow();
    expect(insert('stone',cols,"1,'m3',10,2,.5,.5,0,10,NULL")).toThrow();
    expect(insert('stone',cols,"1,'m3',10,2,.5,.5,10,10,1")).toThrow();
    expect(insert('rebar','rebar_diameter_mm,rebar_count,rebar_length_each_m,volume_length_m,volume_height_m,volume_bottom_thickness_m,volume_top_thickness_m,volume_deduction_m3,volume_gross_m3,volume_net_m3',"12,4,12,10,2,.5,.5,0,10,10")).toThrow();
    expect(insert('stone',cols,"1,'m3',10,2,.5,.5,0,10,10")).not.toThrow();
  });
});

describe('volume calculation and reusable purposes in the wall repository',()=>{
  it('stores a Ready Mix and a Stone volume calculation beside the recorded quantity',async()=>{
    const {walls,wallA}=await setup();
    const mix=await walls.addConsumption(draft(wallA.id,{finishedVolumeM3:10,volume:mixCalc}));
    const stone=await walls.addConsumption(draft(wallA.id,{type:'stone',concretePurpose:null,finishedVolumeM3:null,stoneQuantity:54.2,stoneUnit:'m3',volume:stoneCalc}));
    expect(mix).toMatchObject({finishedVolumeM3:10,volume:{...mixCalc,grossVolumeM3:10,netVolumeM3:10}});
    expect(stone).toMatchObject({stoneQuantity:54.2,stoneUnit:'m3',volume:{...stoneCalc,grossVolumeM3:56.7,netVolumeM3:54.2}});
  });

  it('keeps an edited quantity when it differs from the calculation',async()=>{
    const {walls,wallA}=await setup();
    const stone=await walls.addConsumption(draft(wallA.id,{type:'stone',concretePurpose:null,finishedVolumeM3:null,stoneQuantity:53,stoneUnit:'m3',volume:stoneCalc}));
    expect(stone).toMatchObject({stoneQuantity:53,volume:{netVolumeM3:54.2}});
  });

  it('rejects invalid calculations, tonnes with a calculation, and a calculation on rebar without saving anything',async()=>{
    const {db,walls,wallA}=await setup();
    await expect(walls.addConsumption(draft(wallA.id,{volume:{lengthM:10,heightM:2,bottomThicknessM:0.5,topThicknessM:0.5,deductionM3:10}}))).rejects.toThrow('Volume deductions must be smaller than the gross wall volume.');
    await expect(walls.addConsumption(draft(wallA.id,{volume:{lengthM:-1,heightM:2,bottomThicknessM:0.5,topThicknessM:0.5,deductionM3:0}}))).rejects.toThrow('Wall length must be greater than zero');
    await expect(walls.addConsumption(draft(wallA.id,{type:'stone',concretePurpose:null,finishedVolumeM3:null,stoneQuantity:9,stoneUnit:'tonnes',volume:stoneCalc}))).rejects.toThrow('A calculated volume is in m³.');
    await expect(walls.addConsumption(draft(wallA.id,{type:'rebar',concretePurpose:null,finishedVolumeM3:null,rebarDiameterMm:12,rebarCount:4,rebarLengthEachM:12,volume:mixCalc}))).rejects.toThrow('A volume calculation can be recorded only for Stone and Ready Mix.');
    expect(count(db,'SELECT COUNT(*) count FROM wall_consumptions')).toBe(0);
  });

  it('creates, normalizes, lists, and reuses a custom purpose, and snapshots its label on the record',async()=>{
    const {db,walls,wallA}=await setup();
    const purpose=await walls.createConcretePurpose('  Parapet   cap concrete ');
    expect(purpose).toMatchObject({label:'Parapet cap concrete'});
    expect(await walls.listConcretePurposes()).toEqual([purpose]);
    const first=await walls.addConsumption(draft(wallA.id,{concretePurpose:null,customPurposeId:purpose.id,finishedVolumeM3:1.2}));
    const second=await walls.addConsumption(draft(wallA.id,{type:'site_mix',concretePurpose:null,customPurposeId:purpose.id,finishedVolumeM3:null,cementBags:8,cementBagKg:50}));
    expect(first).toMatchObject({concretePurpose:null,customPurposeId:purpose.id,customPurposeLabel:'Parapet cap concrete'});
    expect(second.customPurposeLabel).toBe('Parapet cap concrete');
    expect(count(db,"SELECT COUNT(*) count FROM sync_outbox WHERE entity_type='wallConcretePurpose'")).toBe(1);
  });

  it('rejects duplicate, built-in, empty, and unknown purposes',async()=>{
    const {walls,wallA}=await setup();
    await walls.createConcretePurpose('Parapet cap concrete');
    await expect(walls.createConcretePurpose('PARAPET  cap concrete')).rejects.toThrow('already exists');
    await expect(walls.createConcretePurpose('footing concrete')).rejects.toThrow('A purpose named “Footing concrete” already exists.');
    await expect(walls.createConcretePurpose('   ')).rejects.toThrow('Enter a purpose name.');
    await expect(walls.addConsumption(draft(wallA.id,{concretePurpose:null,customPurposeId:'missing'}))).rejects.toThrow('The selected purpose was not found.');
    expect(await walls.listConcretePurposes()).toHaveLength(1);
  });

  it('keeps every built-in purpose working exactly as before',async()=>{
    const {walls,wallA}=await setup();
    for(const purpose of ['structural','filling','cyclopean_matrix','mortar','footing','coping'] as const)await walls.addConsumption(draft(wallA.id,{concretePurpose:purpose}));
    expect((await walls.getWall(wallA.id)).entries.map(entry=>entry.concretePurpose).sort()).toEqual(['coping','cyclopean_matrix','filling','footing','mortar','structural']);
  });
});

describe('reasoned consumption corrections',()=>{
  it('requires a correction reason',async()=>{
    const {walls,wallA}=await setup();
    const entry=await walls.addConsumption(draft(wallA.id));
    await expect(walls.correctConsumption(entry.id,{...draft(wallA.id,{finishedVolumeM3:5}),correctionReason:'   '})).rejects.toThrow('A correction reason is required.');
  });

  it('refuses a correction that changes nothing',async()=>{
    const {walls,wallA}=await setup();
    const entry=await walls.addConsumption(draft(wallA.id,{notes:'Pour 1'}));
    await expect(walls.correctConsumption(entry.id,{...draft(wallA.id,{notes:' Pour 1 '}),correctionReason:'Checked'})).rejects.toThrow('Nothing changed. Edit at least one value before saving a correction.');
  });

  it('corrects quantity, unit, volume calculation, purpose, and date in place with a before/after audit and no duplicate',async()=>{
    const {db,walls,wallA}=await setup();
    const purpose=await walls.createConcretePurpose('Parapet cap concrete');
    const entry=await walls.addConsumption(draft(wallA.id));
    const corrected=await walls.correctConsumption(entry.id,{...draft(wallA.id,{usedOn:'2026-09-09',concretePurpose:null,customPurposeId:purpose.id,finishedVolumeM3:5,volume:{lengthM:10,heightM:1,bottomThicknessM:0.5,topThicknessM:0.5,deductionM3:0}}),correctionReason:'Delivery ticket re-checked'});
    expect(corrected.id).toBe(entry.id);
    expect(corrected).toMatchObject({usedOn:'2026-09-09',finishedVolumeM3:5,customPurposeLabel:'Parapet cap concrete',concretePurpose:null,volume:{grossVolumeM3:5,netVolumeM3:5},createdAt:entry.createdAt});
    expect(corrected.updatedAt).not.toBeNull();
    expect(corrected.correctionHistory).toHaveLength(1);
    expect(corrected.correctionHistory[0]).toMatchObject({correctedBy:'Owner',reason:'Delivery ticket re-checked'});
    expect(corrected.correctionHistory[0]!.changes).toEqual(expect.arrayContaining([
      {field:'Used on',originalValue:'2026-09-10',newValue:'2026-09-09'},
      {field:'Concrete / mortar purpose',originalValue:'Structural concrete',newValue:'Parapet cap concrete'},
      {field:'Concrete volume (m³)',originalValue:'4.5',newValue:'5'},
      {field:'Calculated net volume (m³)',originalValue:null,newValue:'5'},
    ]));
    const stone=await walls.addConsumption(draft(wallA.id,{type:'stone',concretePurpose:null,finishedVolumeM3:null,stoneQuantity:9,stoneUnit:'m3'}));
    const unit=await walls.correctConsumption(stone.id,{...draft(wallA.id,{type:'stone',concretePurpose:null,finishedVolumeM3:null,stoneQuantity:9,stoneUnit:'tonnes'}),correctionReason:'Weighbridge ticket'});
    expect(unit.correctionHistory[0]!.changes).toEqual([{field:'Stone',originalValue:'9 m³',newValue:'9 t'}]);
    expect(count(db,'SELECT COUNT(*) count FROM wall_consumptions')).toBe(2);
    const detail=await walls.getWall(wallA.id);
    expect(summarizeWallConsumption(detail.entries)).toMatchObject({structural:0,otherConcrete:5,stoneM3:0,stoneT:9,calculatedRecords:1});
    expect(count(db,"SELECT COUNT(*) count FROM sync_outbox WHERE entity_type='wallConsumption'")).toBe(4);
  });

  it('appends history across corrections and can remove a recorded calculation',async()=>{
    const {walls,wallA}=await setup();
    const entry=await walls.addConsumption(draft(wallA.id,{finishedVolumeM3:10,volume:mixCalc}));
    await walls.correctConsumption(entry.id,{...draft(wallA.id,{finishedVolumeM3:9.5,volume:mixCalc}),correctionReason:'First'});
    const second=await walls.correctConsumption(entry.id,{...draft(wallA.id,{finishedVolumeM3:9.5,volume:null}),correctionReason:'Calculation was for a different pour'});
    expect(second.volume).toBeNull();
    expect(second.correctionHistory.map(value=>value.reason)).toEqual(['First','Calculation was for a different pour']);
    expect(second.correctionHistory[1]!.changes.find(change=>change.field==='Calculated net volume (m³)')).toEqual({field:'Calculated net volume (m³)',originalValue:'10',newValue:null});
  });

  it('clears superseded area test data when such a record is corrected',async()=>{
    const {db,walls,wallA}=await setup();
    db.raw.exec(`INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,stone_quantity,stone_unit,area_length_m,area_height_m,area_deduction_m2,area_gross_m2,area_net_m2,created_at) VALUES ('area_row','${wallA.id}','2026-09-10','stone',9,'m3',18,4,10,72,62,'${NOW}')`);
    await walls.correctConsumption('area_row',{...draft(wallA.id,{type:'rebar',concretePurpose:null,finishedVolumeM3:null,rebarDiameterMm:12,rebarCount:4,rebarLengthEachM:6}),correctionReason:'Was rebar'});
    expect(db.raw.prepare("SELECT area_net_m2,material_type FROM wall_consumptions WHERE id='area_row'").get()).toMatchObject({area_net_m2:null,material_type:'rebar'});
  });

  it('keeps the wall relationship and rejects unknown records',async()=>{
    const {walls,wallA,wallB}=await setup();
    const entry=await walls.addConsumption(draft(wallA.id));
    await expect(walls.correctConsumption(entry.id,{...draft(wallB.id,{finishedVolumeM3:9}),correctionReason:'Wrong wall'})).rejects.toThrow('A correction cannot move a record to another wall.');
    await expect(walls.correctConsumption('missing',{...draft(wallA.id),correctionReason:'x'})).rejects.toThrow('The wall consumption record was not found.');
  });
});

describe('Daily Report wall construction linkage',()=>{
  it('returns only the same project and work date, grouped by wall, with corrections applied',async()=>{
    const {walls,reports,wallA,wallB,otherWall}=await setup();
    const purpose=await walls.createConcretePurpose('Parapet cap concrete');
    await walls.addConsumption(draft(wallA.id,{finishedVolumeM3:10,volume:mixCalc}));
    await walls.addConsumption(draft(wallA.id,{type:'stone',concretePurpose:null,finishedVolumeM3:null,stoneQuantity:54.2,stoneUnit:'m3',volume:stoneCalc}));
    await walls.addConsumption(draft(wallB.id,{concretePurpose:null,customPurposeId:purpose.id,finishedVolumeM3:1.25}));
    await walls.addConsumption(draft(wallB.id,{type:'stone',concretePurpose:null,finishedVolumeM3:null,stoneQuantity:3,stoneUnit:'tonnes'}));
    await walls.addConsumption(draft(wallA.id,{usedOn:'2026-09-11'}));
    await walls.addConsumption(draft(otherWall.id));
    const moved=await walls.addConsumption(draft(wallB.id,{usedOn:'2026-09-08'}));

    const linked=await reports.listLinkedWallWork('road','2026-09-10');
    expect(linked.map(group=>group.wallName)).toEqual(['Boundary wall B','Retaining wall A']);
    expect(linked.find(group=>group.wallId===wallA.id)).toMatchObject({system:'rubble_masonry',lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4});
    expect(linked.find(group=>group.wallId===wallA.id)!.entries.map(entry=>entry.volume?.netVolumeM3)).toEqual([10,54.2]);
    expect(linked.find(group=>group.wallId===wallB.id)!.entries.map(entry=>[entry.customPurposeLabel,entry.volume])).toEqual([['Parapet cap concrete',null],[null,null]]);
    expect(linked.flatMap(group=>group.entries)).toHaveLength(4);
    expect(await reports.listLinkedWallWork('other','2026-09-10')).toHaveLength(1);
    expect(await reports.listLinkedWallWork('road','2026-09-12')).toEqual([]);

    await walls.correctConsumption(moved.id,{...draft(wallB.id,{usedOn:'2026-09-10',finishedVolumeM3:2}),correctionReason:'Pour date was wrong'});
    const after=await reports.listLinkedWallWork('road','2026-09-10');
    expect(after.flatMap(group=>group.entries)).toHaveLength(5);
    expect(after.flatMap(group=>group.entries).find(entry=>entry.id===moved.id)).toMatchObject({finishedVolumeM3:2,correctionHistory:[expect.objectContaining({reason:'Pour date was wrong'})]});
    expect(await reports.listLinkedWallWork('road','2026-09-08')).toEqual([]);
  });

  it('excludes walls under an archived project',async()=>{
    const {db,walls,reports,wallA}=await setup();
    await walls.addConsumption(draft(wallA.id));
    db.raw.exec("UPDATE projects SET is_archived=1 WHERE id='road'");
    expect(await reports.listLinkedWallWork('road','2026-09-10')).toEqual([]);
  });
});

describe('backup and restore of wall improvements',()=>{
  it('carries volume calculations, custom purposes, correction history, and legacy rows through a restored database file',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'dromex-wall-backup-')),path=join(directory,'backup.sqlite');
    try{
      const original=new TestDatabase(path);
      await migrateDatabase(original as never);seedProjects(original);
      const walls=new SqliteWallRepository(original as never);
      const wall=await walls.saveWall({projectId:'road',name:'Wall A',system:'rubble_masonry',purpose:'retaining',lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4,deductionM3:0,allowancePercent:0,notes:''});
      original.raw.exec('UPDATE walls SET base_required=0');
      const purpose=await walls.createConcretePurpose('Parapet cap concrete');
      const stone=await walls.addConsumption(draft(wall.id,{type:'stone',concretePurpose:null,finishedVolumeM3:null,stoneQuantity:54.2,stoneUnit:'m3',volume:stoneCalc}));
      await walls.correctConsumption(stone.id,{...draft(wall.id,{type:'stone',concretePurpose:null,finishedVolumeM3:null,stoneQuantity:53,stoneUnit:'m3',volume:stoneCalc}),correctionReason:'Recount'});
      await walls.addConsumption(draft(wall.id,{concretePurpose:null,customPurposeId:purpose.id}));
      original.raw.exec(`INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,stone_quantity,stone_unit,created_at) VALUES ('legacy','${wall.id}','2026-08-01','stone',4,'tonnes','${NOW}')`);
      original.raw.exec('PRAGMA wal_checkpoint(FULL)');
      original.close();

      const restored=new TestDatabase(path);
      try{
        await migrateDatabase(restored as never);
        const repository=new SqliteWallRepository(restored as never);
        expect(await repository.listConcretePurposes()).toEqual([purpose]);
        const entries=(await repository.getWall(wall.id)).entries;
        expect(entries.find(entry=>entry.id===stone.id)).toMatchObject({stoneQuantity:53,volume:{netVolumeM3:54.2},correctionHistory:[expect.objectContaining({reason:'Recount'})]});
        expect(entries.find(entry=>entry.customPurposeId===purpose.id)?.customPurposeLabel).toBe('Parapet cap concrete');
        expect(entries.find(entry=>entry.id==='legacy')).toMatchObject({volume:null,correctionHistory:[],stoneQuantity:4});
        await expect(repository.createConcretePurpose('parapet cap CONCRETE')).rejects.toThrow('already exists');
        expect(restored.raw.prepare('PRAGMA integrity_check').get()).toMatchObject({integrity_check:'ok'});
        expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
      }finally{restored.close();}
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});
