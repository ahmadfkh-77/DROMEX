import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';
import type {FoundationDraft} from '../src/domain/foundations';

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
const seed=(db:TestDatabase)=>db.raw.exec(`
  INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
  INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
`);
const foundationDraft=(overrides:Partial<FoundationDraft>={}):FoundationDraft=>({projectId:'road',constructionSectionId:'section',reference:'Foundation A',location:'Km 2+150',lengthM:20,heightM:1,bottomThicknessM:1.5,topThicknessM:1.5,deductionM3:0,materialType:'ready_mix',concretePurpose:'footing',customPurposeId:null,quantity:30,quantityUnit:'m3',manualOverride:true,consumptionDate:'2026-09-01',notes:'',...overrides});

async function setup(){
  const db=new TestDatabase();databases.push(db);
  await migrateDatabase(db as never);seed(db);
  const walls=new SqliteWallRepository(db as never);
  const section=await walls.createConstructionSection({projectId:'road',name:'Section A',location:'',description:''});
  const foundation=await walls.createFoundation(foundationDraft({constructionSectionId:section.id}));
  return{db,walls,section,foundation};
}

describe('migration 42: independent foundations',()=>{
  it('is the current database version',()=>{expect(DATABASE_VERSION).toBe(42);});

  it('creates a foundation independently of any wall',async()=>{
    const {foundation}=await setup();
    expect(foundation).toMatchObject({reference:'Foundation A',netVolumeM3:30,status:'planned',legacyWallId:null});
  });
});

describe('composite foundation mode',()=>{
  it('defaults every foundation to single mode with no composition recorded',async()=>{
    const {walls,foundation}=await setup();
    const composition=(await walls.getFoundationComposition(foundation.id))!;
    expect(composition).toMatchObject({mode:'single',stoneCoreMode:null,activeStoneM3:0,estimatedConcreteM3:30,variance:null});
  });

  it('switches to composite / simple mode and places the Stone core at the centre by default',async()=>{
    const {walls,foundation}=await setup();
    const composition=await walls.setFoundationMode(foundation.id,'composite','simple');
    expect(composition).toMatchObject({mode:'composite',stoneCoreMode:'simple',position:{xNorm:.5,yNorm:.5}});
  });

  it('refuses to position the Stone core before composite / simple mode is chosen',async()=>{
    const {walls,foundation}=await setup();
    await expect(walls.saveStoneCorePosition(foundation.id,{xNorm:.3,yNorm:.6})).rejects.toThrow('Switch this foundation to composite / simple');
  });

  it('moves the Stone core without changing any recorded Stone volume',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:10,recordedOn:'2026-09-02',notes:''});
    const moved=await walls.saveStoneCorePosition(foundation.id,{xNorm:.2,yNorm:.8});
    expect(moved.position).toEqual({xNorm:.2,yNorm:.8});
    expect(moved.activeStoneM3).toBe(10);
  });

  it('records Stone, estimates the remaining concrete, and has no variance until Ready Mix is recorded',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    const record=await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:12,recordedOn:'2026-09-02',notes:'First Stone delivery'});
    expect(record).toMatchObject({materialType:'stone',quantityM3:12});
    const composition=(await walls.getFoundationComposition(foundation.id))!;
    expect(composition).toMatchObject({activeStoneM3:12,estimatedConcreteM3:18,variance:null});
  });

  it('compares actual Ready Mix against the estimate once it is recorded',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:10,recordedOn:'2026-09-02',notes:''});
    await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'ready_mix',quantityM3:22,recordedOn:'2026-09-05',notes:''});
    const composition=(await walls.getFoundationComposition(foundation.id))!;
    expect(composition.estimatedConcreteM3).toBe(20);
    expect(composition.variance).toEqual({varianceM3:2,direction:'over'});
  });

  it('refuses Stone that would exceed the foundation net volume',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:20,recordedOn:'2026-09-02',notes:''});
    await expect(walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:15,recordedOn:'2026-09-03',notes:''}))
      .rejects.toThrow(/more than the foundation's net volume/);
  });

  it('excludes a cancelled Stone record from the aggregate and re-estimates concrete',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    const record=await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:10,recordedOn:'2026-09-02',notes:''});
    await walls.cancelFoundationCompositionRecord(record.id,'Measured wrong');
    const composition=(await walls.getFoundationComposition(foundation.id))!;
    expect(composition.activeStoneM3).toBe(0);
    expect(composition.estimatedConcreteM3).toBe(30);
  });

  it('requires a reason to cancel a record and refuses cancelling twice',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    const record=await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:5,recordedOn:'2026-09-02',notes:''});
    await expect(walls.cancelFoundationCompositionRecord(record.id,'')).rejects.toThrow('A cancellation reason is required.');
    await walls.cancelFoundationCompositionRecord(record.id,'Duplicate entry');
    await expect(walls.cancelFoundationCompositionRecord(record.id,'Again')).rejects.toThrow('already cancelled');
  });

  it('corrects a Stone quantity in place, keeping its identity and updating the estimate',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    const record=await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:10,recordedOn:'2026-09-02',notes:''});
    const corrected=await walls.correctFoundationCompositionRecord(record.id,{foundationId:foundation.id,materialType:'stone',quantityM3:14,recordedOn:'2026-09-02',notes:'Re-measured',correctionReason:'Re-measured on site'});
    expect(corrected.id).toBe(record.id);
    expect(corrected.quantityM3).toBe(14);
    expect(corrected.correctionHistory).toHaveLength(1);
    const composition=(await walls.getFoundationComposition(foundation.id))!;
    expect(composition.estimatedConcreteM3).toBe(16);
  });

  it('refuses a correction with no reason and one that changes nothing',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    const record=await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:10,recordedOn:'2026-09-02',notes:''});
    await expect(walls.correctFoundationCompositionRecord(record.id,{foundationId:foundation.id,materialType:'stone',quantityM3:12,recordedOn:'2026-09-02',notes:'',correctionReason:''})).rejects.toThrow('A correction reason is required.');
    await expect(walls.correctFoundationCompositionRecord(record.id,{foundationId:foundation.id,materialType:'stone',quantityM3:10,recordedOn:'2026-09-02',notes:'',correctionReason:'no real change'})).rejects.toThrow('Nothing changed');
  });

  it('refuses a corrected Stone quantity that would exceed capacity against the other active records',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    const first=await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:10,recordedOn:'2026-09-02',notes:''});
    await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:15,recordedOn:'2026-09-03',notes:''});
    await expect(walls.correctFoundationCompositionRecord(first.id,{foundationId:foundation.id,materialType:'stone',quantityM3:20,recordedOn:'2026-09-02',notes:'',correctionReason:'grew'}))
      .rejects.toThrow(/more than the foundation's net volume/);
  });

  it('refuses reducing the foundation geometry below already-recorded Stone, and does not touch the record',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:25,recordedOn:'2026-09-02',notes:''});
    await expect(walls.correctFoundation(foundation.id,{...foundationDraft({constructionSectionId:foundation.constructionSectionId,lengthM:5}),correctionReason:'survey error'}))
      .rejects.toThrow(/more than the proposed net volume/);
    const composition=(await walls.getFoundationComposition(foundation.id))!;
    expect(composition.netFoundationVolumeM3).toBe(30);
    expect(composition.activeStoneM3).toBe(25);
  });

  it('allows a geometry correction that still comfortably fits the recorded Stone',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    await walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:5,recordedOn:'2026-09-02',notes:''});
    await expect(walls.correctFoundation(foundation.id,{...foundationDraft({constructionSectionId:foundation.constructionSectionId,location:'Km 2+200'}),correctionReason:'kept the same geometry'})).resolves.toBeTruthy();
  });

  it('refuses recording a separate composition entry before composite mode is chosen',async()=>{
    const {walls,foundation}=await setup();
    await expect(walls.addFoundationCompositionRecord({foundationId:foundation.id,materialType:'stone',quantityM3:5,recordedOn:'2026-09-02',notes:''}))
      .rejects.toThrow('Switch this foundation to composite mode');
  });

  it('detailed mode: refuses saving Stone-core offsets before detailed mode is chosen, then persists valid offsets',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','simple');
    await expect(walls.saveStoneCoreOffsets(foundation.id,{lengthM:10,depthM:.5,bottomThicknessM:.8,topThicknessM:.8,longitudinalOffsetM:5,verticalOffsetM:.25,transverseOffsetM:0}))
      .rejects.toThrow('Switch this foundation to composite / detailed');
    await walls.setFoundationMode(foundation.id,'composite','detailed');
    const composition=await walls.saveStoneCoreOffsets(foundation.id,{lengthM:10,depthM:.5,bottomThicknessM:.8,topThicknessM:.8,longitudinalOffsetM:5,verticalOffsetM:.25,transverseOffsetM:0});
    expect(composition.offsets).toMatchObject({lengthM:10,depthM:.5});
  });

  it('refuses Stone-core offsets that extend outside the foundation',async()=>{
    const {walls,foundation}=await setup();
    await walls.setFoundationMode(foundation.id,'composite','detailed');
    await expect(walls.saveStoneCoreOffsets(foundation.id,{lengthM:18,depthM:.5,bottomThicknessM:.8,topThicknessM:.8,longitudinalOffsetM:5,verticalOffsetM:.25,transverseOffsetM:0}))
      .rejects.toThrow(/extends beyond the foundation length/);
  });
});
