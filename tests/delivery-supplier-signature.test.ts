import {afterEach,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteDocumentSignerRepository} from '../src/data/repositories/SqliteDocumentSignerRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {emptyLoadDraft} from '../src/domain/loads';
import {cloudSafeRow} from '../src/services/cloud/SyncSchema';
import {buildLoadDocumentHtml} from '../src/services/documentTemplates';
import {buildLoadEscPos} from '../src/services/escpos';
import {SEED_TIME,SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/**
 * DEC-503. The Delivery Authorization carries the supplier's (the Owner's) saved signature under the
 * driver's. Each load keeps its own copy, taken when it is confirmed or set later in Load History, so a
 * later change to the saved signer never alters a printed authorization. The Receipt is unchanged.
 */
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const fixture=await recordsDatabase(databases);
  fixture.db.raw.exec(`INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');`);
  const signers=new SqliteDocumentSignerRepository(fixture.db as never);
  const me=await signers.createSigner({name:'Ahmad Fakih',jobTitle:'Owner',department:'DROMEX'});
  await signers.saveSignature(me.id,[STROKE]);
  const loads=new SqliteLoadRepository(fixture.db as never);
  const confirm=()=>loads.confirmLoad({...emptyLoadDraft,recordDate:'2026-08-10',customerId:'customer',projectId:'road',itemId:'sand',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'direct',directQuantity:'12',directUnitId:'unit_ton'});
  return {...fixture,signers,me,loads,confirm};
}

describe('migration 49',()=>{
  it('adds the per-load supplier signature copy and the default Delivery Authorization signer',async()=>{
    const db=new SqliteTestDatabase();databases.push(db);
    await migrateDatabase(db as never);
    const columns=(table:string)=>db.raw.prepare(`PRAGMA table_info(${table})`).all().map(row=>(row as {name:string}).name);
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(49);
    expect(columns('loads')).toContain('supplier_signature_json');
    expect(columns('business_document_settings')).toEqual(expect.arrayContaining(['delivery_signer_id','delivery_signer_display']));
  });
  it('upgrades a version-48 database with every existing load left without a supplier signature',async()=>{
    const {db,companyLoad}=await recordsDatabase(databases);
    const id=companyLoad('sand');
    db.raw.exec(`ALTER TABLE loads DROP COLUMN supplier_signature_json;ALTER TABLE business_document_settings DROP COLUMN delivery_signer_display;ALTER TABLE business_document_settings DROP COLUMN delivery_signer_id;PRAGMA user_version = 48;`);
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT supplier_signature_json FROM loads WHERE id=?').get(id)).toEqual({supplier_signature_json:null});
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
  });
});

describe('default Delivery Authorization signer',()=>{
  it('is off until chosen, and only an active signer can be chosen',async()=>{
    const {signers,me}=await setup();
    expect(await signers.getDeliverySigner()).toBeNull();
    await signers.setDeliverySigner({signerId:me.id,display:'name_with_signature'});
    expect(await signers.getDeliverySigner()).toEqual({signerId:me.id,display:'name_with_signature'});
    const other=await signers.createSigner({name:'No Signature',jobTitle:'',department:''});
    await expect(signers.setDeliverySigner({signerId:other.id,display:'name_with_signature'})).rejects.toThrow('No Signature has no saved signature. Choose Name only or draw the signature first.');
    await signers.setSignerActive(other.id,false);
    await expect(signers.setDeliverySigner({signerId:other.id,display:'name_only'})).rejects.toThrow('The selected signer is disabled. Choose another signer.');
    await signers.setDeliverySigner(null);
    expect(await signers.getDeliverySigner()).toBeNull();
  });
});

describe('the copy each load keeps',()=>{
  it('copies the default signer into a new load when it is confirmed, and records the use',async()=>{
    const {signers,me,confirm}=await setup();
    await signers.setDeliverySigner({signerId:me.id,display:'name_with_signature'});
    const load=await confirm();
    expect(load.supplierSignature).toEqual({signerId:me.id,name:'Ahmad Fakih',jobTitle:'Owner',department:'DROMEX',display:'name_with_signature',signature:[STROKE]});
    expect((await signers.listEvents(me.id)).map(value=>value.event)).toContain('used');
  });
  it('confirms without a supplier signature when none is chosen, or when the default signer was disabled',async()=>{
    const {signers,me,confirm}=await setup();
    expect((await confirm()).supplierSignature).toBeNull();
    await signers.setDeliverySigner({signerId:me.id,display:'name_only'});
    await signers.setSignerActive(me.id,false);
    expect((await confirm()).supplierSignature).toBeNull();
  });
  it('never changes after the saved signer is edited, re-signed or disabled',async()=>{
    const {signers,me,confirm,loads}=await setup();
    await signers.setDeliverySigner({signerId:me.id,display:'name_with_signature'});
    const load=await confirm();
    await signers.updateSigner(me.id,{name:'A. Fakih',jobTitle:'Manager',department:''});
    await signers.saveSignature(me.id,['M 1 1 L 2 2']);
    await signers.setSignerActive(me.id,false);
    expect((await loads.listLoads()).find(value=>value.id===load.id)!.supplierSignature).toMatchObject({name:'Ahmad Fakih',jobTitle:'Owner',signature:[STROKE]});
  });
  it('can be added, replaced or removed on an existing load, but not on a cancelled one',async()=>{
    const {me,confirm,loads,signers}=await setup();
    const load=await confirm();
    expect((await loads.saveLoadSupplierSignature(load.id,{signerId:me.id,display:'name_only'})).supplierSignature).toMatchObject({name:'Ahmad Fakih',display:'name_only',signature:[]});
    expect((await loads.saveLoadSupplierSignature(load.id,null)).supplierSignature).toBeNull();
    await loads.cancelLoad(load.id,'Duplicate');
    await expect(loads.saveLoadSupplierSignature(load.id,{signerId:me.id,display:'name_only'})).rejects.toThrow('A cancelled load cannot be signed.');
    void signers;
  });
  it('keeps the strokes out of the sync queue and out of the cloud',async()=>{
    const {db,me,confirm,loads}=await setup();
    const load=await confirm();
    await loads.saveLoadSupplierSignature(load.id,{signerId:me.id,display:'name_with_signature'});
    const payloads=(db.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_id=?").all(load.id) as {payload_json:string}[]).map(row=>row.payload_json).join('');
    expect(payloads).not.toContain('80.5');
    const row=db.raw.prepare('SELECT * FROM loads WHERE id=?').get(load.id) as Record<string,unknown>;
    expect(row.supplier_signature_json).toBeTruthy();
    expect(cloudSafeRow('loads',row)).not.toHaveProperty('supplier_signature_json');
  });
  it('previews the default signer on a new load before confirmation',async()=>{
    const {signers,me,loads}=await setup();
    await signers.setDeliverySigner({signerId:me.id,display:'name_with_signature'});
    expect((await loads.getSetupOptions()).deliverySignature).toMatchObject({name:'Ahmad Fakih',display:'name_with_signature'});
  });
});

describe('printed Delivery Authorization',()=>{
  it('prints the supplier signature under the driver’s, unstretched, and leaves the Receipt alone',async()=>{
    const {signers,me,confirm}=await setup();
    await signers.setDeliverySigner({signerId:me.id,display:'name_with_signature'});
    const load={...await confirm(),signaturePaths:['M 5 5 L 9 9']};
    const html=buildLoadDocumentHtml(load,'authorization','80');
    expect(html).toContain('Supplier signature');
    expect(html).toContain('Ahmad Fakih');
    expect(html).toContain('Owner');
    expect(html.indexOf('Supplier signature')).toBeGreaterThan(html.indexOf('signature: Omar'));
    expect(html).toMatch(/class="supplier-signature"[\s\S]*preserveAspectRatio="xMidYMid meet"/);
    expect(buildLoadDocumentHtml(load,'receipt','80')).not.toContain('Supplier signature');
  });
  it('prints a name-only supplier signature as the name, without a drawing',async()=>{
    const {signers,me,confirm}=await setup();
    await signers.setDeliverySigner({signerId:me.id,display:'name_only'});
    const html=buildLoadDocumentHtml(await confirm(),'authorization','58');
    expect(html).toContain('Supplier signature');
    expect(html).toContain('Signed by name');
    expect(html.slice(html.indexOf('Supplier signature')-200)).not.toContain('<path');
  });
  it('prints the supplier signature on the Bluetooth slip of the authorization only',async()=>{
    const {signers,me,confirm}=await setup();
    await signers.setDeliverySigner({signerId:me.id,display:'name_with_signature'});
    const load=await confirm();
    expect(buildLoadEscPos(load,'authorization','58').toString('latin1')).toContain('Supplier signature: Ahmad Fakih');
    expect(buildLoadEscPos(load,'receipt','58').toString('latin1')).not.toContain('Supplier signature');
  });
});

describe('screens',()=>{
  const read=(file:string)=>readFileSync(file,'utf8');
  it('lets the Owner choose the default Delivery Authorization signer on the Signers screen',()=>{
    const chooser=read('src/ui/components/SupplierSignatureChooser.tsx');
    expect(chooser).toContain('Name and signature');
    expect(chooser).toContain('Name only');
    expect(chooser).toContain('signer.isActive');
    const screen=read('src/ui/screens/documents/SignersScreen.tsx');
    expect(screen).toContain('<SupplierSignatureChooser');
    expect(screen).toContain('repository.setDeliverySigner(');
    expect(screen).toContain('Delivery Authorization signature');
  });
  it('adds, replaces or removes the supplier signature from Load History, except on a cancelled load',()=>{
    const screen=read('src/ui/screens/LoadHistoryScreen.tsx');
    expect(screen).toContain('repository.saveLoadSupplierSignature(record.id,');
    expect(screen).toMatch(/record\.status!=='Cancelled'&&signers\?<SupplierSignatureChooser/);
    expect(read('src/ui/DromexApp.tsx')).toMatch(/<LoadHistoryScreen [^\n]*signers=\{signerRepository\}/);
  });
  it('previews the supplier signature under the driver’s on the in-app Delivery Authorization',()=>{
    const preview=read('src/ui/components/LoadDocuments.tsx');
    expect(preview.indexOf('Supplier signature:')).toBeGreaterThan(preview.indexOf('signature: {data.driverName}'));
    const receipt=read('src/ui/screens/MakeReceiptScreen.tsx');
    expect(receipt).toContain('supplierSignature: options.deliverySignature ?? null');
    expect(receipt).toContain('supplierSignature: record.supplierSignature ?? null');
  });
});
