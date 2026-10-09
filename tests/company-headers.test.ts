import {afterEach,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteCompanyHeaderRepository} from '../src/data/repositories/SqliteCompanyHeaderRepository';
import {SqliteDocumentSignerRepository} from '../src/data/repositories/SqliteDocumentSignerRepository';
import {BACKUP_COUNT_TABLES} from '../src/domain/backup';
import {effectiveHeaderKind,headerKindOrDefault,projectCompanyState,validateProjectCompanyDraft,type ProjectCompanyDraft} from '../src/domain/companyHeaders';
import {SEED_TIME,type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/**
 * Phase 1 (Receipts, Load History and PDFs). Migration 51 adds the Project Company link and the Plant
 * Company's extras. The link is additive: it stores a customer id and header details and writes nothing
 * to customers, loads, payments or projects.
 */
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const columns=(db:SqliteTestDatabase,table:string)=>db.raw.prepare(`PRAGMA table_info(${table})`).all().map(row=>(row as {name:string}).name);
const version=(db:SqliteTestDatabase)=>(db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
const draft=(overrides:Partial<ProjectCompanyDraft>={}):ProjectCompanyDraft=>({customerId:'customer',logoUri:null,address:'Zahle, Bekaa',phone:'+961 8 555 123',email:'',taxVatNumber:'',registrationNumber:'55821',receiptFooter:'',signerId:null,signerDisplay:null,...overrides});

async function setup(){
  const fixture=await recordsDatabase(databases);
  fixture.db.raw.exec(`INSERT INTO company_settings (id,company_name,address,phone,tax_vat_number,updated_at) VALUES ('company','DROMEX Asphalt Co.','Beirut','01 234','VAT-77','${SEED_TIME}')`);
  const headers=new SqliteCompanyHeaderRepository(fixture.db as never);
  const signers=new SqliteDocumentSignerRepository(fixture.db as never);
  return {...fixture,headers,signers};
}
/** Every row of every table the Project Company link must never touch. */
function recordSnapshot(db:SqliteTestDatabase){
  const rows=(table:string)=>db.raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  return {customers:rows('customers'),projects:rows('projects').map(row=>{const {header_company,...rest}=row as Record<string,unknown>;void header_company;return rest;}),loads:rows('loads'),quarry:rows('quarry_purchases'),payments:rows('payment_entries'),accountPayments:rows('account_payments'),suppliers:rows('suppliers')};
}

describe('migration 51',()=>{
  it('brings a fresh database to the current version with the new structures',async()=>{
    const {db}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(51);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(columns(db,'project_company_profile')).toEqual(expect.arrayContaining(['id','customer_id','logo_uri','address','phone','email','tax_vat_number','registration_number','receipt_footer','signer_id','signer_display','created_at','updated_at']));
    expect(columns(db,'company_settings')).toEqual(expect.arrayContaining(['registration_number','header_signer_id','header_signer_display']));
    expect(columns(db,'projects')).toContain('header_company');
    expect((db.raw.prepare('SELECT COUNT(*) n FROM project_company_profile').get() as {n:number}).n).toBe(0);
  });

  it('upgrades a version-50 database leaving every customer, load, payment and project row identical',async()=>{
    const {db,companyLoad,supplierLoad}=await setup();
    companyLoad('sand',{priceCents:5000,loadNumber:'SND-00001'});companyLoad('gravel',{customer:'cust_b',loadNumber:'GRV-00001'});companyLoad('sand',{status:'Cancelled',loadNumber:'SND-00002'});supplierLoad('sand',{priceCents:1200});
    const before=recordSnapshot(db);
    const totalsBefore=db.raw.prepare("SELECT customer_id,SUM(billed_quantity) qty,SUM(COALESCE(final_total_usd_cents,0)) cents,COUNT(*) n FROM loads WHERE status='Active' GROUP BY customer_id ORDER BY customer_id").all();
    db.raw.exec(`PRAGMA foreign_keys = OFF;DROP TABLE project_company_profile;ALTER TABLE projects DROP COLUMN header_company;ALTER TABLE company_settings DROP COLUMN header_signer_display;ALTER TABLE company_settings DROP COLUMN header_signer_id;ALTER TABLE company_settings DROP COLUMN registration_number;PRAGMA user_version = 50;`);
    await migrateDatabase(db as never);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(recordSnapshot(db)).toEqual(before);
    expect(db.raw.prepare("SELECT customer_id,SUM(billed_quantity) qty,SUM(COALESCE(final_total_usd_cents,0)) cents,COUNT(*) n FROM loads WHERE status='Active' GROUP BY customer_id ORDER BY customer_id").all()).toEqual(totalsBefore);
    expect(db.raw.prepare("SELECT load_number FROM loads ORDER BY id").all()).toEqual([{load_number:'SND-00001'},{load_number:'GRV-00001'},{load_number:'SND-00002'}]);
  });
});

describe('the Project Company link',()=>{
  it('stores only the customer id and header details, and writes nothing to any record',async()=>{
    const {db,headers,companyLoad}=await setup();
    companyLoad('sand',{priceCents:5000,loadNumber:'SND-00001'});companyLoad('gravel',{loadNumber:'GRV-00001'});
    const before=recordSnapshot(db);
    const saved=await headers.saveProjectCompany(draft());
    expect(saved).toMatchObject({customerId:'customer',customerName:'Road Co',customerIsActive:true,address:'Zahle, Bekaa',registrationNumber:'55821'});
    expect(db.raw.prepare('SELECT customer_id FROM project_company_profile').all()).toEqual([{customer_id:'customer'}]);
    expect(recordSnapshot(db)).toEqual(before);
    await headers.removeProjectCompany();
    expect(await headers.getProjectCompany()).toBeNull();
    expect(recordSnapshot(db)).toEqual(before);
  });

  it('keeps one Project Company: saving again replaces the link instead of adding a second row',async()=>{
    const {db,headers}=await setup();
    await headers.saveProjectCompany(draft());
    await headers.saveProjectCompany(draft({customerId:'cust_b',address:'Beirut'}));
    expect((db.raw.prepare('SELECT COUNT(*) n FROM project_company_profile').get() as {n:number}).n).toBe(1);
    expect(await headers.getProjectCompany()).toMatchObject({customerId:'cust_b',customerName:'Beirut Builders',address:'Beirut'});
  });

  it('follows a rename of the customer, and warns but keeps working when the customer is archived',async()=>{
    const {db,headers}=await setup();
    await headers.saveProjectCompany(draft());
    db.raw.exec("UPDATE customers SET name='Road Company Ltd' WHERE id='customer'");
    expect((await headers.resolveHeader('project')).name).toBe('Road Company Ltd');
    db.raw.exec("UPDATE customers SET is_active=0 WHERE id='customer'");
    const header=await headers.resolveHeader('project');
    expect(header).toMatchObject({kind:'project',name:'Road Company Ltd',address:'Zahle, Bekaa'});
    expect(header.note).toContain('archived');
    expect(projectCompanyState(await headers.getProjectCompany())).toBe('customer_archived');
  });

  it('follows a customer that was merged into another one',async()=>{
    const {db,headers}=await setup();
    await headers.saveProjectCompany(draft({customerId:'cust_b'}));
    db.raw.exec("UPDATE customers SET is_active=0,merged_into_id='customer' WHERE id='cust_b'");
    expect(await headers.getProjectCompany()).toMatchObject({customerId:'customer',customerName:'Road Co',customerIsActive:true});
  });

  it('refuses an unknown or archived customer, and a missing one',async()=>{
    const {db,headers}=await setup();
    await expect(headers.saveProjectCompany(draft({customerId:'nobody'}))).rejects.toThrow('The chosen customer was not found.');
    db.raw.exec("UPDATE customers SET is_active=0 WHERE id='cust_b'");
    await expect(headers.saveProjectCompany(draft({customerId:'cust_b'}))).rejects.toThrow('archived');
    await expect(headers.saveProjectCompany(draft({customerId:''}))).rejects.toThrow('Choose which customer');
  });
});

describe('the header company a PDF uses',()=>{
  it('is the Plant Company by default, built from the existing Company profile',async()=>{
    const {headers}=await setup();
    expect(await headers.resolveHeader('plant')).toMatchObject({kind:'plant',name:'DROMEX Asphalt Co.',address:'Beirut',phone:'01 234',taxVatNumber:'VAT-77',signer:null,note:null});
  });

  it('falls back to the Plant Company, with a note, while the Project Company is not set up',async()=>{
    const {headers}=await setup();
    const header=await headers.resolveHeader('project');
    expect(header).toMatchObject({kind:'plant',name:'DROMEX Asphalt Co.'});
    expect(header.note).toContain('not set up');
  });

  it('carries a signer from Authorized signers for each company, with no second stored signature',async()=>{
    const {db,headers,signers}=await setup();
    const me=await signers.createSigner({name:'Ahmad Fakih',jobTitle:'Owner',department:'DROMEX'});await signers.saveSignature(me.id,[STROKE]);
    const other=await signers.createSigner({name:'Site Manager',jobTitle:'Manager',department:''});
    await headers.savePlantExtras({registrationNumber:'  98765 ',signerId:me.id,signerDisplay:'name_with_signature'});
    await headers.saveProjectCompany(draft({signerId:other.id,signerDisplay:'name_only'}));
    expect(await headers.getPlantExtras()).toEqual({registrationNumber:'98765',signerId:me.id,signerDisplay:'name_with_signature'});
    expect((await headers.resolveHeader('plant')).signer).toEqual({signerId:me.id,name:'Ahmad Fakih',jobTitle:'Owner',department:'DROMEX',display:'name_with_signature',signature:[STROKE]});
    expect((await headers.resolveHeader('project')).signer).toMatchObject({name:'Site Manager',display:'name_only',signature:[]});
    expect(columns(db,'project_company_profile').filter(name=>/signature/i.test(name))).toEqual([]);
    await signers.setSignerActive(me.id,false);
    expect((await headers.resolveHeader('plant')).signer).toBeNull();
    await expect(headers.savePlantExtras({registrationNumber:'',signerId:me.id,signerDisplay:'name_only'})).rejects.toThrow('disabled');
  });

  it('asks for a drawn signature only when the signer has one',async()=>{
    const {headers,signers}=await setup();
    const plain=await signers.createSigner({name:'No Drawing',jobTitle:'',department:''});
    await expect(headers.savePlantExtras({registrationNumber:'',signerId:plain.id,signerDisplay:'name_with_signature'})).rejects.toThrow('no saved signature');
  });

  it('remembers a default per project, reads an unset project as the Plant Company, and clears it on removal',async()=>{
    const {headers}=await setup();
    expect(await headers.getProjectHeaderDefault('road')).toBe('plant');
    await expect(headers.setProjectHeaderDefault('road','project')).rejects.toThrow('Set up the Project Company');
    await headers.saveProjectCompany(draft());
    await headers.setProjectHeaderDefault('road','project');
    expect(await headers.getProjectHeaderDefault('road')).toBe('project');
    // DEC-507. 'other' is another project of the same customer, so with no remembered choice it starts on the Project Company too.
    expect(await headers.getProjectHeaderDefault('other')).toBe('project');
    await headers.removeProjectCompany();
    expect(await headers.getProjectHeaderDefault('road')).toBe('plant');
    await expect(headers.setProjectHeaderDefault('missing','plant')).rejects.toThrow('project was not found');
  });

  it('changes no record when a header is chosen',async()=>{
    const {db,headers,companyLoad}=await setup();
    companyLoad('sand',{priceCents:5000,loadNumber:'SND-00001'});
    await headers.saveProjectCompany(draft());
    const before=recordSnapshot(db);
    await headers.setProjectHeaderDefault('road','project');await headers.resolveHeader('project');await headers.resolveHeader('plant');
    expect(recordSnapshot(db)).toEqual(before);
  });
});

describe('company header rules',()=>{
  it('defaults an unknown stored value to the Plant Company',()=>{
    expect(headerKindOrDefault(null)).toBe('plant');expect(headerKindOrDefault('x')).toBe('plant');expect(headerKindOrDefault('project')).toBe('project');
  });
  it('uses the Plant Company when the Project Company was asked for but is not set up',()=>{
    expect(effectiveHeaderKind('project',false)).toBe('plant');expect(effectiveHeaderKind('project',true)).toBe('project');expect(effectiveHeaderKind('plant',false)).toBe('plant');
  });
  it('validates the Project Company form',()=>{
    expect(validateProjectCompanyDraft(draft())).toEqual([]);
    expect(validateProjectCompanyDraft(draft({customerId:' '}))[0]).toContain('Choose which customer');
    expect(validateProjectCompanyDraft(draft({email:'nope'}))[0]).toContain('valid email');
    expect(validateProjectCompanyDraft(draft({signerDisplay:'name_only'}))[0]).toContain('Choose a signer');
  });
});

describe('backup',()=>{
  it('counts the Project Company and archives its logo',()=>{
    expect(BACKUP_COUNT_TABLES).toContain('project_company_profile');
    expect(readFileSync('src/services/backup/BackupArchive.ts','utf8')).toContain("{table:'project_company_profile',column:'logo_uri'}");
  });
});
