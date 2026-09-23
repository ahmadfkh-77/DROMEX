import type {SQLiteDatabase} from 'expo-sqlite';

import type {FuelType} from '../../domain/fuel';
import type {ConstructionTotal,DeliveryTotal,FuelTotal,ProjectTotalsData,UsageMovement,UsageTotal} from '../../domain/projectTotals';
import {wallMaterialLabels} from '../../domain/walls';
import type {ContributingRecord,ContributingRecordQuery,ProjectTotalsRepository,TotalsDateRange} from './ProjectTotalsRepository';

/**
 * DEC-481. Project Totals, computed by grouped SQL over the canonical tables:
 *
 * - Supplier deliveries: quarry_purchases, Active only, by delivery date.
 * - Company deliveries: loads (receipts), Active and not archived, the receipt's billed quantity in its own
 *   unit (the direct unit, or the conversion's output unit), by confirmation date.
 * - Recorded usage: each Daily Report's saved material lines (Used or Transported), by work date.
 * - Fuel: Active equipment fills whose destination is this project, by fill date.
 * - Construction: wall consumption records by used-on date; Lift actual Stone and actual Ready Mix by
 *   their own phase dates (estimates are never counted); legacy foundation material records by their
 *   consumption date.
 *
 * Grouping keys are stable ids ("id:<item>", unit ids); a normalized name or a unit symbol is used only
 * for a legacy row that has no id. Names come from the current catalog or supplier record when it still
 * exists -- archived included -- otherwise from the record's own snapshot.
 */
type Row=Record<string,unknown>;
const text=(value:unknown)=>typeof value==='string'?value:value==null?'':String(value);
const number=(value:unknown)=>Math.round(Number(value??0)*1e6)/1e6;
const symbols:Record<string,string>={m3:'m³',tonnes:'t',litres:'L',kg:'kg',bag:'bag'};

/** "(? = '' OR expr >= ?) AND (? = '' OR expr <= ?)" plus its four parameters. */
function within(expression:string,range:TotalsDateRange):[string,string[]]{
  return [`(? = '' OR ${expression} >= ?) AND (? = '' OR ${expression} <= ?)`,[range.fromDate,range.fromDate,range.toDate,range.toDate]];
}
/** A stable-id key where one exists, otherwise a normalized legacy name. */
const keyOf=(idColumn:string,nameColumn:string)=>`CASE WHEN ${idColumn} IS NOT NULL THEN 'id:' || ${idColumn} ELSE 'name:' || lower(trim(${nameColumn})) END`;
/** Turns a key back into a WHERE condition on the same columns. */
function matchKey(key:string,idColumn:string,nameColumn:string):[string,string[]]{
  if(key.startsWith('id:'))return [`${idColumn} = ?`,[key.slice(3)]];
  return [`${idColumn} IS NULL AND lower(trim(${nameColumn})) = ?`,[key.startsWith('name:')?key.slice(5):key]];
}
function matchUnit(key:string,idExpression:string,symbolExpression:string):[string,string[]]{
  if(key.startsWith('symbol:'))return [`${idExpression} IS NULL AND ${symbolExpression} = ?`,[key.slice(7)]];
  return [`${idExpression} = ?`,[key]];
}

const LOAD_UNIT="CASE WHEN l.quantity_method = 'direct' THEN l.direct_unit_id ELSE c.output_unit_id END";
const MATERIALS="json_each(CASE WHEN json_valid(r.materials_json) AND json_type(r.materials_json) = 'array' THEN r.materials_json ELSE '[]' END)";
const MATERIAL_OK="json_extract(m.value,'$.movement') IN ('used','transported') AND json_type(m.value,'$.quantity') IN ('integer','real')";

export class SqliteProjectTotalsRepository implements ProjectTotalsRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async getProjectTotals(projectId:string,range:TotalsDateRange):Promise<ProjectTotalsData>{
    const [deliveries,usage,fuel,construction]=await Promise.all([this.deliveries(projectId,range),this.usage(projectId,range),this.fuel(projectId,range),this.construction(projectId,range)]);
    return {deliveries,usage,fuel,construction};
  }

  private async deliveries(projectId:string,range:TotalsDateRange):Promise<DeliveryTotal[]>{
    const [supplierDates,supplierParams]=within("date(q.confirmed_at,'localtime')",range);
    const supplierRows=await this.db.getAllAsync<Row>(`SELECT ${keyOf('q.item_id','q.item_name')} item_key, COALESCE(MAX(ci.name), MAX(q.item_name)) item_name,
        ${keyOf('q.supplier_id','q.supplier_name')} supplier_key, COALESCE(MAX(s.name), MAX(q.supplier_name)) supplier_name,
        COALESCE(q.unit_id, 'symbol:' || COALESCE(q.unit_symbol,'m³')) unit_key, MAX(COALESCE(q.unit_symbol,'m³')) unit_symbol,
        SUM(q.quantity_cubic_metres) quantity, COUNT(*) record_count
      FROM quarry_purchases q LEFT JOIN catalog_items ci ON ci.id = q.item_id LEFT JOIN suppliers s ON s.id = q.supplier_id
      WHERE q.project_id = ? AND q.status = 'Active' AND ${supplierDates}
      GROUP BY item_key, supplier_key, unit_key`,projectId,...supplierParams);
    const [loadDates,loadParams]=within("date(l.confirmed_at,'localtime')",range);
    const companyRows=await this.db.getAllAsync<Row>(`SELECT ${keyOf('l.item_id','l.item_name')} item_key, COALESCE(MAX(ci.name), MAX(l.item_name)) item_name,
        COALESCE(${LOAD_UNIT}, 'symbol:' || l.output_unit_symbol) unit_key, MAX(l.output_unit_symbol) unit_symbol,
        SUM(l.billed_quantity) quantity, COUNT(*) record_count
      FROM loads l LEFT JOIN conversion_options c ON c.id = l.conversion_id LEFT JOIN catalog_items ci ON ci.id = l.item_id
      WHERE l.project_id = ? AND l.status = 'Active' AND l.is_archived = 0 AND ${loadDates}
      GROUP BY item_key, unit_key`,projectId,...loadParams);
    return [
      ...supplierRows.map((row):DeliveryTotal=>({source:'supplier_delivery',itemKey:text(row.item_key),itemName:text(row.item_name),supplierKey:text(row.supplier_key),supplierName:text(row.supplier_name),unitKey:text(row.unit_key),unitSymbol:text(row.unit_symbol),quantity:number(row.quantity),recordCount:Number(row.record_count)})),
      ...companyRows.map((row):DeliveryTotal=>({source:'company_delivery',itemKey:text(row.item_key),itemName:text(row.item_name),supplierKey:'company',supplierName:'Company deliveries',unitKey:text(row.unit_key),unitSymbol:text(row.unit_symbol),quantity:number(row.quantity),recordCount:Number(row.record_count)})),
    ];
  }

  private async usage(projectId:string,range:TotalsDateRange):Promise<UsageTotal[]>{
    const [dates,params]=within('r.work_date',range);
    const rows=await this.db.getAllAsync<Row>(`SELECT json_extract(m.value,'$.movement') movement,
        ${keyOf("json_extract(m.value,'$.itemId')","json_extract(m.value,'$.itemName')")} item_key,
        COALESCE(MAX(ci.name), MAX(json_extract(m.value,'$.itemName'))) item_name,
        COALESCE(json_extract(m.value,'$.unitId'), 'symbol:' || json_extract(m.value,'$.unitSymbol')) unit_key,
        MAX(json_extract(m.value,'$.unitSymbol')) unit_symbol,
        SUM(json_extract(m.value,'$.quantity')) quantity, COUNT(*) record_count
      FROM daily_project_reports r JOIN ${MATERIALS} m LEFT JOIN catalog_items ci ON ci.id = json_extract(m.value,'$.itemId')
      WHERE r.project_id = ? AND ${dates} AND ${MATERIAL_OK}
      GROUP BY movement, item_key, unit_key`,projectId,...params);
    return rows.map(row=>({movement:text(row.movement) as UsageMovement,itemKey:text(row.item_key),itemName:text(row.item_name),unitKey:text(row.unit_key),unitSymbol:text(row.unit_symbol),quantity:number(row.quantity),recordCount:Number(row.record_count)}));
  }

  private async fuel(projectId:string,range:TotalsDateRange):Promise<FuelTotal[]>{
    const [dates,params]=within("date(confirmed_at,'localtime')",range);
    const rows=await this.db.getAllAsync<Row>(`SELECT fuel_type, COALESCE(equipment_name,'Unknown equipment') equipment_name, SUM(litres) litres, COUNT(*) record_count
      FROM fuel_movements WHERE project_id = ? AND movement_type = 'fill' AND status = 'Active' AND ${dates}
      GROUP BY fuel_type, COALESCE(equipment_name,'Unknown equipment')`,projectId,...params);
    return rows.map(row=>({fuelType:text(row.fuel_type) as FuelType,equipmentName:text(row.equipment_name),litres:number(row.litres),recordCount:Number(row.record_count)}));
  }

  private async construction(projectId:string,range:TotalsDateRange):Promise<ConstructionTotal[]>{
    // Wall consumption records: one grouped query per recorded measure, each in its own recorded unit.
    const wallMeasures:{key:string;label:string;quantity:string;unit:string}[]=[
      {key:'ready_mix',label:wallMaterialLabels.ready_mix,quantity:"CASE WHEN wc.material_type = 'ready_mix' THEN wc.finished_volume_m3 END",unit:"'m3'"},
      {key:'site_mix',label:wallMaterialLabels.site_mix,quantity:"CASE WHEN wc.material_type = 'site_mix' THEN wc.finished_volume_m3 END",unit:"'m3'"},
      {key:'stone',label:wallMaterialLabels.stone,quantity:'wc.stone_quantity',unit:'wc.stone_unit'},
      {key:'rebar',label:wallMaterialLabels.rebar,quantity:'wc.total_rebar_kg',unit:"'kg'"},
      {key:'cement',label:'Cement (site mix)',quantity:'wc.cement_bags',unit:"'bag'"},
      {key:'sand',label:'Sand (site mix)',quantity:'wc.sand_quantity',unit:'wc.sand_unit'},
      {key:'gravel',label:'Gravel (site mix)',quantity:'wc.gravel_quantity',unit:'wc.gravel_unit'},
      {key:'water',label:'Water (site mix)',quantity:'wc.water_litres',unit:"'litres'"},
      {key:'admixture',label:'Admixture (site mix)',quantity:'wc.admixture_quantity',unit:'wc.admixture_unit'},
    ];
    const results:ConstructionTotal[]=[];
    const push=(rows:Row[],source:ConstructionTotal['source'],key:string,label:string)=>{for(const row of rows){const unit=text(row.unit);if(!unit)continue;results.push({source,materialKey:key,materialLabel:label,unitKey:unit,unitSymbol:symbols[unit]??unit,quantity:number(row.quantity),recordCount:Number(row.record_count)});}};
    const [wallDates,wallParams]=within('wc.used_on',range);
    for(const measure of wallMeasures){
      const rows=await this.db.getAllAsync<Row>(`SELECT ${measure.unit} unit, SUM(${measure.quantity}) quantity, COUNT(*) record_count
        FROM wall_consumptions wc JOIN walls w ON w.id = wc.wall_id
        WHERE w.project_id = ? AND ${measure.quantity} IS NOT NULL AND ${wallDates} GROUP BY unit`,projectId,...wallParams);
      push(rows,'wall_consumption',measure.key,measure.label);
    }
    const liftProject='COALESCE(w.project_id, f.project_id)';
    const [stoneDates,stoneParams]=within('cl.stone_work_date',range);
    push(await this.db.getAllAsync<Row>(`SELECT 'm3' unit, SUM(cl.stone_actual_quantity_m3) quantity, COUNT(*) record_count
      FROM construction_lifts cl LEFT JOIN walls w ON w.id = cl.wall_id LEFT JOIN foundations f ON f.id = cl.foundation_id
      WHERE ${liftProject} = ? AND cl.stone_actual_quantity_m3 IS NOT NULL AND ${stoneDates} HAVING COUNT(*) > 0`,projectId,...stoneParams),'lift_stone','stone',wallMaterialLabels.stone);
    const [concreteDates,concreteParams]=within('cl.concrete_work_date',range);
    push(await this.db.getAllAsync<Row>(`SELECT 'm3' unit, SUM(cl.concrete_actual_ready_mix_m3) quantity, COUNT(*) record_count
      FROM construction_lifts cl LEFT JOIN walls w ON w.id = cl.wall_id LEFT JOIN foundations f ON f.id = cl.foundation_id
      WHERE ${liftProject} = ? AND cl.concrete_actual_ready_mix_m3 IS NOT NULL AND ${concreteDates} HAVING COUNT(*) > 0`,projectId,...concreteParams),'lift_ready_mix','ready_mix',wallMaterialLabels.ready_mix);
    const [legacyDates,legacyParams]=within('consumption_date',range);
    const legacy=await this.db.getAllAsync<Row>(`SELECT material_type, quantity_unit unit, SUM(quantity) quantity, COUNT(*) record_count FROM foundations
      WHERE project_id = ? AND material_type IS NOT NULL AND quantity IS NOT NULL AND quantity_unit IS NOT NULL AND ${legacyDates}
      GROUP BY material_type, quantity_unit`,projectId,...legacyParams);
    for(const row of legacy){const key=text(row.material_type) as keyof typeof wallMaterialLabels;push([row],'foundation_legacy',key,wallMaterialLabels[key]??key);}
    return results;
  }

  async listContributingRecords(projectId:string,query:ContributingRecordQuery,limit=100):Promise<ContributingRecord[]>{
    if(query.kind==='usage'){
      const [dates,dateParams]=within('r.work_date',query);
      const [item,itemParams]=matchKey(query.itemKey,"json_extract(m.value,'$.itemId')","json_extract(m.value,'$.itemName')");
      const [unit,unitParams]=matchUnit(query.unitKey,"json_extract(m.value,'$.unitId')","json_extract(m.value,'$.unitSymbol')");
      const rows=await this.db.getAllAsync<Row>(`SELECT r.id, r.work_date, SUM(json_extract(m.value,'$.quantity')) quantity, MAX(json_extract(m.value,'$.unitSymbol')) unit_symbol
        FROM daily_project_reports r JOIN ${MATERIALS} m
        WHERE r.project_id = ? AND ${dates} AND ${MATERIAL_OK} AND json_extract(m.value,'$.movement') = ? AND ${item} AND ${unit}
        GROUP BY r.id ORDER BY r.work_date DESC LIMIT ?`,projectId,...dateParams,query.movement,...itemParams,...unitParams,limit);
      return rows.map(row=>({id:text(row.id),reference:'Daily Report',date:text(row.work_date),party:null,quantity:number(row.quantity),unitSymbol:text(row.unit_symbol),source:'report_material'}));
    }
    const records:ContributingRecord[]=[];
    if(query.source!=='company_delivery'&&query.supplierKey!=='company'){
      const [dates,dateParams]=within("date(q.confirmed_at,'localtime')",query);
      const [item,itemParams]=matchKey(query.itemKey,'q.item_id','q.item_name');
      const [unit,unitParams]=matchUnit(query.unitKey,'q.unit_id',"COALESCE(q.unit_symbol,'m³')");
      const [supplier,supplierParams]=query.supplierKey?matchKey(query.supplierKey,'q.supplier_id','q.supplier_name'):['1 = 1',[]];
      const rows=await this.db.getAllAsync<Row>(`SELECT q.id, q.purchase_number, q.confirmed_at, date(q.confirmed_at,'localtime') day, q.supplier_name, q.quantity_cubic_metres, COALESCE(q.unit_symbol,'m³') unit_symbol
        FROM quarry_purchases q WHERE q.project_id = ? AND q.status = 'Active' AND ${dates} AND ${item} AND ${unit} AND ${supplier}
        ORDER BY q.confirmed_at DESC LIMIT ?`,projectId,...dateParams,...itemParams,...unitParams,...supplierParams,limit);
      records.push(...rows.map((row):ContributingRecord=>({id:text(row.id),reference:text(row.purchase_number),date:text(row.day),party:text(row.supplier_name),quantity:number(row.quantity_cubic_metres),unitSymbol:text(row.unit_symbol),source:'supplier_delivery'})));
    }
    if(query.source!=='supplier_delivery'&&(!query.supplierKey||query.supplierKey==='company')){
      const [dates,dateParams]=within("date(l.confirmed_at,'localtime')",query);
      const [item,itemParams]=matchKey(query.itemKey,'l.item_id','l.item_name');
      const [unit,unitParams]=matchUnit(query.unitKey,LOAD_UNIT,'l.output_unit_symbol');
      const rows=await this.db.getAllAsync<Row>(`SELECT l.id, l.transaction_number, l.confirmed_at, date(l.confirmed_at,'localtime') day, l.driver_name, l.billed_quantity, l.output_unit_symbol
        FROM loads l LEFT JOIN conversion_options c ON c.id = l.conversion_id
        WHERE l.project_id = ? AND l.status = 'Active' AND l.is_archived = 0 AND ${dates} AND ${item} AND ${unit}
        ORDER BY l.confirmed_at DESC LIMIT ?`,projectId,...dateParams,...itemParams,...unitParams,limit);
      records.push(...rows.map((row):ContributingRecord=>({id:text(row.id),reference:text(row.transaction_number),date:text(row.day),party:text(row.driver_name),quantity:number(row.billed_quantity),unitSymbol:text(row.output_unit_symbol),source:'company_delivery'})));
    }
    return records.sort((a,b)=>b.date.localeCompare(a.date)||b.reference.localeCompare(a.reference,undefined,{numeric:true})).slice(0,limit);
  }
}
