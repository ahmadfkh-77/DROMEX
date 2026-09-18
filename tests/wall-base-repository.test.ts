import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';
import type {WallBaseDraft} from '../src/domain/wallBase';
import type {WallConsumptionDraft} from '../src/domain/walls';

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
const seed=(db:TestDatabase)=>db.raw.exec(`
  INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
  INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
`);
const wallDraft={projectId:'road',name:'Retaining wall A',system:'rubble_masonry' as const,purpose:'retaining' as const,lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4,deductionM3:0,allowancePercent:0,notes:''};

async function setup(location?:string){
  const db=new TestDatabase(location);databases.push(db);
  await migrateDatabase(db as never);seed(db);
  const walls=new SqliteWallRepository(db as never);
  const wall=await walls.saveWall(wallDraft);
  return{db,walls,wall};
}
const baseDraft=(wallId:string,overrides:Partial<WallBaseDraft>={}):WallBaseDraft=>({wallId,reference:'Base A',location:'Km 2+150',lengthM:22,heightM:.8,bottomThicknessM:1.2,topThicknessM:1.2,deductionM3:0,materialType:'ready_mix',concretePurpose:'footing',customPurposeId:null,quantity:21.12,quantityUnit:'m3',manualOverride:false,consumptionDate:'2026-09-01',notes:'',...overrides});
const use=(wallId:string,overrides:Partial<WallConsumptionDraft>={}):WallConsumptionDraft=>({wallId,usedOn:'2026-09-10',type:'stone',concretePurpose:null,customPurposeId:null,finishedVolumeM3:null,cementBags:null,cementBagKg:null,sandQuantity:null,sandUnit:null,gravelQuantity:null,gravelUnit:null,waterLitres:null,admixtureQuantity:null,admixtureUnit:null,stoneQuantity:9,stoneUnit:'m3',rebarDiameterMm:null,rebarCount:null,rebarLengthEachM:null,rebarGrade:'',notes:'',volume:null,...overrides});

async function cureBase(walls:SqliteWallRepository,wallId:string){
  await walls.saveBase(baseDraft(wallId));
  await walls.changeBaseStatus(wallId,{status:'constructed',constructedOn:'2026-09-01'});
  await walls.changeBaseStatus(wallId,{status:'curing',curingStartedOn:'2026-09-01'});
  return walls.changeBaseStatus(wallId,{status:'cured',curedOn:'2026-09-08',inspected:true});
}

describe('migration 40: wall base and curing lifecycle',()=>{
  it('is at least version 40 (later migrations may have advanced it further)',()=>{expect(DATABASE_VERSION).toBeGreaterThanOrEqual(40);});

  it('emits the version 40 step through execAsync alone, changing no existing record',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:39})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS wall_bases'))).toBe(true);
    expect(statements.some(sql=>sql.includes('ADD COLUMN base_required'))).toBe(true);
    expect(statements.some(sql=>/^\s*(UPDATE|INSERT|DELETE)\b/im.test(sql))).toBe(false);
    expect(statements.at(-1)).toBe(`PRAGMA user_version = ${DATABASE_VERSION}`);
  });

  it('upgrades a version 39 database, leaving existing walls usable as legacy walls',async()=>{
    const {db,walls,wall}=await setup();
    // A wall that existed before the rule: recorded with no base, exactly as version 39 stored it.
    db.raw.exec('UPDATE walls SET base_required=0');
    await walls.addConsumption(use(wall.id));
    const before=db.raw.prepare('SELECT id,name,bottom_thickness_m FROM walls').all();
    db.raw.exec("DROP TABLE wall_bases; ALTER TABLE walls DROP COLUMN base_required; PRAGMA user_version = 39;");
    await migrateDatabase(db as never);
    await migrateDatabase(db as never);
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({user_version:DATABASE_VERSION});
    expect(db.raw.prepare('SELECT id,name,bottom_thickness_m FROM walls').all()).toEqual(before);
    // The wall existed before the rule, so it stays usable and is never given an invented base.
    const detail=await walls.getWall(wall.id);
    expect(detail.base).toBeNull();
    expect(detail.stage).toMatchObject({locked:false,legacy:true,reason:'Base not recorded — legacy wall'});
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-11'}))).resolves.toBeTruthy();
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });

  it('allows one base per wall and refuses an unknown status at the database level',async()=>{
    const {db,walls,wall}=await setup();
    await walls.saveBase(baseDraft(wall.id));
    expect(()=>db.raw.exec(`INSERT INTO wall_bases (id,wall_id,reference,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,quantity,quantity_unit,manual_override,status,created_at) VALUES ('second','${wall.id}','B',10,1,1,1,0,10,10,'ready_mix',10,'m3',0,'planned','${NOW}')`)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO wall_bases (id,wall_id,reference,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,quantity,quantity_unit,manual_override,status,created_at) VALUES ('bad','other','B',10,1,1,1,0,10,10,'ready_mix',10,'m3',0,'approved','${NOW}')`)).toThrow();
  });
});

describe('base workflow and wall stage gating',()=>{
  it('requires a base before wall work on a wall created under the rule',async()=>{
    const {walls,wall}=await setup();
    const detail=await walls.getWall(wall.id);
    expect(detail.base).toBeNull();
    expect(detail.stage).toMatchObject({locked:true,legacy:false});
    await expect(walls.addConsumption(use(wall.id))).rejects.toThrow('Record the base for this wall before recording wall construction.');
    await expect(walls.saveLayers(wall.id,[{name:'Core',phaseOrder:1,bottomThicknessM:.8,topThicknessM:.4,note:'',materialKey:null}])).rejects.toThrow('Record the base for this wall before recording wall construction.');
  });

  it('calculates the base volume, fills the quantity, and records the material',async()=>{
    const {walls,wall}=await setup();
    const saved=await walls.saveBase(baseDraft(wall.id));
    expect(saved).toMatchObject({grossVolumeM3:21.12,netVolumeM3:21.12,quantity:21.12,quantityUnit:'m3',manualOverride:false,status:'planned',concretePurpose:'footing'});
    const overridden=await walls.saveBase(baseDraft(wall.id,{quantity:23,manualOverride:true}));
    // A manual override never rewrites the calculation it disagrees with.
    expect(overridden).toMatchObject({quantity:23,manualOverride:true,netVolumeM3:21.12});
  });

  // DEC-463. Curing is tracked information, never a workflow gate: wall work is available for a
  // base in any status once the base itself is recorded, and a status change never refuses it.
  it('allows wall work as soon as the base is recorded, in every base status',async()=>{
    const {walls,wall}=await setup();
    await walls.saveBase(baseDraft(wall.id));
    await expect(walls.addConsumption(use(wall.id))).resolves.toBeTruthy();
    expect((await walls.getWall(wall.id)).stage).toMatchObject({locked:false,curingConfirmed:false});
    await walls.changeBaseStatus(wall.id,{status:'constructed',constructedOn:'2026-09-01'});
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-11'}))).resolves.toBeTruthy();
    await walls.changeBaseStatus(wall.id,{status:'curing',curingStartedOn:'2026-09-01'});
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-12'}))).resolves.toBeTruthy();
    // The cured confirmation itself still requires its own date and explicit inspection.
    await expect(walls.changeBaseStatus(wall.id,{status:'cured',curedOn:'2026-09-08'})).rejects.toThrow('Confirm that the base was inspected');
    const cured=await walls.changeBaseStatus(wall.id,{status:'cured',curedOn:'2026-09-08',inspected:true,curingNote:'Seven days'});
    expect(cured).toMatchObject({status:'cured',curedOn:'2026-09-08',curingNote:'Seven days'});
    expect((await walls.getWall(wall.id)).stage).toMatchObject({locked:false,curingConfirmed:true});
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-13'}))).resolves.toBeTruthy();
  });

  it('accepts wall work dated before, during, and after the cured date, never refusing it for chronology',async()=>{
    const {walls,wall}=await setup();
    await cureBase(walls,wall.id);
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-07'}))).resolves.toBeTruthy();
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-08'}))).resolves.toBeTruthy();
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-30'}))).resolves.toBeTruthy();
  });

  it('accepts wall geometry (layers) before curing is confirmed',async()=>{
    const {walls,wall}=await setup();
    await walls.saveBase(baseDraft(wall.id));
    await expect(walls.saveLayers(wall.id,[{name:'Core',phaseOrder:1,bottomThicknessM:.8,topThicknessM:.4,note:'',materialKey:null}])).resolves.toBeTruthy();
  });

  it('refuses a skipped status transition, but allows reverting a cured base to curing even once wall work exists',async()=>{
    const {walls,wall}=await setup();
    await walls.saveBase(baseDraft(wall.id));
    await expect(walls.changeBaseStatus(wall.id,{status:'cured',curedOn:'2026-09-08',inspected:true})).rejects.toThrow('A base moves from planned to constructed');
    await cureBase(walls,wall.id);
    await walls.addConsumption(use(wall.id));
    const entriesBefore=(await walls.getWall(wall.id)).entries;
    const reverted=await walls.changeBaseStatus(wall.id,{status:'curing',curingStartedOn:'2026-09-01'});
    expect(reverted).toMatchObject({status:'curing'});
    // The revert never touches the wall records recorded above the base.
    expect((await walls.getWall(wall.id)).entries).toEqual(entriesBefore);
  });
});

describe('base corrections',()=>{
  it('corrects a base with a reason and a before/after audit, without duplicating it',async()=>{
    const {db,walls,wall}=await setup();
    await cureBase(walls,wall.id);
    const corrected=await walls.correctBase(wall.id,{...baseDraft(wall.id,{lengthM:24,quantity:23.04}),correctionReason:'Site survey re-measured'});
    expect(corrected).toMatchObject({lengthM:24,netVolumeM3:23.04,quantity:23.04});
    expect(corrected.correctionHistory).toHaveLength(1);
    expect(corrected.correctionHistory[0]).toMatchObject({reason:'Site survey re-measured',correctedBy:'Owner'});
    expect(corrected.correctionHistory[0]!.changes).toEqual(expect.arrayContaining([
      {field:'Base length (m)',originalValue:'22',newValue:'24'},
      {field:'Calculated net volume (m³)',originalValue:'21.12',newValue:'23.04'},
    ]));
    expect(Number((db.raw.prepare('SELECT COUNT(*) count FROM wall_bases').get() as {count:number}).count)).toBe(1);
    await expect(walls.correctBase(wall.id,{...baseDraft(wall.id,{lengthM:24,quantity:23.04}),correctionReason:'again'})).rejects.toThrow('Nothing changed.');
    await expect(walls.correctBase(wall.id,{...baseDraft(wall.id,{lengthM:25}),correctionReason:'   '})).rejects.toThrow('A correction reason is required.');
  });

  // DEC-463. Curing chronology is informational: correcting the cured date never invalidates,
  // blocks, or removes wall work already recorded, however that work is dated relative to it.
  it('preserves existing wall work when a cured-date correction moves the cured date later than it',async()=>{
    const {walls,wall}=await setup();
    await cureBase(walls,wall.id);
    await walls.addConsumption(use(wall.id,{usedOn:'2026-09-09'}));
    const entriesBefore=(await walls.getWall(wall.id)).entries;
    const moved=await walls.correctBaseCuring(wall.id,{curedOn:'2026-09-20',reason:'Wrong cured date'});
    expect(moved).toMatchObject({curedOn:'2026-09-20'});
    expect((await walls.getWall(wall.id)).entries).toEqual(entriesBefore);
    const movedEarlier=await walls.correctBaseCuring(wall.id,{curedOn:'2026-09-05',reason:'Cured earlier than recorded'});
    expect(movedEarlier).toMatchObject({curedOn:'2026-09-05'});
    expect(movedEarlier.correctionHistory.at(-1)).toMatchObject({reason:'Cured earlier than recorded'});
    expect((await walls.getWall(wall.id)).entries).toEqual(entriesBefore);
  });
});

describe('base backup and restore',()=>{
  it('keeps the base, its lifecycle dates, and its corrections through a restored database file',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'dromex-wall-base-')),path=join(directory,'backup.sqlite');
    try{
      const {db,walls,wall}=await setup(path);
      await cureBase(walls,wall.id);
      await walls.correctBase(wall.id,{...baseDraft(wall.id,{lengthM:24,quantity:23.04}),correctionReason:'Re-measured'});
      db.raw.exec('PRAGMA wal_checkpoint(FULL)');
      db.close();databases.length=0;

      const restored=new TestDatabase(path);
      try{
        await migrateDatabase(restored as never);
        const detail=await new SqliteWallRepository(restored as never).getWall(wall.id);
        expect(detail.base).toMatchObject({lengthM:24,status:'cured',constructedOn:'2026-09-01',curingStartedOn:'2026-09-01',curedOn:'2026-09-08'});
        expect(detail.base!.correctionHistory).toHaveLength(1);
        expect(detail.stage).toMatchObject({locked:false});
        expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
      }finally{restored.close();}
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});
