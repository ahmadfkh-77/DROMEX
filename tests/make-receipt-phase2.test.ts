import {readFileSync} from 'node:fs';
import {afterEach,describe,expect,it} from 'vitest';

import {SqliteCompanyHeaderRepository} from '../src/data/repositories/SqliteCompanyHeaderRepository';
import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import {SqliteDocumentSignerRepository} from '../src/data/repositories/SqliteDocumentSignerRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {emptyCompanyTotalsFilters} from '../src/domain/companyTotals';
import {calculateLoad,directConversionLines,emptyLoadDraft,validateLoadDraft,type ConfirmedLoad,type ConversionOption,type LoadCorrectionDraft,type LoadDraft} from '../src/domain/loads';
import {buildLoadDocumentHtml} from '../src/services/documentTemplates';
import {buildLoadEscPos} from '../src/services/escpos';
import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * Phase 2 (Make Receipt). A direct quantity can use a conversion; a driver name and truck plate can be typed
 * for one load without being saved; the driver's signature is captured with the receipt and the supplier
 * signature is copied from the Plant Company signer. Weighbridge loads and numbering are untouched.
 */
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';
const DRIVER_STROKE='M 10.0 60.0 L 50.0 20.0 L 90.0 70.0';
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const count=(db:SqliteTestDatabase,table:string)=>(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;

async function setup(){
  const database=await migratedDatabaseWithProject(databases);
  database.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
    INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,created_at,updated_at) VALUES ('asphalt','cat','Asphalt','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${SEED_TIME}','${SEED_TIME}','driver');
  `);
  const loads=new SqliteLoadRepository(database as never);
  const headers=new SqliteCompanyHeaderRepository(database as never);
  const signers=new SqliteDocumentSignerRepository(database as never);
  const tonToM3=await loads.createConversion({name:'Ton to cubic metre',inputUnitId:'unit_ton',outputUnitId:'unit_m3',inputQuantity:1,outputQuantity:0.4167,decimalPlaces:3});
  const base:LoadDraft={...emptyLoadDraft,recordDate:'2026-08-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'direct',directQuantity:'10',directUnitId:'unit_ton'};
  return {database,loads,headers,signers,tonToM3,base};
}
const correction=(load:ConfirmedLoad,extra:Partial<LoadCorrectionDraft>):LoadCorrectionDraft=>({requestedQuantityKg:'',emptyWeightKg:'',fullWeightKg:'',directQuantity:String(load.directQuantity),unitPriceUsd:load.unitPriceUsd==null?'':String(load.unitPriceUsd),destinationAddress:load.destinationAddress??'',notes:load.notes??'',...extra});

describe('direct quantity with a conversion',()=>{
  const tonToM3:ConversionOption={id:'c',name:'Ton to cubic metre',inputUnitId:'unit_ton',inputUnitName:'Metric ton',inputUnitSymbol:'t',outputUnitId:'unit_m3',outputUnitName:'Cubic metre',outputUnitSymbol:'m³',inputQuantity:1,outputQuantity:0.4167,decimalPlaces:3,isActive:true};
  const direct:LoadDraft={...emptyLoadDraft,quantityMethod:'direct',directQuantity:'10',directUnitId:'unit_ton',unitPriceUsd:'180'};

  it('converts the entered quantity and prices the converted quantity',()=>{
    expect(calculateLoad(direct,tonToM3,0)).toMatchObject({netWeightKg:null,billedQuantity:4.167,subtotalUsd:750.06,finalTotalUsd:750.06});
    expect(calculateLoad({...direct,directQuantity:'10,5'},tonToM3,10)).toMatchObject({billedQuantity:4.375,vatAmountUsd:78.75});
  });
  it('is unchanged without a conversion, or when the conversion starts from another unit',()=>{
    expect(calculateLoad(direct,undefined,0)).toMatchObject({billedQuantity:10,subtotalUsd:1800});
    expect(calculateLoad({...direct,directUnitId:'unit_m3'},tonToM3,0)).toMatchObject({billedQuantity:10});
  });
  it('requires the conversion to start from the entered unit',()=>{
    const options={customers:[{id:'customer',name:'C',isOwnCompany:false,isActive:true}] as never,items:[{id:'asphalt',name:'A',internalCode:null,categoryName:'x',defaultPriceUsd:null,defaultUnitId:null}],projects:[],units:[{id:'unit_ton',name:'Metric ton',symbol:'t',isActive:true}],conversions:[tonToM3],drivers:[],trucks:[],machines:[],companySettings:{companyName:'DROMEX'} as never};
    const draft:LoadDraft={...direct,customerId:'customer',itemId:'asphalt',destinationAddress:'Site',driverName:'Typed',truckPlate:'X1',recordDate:'2026-01-01'};
    expect(validateLoadDraft({...draft,conversionId:'c'},options)).toEqual([]);
    expect(validateLoadDraft({...draft,conversionId:'c',directUnitId:'unit_m3'},{...options,units:[...options.units,{id:'unit_m3',name:'Cubic metre',symbol:'m³',isActive:true}]})).toContain('The conversion must start from the unit entered.');
    expect(validateLoadDraft({...draft,conversionId:'missing'},options)).toContain('Select a conversion or choose No conversion.');
  });

  it('confirms with the entered quantity, the rule and the converted quantity, and counts it in the converted unit',async()=>{
    const {loads,base,tonToM3:conversion,database}=await setup();
    const load=await loads.confirmLoad({...base,conversionId:conversion.id,unitPriceUsd:'180'});
    expect(load).toMatchObject({quantityMethod:'direct',directQuantity:10,directUnitSymbol:'t',conversionName:'Ton to cubic metre',conversionRule:'1 t = 0.4167 m³',outputUnitSymbol:'m³',billedQuantity:4.167,convertedQuantity:expect.closeTo(4.167,6),unitPriceUsd:180,subtotalUsd:750.06});
    expect(directConversionLines(load)).toEqual({entered:'10 t',rule:'1 t = 0.4167 m³'});
    const records=await new SqliteCompanyTotalsRepository(database as never).listRecords(emptyCompanyTotalsFilters(),10);
    expect(records.map(value=>[value.snapshot.quantity,value.snapshot.unitSymbol])).toEqual([[4.167,'m³']]);
  });
  it('keeps a plain direct load exactly as before',async()=>{
    const {loads,base,database}=await setup();
    const load=await loads.confirmLoad(base);
    expect(load).toMatchObject({directQuantity:10,directUnitSymbol:'t',conversionName:null,conversionRule:null,outputUnitSymbol:'t',billedQuantity:10});
    expect(database.raw.prepare('SELECT conversion_name,conversion_rule FROM loads WHERE id=?').get(load.id)).toEqual({conversion_name:'Direct quantity',conversion_rule:'Entered directly'});
    expect(directConversionLines(load)).toBeNull();
    const records=await new SqliteCompanyTotalsRepository(database as never).listRecords(emptyCompanyTotalsFilters(),10);
    expect(records.map(value=>[value.snapshot.quantity,value.snapshot.unitSymbol])).toEqual([[10,'t']]);
  });
  it('keeps the conversion when the quantity of a converted load is corrected',async()=>{
    const {loads,base,tonToM3:conversion}=await setup();
    const load=await loads.confirmLoad({...base,conversionId:conversion.id});
    const corrected=await loads.correctLoad(load.id,correction(load,{directQuantity:'20',correctionReason:'Scale re-check'}));
    expect(corrected).toMatchObject({directQuantity:20,billedQuantity:8.334,conversionRule:'1 t = 0.4167 m³',outputUnitSymbol:'m³'});
  });
  it('shows the entered quantity and the rule on the receipt, the authorization and the printed slip, and nothing extra on a plain load',async()=>{
    const {loads,base,tonToM3:conversion}=await setup();
    const converted=await loads.confirmLoad({...base,conversionId:conversion.id});
    const receipt=buildLoadDocumentHtml(converted,'receipt','58'),authorization=buildLoadDocumentHtml(converted,'authorization','58');
    expect(receipt).toContain('Entered');expect(receipt).toContain('1 t = 0.4167 m³');expect(receipt).toContain('4.167 m³');expect(authorization).toContain('Entered');
    const slip=buildLoadEscPos(converted,'receipt','58').toString('latin1');
    expect(slip).toContain('Entered');expect(slip).toContain('Conversion');
    const plain=await loads.confirmLoad({...base,itemId:'asphalt'});
    expect(buildLoadDocumentHtml(plain,'receipt','58')).not.toContain('Entered');
    expect(buildLoadEscPos(plain,'receipt','58').toString('latin1')).not.toContain('Entered');
  });
});

describe('a typed driver and truck plate',()=>{
  it('confirms with the typed values and creates or links no saved person or truck',async()=>{
    const {loads,base,database}=await setup();
    const peopleBefore=count(database,'driver_profiles'),trucksBefore=count(database,'truck_profiles');
    const load=await loads.confirmLoad({...base,driverId:'',driverName:'  Walid   Khoury ',truckId:'',truckPlate:' b 884211 '});
    expect(load).toMatchObject({driverName:'Walid Khoury',truckPlate:'B 884211',driverId:null,driverRole:null});
    expect(database.raw.prepare('SELECT driver_profile_id,truck_profile_id FROM loads WHERE id=?').get(load.id)).toEqual({driver_profile_id:null,truck_profile_id:null});
    expect(count(database,'driver_profiles')).toBe(peopleBefore);expect(count(database,'truck_profiles')).toBe(trucksBefore);
    expect(buildLoadDocumentHtml(load,'authorization','58')).toContain('Walid Khoury');
  });
  it('refuses an empty typed name or plate, and an unknown saved id',async()=>{
    const {loads,base}=await setup();
    await expect(loads.confirmLoad({...base,driverId:'',driverName:' '})).rejects.toThrow('Driver or operator name is required.');
    await expect(loads.confirmLoad({...base,truckId:'',truckPlate:''})).rejects.toThrow('Truck plate is required.');
    await expect(loads.confirmLoad({...base,driverId:'ghost'})).rejects.toThrow('Select a saved driver or operator.');
  });
  it('still links a saved driver and truck exactly as before, and can mix saved and typed',async()=>{
    const {loads,base,database}=await setup();
    const saved=await loads.confirmLoad(base);
    expect(database.raw.prepare('SELECT driver_profile_id,truck_profile_id FROM loads WHERE id=?').get(saved.id)).toEqual({driver_profile_id:'driver',truck_profile_id:'truck'});
    const mixed=await loads.confirmLoad({...base,truckId:'',truckPlate:'Z 1'});
    expect(database.raw.prepare('SELECT driver_profile_id,truck_profile_id,truck_plate FROM loads WHERE id=?').get(mixed.id)).toEqual({driver_profile_id:'driver',truck_profile_id:null,truck_plate:'Z 1'});
  });
  it('keeps a numbered, unchanged load number for typed loads',async()=>{
    const {loads,base}=await setup();
    const first=await loads.confirmLoad({...base,driverId:'',driverName:'Typed One'});
    const second=await loads.confirmLoad(base);
    expect(first.loadNumber).toMatch(/^[A-Z]+-\d{5}$/);
    expect(second.loadNumber).not.toBe(first.loadNumber);
  });
});

describe('signatures made with the receipt',()=>{
  it('saves the drawn driver signature with the load and marks it Signed',async()=>{
    const {loads,base}=await setup();
    const load=await loads.confirmLoad({...base,driverSignaturePaths:[DRIVER_STROKE]});
    expect(load).toMatchObject({signatureStatus:'Signed',signaturePaths:[DRIVER_STROKE]});
    expect(buildLoadDocumentHtml(load,'authorization','58')).toContain('signature');
  });
  it('leaves the load Unsigned for name only, as today',async()=>{
    const {loads,base}=await setup();
    expect(await loads.confirmLoad(base)).toMatchObject({signatureStatus:'Unsigned',signaturePaths:[]});
  });
  it('copies the Plant Company signer onto a new load, and falls back to the Delivery Authorization signer',async()=>{
    const {loads,headers,signers,base,database}=await setup();
    const owner=await signers.createSigner({name:'Ahmad Fakih',jobTitle:'Owner',department:'DROMEX'});await signers.saveSignature(owner.id,[STROKE]);
    const manager=await signers.createSigner({name:'Site Manager',jobTitle:'Manager',department:''});
    await signers.setDeliverySigner({signerId:manager.id,display:'name_only'});
    expect((await loads.getSetupOptions()).deliverySignature).toMatchObject({name:'Site Manager',display:'name_only'});
    await headers.savePlantExtras({registrationNumber:'',signerId:owner.id,signerDisplay:'name_with_signature'});
    const options=await loads.getSetupOptions();
    expect(options.deliverySignature).toMatchObject({name:'Ahmad Fakih',display:'name_with_signature',signature:[STROKE]});expect(options.supplierSignatureNote).toBeNull();
    expect((await loads.confirmLoad(base)).supplierSignature).toMatchObject({name:'Ahmad Fakih',signature:[STROKE]});
    await signers.setSignerActive(owner.id,false);
    const fallback=await loads.getSetupOptions();
    expect(fallback.deliverySignature).toMatchObject({name:'Site Manager'});expect(fallback.supplierSignatureNote).toContain('disabled');
    database.raw.exec('DELETE FROM business_document_settings');
    const none=await loads.getSetupOptions();
    expect(none.deliverySignature).toBeNull();expect(none.supplierSignatureNote).toContain('disabled');
  });
  it('keeps the drawn signature in the saved draft, and old drafts without it still load',async()=>{
    const {loads,base,database}=await setup();
    await loads.saveDraft({...base,driverSignaturePaths:[DRIVER_STROKE]});
    expect((await loads.getDraft())?.driverSignaturePaths).toEqual([DRIVER_STROKE]);
    const legacy:Record<string,unknown>={...base};delete legacy.driverSignaturePaths;
    database.raw.prepare("UPDATE load_drafts SET payload_json=? WHERE id='current'").run(JSON.stringify(legacy));
    expect((await loads.getDraft())?.driverSignaturePaths).toEqual([]);
  });
});

describe('weighbridge loads and the Make Receipt screen',()=>{
  it('still requires a conversion for a weighbridge load, and is otherwise unchanged',async()=>{
    const {loads,base}=await setup();
    const weighed={...base,quantityMethod:'weighbridge' as const,directQuantity:'',directUnitId:'',emptyWeightKg:'10000',fullWeightKg:'30000',conversionId:''};
    await expect(loads.confirmLoad(weighed)).rejects.toThrow('Select a conversion.');
    expect(await loads.confirmLoad({...weighed,conversionId:'conversion_kg_ton'})).toMatchObject({quantityMethod:'weighbridge',netWeightKg:20000,billedQuantity:20,outputUnitSymbol:'t'});
  });
  it('offers the typed fields, the conversion and section 04 with the approved wording',()=>{
    const screen=readFileSync('src/ui/screens/MakeReceiptScreen.tsx','utf8');
    for(const text of ['Saved person','Type a name','Saved truck','Type a plate','NOT SAVED','Used on this load only. It is not added to People.','Used on this load only. It is not added to Trucks.','Conversion (optional)','No conversion (use the quantity as entered)','number="04" title="Signatures"','AUTO-SIGNED','Draw signature','Name only','Open Company setups','Leaving the pad empty is allowed.'])expect(screen).toContain(text);
    expect(screen).toContain("scrollEnabled={!signing}");
    expect(readFileSync('src/ui/DromexApp.tsx','utf8')).toContain("onOpenCompanySetups={()=>navigate('companySetups')}/></ReceiptEntrance>");
  });
});
