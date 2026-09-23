import type {SQLiteDatabase} from 'expo-sqlite';

import {
  customDirectoryNameKey,normalizeCustomDirectoryText,validateCustomDirectoryDraft,validateCustomDirectoryEntryDraft,
  type CustomDirectory,type CustomDirectoryDraft,type CustomDirectoryEntry,type CustomDirectoryEntryDraft,type CustomDirectoryOption,
} from '../../domain/customDirectories';
import type {CustomDirectoryRepository} from './CustomDirectoryRepository';

type DirectoryRow={id:string;name:string;description:string|null;display_order:number;is_active:number;created_at:string;updated_at:string};
type EntryRow={id:string;directory_id:string;name:string;identifier:string|null;notes:string|null;display_order:number;is_active:number;created_at:string;updated_at:string};

const directoryFromRow=(row:DirectoryRow):CustomDirectory=>({id:row.id,name:row.name,description:row.description,displayOrder:row.display_order,isActive:row.is_active===1,createdAt:row.created_at,updatedAt:row.updated_at});
const entryFromRow=(row:EntryRow):CustomDirectoryEntry=>({id:row.id,directoryId:row.directory_id,name:row.name,identifier:row.identifier,notes:row.notes,displayOrder:row.display_order,isActive:row.is_active===1,createdAt:row.created_at,updatedAt:row.updated_at});
const makeId=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
const optional=(value:string|undefined)=>normalizeCustomDirectoryText(value)||null;
const notes=(value:string|undefined)=>(value??'').trim()||null;

/**
 * DEC-478. name_key is computed here and only here, through the domain's normalization, and SQLite's
 * unique indexes enforce it. Every write appends a sync_outbox entry in the same transaction.
 */
export class SqliteCustomDirectoryRepository implements CustomDirectoryRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async listDirectories():Promise<CustomDirectory[]>{
    return (await this.db.getAllAsync<DirectoryRow>('SELECT * FROM custom_directories ORDER BY display_order, name COLLATE NOCASE, id')).map(directoryFromRow);
  }

  async createDirectory(draft:CustomDirectoryDraft):Promise<CustomDirectory>{
    const issues=validateCustomDirectoryDraft(draft);if(issues.length)throw new Error(issues.join('\n'));
    const name=normalizeCustomDirectoryText(draft.name);
    await this.assertDirectoryNameFree(name,null);
    const id=makeId('custom_directory'),now=new Date().toISOString();
    const order=await this.db.getFirstAsync<{next:number}>('SELECT COALESCE(MAX(display_order),-1)+1 next FROM custom_directories');
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO custom_directories (id,name,name_key,description,display_order,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
        id,name,customDirectoryNameKey(name),notes(draft.description),order?.next??0,now,now);
      await this.enqueue('customDirectory',id,{id,name,description:notes(draft.description),isActive:true,updatedAt:now});
    });
    return this.directory(id);
  }

  async updateDirectory(id:string,draft:CustomDirectoryDraft):Promise<CustomDirectory>{
    const issues=validateCustomDirectoryDraft(draft);if(issues.length)throw new Error(issues.join('\n'));
    await this.directory(id);
    const name=normalizeCustomDirectoryText(draft.name);
    await this.assertDirectoryNameFree(name,id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE custom_directories SET name=?,name_key=?,description=?,updated_at=? WHERE id=?',name,customDirectoryNameKey(name),notes(draft.description),now,id);
      await this.enqueue('customDirectory',id,{id,name,description:notes(draft.description),updatedAt:now});
    });
    return this.directory(id);
  }

  async setDirectoryActive(id:string,isActive:boolean):Promise<void>{
    await this.directory(id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE custom_directories SET is_active=?,updated_at=? WHERE id=?',isActive?1:0,now,id);
      await this.enqueue('customDirectory',id,{id,isActive,updatedAt:now});
    });
  }

  async moveDirectory(id:string,direction:-1|1):Promise<void>{
    await this.swap('custom_directories','customDirectory',(await this.listDirectories()).map(value=>value.id),id,direction);
  }

  async listEntries(directoryId:string):Promise<CustomDirectoryEntry[]>{
    return (await this.db.getAllAsync<EntryRow>('SELECT * FROM custom_directory_entries WHERE directory_id=? ORDER BY display_order, name COLLATE NOCASE, id',directoryId)).map(entryFromRow);
  }

  async createEntry(directoryId:string,draft:CustomDirectoryEntryDraft):Promise<CustomDirectoryEntry>{
    const issues=validateCustomDirectoryEntryDraft(draft);if(issues.length)throw new Error(issues.join('\n'));
    const directory=await this.directory(directoryId);
    const name=normalizeCustomDirectoryText(draft.name);
    await this.assertEntryNameFree(directory,name,null);
    const id=makeId('custom_entry'),now=new Date().toISOString();
    const order=await this.db.getFirstAsync<{next:number}>('SELECT COALESCE(MAX(display_order),-1)+1 next FROM custom_directory_entries WHERE directory_id=?',directoryId);
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO custom_directory_entries (id,directory_id,name,name_key,identifier,notes,display_order,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
        id,directoryId,name,customDirectoryNameKey(name),optional(draft.identifier),notes(draft.notes),order?.next??0,now,now);
      await this.enqueue('customDirectoryEntry',id,{id,directoryId,name,identifier:optional(draft.identifier),notes:notes(draft.notes),isActive:true,updatedAt:now});
    });
    return this.entry(id);
  }

  async updateEntry(id:string,draft:CustomDirectoryEntryDraft):Promise<CustomDirectoryEntry>{
    const issues=validateCustomDirectoryEntryDraft(draft);if(issues.length)throw new Error(issues.join('\n'));
    const current=await this.entry(id);
    const name=normalizeCustomDirectoryText(draft.name);
    await this.assertEntryNameFree(await this.directory(current.directoryId),name,id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE custom_directory_entries SET name=?,name_key=?,identifier=?,notes=?,updated_at=? WHERE id=?',name,customDirectoryNameKey(name),optional(draft.identifier),notes(draft.notes),now,id);
      await this.enqueue('customDirectoryEntry',id,{id,name,identifier:optional(draft.identifier),notes:notes(draft.notes),updatedAt:now});
    });
    return this.entry(id);
  }

  async setEntryActive(id:string,isActive:boolean):Promise<void>{
    await this.entry(id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE custom_directory_entries SET is_active=?,updated_at=? WHERE id=?',isActive?1:0,now,id);
      await this.enqueue('customDirectoryEntry',id,{id,isActive,updatedAt:now});
    });
  }

  async moveEntry(id:string,direction:-1|1):Promise<void>{
    const entry=await this.entry(id);
    await this.swap('custom_directory_entries','customDirectoryEntry',(await this.listEntries(entry.directoryId)).map(value=>value.id),id,direction);
  }

  async listSelectionOptions():Promise<CustomDirectoryOption[]>{
    const [directories,entries]=await Promise.all([
      this.db.getAllAsync<DirectoryRow>('SELECT * FROM custom_directories WHERE is_active=1 ORDER BY display_order, name COLLATE NOCASE, id'),
      this.db.getAllAsync<EntryRow>('SELECT e.* FROM custom_directory_entries e JOIN custom_directories d ON d.id=e.directory_id WHERE e.is_active=1 AND d.is_active=1 ORDER BY e.display_order, e.name COLLATE NOCASE, e.id'),
    ]);
    return directories.map(directoryFromRow).map(directory=>({directory,entries:entries.filter(row=>row.directory_id===directory.id).map(entryFromRow)})).filter(group=>group.entries.length>0);
  }

  private async directory(id:string):Promise<CustomDirectory>{
    const row=await this.db.getFirstAsync<DirectoryRow>('SELECT * FROM custom_directories WHERE id=?',id);
    if(!row)throw new Error('Directory was not found.');
    return directoryFromRow(row);
  }

  private async entry(id:string):Promise<CustomDirectoryEntry>{
    const row=await this.db.getFirstAsync<EntryRow>('SELECT * FROM custom_directory_entries WHERE id=?',id);
    if(!row)throw new Error('Entry was not found.');
    return entryFromRow(row);
  }

  private async assertDirectoryNameFree(name:string,exceptId:string|null):Promise<void>{
    const clash=await this.db.getFirstAsync<{name:string}>('SELECT name FROM custom_directories WHERE name_key=? AND id<>?',customDirectoryNameKey(name),exceptId??'');
    if(clash)throw new Error(`A directory named "${clash.name}" already exists.`);
  }

  private async assertEntryNameFree(directory:CustomDirectory,name:string,exceptId:string|null):Promise<void>{
    const clash=await this.db.getFirstAsync<{name:string}>('SELECT name FROM custom_directory_entries WHERE directory_id=? AND name_key=? AND id<>?',directory.id,customDirectoryNameKey(name),exceptId??'');
    if(clash)throw new Error(`"${clash.name}" is already in ${directory.name}.`);
  }

  /** Renumbers the whole list after swapping two neighbours, so display_order stays dense and unambiguous. */
  private async swap(table:'custom_directories'|'custom_directory_entries',entityType:string,orderedIds:string[],id:string,direction:-1|1):Promise<void>{
    const index=orderedIds.indexOf(id),target=index+direction;
    if(index<0||target<0||target>=orderedIds.length)return;
    const next=[...orderedIds];[next[index],next[target]]=[next[target]!,next[index]!];
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      for(const [order,rowId] of next.entries())await this.db.runAsync(`UPDATE ${table} SET display_order=? WHERE id=?`,order,rowId);
      await this.enqueue(entityType,id,{id,reordered:true,updatedAt:now});
    });
  }

  private async enqueue(entityType:string,entityId:string,payload:unknown):Promise<void>{
    await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,'upsert',?,?)",entityType,entityId,JSON.stringify(payload),new Date().toISOString());
  }
}
