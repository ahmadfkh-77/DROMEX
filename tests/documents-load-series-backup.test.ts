import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {strToU8,zipSync} from 'fflate';
import {afterEach,describe,expect,it,vi} from 'vitest';

vi.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///test/'}));

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteBusinessDocumentRepository} from '../src/data/repositories/SqliteBusinessDocumentRepository';
import {SqliteDocumentSignerRepository} from '../src/data/repositories/SqliteDocumentSignerRepository';
import {SqliteLoadNumberSeriesRepository} from '../src/data/repositories/SqliteLoadNumberSeriesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {BACKUP_COUNT_TABLES} from '../src/domain/backup';
import {inclusionLabel,recordKey} from '../src/domain/businessDocuments';
import {emptyLoadDraft} from '../src/domain/loads';
import {BACKUP_ARCHIVE_FORMAT,BACKUP_ARCHIVE_VERSION,decodeBackupArchive,type BackupManifest} from '../src/services/backup/BackupArchive';
import {SEED_TIME,SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/**
 * DEC-487. Backups copy the whole SQLite file, so documents, links, settings, billing contacts, signers
 * and their history, number series, counters and issued-number history all travel with it. These tests
 * restore a real file copy and prove nothing is lost or renumbered.
 */
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';
const open:SqliteTestDatabase[]=[];const files:string[]=[];
afterEach(()=>{for(const database of open.splice(0))database.close();for(const file of files.splice(0))fs.rmSync(file,{force:true});});
function copyOf(database:SqliteTestDatabase):SqliteTestDatabase{
  const file=path.join(os.tmpdir(),`dromex-dec487-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);files.push(file);
  database.raw.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);
  const restored=new SqliteTestDatabase(file);open.push(restored);return restored;
}
const confirm=(loads:SqliteLoadRepository,itemId:string)=>loads.confirmLoad({...emptyLoadDraft,recordDate:'2026-08-10',customerId:'customer',projectId:'road',itemId,driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'direct',directQuantity:'12',directUnitId:'unit_ton',unitPriceUsd:'10'});

describe('backup and restore of documents and load number series',()=>{
  it('counts the new tables in the backup preview',()=>{
    expect(BACKUP_COUNT_TABLES).toEqual(expect.arrayContaining(['business_documents','business_document_records','document_signers','load_number_series']));
  });

  it('round-trips documents, links, snapshots, settings, contacts, signers, series, counters and load numbers',async()=>{
    const {db,supplierLoad}=await recordsDatabase(open);
    db.raw.exec(`INSERT INTO company_settings (id,company_name,logo_uri,updated_at) VALUES ('company','DROMEX','file:///test/logos/a.png','${SEED_TIME}');INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');`);
    const series=new SqliteLoadNumberSeriesRepository(db as never),loads=new SqliteLoadRepository(db as never),docs=new SqliteBusinessDocumentRepository(db as never),signers=new SqliteDocumentSignerRepository(db as never);
    await series.createSeries({prefix:'ASP',displayName:'Asphalt',itemIds:['asphalt']});
    const a=await confirm(loads,'asphalt'),b=await confirm(loads,'sand');
    await loads.cancelLoad(b.id,'Duplicate');
    const signer=await signers.createSigner({name:'رنا خوري',jobTitle:'Finance Manager',department:''});await signers.saveSignature(signer.id,[STROKE]);
    await docs.saveSettings({...await docs.getSettings(),legalName:'DROMEX SAL',bankDetails:'IBAN LB00'});
    await docs.saveBillingContact('customer','customer',{billingName:'Road Co SAL',contactPerson:'Maya',address:'Beirut',phone:'',email:'',taxRegistrationNumber:'TX-9',companyRegistrationNumber:'',notes:''});
    const invoice=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[recordKey('company_load',a.id)],selectionMethod:'manual'});
    await docs.updateDraft(invoice.id,{signer:{signerId:signer.id,display:'name_with_signature'},reference:'PO-1'});
    const issued=await docs.issueDocument(invoice.id,{issueDate:'2026-09-01'});
    const cancelled=await docs.issueDocument((await docs.createDraft({kind:'supplier_statement',partyId:'sup_a',recordKeys:[recordKey('supplier_load',supplierLoad('sand'))],selectionMethod:'manual'})).id,{issueDate:'2026-09-02'});
    await docs.cancelDocument(cancelled.id,'Wrong period');
    const draft=await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[recordKey('company_load',a.id)],selectionMethod:'manual'});

    const restored=copyOf(db);
    expect((restored.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect(restored.raw.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
    expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const after=new SqliteBusinessDocumentRepository(restored as never),afterLoads=new SqliteLoadRepository(restored as never),afterSigners=new SqliteDocumentSignerRepository(restored as never),afterSeries=new SqliteLoadNumberSeriesRepository(restored as never);

    expect(await after.getDocument(issued.id)).toEqual({...issued,payment:expect.anything()});
    expect((await after.getDocument(issued.id)).signer).toEqual({signerId:signer.id,name:'رنا خوري',jobTitle:'Finance Manager',department:null,display:'name_with_signature',signature:[STROKE]});
    expect((await after.getDocument(issued.id)).logoUri).toBe('file:///test/logos/a.png');
    expect(await after.getDocument(cancelled.id)).toMatchObject({status:'Cancelled',cancellationReason:'Wrong period',documentNumber:'SST-2026-001'});
    expect((await after.getDocument(draft.id)).status).toBe('Draft');
    expect(inclusionLabel((await after.listEligibleRecords({side:'customer'})).find(value=>value.key===recordKey('company_load',a.id))!.inclusion)).toBe('Included in INV-2026-001');
    expect(await after.getSettings()).toMatchObject({legalName:'DROMEX SAL',bankDetails:'IBAN LB00',nextNumbers:{customer_invoice:2,supplier_statement:2}});
    expect(await after.getBillingContact('customer','customer')).toMatchObject({saved:true,billingName:'Road Co SAL',taxRegistrationNumber:'TX-9'});
    expect((await afterSigners.listEvents(signer.id)).map(value=>value.event)).toEqual(['created','signature_changed','used']);
    expect((await afterLoads.listLoads()).map(load=>[load.loadNumber,load.status]).sort()).toEqual([['ASP-00001','Active'],['LOAD-00001','Cancelled']]);
    expect((await afterSeries.listSeries(2026)).map(value=>[value.prefix,value.nextNumber,value.issuedCount,value.prefixLocked])).toEqual([['LOAD','LOAD-00002',1,true],['ASP','ASP-00002',1,true]]);
  });

  it('keeps numbering after a restore: no number or document number is ever reused, and the guards still hold',async()=>{
    const {db}=await recordsDatabase(open);
    db.raw.exec(`INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');`);
    const loads=new SqliteLoadRepository(db as never),docs=new SqliteBusinessDocumentRepository(db as never);
    const first=await confirm(loads,'sand');
    await docs.issueDocument((await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[recordKey('company_load',first.id)],selectionMethod:'manual'})).id,{issueDate:'2026-09-01'});
    const restored=copyOf(db);
    const afterLoads=new SqliteLoadRepository(restored as never),afterDocs=new SqliteBusinessDocumentRepository(restored as never);
    const next=await confirm(afterLoads,'sand');
    expect(next.loadNumber).toBe('LOAD-00002');
    expect((await afterDocs.issueDocument((await afterDocs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[recordKey('company_load',next.id)],selectionMethod:'manual'})).id,{issueDate:'2026-09-03'})).documentNumber).toBe('INV-2026-002');
    expect(()=>restored.raw.prepare("UPDATE loads SET load_number='LOAD-2026-999' WHERE id=?").run(first.id)).toThrow(/load number cannot change/);
    await expect(afterDocs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[recordKey('company_load',first.id)],selectionMethod:'manual'})).rejects.toThrow('already included in INV-2026-001');
  });

  it('carries the issued-document logo file in the archive media allow-list',()=>{
    const header=new Uint8Array(100);header.set(strToU8('SQLite format 3'));
    const build=(table:string,column:string)=>{
      const manifest:BackupManifest={format:BACKUP_ARCHIVE_FORMAT,formatVersion:BACKUP_ARCHIVE_VERSION,backupId:'b',createdAt:SEED_TIME,appVersion:'0.19.0',databaseVersion:48,recordCounts:{},preferenceCount:0,media:[{table,recordId:'doc',column,jsonIndex:null,archivePath:'media/logo.png'}]};
      return zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'database.sqlite':header,'preferences.json':strToU8('[]'),'media/logo.png':Uint8Array.from([1,2,3])});
    };
    expect(decodeBackupArchive(build('business_documents','logo_uri')).manifest.media[0]).toMatchObject({table:'business_documents',column:'logo_uri'});
    expect(()=>decodeBackupArchive(build('business_documents','signer_json'))).toThrow();
  });
});
