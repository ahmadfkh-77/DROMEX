import type {SQLiteDatabase} from 'expo-sqlite';

import {
  deriveInclusion,documentKindInfo,documentKinds,formatDocumentNumber,groupDocumentLines,matchesInclusionFilter,recordKey,validateDocumentNumber,validateDocumentPrefix,
  type BillingContact,type BillingContactDraft,type BusinessDocument,type CreateDraftInput,type DocumentHistoryEntry,type DocumentKind,type DocumentLineGroups,type DocumentLink,
  type DocumentListFilter,type DocumentPayment,type DocumentRecordProblem,type DocumentSettings,type DocumentSettingsDraft,type DocumentSide,type DocumentStatus,
  type DocumentSummary,type DocumentTerms,type DraftDetails,type EligibleRecord,type EligibleRecordQuery,type IssueInput,type PartyBlock,type RecordSnapshot,
  type SelectionMethod,type SignerSelection,
} from '../../domain/businessDocuments';
import {signerSnapshot,type SignerSnapshot} from '../../domain/documentSigners';
import type {BusinessDocumentRepository} from './BusinessDocumentRepository';
import {recordSignerEvent,signerFromRow} from './SqliteDocumentSignerRepository';
import {COMPANY_LOAD_RECORDS,SUPPLIER_LOAD_RECORDS,snapshotFromRow,type RecordRow} from './recordSnapshotSql';

type DocumentRow={
  id:string;kind:DocumentKind;party_type:DocumentSide;customer_id:string|null;supplier_id:string|null;party_name:string;status:DocumentStatus;draft_number:string;document_number:string|null;
  period_from:string|null;period_to:string|null;selection_method:SelectionMethod;issue_date:string|null;due_date:string|null;reference:string|null;notes:string|null;
  issuer_json:string|null;recipient_json:string|null;terms_json:string|null;signer_json:string|null;totals_json:string|null;logo_uri:string|null;status_history_json:string;
  issued_at:string|null;cancelled_at:string|null;cancellation_reason:string|null;created_at:string;updated_at:string;
};
type LinkRow={record_key:string;snapshot_json:string;position:number};
type SettingsRow={legal_name:string|null;trading_name:string|null;address:string|null;phone:string|null;email:string|null;website:string|null;tax_registration_number:string|null;company_registration_number:string|null;currency_code:string|null;bank_details:string|null;payment_terms:string|null;footer_note:string|null;customer_invoice_prefix:string;supplier_bill_prefix:string;customer_statement_prefix:string;supplier_statement_prefix:string};
type CompanyRow={company_name:string|null;address:string|null;phone:string|null;email:string|null;tax_vat_number:string|null};
type ProfileRow={name:string;phone:string|null;email:string|null;address:string|null;tax_vat_number:string|null};
type ContactRow={billing_name:string|null;contact_person:string|null;address:string|null;phone:string|null;email:string|null;tax_registration_number:string|null;company_registration_number:string|null;notes:string|null};
/** Draft-time storage of the signer choice; replaced by the full SignerSnapshot on issue. */
type StoredSigner={selection:SignerSelection}|SignerSnapshot;

const prefixColumn:Record<DocumentKind,keyof SettingsRow>={customer_invoice:'customer_invoice_prefix',supplier_bill:'supplier_bill_prefix',customer_statement:'customer_statement_prefix',supplier_statement:'supplier_statement_prefix'};
const makeId=()=>`document_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
const text=(value:string|null|undefined)=>{const next=(value??'').trim().replace(/[ \t]+/g,' ');return next||null;};
const parse=<T>(json:string|null,fallback:T):T=>{if(!json)return fallback;try{return JSON.parse(json) as T;}catch{return fallback;}};
const localToday=()=>{const value=new Date();return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;};
const validDate=(value:string)=>{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));return date.getFullYear()===Number(match[1])&&date.getMonth()===Number(match[2])-1&&date.getDate()===Number(match[3]);};
const emptyBlock=():PartyBlock=>({name:null,tradingName:null,contactPerson:null,address:null,phone:null,email:null,website:null,taxRegistrationNumber:null,companyRegistrationNumber:null});
/** Applies overrides: a provided value (even an emptied one) wins over the default. */
const merge=<T extends object>(base:T,override:Partial<T>|null|undefined):T=>{const result={...base};for(const [key,value] of Object.entries(override??{}))(result as Record<string,unknown>)[key]=typeof value==='string'?text(value):value??null;return result;};
const article=(label:string)=>`${/^[aeiou]/i.test(label)?'An':'A'} ${label.toLocaleLowerCase('en-US')}`;
const chunk=<T>(values:readonly T[],size=400)=>{const chunks:T[][]=[];for(let index=0;index<values.length;index+=size)chunks.push(values.slice(index,index+size));return chunks;};

/**
 * DEC-500 (3). The one place inclusion status is read from, for every screen: the document links of
 * each record. Every key asked for is present in the result, with [] when the record is unlinked.
 */
export async function readDocumentLinks(db:SQLiteDatabase,keys:readonly string[]):Promise<Record<string,DocumentLink[]>>{
  const result:Record<string,DocumentLink[]>=Object.fromEntries(keys.map(key=>[key,[]]));
  for(const part of chunk([...new Set(keys)])){
    if(!part.length)continue;
    const rows=await db.getAllAsync<{record_key:string;id:string;kind:DocumentKind;status:DocumentStatus;draft_number:string;document_number:string|null;issue_date:string|null}>(
      `SELECT r.record_key, d.id, d.kind, d.status, d.draft_number, d.document_number, d.issue_date FROM business_document_records r JOIN business_documents d ON d.id = r.document_id
       WHERE r.record_key IN (${part.map(()=>'?').join(',')}) ORDER BY d.created_at, d.id`,...part);
    for(const row of rows)result[row.record_key]!.push({documentId:row.id,kind:row.kind,status:row.status,draftNumber:row.draft_number,documentNumber:row.document_number,issueDate:row.issue_date});
  }
  return result;
}

/**
 * DEC-500 (2)-(4). Business documents and the shared document-to-record links.
 *
 * Every read of inclusion status goes through `inclusionFor`, which reads only the link rows; no other
 * table carries an inclusion flag. Issuing happens in one transaction that re-reads every record,
 * refuses anything cancelled, archived or already in another Issued document of the same kind, freezes
 * the snapshots, and only then consumes a number. A partial unique index on the link table is the
 * database-level guarantee behind the same rule.
 */
export class SqliteBusinessDocumentRepository implements BusinessDocumentRepository{
  constructor(private readonly db:SQLiteDatabase){}

  // ---- Settings and contacts -------------------------------------------------------------------

  async getSettings(year=new Date().getFullYear()):Promise<DocumentSettings>{
    const [row,company]=await Promise.all([this.settingsRow(),this.db.getFirstAsync<CompanyRow>('SELECT company_name,address,phone,email,tax_vat_number FROM company_settings WHERE id=?','company')]);
    const prefixes=Object.fromEntries(documentKinds.map(kind=>[kind,String(row[prefixColumn[kind]])])) as Record<DocumentKind,string>;
    const nextNumbers={} as Record<DocumentKind,number>;
    for(const kind of documentKinds)nextNumbers[kind]=await this.nextNumber(prefixes[kind],year);
    return {
      legalName:row.legal_name,tradingName:row.trading_name,address:row.address,phone:row.phone,email:row.email,website:row.website,
      taxRegistrationNumber:row.tax_registration_number,companyRegistrationNumber:row.company_registration_number,currencyCode:'USD',
      bankDetails:row.bank_details,paymentTerms:row.payment_terms,footerNote:row.footer_note,prefixes,nextNumbers,year,
      company:{name:text(company?.company_name),address:text(company?.address),phone:text(company?.phone),email:text(company?.email),taxVatNumber:text(company?.tax_vat_number)},
    };
  }

  async saveSettings(draft:DocumentSettingsDraft):Promise<DocumentSettings>{
    const prefix=(kind:DocumentKind)=>(draft.prefixes[kind]??'').trim();
    for(const kind of documentKinds){const issues=validateDocumentPrefix(prefix(kind));if(issues.length)throw new Error(issues[0]);}
    if(new Set(documentKinds.map(prefix)).size!==documentKinds.length)throw new Error('Each document type needs its own prefix.');
    if(draft.currencyCode&&draft.currencyCode.trim().toUpperCase()!=='USD')throw new Error('DROMEX records amounts in US dollars. Other currencies are not supported yet.');
    const lengths:[string|null|undefined,string,number][]=[[draft.legalName,'Legal name',120],[draft.tradingName,'Trading name',120],[draft.address,'Address',300],[draft.phone,'Phone',60],[draft.email,'Email',120],[draft.website,'Website',120],[draft.taxRegistrationNumber,'Tax / VAT number',60],[draft.companyRegistrationNumber,'Company registration number',60],[draft.bankDetails,'Bank and payment instructions',600],[draft.paymentTerms,'Payment terms',300],[draft.footerNote,'Footer note',600]];
    for(const [value,label,max] of lengths)if((text(value)??'').length>max)throw new Error(`${label} must be ${max} characters or fewer.`);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`UPDATE business_document_settings SET legal_name=?,trading_name=?,address=?,phone=?,email=?,website=?,tax_registration_number=?,company_registration_number=?,currency_code=?,
        bank_details=?,payment_terms=?,footer_note=?,customer_statement_prefix=?,customer_invoice_prefix=?,supplier_statement_prefix=?,supplier_bill_prefix=?,updated_at=? WHERE id='documents'`,
        text(draft.legalName),text(draft.tradingName),text(draft.address),text(draft.phone),text(draft.email),text(draft.website),text(draft.taxRegistrationNumber),text(draft.companyRegistrationNumber),
        draft.currencyCode?'USD':null,text(draft.bankDetails),text(draft.paymentTerms),text(draft.footerNote),
        prefix('customer_statement'),prefix('customer_invoice'),prefix('supplier_statement'),prefix('supplier_bill'),now);
      await this.enqueue('businessDocumentSettings','documents',{action:'updated',updatedAt:now});
    });
    return this.getSettings();
  }

  async setNextDocumentNumber(kind:DocumentKind,year:number,next:number):Promise<void>{
    if(!Number.isInteger(next)||next<1||next>999999)throw new Error('Enter a whole number from 1 to 999999.');
    const prefix=String((await this.settingsRow())[prefixColumn[kind]]);
    const current=await this.nextNumber(prefix,year);
    if(next<current)throw new Error(`The next number cannot be lower than ${current}, or numbers would repeat.`);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO business_document_counters (prefix_key,year,next_number) VALUES (?,?,?) ON CONFLICT(prefix_key,year) DO UPDATE SET next_number=excluded.next_number',prefix,year,next);
      await this.enqueue('businessDocumentSettings','documents',{action:'next_number',kind,year,next,updatedAt:now});
    });
  }

  async getBillingContact(side:DocumentSide,partyId:string):Promise<BillingContact>{
    const saved=await this.db.getFirstAsync<ContactRow>(`SELECT * FROM party_billing_contacts WHERE ${side==='customer'?'customer_id':'supplier_id'}=?`,partyId);
    if(saved)return {saved:true,billingName:saved.billing_name,contactPerson:saved.contact_person,address:saved.address,phone:saved.phone,email:saved.email,taxRegistrationNumber:saved.tax_registration_number,companyRegistrationNumber:saved.company_registration_number,notes:saved.notes};
    const profile=await this.profile(side,partyId);
    return {saved:false,billingName:profile.name,contactPerson:null,address:text(profile.address),phone:text(profile.phone),email:text(profile.email),taxRegistrationNumber:text(profile.tax_vat_number),companyRegistrationNumber:null,notes:null};
  }

  async saveBillingContact(side:DocumentSide,partyId:string,draft:BillingContactDraft):Promise<BillingContact>{
    await this.profile(side,partyId);
    for(const [value,label,max] of [[draft.billingName,'Billing name',120],[draft.address,'Address',300],[draft.notes,'Notes',500]] as const)if((text(value)??'').length>max)throw new Error(`${label} must be ${max} characters or fewer.`);
    const now=new Date().toISOString(),column=side==='customer'?'customer_id':'supplier_id';
    await this.db.withTransactionAsync(async()=>{
      const existing=await this.db.getFirstAsync<{id:string}>(`SELECT id FROM party_billing_contacts WHERE ${column}=?`,partyId);
      const values=[text(draft.billingName),text(draft.contactPerson),text(draft.address),text(draft.phone),text(draft.email),text(draft.taxRegistrationNumber),text(draft.companyRegistrationNumber),text(draft.notes),now];
      if(existing)await this.db.runAsync('UPDATE party_billing_contacts SET billing_name=?,contact_person=?,address=?,phone=?,email=?,tax_registration_number=?,company_registration_number=?,notes=?,updated_at=? WHERE id=?',...values,existing.id);
      else await this.db.runAsync(`INSERT INTO party_billing_contacts (id,party_type,${column},billing_name,contact_person,address,phone,email,tax_registration_number,company_registration_number,notes,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,`contact_${side}_${partyId}`,side,partyId,...values);
      await this.enqueue('billingContact',`${side}:${partyId}`,{side,partyId,updatedAt:now});
    });
    return this.getBillingContact(side,partyId);
  }

  // ---- Records and the shared links ------------------------------------------------------------

  async listEligibleRecords(query:EligibleRecordQuery):Promise<EligibleRecord[]>{
    const where:string[]=["record_status = 'Active'",'archived = 0'];const params:unknown[]=[];
    if(query.partyId){where.push('party_id = ?');params.push(query.partyId);}
    if(query.fromDate){where.push('record_day >= ?');params.push(query.fromDate);}
    if(query.toDate){where.push('record_day <= ?');params.push(query.toDate);}
    if(query.projectId!==undefined){if(query.projectId)where.push('project_id = ?'),params.push(query.projectId);else where.push('project_id IS NULL');}
    if(query.itemKey){where.push('item_key = ?');params.push(query.itemKey);}
    if(query.unitKey){where.push('unit_key = ?');params.push(query.unitKey);}
    if(query.seriesId){where.push('series_id = ?');params.push(query.seriesId);}
    if(query.recordKeys){if(!query.recordKeys.length)return [];where.push(`record_key IN (${query.recordKeys.map(()=>'?').join(',')})`);params.push(...query.recordKeys);}
    const rows=await this.db.getAllAsync<RecordRow>(`SELECT * FROM (${query.side==='customer'?COMPANY_LOAD_RECORDS:SUPPLIER_LOAD_RECORDS}) WHERE ${where.join(' AND ')} ORDER BY recorded_at, reference`,...params as never[]);
    const links=await this.inclusionFor(rows.map(row=>row.record_key));
    return rows.map(row=>{const own=links[row.record_key]??[];return {key:row.record_key,snapshot:snapshotFromRow(row),seriesId:row.series_id,links:own,inclusion:deriveInclusion(own,query.kind)};})
      .filter(record=>matchesInclusionFilter(record.inclusion,query.inclusion??'all'));
  }

  async inclusionFor(keys:readonly string[]):Promise<Record<string,DocumentLink[]>>{
    return readDocumentLinks(this.db,keys);
  }

  // ---- Drafts ----------------------------------------------------------------------------------

  async createDraft(input:CreateDraftInput):Promise<BusinessDocument>{
    const info=documentKindInfo[input.kind];
    const party=await this.profile(info.side,input.partyId);
    const keys=[...new Set(input.recordKeys)];
    if(!keys.length)throw new Error('Select at least one record.');
    if(input.selectionMethod==='date_range'&&(!input.periodFrom||!input.periodTo||!validDate(input.periodFrom)||!validDate(input.periodTo)||input.periodFrom>input.periodTo))throw new Error('Choose a valid date range.');
    const rows=await this.readRecords(keys,input.kind);
    const links=await this.inclusionFor(keys);
    for(const key of keys){
      const row=rows.get(key)!;
      const problem=this.recordProblem(row,input.kind,input.partyId,party.name,input.selectionMethod==='date_range'?{from:input.periodFrom!,to:input.periodTo!}:null,null,links[key]??[]);
      if(problem)throw new Error(problem);
    }
    const id=makeId(),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      const sequence=await this.db.getFirstAsync<{sequence:number}>(`INSERT INTO business_document_counters (prefix_key,year,next_number) VALUES ('DRAFT',0,2)
        ON CONFLICT(prefix_key,year) DO UPDATE SET next_number=next_number+1 RETURNING next_number-1 AS sequence`);
      const draftNumber=`DRAFT-${sequence?.sequence??1}`;
      await this.db.runAsync(`INSERT INTO business_documents (id,kind,party_type,customer_id,supplier_id,party_name,status,draft_number,period_from,period_to,selection_method,status_history_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'Draft',?,?,?,?,?,?,?)`,id,input.kind,info.side,info.side==='customer'?input.partyId:null,info.side==='supplier'?input.partyId:null,party.name,draftNumber,
        input.periodFrom??null,input.periodTo??null,input.selectionMethod,JSON.stringify([{status:'Draft',at:now}] satisfies DocumentHistoryEntry[]),now,now);
      for(const [position,key] of keys.entries())await this.insertLink(id,input.kind,snapshotFromRow(rows.get(key)!),position,now);
      await this.enqueue('businessDocument',id,{action:'created',id,kind:input.kind,draftNumber,partyId:input.partyId,recordKeys:keys,at:now});
    });
    return this.getDocument(id);
  }

  async removeRecordsFromDraft(documentId:string,keys:readonly string[]):Promise<BusinessDocument>{
    await this.draftRow(documentId);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      for(const key of keys)await this.db.runAsync('DELETE FROM business_document_records WHERE document_id=? AND record_key=?',documentId,key);
      await this.db.runAsync('UPDATE business_documents SET updated_at=? WHERE id=?',now,documentId);
      await this.enqueue('businessDocument',documentId,{action:'records_removed',id:documentId,recordKeys:keys,at:now});
    });
    return this.getDocument(documentId);
  }

  async updateDraft(documentId:string,details:DraftDetails):Promise<BusinessDocument>{
    const row=await this.draftRow(documentId);
    for(const date of [details.dueDate,details.periodFrom,details.periodTo])if(date&&!validDate(date))throw new Error('Enter dates as YYYY-MM-DD.');
    if((text(details.reference)??'').length>80)throw new Error('The reference must be 80 characters or fewer.');
    if((details.notes??'').trim().length>1000)throw new Error('Notes must be 1000 characters or fewer.');
    let signerJson=row.signer_json;
    if(details.signer!==undefined){
      if(details.signer){const signer=await this.activeSigner(details.signer.signerId);signerSnapshot(signer,details.signer.display);signerJson=JSON.stringify({selection:details.signer} satisfies StoredSigner);}
      else signerJson=null;
    }
    const now=new Date().toISOString();
    const pick=<K extends keyof DraftDetails>(key:K,current:string|null)=>details[key]===undefined?current:(key==='notes'?((details.notes??'').trim()||null):text(details[key] as string|null));
    const issuer=details.issuerOverride?JSON.stringify({...parse<Partial<PartyBlock>>(row.issuer_json,{}),...details.issuerOverride}):row.issuer_json;
    const recipient=details.recipientOverride?JSON.stringify({...parse<Partial<PartyBlock>>(row.recipient_json,{}),...details.recipientOverride}):row.recipient_json;
    const terms=details.termsOverride?JSON.stringify({...parse<Partial<DocumentTerms>>(row.terms_json,{}),...details.termsOverride}):row.terms_json;
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE business_documents SET due_date=?,reference=?,notes=?,period_from=?,period_to=?,issuer_json=?,recipient_json=?,terms_json=?,signer_json=?,updated_at=? WHERE id=?',
        pick('dueDate',row.due_date),pick('reference',row.reference),pick('notes',row.notes),pick('periodFrom',row.period_from),pick('periodTo',row.period_to),issuer,recipient,terms,signerJson,now,documentId);
      await this.enqueue('businessDocument',documentId,{action:'updated',id:documentId,at:now});
    });
    return this.getDocument(documentId);
  }

  // ---- Issue and cancel ------------------------------------------------------------------------

  async issueDocument(documentId:string,input:IssueInput):Promise<BusinessDocument>{
    const row=await this.draftRow(documentId,'Only a draft can be issued.');
    const info=documentKindInfo[row.kind];
    if(!validDate(input.issueDate))throw new Error('Enter a valid issue date.');
    const override=text(input.documentNumber);
    if(override&&info.mode!=='official')throw new Error('Only an Official Bill / Invoice can override its number.');
    if(override){const issues=validateDocumentNumber(override);if(issues.length)throw new Error(issues[0]);}
    const partyId=(row.customer_id??row.supplier_id)!;
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      const linkRows=await this.db.getAllAsync<LinkRow>('SELECT record_key,snapshot_json,position FROM business_document_records WHERE document_id=? ORDER BY position',documentId);
      if(!linkRows.length)throw new Error('Add at least one record before issuing.');
      const keys=linkRows.map(link=>link.record_key);
      const rows=await this.readRecords(keys,row.kind);
      const links=await this.inclusionFor(keys);
      for(const key of keys){
        const problem=this.recordProblem(rows.get(key)!,row.kind,partyId,row.party_name,row.selection_method==='date_range'&&row.period_from&&row.period_to?{from:row.period_from,to:row.period_to}:null,documentId,links[key]??[]);
        if(problem)throw new Error(`${problem} Remove it from the draft first.`);
      }
      const blocks=await this.resolveBlocks(row);
      if(info.mode==='official'&&!blocks.issuer.name)throw new Error(info.side==='customer'?'Business name is not configured. Add it in Business Document Settings, or issue an Internal statement.':'The supplier name is missing. Add billing details, or issue an Internal statement.');
      let signer:SignerSnapshot|null=null;
      const stored=parse<StoredSigner|null>(row.signer_json,null);
      if(stored&&'selection' in stored){
        signer=signerSnapshot(await this.activeSigner(stored.selection.signerId),stored.selection.display);
        await recordSignerEvent(this.db,signer.signerId,'used',now,documentId,`${info.label} issued`);
      }
      const documentNumber=await this.assignNumber(row.kind,input.issueDate,override);
      const logo=await this.db.getFirstAsync<{logo_uri:string|null}>("SELECT logo_uri FROM company_settings WHERE id='company'");
      const snapshots=keys.map(key=>snapshotFromRow(rows.get(key)!));
      for(const [index,key] of keys.entries())await this.db.runAsync("UPDATE business_document_records SET snapshot_json=?,document_status='Issued',issue_date=? WHERE document_id=? AND record_key=?",JSON.stringify(snapshots[index]),input.issueDate,documentId,key);
      const history=[...parse<DocumentHistoryEntry[]>(row.status_history_json,[]),{status:'Issued',at:now,documentNumber} satisfies DocumentHistoryEntry];
      await this.db.runAsync(`UPDATE business_documents SET status='Issued',document_number=?,issue_date=?,issued_at=?,issuer_json=?,recipient_json=?,terms_json=?,signer_json=?,totals_json=?,logo_uri=?,status_history_json=?,updated_at=? WHERE id=?`,
        documentNumber,input.issueDate,now,JSON.stringify(blocks.issuer),JSON.stringify(blocks.recipient),JSON.stringify(blocks.terms),signer?JSON.stringify(signer):null,JSON.stringify(groupDocumentLines(snapshots)),text(logo?.logo_uri),JSON.stringify(history),now,documentId);
      await this.enqueue('businessDocument',documentId,{action:'issued',id:documentId,documentNumber,issueDate:input.issueDate,recordKeys:keys,signerId:signer?.signerId??null,at:now});
    });
    return this.getDocument(documentId);
  }

  async cancelDocument(documentId:string,reason:string):Promise<BusinessDocument>{
    const value=reason.trim();if(!value)throw new Error('A cancellation reason is required.');
    if(value.length>500)throw new Error('The reason must be 500 characters or fewer.');
    const row=await this.documentRow(documentId);
    if(row.status==='Cancelled')throw new Error('This document is already cancelled.');
    const now=new Date().toISOString();
    const history=[...parse<DocumentHistoryEntry[]>(row.status_history_json,[]),{status:'Cancelled',at:now,reason:value} satisfies DocumentHistoryEntry];
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync("UPDATE business_documents SET status='Cancelled',cancelled_at=?,cancellation_reason=?,status_history_json=?,updated_at=? WHERE id=?",now,value,JSON.stringify(history),now,documentId);
      await this.db.runAsync("UPDATE business_document_records SET document_status='Cancelled' WHERE document_id=?",documentId);
      await this.enqueue('businessDocument',documentId,{action:'cancelled',id:documentId,wasIssued:row.status==='Issued',reason:value,at:now});
    });
    return this.getDocument(documentId);
  }

  // ---- Reading documents -----------------------------------------------------------------------

  async getDocument(documentId:string,today=localToday()):Promise<BusinessDocument>{
    const row=await this.documentRow(documentId);
    const linkRows=await this.db.getAllAsync<LinkRow>('SELECT record_key,snapshot_json,position FROM business_document_records WHERE document_id=? ORDER BY position',documentId);
    let records=linkRows.map(link=>({key:link.record_key,snapshot:parse<RecordSnapshot>(link.snapshot_json,{} as RecordSnapshot),position:link.position}));
    const problems:DocumentRecordProblem[]=[];
    let issuer=parse<PartyBlock|null>(row.issuer_json,null),recipient=parse<PartyBlock|null>(row.recipient_json,null),terms=parse<DocumentTerms|null>(row.terms_json,null);
    let signer:SignerSnapshot|null=null,signerSelection:SignerSelection|null=null;
    const storedSigner=parse<StoredSigner|null>(row.signer_json,null);
    let groups:DocumentLineGroups;
    let logoUri=row.logo_uri;
    if(row.status==='Draft'){
      logoUri=text((await this.db.getFirstAsync<{logo_uri:string|null}>("SELECT logo_uri FROM company_settings WHERE id='company'"))?.logo_uri);
      // A draft is a live working view: it shows records as they are now and names anything that would block issue.
      const keys=records.map(record=>record.key);
      const live=await this.readRecords(keys,row.kind,false);
      const links=await this.inclusionFor(keys);
      records=records.map(record=>{const current=live.get(record.key);if(!current)return record;
        const problem=this.recordProblem(current,row.kind,(row.customer_id??row.supplier_id)!,row.party_name,row.selection_method==='date_range'&&row.period_from&&row.period_to?{from:row.period_from,to:row.period_to}:null,documentId,links[record.key]??[]);
        if(problem)problems.push({key:record.key,message:problem});
        return {...record,snapshot:snapshotFromRow(current)};});
      const blocks=await this.resolveBlocks(row);issuer=blocks.issuer;recipient=blocks.recipient;terms=blocks.terms;
      if(storedSigner&&'selection' in storedSigner){signerSelection=storedSigner.selection;try{signer=signerSnapshot(await this.activeSigner(storedSigner.selection.signerId),storedSigner.selection.display);}catch(cause){problems.push({key:'signer',message:cause instanceof Error?cause.message:'The selected signer is unavailable.'});}}
      groups=groupDocumentLines(records.map(record=>record.snapshot));
    }else{
      signer=storedSigner&&!('selection' in storedSigner)?storedSigner:null;
      if(storedSigner&&'selection' in storedSigner)signerSelection=storedSigner.selection;
      groups=parse<DocumentLineGroups|null>(row.totals_json,null)??groupDocumentLines(records.map(record=>record.snapshot));
    }
    return {
      id:row.id,kind:row.kind,status:row.status,draftNumber:row.draft_number,documentNumber:row.document_number,partyType:row.party_type,partyId:(row.customer_id??row.supplier_id)!,partyName:row.party_name,
      periodFrom:row.period_from,periodTo:row.period_to,selectionMethod:row.selection_method,issueDate:row.issue_date,dueDate:row.due_date,reference:row.reference,notes:row.notes,
      issuer,recipient,terms,signer,signerSelection,logoUri,records,groups,problems,history:parse<DocumentHistoryEntry[]>(row.status_history_json,[]),
      payment:row.status==='Issued'?await this.payment(row,linkRows.map(link=>link.record_key),today):null,
      issuedAt:row.issued_at,cancelledAt:row.cancelled_at,cancellationReason:row.cancellation_reason,createdAt:row.created_at,updatedAt:row.updated_at,
    };
  }

  async listDocuments(filter:DocumentListFilter={},today=localToday()):Promise<DocumentSummary[]>{
    const where:string[]=['1 = 1'];const params:unknown[]=[];
    if(filter.partyType){where.push('d.party_type = ?');params.push(filter.partyType);}
    if(filter.partyId){where.push('(d.customer_id = ? OR d.supplier_id = ?)');params.push(filter.partyId,filter.partyId);}
    if(filter.status){where.push('d.status = ?');params.push(filter.status);}
    if(filter.kind){where.push('d.kind = ?');params.push(filter.kind);}
    if(filter.fromDate){where.push("COALESCE(d.issue_date, date(d.created_at,'localtime')) >= ?");params.push(filter.fromDate);}
    if(filter.toDate){where.push("COALESCE(d.issue_date, date(d.created_at,'localtime')) <= ?");params.push(filter.toDate);}
    if(filter.projectId!==undefined){where.push(filter.projectId?"EXISTS (SELECT 1 FROM business_document_records r WHERE r.document_id = d.id AND json_extract(r.snapshot_json,'$.projectId') = ?)":"EXISTS (SELECT 1 FROM business_document_records r WHERE r.document_id = d.id AND json_extract(r.snapshot_json,'$.projectId') IS NULL)");if(filter.projectId)params.push(filter.projectId);}
    if(filter.itemKey){where.push("EXISTS (SELECT 1 FROM business_document_records r WHERE r.document_id = d.id AND json_extract(r.snapshot_json,'$.itemKey') = ?)");params.push(filter.itemKey);}
    if(filter.search?.trim()){const like=`%${filter.search.trim().toLocaleLowerCase('en-US')}%`;where.push('(lower(COALESCE(d.document_number,\'\')) LIKE ? OR lower(d.draft_number) LIKE ? OR lower(COALESCE(d.reference,\'\')) LIKE ? OR lower(d.party_name) LIKE ?)');params.push(like,like,like,like);}
    const rows=await this.db.getAllAsync<DocumentRow&{record_count:number}>(`SELECT d.*, (SELECT COUNT(*) FROM business_document_records r WHERE r.document_id = d.id) record_count
      FROM business_documents d WHERE ${where.join(' AND ')} ORDER BY COALESCE(d.issue_date, date(d.created_at,'localtime')) DESC, d.created_at DESC`,...params as never[]);
    const summaries:DocumentSummary[]=[];
    for(const row of rows){
      const keys=row.status==='Issued'?(await this.db.getAllAsync<{record_key:string}>('SELECT record_key FROM business_document_records WHERE document_id=?',row.id)).map(link=>link.record_key):[];
      const payment=row.status==='Issued'?await this.payment(row,keys,today):null;
      if(filter.paymentStatus&&(filter.paymentStatus==='Overdue'?!payment?.overdue:payment?.status!==filter.paymentStatus))continue;
      summaries.push({id:row.id,kind:row.kind,status:row.status,draftNumber:row.draft_number,documentNumber:row.document_number,partyType:row.party_type,partyId:(row.customer_id??row.supplier_id)!,partyName:row.party_name,
        issueDate:row.issue_date,dueDate:row.due_date,periodFrom:row.period_from,periodTo:row.period_to,reference:row.reference,createdAt:row.created_at,payment,recordCount:Number(row.record_count)});
    }
    return summaries;
  }

  // ---- Internals -------------------------------------------------------------------------------

  private async settingsRow():Promise<SettingsRow>{
    const row=await this.db.getFirstAsync<SettingsRow>("SELECT * FROM business_document_settings WHERE id='documents'");
    if(!row)throw new Error('Business Document Settings are missing.');
    return row;
  }

  /** The next automatic number for a prefix and year, never below one past any number already used. */
  private async nextNumber(prefix:string,year:number):Promise<number>{
    const row=await this.db.getFirstAsync<{next_number:number}>('SELECT next_number FROM business_document_counters WHERE prefix_key=? AND year=?',prefix,year);
    return Number(row?.next_number??1);
  }

  private async assignNumber(kind:DocumentKind,issueDate:string,override:string|null):Promise<string>{
    const prefix=String((await this.settingsRow())[prefixColumn[kind]]);const year=Number(issueDate.slice(0,4));
    if(override){
      const clash=await this.db.getFirstAsync<{id:string}>('SELECT id FROM business_documents WHERE lower(document_number)=lower(?)',override);
      if(clash)throw new Error(`Document number ${override} is already used.`);
      // An override in this kind's own automatic format moves the counter past it, so it is never generated again.
      const match=new RegExp(`^${prefix}-(\\d{4})-(\\d+)$`,'i').exec(override);
      if(match)await this.db.runAsync('INSERT INTO business_document_counters (prefix_key,year,next_number) VALUES (?,?,?) ON CONFLICT(prefix_key,year) DO UPDATE SET next_number=MAX(next_number,excluded.next_number)',prefix,Number(match[1]),Number(match[2])+1);
      return override;
    }
    for(;;){
      const counter=await this.db.getFirstAsync<{sequence:number}>(`INSERT INTO business_document_counters (prefix_key,year,next_number) VALUES (?,?,2)
        ON CONFLICT(prefix_key,year) DO UPDATE SET next_number=next_number+1 RETURNING next_number-1 AS sequence`,prefix,year);
      const number=formatDocumentNumber(prefix,year,Number(counter?.sequence??1));
      // A manually entered number in another format can still coincide; skip it rather than fail.
      if(!await this.db.getFirstAsync<{id:string}>('SELECT id FROM business_documents WHERE lower(document_number)=lower(?)',number))return number;
    }
  }

  /** Records by key, including cancelled ones so the caller can name the problem. */
  private async readRecords(keys:readonly string[],kind:DocumentKind,requireAll=true):Promise<Map<string,RecordRow>>{
    const info=documentKindInfo[kind];
    for(const key of keys)if(!key.startsWith(`${info.recordType}:`))throw new Error(`${article(info.label)} can only include ${info.recordType==='company_load'?'company loads':'Supplier Loads'}.`);
    const found=new Map<string,RecordRow>();
    for(const part of chunk(keys)){
      const rows=await this.db.getAllAsync<RecordRow>(`SELECT * FROM (${info.recordType==='company_load'?COMPANY_LOAD_RECORDS:SUPPLIER_LOAD_RECORDS}) WHERE record_key IN (${part.map(()=>'?').join(',')})`,...part);
      for(const row of rows)found.set(row.record_key,row);
    }
    if(requireAll&&keys.some(key=>!found.has(key)))throw new Error('A selected record was not found.');
    return found;
  }

  private recordProblem(row:RecordRow,kind:DocumentKind,partyId:string,partyName:string,range:{from:string;to:string}|null,ownDocumentId:string|null,links:readonly DocumentLink[]):string|null{
    if(row.party_id!==partyId)return `${row.reference} belongs to ${row.party_name}, not ${partyName}.`;
    if(row.record_status==='Cancelled')return `${row.reference} is cancelled and cannot be included.`;
    if(Number(row.archived)===1)return `${row.reference} is archived and cannot be included.`;
    if(range&&(row.record_day<range.from||row.record_day>range.to))return `${row.reference} is outside ${range.from} to ${range.to}.`;
    const issued=links.find(link=>link.kind===kind&&link.status==='Issued'&&link.documentId!==ownDocumentId);
    if(issued)return `${row.reference} is already included in ${issued.documentNumber}.`;
    return null;
  }

  private async insertLink(documentId:string,kind:DocumentKind,snapshot:RecordSnapshot,position:number,now:string):Promise<void>{
    const key=recordKey(snapshot.recordType,snapshot.recordId);
    await this.db.runAsync(`INSERT INTO business_document_records (id,document_id,document_kind,document_status,issue_date,record_type,load_id,supplier_load_id,record_key,snapshot_json,position,created_at)
      VALUES (?,?,?,'Draft',NULL,?,?,?,?,?,?,?)`,`${documentId}:${position}:${snapshot.recordId}`,documentId,kind,snapshot.recordType,
      snapshot.recordType==='company_load'?snapshot.recordId:null,snapshot.recordType==='supplier_load'?snapshot.recordId:null,key,JSON.stringify(snapshot),position,now);
  }

  /** Issuer, recipient and terms: saved settings and billing contacts, then this document's overrides. */
  private async resolveBlocks(row:DocumentRow):Promise<{issuer:PartyBlock;recipient:PartyBlock;terms:DocumentTerms}>{
    const settings=await this.getSettings();
    const business:PartyBlock={...emptyBlock(),name:settings.legalName??settings.company.name,tradingName:settings.tradingName,address:settings.address??settings.company.address,phone:settings.phone??settings.company.phone,
      email:settings.email??settings.company.email,website:settings.website,taxRegistrationNumber:settings.taxRegistrationNumber??settings.company.taxVatNumber,companyRegistrationNumber:settings.companyRegistrationNumber};
    const contact=await this.getBillingContact(row.party_type,(row.customer_id??row.supplier_id)!);
    const party:PartyBlock={...emptyBlock(),name:contact.billingName??row.party_name,contactPerson:contact.contactPerson,address:contact.address,phone:contact.phone,email:contact.email,taxRegistrationNumber:contact.taxRegistrationNumber,companyRegistrationNumber:contact.companyRegistrationNumber};
    const ourSide=row.party_type==='customer';
    const terms:DocumentTerms={currency:'USD',paymentTerms:settings.paymentTerms,bankDetails:ourSide?settings.bankDetails:null,footerNote:settings.footerNote};
    return {
      issuer:merge(ourSide?business:party,parse<Partial<PartyBlock>>(row.issuer_json,{})),
      recipient:merge(ourSide?party:business,parse<Partial<PartyBlock>>(row.recipient_json,{})),
      terms:{...merge(terms,parse<Partial<DocumentTerms>>(row.terms_json,{})),currency:'USD'},
    };
  }

  /** Live payment position of an Issued document's records, from the existing payment records only. */
  private async payment(row:DocumentRow,keys:readonly string[],today:string):Promise<DocumentPayment>{
    let owed:number|null=null,paid=0;
    for(const part of chunk(keys)){
      const loads=part.filter(key=>key.startsWith('company_load:')).map(key=>key.slice(13));
      const supplier=part.filter(key=>key.startsWith('supplier_load:')).map(key=>key.slice(14));
      if(loads.length){
        const sums=await this.db.getFirstAsync<{owed:number|null;paid:number}>(`SELECT SUM(CASE WHEN COALESCE(status,'Active')='Active' THEN final_total_usd_cents END) owed,
          (SELECT COALESCE(SUM(amount_usd_cents),0) FROM payment_entries p WHERE p.status='Active' AND p.load_id IN (${loads.map(()=>'?').join(',')})) paid
          FROM loads WHERE id IN (${loads.map(()=>'?').join(',')})`,...loads,...loads);
        if(sums?.owed!=null)owed=(owed??0)+Number(sums.owed);paid+=Number(sums?.paid??0);
      }
      if(supplier.length){
        const sums=await this.db.getFirstAsync<{owed:number|null;paid:number}>(`SELECT SUM(CASE WHEN COALESCE(status,'Active')='Active' THEN final_total_usd_cents END) owed,
          (SELECT COALESCE(SUM(amount_usd_cents),0) FROM payment_entries p WHERE p.status='Active' AND p.quarry_purchase_id IN (${supplier.map(()=>'?').join(',')})) paid
          FROM quarry_purchases WHERE id IN (${supplier.map(()=>'?').join(',')})`,...supplier,...supplier);
        if(sums?.owed!=null)owed=(owed??0)+Number(sums.owed);paid+=Number(sums?.paid??0);
      }
    }
    const status:DocumentPayment['status']=owed==null?'No amount recorded':owed===0?'No payment due':paid>=owed?'Paid':paid>0?'Partially paid':'Unpaid';
    return {status,owedCents:owed,paidCents:paid,overdue:Boolean(row.due_date&&row.due_date<today&&(status==='Unpaid'||status==='Partially paid'))};
  }

  private async activeSigner(id:string){
    const row=await this.db.getFirstAsync<Parameters<typeof signerFromRow>[0]>('SELECT * FROM document_signers WHERE id=?',id);
    if(!row)throw new Error('The selected signer was not found.');
    if(row.is_active!==1)throw new Error('The selected signer is disabled. Choose another signer.');
    return signerFromRow(row);
  }

  private async profile(side:DocumentSide,partyId:string):Promise<ProfileRow>{
    const row=await this.db.getFirstAsync<ProfileRow>(`SELECT name,phone,email,address,tax_vat_number FROM ${side==='customer'?'customers':'suppliers'} WHERE id=?`,partyId);
    if(!row)throw new Error(side==='customer'?'The customer was not found.':'The supplier was not found.');
    return row;
  }

  private async documentRow(id:string):Promise<DocumentRow>{
    const row=await this.db.getFirstAsync<DocumentRow>('SELECT * FROM business_documents WHERE id=?',id);
    if(!row)throw new Error('The document was not found.');
    return row;
  }
  private async draftRow(id:string,message='Only a draft can be changed.'):Promise<DocumentRow>{
    const row=await this.documentRow(id);
    if(row.status!=='Draft')throw new Error(message);
    return row;
  }

  private async enqueue(entityType:string,id:string,payload:unknown):Promise<void>{
    await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,'upsert',?,?)",entityType,id,JSON.stringify(payload),new Date().toISOString());
  }
}
