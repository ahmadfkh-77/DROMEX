import type {SQLiteDatabase} from 'expo-sqlite';

import {
  DEFAULT_SERIES_ID,formatSeriesNumber,normalizeSeriesPrefix,recordYear,validateSeriesDraft,
  type LoadNumberPreview,type LoadNumberSeries,type LoadNumberSeriesDraft,
} from '../../domain/loadNumberSeries';
import type {LoadNumberSeriesRepository} from './LoadNumberSeriesRepository';

type SeriesRow={id:string;prefix:string;prefix_key:string;display_name:string;is_default:number;is_active:number;created_at:string;updated_at:string};
type SeriesSummaryRow=SeriesRow&{issued_count:number;item_ids:string|null};
export type IssuedLoadNumber={loadNumber:string;seriesId:string;seriesName:string};

const makeId=()=>`series_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
const cleanName=(value:string)=>value.trim().replace(/\s+/g,' ');
const thisYear=()=>new Date().getFullYear();

/** The series a load of this item uses now: its assigned active series, otherwise the default. */
async function resolveSeries(db:SQLiteDatabase,itemId:string):Promise<SeriesRow>{
  const assigned=await db.getFirstAsync<SeriesRow>(`SELECT s.* FROM catalog_items ci JOIN load_number_series s ON s.id = ci.load_number_series_id
    WHERE ci.id = ? AND s.is_active = 1`,itemId);
  if(assigned)return assigned;
  const fallback=await db.getFirstAsync<SeriesRow>('SELECT * FROM load_number_series WHERE is_default = 1');
  if(!fallback)throw new Error('The default load number series is missing.');
  return fallback;
}

/** DEC-504. The lifetime counter lives in the counters table under this year value; per-year rows are builds 23 to 25. */
const LIFETIME_COUNTER_YEAR=0;

/**
 * DEC-504. The count the next load of this series receives. A series that has no lifetime counter yet
 * continues after every number it already issued in the PREFIX-YEAR-NNN format, so the count is never
 * restarted and no number is reused.
 */
async function nextLifetimeSequence(db:SQLiteDatabase,series:Pick<SeriesRow,'prefix' | 'prefix_key'>):Promise<number>{
  const counter=await db.getFirstAsync<{next_number:number}>('SELECT next_number FROM load_number_counters WHERE prefix_key = ? AND year = ?',series.prefix_key,LIFETIME_COUNTER_YEAR);
  if(counter)return Number(counter.next_number);
  const issued=await db.getFirstAsync<{issued:number}>('SELECT COUNT(*) issued FROM load_number_issues WHERE prefix = ?',series.prefix);
  return Number(issued?.issued??0)+1;
}

/**
 * DEC-500 (6), DEC-504. Gives one company load its permanent number. Call it inside the transaction that saves
 * the load, so a failure saves neither. The counter advances in one atomic statement, so two
 * confirmations can never read the same value; the unique index on loads.load_number and the history's
 * own uniqueness are the backstops. The number is written only onto a load that has none.
 */
export async function issueLoadNumber(db:SQLiteDatabase,input:{loadId:string;itemId:string;recordDate:string;issuedAt:string}):Promise<IssuedLoadNumber>{
  const series=await resolveSeries(db,input.itemId);
  const year=recordYear(input.recordDate);
  // Seed once from what the series already issued, then advance in one atomic statement.
  await db.runAsync('INSERT OR IGNORE INTO load_number_counters (prefix_key, year, next_number) SELECT ?, ?, COUNT(*) + 1 FROM load_number_issues WHERE prefix = ?',series.prefix_key,LIFETIME_COUNTER_YEAR,series.prefix);
  const counter=await db.getFirstAsync<{sequence:number}>(`UPDATE load_number_counters SET next_number = next_number + 1
    WHERE prefix_key = ? AND year = ? RETURNING next_number - 1 AS sequence`,series.prefix_key,LIFETIME_COUNTER_YEAR);
  if(!counter)throw new Error('The load number could not be generated.');
  const loadNumber=formatSeriesNumber(series.prefix,Number(counter.sequence));
  const updated=await db.runAsync('UPDATE loads SET load_number = ?, load_number_series_id = ?, load_number_series_name = ? WHERE id = ? AND load_number IS NULL',loadNumber,series.id,series.display_name,input.loadId);
  if(updated.changes!==1)throw new Error('This load already has a load number.');
  await db.runAsync('INSERT INTO load_number_issues (load_number, load_id, series_id, prefix, year, sequence, item_id, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    loadNumber,input.loadId,series.id,series.prefix,year,Number(counter.sequence),input.itemId,input.issuedAt);
  return {loadNumber,seriesId:series.id,seriesName:series.display_name};
}

export class SqliteLoadNumberSeriesRepository implements LoadNumberSeriesRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async listSeries(year=thisYear()):Promise<LoadNumberSeries[]>{
    const rows=await this.db.getAllAsync<SeriesSummaryRow>(`SELECT s.*,
        (SELECT COUNT(*) FROM load_number_issues i WHERE i.prefix = s.prefix) issued_count,
        (SELECT group_concat(ci.id, char(31)) FROM (SELECT id FROM catalog_items WHERE load_number_series_id = s.id ORDER BY name COLLATE NOCASE, id) ci) item_ids
      FROM load_number_series s ORDER BY s.is_default DESC, s.prefix`);
    return Promise.all(rows.map(async row=>({
      id:row.id,prefix:row.prefix,displayName:row.display_name,isDefault:row.is_default===1,isActive:row.is_active===1,
      issuedCount:Number(row.issued_count),prefixLocked:Number(row.issued_count)>0,
      itemIds:row.is_default===1||!row.item_ids?[]:row.item_ids.split('\u001f'),
      nextNumber:formatSeriesNumber(row.prefix,await nextLifetimeSequence(this.db,row)),createdAt:row.created_at,updatedAt:row.updated_at,
    })));
  }

  async createSeries(draft:LoadNumberSeriesDraft):Promise<LoadNumberSeries>{
    const existing=await this.listSeries();
    const issues=validateSeriesDraft(draft,existing);if(issues.length)throw new Error(issues.join('\n'));
    const id=makeId(),now=new Date().toISOString(),prefix=normalizeSeriesPrefix(draft.prefix),name=cleanName(draft.displayName);
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO load_number_series (id, prefix, prefix_key, display_name, is_default, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)',id,prefix,prefix,name,now,now);
      await this.setItems(id,draft.itemIds,now);
      await this.enqueue(id,{id,prefix,displayName:name,itemIds:draft.itemIds,isActive:true,updatedAt:now});
    });
    return this.series(id);
  }

  async updateSeries(id:string,draft:LoadNumberSeriesDraft):Promise<LoadNumberSeries>{
    const current=await this.series(id);
    const prefix=normalizeSeriesPrefix(draft.prefix);
    if(current.prefixLocked&&prefix!==current.prefix)throw new Error('This prefix is locked because loads already carry it.');
    const issues=validateSeriesDraft(draft,await this.listSeries(),id);if(issues.length)throw new Error(issues.join('\n'));
    const now=new Date().toISOString(),name=cleanName(draft.displayName);
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE load_number_series SET prefix = ?, prefix_key = ?, display_name = ?, updated_at = ? WHERE id = ?',prefix,prefix,name,now,id);
      if(!current.isDefault)await this.setItems(id,draft.itemIds,now);
      await this.enqueue(id,{id,prefix,displayName:name,itemIds:current.isDefault?[]:draft.itemIds,updatedAt:now});
    });
    return this.series(id);
  }

  async setSeriesActive(id:string,isActive:boolean):Promise<void>{
    const current=await this.series(id);
    if(current.isDefault&&!isActive)throw new Error('The default series is always active.');
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE load_number_series SET is_active = ?, updated_at = ? WHERE id = ?',isActive?1:0,now,id);
      await this.enqueue(id,{id,isActive,updatedAt:now});
    });
  }

  /** Assigns one item to a series; null (or the default series) means "use the default". */
  async assignItem(itemId:string,seriesId:string|null):Promise<void>{
    let target:string|null=null;
    if(seriesId&&seriesId!==DEFAULT_SERIES_ID){
      const series=await this.db.getFirstAsync<SeriesRow>('SELECT * FROM load_number_series WHERE id = ?',seriesId);
      if(!series||series.is_active!==1)throw new Error('Choose an active series.');
      target=series.is_default===1?null:series.id;
    }
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      const result=await this.db.runAsync('UPDATE catalog_items SET load_number_series_id = ?, updated_at = ? WHERE id = ?',target,now,itemId);
      if(result.changes!==1)throw new Error('The item was not found.');
      await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES ('loadNumberSeriesAssignment',?,'upsert',?,?)",itemId,JSON.stringify({itemId,seriesId:target,updatedAt:now}),now);
    });
  }

  async previewNextLoadNumber(itemId:string,recordDate:string):Promise<LoadNumberPreview>{
    const series=await resolveSeries(this.db,itemId);
    recordYear(recordDate);
    return {seriesId:series.id,prefix:series.prefix,displayName:series.display_name,loadNumber:formatSeriesNumber(series.prefix,await nextLifetimeSequence(this.db,series))};
  }

  private async setItems(seriesId:string,itemIds:readonly string[],now:string):Promise<void>{
    const unique=[...new Set(itemIds)];
    await this.db.runAsync('UPDATE catalog_items SET load_number_series_id = NULL, updated_at = ? WHERE load_number_series_id = ?',now,seriesId);
    for(const itemId of unique){
      const result=await this.db.runAsync('UPDATE catalog_items SET load_number_series_id = ?, updated_at = ? WHERE id = ?',seriesId,now,itemId);
      if(result.changes!==1)throw new Error('An assigned item was not found.');
    }
  }

  private async series(id:string):Promise<LoadNumberSeries>{
    const found=(await this.listSeries()).find(value=>value.id===id);
    if(!found)throw new Error('The load number series was not found.');
    return found;
  }

  private async enqueue(id:string,payload:unknown):Promise<void>{
    await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES ('loadNumberSeries',?,'upsert',?,?)",id,JSON.stringify(payload),new Date().toISOString());
  }
}
