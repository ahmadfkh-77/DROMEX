import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';

import {SqliteCompanyHeaderRepository} from '../src/data/repositories/SqliteCompanyHeaderRepository';
import type {ProjectCompanyDraft} from '../src/domain/companyHeaders';
import {SEED_TIME,type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/**
 * DEC-507. Both the Plant Company (the supplier) and the Project Company (the company that receives the materials)
 * are the Owner's own companies, so the own-company customer can be the Project Company, and its projects start on
 * the Project Company header. Nothing about any customer, load, payment or project changes.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const read=(file:string)=>readFileSync(join(__dirname,'..',file),'utf8');
const draft=(customerId:string):ProjectCompanyDraft=>({customerId,logoUri:null,address:'Zahle, Bekaa',phone:'+961 8 555 123',email:'',taxVatNumber:'',registrationNumber:'55821',receiptFooter:'',signerId:null,signerDisplay:null});

async function setup(){
  const fixture=await recordsDatabase(databases);
  fixture.db.raw.exec(`
    INSERT INTO company_settings (id,company_name,address,updated_at) VALUES ('company','DROMEX Asphalt Co.','Beirut','${SEED_TIME}');
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('own','company','Hashem Contracting',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('own_road','own','Own Road','Aley','active','2026-08-01','${SEED_TIME}','${SEED_TIME}',0);
  `);
  return {...fixture,headers:new SqliteCompanyHeaderRepository(fixture.db as never)};
}
const everyRow=(db:SqliteTestDatabase)=>Object.fromEntries(['customers','loads','quarry_purchases','payment_entries'].map(table=>[table,db.raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
const firstOtherProject=(db:SqliteTestDatabase)=>(db.raw.prepare("SELECT id FROM projects WHERE customer_id <> 'own' ORDER BY id").get() as {id:string}).id;

describe('the own-company customer as the Project Company',()=>{
  it('can be saved, prints under its own name with its own details, and leaves every record untouched',async()=>{
    const {db,headers}=await setup();
    const before=everyRow(db);
    const saved=await headers.saveProjectCompany(draft('own'));
    expect(saved).toMatchObject({customerId:'own',customerName:'Hashem Contracting',customerIsActive:true,address:'Zahle, Bekaa'});
    expect(await headers.resolveHeader('project')).toMatchObject({kind:'project',name:'Hashem Contracting',address:'Zahle, Bekaa',note:null});
    expect(await headers.resolveHeader('plant')).toMatchObject({kind:'plant',name:'DROMEX Asphalt Co.',address:'Beirut'});
    expect(everyRow(db)).toEqual(before);
  });
});

describe('the header a project starts on',()=>{
  it('is the Plant Company until a Project Company is saved, then the Project Company for that customer\'s projects only',async()=>{
    const {db,headers}=await setup();
    const other=firstOtherProject(db);
    expect(await headers.getProjectHeaderDefault('own_road')).toBe('plant');
    await headers.saveProjectCompany(draft('own'));
    expect(await headers.getProjectHeaderDefault('own_road')).toBe('project');
    expect(await headers.getProjectHeaderDefault(other)).toBe('plant');
    expect(await headers.getProjectHeaderDefault('missing-project')).toBe('plant');
  });

  it('lets a choice remembered for the project win, either way',async()=>{
    const {db,headers}=await setup();
    await headers.saveProjectCompany(draft('own'));
    await headers.setProjectHeaderDefault('own_road','plant');
    expect(await headers.getProjectHeaderDefault('own_road')).toBe('plant');
    const other=firstOtherProject(db);
    await headers.setProjectHeaderDefault(other,'project');
    expect(await headers.getProjectHeaderDefault(other)).toBe('project');
  });

  it('follows a customer merged into the Project Company customer, and falls back when the setup is removed',async()=>{
    const {db,headers}=await setup();
    await headers.saveProjectCompany(draft('own'));
    db.raw.exec(`INSERT INTO customers (id,customer_type,name,is_own_company,is_active,merged_into_id,created_at,updated_at) VALUES ('old_own','company','Hashem Contracting (old)',0,0,'own','${SEED_TIME}','${SEED_TIME}');
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('merged_road','old_own','Merged Road','Aley','active','2026-08-01','${SEED_TIME}','${SEED_TIME}',0)`);
    expect(await headers.getProjectHeaderDefault('merged_road')).toBe('project');
    await headers.removeProjectCompany();
    expect(await headers.getProjectHeaderDefault('own_road')).toBe('plant');
    expect(await headers.getProjectHeaderDefault('merged_road')).toBe('plant');
  });
});

describe('where the controls are',()=>{
  it('offers the own company in the Project Company setup, preselected, and the button on every active customer\'s page',()=>{
    const setupScreen=read('src/ui/screens/ProjectCompanyScreen.tsx');
    expect(setupScreen).not.toContain('!value.isOwnCompany');
    expect(setupScreen).toContain('(Own company)');expect(setupScreen).toContain('initialCustomerId');
    const customers=read('src/ui/screens/CustomersScreen.tsx');
    for(const text of ['Use as Project Company','Edit Project Company details','Project Company</Text>','onOpenProjectCompany'])expect(customers).toContain(text);
    const app=read('src/ui/DromexApp.tsx');
    expect(app).toContain('onOpenProjectCompany={customerId=>{setProjectCompanyPick(customerId);navigate(\'projectCompany\');}}');
    expect(app).toContain('initialCustomerId={projectCompanyPick}');
  });
});

describe('the own-company customer is named by the Project Company, not by the plant',()=>{
  it('keeps the customer\'s name and details when the Plant Company is saved',async()=>{
    const {db}=await setup();
    const {SqliteProfileRepository}=await import('../src/data/repositories/SqliteProfileRepository');
    const profiles=new SqliteProfileRepository(db as never);
    db.raw.exec("UPDATE customers SET phone='01 111', address='Zahle', tax_vat_number='T-9' WHERE id='own'");
    const before=db.raw.prepare("SELECT * FROM customers WHERE id='own'").get();
    await profiles.saveCompanySettings({companyName:'DROMEX Asphalt Co. (renamed)',phone:'01 999',email:'plant@x.test',address:'Beirut',taxVatNumber:'P-1',vatRatePercent:11,logoUri:null} as never);
    expect(db.raw.prepare("SELECT * FROM customers WHERE id='own'").get()).toEqual(before);
    expect(db.raw.prepare("SELECT company_name FROM company_settings WHERE id='company'").get()).toEqual({company_name:'DROMEX Asphalt Co. (renamed)'});
    expect((db.raw.prepare('SELECT COUNT(*) n FROM customers WHERE is_own_company=1').get() as {n:number}).n).toBe(1);
  });

  it('still creates the own-company customer the first time, from the plant\'s details',async()=>{
    const {db}=await setup();
    db.raw.exec("UPDATE projects SET customer_id='customer' WHERE customer_id='own';DELETE FROM customers WHERE id='own'");
    const {SqliteProfileRepository}=await import('../src/data/repositories/SqliteProfileRepository');
    await new SqliteProfileRepository(db as never).saveCompanySettings({companyName:'First Plant',phone:null,email:null,address:null,taxVatNumber:null,vatRatePercent:11,logoUri:null} as never);
    expect(db.raw.prepare('SELECT name FROM customers WHERE is_own_company=1').get()).toEqual({name:'First Plant'});
  });

  it('renames the own-company customer from the Project Company setup, leaving old records and other customers alone',async()=>{
    const {db,headers}=await setup();
    const loadsBefore=db.raw.prepare('SELECT * FROM loads ORDER BY id').all(),othersBefore=db.raw.prepare("SELECT * FROM customers WHERE id <> 'own' ORDER BY id").all();
    const saved=await headers.saveProjectCompany({...draft('own'),customerName:'  Hashem   Contracting '});
    expect(saved).toMatchObject({customerId:'own',customerName:'Hashem Contracting'});
    expect(db.raw.prepare("SELECT name FROM customers WHERE id='own'").get()).toEqual({name:'Hashem Contracting'});
    expect(db.raw.prepare('SELECT * FROM loads ORDER BY id').all()).toEqual(loadsBefore);
    expect(db.raw.prepare("SELECT * FROM customers WHERE id <> 'own' ORDER BY id").all()).toEqual(othersBefore);
    expect(await headers.resolveHeader('project')).toMatchObject({name:'Hashem Contracting'});
    expect(await headers.resolveHeader('plant')).toMatchObject({name:'DROMEX Asphalt Co.'});
  });

  it('refuses an empty name or one another customer already has, and never renames a customer that is not the own company',async()=>{
    const {db,headers}=await setup();
    await expect(headers.saveProjectCompany({...draft('own'),customerName:'   '})).rejects.toThrow('Enter the company name.');
    await expect(headers.saveProjectCompany({...draft('own'),customerName:'road co'})).rejects.toThrow('already exists');
    await headers.saveProjectCompany({...draft('customer'),customerName:'Should Not Apply'});
    expect(db.raw.prepare("SELECT name FROM customers WHERE id='customer'").get()).toEqual({name:'Road Co'});
  });

  it('shows the Company name field only for the own company, prefilled',()=>{
    const screen=read('src/ui/screens/ProjectCompanyScreen.tsx');
    expect(screen).toContain('label="Company name *"');expect(screen).toContain('chosen?.isOwnCompany');
    expect(screen).toContain('...(chosen?.isOwnCompany?{customerName:companyName}:{})');
  });
});
