import type {SQLiteDatabase} from 'expo-sqlite';

import type {ContractHistoryKind} from '../../domain/contractQuantities';

/** Which load table a contract link lives on: company loads (`loads`) or supplier loads (`quarry_purchases`). */
export type ContractLoadSource='company'|'supplier';
export const contractLoadTable=(source:ContractLoadSource)=>source==='company'?'loads':'quarry_purchases';

const makeId=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;

/** Appends one line to a target's history. The table is append-only: a trigger refuses a change or a delete. */
export async function insertContractHistory(db:SQLiteDatabase,entry:{contractItemId:string;kind:ContractHistoryKind;reason:string|null;details:Record<string,unknown>;createdAt:string}):Promise<void>{
  await db.runAsync('INSERT INTO contract_item_history (id,contract_item_id,kind,reason,details_json,created_at) VALUES (?,?,?,?,?,?)',
    makeId('contract_history'),entry.contractItemId,entry.kind,entry.reason,JSON.stringify(entry.details),entry.createdAt);
}

/**
 * Option 1 (DEC-522). Called inside the transaction of a load correction: when the corrected load now belongs to another project (or to
 * no project), or its material is no longer one of the item's materials, the link is removed and the item's history says why. A load of
 * another project must never count in this project's contract. A quantity, date, driver or price change keeps the link.
 */
export async function reconcileContractLink(db:SQLiteDatabase,source:ContractLoadSource,loadId:string,now:string):Promise<void>{
  const table=contractLoadTable(source);
  const row=await db.getFirstAsync<{contract_item_id:string|null;project_id:string|null;item_id:string}>(`SELECT contract_item_id,project_id,item_id FROM ${table} WHERE id=?`,loadId);
  if(!row?.contract_item_id)return;
  const item=await db.getFirstAsync<{project_id:string}>('SELECT project_id FROM contract_items WHERE id=?',row.contract_item_id);
  let reason:string|null=null;
  if(!item||item.project_id!==row.project_id)reason='Project changed in correction';
  else if(!await db.getFirstAsync('SELECT 1 one FROM contract_item_materials WHERE contract_item_id=? AND item_id=? AND removed_at IS NULL',row.contract_item_id,row.item_id))reason='Material changed in correction';
  if(!reason)return;
  await db.runAsync(`UPDATE ${table} SET contract_item_id=NULL WHERE id=?`,loadId);
  await insertContractHistory(db,{contractItemId:row.contract_item_id,kind:'load_unlinked',reason,details:{source,loadId,automatic:true},createdAt:now});
}

/**
 * DEC-522 Phase C. Saves the target chosen while recording a load, inside the load's own transaction, and records it in the item's
 * history (no reason is needed at confirmation). Undefined or '' means Not linked. The item must be an open item of the load's own project
 * that lists the load's material; otherwise the error rolls the whole confirmation back, unless `keepLoadIfInvalid` is set (a +1 Trip
 * copying an item that was cancelled since), in which case the load simply saves unlinked.
 */
export async function linkAtConfirmation(db:SQLiteDatabase,source:ContractLoadSource,loadId:string,contractItemId:string|undefined,now:string,options:{keepLoadIfInvalid?:boolean}={}):Promise<void>{
  if(!contractItemId)return;
  const table=contractLoadTable(source);
  const load=await db.getFirstAsync<{project_id:string|null;item_id:string;item_name:string;reference:string}>(
    source==='company'?'SELECT project_id,item_id,item_name,COALESCE(load_number,transaction_number) reference FROM loads WHERE id=?':'SELECT project_id,item_id,item_name,purchase_number reference FROM quarry_purchases WHERE id=?',loadId);
  const item=await db.getFirstAsync<{project_id:string;cancelled_at:string|null}>('SELECT project_id,cancelled_at FROM contract_items WHERE id=?',contractItemId);
  let problem:string|null=null;
  if(!load||!item)problem='The chosen target was not found.';
  else if(item.cancelled_at)problem='The chosen target is cancelled. Choose another or Not linked.';
  else if(item.project_id!==load.project_id)problem='The chosen target belongs to another project.';
  else if(!await db.getFirstAsync('SELECT 1 one FROM contract_item_materials WHERE contract_item_id=? AND item_id=? AND removed_at IS NULL',contractItemId,load.item_id))problem=`${load.item_name} is not one of the materials of the chosen target.`;
  if(problem){if(options.keepLoadIfInvalid)return;throw new Error(problem);}
  await db.runAsync(`UPDATE ${table} SET contract_item_id=? WHERE id=?`,contractItemId,loadId);
  await insertContractHistory(db,{contractItemId,kind:'load_linked',reason:null,details:{source,loadId,reference:load!.reference,atConfirmation:true},createdAt:now});
}
