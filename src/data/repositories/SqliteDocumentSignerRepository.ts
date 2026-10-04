import type {SQLiteDatabase} from 'expo-sqlite';

import {signerNameKey,signerSnapshot,validateSignerDraft,type DocumentSigner,type DocumentSignerDraft,type SignerDisplay,type SignerEvent,type SignerSnapshot} from '../../domain/documentSigners';
import {normalizeSupervisorText,parseStoredSignature,validateSignatureStrokes} from '../../domain/supervisors';
import type {DocumentSignerRepository} from './DocumentSignerRepository';

type SignerRow={id:string;name:string;job_title:string|null;department:string|null;signature_json:string;signature_updated_at:string|null;is_active:number;created_at:string;updated_at:string};
type EventRow={id:number;signer_id:string;event:SignerEvent['event'];document_id:string|null;details:string|null;created_at:string};

export function signerFromRow(row:SignerRow):DocumentSigner{
  const signature=parseStoredSignature(row.signature_json);
  return {id:row.id,name:row.name,jobTitle:row.job_title,department:row.department,signature:signature.strokes,signatureDamaged:signature.damaged,signatureUpdatedAt:row.signature_updated_at,isActive:row.is_active===1,createdAt:row.created_at,updatedAt:row.updated_at};
}
const makeId=()=>`signer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
const optional=(value:string)=>normalizeSupervisorText(value)||null;

/**
 * DEC-503. The copy of a signer a Delivery Authorization keeps. Throws when the signer is missing or
 * disabled, or when a drawn signature is asked for and none is saved.
 */
export async function deliverySignatureFor(db:SQLiteDatabase,selection:{signerId:string;display:SignerDisplay}):Promise<SignerSnapshot>{
  const row=await db.getFirstAsync<SignerRow>('SELECT * FROM document_signers WHERE id=?',selection.signerId);
  if(!row)throw new Error('The selected signer was not found.');
  if(row.is_active!==1)throw new Error('The selected signer is disabled. Choose another signer.');
  return signerSnapshot(signerFromRow(row),selection.display);
}

/**
 * DEC-503. The default signer copied onto new loads, or null when none is chosen or it can no longer
 * sign (disabled or missing). A drawn signature that was later cleared falls back to Name only.
 */
export async function defaultDeliverySignature(db:SQLiteDatabase):Promise<SignerSnapshot|null>{
  const setting=await db.getFirstAsync<{delivery_signer_id:string|null;delivery_signer_display:SignerDisplay|null}>("SELECT delivery_signer_id,delivery_signer_display FROM business_document_settings WHERE id='documents'");
  if(!setting?.delivery_signer_id)return null;
  const row=await db.getFirstAsync<SignerRow>('SELECT * FROM document_signers WHERE id=?',setting.delivery_signer_id);
  if(!row||row.is_active!==1)return null;
  const signer=signerFromRow(row);
  return signerSnapshot(signer,setting.delivery_signer_display==='name_with_signature'&&signer.signature.length?'name_with_signature':'name_only');
}

/** Records one signer event; also used when a document is issued with this signer. */
export async function recordSignerEvent(db:SQLiteDatabase,signerId:string,event:SignerEvent['event'],at:string,documentId:string|null=null,details:string|null=null):Promise<void>{
  await db.runAsync('INSERT INTO document_signer_events (signer_id,event,document_id,details,created_at) VALUES (?,?,?,?,?)',signerId,event,documentId,details,at);
}

/**
 * DEC-500 (5). Signers are never deleted; disabling hides them from new documents. Every change and
 * every use is kept in document_signer_events. The sync queue records that a signature changed, never
 * the strokes.
 */
export class SqliteDocumentSignerRepository implements DocumentSignerRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async listSigners():Promise<DocumentSigner[]>{
    return (await this.db.getAllAsync<SignerRow>('SELECT * FROM document_signers ORDER BY is_active DESC, name COLLATE NOCASE, id')).map(signerFromRow);
  }

  async getSigner(id:string):Promise<DocumentSigner>{
    const row=await this.db.getFirstAsync<SignerRow>('SELECT * FROM document_signers WHERE id=?',id);
    if(!row)throw new Error('The signer was not found.');
    return signerFromRow(row);
  }

  async createSigner(draft:DocumentSignerDraft):Promise<DocumentSigner>{
    const issues=validateSignerDraft(draft);if(issues.length)throw new Error(issues.join('\n'));
    const name=normalizeSupervisorText(draft.name);await this.assertNameFree(name,null);
    const id=makeId(),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync("INSERT INTO document_signers (id,name,name_key,job_title,department,signature_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,'[]',1,?,?)",id,name,signerNameKey(name),optional(draft.jobTitle),optional(draft.department),now,now);
      await recordSignerEvent(this.db,id,'created',now);
      await this.enqueue(id,{id,name,jobTitle:optional(draft.jobTitle),department:optional(draft.department),isActive:true,updatedAt:now});
    });
    return this.getSigner(id);
  }

  async updateSigner(id:string,draft:DocumentSignerDraft):Promise<DocumentSigner>{
    const issues=validateSignerDraft(draft);if(issues.length)throw new Error(issues.join('\n'));
    const before=await this.getSigner(id);
    const name=normalizeSupervisorText(draft.name);await this.assertNameFree(name,id);
    const now=new Date().toISOString(),jobTitle=optional(draft.jobTitle),department=optional(draft.department);
    const details=[before.name!==name?`Name: ${before.name} → ${name}`:null,before.jobTitle!==jobTitle?`Job title: ${before.jobTitle??'—'} → ${jobTitle??'—'}`:null,before.department!==department?`Department: ${before.department??'—'} → ${department??'—'}`:null].filter(Boolean).join('; ');
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE document_signers SET name=?,name_key=?,job_title=?,department=?,updated_at=? WHERE id=?',name,signerNameKey(name),jobTitle,department,now,id);
      await recordSignerEvent(this.db,id,'updated',now,null,details||null);
      await this.enqueue(id,{id,name,jobTitle,department,updatedAt:now});
    });
    return this.getSigner(id);
  }

  async saveSignature(id:string,strokes:string[]):Promise<DocumentSigner>{
    const issues=validateSignatureStrokes(strokes);if(issues.length)throw new Error(issues.join('\n'));
    await this.getSigner(id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE document_signers SET signature_json=?,signature_updated_at=?,updated_at=? WHERE id=?',JSON.stringify(strokes),now,now,id);
      await recordSignerEvent(this.db,id,'signature_changed',now,null,strokes.length?'Signature saved':'Signature cleared');
      await this.enqueue(id,{id,hasSignature:strokes.length>0,signatureUpdatedAt:now,updatedAt:now});
    });
    return this.getSigner(id);
  }

  async setSignerActive(id:string,isActive:boolean):Promise<void>{
    await this.getSigner(id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE document_signers SET is_active=?,updated_at=? WHERE id=?',isActive?1:0,now,id);
      await recordSignerEvent(this.db,id,isActive?'enabled':'disabled',now);
      await this.enqueue(id,{id,isActive,updatedAt:now});
    });
  }

  async getDeliverySigner():Promise<{signerId:string;display:SignerDisplay}|null>{
    const row=await this.db.getFirstAsync<{delivery_signer_id:string|null;delivery_signer_display:SignerDisplay|null}>("SELECT delivery_signer_id,delivery_signer_display FROM business_document_settings WHERE id='documents'");
    return row?.delivery_signer_id?{signerId:row.delivery_signer_id,display:row.delivery_signer_display??'name_only'}:null;
  }

  /** DEC-503. Chooses the signer copied onto every new Delivery Authorization; null turns it off. */
  async setDeliverySigner(selection:{signerId:string;display:SignerDisplay}|null):Promise<void>{
    if(selection)await deliverySignatureFor(this.db,selection);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync("UPDATE business_document_settings SET delivery_signer_id=?,delivery_signer_display=?,updated_at=? WHERE id='documents'",selection?.signerId??null,selection?.display??null,now);
      await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES ('businessDocumentSettings','documents','upsert',?,?)",JSON.stringify({action:'delivery_signer',signerId:selection?.signerId??null,display:selection?.display??null,updatedAt:now}),now);
    });
  }

  async listEvents(id:string):Promise<SignerEvent[]>{
    const rows=await this.db.getAllAsync<EventRow>('SELECT * FROM document_signer_events WHERE signer_id=? ORDER BY id',id);
    return rows.map(row=>({id:row.id,signerId:row.signer_id,event:row.event,documentId:row.document_id,details:row.details,createdAt:row.created_at}));
  }

  private async assertNameFree(name:string,exceptId:string|null):Promise<void>{
    const clash=await this.db.getFirstAsync<{name:string}>('SELECT name FROM document_signers WHERE name_key=? AND id<>?',signerNameKey(name),exceptId??'');
    if(clash)throw new Error(`A signer named "${clash.name}" already exists.`);
  }

  private async enqueue(id:string,payload:unknown):Promise<void>{
    await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES ('documentSigner',?,'upsert',?,?)",id,JSON.stringify(payload),new Date().toISOString());
  }
}
