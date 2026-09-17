import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';
import type {WallLayerDraft} from '../src/domain/wallDiagram';

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

async function setup(location?:string){
  const db=new TestDatabase(location);databases.push(db);
  await migrateDatabase(db as never);seed(db);
  const walls=new SqliteWallRepository(db as never);
  const wall=await walls.saveWall({projectId:'road',name:'Retaining wall A',system:'rubble_masonry',purpose:'retaining',lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4,deductionM3:0,allowancePercent:0,notes:''});
  return{db,walls,wall};
}
const layer=(name:string,phaseOrder:number,bottom:number,top:number,note=''):WallLayerDraft=>({name,phaseOrder,bottomThicknessM:bottom,topThicknessM:top,note,materialKey:null});
const core=layer('Structural core',1,.6,.3),facing=layer('Stone facing',2,.2,.1);

describe('migration 39: wall layers and construction phases',()=>{
  it('is the current database version and keeps the earlier steps in the upgrade path',()=>{expect(DATABASE_VERSION).toBe(39);});

  it('emits the version 39 step through execAsync alone and changes no data',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:38})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS wall_layers'))).toBe(true);
    expect(statements.some(sql=>sql.includes('idx_wall_layers_phase'))).toBe(true);
    expect(statements.some(sql=>/^\s*(UPDATE|INSERT|DELETE)\b/im.test(sql))).toBe(false);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 39');
  });

  it('upgrades a version 38 database and leaves existing walls and consumption untouched',async()=>{
    const {db,wall,walls}=await setup();
    await walls.addConsumption({wallId:wall.id,usedOn:'2026-09-10',type:'stone',concretePurpose:null,customPurposeId:null,finishedVolumeM3:null,cementBags:null,cementBagKg:null,sandQuantity:null,sandUnit:null,gravelQuantity:null,gravelUnit:null,waterLitres:null,admixtureQuantity:null,admixtureUnit:null,stoneQuantity:9,stoneUnit:'m3',rebarDiameterMm:null,rebarCount:null,rebarLengthEachM:null,rebarGrade:'',notes:'',volume:null});
    const before=db.raw.prepare('SELECT * FROM wall_consumptions').all();
    db.raw.exec('DROP TABLE wall_layers; PRAGMA user_version = 38;');
    await migrateDatabase(db as never);
    await migrateDatabase(db as never);
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({user_version:39});
    expect(db.raw.prepare('SELECT * FROM wall_consumptions').all()).toEqual(before);
    expect(await walls.listLayers(wall.id)).toEqual([]);
    expect(db.raw.prepare('PRAGMA integrity_check').get()).toMatchObject({integrity_check:'ok'});
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });

  it('refuses duplicate phases and non-positive thicknesses at the database level',async()=>{
    const {db,wall}=await setup();
    const insert=(id:string,phase:number,bottom:number,top:number)=>()=>db.raw.exec(`INSERT INTO wall_layers (id,wall_id,phase_order,name,bottom_thickness_m,top_thickness_m,created_at) VALUES ('${id}','${wall.id}',${phase},'Core',${bottom},${top},'${NOW}')`);
    expect(insert('ok',1,.6,.3)).not.toThrow();
    expect(insert('duplicate',1,.2,.1)).toThrow();
    expect(insert('zero',2,0,.1)).toThrow();
    expect(insert('negative',3,.2,-1)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO wall_layers (id,wall_id,phase_order,name,bottom_thickness_m,top_thickness_m,created_at) VALUES ('blank','${wall.id}',4,'   ',.2,.1,'${NOW}')`)).toThrow();
  });
});

describe('wall layers in the repository',()=>{
  it('saves layers in phase order and reads them back',async()=>{
    const {walls,wall}=await setup();
    await walls.saveLayers(wall.id,[facing,core]);
    expect((await walls.listLayers(wall.id)).map(entry=>[entry.phaseOrder,entry.name])).toEqual([[1,'Structural core'],[2,'Stone facing']]);
    expect((await walls.getWall(wall.id)).layers.map(entry=>entry.name)).toEqual(['Structural core','Stone facing']);
  });

  it('refuses layers whose thicknesses disagree with the wall, without saving anything',async()=>{
    const {db,walls,wall}=await setup();
    await expect(walls.saveLayers(wall.id,[layer('Core',1,.5,.4)])).rejects.toThrow('a difference of 0.3 m');
    expect(Number((db.raw.prepare('SELECT COUNT(*) count FROM wall_layers').get() as {count:number}).count)).toBe(0);
  });

  it('replaces the whole set when layers are reordered or removed, and revalidates against the wall',async()=>{
    const {walls,wall}=await setup();
    await walls.saveLayers(wall.id,[core,facing]);
    await walls.saveLayers(wall.id,[{...facing,phaseOrder:1},{...core,phaseOrder:2}]);
    expect((await walls.listLayers(wall.id)).map(entry=>entry.name)).toEqual(['Stone facing','Structural core']);
    await walls.saveLayers(wall.id,[layer('Single core',1,.8,.4)]);
    expect((await walls.listLayers(wall.id)).map(entry=>entry.name)).toEqual(['Single core']);
    await walls.saveLayers(wall.id,[]);
    expect(await walls.listLayers(wall.id)).toEqual([]);
  });

  it('revalidates existing layers when the wall thickness changes',async()=>{
    const {walls,wall}=await setup();
    await walls.saveLayers(wall.id,[core,facing]);
    const draft={projectId:'road',name:'Retaining wall A',system:'rubble_masonry' as const,purpose:'retaining' as const,lengthM:20,heightM:4,bottomThicknessM:.9,topThicknessM:.4,deductionM3:0,allowancePercent:0,notes:''};
    await expect(walls.saveWall(draft,wall.id)).rejects.toThrow('Layer bottom thicknesses total 0.8 m but the wall bottom thickness is 0.9 m');
    expect((await walls.getWall(wall.id)).wall.bottomThicknessM).toBe(.8);
  });

  it('enqueues a sync entry and keeps layers with their wall in backup and restore',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'dromex-wall-layers-')),path=join(directory,'backup.sqlite');
    try{
      const {db,walls,wall}=await setup(path);
      await walls.saveLayers(wall.id,[core,facing]);
      expect(Number((db.raw.prepare("SELECT COUNT(*) count FROM sync_outbox WHERE entity_type='wallLayers'").get() as {count:number}).count)).toBe(1);
      db.raw.exec('PRAGMA wal_checkpoint(FULL)');
      db.close();databases.length=0;

      const restored=new TestDatabase(path);
      try{
        await migrateDatabase(restored as never);
        const repository=new SqliteWallRepository(restored as never);
        expect((await repository.listLayers(wall.id)).map(entry=>[entry.phaseOrder,entry.name,entry.bottomThicknessM,entry.topThicknessM])).toEqual([[1,'Structural core',.6,.3],[2,'Stone facing',.2,.1]]);
        expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
      }finally{restored.close();}
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});
