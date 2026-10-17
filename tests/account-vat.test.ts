import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteProfileRepository} from '../src/data/repositories/SqliteProfileRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {
  accountVatBasisPoints,accountVatDraft,accountVatFromRow,accountVatLabel,choiceForRate,noAccountVat,noVatChoice,resolveVatRate,startingVatChoice,startingVatRate,validateAccountVat,
} from '../src/domain/accountVat';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * VAT choice. Anything new starts with No VAT. A customer or supplier account holds No VAT, Universal (the Company Settings rate) or Own %,
 * and a new record starts from it. Existing accounts start as No VAT, and nothing already saved is changed.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-16T09:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const read=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;

describe('the VAT choice rules (pure)',()=>{
  it('is No VAT unless a choice says otherwise, and Own % needs a rate from 0 to 100',()=>{
    expect(validateAccountVat(undefined)).toEqual(noAccountVat);
    expect(validateAccountVat({mode:'none',ratePercent:'junk'})).toEqual(noAccountVat);
    expect(validateAccountVat({mode:'universal',ratePercent:'junk'})).toEqual({mode:'universal',ratePercent:null});
    expect(validateAccountVat({mode:'custom',ratePercent:'5'})).toEqual({mode:'custom',ratePercent:5});
    expect(validateAccountVat({mode:'custom',ratePercent:'8,5'})).toEqual({mode:'custom',ratePercent:8.5});
    expect(validateAccountVat({mode:'custom',ratePercent:'0'})).toEqual({mode:'custom',ratePercent:0});
    for(const bad of ['','abc','101','-1','1.234','1e1'])expect(()=>validateAccountVat({mode:'custom',ratePercent:bad}),bad).toThrow('0 to 100');
  });
  it('stores only an Own % rate, in basis points, and reads it back',()=>{
    expect(accountVatBasisPoints({mode:'custom',ratePercent:5})).toBe(500);expect(accountVatBasisPoints({mode:'custom',ratePercent:8.5})).toBe(850);
    expect(accountVatBasisPoints({mode:'universal',ratePercent:null})).toBeNull();expect(accountVatBasisPoints(noAccountVat)).toBeNull();
    expect(accountVatFromRow('universal',1100)).toEqual({mode:'universal',ratePercent:null});expect(accountVatFromRow('custom',500)).toEqual({mode:'custom',ratePercent:5});
    for(const row of [['none',500],[null,null],['custom',null],['junk',1]] as const)expect(accountVatFromRow(row[0],row[1])).toEqual(noAccountVat);
  });
  it('turns a choice into the VAT percentage: 0 for No VAT, the Company rate for Universal, the typed rate for Own %',()=>{
    expect(resolveVatRate(noAccountVat,11)).toBe(0);expect(resolveVatRate(null,11)).toBe(0);
    expect(resolveVatRate({mode:'universal',ratePercent:null},11)).toBe(11);expect(resolveVatRate({mode:'universal',ratePercent:''},0)).toBe(0);
    expect(resolveVatRate({mode:'custom',ratePercent:5},11)).toBe(5);expect(resolveVatRate({mode:'custom',ratePercent:'5,5'},11)).toBe(5.5);
    expect(resolveVatRate({mode:'custom',ratePercent:'abc'},11)).toBe(0);expect(resolveVatRate({mode:'custom',ratePercent:'150'},11)).toBe(0);
    expect(startingVatRate({mode:'universal',ratePercent:null},11)).toBe(11);expect(startingVatRate(undefined,11)).toBe(0);
  });
  it('labels the setting',()=>{
    expect(accountVatLabel(noAccountVat)).toBe('No VAT');expect(accountVatLabel({mode:'universal',ratePercent:null},11)).toBe('Universal 11%');
    expect(accountVatLabel({mode:'universal',ratePercent:null})).toBe('Universal VAT');expect(accountVatLabel({mode:'custom',ratePercent:5})).toBe('VAT 5%');
  });
  it('starts a new record from the account, and describes a saved rate for a form',()=>{
    expect(startingVatChoice(undefined)).toEqual(noVatChoice);expect(startingVatChoice({mode:'custom',ratePercent:5})).toEqual({mode:'custom',ratePercent:'5'});
    expect(accountVatDraft({mode:'universal',ratePercent:null})).toEqual({mode:'universal',ratePercent:''});
    expect(choiceForRate(0,11)).toEqual(noVatChoice);expect(choiceForRate(null,11)).toEqual(noVatChoice);
    expect(choiceForRate(11,11)).toEqual({mode:'universal',ratePercent:''});expect(choiceForRate(5,11)).toEqual({mode:'custom',ratePercent:'5'});expect(choiceForRate(11,0)).toEqual({mode:'custom',ratePercent:'11'});
  });
});

describe('existing accounts and the migration',()=>{
  it('upgrades a version 60 database: every existing customer and supplier is No VAT and nothing else changes',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    db.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('c1','company','Old Customer',0,1,'${SEED_TIME}','${SEED_TIME}');
      INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('s1','Old Supplier',1,'${SEED_TIME}','${SEED_TIME}');
      ALTER TABLE customers DROP COLUMN vat_mode;ALTER TABLE customers DROP COLUMN vat_rate_basis_points;
      ALTER TABLE suppliers DROP COLUMN vat_mode;ALTER TABLE suppliers DROP COLUMN vat_rate_basis_points;
      PRAGMA user_version = 60;
    `);
    const before=(db.raw.prepare('SELECT COUNT(*) c FROM projects').get() as {c:number}).c;
    await migrateDatabase(db as never);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect(db.raw.prepare("SELECT vat_mode,vat_rate_basis_points FROM customers WHERE id='c1'").get()).toMatchObject({vat_mode:'none',vat_rate_basis_points:null});
    expect(db.raw.prepare("SELECT vat_mode,vat_rate_basis_points FROM suppliers WHERE id='s1'").get()).toMatchObject({vat_mode:'none',vat_rate_basis_points:null});
    expect((db.raw.prepare('SELECT COUNT(*) c FROM projects').get() as {c:number}).c).toBe(before);
    const profiles=new SqliteProfileRepository(db as never);
    expect((await profiles.listCustomers()).find(customer=>customer.id==='c1')?.vat).toEqual(noAccountVat);
  });
  it('refuses a bad mode or a rate outside 0 to 100 in the database itself',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    expect(()=>db.raw.exec(`INSERT INTO suppliers (id,name,is_active,vat_mode,vat_rate_basis_points,created_at,updated_at) VALUES ('bad','Bad',1,'custom',10001,'${SEED_TIME}','${SEED_TIME}')`)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO suppliers (id,name,is_active,vat_mode,created_at,updated_at) VALUES ('bad2','Bad',1,'always','${SEED_TIME}','${SEED_TIME}')`)).toThrow();
  });
});

describe('customers',()=>{
  it('starts as No VAT, can be set to Universal or Own % and back, and queues the change',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    const profiles=new SqliteProfileRepository(db as never);
    const created=await profiles.createCustomer({type:'company',name:'Hassan Contracting'});
    expect(created.vat).toEqual(noAccountVat);
    expect((await profiles.setCustomerVat(created.id,{mode:'universal',ratePercent:''})).vat).toEqual({mode:'universal',ratePercent:null});
    expect((await profiles.setCustomerVat(created.id,{mode:'custom',ratePercent:'5'})).vat).toEqual({mode:'custom',ratePercent:5});
    expect((await profiles.listCustomers()).find(customer=>customer.id===created.id)?.vat).toEqual({mode:'custom',ratePercent:5});
    expect((await profiles.setCustomerVat(created.id,{mode:'none',ratePercent:'5'})).vat).toEqual(noAccountVat);
    expect(db.raw.prepare('SELECT vat_mode,vat_rate_basis_points FROM customers WHERE id=?').get(created.id)).toMatchObject({vat_mode:'none',vat_rate_basis_points:null});
    expect((db.raw.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE entity_type='customer' AND entity_id=?").get(created.id) as {c:number}).c).toBeGreaterThanOrEqual(4);
  });
  it('can be created with a VAT choice, and rejects a bad rate or an unknown customer',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    const profiles=new SqliteProfileRepository(db as never);
    expect((await profiles.createCustomer({type:'company',name:'With VAT',vat:{mode:'custom',ratePercent:'5'}})).vat).toEqual({mode:'custom',ratePercent:5});
    const created=await profiles.createCustomer({type:'individual',name:'Plain'});
    await expect(profiles.setCustomerVat(created.id,{mode:'custom',ratePercent:'150'})).rejects.toThrow('0 to 100');
    await expect(profiles.setCustomerVat('missing',{mode:'none',ratePercent:''})).rejects.toThrow('not found');
    expect((await profiles.listCustomers()).find(customer=>customer.id===created.id)?.vat).toEqual(noAccountVat);
  });
});

describe('suppliers',()=>{
  it('starts as No VAT, keeps its VAT when edited without one, and changes it when edited with one',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    const quarry=new SqliteQuarryRepository(db as never);
    const created=await quarry.createSupplier({name:'Al Salam Quarry'});
    expect(created.vat).toEqual(noAccountVat);
    const taxed=await quarry.createSupplier({name:'Taxed Supplier',vat:{mode:'universal',ratePercent:''}});
    expect(taxed.vat).toEqual({mode:'universal',ratePercent:null});
    expect((await quarry.updateSupplier(taxed.id,{name:'Taxed Supplier Ltd'})).vat).toEqual({mode:'universal',ratePercent:null});
    expect((await quarry.updateSupplier(taxed.id,{name:'Taxed Supplier Ltd',vat:{mode:'none',ratePercent:''}})).vat).toEqual(noAccountVat);
    expect((await quarry.updateSupplier(created.id,{name:'Al Salam Quarry',vat:{mode:'custom',ratePercent:'8,5'}})).vat).toEqual({mode:'custom',ratePercent:8.5});
    expect((await quarry.getSetup()).suppliers.find(supplier=>supplier.id===created.id)?.vat).toEqual({mode:'custom',ratePercent:8.5});
    await expect(quarry.updateSupplier(created.id,{name:'Al Salam Quarry',vat:{mode:'custom',ratePercent:''}})).rejects.toThrow('0 to 100');
  });
});

describe('the screens',()=>{
  const customers=read('src/ui/screens/CustomersScreen.tsx'),quarry=read('src/ui/screens/QuarryPurchasesScreen.tsx'),control=read('src/ui/components/AccountVatControl.tsx');
  it('shows an Account VAT card on a customer with the three choices, saved with its own button',()=>{
    expect(customers).toContain('<AccountVatCard');expect(customers).toContain('repository.setCustomerVat(customer.id, vat)');
    expect(control).toContain('title="Account VAT"');expect(control).toContain("{id:'none',label:'No VAT'},{id:'universal',label:universal},{id:'custom',label:'Own %'}");expect(control).toContain('label="Save VAT setting"');
  });
  it('offers the VAT choice when adding or editing a supplier, No VAT for a new one',()=>{
    expect(quarry.split('<AccountVatControl value={supplierVat}').length-1).toBe(2);
    expect(quarry).toContain('useState<AccountVatDraft>(emptyAccountVatDraft)');expect(quarry).toContain('notes:supplierNotes,vat:supplierVat');
  });
});
