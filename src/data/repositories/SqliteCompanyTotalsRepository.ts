import type {SQLiteDatabase} from 'expo-sqlite';

import {deriveInclusion,type DocumentLink,type InclusionFilter,type InclusionState,type RecordSnapshot} from '../../domain/businessDocuments';
import {
  COMPANY_SUPPLIER_KEY,COMPANY_SUPPLIER_LABEL,LEGACY_SERIES_KEY,LEGACY_SERIES_LABEL,NO_CUSTOMER_KEY,NO_CUSTOMER_LABEL,NO_PROJECT_KEY,NO_PROJECT_LABEL,
  type CompanyDeliveryRow,type CompanyLoadTotalRow,type CustomerChoice,type CompanyTotalsData,type CompanyTotalsFilters,type CompanyUsageRow,type InclusionCounts,
} from '../../domain/companyTotals';
import type {CompanyTotalsRecord,CompanyTotalsRepository,UsageRecord} from './CompanyTotalsRepository';
import {COMPANY_LOAD_RECORDS,customerMatchSql,SUPPLIER_LOAD_RECORDS,snapshotFromRow,type RecordRow} from './recordSnapshotSql';
import {readDocumentLinks} from './SqliteBusinessDocumentRepository';

type Row=Record<string,unknown>;
const text=(value:unknown)=>typeof value==='string'?value:value==null?'':String(value);
const number=(value:unknown)=>Math.round(Number(value??0)*1e6)/1e6;
const SEP='\u001f';

/**
 * Per-record inclusion state, derived in SQL from the shared link table only (DEC-500 (3)), so totals
 * can be filtered and counted by extraction status without loading every record.
 */
const RECORDS=`WITH inc AS (
    SELECT r.record_key,
      MAX(d.status = 'Issued') issued, MAX(d.status = 'Draft') drafted, MAX(d.status = 'Cancelled' AND d.document_number IS NOT NULL) was_issued,
      group_concat(CASE WHEN d.status = 'Issued' THEN d.document_number END, char(31)) issued_numbers
    FROM business_document_records r JOIN business_documents d ON d.id = r.document_id GROUP BY r.record_key
  ),
  recs AS (
    SELECT x.*, inc.issued_numbers,
      CASE WHEN COALESCE(inc.issued,0) = 1 THEN 'included' WHEN COALESCE(inc.drafted,0) = 1 THEN 'in_draft' WHEN COALESCE(inc.was_issued,0) = 1 THEN 'previously_cancelled' ELSE 'not_included' END inclusion_state
    FROM (${COMPANY_LOAD_RECORDS} UNION ALL ${SUPPLIER_LOAD_RECORDS}) x LEFT JOIN inc ON inc.record_key = x.record_key
  )`;
const SUPPLIER_KEY="CASE WHEN recs.record_type = 'company_load' THEN 'company' ELSE 'id:' || recs.party_id END";
// DEC-506. A Supplier Load that went to a company site is grouped under the site's own key and name, never under a project.
const PROJECT_KEY=`COALESCE(recs.project_id, CASE WHEN recs.site_id IS NOT NULL THEN 'site:' || recs.site_id END, '${NO_PROJECT_KEY}')`;

const inclusionSql:Record<Exclude<InclusionFilter,'all'>,string>={
  not_included:"recs.inclusion_state IN ('not_included','previously_cancelled')",
  in_draft:"recs.inclusion_state = 'in_draft'",
  included:"recs.inclusion_state = 'included'",
  cancelled_history:"recs.inclusion_state = 'previously_cancelled'",
};

/**
 * A customer filter narrows to company loads, since a Supplier Load is not delivered to a customer. Chosen customers are
 * matched by the load's own customer id; NO_CUSTOMER_KEY matches the own company (the customer on the owner's own
 * projects) and any load whose customer is no longer on file, so those loads stay reachable.
 */
function customerCondition(keys:readonly string[],params:unknown[]):string{
  return `recs.record_type = 'company_load' AND ${customerMatchSql(keys,'recs.party_id',params)}`;
}

/** WHERE conditions shared by every delivered-record query. */
function recordConditions(filters:Partial<CompanyTotalsFilters>,status:'active'|'cancelled'|'all'='active'):[string[],unknown[]]{
  const where:string[]=['recs.archived = 0'];const params:unknown[]=[];
  if(status==='active')where.push("recs.record_status = 'Active'");
  if(status==='cancelled')where.push("recs.record_status = 'Cancelled'");
  if(filters.fromDate){where.push('recs.record_day >= ?');params.push(filters.fromDate);}
  if(filters.toDate){where.push('recs.record_day <= ?');params.push(filters.toDate);}
  if(filters.itemKey){where.push('recs.item_key = ?');params.push(filters.itemKey);}
  if(filters.unitKey){where.push('recs.unit_key = ?');params.push(filters.unitKey);}
  if(filters.projectKey){if(filters.projectKey===NO_PROJECT_KEY)where.push('recs.project_id IS NULL AND recs.site_id IS NULL');else if(filters.projectKey.startsWith('site:')){where.push('recs.site_id = ?');params.push(filters.projectKey.slice(5));}else{where.push('recs.project_id = ?');params.push(filters.projectKey);}}
  if(filters.supplierKey){if(filters.supplierKey===COMPANY_SUPPLIER_KEY)where.push("recs.record_type = 'company_load'");else{where.push("recs.record_type = 'supplier_load' AND 'id:' || recs.party_id = ?");params.push(filters.supplierKey);}}
  if(filters.seriesId){where.push("recs.record_type = 'company_load'");if(filters.seriesId===LEGACY_SERIES_KEY)where.push('recs.load_number IS NULL');else{where.push('recs.series_id = ?');params.push(filters.seriesId);}}
  if(filters.customerKeys?.length)where.push(customerCondition(filters.customerKeys,params));
  if(filters.inclusion&&filters.inclusion!=='all')where.push(inclusionSql[filters.inclusion]);
  return [where,params];
}

function inclusionCounts(row:Row):InclusionCounts{
  const total=Number(row.record_count),included=Number(row.included_count??0),inDraft=Number(row.draft_count??0);
  const includedIn=[...new Set(text(row.issued_numbers).split(SEP).filter(Boolean))].sort();
  return {total,included,inDraft,open:total-included-inDraft,includedIn};
}

/**
 * DEC-500 (1). Company-wide totals by grouped SQL over the canonical records; nothing is summed in a
 * screen and nothing is stored. Names come from the current catalog, project and supplier records where
 * they still exist (archived included), otherwise from each record's own snapshot.
 */
export class SqliteCompanyTotalsRepository implements CompanyTotalsRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async getCompanyTotals(filters:CompanyTotalsFilters):Promise<CompanyTotalsData>{
    const deliveries=filters.view==='used'?[]:await this.deliveries(filters);
    const usageHiddenReason=filters.view==='delivered'?null
      :filters.supplierKey?'Use is not recorded per supplier, so it is hidden while a supplier is chosen.'
      :filters.customerKeys?.length?'Use is not recorded per customer, so it is hidden while a customer is chosen.'
      :filters.seriesId?'Use records have no load number series, so they are hidden while a series is chosen.'
      :filters.inclusion!=='all'?'Use records are never put on documents, so they are hidden while a document status is chosen.'
      :null;
    const usage=filters.view==='delivered'||usageHiddenReason?[]:await this.usage(filters);
    return {deliveries,usage,usageHiddenReason};
  }

  private async deliveries(filters:CompanyTotalsFilters):Promise<CompanyDeliveryRow[]>{
    const [where,params]=recordConditions(filters);
    const rows=await this.db.getAllAsync<Row>(`${RECORDS}
      SELECT recs.record_type, recs.item_key, COALESCE(MAX(ci.name), MAX(recs.item_name)) item_name,
        ${PROJECT_KEY} project_key, COALESCE(MAX(p.name), MAX(recs.project_name)) project_name,
        ${SUPPLIER_KEY} supplier_key, COALESCE(MAX(s.name), MAX(CASE WHEN recs.record_type = 'supplier_load' THEN recs.party_name ELSE recs.supplier_name END)) supplier_name,
        recs.unit_key, MAX(recs.unit_symbol) unit_symbol, SUM(recs.quantity) quantity, COUNT(*) record_count,
        SUM(recs.total_cents) value_cents, COUNT(recs.unit_price_cents) priced_count,
        SUM(recs.inclusion_state = 'included') included_count, SUM(recs.inclusion_state = 'in_draft') draft_count,
        group_concat(recs.issued_numbers, char(31)) issued_numbers
      FROM recs LEFT JOIN catalog_items ci ON recs.item_key = 'id:' || ci.id LEFT JOIN projects p ON p.id = recs.project_id
        LEFT JOIN suppliers s ON recs.record_type = 'supplier_load' AND s.id = recs.party_id
      WHERE ${where.join(' AND ')}
      GROUP BY recs.record_type, recs.item_key, project_key, supplier_key, recs.unit_key`,...params as never[]);
    return rows.map(row=>{
      const company=row.record_type==='company_load';const projectKey=text(row.project_key);
      return {source:company?'company_delivery':'supplier_delivery',itemKey:text(row.item_key),itemName:text(row.item_name),projectKey,projectName:projectKey===NO_PROJECT_KEY?NO_PROJECT_LABEL:projectKey.startsWith('site:')?`${text(row.project_name)} (Site)`:text(row.project_name),
        supplierKey:text(row.supplier_key),supplierName:company?(text(row.supplier_name)||COMPANY_SUPPLIER_LABEL):text(row.supplier_name),unitKey:text(row.unit_key),unitSymbol:text(row.unit_symbol),
        quantity:number(row.quantity),recordCount:Number(row.record_count),valueCents:row.value_cents==null?null:Number(row.value_cents),pricedCount:Number(row.priced_count),inclusion:inclusionCounts(row)};
    });
  }

  private async usage(filters:CompanyTotalsFilters):Promise<CompanyUsageRow[]>{
    if(filters.projectKey===NO_PROJECT_KEY||filters.projectKey?.startsWith('site:'))return [];
    const where=["json_extract(m.value,'$.movement') IN ('used','transported')","json_type(m.value,'$.quantity') IN ('integer','real')"];const params:unknown[]=[];
    if(filters.view==='used')where.push("json_extract(m.value,'$.movement') = 'used'");
    if(filters.fromDate){where.push('r.work_date >= ?');params.push(filters.fromDate);}
    if(filters.toDate){where.push('r.work_date <= ?');params.push(filters.toDate);}
    if(filters.projectKey){where.push('r.project_id = ?');params.push(filters.projectKey);}
    const itemKey="CASE WHEN json_extract(m.value,'$.itemId') IS NOT NULL THEN 'id:' || json_extract(m.value,'$.itemId') ELSE 'name:' || lower(trim(json_extract(m.value,'$.itemName'))) END";
    const unitKey="COALESCE(json_extract(m.value,'$.unitId'), 'symbol:' || json_extract(m.value,'$.unitSymbol'))";
    if(filters.itemKey){where.push(`${itemKey} = ?`);params.push(filters.itemKey);}
    if(filters.unitKey){where.push(`${unitKey} = ?`);params.push(filters.unitKey);}
    const rows=await this.db.getAllAsync<Row>(`SELECT json_extract(m.value,'$.movement') movement, ${itemKey} item_key,
        COALESCE(MAX(ci.name), MAX(json_extract(m.value,'$.itemName'))) item_name, r.project_id project_key, MAX(p.name) project_name,
        ${unitKey} unit_key, MAX(json_extract(m.value,'$.unitSymbol')) unit_symbol, SUM(json_extract(m.value,'$.quantity')) quantity, COUNT(*) record_count
      FROM daily_project_reports r JOIN json_each(CASE WHEN json_valid(r.materials_json) AND json_type(r.materials_json) = 'array' THEN r.materials_json ELSE '[]' END) m
        LEFT JOIN catalog_items ci ON ci.id = json_extract(m.value,'$.itemId') LEFT JOIN projects p ON p.id = r.project_id
      WHERE ${where.join(' AND ')}
      GROUP BY movement, item_key, r.project_id, unit_key`,...params as never[]);
    return rows.map(row=>({movement:text(row.movement) as CompanyUsageRow['movement'],itemKey:text(row.item_key),itemName:text(row.item_name),projectKey:text(row.project_key),projectName:text(row.project_name),
      unitKey:text(row.unit_key),unitSymbol:text(row.unit_symbol),quantity:number(row.quantity),recordCount:Number(row.record_count)}));
  }

  /** The original delivered records behind any node, newest last, with their status and history count. */
  /**
   * Customers with Active company loads in the covered period, for the customer filter. The own company and any load whose
   * customer is no longer on file are one "No customer / Internal" choice, which is always listed so those loads stay reachable.
   */
  async listCustomerChoices(filters:{fromDate:string;toDate:string;projectKey?:string}):Promise<CustomerChoice[]>{
    const [where,params]=recordConditions({fromDate:filters.fromDate,toDate:filters.toDate,projectKey:filters.projectKey??''});
    const rows=await this.db.getAllAsync<Row>(`${RECORDS}
      SELECT recs.party_id id, COALESCE(MAX(c.name), MAX(recs.party_name)) name, MAX(c.id IS NULL) orphan, COALESCE(MAX(c.is_own_company),0) own,
        COUNT(*) load_count, COUNT(DISTINCT recs.project_id) project_count
      FROM recs LEFT JOIN customers c ON c.id = recs.party_id
      WHERE ${where.join(' AND ')} AND recs.record_type = 'company_load'
      GROUP BY recs.party_id`,...params as never[]);
    const choices:CustomerChoice[]=[];
    const none:CustomerChoice={key:NO_CUSTOMER_KEY,name:NO_CUSTOMER_LABEL,loadCount:0,projectCount:0,isOwnCompany:true};
    for(const row of rows){
      if(Number(row.own)===1||Number(row.orphan)===1){none.loadCount+=Number(row.load_count);none.projectCount+=Number(row.project_count);continue;}
      choices.push({key:text(row.id),name:text(row.name),loadCount:Number(row.load_count),projectCount:Number(row.project_count),isOwnCompany:false});
    }
    choices.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base',numeric:true}));
    return [...choices,none];
  }

  async listRecords(filters:CompanyTotalsFilters,limit=500):Promise<CompanyTotalsRecord[]>{
    if(filters.view==='used')return [];
    return this.records(filters,'active',limit);
  }

  async listUsageRecords(filters:CompanyTotalsFilters,movement:'used'|'transported'='used',limit=300):Promise<UsageRecord[]>{
    if(filters.projectKey===NO_PROJECT_KEY)return [];
    const where=["json_extract(m.value,'$.movement') = ?","json_type(m.value,'$.quantity') IN ('integer','real')"];const params:unknown[]=[movement];
    if(filters.fromDate){where.push('r.work_date >= ?');params.push(filters.fromDate);}
    if(filters.toDate){where.push('r.work_date <= ?');params.push(filters.toDate);}
    if(filters.projectKey){where.push('r.project_id = ?');params.push(filters.projectKey);}
    if(filters.itemKey){where.push("CASE WHEN json_extract(m.value,'$.itemId') IS NOT NULL THEN 'id:' || json_extract(m.value,'$.itemId') ELSE 'name:' || lower(trim(json_extract(m.value,'$.itemName'))) END = ?");params.push(filters.itemKey);}
    if(filters.unitKey){where.push("COALESCE(json_extract(m.value,'$.unitId'), 'symbol:' || json_extract(m.value,'$.unitSymbol')) = ?");params.push(filters.unitKey);}
    const rows=await this.db.getAllAsync<Row>(`SELECT r.id, r.project_id, p.name project_name, r.work_date, SUM(json_extract(m.value,'$.quantity')) quantity, MAX(json_extract(m.value,'$.unitSymbol')) unit_symbol
      FROM daily_project_reports r JOIN json_each(CASE WHEN json_valid(r.materials_json) AND json_type(r.materials_json) = 'array' THEN r.materials_json ELSE '[]' END) m
        LEFT JOIN projects p ON p.id = r.project_id
      WHERE ${where.join(' AND ')} GROUP BY r.id ORDER BY r.work_date DESC, r.id LIMIT ?`,...params as never[],limit);
    return rows.map(row=>({reportId:text(row.id),projectId:text(row.project_id),projectName:text(row.project_name),workDate:text(row.work_date),quantity:number(row.quantity),unitSymbol:text(row.unit_symbol)}));
  }

  // ---- Company Load Totals ---------------------------------------------------------------------

  /** Active and cancelled company loads grouped by series, item, project and unit; status kept apart. */
  async getCompanyLoadTotals(filters:CompanyTotalsFilters):Promise<CompanyLoadTotalRow[]>{
    const [where,params]=recordConditions({...filters,supplierKey:COMPANY_SUPPLIER_KEY},'all');
    const rows=await this.db.getAllAsync<Row>(`${RECORDS}
      SELECT CASE WHEN recs.load_number IS NULL THEN '${LEGACY_SERIES_KEY}' ELSE COALESCE(recs.series_id,'${LEGACY_SERIES_KEY}') END series_key,
        MAX(ls.prefix) series_prefix, COALESCE(MAX(ls.display_name), MAX(recs.load_number_series_name)) series_name,
        recs.item_key, COALESCE(MAX(ci.name), MAX(recs.item_name)) item_name, ${PROJECT_KEY} project_key, COALESCE(MAX(p.name), MAX(recs.project_name)) project_name,
        recs.unit_key, MAX(recs.unit_symbol) unit_symbol, recs.record_status, SUM(recs.quantity) quantity, COUNT(*) load_count
      FROM recs LEFT JOIN load_number_series ls ON ls.id = recs.series_id LEFT JOIN catalog_items ci ON recs.item_key = 'id:' || ci.id LEFT JOIN projects p ON p.id = recs.project_id
      WHERE ${where.join(' AND ')}
      GROUP BY series_key, recs.item_key, project_key, recs.unit_key, recs.record_status`,...params as never[]);
    return rows.map(row=>{
      const seriesKey=text(row.series_key);const projectKey=text(row.project_key);
      return {seriesKey,seriesLabel:seriesKey===LEGACY_SERIES_KEY?LEGACY_SERIES_LABEL:`${text(row.series_prefix)} · ${text(row.series_name)}`,itemKey:text(row.item_key),itemName:text(row.item_name),
        projectKey,projectName:projectKey===NO_PROJECT_KEY?NO_PROJECT_LABEL:text(row.project_name),unitKey:text(row.unit_key),unitSymbol:text(row.unit_symbol),
        status:text(row.record_status)==='Cancelled'?'Cancelled':'Active',quantity:number(row.quantity),loadCount:Number(row.load_count)};
    });
  }

  async listCompanyLoads(filters:CompanyTotalsFilters,status:'active'|'cancelled'|'all'='active',limit=500):Promise<CompanyTotalsRecord[]>{
    return this.records({...filters,supplierKey:COMPANY_SUPPLIER_KEY},status,limit);
  }

  private async records(filters:CompanyTotalsFilters,status:'active'|'cancelled'|'all',limit:number):Promise<CompanyTotalsRecord[]>{
    const [where,params]=recordConditions(filters,status);
    const rows=await this.db.getAllAsync<RecordRow>(`${RECORDS} SELECT recs.* FROM recs WHERE ${where.join(' AND ')} ORDER BY recs.recorded_at, recs.reference LIMIT ?`,...params as never[],limit);
    const links=await readDocumentLinks(this.db,rows.map(row=>row.record_key));
    return rows.map(row=>{const own:DocumentLink[]=links[row.record_key]??[];const inclusion:InclusionState=deriveInclusion(own);const snapshot:RecordSnapshot=snapshotFromRow(row);
      return {key:row.record_key,snapshot,seriesId:row.series_id,status:row.record_status,cancellationReason:row.cancellation_reason??null,correctionCount:Number(row.correction_count??0),links:own,inclusion,
        details:{destination:row.destination?.trim()||null,driverName:row.driver_name?.trim()||null,truckPlate:row.truck_plate?.trim()||null,deliveredBy:row.delivery_method??null,customerName:row.customer_name?.trim()||null,supplierName:row.supplier_name?.trim()||null}};});
  }
}
