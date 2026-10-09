import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {strToU8,zipSync} from 'fflate';
import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations.ts';
import {encryptBackupBytes} from '../src/services/backup/BackupCrypto.ts';

/**
 * A SMALL test backup for the receipt, Project Totals PDF, customer filter and customer page work: a few dozen
 * linked records that exercise every case (series ASP and a shared AGG series, a material with no series, a customer
 * project and an internal project, a second customer, an Arabic name, a legacy load, a cancelled load, a blank
 * destination, supplier loads from two suppliers). It is a separate, deliberately tiny alternative to
 * `npm run demo:backup` (4,000 loads). Restoring it REPLACES the phone's data after DROMEX saves a safety backup.
 */
const ARCHIVE_FORMAT='DROMEX-COMPLETE-BACKUP';
const ARCHIVE_VERSION=1;
const DEFAULT_PASSWORD='DROMEX-DEMO-2026';
const DEFAULT_OUTPUT=resolve('demo','DROMEX-Customer-Totals-Test.dromexbackup');

type Scalar=string|number|null;
export type CustomerTestBackupOptions={output?:string;password?:string;now?:Date;encryptionIterations?:number};
export type CustomerTestBackupResult={output:string;password:string;encryptedBytes:number;counts:Record<string,number>;createdAt:string};

export async function generateCustomerTestBackup(options:CustomerTestBackupOptions={}):Promise<CustomerTestBackupResult>{
  const output=resolve(options.output??DEFAULT_OUTPUT),password=options.password??DEFAULT_PASSWORD,now=options.now??new Date();
  const temporaryDirectory=mkdtempSync(join(tmpdir(),'dromex-customer-test-')),databasePath=join(temporaryDirectory,'database.sqlite');
  const db=new DatabaseSync(databasePath);
  try{
    const adapter={execAsync:async(sql:string)=>{db.exec(sql);},getFirstAsync:async(sql:string)=>db.prepare(sql).get()};
    await migrateDatabase(adapter as never);
    seed(db,now);
    const integrity=db.prepare('PRAGMA integrity_check').get() as Record<string,string>;
    if(!Object.values(integrity).includes('ok'))throw new Error('Generated test database failed integrity_check.');
    const broken=db.prepare('PRAGMA foreign_key_check').all();
    if(broken.length)throw new Error(`Generated test database contains ${broken.length} broken relationships.`);
    // Same packaging rule as the large demo: Android restores through an in-memory deserializer, so use rollback-journal mode.
    db.exec('PRAGMA wal_checkpoint(FULL); PRAGMA journal_mode = DELETE;');
  }finally{db.close();}
  try{
    const createdAt=now.toISOString(),databaseBytes=Uint8Array.from(readFileSync(databasePath)),counts=collectCounts(databasePath);
    const preferences:Array<[string,string]>=[['dromex.active-project.v1','test_project_highway'],['dromex.dashboard.collapsed.v1','false']];
    const manifest={format:ARCHIVE_FORMAT,formatVersion:ARCHIVE_VERSION,backupId:randomUUID(),createdAt,appVersion:'0.20.0',databaseVersion:DATABASE_VERSION,recordCounts:counts,preferenceCount:preferences.length,media:[]};
    const archive=zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'database.sqlite':databaseBytes,'preferences.json':strToU8(JSON.stringify(preferences))},{level:6});
    const encrypted=await encryptBackupBytes(archive,password,{randomBytes:size=>Uint8Array.from(randomBytes(size)),...(options.encryptionIterations===undefined?{}:{iterations:options.encryptionIterations})});
    mkdirSync(dirname(output),{recursive:true});
    const partial=`${output}.partial`;writeFileSync(partial,encrypted);rmSync(output,{force:true});writeFileSync(output,readFileSync(partial));rmSync(partial,{force:true});
    return{output,password,encryptedBytes:encrypted.length,counts,createdAt};
  }finally{rmSync(temporaryDirectory,{recursive:true,force:true});}
}

const TX_DEVICE='TEST';
type LoadSpec={key:string;day:string;time:string;customer:string;project:string;item:string;quantity:number;unit:'t'|'m³';destination:string|null;driver:string;truck:string;status?:'Active'|'Cancelled';price?:number|null;legacy?:boolean};
type SupplierSpec={key:string;day:string;time:string;supplier:string;project:string;item:string;quantity:number;ticket:string|null;own?:boolean;price?:number|null};

function seed(db:DatabaseSync,now:Date){
  const t=now.toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
    // ---- Company (Company Settings: logo, name, contact line, Tax/VAT) and the own-company customer.
    insert(db,'customers',{id:'company',customer_type:'company',name:'DROMEX Asphalt Co.',phone:'+961 1 234 567',email:'info@dromex.example',address:'Beirut, Lebanon',tax_vat_number:'1234567-001',notes:'Own company: the customer on internal projects',is_own_company:1,is_active:1,merged_into_id:null,created_at:t,updated_at:t});
    insert(db,'company_settings',{id:'company',company_name:'DROMEX Asphalt Co.',logo_uri:null,address:'Beirut, Lebanon',phone:'+961 1 234 567',email:'info@dromex.example',tax_vat_number:'1234567-001',receipt_footer:'TEST DATA - NOT A REAL FINANCIAL DOCUMENT',updated_at:t});
    insert(db,'tax_settings',{id:'tax',vat_rate_basis_points:1100,updated_at:t});

    // ---- Customers: one ordinary, one with an Arabic name.
    insert(db,'customers',{id:'test_customer_amal',customer_type:'company',name:'Al Amal Contracting',phone:'+961 3 123 456',email:'office@alamal.example',address:'Zahle, Lebanon',tax_vat_number:'7654321-001',notes:null,is_own_company:0,is_active:1,merged_into_id:null,created_at:t,updated_at:t});
    insert(db,'customers',{id:'test_customer_nour',customer_type:'company',name:'شركة النور للمقاولات',phone:'+961 70 222 333',email:null,address:'بيروت، لبنان',tax_vat_number:null,notes:'Arabic name test',is_own_company:0,is_active:1,merged_into_id:null,created_at:t,updated_at:t});

    // ---- Projects: two for customers, one internal (customer = the own company).
    const start=isoDate(daysAgo(now,160));
    const project=(id:string,customer:string,name:string,location:string)=>insert(db,'projects',{id,customer_id:customer,name,location,status:'active',start_date:start,end_date:null,notes:null,created_at:t,updated_at:t,is_archived:0});
    project('test_project_highway','test_customer_amal','Highway Link','Zahle');
    project('test_project_wall','test_customer_nour','Retaining Wall B','Zahle, km 3');
    project('test_project_yard','company','Yard Extension','Beirut');

    // ---- Suppliers (two) and people / equipment for the loads.
    for(const [id,name] of [['test_supplier_saad','Saad Quarry'],['test_supplier_cedar','Cedar Aggregates']] as const)
      insert(db,'suppliers',{id,name,phone:'+961 3 440 000',email:null,address:`${name} yard`,tax_vat_number:null,notes:null,is_active:1,created_at:t,updated_at:t});
    insert(db,'driver_profiles',{id:'test_driver_haddad',name:'R. Haddad',phone:null,license_number:'TEST-1',notes:null,is_active:1,created_at:t,updated_at:t});
    insert(db,'driver_profiles',{id:'test_driver_nasr',name:'K. Nasr',phone:null,license_number:'TEST-2',notes:null,is_active:1,created_at:t,updated_at:t});
    insert(db,'truck_profiles',{id:'test_truck_1',plate:'112233',make_model:'MAN TGS',capacity_kg:24000,owner_name:'DROMEX Asphalt Co.',notes:null,is_active:1,created_at:t,updated_at:t});
    insert(db,'truck_profiles',{id:'test_truck_2',plate:'445566',make_model:'Volvo FMX',capacity_kg:26000,owner_name:'DROMEX Asphalt Co.',notes:null,is_active:1,created_at:t,updated_at:t});

    // ---- Materials and number series: ASP (Asphalt), AGG shared by Sand and Gravel, Binder with no series (falls to LOAD).
    insert(db,'categories',{id:'test_cat_asphalt',name:'Asphalt',is_active:1,created_at:t,updated_at:t});
    insert(db,'categories',{id:'test_cat_aggregate',name:'Aggregates',is_active:1,created_at:t,updated_at:t});
    const series=(id:string,prefix:string,name:string)=>insert(db,'load_number_series',{id,prefix,prefix_key:prefix,display_name:name,is_default:0,is_active:1,created_at:t,updated_at:t});
    series('test_series_asp','ASP','Asphalt');series('test_series_agg','AGG','Aggregates (Sand and Gravel share this series)');
    const item=(id:string,category:string,name:string,seriesId:string|null,quarry:number)=>insert(db,'catalog_items',{id,category_id:category,name,internal_code:null,description:null,default_unit_id:'unit_ton',default_receipt_price_usd_cents:8200,loads_enabled:1,quarry_enabled:quarry,daily_reports_enabled:1,is_active:1,created_at:t,updated_at:t,load_number_series_id:seriesId});
    item('test_item_base','test_cat_asphalt','Asphalt, Base Course','test_series_asp',0);
    item('test_item_binder','test_cat_asphalt','Asphalt, Binder (no series)',null,0);
    item('test_item_sand','test_cat_aggregate','Sand','test_series_agg',1);
    item('test_item_gravel','test_cat_aggregate','Gravel 3/4','test_series_agg',1);

    // ---- Company loads, oldest first; numbers are issued exactly as the app issues them (lifetime counter per series).
    const names:Record<string,string>={test_customer_amal:'Al Amal Contracting',test_customer_nour:'شركة النور للمقاولات',company:'DROMEX Asphalt Co.',
      test_project_highway:'Highway Link',test_project_wall:'Retaining Wall B',test_project_yard:'Yard Extension',
      test_item_base:'Asphalt, Base Course',test_item_binder:'Asphalt, Binder (no series)',test_item_sand:'Sand',test_item_gravel:'Gravel 3/4',
      test_driver_haddad:'R. Haddad',test_driver_nasr:'K. Nasr'};
    const day=(back:number)=>isoDate(daysAgo(now,back));
    const loads:LoadSpec[]=[
      {key:'legacy',day:day(100),time:'14:20:00',customer:'test_customer_amal',project:'test_project_highway',item:'test_item_binder',quantity:20,unit:'t',destination:'Zahle, km 8',driver:'test_driver_haddad',truck:'test_truck_1',legacy:true},
      {key:'asp1',day:day(4),time:'09:05:00',customer:'test_customer_amal',project:'test_project_highway',item:'test_item_base',quantity:18.5,unit:'t',destination:'Zahle, km 12',driver:'test_driver_haddad',truck:'test_truck_1',price:8200},
      {key:'asp2',day:day(4),time:'10:15:00',customer:'test_customer_amal',project:'test_project_highway',item:'test_item_base',quantity:18,unit:'t',destination:null,driver:'test_driver_nasr',truck:'test_truck_2'},
      {key:'cancelled',day:day(4),time:'13:02:00',customer:'test_customer_amal',project:'test_project_highway',item:'test_item_base',quantity:17.5,unit:'t',destination:'Zahle, km 12',driver:'test_driver_nasr',truck:'test_truck_2',status:'Cancelled'},
      {key:'agg1',day:day(3),time:'08:30:00',customer:'test_customer_amal',project:'test_project_highway',item:'test_item_sand',quantity:12,unit:'m³',destination:'Zahle, km 3',driver:'test_driver_haddad',truck:'test_truck_1'},
      {key:'agg2',day:day(3),time:'11:40:00',customer:'test_customer_nour',project:'test_project_wall',item:'test_item_gravel',quantity:9,unit:'m³',destination:'Retaining Wall B, Zahle',driver:'test_driver_nasr',truck:'test_truck_2'},
      {key:'agg3',day:day(2),time:'09:10:00',customer:'test_customer_nour',project:'test_project_wall',item:'test_item_sand',quantity:14,unit:'m³',destination:'Retaining Wall B, Zahle',driver:'test_driver_haddad',truck:'test_truck_1',price:3500},
      {key:'binder',day:day(2),time:'15:00:00',customer:'test_customer_nour',project:'test_project_wall',item:'test_item_binder',quantity:16,unit:'t',destination:'Retaining Wall B, Zahle',driver:'test_driver_nasr',truck:'test_truck_2'},
      {key:'internal',day:day(1),time:'07:45:00',customer:'company',project:'test_project_yard',item:'test_item_base',quantity:11,unit:'t',destination:'Yard Extension, Beirut',driver:'test_driver_haddad',truck:'test_truck_1'},
    ];
    const counters=new Map<string,number>();
    const prefixes:Record<string,{series:string;prefix:string;name:string}>={
      test_item_base:{series:'test_series_asp',prefix:'ASP',name:'Asphalt'},test_item_sand:{series:'test_series_agg',prefix:'AGG',name:'Aggregates (Sand and Gravel share this series)'},
      test_item_gravel:{series:'test_series_agg',prefix:'AGG',name:'Aggregates (Sand and Gravel share this series)'},test_item_binder:{series:'series_load',prefix:'LOAD',name:'Company loads'}};
    loads.forEach((spec,index)=>{
      const id=`test_load_${spec.key}`,confirmed=`${spec.day}T${spec.time}`,price=spec.price??null;
      const subtotal=price==null?null:Math.round(price*spec.quantity),vat=subtotal==null?null:Math.round(subtotal*.11),total=subtotal==null?null:subtotal+(vat??0);
      insert(db,'loads',{id,transaction_number:`${spec.day.replaceAll('-','')}-${TX_DEVICE}-${String(index+1).padStart(5,'0')}`,confirmed_at:confirmed,customer_id:spec.customer,customer_name:names[spec.customer]!,project_id:spec.project,project_name:names[spec.project]!,
        project_location:spec.destination,destination_address:null,item_id:spec.item,item_name:names[spec.item]!,category_name:'Materials',driver_name:names[spec.driver]!,truck_plate:spec.truck==='test_truck_1'?'112233':'445566',driver_profile_id:spec.driver,truck_profile_id:spec.truck,
        empty_weight_kg:0,full_weight_kg:1,net_weight_kg:1,conversion_id:'conversion_kg_ton',conversion_name:'Direct quantity',conversion_rule:'Entered directly',output_unit_symbol:spec.unit,converted_quantity:spec.quantity,billed_quantity:spec.quantity,
        unit_price_usd_cents:price,subtotal_usd_cents:subtotal,vat_rate_basis_points:price==null?null:1100,vat_amount_usd_cents:vat,final_total_usd_cents:total,payment_status:price==null?'Unpriced':'Unpaid',company_name:'DROMEX Asphalt Co.',
        quantity_method:'direct',direct_quantity:spec.quantity,direct_unit_id:spec.unit==='t'?'unit_ton':'unit_m3',direct_unit_name:spec.unit==='t'?'Metric ton':'Cubic metre',direct_unit_symbol:spec.unit,status:spec.status??'Active',is_archived:0,entered_at:`${spec.day}T${spec.time}`,load_number:null});
      if(spec.legacy)return;                                            // a legacy load keeps no number and is never backfilled
      const series=prefixes[spec.item]!,sequence=(counters.get(series.prefix)??0)+1;counters.set(series.prefix,sequence);
      const loadNumber=`${series.prefix}-${String(sequence).padStart(5,'0')}`;
      db.prepare('UPDATE loads SET load_number=?,load_number_series_id=?,load_number_series_name=? WHERE id=?').run(loadNumber,series.series,series.name,id);
      db.prepare('INSERT INTO load_number_issues (load_number,load_id,series_id,prefix,year,sequence,item_id,issued_at) VALUES (?,?,?,?,?,?,?,?)').run(loadNumber,id,series.series,series.prefix,Number(spec.day.slice(0,4)),sequence,spec.item,confirmed);
    });
    // The lifetime counter the app reads next (year 0), so a new load continues after these numbers.
    for(const [prefix,issued] of counters)db.prepare('INSERT OR REPLACE INTO load_number_counters (prefix_key,year,next_number) VALUES (?,0,?)').run(prefix,issued+1);

    // ---- Supplier loads from two suppliers (one delivering itself, one by our driver), on the customer and the internal project.
    const supplierLoads:SupplierSpec[]=[
      {key:'saad1',day:day(5),time:'07:50:00',supplier:'test_supplier_saad',project:'test_project_highway',item:'test_item_gravel',quantity:22,ticket:'T-4471',price:1500},
      {key:'cedar1',day:day(4),time:'08:30:00',supplier:'test_supplier_cedar',project:'test_project_highway',item:'test_item_sand',quantity:18,ticket:null,own:true},
      {key:'saad2',day:day(2),time:'06:55:00',supplier:'test_supplier_saad',project:'test_project_yard',item:'test_item_sand',quantity:30,ticket:'T-4502'},
    ];
    supplierLoads.forEach((spec,index)=>{
      const confirmed=`${spec.day}T${spec.time}`,price=spec.price??null,subtotal=price==null?null:Math.round(price*spec.quantity);
      insert(db,'quarry_purchases',{id:`test_supplier_load_${spec.key}`,purchase_number:`QP-${TX_DEVICE}-${String(index+1).padStart(4,'0')}`,confirmed_at:confirmed,supplier_id:spec.supplier,supplier_name:spec.supplier==='test_supplier_saad'?'Saad Quarry':'Cedar Aggregates',
        project_id:spec.project,project_name:names[spec.project]!,item_id:spec.item,item_name:names[spec.item]!,category_name:'Aggregates',unit_id:'unit_m3',unit_name:'Cubic metre',unit_symbol:'m³',quantity_cubic_metres:spec.quantity,
        delivery_method:spec.own?'company':'supplier',driver_profile_id:spec.own?'test_driver_nasr':'system_supplier_delivery_driver',driver_name:spec.own?'K. Nasr':'Supplier Delivering',truck_profile_id:spec.own?'test_truck_2':'system_supplier_delivery_truck',truck_plate:spec.own?'445566':'',
        supplier_ticket_number:spec.ticket,unit_price_usd_cents:price,subtotal_usd_cents:subtotal,vat_rate_basis_points:price==null?null:0,vat_amount_usd_cents:price==null?null:0,final_total_usd_cents:subtotal,payment_status:price==null?'Unpriced':'Unpaid',photos_json:'[]',status:'Active',entered_at:confirmed});
    });

    db.prepare('UPDATE device_state SET device_code=?,next_load_sequence=?,next_quarry_sequence=? WHERE id=?').run(TX_DEVICE,loads.length+1,supplierLoads.length+1,'local');
    db.exec('COMMIT');
  }catch(cause){db.exec('ROLLBACK');throw cause;}
}

function insert(db:DatabaseSync,table:string,row:Record<string,Scalar>){const columns=Object.keys(row);db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(row));}
function daysAgo(now:Date,days:number){return new Date(now.getTime()-days*86400000);}
function isoDate(value:Date){return value.toISOString().slice(0,10);}
function collectCounts(databasePath:string){
  const tables=['loads','projects','customers','daily_project_reports','quarry_purchases','waste_dumps','fuel_movements','payment_entries','schedule_tasks','pavement_calculations','walls','wall_consumptions','project_issues','project_media','quick_text_documents','suppliers','driver_profiles','truck_profiles','machine_profiles','catalog_items','custom_directories','custom_directory_entries','supervisors'];
  const db=new DatabaseSync(databasePath,{readOnly:true});
  try{const counts:Record<string,number>={};for(const table of tables)counts[table]=Number((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as {count:number|bigint}).count);return counts;}finally{db.close();}
}

const isMain=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(isMain){generateCustomerTestBackup().then(result=>{console.log(JSON.stringify(result,null,2));console.log(`\nRestore password: ${result.password}`);}).catch(cause=>{console.error(cause);process.exitCode=1;});}
