import {DatabaseSync} from 'node:sqlite';

import {migrateDatabase} from '../../src/data/database/migrations';

/**
 * The expo-sqlite surface the repositories use, backed by node:sqlite. It is the same adapter the
 * individual test files declare inline, shared here by the People, Directory, Supervisor and Totals
 * suites so they cannot drift apart.
 */
export class SqliteTestDatabase{
  readonly raw:DatabaseSync;
  /** In memory by default; a file path opens an on-disk database, such as a backup copy. */
  constructor(target=':memory:'){this.raw=new DatabaseSync(target);}
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

export const SEED_TIME='2026-09-01T08:00:00.000Z';

/** A migrated database with one customer and one active project ('road', from 2026-08-01). */
export async function migratedDatabaseWithProject(open:SqliteTestDatabase[]):Promise<SqliteTestDatabase>{
  const database=new SqliteTestDatabase();open.push(database);
  await migrateDatabase(database as never);
  database.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','2026-08-01','${SEED_TIME}','${SEED_TIME}',0);
  `);
  return database;
}
