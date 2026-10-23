import type {SQLiteDatabase} from 'expo-sqlite';

import type {ContractHistoryKind} from '../../domain/contractQuantities';

/** Which load table a contract link lives on: company loads (`loads`) or supplier loads (`quarry_purchases`). */
export type ContractLoadSource='company'|'supplier';
export const contractLoadTable=(source:ContractLoadSource)=>source==='company'?'loads':'quarry_purchases';

const makeId=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;

/** Appends one line to a contract item's history. The table is append-only: a trigger refuses a change or a delete. */
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
