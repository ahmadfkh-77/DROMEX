import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {groupFuelUsageByDestination,localDateKey,type FuelFillDraft} from '../src/domain/fuel';

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
const DATE='2026-09-10';
const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=new TestDatabase();databases.push(database);
  await migrateDatabase(database as never);
  database.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('road','customer','Road Project','Aley','active','2026-01-01','${NOW}','${NOW}',0);
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('finished','customer','Finished Project','Tyre','completed','2026-01-01','${NOW}','${NOW}',0);
    INSERT INTO machine_profiles (id,name,is_active,created_at,updated_at) VALUES ('machine','Excavator',1,'${NOW}','${NOW}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('supplier','Fuel Co',1,'${NOW}','${NOW}');
  `);
  return {database,repository:new SqliteFuelRepository(database as never)};
}

const draft=(over:Partial<FuelFillDraft>={}):FuelFillDraft=>({fuelType:'diesel',recordDate:DATE,equipmentType:'machine',equipmentId:'machine',litres:'40',odometerReading:'',pricePerLitreUsd:'',priceOverrideReason:'',notes:'',destinationType:'unassigned',projectId:'',companySiteId:'',...over});
const columns=(database:TestDatabase,table:string)=>(database.raw.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(column=>column.name);
const rawFill=(database:TestDatabase,id:string)=>database.raw.prepare('SELECT * FROM fuel_movements WHERE id=?').get(id) as Record<string,unknown>;

describe('migration 36: company sites and fuel destinations',()=>{
  it('creates saved company sites and the destination columns',async()=>{
    const {database}=await setup();
    // Version 36 is no longer the latest (migration 37, DEC-450); a migrated database reaches the current version.
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(36);
    expect(database.raw.prepare('PRAGMA user_version').get()).toMatchObject({user_version:DATABASE_VERSION});
    expect(columns(database,'company_sites')).toEqual(expect.arrayContaining(['id','name','name_key','is_active','created_at','updated_at']));
    expect(columns(database,'fuel_movements')).toEqual(expect.arrayContaining(['destination_type','company_site_id']));
  });

  it('emits the version 36 step through execAsync alone, as older installations migrate',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:35})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS company_sites'))).toBe(true);
    expect(statements.some(sql=>sql.includes('ADD COLUMN destination_type'))).toBe(true);
    expect(statements.at(-1)).toBe(`PRAGMA user_version = ${DATABASE_VERSION}`);
  });

  it('backfills existing fills deterministically and never invents a company site',async()=>{
    const {database}=await setup();
    database.raw.exec(`
      INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,project_id,project_name,equipment_name,consumption_cost_usd_cents,price_per_litre_usd_cents,notes,correction_history_json,created_at)
        VALUES ('old_project','fill','2026-08-01T08:00:00.000Z',80,'road','Road Project','Excavator',7200,90,'Paving','[{"reason":"typo","changes":[]}]','${NOW}');
      INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,equipment_name,fuel_type,created_at) VALUES ('old_none','fill','2026-08-02T08:00:00.000Z',25,'Generator','gasoline','${NOW}');
      INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,equipment_name,status,cancellation_reason,cancelled_at,created_at) VALUES ('old_cancelled','fill','2026-08-03T08:00:00.000Z',10,'Roller','Cancelled','Duplicate','${NOW}','${NOW}');
      INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,supplier_id,supplier_name,final_total_usd_cents,payment_status,created_at) VALUES ('old_delivery','delivery','2026-08-01T06:00:00.000Z',1000,'supplier','Fuel Co',95000,'Unpaid','${NOW}');
      INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,reason,created_at) VALUES ('old_gauge','gauge','2026-08-01T05:00:00.000Z',500,'Opening','${NOW}');
      UPDATE fuel_movements SET destination_type=NULL;
      PRAGMA user_version = 35;
    `);
    const ids=['old_project','old_none','old_cancelled','old_delivery','old_gauge'];
    const withoutDestination=(row:Record<string,unknown>)=>{const {destination_type:_destination,...rest}=row;return rest;};
    const before=ids.map(id=>withoutDestination(rawFill(database,id)));

    await migrateDatabase(database as never);

    expect(ids.map(id=>rawFill(database,id).destination_type)).toEqual(['project','unassigned','unassigned',null,null]);
    expect(ids.map(id=>withoutDestination(rawFill(database,id)))).toEqual(before);
    expect(database.raw.prepare("SELECT COUNT(*) total FROM fuel_movements WHERE destination_type='company_site' OR company_site_id IS NOT NULL").get()).toMatchObject({total:0});
    expect(database.raw.prepare('SELECT COUNT(*) total FROM company_sites').get()).toMatchObject({total:0});
  });

  it('is idempotent: re-entering the step keeps every destination already chosen',async()=>{
    const {database,repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const siteFill=await repository.recordFill(draft({destinationType:'company_site',companySiteId:plant.id}));
    const projectFill=await repository.recordFill(draft({destinationType:'project',projectId:'road'}));
    const beforeColumns=columns(database,'fuel_movements');
    database.raw.exec('PRAGMA user_version = 35;');

    await migrateDatabase(database as never);
    await migrateDatabase(database as never);

    expect(columns(database,'fuel_movements')).toEqual(beforeColumns);
    expect(rawFill(database,siteFill.id)).toMatchObject({destination_type:'company_site',company_site_id:plant.id,project_id:null});
    expect(rawFill(database,projectFill.id)).toMatchObject({destination_type:'project',project_id:'road',company_site_id:null});
    expect(database.raw.prepare('SELECT COUNT(*) total FROM company_sites').get()).toMatchObject({total:1});
  });

  it('refuses a stored fill whose destination disagrees with its links',async()=>{
    const {database,repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const insert=(destination:string,projectId:string|null,siteId:string|null)=>()=>database.raw.prepare(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,destination_type,project_id,company_site_id,created_at) VALUES (?,'fill','${NOW}',10,?,?,?,'${NOW}')`).run(`bad_${destination}_${projectId}_${siteId}`,destination,projectId,siteId);
    expect(insert('project',null,null)).toThrow(/CHECK/i);
    expect(insert('project','road',plant.id)).toThrow(/CHECK/i);
    expect(insert('company_site',null,null)).toThrow(/CHECK/i);
    expect(insert('company_site','road',plant.id)).toThrow(/CHECK/i);
    expect(insert('unassigned','road',null)).toThrow(/CHECK/i);
    expect(insert('unassigned',null,plant.id)).toThrow(/CHECK/i);
    expect(insert('elsewhere',null,null)).toThrow(/CHECK/i);
  });
});

describe('saved company sites',()=>{
  it('adds a site with a normalized required name',async()=>{
    const {repository}=await setup();
    const created=await repository.createCompanySite('  Asphalt   Plant ');
    expect(created).toMatchObject({name:'Asphalt Plant',isActive:true});
    expect((await repository.getSetup()).companySites.map(value=>[value.name,value.isActive])).toEqual([['Asphalt Plant',true]]);
    await expect(repository.createCompanySite('   ')).rejects.toThrow(/name is required/i);
  });

  it('supports several distinct saved sites',async()=>{
    const {repository}=await setup();
    for(const name of ['Main Yard','Asphalt Plant','Workshop','Company Warehouse'])await repository.createCompanySite(name);
    expect((await repository.getSetup()).companySites.map(value=>value.name)).toEqual(['Asphalt Plant','Company Warehouse','Main Yard','Workshop']);
  });

  it('refuses a case-insensitive duplicate of an active site',async()=>{
    const {repository}=await setup();
    await repository.createCompanySite('Asphalt Plant');
    await expect(repository.createCompanySite(' asphalt   PLANT ')).rejects.toThrow(/already exists/i);
  });

  it('renames a site and linked fills show the new name without the fill rows being rewritten',async()=>{
    const {database,repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const created=await repository.recordFill(draft({destinationType:'company_site',companySiteId:plant.id}));
    const rowBefore=rawFill(database,created.id);
    await repository.renameCompanySite(plant.id,'Asphalt Plant North');
    expect(rawFill(database,created.id)).toEqual(rowBefore);
    expect((await repository.getOverview()).movements.find(value=>value.id===created.id)).toMatchObject({companySiteId:plant.id,companySiteName:'Asphalt Plant North'});
  });

  it('refuses renaming a site to the name of another active site',async()=>{
    const {repository}=await setup();
    await repository.createCompanySite('Main Yard');
    const workshop=await repository.createCompanySite('Workshop');
    await expect(repository.renameCompanySite(workshop.id,'MAIN yard')).rejects.toThrow(/already exists/i);
    await expect(repository.renameCompanySite(workshop.id,' ')).rejects.toThrow(/name is required/i);
  });

  it('deactivates a site: excluded from new fills, still shown on its historical fills',async()=>{
    const {repository}=await setup();
    const yard=await repository.createCompanySite('Main Yard');
    const historical=await repository.recordFill(draft({destinationType:'company_site',companySiteId:yard.id,litres:'55'}));
    await repository.setCompanySiteActive(yard.id,false);
    expect((await repository.getSetup()).companySites.find(value=>value.id===yard.id)?.isActive).toBe(false);
    await expect(repository.recordFill(draft({destinationType:'company_site',companySiteId:yard.id}))).rejects.toThrow(/active company site/i);
    const overview=await repository.getOverview();
    expect(overview.movements.find(value=>value.id===historical.id)).toMatchObject({companySiteName:'Main Yard',companySiteIsActive:false});
    expect(groupFuelUsageByDestination(overview.movements).groups).toEqual([expect.objectContaining({destinationId:yard.id,isActive:false,totalLitres:55})]);
  });

  it('reactivates a site unless another active site already uses its name',async()=>{
    const {repository}=await setup();
    const first=await repository.createCompanySite('Workshop');
    await repository.setCompanySiteActive(first.id,false);
    const replacement=await repository.createCompanySite('workshop');
    await expect(repository.setCompanySiteActive(first.id,true)).rejects.toThrow(/already exists/i);
    await repository.setCompanySiteActive(replacement.id,false);
    expect(await repository.setCompanySiteActive(first.id,true)).toMatchObject({id:first.id,isActive:true});
  });

  it('offers no way to permanently delete a site',async()=>{
    const {repository}=await setup();
    expect('deleteCompanySite' in repository).toBe(false);
  });
});

describe('recording fills with a fuel destination',()=>{
  it('records a Project fill linked only to the project',async()=>{
    const {database,repository}=await setup();
    const created=await repository.recordFill(draft({destinationType:'project',projectId:'road',companySiteId:'stale'}));
    expect(created).toMatchObject({destinationType:'project',projectId:'road',projectName:'Road Project',companySiteId:null});
    expect(rawFill(database,created.id)).toMatchObject({destination_type:'project',project_id:'road',company_site_id:null});
  });

  it('records a Company Site fill linked only to the site, clearing a hidden project id',async()=>{
    const {database,repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const created=await repository.recordFill(draft({destinationType:'company_site',companySiteId:plant.id,projectId:'road'}));
    expect(created).toMatchObject({destinationType:'company_site',companySiteId:plant.id,companySiteName:'Asphalt Plant',projectId:null,projectName:null});
    expect(rawFill(database,created.id)).toMatchObject({destination_type:'company_site',company_site_id:plant.id,project_id:null,project_name:null});
  });

  it('records an Unassigned fill with neither link, clearing both hidden ids',async()=>{
    const {database,repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const created=await repository.recordFill(draft({destinationType:'unassigned',projectId:'road',companySiteId:plant.id}));
    expect(created).toMatchObject({destinationType:'unassigned',projectId:null,companySiteId:null});
    expect(rawFill(database,created.id)).toMatchObject({destination_type:'unassigned',project_id:null,company_site_id:null});
  });

  it('requires an active project for the Project destination',async()=>{
    const {repository}=await setup();
    await expect(repository.recordFill(draft({destinationType:'project',projectId:''}))).rejects.toThrow(/select a project/i);
    await expect(repository.recordFill(draft({destinationType:'project',projectId:'finished'}))).rejects.toThrow(/valid project/i);
  });

  it('requires an active saved site for the Company Site destination',async()=>{
    const {repository}=await setup();
    await expect(repository.recordFill(draft({destinationType:'company_site',companySiteId:''}))).rejects.toThrow(/select a company site/i);
    await expect(repository.recordFill(draft({destinationType:'company_site',companySiteId:'missing'}))).rejects.toThrow(/active company site/i);
  });

  it('still accepts a draft saved before destinations existed',async()=>{
    const {repository}=await setup();
    const {destinationType:_destination,companySiteId:_site,...legacy}=draft({projectId:'road'});
    expect(await repository.recordFill(legacy)).toMatchObject({destinationType:'project',projectId:'road'});
  });

  it('leaves the diesel tank ledger and purchases unchanged for every destination',async()=>{
    const {repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    await repository.recordGauge({recordDate:'2026-09-09',actualLitres:'500',reason:'Opening',notes:''});
    const purchase=await repository.recordDelivery({recordDate:'2026-09-09',litres:'100',supplierId:'supplier',ticketNumber:'T-1',pricePerLitreUsd:'',updateCurrentPrice:false,notes:''});
    await repository.recordFill(draft({destinationType:'company_site',companySiteId:plant.id,litres:'100'}));
    await repository.recordFill(draft({destinationType:'unassigned',litres:'50'}));
    await repository.recordFill(draft({destinationType:'project',projectId:'road',litres:'25'}));
    const overview=await repository.getOverview();
    expect(overview.currentBalanceLitres).toBe(425);
    expect(overview.movements.find(value=>value.id===purchase.id)).toMatchObject({litres:100,destinationType:null,companySiteId:null});
  });
});

describe('correcting a fill destination',()=>{
  it('moves a fill from a project to a company site with a reason and records both destinations',async()=>{
    const {database,repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const created=await repository.recordFill(draft({destinationType:'project',projectId:'road'}));
    const corrected=await repository.correctFill(created.id,{...draft({destinationType:'company_site',companySiteId:plant.id,projectId:'road'}),correctionReason:'Fuel went to the plant'});
    expect(corrected).toMatchObject({destinationType:'company_site',companySiteId:plant.id,projectId:null,projectName:null});
    expect(rawFill(database,created.id)).toMatchObject({destination_type:'company_site',project_id:null,project_name:null,company_site_id:plant.id});
    const entry=corrected.correctionHistory.at(-1);
    expect(entry?.reason).toBe('Fuel went to the plant');
    expect(entry?.changes).toEqual([{field:'Fuel destination',originalValue:'Project: Road Project',newValue:'Company Site: Asphalt Plant'}]);
  });

  it('moves a fill from a company site to Unassigned, clearing the site link',async()=>{
    const {database,repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const created=await repository.recordFill(draft({destinationType:'company_site',companySiteId:plant.id}));
    const corrected=await repository.correctFill(created.id,{...draft({destinationType:'unassigned',companySiteId:plant.id}),correctionReason:'Destination not known'});
    expect(rawFill(database,created.id)).toMatchObject({destination_type:'unassigned',company_site_id:null,project_id:null});
    expect(corrected.correctionHistory.at(-1)?.changes).toEqual([{field:'Fuel destination',originalValue:'Company Site: Asphalt Plant',newValue:'Unassigned'}]);
  });

  it('moves an Unassigned fill to a project',async()=>{
    const {repository}=await setup();
    const created=await repository.recordFill(draft());
    const corrected=await repository.correctFill(created.id,{...draft({destinationType:'project',projectId:'road'}),correctionReason:'Found the site sheet'});
    expect(corrected).toMatchObject({destinationType:'project',projectId:'road',companySiteId:null});
    expect(corrected.correctionHistory.at(-1)?.changes).toEqual([{field:'Fuel destination',originalValue:'Unassigned',newValue:'Project: Road Project'}]);
  });

  it('requires the correction reason and changes nothing without it',async()=>{
    const {database,repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const created=await repository.recordFill(draft({destinationType:'project',projectId:'road'}));
    const before=rawFill(database,created.id);
    await expect(repository.correctFill(created.id,{...draft({destinationType:'company_site',companySiteId:plant.id}),correctionReason:'  '})).rejects.toThrow(/reason is required/i);
    expect(rawFill(database,created.id)).toEqual(before);
  });

  it('keeps a fill on its now-inactive site when correcting something else, but refuses moving to an inactive site',async()=>{
    const {repository}=await setup();
    const yard=await repository.createCompanySite('Main Yard');
    const plant=await repository.createCompanySite('Asphalt Plant');
    const onYard=await repository.recordFill(draft({destinationType:'company_site',companySiteId:yard.id,litres:'40'}));
    const onPlant=await repository.recordFill(draft({destinationType:'company_site',companySiteId:plant.id}));
    await repository.setCompanySiteActive(yard.id,false);
    const corrected=await repository.correctFill(onYard.id,{...draft({destinationType:'company_site',companySiteId:yard.id,litres:'45'}),correctionReason:'Litres misread'});
    expect(corrected).toMatchObject({companySiteId:yard.id,litres:45});
    expect(corrected.correctionHistory.at(-1)?.changes.map(change=>change.field)).toEqual(['Litres']);
    await expect(repository.correctFill(onPlant.id,{...draft({destinationType:'company_site',companySiteId:yard.id}),correctionReason:'Wrong site'})).rejects.toThrow(/active company site/i);
  });

  it('keeps cancelled fills out of destination usage and uncorrectable',async()=>{
    const {repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const kept=await repository.recordFill(draft({destinationType:'company_site',companySiteId:plant.id,litres:'30'}));
    const cancelled=await repository.recordFill(draft({destinationType:'company_site',companySiteId:plant.id,litres:'70'}));
    await repository.cancelMovement(cancelled.id,'Duplicate entry');
    const review=groupFuelUsageByDestination((await repository.getOverview()).movements);
    expect(review.totals.totalLitres).toBe(30);
    expect(review.groups[0]?.fills.map(value=>value.id)).toEqual([kept.id]);
    await expect(repository.correctFill(cancelled.id,{...draft({destinationType:'unassigned'}),correctionReason:'x'})).rejects.toThrow(/cancelled fuel movement cannot be corrected/i);
  });
});

describe('project reports keep only project fills',()=>{
  it('does not place Company Site or Unassigned fills in a project Daily Report',async()=>{
    const {database,repository}=await setup();
    const plant=await repository.createCompanySite('Asphalt Plant');
    const projectFill=await repository.recordFill(draft({destinationType:'project',projectId:'road',litres:'12'}));
    await repository.recordFill(draft({destinationType:'company_site',companySiteId:plant.id,litres:'34'}));
    await repository.recordFill(draft({destinationType:'unassigned',litres:'56'}));
    const linked=await new SqliteProjectReportRepository(database as never).listLinkedFuelFills('road',localDateKey(projectFill.confirmedAt));
    expect(linked.map(value=>[value.id,value.litres])).toEqual([[projectFill.id,12]]);
  });
});

describe('backup and restore compatibility',()=>{
  // SqliteBackupRepository restores the backup's database file and runs migrateDatabase when its
  // version is older than DATABASE_VERSION. This reproduces that on a real file: build the older
  // state, close it, reopen the file as the restored copy, and migrate it.
  it('upgrades a version 35 database file restored from an older backup without losing a fill',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'dromex-fuel-destination-')),path=join(directory,'restored.sqlite');
    try{
      const original=new TestDatabase(path);
      await migrateDatabase(original as never);
      original.raw.exec(`
        INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
        INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('road','customer','Road Project','Aley','active','2026-01-01','${NOW}','${NOW}',0);
        INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,project_id,project_name,equipment_name,created_at) VALUES ('restored_project','fill','2026-08-01T08:00:00.000Z',80,'road','Road Project','Excavator','${NOW}');
        INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,equipment_name,created_at) VALUES ('restored_none','fill','2026-08-02T08:00:00.000Z',20,'Excavator','${NOW}');
        UPDATE fuel_movements SET destination_type=NULL;
        PRAGMA user_version = 35;
      `);
      original.close();

      const restored=new TestDatabase(path);
      try{
        await migrateDatabase(restored as never);
        const movements=(await new SqliteFuelRepository(restored as never).getOverview()).movements;
        expect(restored.raw.prepare('PRAGMA user_version').get()).toMatchObject({user_version:DATABASE_VERSION});
        expect(movements.find(value=>value.id==='restored_project')).toMatchObject({destinationType:'project',projectName:'Road Project',litres:80});
        expect(movements.find(value=>value.id==='restored_none')).toMatchObject({destinationType:'unassigned',litres:20});
        expect(restored.raw.prepare('PRAGMA integrity_check').get()).toMatchObject({integrity_check:'ok'});
        expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
      }finally{restored.close();}
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});
