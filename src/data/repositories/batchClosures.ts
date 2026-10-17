import type {SQLiteDatabase} from 'expo-sqlite';

import {activeClosure,closureMoment,validateClosureReason,type BatchClosure,type BatchClosureKind} from '../../domain/batchClosure';

/**
 * The SQLite side of closing a batch by hand. One table serves Bitumen, Diesel and Stock; a closure is reopened by stamping it, never deleted,
 * so the history of every close and reopen stays. The domain decides what a closure means for each kind of batch.
 */
type ClosureRow={id:string;batch_id:string;closed_on:string;closed_at:string;leftover:number;reason:string;created_at:string;reopened_at:string|null;reopen_reason:string|null};
const fromRow=(row:ClosureRow):BatchClosure=>({id:row.id,batchId:row.batch_id,closedOn:row.closed_on,closedAt:row.closed_at,leftover:row.leftover,reason:row.reason,createdAt:row.created_at,reopenedAt:row.reopened_at,reopenReason:row.reopen_reason});
const round3=(value:number)=>Math.round(value*1000)/1000;

/** Every closure of one kind, the reopened ones too, oldest first. */
export async function loadClosures(db:SQLiteDatabase,kind:BatchClosureKind):Promise<BatchClosure[]>{
  return (await db.getAllAsync<ClosureRow>('SELECT * FROM batch_closures WHERE batch_kind=? ORDER BY created_at,rowid',kind)).map(fromRow);
}

/** Closes one batch. The caller has already checked that the batch exists, is not cancelled and is open, and works out `leftover`. */
export async function insertClosure(db:SQLiteDatabase,kind:BatchClosureKind,batchId:string,input:{closedOn:string;reason:string;leftover:number}):Promise<BatchClosure>{
  const reason=validateClosureReason(input.reason,'closing');
  const closedAt=closureMoment(input.closedOn);
  const existing=await db.getFirstAsync<{id:string}>('SELECT id FROM batch_closures WHERE batch_kind=? AND batch_id=? AND reopened_at IS NULL',kind,batchId);
  if(existing)throw new Error('This batch is already closed.');
  const id=`batch_closure_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`,now=new Date().toISOString();
  const leftover=Math.max(0,round3(input.leftover));
  await db.runAsync('INSERT INTO batch_closures (id,batch_kind,batch_id,closed_on,closed_at,leftover,reason,created_at) VALUES (?,?,?,?,?,?,?,?)',id,kind,batchId,input.closedOn,closedAt,leftover,reason,now);
  await db.runAsync('INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)','batchClosure',id,'upsert',JSON.stringify({id,kind,batchId,closedOn:input.closedOn,leftover,reason}),now);
  return {id,batchId,closedOn:input.closedOn,closedAt,leftover,reason,createdAt:now,reopenedAt:null,reopenReason:null};
}

/** Reopens a batch that was closed by hand. The closure row stays, stamped with when and why it was reopened. */
export async function reopenClosure(db:SQLiteDatabase,kind:BatchClosureKind,batchId:string,reasonText:string):Promise<void>{
  const reason=validateClosureReason(reasonText,'reopening');
  const open=await db.getFirstAsync<{id:string}>('SELECT id FROM batch_closures WHERE batch_kind=? AND batch_id=? AND reopened_at IS NULL',kind,batchId);
  if(!open)throw new Error('This batch was not closed by hand, so there is nothing to reopen.');
  const now=new Date().toISOString();
  await db.runAsync('UPDATE batch_closures SET reopened_at=?,reopen_reason=? WHERE id=?',now,reason,open.id);
  await db.runAsync('INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)','batchClosure',open.id,'upsert',JSON.stringify({id:open.id,kind,batchId,reopened:true,reason}),now);
}

export {activeClosure};
