import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';

import {SqliteBusinessReportRepository} from '../src/data/repositories/SqliteBusinessReportRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {emptyLoadDraft,type ConfirmedLoad,type LoadCorrectionDraft} from '../src/domain/loads';
import {buildLoadDocumentHtml} from '../src/services/documentTemplates';
import {buildLoadEscPos} from '../src/services/escpos';
import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/** DEC-477. A receipt names a Driver or an Operator and keeps the role that person served in. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=await migratedDatabaseWithProject(databases);
  database.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
    INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,created_at,updated_at) VALUES ('sand','cat','Sand','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const loads=new SqliteLoadRepository(database as never);
  const omar=await loads.createPerson({name:'Omar Haddad',role:'driver'});
  const rami=await loads.createPerson({name:'Rami Saad',role:'operator'});
  const ali=await loads.createPerson({name:'Ali Mansour',role:'worker'});
  const confirm=(driverId:string,driverName:string)=>loads.confirmLoad({...emptyLoadDraft,recordDate:'2026-08-20',customerId:'customer',projectId:'road',itemId:'sand',driverId,driverName,truckId:'truck',truckPlate:'B123',quantityMethod:'direct',directQuantity:'12',directUnitId:'unit_ton'});
  return {database,loads,omar,rami,ali,confirm};
}
const correction=(load:ConfirmedLoad,extra:Partial<LoadCorrectionDraft>):LoadCorrectionDraft=>({requestedQuantityKg:'',emptyWeightKg:'',fullWeightKg:'',directQuantity:String(load.directQuantity),unitPriceUsd:'',destinationAddress:load.destinationAddress??'',notes:load.notes??'',...extra});

describe('selecting the person on a receipt',()=>{
  it('offers active Drivers and Operators with their roles, never Workers or inactive people',async()=>{
    const {loads,omar,rami}=await setup();
    const retired=await loads.createPerson({name:'Retired Operator',role:'operator'});
    await loads.setPersonActive(retired.id,false);
    const options=(await loads.getSetupOptions()).drivers;
    expect(options.map(value=>[value.name,value.role])).toEqual([['Omar Haddad','driver'],['Rami Saad','operator']]);
    expect(options.map(value=>value.id)).toEqual([omar.id,rami.id]);
  });

  it('snapshots name and role: Driver',async()=>{
    const {confirm,omar}=await setup();
    expect(await confirm(omar.id,'Omar Haddad')).toMatchObject({driverName:'Omar Haddad',driverRole:'driver'});
  });

  it('snapshots name and role: Operator, without changing the person\'s directory role',async()=>{
    const {confirm,loads,rami}=await setup();
    expect(await confirm(rami.id,'Rami Saad')).toMatchObject({driverName:'Rami Saad',driverRole:'operator'});
    expect((await loads.listPeople()).find(person=>person.id===rami.id)?.role).toBe('operator');
  });

  it('refuses a Worker until their directory role is changed',async()=>{
    const {confirm,ali}=await setup();
    await expect(confirm(ali.id,'Ali Mansour')).rejects.toThrow('Select a saved driver or operator.');
  });

  it('takes the name and role from the directory at confirmation, not a stale draft',async()=>{
    const {confirm,loads,omar}=await setup();
    await loads.updatePerson(omar.id,{name:'Omar K. Haddad',role:'operator'});
    expect(await confirm(omar.id,'Omar Haddad')).toMatchObject({driverName:'Omar K. Haddad',driverRole:'operator'});
  });
});

describe('historical stability',()=>{
  it('keeps a receipt\'s name and role after the person is renamed, moved to Worker, and deactivated',async()=>{
    const {confirm,loads,rami}=await setup();
    const saved=await confirm(rami.id,'Rami Saad');
    await loads.updatePerson(rami.id,{name:'Rami S.',role:'worker'});
    await loads.setPersonActive(rami.id,false);
    const reread=(await loads.listLoads()).find(load=>load.id===saved.id)!;
    expect(reread).toMatchObject({driverName:'Rami Saad',driverRole:'operator'});
  });

  it('reads a legacy receipt with no role snapshot honestly as not recorded, displayed as Driver',async()=>{
    const {database,confirm,omar,loads}=await setup();
    const saved=await confirm(omar.id,'Omar Haddad');
    database.raw.exec(`UPDATE loads SET driver_role=NULL WHERE id='${saved.id}'`);
    const legacy=(await loads.listLoads()).find(load=>load.id===saved.id)!;
    expect(legacy.driverRole).toBeNull();
    expect(buildLoadDocumentHtml(legacy,'authorization','80',null)).toMatch(/>Driver:<[\s\S]*Omar Haddad/);
  });
});

describe('reasoned correction of the Driver / Operator',()=>{
  it('reassigns the person with the existing correction audit trail',async()=>{
    const {database,confirm,loads,omar,rami}=await setup();
    const saved=await confirm(omar.id,'Omar Haddad');
    const corrected=await loads.correctLoad(saved.id,correction(saved,{driverId:rami.id,correctionReason:'Rami drove this trip'}));
    expect(corrected).toMatchObject({driverName:'Rami Saad',driverRole:'operator',transactionNumber:saved.transactionNumber,billedQuantity:12});
    expect(corrected.correctionHistory.at(-1)).toMatchObject({reason:'Rami drove this trip',changes:[{field:'Driver / Operator',originalValue:'Omar Haddad (Driver)',newValue:'Rami Saad (Operator)'}]});
    expect(database.raw.prepare('SELECT driver_profile_id FROM loads WHERE id=?').get(saved.id)).toEqual({driver_profile_id:rami.id});
    const outbox=database.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='load' AND entity_id=? ORDER BY id DESC LIMIT 1").get(saved.id) as {payload_json:string};
    expect(JSON.parse(outbox.payload_json).changes[0].field).toBe('Driver / Operator');
  });

  it('requires a reason and refuses an ineligible person',async()=>{
    const {confirm,loads,omar,rami,ali}=await setup();
    const saved=await confirm(omar.id,'Omar Haddad');
    await expect(loads.correctLoad(saved.id,correction(saved,{driverId:rami.id}))).rejects.toThrow('Correction reason is required.');
    await expect(loads.correctLoad(saved.id,correction(saved,{driverId:ali.id,correctionReason:'x'}))).rejects.toThrow('Select an active driver or operator.');
    await loads.setPersonActive(rami.id,false);
    await expect(loads.correctLoad(saved.id,correction(saved,{driverId:rami.id,correctionReason:'x'}))).rejects.toThrow('Select an active driver or operator.');
  });

  it('keeps the recorded person when the same one is submitted, so nothing changes',async()=>{
    const {confirm,loads,omar}=await setup();
    const saved=await confirm(omar.id,'Omar Haddad');
    await expect(loads.correctLoad(saved.id,correction(saved,{driverId:omar.id,correctionReason:'x'}))).rejects.toThrow('No information was changed.');
  });

  it('never reassigns a signed load, because the signature belongs to the person who signed',async()=>{
    const {confirm,loads,omar,rami}=await setup();
    const saved=await confirm(omar.id,'Omar Haddad');
    await loads.saveLoadSignature(saved.id,['M 1 1 L 2 2']);
    await expect(loads.correctLoad(saved.id,correction(saved,{driverId:rami.id,correctionReason:'x'}))).rejects.toThrow('signed by Omar Haddad');
  });
});

describe('documents and exports show the role served',()=>{
  // The person has only ever printed on the Delivery Authorization; the financial Receipt carries no driver.
  it('labels the delivery authorization Operator or Driver, including the signature line',async()=>{
    const {confirm,loads,rami}=await setup();
    const saved=await confirm(rami.id,'Rami Saad');
    const signed=await loads.saveLoadSignature(saved.id,['M 1 1 L 2 2']);
    expect(buildLoadDocumentHtml(saved,'authorization','80',null)).toMatch(/>Operator:<[\s\S]*Rami Saad/);
    expect(buildLoadDocumentHtml(signed,'authorization','80',null)).toContain('Operator signature: Rami Saad');
    expect(buildLoadDocumentHtml(signed,'authorization','80',null)).not.toContain('Driver signature');
  });

  it('prints the role on the Bluetooth delivery authorization',async()=>{
    const {confirm,rami}=await setup();
    const saved=await confirm(rami.id,'Rami Saad');
    const text=new TextDecoder().decode(buildLoadEscPos(saved,'authorization','80'));
    expect(text).toContain('Operator');
    expect(text).toContain('Rami Saad');
  });

  it('adds a Driver Role column to the business workbook loads sheet',async()=>{
    const {database,confirm,rami}=await setup();
    await confirm(rami.id,'Rami Saad');
    const row=(await new SqliteBusinessReportRepository(database as never).getReportData()).loads[0];
    expect(row).toMatchObject({Driver:'Rami Saad','Driver Role':'Operator'});
  });

  it('names the field Driver / Operator with role filters in Make Receipt, and shows it in Load History',()=>{
    const screen=readFileSync(join(__dirname,'..','src/ui/screens/MakeReceiptScreen.tsx'),'utf8');
    expect(screen).toContain('label="Driver / Operator *"');
    expect(screen).toMatch(/<SegmentedChoice mode="tabs"/);
    expect(screen).toContain('truckCrewRoleLabel(');
    const history=readFileSync(join(__dirname,'..','src/ui/screens/LoadHistoryScreen.tsx'),'utf8');
    expect(history).toContain('label="Driver / Operator"');
  });

  it('offers the Driver / Operator as a reasoned correction, locked once the load is signed',()=>{
    const screen=readFileSync(join(__dirname,'..','src/ui/screens/LoadCorrectionsScreen.tsx'),'utf8');
    expect(screen).toContain('<SearchableSelect label="Driver / Operator"');
    expect(screen).toContain("selected.signatureStatus==='Signed'");
    expect(screen).toContain('cannot be changed');
    expect(screen).toContain("oldValues['Driver / Operator']");
  });
});
