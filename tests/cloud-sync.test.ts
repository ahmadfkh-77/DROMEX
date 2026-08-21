import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///test/',FileSystemUploadType:{BINARY_CONTENT:0}}));
vi.mock('expo-secure-store',()=>({getItemAsync:vi.fn(),setItemAsync:vi.fn(),deleteItemAsync:vi.fn(),AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:1}));
import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteCloudRepository} from '../src/data/repositories/SqliteCloudRepository';
import type {CloudRecord,CloudSession} from '../src/domain/cloud';

class TestDatabase{
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null)as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[])as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}

const session:CloudSession={uid:'owner-1',email:'owner@example.com',emailVerified:true,idToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3_600_000};
class MemorySessions{value:CloudSession|null=null;async get(){return this.value;}async set(value:CloudSession){this.value=value;}async clear(){this.value=null;}}
class FakeGateway{
  readonly records=new Map<string,CloudRecord>();
  failWrites=false;
  refreshError='';readonly devices=new Set<string>();async signIn(){return session;}async refresh(value:CloudSession){if(this.refreshError)throw new Error(this.refreshError);return value;}async lookup(value:CloudSession){return value;}async sendPasswordReset(){}async sendEmailVerification(){}async registerDevice(_uid:string,deviceId:string){this.devices.add(deviceId);}async uploadFile(){}async downloadFile(){}
  async hasRecords(){return this.records.size>0;}async getRecord(_uid:string,key:string){return this.records.get(key)??null;}
  async putRecord(_uid:string,record:Omit<CloudRecord,'cloudUpdatedAt'>){if(this.failWrites)throw new Error('network unavailable');this.records.set(record.key,{...record,cloudUpdatedAt:new Date(Date.now()+this.records.size+1).toISOString()});}
  async listChanges(_uid:string,after:string){return[...this.records.values()].filter(value=>value.cloudUpdatedAt>after).sort((a,b)=>a.cloudUpdatedAt.localeCompare(b.cloudUpdatedAt));}
}

describe('account and cloud synchronization',()=>{
  const databases:TestDatabase[]=[];afterEach(()=>{for(const database of databases.splice(0))database.close();});
  async function setup(){const database=new TestDatabase();databases.push(database);await migrateDatabase(database as never);const gateway=new FakeGateway();const sessions=new MemorySessions();const repository=new SqliteCloudRepository(database as never,gateway as never,sessions,{apiKey:'api',projectId:'project',storageBucket:'bucket'});return{database,gateway,sessions,repository};}

  it('requires the confirmed owner password length and persists a verified session',async()=>{const{repository}=await setup();await expect(repository.signIn('owner@example.com','short')).rejects.toThrow('12 characters');const value=await repository.signIn('owner@example.com','a-secure-password');expect(value).toMatchObject({configured:true,signedIn:true,emailVerified:true,email:'owner@example.com'});});

  it('uploads the complete first-device snapshot and clears the durable outbox',async()=>{const{database,gateway,repository}=await setup();database.raw.prepare("INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer-cloud','company','Cloud Customer',0,1,'2026-08-19T10:00:00.000Z','2026-08-19T10:00:00.000Z')").run();await repository.signIn('owner@example.com','a-secure-password');const result=await repository.synchronize();expect(result.pendingCount).toBe(0);expect(result.lastSyncAt).toBeTruthy();expect(gateway.devices.size).toBe(1);expect(gateway.records.get('customers~customer-cloud')?.row).toMatchObject({name:'Cloud Customer'});expect(database.raw.prepare("SELECT initial_upload_complete FROM cloud_sync_state WHERE id='cloud'").get()).toMatchObject({initial_upload_complete:1});});

  it('keeps the newest cloud edit when an older local change is pending',async()=>{const{database,gateway,repository}=await setup();database.raw.prepare("INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer-conflict','company','Older Local Name',0,1,'2026-08-18T10:00:00.000Z','2026-08-18T10:00:00.000Z')").run();database.raw.prepare("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES ('customer','customer-conflict','upsert','{}','2026-08-18T10:00:00.000Z')").run();gateway.records.set('customers~customer-conflict',{key:'customers~customer-conflict',table:'customers',recordId:'customer-conflict',row:{id:'customer-conflict',customer_type:'company',name:'Newest Cloud Name',phone:null,email:null,address:null,tax_vat_number:null,notes:null,is_own_company:0,is_active:1,merged_into_id:null,created_at:'2026-08-18T10:00:00.000Z',updated_at:'2026-08-19T10:00:00.000Z'},tombstone:false,clientModifiedAt:'2026-08-19T10:00:00.000Z',cloudUpdatedAt:'2026-08-19T10:00:01.000Z',deviceId:'other-device'});await repository.signIn('owner@example.com','a-secure-password');await repository.synchronize();expect(database.raw.prepare("SELECT name FROM customers WHERE id='customer-conflict'").get()).toMatchObject({name:'Newest Cloud Name'});expect(database.raw.prepare('SELECT COUNT(*) count FROM sync_outbox').get()).toMatchObject({count:0});});

  it('retains queued data and exposes an offline retry state after a failed transfer',async()=>{const{database,gateway,repository}=await setup();database.raw.prepare("INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer-pending','company','Pending Customer',0,1,'2026-08-19T10:00:00.000Z','2026-08-19T10:00:00.000Z')").run();await repository.signIn('owner@example.com','a-secure-password');gateway.failWrites=true;await expect(repository.synchronize()).rejects.toThrow('network unavailable');const snapshot=await repository.getSnapshot();expect(snapshot.phase).toBe('offline');expect(snapshot.pendingCount).toBeGreaterThan(0);expect(database.raw.prepare("SELECT COUNT(*) count FROM sync_outbox WHERE last_error='network unavailable'").get()).toMatchObject({count:1});});

  it('clears a remotely revoked owner session when Firebase rejects its refresh token',async()=>{const{gateway,sessions,repository}=await setup();sessions.value={...session,expiresAt:0};gateway.refreshError='invalid refresh token';await expect(repository.refreshAccount()).rejects.toThrow('invalid refresh token');expect((await repository.getSnapshot()).signedIn).toBe(false);});
});
