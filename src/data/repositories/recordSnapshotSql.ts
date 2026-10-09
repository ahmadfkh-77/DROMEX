import type {DocumentRecordType,RecordSnapshot} from '../../domain/businessDocuments';
import {NO_CUSTOMER_KEY} from '../../domain/companyTotals';

/**
 * DEC-500. The one way company loads and Supplier Loads are read as document-eligible records, shared
 * by Business Documents, Company Totals and Company Load Totals so that every view groups by the same
 * item key and unit key and copies the same fields. Keys follow DEC-481: a stable id where one exists
 * ("id:<item>", a unit id), otherwise a normalized legacy name or "symbol:<unit>".
 */
export const keyOf=(idColumn:string,nameColumn:string)=>`CASE WHEN ${idColumn} IS NOT NULL THEN 'id:' || ${idColumn} ELSE 'name:' || lower(trim(${nameColumn})) END`;
/** How many audited corrections a record carries; unreadable history counts as none. */
const historyCount=(column:string)=>`CASE WHEN json_valid(${column}) AND json_type(${column}) = 'array' THEN json_array_length(${column}) ELSE 0 END`;
// Phase 2. A direct load that used a conversion is counted in the conversion's output unit, like a weighbridge load.
export const LOAD_UNIT_SQL="CASE WHEN l.quantity_method = 'direct' AND COALESCE(l.conversion_rule,'Entered directly') = 'Entered directly' THEN l.direct_unit_id ELSE c.output_unit_id END";

/** Company loads (customer side). `record_day` is the local calendar date of the load. */
export const COMPANY_LOAD_RECORDS=`SELECT 'company_load' record_type, l.id record_id, 'company_load:' || l.id record_key, l.transaction_number reference,
    l.load_number, l.load_number_series_name, l.load_number_series_id series_id,
    ${keyOf('l.item_id','l.item_name')} item_key, l.item_name, COALESCE(${LOAD_UNIT_SQL}, 'symbol:' || l.output_unit_symbol) unit_key, l.output_unit_symbol unit_symbol,
    l.billed_quantity quantity, l.project_id, l.project_name, l.customer_id party_id, l.customer_name party_name,
    l.confirmed_at recorded_at, l.entered_at, l.unit_price_usd_cents unit_price_cents, 'per_unit' price_basis,
    l.subtotal_usd_cents subtotal_cents, l.vat_rate_basis_points vat_rate_basis_points, l.vat_amount_usd_cents vat_cents, l.final_total_usd_cents total_cents,
    NULL supplier_reference, COALESCE(l.status,'Active') record_status, l.is_archived archived, date(l.confirmed_at,'localtime') record_day, l.payment_status,
    l.cancellation_reason, ${historyCount('l.correction_history_json')} correction_count,
    COALESCE(l.project_location, l.destination_address) destination, l.driver_name, l.truck_plate, NULL delivery_method
  FROM loads l LEFT JOIN conversion_options c ON c.id = l.conversion_id`;

/** Supplier Loads (supplier side). */
export const SUPPLIER_LOAD_RECORDS=`SELECT 'supplier_load' record_type, q.id record_id, 'supplier_load:' || q.id record_key, q.purchase_number reference,
    NULL load_number, NULL load_number_series_name, NULL series_id,
    ${keyOf('q.item_id','q.item_name')} item_key, q.item_name, COALESCE(q.unit_id, 'symbol:' || COALESCE(q.unit_symbol,'m³')) unit_key, COALESCE(q.unit_symbol,'m³') unit_symbol,
    q.quantity_cubic_metres quantity, q.project_id, q.project_name, q.supplier_id party_id, q.supplier_name party_name,
    q.confirmed_at recorded_at, q.entered_at, q.unit_price_usd_cents unit_price_cents, COALESCE(q.price_basis,'per_unit') price_basis,
    q.subtotal_usd_cents subtotal_cents, q.vat_rate_basis_points vat_rate_basis_points, q.vat_amount_usd_cents vat_cents, q.final_total_usd_cents total_cents,
    q.supplier_ticket_number supplier_reference, COALESCE(q.status,'Active') record_status, 0 archived, date(q.confirmed_at,'localtime') record_day, q.payment_status,
    q.cancellation_reason, ${historyCount('q.correction_history_json')} correction_count,
    NULL destination, q.driver_name, q.truck_plate, COALESCE(q.delivery_method,'company') delivery_method
  FROM quarry_purchases q`;

export type RecordRow={
  record_type:DocumentRecordType;record_id:string;record_key:string;reference:string;load_number:string|null;load_number_series_name:string|null;series_id:string|null;
  item_key:string;item_name:string;unit_key:string;unit_symbol:string;quantity:number;project_id:string|null;project_name:string|null;party_id:string;party_name:string;
  recorded_at:string;entered_at:string|null;unit_price_cents:number|null;price_basis:'per_unit'|'whole';subtotal_cents:number|null;vat_rate_basis_points:number|null;vat_cents:number|null;total_cents:number|null;
  supplier_reference:string|null;record_status:'Active'|'Cancelled';archived:number;record_day:string;payment_status:string;
  cancellation_reason:string|null;correction_count:number;
  /** Read-only detail for lists and PDFs; never part of an immutable document snapshot. */
  destination?:string|null;driver_name?:string|null;truck_plate?:string|null;delivery_method?:'company'|'supplier'|null;
};

const round=(value:unknown)=>Math.round(Number(value??0)*1e6)/1e6;
const cents=(value:unknown)=>value==null?null:Number(value);

export function snapshotFromRow(row:RecordRow):RecordSnapshot{
  return {
    recordType:row.record_type,recordId:row.record_id,reference:row.reference,loadNumber:row.load_number??null,loadNumberSeriesName:row.load_number_series_name??null,
    itemKey:row.item_key,itemName:row.item_name,unitKey:row.unit_key,unitSymbol:row.unit_symbol,quantity:round(row.quantity),
    projectId:row.project_id??null,projectName:row.project_name??null,partyId:row.party_id,partyName:row.party_name,recordedAt:row.recorded_at,enteredAt:row.entered_at??null,
    unitPriceCents:cents(row.unit_price_cents),priceBasis:row.price_basis==='whole'?'whole':'per_unit',subtotalCents:cents(row.subtotal_cents),
    vatRateBasisPoints:cents(row.vat_rate_basis_points),vatCents:cents(row.vat_cents),totalCents:cents(row.total_cents),supplierReference:row.supplier_reference??null,
  };
}

/**
 * The customer filter's WHERE condition on a column holding a company load's customer id, shared by Totals and by the
 * document start list so both match the same loads. Ids match the load's own customer; NO_CUSTOMER_KEY matches the owner's own
 * company (the customer on its own projects) and any load whose customer is no longer on file, so those loads stay reachable.
 */
export function customerMatchSql(keys:readonly string[],column:string,params:unknown[]):string{
  const ids=keys.filter(key=>key!==NO_CUSTOMER_KEY);
  const parts:string[]=[];
  if(ids.length){parts.push(`${column} IN (${ids.map(()=>'?').join(',')})`);params.push(...ids);}
  if(keys.includes(NO_CUSTOMER_KEY))parts.push(`(${column} IN (SELECT id FROM customers WHERE is_own_company = 1) OR ${column} NOT IN (SELECT id FROM customers))`);
  return `(${parts.join(' OR ')||'0'})`;
}
