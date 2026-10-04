import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './sqliteTestDatabase';

/**
 * DEC-500 fixtures shared by the totals, documents and load-number suites: a migrated database with two
 * projects, two customers, two suppliers, a small catalog, and helpers that insert company loads and
 * Supplier Loads exactly as their repositories store them (snapshots included).
 */
const T=SEED_TIME;

export type CompanyLoadOptions={project?:string|null;customer?:string;quantity?:number;unit?:'t'|'m³';day?:string;time?:string;status?:'Active'|'Cancelled';archived?:0|1;priceCents?:number|null;vatBasisPoints?:number;loadNumber?:string|null};
export type SupplierLoadOptions={project?:string|null;supplier?:string;quantity?:number;unit?:'t'|'m³';day?:string;status?:'Active'|'Cancelled';priceCents?:number|null;ticket?:string|null};

export async function recordsDatabase(open:SqliteTestDatabase[]){
  const db=await migratedDatabaseWithProject(open);
  db.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_b','company','Beirut Builders',0,1,'${T}','${T}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('other','customer','Coastal Road','Tyre','active','2026-08-01','${T}','${T}',0);
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Materials','${T}','${T}');
    INSERT INTO catalog_items (id,category_id,name,loads_enabled,quarry_enabled,daily_reports_enabled,created_at,updated_at) VALUES
      ('sand','cat','Sand',1,1,1,'${T}','${T}'),('gravel','cat','Gravel',1,1,1,'${T}','${T}'),('asphalt','cat','Asphalt',1,1,1,'${T}','${T}'),('concrete','cat','Concrete',1,1,1,'${T}','${T}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup_a','Alpha Quarry',1,'${T}','${T}'),('sup_b','Beta Quarry',1,'${T}','${T}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${T}','${T}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${T}','${T}','driver');
  `);
  let n=0;
  const names:Record<string,string>={sand:'Sand',gravel:'Gravel',asphalt:'Asphalt',concrete:'Concrete',road:'Mountain Road',other:'Coastal Road',customer:'Road Co',cust_b:'Beirut Builders',sup_a:'Alpha Quarry',sup_b:'Beta Quarry'};
  const unitId=(unit:'t'|'m³')=>unit==='t'?'unit_ton':'unit_m3';
  /** Inserts one company load; returns its id. Priced loads carry their VAT and totals as the receipt snapshots them. */
  const companyLoad=(item:string,options:CompanyLoadOptions={})=>{
    n+=1;const id=`l${n}`;const quantity=options.quantity??10;const unit=options.unit??'t';const project=options.project===undefined?'road':options.project;
    const price=options.priceCents??null;const vat=options.vatBasisPoints??0;
    const subtotal=price==null?null:Math.round(price*quantity);const vatAmount=subtotal==null?null:Math.round(subtotal*vat/10000);const total=subtotal==null?null:subtotal+(vatAmount??0);
    const status=price==null?'Unpriced':price===0?'No Payment Due':'Unpaid';
    db.raw.prepare(`INSERT INTO loads (id,transaction_number,confirmed_at,customer_id,customer_name,project_id,project_name,item_id,item_name,category_name,driver_name,truck_plate,driver_profile_id,truck_profile_id,
      empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,unit_price_usd_cents,subtotal_usd_cents,vat_rate_basis_points,vat_amount_usd_cents,final_total_usd_cents,payment_status,company_name,quantity_method,direct_quantity,direct_unit_id,direct_unit_name,direct_unit_symbol,status,is_archived,entered_at,load_number)
      VALUES (?,?,?,?,?,?,?,?,?,'Materials','Omar','B123','driver','truck',0,1,1,'conversion_kg_ton','Direct quantity','Entered directly',?,?,?,?,?,?,?,?,?,'DROMEX','direct',?,?,?,?,?,?,?,?)`).run(
      id,`TX-${n}`,`${options.day??'2026-08-10'}T${options.time??'09:00:00'}`,options.customer??'customer',names[options.customer??'customer']??'Customer',project,project?names[project]??project:null,item,names[item]??item,
      unit,quantity,quantity,price,subtotal,price==null?null:vat,vatAmount,total,status,quantity,unitId(unit),unit==='t'?'Metric ton':'Cubic metre',unit,options.status??'Active',options.archived??0,`${options.day??'2026-08-10'}T09:00:05`,options.loadNumber??null);
    return id;
  };
  /** Inserts one Supplier Load; returns its id. */
  const supplierLoad=(item:string,options:SupplierLoadOptions={})=>{
    n+=1;const id=`q${n}`;const quantity=options.quantity??8;const unit=options.unit??'m³';const project=options.project===undefined?'road':options.project;
    const price=options.priceCents??null;const subtotal=price==null?null:Math.round(price*quantity);
    db.raw.prepare(`INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,project_id,project_name,item_id,item_name,category_name,unit_id,unit_name,unit_symbol,quantity_cubic_metres,delivery_method,driver_profile_id,driver_name,truck_profile_id,truck_plate,supplier_ticket_number,unit_price_usd_cents,subtotal_usd_cents,vat_rate_basis_points,vat_amount_usd_cents,final_total_usd_cents,payment_status,photos_json,status,entered_at)
      VALUES (?,?,?,?,?,?,?,?,?,'Materials',?,?,?,?,'supplier','system_supplier_delivery_driver','Supplier Delivering','system_supplier_delivery_truck','',?,?,?,?,?,?,?,'[]',?,?)`).run(
      id,`QP-${n}`,`${options.day??'2026-08-10'}T10:00:00`,options.supplier??'sup_a',names[options.supplier??'sup_a']??'Supplier',project,project?names[project]??project:null,item,names[item]??item,
      unit==='t'?'unit_ton':'unit_m3',unit==='t'?'Metric ton':'Cubic metre',unit,quantity,options.ticket??null,price,subtotal,price==null?null:0,price==null?null:0,subtotal,price==null?'Unpriced':'Unpaid',options.status??'Active',`${options.day??'2026-08-10'}T10:00:05`);
    return id;
  };
  const report=(project:string,day:string,materials:unknown[])=>{db.raw.prepare(`INSERT INTO daily_project_reports (id,project_id,work_date,work_description,materials_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).run(`r_${project}_${day}`,project,day,'Work',JSON.stringify(materials),T,T);};
  return {db,companyLoad,supplierLoad,report};
}
