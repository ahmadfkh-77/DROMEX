import type {SQLiteDatabase} from 'expo-sqlite';

import {localDateKey} from '../../domain/fuel';
import {
  allocateDieselBatches,fillCost,formatBatchNumber,previewTankFill,
  type AllocationChange,type AllocationInput,type AllocationNoteLine,type AllocationResult,type BatchDetail,type BatchInput,type DieselBatchOverview,type FillBatchInfo,type TankFillPreviewResult,
} from '../../domain/fuelBatches';

/**
 * DEC-492. The SQLite side of diesel batches: which records feed the allocation, the persisted copy of
 * the derived allocation, and the writes that keep it current. The domain module decides who gets which
 * litres; this module only loads, persists, and reports.
 */
type BatchRow={
  id:string;batch_number:string;year:number;sequence:number;kind:'delivery'|'opening';delivery_movement_id:string|null;opening_basis:'dip'|'calculated'|null;
  opening_gauge_movement_id:string|null;arrived_at:string;delivered_litres:number;price_per_litre_usd_cents:number|null;invoice_number:string|null;
  supplier_id:string|null;supplier_name:string|null;status:'Active'|'Cancelled';cancellation_reason:string|null;cancelled_at:string|null;created_at:string;
};
type FillRow={id:string;confirmed_at:string;litres:number;batch_id:string|null;price_per_litre_usd_cents:number|null;consumption_cost_usd_cents:number|null};
type GaugeRow={id:string;confirmed_at:string;litres:number};
type CachedLineRow={movement_id:string;kind:string;litres:number;batch_number:string|null};
type EventRow={id:number;movement_id:string;caused_by_movement_id:string|null;before_json:string;after_json:string;created_at:string};

const cents=(value:number)=>Math.round(value*100);
const roundLitres=(value:number)=>Math.round(value*1000)/1000;

/** When diesel batch tracking started, or null while it has not. Records dated earlier stay "Before batches". */
export async function batchTrackingStart(db:SQLiteDatabase):Promise<string|null>{
  const row=await db.getFirstAsync<{started_at:string}>("SELECT started_at FROM fuel_batch_settings WHERE id='batches'");
  return row?.started_at??null;
}

const toBatchInput=(row:BatchRow):BatchInput=>({id:row.id,batchNumber:row.batch_number,arrivedAt:row.arrived_at,deliveredLitres:row.delivered_litres,pricePerLitreUsd:row.price_per_litre_usd_cents==null?null:row.price_per_litre_usd_cents/100,status:row.status});

async function loadState(db:SQLiteDatabase){
  const startedAt=await batchTrackingStart(db);
  if(!startedAt)return null;
  const batchRows=await db.getAllAsync<BatchRow>('SELECT * FROM fuel_batches ORDER BY arrived_at,batch_number');
  // A tracked fill is an Active diesel fill from the tank at or after the start; a station fill never is.
  const fillRows=await db.getAllAsync<FillRow>(`SELECT id,confirmed_at,litres,batch_id,price_per_litre_usd_cents,consumption_cost_usd_cents FROM fuel_movements
    WHERE movement_type = 'fill' AND status = 'Active' AND COALESCE(fuel_type, 'diesel') = 'diesel' AND COALESCE(fuel_source, 'tank') = 'tank' AND confirmed_at >= ?
    ORDER BY confirmed_at, created_at, rowid`,startedAt);
  const gaugeRows=await db.getAllAsync<GaugeRow>(`SELECT id,confirmed_at,litres FROM fuel_movements
    WHERE movement_type = 'gauge' AND status = 'Active' AND confirmed_at >= ? ORDER BY confirmed_at, created_at, rowid`,startedAt);
  const input:AllocationInput={
    batches:batchRows.map(toBatchInput),
    fills:fillRows.map(row=>({id:row.id,confirmedAt:row.confirmed_at,litres:row.litres,preferredBatchId:row.batch_id})),
    gauges:gaugeRows.map(row=>({id:row.id,confirmedAt:row.confirmed_at,litres:row.litres})),
  };
  return {startedAt,batchRows,fillRows,input};
}

const noteLines=(result:AllocationResult,fillId:string):AllocationNoteLine[]=>{
  const allocation=result.fills[fillId];
  if(!allocation)return [];
  const lines:AllocationNoteLine[]=allocation.portions.map(portion=>({batch:portion.batchNumber,litres:portion.litres,kind:portion.kind}));
  if(allocation.outstandingShortfallLitres>0)lines.push({batch:null,litres:allocation.outstandingShortfallLitres,kind:'shortfall'});
  return lines;
};

async function cachedNoteLines(db:SQLiteDatabase):Promise<Map<string,AllocationNoteLine[]>>{
  const rows=await db.getAllAsync<CachedLineRow>(`SELECT a.movement_id,a.kind,a.litres,b.batch_number FROM fuel_batch_allocations a
    LEFT JOIN fuel_batches b ON b.id = a.batch_id WHERE a.kind <> 'adjustment' ORDER BY a.movement_id,a.position`);
  const map=new Map<string,AllocationNoteLine[]>();
  for(const row of rows)map.set(row.movement_id,[...(map.get(row.movement_id)??[]),{batch:row.batch_number,litres:row.litres,kind:row.kind as AllocationNoteLine['kind']}]);
  return map;
}

/**
 * Rebuilds the persisted allocation from the active records, in the caller's transaction. It also keeps
 * each tracked fill's price and cost at its batch prices (null when any litres are unpriced, never zero)
 * and notes, append-only, every earlier fill whose batches changed because of this entry.
 */
export async function recalculateDieselBatches(db:SQLiteDatabase,causedByMovementId:string|null):Promise<void>{
  const state=await loadState(db);
  if(!state)return;
  const result=allocateDieselBatches(state.input);
  const before=await cachedNoteLines(db);
  await db.runAsync('DELETE FROM fuel_batch_allocations');
  for(const fillId of Object.keys(result.fills)){
    const allocation=result.fills[fillId]!;
    let position=0;
    for(const portion of allocation.portions)await db.runAsync('INSERT INTO fuel_batch_allocations (movement_id,batch_id,kind,litres,position) VALUES (?,?,?,?,?)',fillId,portion.batchId,portion.kind,portion.litres,position++);
    if(allocation.outstandingShortfallLitres>0)await db.runAsync("INSERT INTO fuel_batch_allocations (movement_id,batch_id,kind,litres,position) VALUES (?,NULL,'shortfall',?,?)",fillId,allocation.outstandingShortfallLitres,position);
  }
  const adjustmentPosition=new Map<string,number>();
  for(const adjustment of result.adjustments){
    const position=adjustmentPosition.get(adjustment.gaugeId)??0;
    adjustmentPosition.set(adjustment.gaugeId,position+1);
    await db.runAsync("INSERT INTO fuel_batch_allocations (movement_id,batch_id,kind,litres,position,calculated_litres,dip_litres) VALUES (?,?,'adjustment',?,?,?,?)",adjustment.gaugeId,adjustment.batchId,adjustment.litres,position,adjustment.calculatedLitres,adjustment.dipLitres);
  }
  const now=new Date().toISOString();
  for(const row of state.fillRows){
    const allocation=result.fills[row.id];
    if(!allocation)continue;
    const cost=fillCost(allocation,result.batches);
    const costCents=cost.fullyPriced&&cost.costUsd!=null?cents(cost.costUsd):null;
    const priceCents=costCents==null?null:Math.round(costCents/row.litres);
    if(costCents!==row.consumption_cost_usd_cents||priceCents!==row.price_per_litre_usd_cents)
      await db.runAsync('UPDATE fuel_movements SET price_per_litre_usd_cents = ?, consumption_cost_usd_cents = ?, fuel_price_history_id = NULL, price_override_reason = NULL WHERE id = ?',priceCents,costCents,row.id);
    const previous=before.get(row.id);
    if(previous&&row.id!==causedByMovementId){
      const next=noteLines(result,row.id);
      if(JSON.stringify(previous)!==JSON.stringify(next))
        await db.runAsync('INSERT INTO fuel_allocation_events (movement_id,caused_by_movement_id,before_json,after_json,created_at) VALUES (?,?,?,?,?)',row.id,causedByMovementId,JSON.stringify(previous),JSON.stringify(next),now);
    }
  }
}

const toDetail=(row:BatchRow,summary:AllocationResult['batches'][number]):BatchDetail=>({
  ...summary,
  kind:row.kind,invoiceNumber:row.invoice_number,supplierName:row.supplier_name,openingBasis:row.opening_basis,deliveryMovementId:row.delivery_movement_id,
  openingGaugeMovementId:row.opening_gauge_movement_id,cancellationReason:row.cancellation_reason,cancelledAt:row.cancelled_at,
});

/** The whole batch picture, recalculated from the records. Null until tracking has started. */
export async function loadBatchOverview(db:SQLiteDatabase):Promise<DieselBatchOverview|null>{
  const state=await loadState(db);
  if(!state)return null;
  const result=allocateDieselBatches(state.input);
  const rows=new Map(state.batchRows.map(row=>[row.id,row]));
  const fills:Record<string,FillBatchInfo>={};
  for(const [fillId,allocation] of Object.entries(result.fills))fills[fillId]={...allocation,cost:fillCost(allocation,result.batches)};
  const events=await db.getAllAsync<EventRow>('SELECT * FROM fuel_allocation_events ORDER BY id');
  const changes:AllocationChange[]=events.map(event=>({id:event.id,movementId:event.movement_id,causedByMovementId:event.caused_by_movement_id,before:JSON.parse(event.before_json),after:JSON.parse(event.after_json),createdAt:event.created_at}));
  return {
    started:true,startedAt:state.startedAt,tankLitres:result.tankLitres,overfillAlert:result.overfillAlert,outstandingShortfallLitres:result.outstandingShortfallLitres,
    batches:result.batches.map(summary=>toDetail(rows.get(summary.id)!,summary)),
    fills,
    adjustments:result.adjustments.map(adjustment=>({...adjustment,batchNumber:rows.get(adjustment.batchId)?.batch_number??''})),
    changes,
  };
}

/** The next DSL number of the arrival date's year; the counter only ever advances, so a number is never reused. */
async function nextBatchNumber(db:SQLiteDatabase,arrivedAt:string):Promise<{year:number;sequence:number;batchNumber:string}>{
  const year=Number(localDateKey(arrivedAt).slice(0,4));
  const counter=await db.getFirstAsync<{sequence:number}>(`INSERT INTO fuel_batch_counters (year,next_number) VALUES (?,2)
    ON CONFLICT(year) DO UPDATE SET next_number = next_number + 1 RETURNING next_number - 1 AS sequence`,year);
  if(!counter)throw new Error('The batch number could not be generated.');
  return {year,sequence:Number(counter.sequence),batchNumber:formatBatchNumber(year,Number(counter.sequence))};
}

/** One batch for a diesel delivery recorded after tracking started. A delivery before the start stays "Before batches". */
export async function createDeliveryBatch(db:SQLiteDatabase,delivery:{movementId:string;confirmedAt:string;litres:number;priceCents:number|null;invoiceNumber:string|null;supplierId:string|null;supplierName:string|null}):Promise<void>{
  const startedAt=await batchTrackingStart(db);
  if(!startedAt||delivery.confirmedAt<startedAt)return;
  const number=await nextBatchNumber(db,delivery.confirmedAt);
  await db.runAsync(`INSERT INTO fuel_batches (id,batch_number,year,sequence,kind,delivery_movement_id,arrived_at,delivered_litres,price_per_litre_usd_cents,invoice_number,supplier_id,supplier_name,created_at)
    VALUES (?,?,?,?,'delivery',?,?,?,?,?,?,?,?)`,`fuel_batch_${delivery.movementId}`,number.batchNumber,number.year,number.sequence,delivery.movementId,delivery.confirmedAt,delivery.litres,delivery.priceCents,delivery.invoiceNumber,delivery.supplierId,delivery.supplierName,new Date().toISOString());
}

/** Keeps a delivery's batch in step with a corrected delivery. The batch number never changes. */
export async function syncBatchWithDelivery(db:SQLiteDatabase,delivery:{movementId:string;confirmedAt:string;litres:number;priceCents:number|null;invoiceNumber:string|null;supplierId:string|null;supplierName:string|null}):Promise<void>{
  await db.runAsync('UPDATE fuel_batches SET arrived_at = ?, delivered_litres = ?, price_per_litre_usd_cents = ?, invoice_number = ?, supplier_id = ?, supplier_name = ? WHERE delivery_movement_id = ?',
    delivery.confirmedAt,delivery.litres,delivery.priceCents,delivery.invoiceNumber,delivery.supplierId,delivery.supplierName,delivery.movementId);
}

export async function assertDeliveryDateAllowsBatch(db:SQLiteDatabase,movementId:string,confirmedAt:string):Promise<void>{
  const startedAt=await batchTrackingStart(db);
  if(!startedAt)return;
  const batch=await db.getFirstAsync<{id:string}>('SELECT id FROM fuel_batches WHERE delivery_movement_id = ?',movementId);
  if(batch&&confirmedAt<startedAt)throw new Error('This delivery is a diesel batch. Its date must be on or after the day diesel batch tracking started.');
}

export async function cancelBatchOfDelivery(db:SQLiteDatabase,movementId:string,reason:string,cancelledAt:string):Promise<void>{
  await db.runAsync("UPDATE fuel_batches SET status = 'Cancelled', cancellation_reason = ?, cancelled_at = ? WHERE delivery_movement_id = ? AND status = 'Active'",reason,cancelledAt,movementId);
}

/** Writes the settings row and, when there is diesel, the Opening stock batch. Returns the batch id or null. */
export async function startTracking(db:SQLiteDatabase,input:{startedAt:string;litres:number;basis:'dip'|'calculated';gaugeMovementId:string|null;priceCents:number|null}):Promise<string|null>{
  await db.runAsync("INSERT INTO fuel_batch_settings (id,started_at,created_at) VALUES ('batches',?,?)",input.startedAt,new Date().toISOString());
  if(roundLitres(input.litres)<=0)return null;
  const number=await nextBatchNumber(db,input.startedAt);
  const id=`fuel_batch_opening_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  await db.runAsync(`INSERT INTO fuel_batches (id,batch_number,year,sequence,kind,opening_basis,opening_gauge_movement_id,arrived_at,delivered_litres,price_per_litre_usd_cents,created_at)
    VALUES (?,?,?,?,'opening',?,?,?,?,?,?)`,id,number.batchNumber,number.year,number.sequence,input.basis,input.gaugeMovementId,input.startedAt,roundLitres(input.litres),input.priceCents,new Date().toISOString());
  return id;
}

export async function cancelOpeningBatch(db:SQLiteDatabase,batchId:string,reason:string,cancelledAt:string):Promise<void>{
  await db.runAsync("UPDATE fuel_batches SET status = 'Cancelled', cancellation_reason = ?, cancelled_at = ? WHERE id = ? AND status = 'Active'",reason,cancelledAt,batchId);
}

export async function findBatch(db:SQLiteDatabase,batchId:string):Promise<BatchRow|null>{
  return db.getFirstAsync<BatchRow>('SELECT * FROM fuel_batches WHERE id = ?',batchId);
}

export function previewFromState(state:AllocationInput,fill:{litres:number;preferredBatchId:string|null;at:string}):TankFillPreviewResult{
  const preview=previewTankFill(state,fill);
  const after=allocateDieselBatches({...state,fills:[...state.fills,{id:'__preview__',confirmedAt:fill.at,litres:fill.litres,preferredBatchId:fill.preferredBatchId}]});
  return {...preview,cost:fillCost(after.fills.__preview__!,after.batches)};
}

export async function loadAllocationInput(db:SQLiteDatabase):Promise<AllocationInput|null>{
  return (await loadState(db))?.input??null;
}
