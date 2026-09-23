import type {SQLiteDatabase} from 'expo-sqlite';

import {
  normalizeSupervisorText,parseStoredSignature,supervisorNameKey,validateSignatureStrokes,validateSupervisorDraft,
  type Supervisor,type SupervisorDraft,
} from '../../domain/supervisors';
import type {SupervisorRepository} from './SupervisorRepository';

type SupervisorRow={id:string;name:string;job_title:string|null;signature_json:string;signature_updated_at:string|null;display_order:number;is_active:number;created_at:string;updated_at:string};

function fromRow(row:SupervisorRow):Supervisor{
  const signature=parseStoredSignature(row.signature_json);
  return {id:row.id,name:row.name,jobTitle:row.job_title,signature:signature.strokes,signatureDamaged:signature.damaged,signatureUpdatedAt:row.signature_updated_at,displayOrder:row.display_order,isActive:row.is_active===1,createdAt:row.created_at,updatedAt:row.updated_at};
}
const makeId=()=>`supervisor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;

/**
 * DEC-479. The signature lives in this table as stroke JSON, like the Consultant and driver signatures,
 * so it is covered by every encrypted backup, cannot reference a file outside the app, and cannot be
 * written over another supervisor's. It is validated before it is stored, and a sync_outbox entry only
 * ever records that a signature changed -- never the strokes themselves.
 */
export class SqliteSupervisorRepository implements SupervisorRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async listSupervisors():Promise<Supervisor[]>{
    return (await this.db.getAllAsync<SupervisorRow>('SELECT * FROM supervisors ORDER BY display_order, name COLLATE NOCASE, id')).map(fromRow);
  }

  async createSupervisor(draft:SupervisorDraft):Promise<Supervisor>{
    const issues=validateSupervisorDraft(draft);if(issues.length)throw new Error(issues.join('\n'));
    const name=normalizeSupervisorText(draft.name),jobTitle=normalizeSupervisorText(draft.jobTitle)||null;
    await this.assertNameFree(name,null);
    const id=makeId(),now=new Date().toISOString();
    const order=await this.db.getFirstAsync<{next:number}>('SELECT COALESCE(MAX(display_order),-1)+1 next FROM supervisors');
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync("INSERT INTO supervisors (id,name,name_key,job_title,signature_json,display_order,is_active,created_at,updated_at) VALUES (?,?,?,?,'[]',?,1,?,?)",id,name,supervisorNameKey(name),jobTitle,order?.next??0,now,now);
      await this.enqueue(id,{id,name,jobTitle,isActive:true,updatedAt:now});
    });
    return this.supervisor(id);
  }

  async updateSupervisor(id:string,draft:SupervisorDraft):Promise<Supervisor>{
    const issues=validateSupervisorDraft(draft);if(issues.length)throw new Error(issues.join('\n'));
    await this.supervisor(id);
    const name=normalizeSupervisorText(draft.name),jobTitle=normalizeSupervisorText(draft.jobTitle)||null;
    await this.assertNameFree(name,id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE supervisors SET name=?,name_key=?,job_title=?,updated_at=? WHERE id=?',name,supervisorNameKey(name),jobTitle,now,id);
      await this.enqueue(id,{id,name,jobTitle,updatedAt:now});
    });
    return this.supervisor(id);
  }

  async setSupervisorActive(id:string,isActive:boolean):Promise<void>{
    await this.supervisor(id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE supervisors SET is_active=?,updated_at=? WHERE id=?',isActive?1:0,now,id);
      await this.enqueue(id,{id,isActive,updatedAt:now});
    });
  }

  async saveSupervisorSignature(id:string,strokes:string[]):Promise<Supervisor>{
    const issues=validateSignatureStrokes(strokes);if(issues.length)throw new Error(issues.join('\n'));
    await this.supervisor(id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE supervisors SET signature_json=?,signature_updated_at=?,updated_at=? WHERE id=?',JSON.stringify(strokes),now,now,id);
      await this.enqueue(id,{id,hasSignature:strokes.length>0,signatureUpdatedAt:now,updatedAt:now});
    });
    return this.supervisor(id);
  }

  private async supervisor(id:string):Promise<Supervisor>{
    const row=await this.db.getFirstAsync<SupervisorRow>('SELECT * FROM supervisors WHERE id=?',id);
    if(!row)throw new Error('Supervisor was not found.');
    return fromRow(row);
  }

  private async assertNameFree(name:string,exceptId:string|null):Promise<void>{
    const clash=await this.db.getFirstAsync<{name:string}>('SELECT name FROM supervisors WHERE name_key=? AND id<>?',supervisorNameKey(name),exceptId??'');
    if(clash)throw new Error(`A supervisor named "${clash.name}" already exists.`);
  }

  private async enqueue(id:string,payload:unknown):Promise<void>{
    await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES ('supervisor',?,'upsert',?,?)",id,JSON.stringify(payload),new Date().toISOString());
  }
}
