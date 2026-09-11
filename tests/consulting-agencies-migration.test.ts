import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase,migration35NormalizeAgencyKey,migration35NormalizeAgencyName} from '../src/data/database/migrations';
import {normalizeAgencyKey,normalizeAgencyName} from '../src/domain/profiles';

class TestDatabase {
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  close(){this.raw.close();}
}

const NOW='2026-09-06T00:00:00.000Z';
const databases:TestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

function makeDatabase(){const database=new TestDatabase();databases.push(database);return database;}

/** Simulates an existing installation already at schema version 34 whose global consulting-agency
 * value is set, by running the full chain once (legacy empty) and then rolling PRAGMA user_version
 * back to 34 with the legacy value freshly written -- so the next migrateDatabase() call re-enters
 * exactly the v34 -> v35 step under realistic upgrade conditions. */
async function upgradeFromLegacyAgency(database:TestDatabase, english:string, arabic:string){
  await migrateDatabase(database as never);
  database.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_1','company','Road Works Ltd',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,notes,status,start_date,created_at,updated_at,is_archived)
      VALUES ('project_1','cust_1','Airport Road','Beirut',NULL,'active','2026-07-01','${NOW}','${NOW}',0);
    INSERT INTO projects (id,customer_id,name,location,notes,status,start_date,created_at,updated_at,is_archived)
      VALUES ('project_2','cust_1','Coastal Highway','Tyre',NULL,'active','2026-07-01','${NOW}','${NOW}',0);
    INSERT INTO daily_project_reports (id,project_id,work_date,work_description,workers_json,safety_json,drivers_json,truck_plates_json,machines_json,materials_json,photos_json,consultant_signoff_enabled,consultant_name,consultant_signature_json,show_ministry_header,show_consulting_agency,show_custom_header,created_at,updated_at)
      VALUES ('report_on','project_1','2026-08-01','Work','[]','[]','[]','[]','[]','[]','[]',0,'','[]',0,1,0,'${NOW}','${NOW}');
    INSERT INTO daily_project_reports (id,project_id,work_date,work_description,workers_json,safety_json,drivers_json,truck_plates_json,machines_json,materials_json,photos_json,consultant_signoff_enabled,consultant_name,consultant_signature_json,show_ministry_header,show_consulting_agency,show_custom_header,created_at,updated_at)
      VALUES ('report_off','project_1','2026-08-02','Work','[]','[]','[]','[]','[]','[]','[]',0,'','[]',0,0,0,'${NOW}','${NOW}');
  `);
  await database.runAsync(
    `INSERT INTO company_settings (id, company_name, consulting_agency_name, consulting_agency_name_ar, updated_at) VALUES ('company', 'DROMEX', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET consulting_agency_name = excluded.consulting_agency_name, consulting_agency_name_ar = excluded.consulting_agency_name_ar`,
    english, arabic, NOW,
  );
  database.raw.exec('PRAGMA user_version = 34;');
}

describe('consulting agencies migration (v34 -> v35, DEC-416/DEC-417)',()=>{
  it('runs cleanly on a brand-new database with no legacy agency and creates none',async()=>{
    const database=makeDatabase();
    await migrateDatabase(database as never);
    const version=database.raw.prepare('PRAGMA user_version').get() as {user_version:number};
    expect(version.user_version).toBe(DATABASE_VERSION);
    expect(database.raw.prepare('SELECT COUNT(*) total FROM consulting_agencies').get()).toMatchObject({total:0});
  });

  it('adds the new columns even with no legacy value to seed',async()=>{
    const database=makeDatabase();
    await migrateDatabase(database as never);
    const projectColumns=(database.raw.prepare('PRAGMA table_info(projects)').all() as {name:string}[]).map(c=>c.name);
    const reportColumns=(database.raw.prepare('PRAGMA table_info(daily_project_reports)').all() as {name:string}[]).map(c=>c.name);
    expect(projectColumns).toContain('consulting_agency_id');
    expect(reportColumns).toEqual(expect.arrayContaining(['consulting_agency_id','consulting_agency_name_en','consulting_agency_name_ar']));
  });

  it('seeds exactly one agency from an existing bilingual global value, backfills every project, and backfills only reports whose header was already on',async()=>{
    const database=makeDatabase();
    await upgradeFromLegacyAgency(database,'Cedar Engineering Consultants','agency arabic name');

    await migrateDatabase(database as never);

    const agencies=database.raw.prepare('SELECT * FROM consulting_agencies').all() as Record<string,unknown>[];
    expect(agencies).toHaveLength(1);
    expect(agencies[0]).toMatchObject({name_en:'Cedar Engineering Consultants',name_ar:'agency arabic name',is_active:1});
    expect(agencies[0]!.name_en_key).toBe(normalizeAgencyKey('Cedar Engineering Consultants'));

    const projects=database.raw.prepare('SELECT id,consulting_agency_id FROM projects').all() as {id:string;consulting_agency_id:string}[];
    expect(projects.every(p=>p.consulting_agency_id===agencies[0]!.id)).toBe(true);
    expect(projects).toHaveLength(2);

    const reportOn=database.raw.prepare('SELECT * FROM daily_project_reports WHERE id=?').get('report_on') as Record<string,unknown>;
    expect(reportOn).toMatchObject({consulting_agency_id:agencies[0]!.id,consulting_agency_name_en:'Cedar Engineering Consultants',consulting_agency_name_ar:'agency arabic name'});

    const reportOff=database.raw.prepare('SELECT * FROM daily_project_reports WHERE id=?').get('report_off') as Record<string,unknown>;
    expect(reportOff.consulting_agency_id).toBeNull();
    expect(reportOff.consulting_agency_name_en).toBeNull();
  });

  it('preserves an Arabic-only legacy value honestly: nameEn stays empty, not invented or copied',async()=>{
    const database=makeDatabase();
    await upgradeFromLegacyAgency(database,'','agency arabic name');

    await migrateDatabase(database as never);

    const agencies=database.raw.prepare('SELECT * FROM consulting_agencies').all() as Record<string,unknown>[];
    expect(agencies).toHaveLength(1);
    expect(agencies[0]!.name_en).toBe('');
    expect(agencies[0]!.name_ar).toBe('agency arabic name');
  });

  it('is idempotent: re-entering the same migration step never creates a duplicate agency',async()=>{
    // This step runs exactly once in real operation, guarded by PRAGMA user_version; re-entry is
    // simulated here only as a defensive check, not a realistic upgrade path.
    const database=makeDatabase();
    await upgradeFromLegacyAgency(database,'Cedar Engineering Consultants','');
    await migrateDatabase(database as never);
    const firstPassAgencies=database.raw.prepare('SELECT * FROM consulting_agencies').all() as {id:string}[];
    expect(firstPassAgencies).toHaveLength(1);
    const agencyId=firstPassAgencies[0]!.id;

    database.raw.exec('PRAGMA user_version = 34;');
    await migrateDatabase(database as never);

    const secondPassAgencies=database.raw.prepare('SELECT * FROM consulting_agencies').all() as {id:string}[];
    expect(secondPassAgencies).toHaveLength(1);
    expect(secondPassAgencies[0]!.id).toBe(agencyId);

    // Nothing changed between the two passes, so both projects still reference that one agency —
    // the guard is "never fills an already-assigned reference," which a NULL/unassigned column
    // cannot distinguish from a value a user deliberately cleared. That distinction does not need to
    // be made here: this step is unreachable a second time on a real device once it has run once.
    const projects=database.raw.prepare('SELECT consulting_agency_id FROM projects').all() as {consulting_agency_id:string}[];
    expect(projects.every(p=>p.consulting_agency_id===agencyId)).toBe(true);
  });

  it('never rewrites confirmed transaction, ministry, or company data',async()=>{
    const database=makeDatabase();
    await upgradeFromLegacyAgency(database,'Cedar Engineering Consultants','');
    await database.runAsync("UPDATE company_settings SET ministry_name = 'Ministry of Public Works', company_name = 'DROMEX' WHERE id='company'");
    await migrateDatabase(database as never);
    const settings=database.raw.prepare("SELECT company_name, ministry_name FROM company_settings WHERE id='company'").get() as Record<string,unknown>;
    expect(settings).toMatchObject({company_name:'DROMEX',ministry_name:'Ministry of Public Works'});
    const project=database.raw.prepare('SELECT name, location FROM projects WHERE id=?').get('project_1') as Record<string,unknown>;
    expect(project).toMatchObject({name:'Airport Road',location:'Beirut'});
  });
});

describe('consulting_agencies table constraint (SQLite-enforced uniqueness)',()=>{
  it('rejects a second row whose normalized key collides, even with different capitalization or surrounding whitespace',async()=>{
    const database=makeDatabase();
    await migrateDatabase(database as never);
    const now=NOW;
    await database.runAsync(
      'INSERT INTO consulting_agencies (id,name_en,name_ar,name_en_key,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)',
      'agency_1','Cedar Engineering',null,normalizeAgencyKey('Cedar Engineering'),now,now,
    );
    expect(()=>database.runAsync(
      'INSERT INTO consulting_agencies (id,name_en,name_ar,name_en_key,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)',
      'agency_2',' CEDAR   ENGINEERING ',null,normalizeAgencyKey(' CEDAR   ENGINEERING '),now,now,
    )).toThrow();
  });
});

describe('frozen migration-35 normalization agrees with the live domain normalization today (contract, not a shared dependency)',()=>{
  // migrations.ts deliberately keeps its own local copy of this logic rather than importing
  // domain/profiles.ts, so a future change to the domain helpers can never alter what migration 35
  // does when applied to an old version-34 database. This test proves the two currently agree; it
  // is expected to need no update unless domain/profiles.ts's rule itself changes, in which case
  // this test failing is the intended signal that the two have diverged -- which is fine, since the
  // frozen migration copy must NOT be changed to follow such a change.
  const cases=['Cedar','  Cedar  ','CEDAR','cedar','Cedar   Engineering','Cedar Engineering',' cedar engineering ','CEDAR ENGINEERING','', '   '];

  it('produces the same normalized display name as domain/profiles.ts for capitalization and whitespace variants',()=>{
    for(const value of cases) expect(migration35NormalizeAgencyName(value)).toBe(normalizeAgencyName(value));
  });

  it('produces the same normalized duplicate-detection key as domain/profiles.ts for capitalization and whitespace variants',()=>{
    for(const value of cases) expect(migration35NormalizeAgencyKey(value)).toBe(normalizeAgencyKey(value));
  });

  it('still collapses "Cedar", " Cedar ", and "CEDAR" to one identical key, matching the runtime uniqueness rule',()=>{
    const keys=['Cedar',' Cedar ','CEDAR','cedar','  cedar  '].map(migration35NormalizeAgencyKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(normalizeAgencyKey('Cedar'));
  });
});
