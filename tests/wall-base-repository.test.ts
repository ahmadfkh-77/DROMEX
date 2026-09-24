import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';
import type {FoundationDraft} from '../src/domain/foundations';
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
  INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('harbour','customer','Harbour Works','Beirut','active','${NOW}','${NOW}',0);
`);
const wallDraft={projectId:'road',name:'Retaining wall A',system:'rubble_masonry' as const,purpose:'retaining' as const,lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4,deductionM3:0,allowancePercent:0,notes:''};
const foundationDraft=(constructionSectionId:string,overrides:Partial<FoundationDraft>={}):FoundationDraft=>({projectId:'road',constructionSectionId,reference:'Foundation A',location:'Km 2+150',lengthM:22,heightM:.8,bottomThicknessM:1.2,topThicknessM:1.2,deductionM3:0,materialType:'ready_mix',concretePurpose:'footing',customPurposeId:null,quantity:21.12,quantityUnit:'m3',manualOverride:false,consumptionDate:'2026-09-01',notes:'',...overrides});
const use=(wallId:string,overrides:Partial<WallConsumptionDraft>={}):WallConsumptionDraft=>({wallId,usedOn:'2026-09-10',type:'stone',concretePurpose:null,customPurposeId:null,finishedVolumeM3:null,cementBags:null,cementBagKg:null,sandQuantity:null,sandUnit:null,gravelQuantity:null,gravelUnit:null,waterLitres:null,admixtureQuantity:null,admixtureUnit:null,stoneQuantity:9,stoneUnit:'m3',rebarDiameterMm:null,rebarCount:null,rebarLengthEachM:null,rebarGrade:'',notes:'',volume:null,...overrides});

async function setup(location?:string){
  const db=new TestDatabase(location);databases.push(db);
  await migrateDatabase(db as never);seed(db);
  const walls=new SqliteWallRepository(db as never);
  const section=await walls.createConstructionSection({projectId:'road',name:'Section A',location:'',description:''});
  return{db,walls,section};
}
async function cureFoundation(walls:SqliteWallRepository,foundationId:string){
  await walls.changeFoundationStatus(foundationId,{status:'constructed',constructedOn:'2026-09-01'});
  await walls.changeFoundationStatus(foundationId,{status:'curing',curingStartedOn:'2026-09-01'});
  return walls.changeFoundationStatus(foundationId,{status:'cured',curedOn:'2026-09-08',inspected:true});
}

describe('DEC-464: Construction Sections',()=>{
  it('creates and renames a section, normalizing whitespace and case for uniqueness',async()=>{
    const {walls}=await setup();
    const section=await walls.createConstructionSection({projectId:'road',name:'  North   Retaining  Wall  ',location:'',description:''});
    expect(section.name).toBe('North Retaining Wall');
    await expect(walls.createConstructionSection({projectId:'road',name:'north retaining wall',location:'',description:''})).rejects.toThrow(/already exists/);
    const renamed=await walls.renameConstructionSection(section.id,{name:'North Wall (renamed)',location:'Km 5',description:''});
    expect(renamed.name).toBe('North Wall (renamed)');
  });

  it('allows the same section name in a different project',async()=>{
    const {walls}=await setup();
    await walls.createConstructionSection({projectId:'road','name':'Section A',location:'',description:''}).catch(()=>{});
    await expect(walls.createConstructionSection({projectId:'harbour',name:'Section A',location:'',description:''})).resolves.toMatchObject({name:'Section A'});
  });

  it('rejects an empty section name',async()=>{
    const {walls}=await setup();
    await expect(walls.createConstructionSection({projectId:'road',name:'   ',location:'',description:''})).rejects.toThrow('Enter a Construction Section name.');
  });
});

describe('DEC-464: Foundations created independently, before any wall',()=>{
  it('creates a foundation with no wall, then selects it for a wall created afterward',async()=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    expect(foundation.legacyWallId).toBeNull();
    const wall=await walls.saveWall({...wallDraft,foundationId:foundation.id});
    expect(wall.foundationId).toBe(foundation.id);
  });

  it.each(['planned','constructed','curing','cured'] as const)('a foundation in %s status can be selected and linked to a wall',async status=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    if(status!=='planned')await walls.changeFoundationStatus(foundation.id,{status:'constructed',constructedOn:'2026-09-01'});
    if(status==='curing'||status==='cured')await walls.changeFoundationStatus(foundation.id,{status:'curing',curingStartedOn:'2026-09-01'});
    if(status==='cured')await walls.changeFoundationStatus(foundation.id,{status:'cured',curedOn:'2026-09-08',inspected:true});
    const wall=await walls.saveWall({...wallDraft,name:`Wall for ${status}`,foundationId:foundation.id});
    expect(wall.foundationId).toBe(foundation.id);
  });

  it('refuses linking a wall to a foundation from a different project',async()=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    await expect(walls.saveWall({...wallDraft,projectId:'harbour',foundationId:foundation.id})).rejects.toThrow('different project');
  });

  it('enforces one active wall per foundation, at save time and via linkWallToFoundation',async()=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    await walls.saveWall({...wallDraft,foundationId:foundation.id});
    await expect(walls.saveWall({...wallDraft,name:'Second wall',foundationId:foundation.id})).rejects.toThrow('already has a wall linked to it');
    const unlinkedWall=await walls.saveWall({...wallDraft,name:'Third wall'});
    const otherFoundation=await walls.createFoundation(foundationDraft(section.id,{reference:'Foundation B'}));
    await expect(walls.linkWallToFoundation(unlinkedWall.id,foundation.id)).rejects.toThrow('already has a wall linked to it');
    await expect(walls.linkWallToFoundation(unlinkedWall.id,otherFoundation.id)).resolves.toMatchObject({foundationId:otherFoundation.id});
  });

  it('refuses linkWallToFoundation across projects, and once the wall is already linked',async()=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    const wall=await walls.saveWall({...wallDraft,projectId:'harbour'});
    await expect(walls.linkWallToFoundation(wall.id,foundation.id)).rejects.toThrow('different project');
    const linked=await walls.saveWall({...wallDraft,foundationId:foundation.id});
    const otherFoundation=await walls.createFoundation(foundationDraft(section.id,{reference:'Foundation B'}));
    await expect(walls.linkWallToFoundation(linked.id,otherFoundation.id)).rejects.toThrow('already linked');
  });
});

describe('DEC-463/464: curing is informational, never a lock, for a linked wall',()=>{
  it('allows wall work as soon as the wall is linked to a foundation, in every foundation status',async()=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    const wall=await walls.saveWall({...wallDraft,foundationId:foundation.id});
    await expect(walls.addConsumption(use(wall.id))).resolves.toBeTruthy();
    expect((await walls.getWall(wall.id)).stage).toMatchObject({locked:false,curingConfirmed:false});
    await walls.changeFoundationStatus(foundation.id,{status:'constructed',constructedOn:'2026-09-01'});
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-11'}))).resolves.toBeTruthy();
    await walls.changeFoundationStatus(foundation.id,{status:'curing',curingStartedOn:'2026-09-01'});
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-12'}))).resolves.toBeTruthy();
    await expect(walls.changeFoundationStatus(foundation.id,{status:'cured',curedOn:'2026-09-08'})).rejects.toThrow('Confirm that the base was inspected');
    const cured=await walls.changeFoundationStatus(foundation.id,{status:'cured',curedOn:'2026-09-08',inspected:true,curingNote:'Seven days'});
    expect(cured).toMatchObject({status:'cured',curedOn:'2026-09-08',curingNote:'Seven days'});
    expect((await walls.getWall(wall.id)).stage).toMatchObject({locked:false,curingConfirmed:true});
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-13'}))).resolves.toBeTruthy();
  });

  it('accepts wall work dated before, during, and after the cured date, never refusing it for chronology',async()=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    const wall=await walls.saveWall({...wallDraft,foundationId:foundation.id});
    await cureFoundation(walls,foundation.id);
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-07'}))).resolves.toBeTruthy();
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-08'}))).resolves.toBeTruthy();
    await expect(walls.addConsumption(use(wall.id,{usedOn:'2026-09-30'}))).resolves.toBeTruthy();
  });

  it('accepts wall geometry (layers) before curing is confirmed',async()=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    const wall=await walls.saveWall({...wallDraft,foundationId:foundation.id});
    await expect(walls.saveLayers(wall.id,[{name:'Core',phaseOrder:1,bottomThicknessM:.8,topThicknessM:.4,note:'',materialKey:null}])).resolves.toBeTruthy();
  });

  it('requires a linked foundation before wall work, for a wall created without one',async()=>{
    const {walls}=await setup();
    const wall=await walls.saveWall(wallDraft);
    const detail=await walls.getWall(wall.id);
    expect(detail.foundation).toBeNull();
    expect(detail.stage).toMatchObject({locked:true,legacy:false});
    await expect(walls.addConsumption(use(wall.id))).rejects.toThrow('Record the base for this wall before recording wall construction.');
  });

  it('refuses a skipped status transition, but allows reverting a cured foundation to curing even once wall work exists',async()=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    const wall=await walls.saveWall({...wallDraft,foundationId:foundation.id});
    await expect(walls.changeFoundationStatus(foundation.id,{status:'cured',curedOn:'2026-09-08',inspected:true})).rejects.toThrow('A base moves from planned to constructed');
    await cureFoundation(walls,foundation.id);
    await walls.addConsumption(use(wall.id));
    const entriesBefore=(await walls.getWall(wall.id)).entries;
    const reverted=await walls.changeFoundationStatus(foundation.id,{status:'curing',curingStartedOn:'2026-09-01'});
    expect(reverted).toMatchObject({status:'curing'});
    expect((await walls.getWall(wall.id)).entries).toEqual(entriesBefore);
  });
});

describe('DEC-464: foundation corrections preserve wall records',()=>{
  it('corrects a foundation with a reason and a before/after audit, without duplicating it',async()=>{
    const {db,walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    await cureFoundation(walls,foundation.id);
    const corrected=await walls.correctFoundation(foundation.id,{...foundationDraft(section.id,{lengthM:24,quantity:23.04}),correctionReason:'Site survey re-measured'});
    expect(corrected).toMatchObject({lengthM:24,netVolumeM3:23.04,quantity:23.04});
    expect(corrected.correctionHistory).toHaveLength(1);
    expect(corrected.correctionHistory[0]).toMatchObject({reason:'Site survey re-measured',correctedBy:'Owner'});
    expect(Number((db.raw.prepare('SELECT COUNT(*) count FROM foundations').get() as {count:number}).count)).toBe(1);
    await expect(walls.correctFoundation(foundation.id,{...foundationDraft(section.id,{lengthM:24,quantity:23.04}),correctionReason:'again'})).rejects.toThrow('Nothing changed.');
    await expect(walls.correctFoundation(foundation.id,{...foundationDraft(section.id,{lengthM:25}),correctionReason:'   '})).rejects.toThrow('A correction reason is required.');
  });

  it('preserves existing wall work when a cured-date correction moves the cured date later than it',async()=>{
    const {walls,section}=await setup();
    const foundation=await walls.createFoundation(foundationDraft(section.id));
    const wall=await walls.saveWall({...wallDraft,foundationId:foundation.id});
    await cureFoundation(walls,foundation.id);
    await walls.addConsumption(use(wall.id,{usedOn:'2026-09-09'}));
    const entriesBefore=(await walls.getWall(wall.id)).entries;
    const moved=await walls.correctFoundationCuring(foundation.id,{curedOn:'2026-09-20',reason:'Wrong cured date'});
    expect(moved).toMatchObject({curedOn:'2026-09-20'});
    expect((await walls.getWall(wall.id)).entries).toEqual(entriesBefore);
  });
});

describe('DEC-464: legacy walls (no foundation) remain unaffected',()=>{
  it('a legacy wall works exactly as before, with no foundation invented for it',async()=>{
    const {db,walls,wall}=await(async()=>{const {db,walls}=await setup();const wall=await walls.saveWall(wallDraft);db.raw.exec(`UPDATE walls SET base_required=0 WHERE id='${wall.id}'`);return{db,walls,wall};})();
    void db;
    const detail=await walls.getWall(wall.id);
    expect(detail.foundation).toBeNull();
    expect(detail.stage).toMatchObject({locked:false,legacy:true,reason:'Base not recorded — legacy wall'});
    await expect(walls.addConsumption(use(wall.id))).resolves.toBeTruthy();
  });
});

describe('foundation backup and restore',()=>{
  it('keeps the foundation, its section, its lifecycle dates, and its corrections through a restored database file',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'dromex-foundation-')),path=join(directory,'backup.sqlite');
    try{
      const {db,walls,section}=await setup(path);
      const foundation=await walls.createFoundation(foundationDraft(section.id));
      const wall=await walls.saveWall({...wallDraft,foundationId:foundation.id});
      await cureFoundation(walls,foundation.id);
      await walls.correctFoundation(foundation.id,{...foundationDraft(section.id,{lengthM:24,quantity:23.04}),correctionReason:'Re-measured'});
      db.raw.exec('PRAGMA wal_checkpoint(FULL)');
      db.close();databases.length=0;

      const restored=new TestDatabase(path);
      try{
        await migrateDatabase(restored as never);
        const detail=await new SqliteWallRepository(restored as never).getWall(wall.id);
        expect(detail.foundation).toMatchObject({lengthM:24,status:'cured',constructedOn:'2026-09-01',curingStartedOn:'2026-09-01',curedOn:'2026-09-08',constructionSectionId:section.id});
        expect(detail.foundation!.correctionHistory).toHaveLength(1);
        expect(detail.stage).toMatchObject({locked:false});
        expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
      }finally{restored.close();}
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});

describe('current database version',()=>{
  it('is at least version 42 (Checkpoint 2/3 -- Construction Sections and independent Foundations)',()=>{expect(DATABASE_VERSION).toBeGreaterThanOrEqual(42);});
});
