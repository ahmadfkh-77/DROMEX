import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteProfileRepository} from '../src/data/repositories/SqliteProfileRepository';
import {documentHeaderConfigured,documentHeaderIsEmpty} from '../src/domain/profiles';

class TestDatabase {
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

const NOW='2026-09-06T00:00:00.000Z';
const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=new TestDatabase();
  databases.push(database);
  await migrateDatabase(database as never);
  database.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_1','company','Road Works Ltd',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('project_1','cust_1','Road Project','Beirut','active','2026-07-01','${NOW}','${NOW}',0);
  `);
  return {database,profiles:new SqliteProfileRepository(database as never)};
}

const columns=(database:TestDatabase,table:string)=>(database.raw.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(row=>row.name);

describe('PDF settings migration (DEC-397 to DEC-399)',()=>{
  it('adds every new column at database version 34',async()=>{
    const {database}=await setup();
    expect(DATABASE_VERSION).toBe(34);
    expect((database.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(34);
    const settings=columns(database,'company_settings');
    for(const column of ['ministry_name','ministry_name_ar','ministry_logo_uri','consulting_agency_name','consulting_agency_name_ar','custom_header_en','custom_header_ar']) expect(settings).toContain(column);
    const reports=columns(database,'daily_project_reports');
    for(const column of ['show_ministry_header','show_consulting_agency','show_custom_header']) expect(reports).toContain(column);
  });

  it('is idempotent: migrating an already-current database changes nothing',async()=>{
    const {database}=await setup();
    const before=columns(database,'company_settings').join(',');
    await migrateDatabase(database as never);
    await migrateDatabase(database as never);
    expect(columns(database,'company_settings').join(',')).toBe(before);
    expect((database.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(34);
  });

  it('defaults both new report switches to off for a newly inserted report',async()=>{
    const {database}=await setup();
    database.raw.exec(`INSERT INTO daily_project_reports (id,project_id,work_date,work_description,created_at,updated_at) VALUES ('r_new','project_1','2026-09-01','New row','${NOW}','${NOW}');`);
    const row=database.raw.prepare('SELECT show_ministry_header m,show_consulting_agency a,show_custom_header c FROM daily_project_reports WHERE id=?').get('r_new') as {m:number;a:number;c:number};
    expect(row).toEqual({m:0,a:0,c:0});
  });
});

describe('consulting agency backfill (DEC-399)',()=>{
  // The migration must reproduce today's output exactly: a report that prints an agency line because
  // its sign-off is on must keep printing it. A plain DEFAULT 0 would have silently dropped it.
  async function migrateFromVersion33(rows:{id:string;signoff:0|1}[]){
    const database=new TestDatabase();
    databases.push(database);
    await migrateDatabase(database as never);
    // Rewind to the pre-change schema so the v33 -> v34 step runs against real legacy rows.
    database.raw.exec('ALTER TABLE daily_project_reports DROP COLUMN show_consulting_agency');
    database.raw.exec('ALTER TABLE daily_project_reports DROP COLUMN show_custom_header');
    database.raw.exec('PRAGMA user_version = 33');
    database.raw.exec(`INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_1','company','Road Works Ltd',0,1,'${NOW}','${NOW}');
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('project_1','cust_1','Road Project','Beirut','active','2026-07-01','${NOW}','${NOW}',0);`);
    for(const row of rows){
      database.raw.exec(`INSERT INTO daily_project_reports (id,project_id,work_date,work_description,consultant_signoff_enabled,created_at,updated_at) VALUES ('${row.id}','project_1','2026-08-${row.id.slice(-2)}','Legacy',${row.signoff},'${NOW}','${NOW}');`);
    }
    await migrateDatabase(database as never);
    return database;
  }

  it('turns the agency on for existing reports whose sign-off is enabled, and only those',async()=>{
    const database=await migrateFromVersion33([{id:'rep_01',signoff:1},{id:'rep_02',signoff:0},{id:'rep_03',signoff:1}]);
    const rows=database.raw.prepare('SELECT id,show_consulting_agency a FROM daily_project_reports ORDER BY id').all() as {id:string;a:number}[];
    expect(rows).toEqual([{id:'rep_01',a:1},{id:'rep_02',a:0},{id:'rep_03',a:1}]);
  });

  it('never backfills the custom header, which had no predecessor',async()=>{
    const database=await migrateFromVersion33([{id:'rep_01',signoff:1},{id:'rep_02',signoff:0}]);
    const rows=database.raw.prepare('SELECT show_custom_header c FROM daily_project_reports').all() as {c:number}[];
    expect(rows.every(row=>row.c===0)).toBe(true);
  });

  it('leaves the existing ministry switch exactly as it was',async()=>{
    const database=await migrateFromVersion33([{id:'rep_01',signoff:1}]);
    database.raw.exec("UPDATE daily_project_reports SET show_ministry_header=1 WHERE id='rep_01'");
    await migrateDatabase(database as never);
    const row=database.raw.prepare('SELECT show_ministry_header m FROM daily_project_reports WHERE id=?').get('rep_01') as {m:number};
    expect(row.m).toBe(1);
  });

  it('preserves ministry and agency values already stored before the migration',async()=>{
    const database=new TestDatabase();
    databases.push(database);
    await migrateDatabase(database as never);
    database.raw.exec(`INSERT INTO company_settings (id,company_name,ministry_name,ministry_logo_uri,consulting_agency_name,updated_at) VALUES ('company','DROMEX','Ministry of Works','file:///m.png','Cedar Engineering','${NOW}')`);
    database.raw.exec('PRAGMA user_version = 33');
    await migrateDatabase(database as never);
    const settings=await new SqliteProfileRepository(database as never).getCompanySettings();
    expect(settings).toMatchObject({ministryName:'Ministry of Works',ministryLogoUri:'file:///m.png',consultingAgencyName:'Cedar Engineering',companyName:'DROMEX'});
    expect(settings.ministryNameAr).toBeNull();
    expect(settings.customHeaderEn).toBeNull();
  });
});

describe('PDF settings persistence',()=>{
  it('round-trips every English and Arabic value plus the logo',async()=>{
    const {profiles}=await setup();
    const saved=await profiles.savePdfSettings({
      ministryName:'Ministry of Public Works',ministryNameAr:'وزارة الأشغال العامة',ministryLogoUri:'file:///ministry.png',
      consultingAgencyName:'Cedar Engineering',consultingAgencyNameAr:'سيدار للاستشارات',
      customHeaderEn:'Contract 2026/114',customHeaderAr:'عقد ٢٠٢٦/١١٤',
    });
    expect(saved).toMatchObject({ministryNameAr:'وزارة الأشغال العامة',consultingAgencyNameAr:'سيدار للاستشارات',customHeaderEn:'Contract 2026/114',customHeaderAr:'عقد ٢٠٢٦/١١٤'});
    expect(await profiles.getCompanySettings()).toMatchObject({
      ministryName:'Ministry of Public Works',ministryNameAr:'وزارة الأشغال العامة',ministryLogoUri:'file:///ministry.png',
      consultingAgencyName:'Cedar Engineering',consultingAgencyNameAr:'سيدار للاستشارات',
      customHeaderEn:'Contract 2026/114',customHeaderAr:'عقد ٢٠٢٦/١١٤',
    });
  });

  it('stores unset, blank, and whitespace-only values as null',async()=>{
    const {profiles}=await setup();
    await profiles.savePdfSettings({});
    expect(await profiles.getCompanySettings()).toMatchObject({ministryName:null,ministryNameAr:null,customHeaderEn:null,customHeaderAr:null,consultingAgencyNameAr:null});
    await profiles.savePdfSettings({ministryNameAr:'   ',customHeaderEn:'  Contract  2026  '});
    const settings=await profiles.getCompanySettings();
    expect(settings.ministryNameAr).toBeNull();
    expect(settings.customHeaderEn).toBe('Contract 2026');
  });

  it('creates the settings row without inventing a company name',async()=>{
    const {profiles}=await setup();
    await profiles.savePdfSettings({ministryName:'Ministry of Works'});
    const settings=await profiles.getCompanySettings();
    expect(settings.ministryName).toBe('Ministry of Works');
    expect(settings.companyName).toBe('');
  });

  it('keeps the logo when only text is saved, and keeps the names when only the logo is removed',async()=>{
    const {profiles}=await setup();
    await profiles.savePdfSettings({ministryName:'Ministry of Works',ministryNameAr:'وزارة الأشغال',ministryLogoUri:'file:///ministry.png'});
    // Saving text again carries the logo through, because the screen re-sends the value it loaded.
    const afterText=await profiles.savePdfSettings({ministryName:'Ministry of Public Works',ministryNameAr:'وزارة الأشغال',ministryLogoUri:'file:///ministry.png'});
    expect(afterText.ministryLogoUri).toBe('file:///ministry.png');
    // Removing the logo is a deliberate separate action and must not touch either name.
    const afterRemove=await profiles.savePdfSettings({ministryName:'Ministry of Public Works',ministryNameAr:'وزارة الأشغال',ministryLogoUri:null});
    expect(afterRemove.ministryLogoUri).toBeNull();
    expect(afterRemove).toMatchObject({ministryName:'Ministry of Public Works',ministryNameAr:'وزارة الأشغال'});
  });
});

describe('write ownership is split so neither screen can blank the other (DEC-397)',()=>{
  it('saving company settings never clears any PDF header value',async()=>{
    const {profiles}=await setup();
    await profiles.savePdfSettings({
      ministryName:'Ministry of Works',ministryNameAr:'وزارة الأشغال',ministryLogoUri:'file:///m.png',
      consultingAgencyName:'Cedar Engineering',consultingAgencyNameAr:'سيدار',customHeaderEn:'Contract 114',customHeaderAr:'عقد ١١٤',
    });
    // Company & VAT no longer sends these values at all; this is the regression guard for that.
    await profiles.saveCompanySettings({companyName:'DROMEX',vatRatePercent:11,address:'Beirut',receiptFooter:'Thank you'});
    expect(await profiles.getCompanySettings()).toMatchObject({
      companyName:'DROMEX',address:'Beirut',receiptFooter:'Thank you',
      ministryName:'Ministry of Works',ministryNameAr:'وزارة الأشغال',ministryLogoUri:'file:///m.png',
      consultingAgencyName:'Cedar Engineering',consultingAgencyNameAr:'سيدار',customHeaderEn:'Contract 114',customHeaderAr:'عقد ١١٤',
    });
  });

  it('saving PDF settings never changes company identity, contacts, or VAT',async()=>{
    const {profiles}=await setup();
    await profiles.saveCompanySettings({companyName:'DROMEX',vatRatePercent:11,address:'Beirut',phone:'+961 1 000000',taxVatNumber:'VAT-9',receiptFooter:'Thank you',logoUri:'file:///company.png'});
    await profiles.savePdfSettings({ministryName:'Ministry of Works',customHeaderEn:'Contract 114'});
    expect(await profiles.getCompanySettings()).toMatchObject({
      companyName:'DROMEX',address:'Beirut',phone:'+961 1 000000',taxVatNumber:'VAT-9',
      receiptFooter:'Thank you',logoUri:'file:///company.png',vatRatePercent:11,
    });
  });

  it('does not remove the company logo when the ministry logo is removed',async()=>{
    const {profiles}=await setup();
    await profiles.saveCompanySettings({companyName:'DROMEX',vatRatePercent:0,logoUri:'file:///company.png'});
    await profiles.savePdfSettings({ministryLogoUri:'file:///ministry.png'});
    await profiles.savePdfSettings({ministryLogoUri:null});
    const settings=await profiles.getCompanySettings();
    expect(settings.logoUri).toBe('file:///company.png');
    expect(settings.ministryLogoUri).toBeNull();
  });
});

describe('documentHeaderConfigured (DEC-402 editor state)',()=>{
  it('reports each language and the logo slot separately',()=>{
    const settings={ministryName:'Ministry',ministryNameAr:null,ministryLogoUri:'file:///m.png',consultingAgencyName:null,consultingAgencyNameAr:'سيدار',customHeaderEn:null,customHeaderAr:null};
    expect(documentHeaderConfigured(settings,'ministry')).toEqual({english:true,arabic:false,logo:true});
    expect(documentHeaderConfigured(settings,'consultingAgency')).toEqual({english:false,arabic:true,logo:false});
    expect(documentHeaderConfigured(settings,'customHeader')).toEqual({english:false,arabic:false,logo:false});
  });

  it('treats whitespace-only values as not configured',()=>{
    expect(documentHeaderConfigured({customHeaderEn:'   ',customHeaderAr:'\t'},'customHeader')).toEqual({english:false,arabic:false,logo:false});
  });

  it('knows when a header would render nothing at all',()=>{
    expect(documentHeaderIsEmpty({},'ministry')).toBe(true);
    expect(documentHeaderIsEmpty({ministryLogoUri:'file:///m.png'},'ministry')).toBe(false);
    expect(documentHeaderIsEmpty({consultingAgencyNameAr:'سيدار'},'consultingAgency')).toBe(false);
  });
});
