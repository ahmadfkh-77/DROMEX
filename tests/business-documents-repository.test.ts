import {afterEach,describe,expect,it} from 'vitest';

import {SqliteBusinessDocumentRepository} from '../src/data/repositories/SqliteBusinessDocumentRepository';
import {SqliteDocumentSignerRepository} from '../src/data/repositories/SqliteDocumentSignerRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {inclusionLabel,recordKey} from '../src/domain/businessDocuments';
import {SEED_TIME,type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/** DEC-500 (2)-(4). Drafts, issue, cancellation, immutable snapshots and the one shared link model. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';
const L=(id:string)=>recordKey('company_load',id);
const Q=(id:string)=>recordKey('supplier_load',id);

async function setup(){
  const fixture=await recordsDatabase(databases);
  fixture.db.raw.exec(`INSERT INTO company_settings (id,company_name,address,phone,tax_vat_number,updated_at) VALUES ('company','DROMEX Plant','Aley','01 234','VAT-77','${SEED_TIME}')`);
  return {...fixture,docs:new SqliteBusinessDocumentRepository(fixture.db as never),signers:new SqliteDocumentSignerRepository(fixture.db as never),loads:new SqliteLoadRepository(fixture.db as never)};
}
const count=(db:SqliteTestDatabase,sql:string)=>(db.raw.prepare(sql).get() as {n:number}).n;

describe('eligible records',()=>{
  it('lists only a customer’s Active, non-archived company loads in the range, each with its snapshot and status',async()=>{
    const {docs,companyLoad}=await setup();
    const a=companyLoad('sand',{day:'2026-08-10',priceCents:1500,vatBasisPoints:1100,loadNumber:'LOAD-2026-001'});
    companyLoad('sand',{day:'2026-08-11',status:'Cancelled'});
    companyLoad('sand',{day:'2026-08-12',archived:1});
    companyLoad('sand',{day:'2026-08-13',customer:'cust_b'});
    companyLoad('sand',{day:'2026-09-20'});
    const rows=await docs.listEligibleRecords({side:'customer',partyId:'customer',fromDate:'2026-08-01',toDate:'2026-08-31'});
    expect(rows.map(row=>row.key)).toEqual([L(a)]);
    expect(rows[0]).toMatchObject({inclusion:{state:'not_included'},snapshot:{reference:'TX-1',loadNumber:'LOAD-2026-001',itemName:'Sand',unitSymbol:'t',quantity:10,projectName:'Mountain Road',partyName:'Road Co',unitPriceCents:1500,subtotalCents:15000,vatCents:1650,totalCents:16650}});
  });

  it('lists a supplier’s Supplier Loads with the supplier ticket',async()=>{
    const {docs,supplierLoad}=await setup();
    const q=supplierLoad('gravel',{supplier:'sup_b',ticket:'T-88',priceCents:2000});
    supplierLoad('gravel',{supplier:'sup_a'});
    const rows=await docs.listEligibleRecords({side:'supplier',partyId:'sup_b'});
    expect(rows.map(row=>row.key)).toEqual([Q(q)]);
    expect(rows[0]!.snapshot).toMatchObject({recordType:'supplier_load',supplierReference:'T-88',loadNumber:null,partyName:'Beta Quarry',unitSymbol:'m³',quantity:8,priceBasis:'per_unit'});
  });

  it('reads without writing anything',async()=>{
    const {db,docs,companyLoad}=await setup();
    companyLoad('sand');
    await docs.listEligibleRecords({side:'customer'});
    await docs.inclusionFor([L('l1')]);
    expect(count(db,'SELECT COUNT(*) n FROM business_document_records')).toBe(0);
    expect(count(db,'SELECT COUNT(*) n FROM sync_outbox')).toBe(0);
  });
});

describe('drafts',()=>{
  it('creates a numbered draft that every view then reads as In draft',async()=>{
    const {docs,companyLoad}=await setup();
    const a=companyLoad('sand'),b=companyLoad('gravel');
    const draft=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a),L(b)],selectionMethod:'manual'});
    expect(draft).toMatchObject({status:'Draft',draftNumber:'DRAFT-1',documentNumber:null,partyName:'Road Co',kind:'customer_invoice'});
    expect(draft.records.map(record=>record.key)).toEqual([L(a),L(b)]);
    const links=await docs.inclusionFor([L(a)]);
    expect(links[L(a)]).toEqual([expect.objectContaining({status:'Draft',draftNumber:'DRAFT-1',kind:'customer_invoice'})]);
    expect((await docs.listEligibleRecords({side:'customer'})).map(row=>inclusionLabel(row.inclusion))).toEqual(['In draft DRAFT-1','In draft DRAFT-1']);
  });

  it('rejects a record of another party, a cancelled record, the wrong record type, or one outside a date-range selection',async()=>{
    const {docs,companyLoad,supplierLoad}=await setup();
    const other=companyLoad('sand',{customer:'cust_b'}),cancelled=companyLoad('sand',{status:'Cancelled'}),late=companyLoad('sand',{day:'2026-09-15'}),supplier=supplierLoad('sand');
    await expect(docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(other)],selectionMethod:'manual'})).rejects.toThrow('TX-1 belongs to Beirut Builders, not Road Co.');
    await expect(docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(cancelled)],selectionMethod:'manual'})).rejects.toThrow('TX-2 is cancelled and cannot be included.');
    await expect(docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[Q(supplier)],selectionMethod:'manual'})).rejects.toThrow('An invoice can only include company loads.');
    await expect(docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(late)],selectionMethod:'date_range',periodFrom:'2026-08-01',periodTo:'2026-08-31'})).rejects.toThrow('TX-3 is outside 2026-08-01 to 2026-08-31.');
    await expect(docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[],selectionMethod:'manual'})).rejects.toThrow('Select at least one record.');
  });

  it('removes records before issue and keeps the draft',async()=>{
    const {docs,companyLoad}=await setup();
    const a=companyLoad('sand'),b=companyLoad('gravel');
    const draft=await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(a),L(b)],selectionMethod:'manual'});
    const after=await docs.removeRecordsFromDraft(draft.id,[L(b)]);
    expect(after.records.map(record=>record.key)).toEqual([L(a)]);
    expect((await docs.inclusionFor([L(b)]))[L(b)]).toEqual([]);
  });

  it('discards a draft by cancelling it, without consuming a document number',async()=>{
    const {docs,companyLoad}=await setup();
    const a=companyLoad('sand');
    const draft=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'});
    const discarded=await docs.cancelDocument(draft.id,'Started by mistake');
    expect(discarded).toMatchObject({status:'Cancelled',documentNumber:null,cancellationReason:'Started by mistake'});
    expect((await docs.listEligibleRecords({side:'customer'}))[0]!.inclusion).toEqual({state:'not_included'});
    const next=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'});
    expect((await docs.issueDocument(next.id,{issueDate:'2026-09-01'})).documentNumber).toBe('INV-2026-001');
  });
});

describe('issuing',()=>{
  it('assigns the kind’s number by issue year and marks the records Included everywhere',async()=>{
    const {db,docs,companyLoad}=await setup();
    const a=companyLoad('sand',{priceCents:1500,vatBasisPoints:1100}),b=companyLoad('sand',{quantity:5,unit:'m³'});
    const draft=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a),L(b)],selectionMethod:'manual'});
    const issued=await docs.issueDocument(draft.id,{issueDate:'2026-09-01'});
    expect(issued).toMatchObject({status:'Issued',documentNumber:'INV-2026-001',issueDate:'2026-09-01'});
    expect(issued.groups.quantityByUnit).toEqual([{unitKey:'unit_m3',unitSymbol:'m³',quantity:5,recordCount:1},{unitKey:'unit_ton',unitSymbol:'t',quantity:10,recordCount:1}]);
    expect(issued.groups.money).toEqual({subtotalCents:15000,vatCents:1650,totalCents:16650,pricedCount:1,unpricedCount:1});
    expect(db.raw.prepare('SELECT DISTINCT document_status,issue_date FROM business_document_records').all()).toEqual([{document_status:'Issued',issue_date:'2026-09-01'}]);
    expect((await docs.listEligibleRecords({side:'customer'})).map(row=>inclusionLabel(row.inclusion))).toEqual(['Included in INV-2026-001','Included in INV-2026-001']);
    const statement=await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'});
    expect((await docs.issueDocument(statement.id,{issueDate:'2026-09-02'})).documentNumber).toBe('CST-2026-001');
  });

  it('keeps an Issued document unchanged after the source load is corrected and settings change',async()=>{
    const {db,docs,loads,companyLoad}=await setup();
    const a=companyLoad('sand',{priceCents:1500});
    const draft=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'});
    const issued=await docs.issueDocument(draft.id,{issueDate:'2026-09-01'});
    await loads.correctLoad(a,{requestedQuantityKg:'',emptyWeightKg:'',fullWeightKg:'',directQuantity:'99',unitPriceUsd:'20',destinationAddress:'',notes:'',correctionReason:'Re-weighed'});
    db.raw.exec("UPDATE company_settings SET company_name='Renamed'; UPDATE customers SET name='Road Company SAL' WHERE id='customer'");
    const again=await docs.getDocument(issued.id);
    expect(again.records[0]!.snapshot).toMatchObject({quantity:10,unitPriceCents:1500,partyName:'Road Co'});
    expect(again.issuer?.name).toBe('DROMEX Plant');
    expect(again.recipient?.name).toBe('Road Co');
    expect(again.groups).toEqual(issued.groups);
  });

  it('keeps the company logo file it was issued with, while a draft previews the current one',async()=>{
    const {db,docs,companyLoad}=await setup();
    db.raw.exec("UPDATE company_settings SET logo_uri='file:///logos/old.png'");
    const draft=await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'});
    expect((await docs.getDocument(draft.id)).logoUri).toBe('file:///logos/old.png');
    await docs.issueDocument(draft.id,{issueDate:'2026-09-01'});
    db.raw.exec("UPDATE company_settings SET logo_uri='file:///logos/new.png'");
    expect((await docs.getDocument(draft.id)).logoUri).toBe('file:///logos/old.png');
  });

  it('reads a draft live, so a correction before issue is reflected and frozen at issue',async()=>{
    const {docs,loads,companyLoad}=await setup();
    const a=companyLoad('sand',{priceCents:1500});
    const draft=await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'});
    await loads.correctLoad(a,{requestedQuantityKg:'',emptyWeightKg:'',fullWeightKg:'',directQuantity:'12',unitPriceUsd:'15',destinationAddress:'',notes:'',correctionReason:'Ticket'});
    expect((await docs.getDocument(draft.id)).records[0]!.snapshot.quantity).toBe(12);
    expect((await docs.issueDocument(draft.id,{issueDate:'2026-09-01'})).records[0]!.snapshot.quantity).toBe(12);
  });

  it('refuses to issue when a record became cancelled, and changes nothing',async()=>{
    const {db,docs,loads,companyLoad}=await setup();
    const a=companyLoad('sand');
    const draft=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'});
    await loads.cancelLoad(a,'Duplicate');
    await expect(docs.issueDocument(draft.id,{issueDate:'2026-09-01'})).rejects.toThrow('TX-1 is cancelled and cannot be included. Remove it from the draft first.');
    expect((await docs.getDocument(draft.id)).status).toBe('Draft');
    expect(count(db,'SELECT COUNT(*) n FROM business_document_counters WHERE prefix_key=\'INV\'')).toBe(0);
  });

  it('never lets one record be in two Issued documents of the same kind',async()=>{
    const {docs,companyLoad}=await setup();
    const a=companyLoad('sand'),b=companyLoad('gravel');
    const first=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'});
    const second=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a),L(b)],selectionMethod:'manual'});
    await docs.issueDocument(first.id,{issueDate:'2026-09-01'});
    await expect(docs.issueDocument(second.id,{issueDate:'2026-09-01'})).rejects.toThrow('TX-1 is already included in INV-2026-001. Remove it from the draft first.');
    await expect(docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'})).rejects.toThrow('TX-1 is already included in INV-2026-001.');
    expect((await docs.getDocument(second.id)).status).toBe('Draft');
  });

  it('accepts a unique Official number override and keeps automatic numbers clear of it',async()=>{
    const {docs,companyLoad}=await setup();
    const make=async()=>docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'});
    expect((await docs.issueDocument((await make()).id,{issueDate:'2026-09-01',documentNumber:'INV-2026-002'})).documentNumber).toBe('INV-2026-002');
    await expect(docs.issueDocument((await make()).id,{issueDate:'2026-09-01',documentNumber:'INV-2026-002'})).rejects.toThrow('Document number INV-2026-002 is already used.');
    expect((await docs.issueDocument((await make()).id,{issueDate:'2026-09-01'})).documentNumber).toBe('INV-2026-003');
    const statement=await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'});
    await expect(docs.issueDocument(statement.id,{issueDate:'2026-09-01',documentNumber:'X-1'})).rejects.toThrow('Only an Official Bill / Invoice can override its number.');
  });

  it('will not issue an Official invoice without a business name, but an Internal statement still works',async()=>{
    const {db,docs,companyLoad}=await setup();
    db.raw.exec("DELETE FROM company_settings");
    const invoice=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'});
    await expect(docs.issueDocument(invoice.id,{issueDate:'2026-09-01'})).rejects.toThrow('Business name is not configured. Add it in Business Document Settings, or issue an Internal statement.');
    const statement=await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'});
    await expect(docs.issueDocument(statement.id,{issueDate:'2026-09-01'})).resolves.toMatchObject({status:'Issued'});
  });

  it('snapshots the signer, records the use, and is unaffected by later signer changes',async()=>{
    const {docs,signers,companyLoad}=await setup();
    const signer=await signers.createSigner({name:'Rana Haddad',jobTitle:'Finance Manager',department:''});
    await signers.saveSignature(signer.id,[STROKE]);
    const draft=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'});
    await docs.updateDraft(draft.id,{signer:{signerId:signer.id,display:'name_with_signature'}});
    const issued=await docs.issueDocument(draft.id,{issueDate:'2026-09-01'});
    await signers.updateSigner(signer.id,{name:'Rana H.',jobTitle:'CFO',department:''});
    await signers.saveSignature(signer.id,['M 1 1 L 2 2']);
    await signers.setSignerActive(signer.id,false);
    expect((await docs.getDocument(issued.id)).signer).toEqual({signerId:signer.id,name:'Rana Haddad',jobTitle:'Finance Manager',department:null,display:'name_with_signature',signature:[STROKE]});
    expect((await signers.listEvents(signer.id)).map(value=>value.event)).toContain('used');
  });

  it('uses per-document overrides over saved settings and billing contacts',async()=>{
    const {docs,companyLoad}=await setup();
    await docs.saveSettings({...await docs.getSettings(),legalName:'DROMEX Plant SAL',bankDetails:'IBAN LB00 0000',paymentTerms:'Net 30'});
    await docs.saveBillingContact('customer','customer',{billingName:'Road Co SAL',contactPerson:'Maya',address:'Beirut',phone:'',email:'ap@road.example',taxRegistrationNumber:'TX-9',companyRegistrationNumber:'',notes:''});
    const draft=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'});
    await docs.updateDraft(draft.id,{reference:'PO-77',dueDate:'2026-10-01',termsOverride:{paymentTerms:'Net 15'}});
    const issued=await docs.issueDocument(draft.id,{issueDate:'2026-09-01'});
    expect(issued.issuer).toMatchObject({name:'DROMEX Plant SAL',address:'Aley',taxRegistrationNumber:'VAT-77'});
    expect(issued.recipient).toMatchObject({name:'Road Co SAL',contactPerson:'Maya',email:'ap@road.example',taxRegistrationNumber:'TX-9'});
    expect(issued.terms).toEqual({currency:'USD',paymentTerms:'Net 15',bankDetails:'IBAN LB00 0000',footerNote:null});
    expect(issued).toMatchObject({reference:'PO-77',dueDate:'2026-10-01'});
  });
});

describe('cancellation and re-inclusion',()=>{
  it('requires a reason, keeps history, and frees the records for a new document',async()=>{
    const {db,docs,companyLoad}=await setup();
    const a=companyLoad('sand');
    const first=await docs.issueDocument((await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'})).id,{issueDate:'2026-09-01'});
    await expect(docs.cancelDocument(first.id,'  ')).rejects.toThrow('A cancellation reason is required.');
    const cancelled=await docs.cancelDocument(first.id,'Wrong customer reference');
    expect(cancelled).toMatchObject({status:'Cancelled',documentNumber:'INV-2026-001',cancellationReason:'Wrong customer reference'});
    expect(cancelled.history.map(entry=>entry.status)).toEqual(['Draft','Issued','Cancelled']);
    expect(inclusionLabel((await docs.listEligibleRecords({side:'customer'}))[0]!.inclusion)).toBe('Previously included in cancelled INV-2026-001');
    const second=await docs.issueDocument((await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'})).id,{issueDate:'2026-09-03'});
    expect(second.documentNumber).toBe('INV-2026-002');
    expect(count(db,"SELECT COUNT(*) n FROM business_documents")).toBe(2);
    await expect(docs.cancelDocument(first.id,'again')).rejects.toThrow('This document is already cancelled.');
  });

  it('writes a sync_outbox audit entry for each create, issue and cancel',async()=>{
    const {db,docs,companyLoad}=await setup();
    const draft=await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'});
    await docs.issueDocument(draft.id,{issueDate:'2026-09-01'});
    await docs.cancelDocument(draft.id,'Reissue');
    expect(db.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='businessDocument'").all().map(row=>JSON.parse((row as {payload_json:string}).payload_json).action)).toEqual(['created','issued','cancelled']);
  });
});

describe('document lists and live payment status',()=>{
  it('filters by party, status, project, item and number',async()=>{
    const {docs,companyLoad,supplierLoad}=await setup();
    const sand=companyLoad('sand',{project:'road'}),gravel=companyLoad('gravel',{project:'other'});
    const a=await docs.issueDocument((await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(sand)],selectionMethod:'manual'})).id,{issueDate:'2026-09-01'});
    const b=await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(gravel)],selectionMethod:'manual'});
    const bill=await docs.createDraft({kind:'supplier_bill',partyId:'sup_a',recordKeys:[Q(supplierLoad('sand'))],selectionMethod:'manual'});
    expect((await docs.listDocuments({partyType:'customer',partyId:'customer'})).map(value=>value.id).sort()).toEqual([a.id,b.id].sort());
    expect((await docs.listDocuments({status:'Draft'})).map(value=>value.id).sort()).toEqual([b.id,bill.id].sort());
    expect((await docs.listDocuments({projectId:'other'})).map(value=>value.id)).toEqual([b.id]);
    expect((await docs.listDocuments({itemKey:'id:sand'})).map(value=>value.id).sort()).toEqual([a.id,bill.id].sort());
    expect((await docs.listDocuments({search:'inv-2026'})).map(value=>value.id)).toEqual([a.id]);
    expect((await docs.listDocuments({partyType:'supplier'}))[0]).toMatchObject({kind:'supplier_bill',partyName:'Alpha Quarry',recordCount:1});
  });

  it('reads payment status live from existing payments and marks overdue documents',async()=>{
    const {db,docs,companyLoad}=await setup();
    const a=companyLoad('sand',{priceCents:1000,quantity:10});
    const draft=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(a)],selectionMethod:'manual'});
    await docs.updateDraft(draft.id,{dueDate:'2026-09-10'});
    const issued=await docs.issueDocument(draft.id,{issueDate:'2026-09-01'});
    expect((await docs.getDocument(issued.id,'2026-09-05')).payment).toEqual({status:'Unpaid',owedCents:10000,paidCents:0,overdue:false});
    db.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,created_at) VALUES ('p1','load','${a}',4000,'2026-09-02','${SEED_TIME}')`);
    expect((await docs.getDocument(issued.id,'2026-09-20')).payment).toEqual({status:'Partially paid',owedCents:10000,paidCents:4000,overdue:true});
    expect((await docs.listDocuments({paymentStatus:'Partially paid'},'2026-09-20')).map(value=>value.id)).toEqual([issued.id]);
  });

  it('says No amount recorded when nothing linked is priced',async()=>{
    const {docs,companyLoad}=await setup();
    const issued=await docs.issueDocument((await docs.createDraft({kind:'customer_statement',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'})).id,{issueDate:'2026-09-01'});
    expect((await docs.getDocument(issued.id)).payment).toEqual({status:'No amount recorded',owedCents:null,paidCents:0,overdue:false});
  });
});

describe('settings',()=>{
  it('saves business details, refuses moving a number sequence backwards, and validates prefixes',async()=>{
    const {docs,companyLoad}=await setup();
    await docs.issueDocument((await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'})).id,{issueDate:'2026-09-01'});
    const settings=await docs.getSettings(2026);
    expect(settings).toMatchObject({legalName:null,currencyCode:'USD',prefixes:{customer_invoice:'INV',supplier_bill:'BILL',customer_statement:'CST',supplier_statement:'SST'},nextNumbers:{customer_invoice:2,supplier_bill:1}});
    await expect(docs.setNextDocumentNumber('customer_invoice',2026,1)).rejects.toThrow('The next number cannot be lower than 2, or numbers would repeat.');
    await docs.setNextDocumentNumber('customer_invoice',2026,50);
    await expect(docs.saveSettings({...settings,prefixes:{...settings.prefixes,customer_invoice:'in1'}})).rejects.toThrow('A prefix must be 2 to 6 letters A–Z.');
    const draft=await docs.createDraft({kind:'customer_invoice',partyId:'customer',recordKeys:[L(companyLoad('sand'))],selectionMethod:'manual'});
    expect((await docs.issueDocument(draft.id,{issueDate:'2026-09-01'})).documentNumber).toBe('INV-2026-050');
  });

  it('returns a billing contact pre-filled from the saved profile until one is saved',async()=>{
    const {db,docs}=await setup();
    db.raw.exec("UPDATE suppliers SET phone='03 111', address='Zahle' WHERE id='sup_a'");
    expect(await docs.getBillingContact('supplier','sup_a')).toMatchObject({saved:false,billingName:'Alpha Quarry',phone:'03 111',address:'Zahle'});
  });
});
