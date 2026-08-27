import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {strToU8,zipSync} from 'fflate';
import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations.ts';
import {encryptBackupBytes} from '../src/services/backup/BackupCrypto.ts';

const ARCHIVE_FORMAT='DROMEX-COMPLETE-BACKUP';
const ARCHIVE_VERSION=1;
const DEFAULT_PASSWORD='DROMEX-DEMO-2026';
const DEFAULT_OUTPUT=resolve('demo','DROMEX-Large-Linked-Demo.dromexbackup');
const ONE_PIXEL_PNG=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2WQAAAAASUVORK5CYII=','base64'));

type Scalar=string|number|bigint|null;
export type DemoGenerationOptions={output?:string;password?:string;loadCount?:number;now?:Date;encryptionIterations?:number};
export type DemoGenerationResult={output:string;password:string;encryptedBytes:number;counts:Record<string,number>;createdAt:string};

export async function generateDemoBackup(options:DemoGenerationOptions={}):Promise<DemoGenerationResult>{
  const output=resolve(options.output??DEFAULT_OUTPUT),password=options.password??DEFAULT_PASSWORD,loadCount=options.loadCount??4000,now=options.now??new Date();
  if(loadCount<1||loadCount>20_000||!Number.isInteger(loadCount))throw new Error('loadCount must be an integer between 1 and 20,000.');
  const temporaryDirectory=mkdtempSync(join(tmpdir(),'dromex-demo-')),databasePath=join(temporaryDirectory,'database.sqlite');
  const db=new DatabaseSync(databasePath);
  try{
    const adapter={execAsync:async(sql:string)=>{db.exec(sql);},getFirstAsync:async(sql:string)=>db.prepare(sql).get()};
    await migrateDatabase(adapter as never);
    seedDatabase(db,now,loadCount);
    const integrity=db.prepare('PRAGMA integrity_check').get() as Record<string,string>;
    if(!Object.values(integrity).includes('ok'))throw new Error('Generated demo database failed integrity_check.');
    const broken=db.prepare('PRAGMA foreign_key_check').all();
    if(broken.length)throw new Error(`Generated demo database contains ${broken.length} broken relationships.`);
    // Android previews restored backups through Expo SQLite's in-memory
    // deserializer. A database whose header still requests WAL mode tries to
    // open a companion WAL file and fails with "unable to open database file".
    // Package the standalone demo database in rollback-journal mode instead.
    db.exec('PRAGMA wal_checkpoint(FULL); PRAGMA journal_mode = DELETE;');
  }finally{db.close();}

  try{
    const createdAt=now.toISOString(),backupId=randomUUID(),databaseBytes=Uint8Array.from(readFileSync(databasePath));
    const counts=collectCounts(databasePath);
    const preferences:Array<[string,string]>=[
      ['dromex.active-project.v1','demo_backup_project_01'],
      ['dromex.dashboard.collapsed.v1','false'],
      ['dromex.draft.quick-text.v1',JSON.stringify({title:'DEMO draft site notice',reference:'DEMO-DRAFT-01',customerId:'demo_backup_customer_01',projectId:'demo_backup_project_01',message:'This is an autosaved demo draft. Use Draft Center to continue it or move it to Trash.',alignment:'left',emphasis:'notice',preparedBy:'Demo Site Manager',showSignatureLine:true,paperWidth:'80'})],
    ];
    const mediaPath='media/00001.png';
    const media=buildMediaLocators();
    const manifest={format:ARCHIVE_FORMAT,formatVersion:ARCHIVE_VERSION,backupId,createdAt,appVersion:'0.3.1',databaseVersion:DATABASE_VERSION,recordCounts:counts,preferenceCount:preferences.length,media};
    const archive=zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'database.sqlite':databaseBytes,'preferences.json':strToU8(JSON.stringify(preferences)),[mediaPath]:ONE_PIXEL_PNG},{level:6});
    const encrypted=await encryptBackupBytes(archive,password,{randomBytes:size=>Uint8Array.from(randomBytes(size)),...(options.encryptionIterations===undefined?{}:{iterations:options.encryptionIterations})});
    mkdirSync(dirname(output),{recursive:true});
    const partial=`${output}.partial`;writeFileSync(partial,encrypted);rmSync(output,{force:true});writeFileSync(output,readFileSync(partial));rmSync(partial,{force:true});
    return{output,password,encryptedBytes:encrypted.length,counts,createdAt};
  }finally{rmSync(temporaryDirectory,{recursive:true,force:true});}
}

function seedDatabase(db:DatabaseSync,now:Date,loadCount:number){
  const timestamp=now.toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
    insert(db,'customers',{id:'company',customer_type:'company',name:'DROMEX Demo Construction',phone:'+961 1 555 010',email:'demo@dromex.local',address:'Demo Industrial Zone, Lebanon',tax_vat_number:'DEMO-VAT-001',notes:'DEMO company identity',is_own_company:1,is_active:1,merged_into_id:null,created_at:timestamp,updated_at:timestamp});
    insert(db,'company_settings',{id:'company',company_name:'DROMEX Demo Construction',logo_uri:null,address:'Demo Industrial Zone, Lebanon',phone:'+961 1 555 010',email:'demo@dromex.local',tax_vat_number:'DEMO-VAT-001',receipt_footer:'DEMO DATA — NOT A REAL FINANCIAL DOCUMENT',updated_at:timestamp});
    insert(db,'tax_settings',{id:'tax',vat_rate_basis_points:1100,updated_at:timestamp});

    const customerNames=['Cedar Developments','Beirut Civil Works','Mountain Road Contractors','Levant Concrete Group','Coastal Infrastructure','Bekaa Earthworks','Northline Builders','Phoenicia Estates','Atlas Contracting','Harbor Engineering','Green Valley Homes','Capital Site Services','Stonebridge Lebanon','Metro Foundations','Summit Developments','Blue Coast Projects','Urban Frame SAL','Oakline Construction','Eastern Works','Riverside Holdings','Grand Build Co','Terra Projects','Horizon Contracting','Landmark Civil'];
    customerNames.forEach((name,index)=>insert(db,'customers',{id:id('customer',index),customer_type:'company',name:`DEMO · ${name}`,phone:`+961 70 ${String(110000+index).padStart(6,'0')}`,email:`demo.customer${index+1}@example.test`,address:`Demo address ${index+1}, Lebanon`,tax_vat_number:`DEMO-C-${String(index+1).padStart(3,'0')}`,notes:index%5===0?'Priority demo account':null,is_own_company:0,is_active:index===23?0:1,merged_into_id:null,created_at:timestamp,updated_at:timestamp}));

    const categoryRows=[['aggregate','Aggregates'],['concrete','Concrete Products'],['fill','Fill & Earth'],['pipes','Pipes & Drainage']];
    categoryRows.forEach(([suffix,name],index)=>insert(db,'categories',{id:`demo_backup_category_${suffix}`,name:`DEMO · ${name}`,is_active:1,created_at:timestamp,updated_at:timestamp}));
    const itemRows=[['crusher','Crusher Run','aggregate',1850],['sand','Washed Sand','aggregate',1450],['gravel','Gravel 20mm','aggregate',1625],['base','Road Base','aggregate',1750],['concrete','Ready Mix Concrete','concrete',7200],['blocks','Concrete Blocks','concrete',950],['soil','Selected Fill','fill',1200],['rock','Quarry Rock','fill',1350],['pipe300','HDPE Pipe 300 mm','pipes',4200],['pipe600','Concrete Pipe 600 mm','pipes',9800],['culvert','Box Culvert Unit','pipes',14500],['drain','Drainage Channel','pipes',3600]] as const;
    itemRows.forEach(([suffix,name,category,price],index)=>insert(db,'catalog_items',{id:`demo_backup_item_${suffix}`,category_id:`demo_backup_category_${category}`,name:`DEMO · ${name}`,internal_code:`DEMO-${String(index+1).padStart(3,'0')}`,description:'Representative linked test material',default_unit_id:'unit_ton',default_receipt_price_usd_cents:price,loads_enabled:1,quarry_enabled:1,daily_reports_enabled:1,is_active:1,created_at:timestamp,updated_at:timestamp}));

    for(let index=0;index<12;index++)insert(db,'driver_profiles',{id:id('driver',index),name:`DEMO · Driver ${String(index+1).padStart(2,'0')}`,phone:`+961 71 ${String(220000+index).padStart(6,'0')}`,license_number:`DEMO-LIC-${index+1}`,notes:index%4===0?'Night-shift qualified':null,is_active:1,created_at:timestamp,updated_at:timestamp});
    for(let index=0;index<12;index++)insert(db,'truck_profiles',{id:id('truck',index),plate:`DEMO-${String(index+1).padStart(3,'0')}`,make_model:pick(['Mercedes Actros','MAN TGS','Volvo FMX'],index),capacity_kg:22000+(index%4)*2000,owner_name:index%2?'Demo Fleet Partner':'DROMEX Demo Construction',notes:null,is_active:1,created_at:timestamp,updated_at:timestamp});
    for(let index=0;index<20;index++)insert(db,'worker_profiles',{id:id('worker',index),name:`DEMO · Worker ${String(index+1).padStart(2,'0')}`,role:pick(['Foreman','Carpenter','Steel fixer','General worker','Surveyor'],index),phone:`+961 76 ${String(330000+index).padStart(6,'0')}`,notes:null,is_active:1,created_at:timestamp,updated_at:timestamp});
    for(let index=0;index<8;index++)insert(db,'machine_profiles',{id:id('machine',index),name:`DEMO · ${pick(['Excavator','Wheel Loader','Bulldozer','Roller','Generator','Crane','Backhoe','Water Tanker'],index)}`,machine_type:pick(['Earthmoving','Earthmoving','Earthmoving','Compaction','Power','Lifting','Earthmoving','Support'],index),identifier:`DEMO-EQ-${index+1}`,notes:null,is_active:1,created_at:timestamp,updated_at:timestamp});
    for(let index=0;index<6;index++)insert(db,'suppliers',{id:id('supplier',index),name:`DEMO · ${['National Quarry','Cedar Fuel','Mountain Aggregates','Coastal Materials','Bekaa Stone','Central Concrete'][index]}`,phone:`+961 3 ${String(440000+index).padStart(6,'0')}`,email:`demo.supplier${index+1}@example.test`,address:`Demo supplier yard ${index+1}`,tax_vat_number:`DEMO-S-${index+1}`,notes:null,is_active:1,created_at:timestamp,updated_at:timestamp});

    const projectNames=['Airport Service Road','Cedar Heights Residences','Beirut Logistics Yard','Bekaa Drainage Upgrade','Coastal Retaining Wall','North Highway Section','Municipal Water Reservoir','Industrial Park Phase II','Mountain School Campus','Old Port Rehabilitation','Central Warehouse','Valley Bridge Works'];
    projectNames.forEach((name,index)=>insert(db,'projects',{id:id('project',index),customer_id:id('customer',index),name:`DEMO · ${name}`,location:`Demo Site ${index+1}, ${['Beirut','Mount Lebanon','Bekaa','North Lebanon'][index%4]}`,status:index>=9?'completed':'active',start_date:isoDate(daysAgo(now,220-index*7)),end_date:index>=9?isoDate(daysAgo(now,20+index)):null,notes:index===0?'Primary active project for the walkthrough':null,created_at:timestamp,updated_at:timestamp,is_archived:0}));

    seedLoads(db,now,loadCount);
    seedReports(db,now);
    seedQuarry(db,now);
    seedWaste(db,now);
    seedScheduleAndIssues(db,now);
    seedPavement(db,now);
    seedWalls(db,now);
    seedFuel(db,now);
    seedOpeningBalances(db,now);
    seedDocumentsAndMedia(db,now);
    db.prepare('UPDATE device_state SET device_code=?,next_load_sequence=?,next_quarry_sequence=?,next_quick_text_sequence=? WHERE id=?').run('DEMO',loadCount+1,601,31,'local');
    db.exec('COMMIT');
  }catch(cause){db.exec('ROLLBACK');throw cause;}
}

function seedLoads(db:DatabaseSync,now:Date,count:number){
  const items=['crusher','sand','gravel','base','concrete','blocks','soil','rock','pipe300','pipe600','culvert','drain'];
  for(let index=0;index<count;index++){
    const projectIndex=index%12,projectId=id('project',projectIndex),customerId=id('customer',projectIndex),item=items[index%items.length]!,driver=index%12,confirmedAt=atDay(now,index%180,6+(index%12),index%60);
    const direct=['blocks','pipe300','pipe600','culvert','drain'].includes(item),empty=direct?0:10500+(index%25)*80,net=direct?1:9000+(index%40)*220,full=direct?1:empty+net;
    const directUnit=index%3===0?{id:'unit_bundle',name:'Bundle',symbol:'bundle'}:index%3===1?{id:'unit_metre',name:'Metre',symbol:'m'}:{id:'unit_piece',name:'Piece',symbol:'pc'};
    const billed=direct?12+(index%45):net/1000;
    const unpriced=index%17===0,free=index%29===0,unitPrice=unpriced?null:free?0:1200+(index%7)*175,subtotal=unitPrice===null?null:Math.round(billed*unitPrice),vat=subtotal===null?null:Math.round(subtotal*.11),total=subtotal===null?null:subtotal+(vat??0);
    let status='Unpriced';if(total===0)status='No Payment Due';else if(total!==null)status=index%4===0?'Paid':index%4===1?'Partially Paid':'Unpaid';
    const loadId=id('load',index);
    insert(db,'loads',{id:loadId,transaction_number:`LOAD-DEMO-${String(index+1).padStart(5,'0')}`,confirmed_at:confirmedAt,customer_id:customerId,customer_name:`DEMO · ${['Cedar Developments','Beirut Civil Works','Mountain Road Contractors','Levant Concrete Group','Coastal Infrastructure','Bekaa Earthworks','Northline Builders','Phoenicia Estates','Atlas Contracting','Harbor Engineering','Green Valley Homes','Capital Site Services'][projectIndex]}`,project_id:projectId,project_name:`DEMO · ${['Airport Service Road','Cedar Heights Residences','Beirut Logistics Yard','Bekaa Drainage Upgrade','Coastal Retaining Wall','North Highway Section','Municipal Water Reservoir','Industrial Park Phase II','Mountain School Campus','Old Port Rehabilitation','Central Warehouse','Valley Bridge Works'][projectIndex]}`,project_location:`Demo Site ${projectIndex+1}`,destination_address:null,item_id:`demo_backup_item_${item}`,item_name:`DEMO · ${itemLabel(item)}`,item_code:`DEMO-${String((index%12)+1).padStart(3,'0')}`,category_name:item==='concrete'||item==='blocks'?'DEMO · Concrete Products':item==='soil'||item==='rock'?'DEMO · Fill & Earth':item.startsWith('pipe')||item==='culvert'||item==='drain'?'DEMO · Pipes & Drainage':'DEMO · Aggregates',driver_name:`DEMO · Driver ${String(driver+1).padStart(2,'0')}`,truck_plate:`DEMO-${String(driver+1).padStart(3,'0')}`,requested_quantity_kg:!direct&&index%3===0?net+1000:null,empty_weight_kg:empty,full_weight_kg:full,net_weight_kg:net,conversion_id:'conversion_kg_ton',conversion_name:direct?'Direct quantity':'Kilograms to metric tons',conversion_rule:direct?'Entered directly':'1000 kg = 1 t',output_unit_symbol:direct?directUnit.symbol:'t',converted_quantity:billed,billed_quantity:billed,unit_price_usd_cents:unitPrice,subtotal_usd_cents:subtotal,vat_rate_basis_points:unitPrice===null?null:1100,vat_amount_usd_cents:vat,final_total_usd_cents:total,payment_status:status,signature_status:index%5===0?'Signed':'Unsigned',notes:index%31===0?'DEMO corrected site instruction noted':null,company_name:'DROMEX Demo Construction',company_address:'Demo Industrial Zone, Lebanon',company_phone:'+961 1 555 010',company_email:'demo@dromex.local',company_tax_vat_number:'DEMO-VAT-001',company_receipt_footer:'DEMO DATA — NOT A REAL FINANCIAL DOCUMENT',driver_profile_id:id('driver',driver),truck_profile_id:id('truck',driver),signature_json:index%5===0?JSON.stringify(['M 35 85 C 70 20, 120 130, 165 55','M 130 90 C 180 25, 230 120, 285 50']):null,company_logo_uri:null,is_archived:0,quantity_method:direct?'direct':'weighbridge',direct_quantity:direct?billed:null,direct_unit_id:direct?directUnit.id:null,direct_unit_name:direct?directUnit.name:null,direct_unit_symbol:direct?directUnit.symbol:null});
    if(total&&status==='Paid')insertPayment(db,`load_${index}_paid`,'load',loadId,total,confirmedAt,null);
    if(total&&status==='Partially Paid')insertPayment(db,`load_${index}_partial`,'load',loadId,Math.floor(total/2),confirmedAt,null);
    if(total&&index%53===0)insertPayment(db,`load_${index}_cancelled`,'load',loadId,Math.max(1,Math.floor(total/4)),confirmedAt,'Duplicate demo payment');
  }
}

function seedReports(db:DatabaseSync,now:Date){
  for(let project=0;project<12;project++)for(let day=project<9?0:20;day<90;day++){
    if(day===0&&project>=6&&project<9)continue;
    const date=isoDate(daysAgo(now,day)),created=atDay(now,day,17,15);
    const material=pick(['crusher','sand','gravel','base'],day);
    insert(db,'daily_project_reports',{id:`demo_backup_report_${project}_${day}`,project_id:id('project',project),work_date:date,work_description:pick(['Excavation and hauling','Base-course placement','Concrete preparation','Drainage installation'],day),workers_json:JSON.stringify([`DEMO · Worker ${String((project%20)+1).padStart(2,'0')}`,`DEMO · Worker ${String(((project+5)%20)+1).padStart(2,'0')}`]),drivers_json:JSON.stringify([`DEMO · Driver ${String((project%12)+1).padStart(2,'0')}`]),truck_plates_json:JSON.stringify([`DEMO-${String((project%12)+1).padStart(3,'0')}`]),machines_json:JSON.stringify([`DEMO · ${pick(['Excavator','Wheel Loader','Bulldozer','Roller'],day)}`]),materials_json:JSON.stringify([{itemId:`demo_backup_item_${material}`,itemName:`DEMO · ${itemLabel(material)}`,quantity:12+(day%8),unitSymbol:'t',movement:day%3===0?'transported':'used'}]),notes:day%14===0?'Survey benchmark checked.':null,problems_delays_incidents:day%23===0?'DEMO: short weather delay recorded.':null,weather_site_conditions:pick(['Clear / dry','Cloudy / workable','Light rain / muddy'],day),work_start_time:'07:00',work_end_time:'16:30',break_minutes:60,next_work_planned:'Continue planned activity and quality checks.',created_at:created,updated_at:created,photos_json:day<20&&project<3?JSON.stringify([`file:///demo/report-${project}-${day}.png`]):'[]'});
  }
}

function seedQuarry(db:DatabaseSync,now:Date){
  for(let index=0;index<600;index++){
    const project=index%12,item=['crusher','sand','gravel','base','soil','rock'][index%6]!,quantity=8+(index%25),unit=950+(index%6)*125,subtotal=quantity*unit,vat=Math.round(subtotal*.11),total=subtotal+vat,status=index%11===0?'Cancelled':'Active',payment=index%3===0?'Paid':index%3===1?'Partially Paid':'Unpaid',confirmed=atDay(now,index%180,8+(index%9),index%60),purchaseId=id('quarry',index);
    insert(db,'quarry_purchases',{id:purchaseId,purchase_number:`QP-DEMO-${String(index+1).padStart(4,'0')}`,confirmed_at:confirmed,supplier_id:id('supplier',index%6),supplier_name:`DEMO · ${pick(['National Quarry','Cedar Fuel','Mountain Aggregates','Coastal Materials','Bekaa Stone','Central Concrete'],index)}`,item_id:`demo_backup_item_${item}`,item_name:`DEMO · ${itemLabel(item)}`,item_code:`DEMO-${String((index%8)+1).padStart(3,'0')}`,category_name:'DEMO · Aggregates',quantity_cubic_metres:quantity,driver_profile_id:id('driver',index%12),driver_name:`DEMO · Driver ${String((index%12)+1).padStart(2,'0')}`,truck_profile_id:id('truck',index%12),truck_plate:`DEMO-${String((index%12)+1).padStart(3,'0')}`,supplier_ticket_number:`TKT-${10000+index}`,unit_price_usd_cents:unit,subtotal_usd_cents:subtotal,vat_rate_basis_points:1100,vat_amount_usd_cents:vat,final_total_usd_cents:total,payment_status:status==='Cancelled'?'Unpaid':payment,notes:index%19===0?'Moisture condition noted':null,photos_json:index<20?JSON.stringify([`file:///demo/quarry-${index}.png`]):'[]',status,cancellation_reason:status==='Cancelled'?'DEMO duplicate ticket':null,cancelled_at:status==='Cancelled'?confirmed:null,project_id:id('project',project),project_name:`DEMO · ${pick(['Airport Service Road','Cedar Heights Residences','Beirut Logistics Yard','Bekaa Drainage Upgrade','Coastal Retaining Wall','North Highway Section','Municipal Water Reservoir','Industrial Park Phase II','Mountain School Campus','Old Port Rehabilitation','Central Warehouse','Valley Bridge Works'],project)}`});
    if(status==='Active'&&payment==='Paid')insertPayment(db,`quarry_${index}_paid`,'quarryPurchase',purchaseId,total,confirmed,null);
    if(status==='Active'&&payment==='Partially Paid')insertPayment(db,`quarry_${index}_partial`,'quarryPurchase',purchaseId,Math.floor(total/2),confirmed,null);
  }
}

function seedWaste(db:DatabaseSync,now:Date){
  for(let index=0;index<800;index++){const project=index%9,driver=index%12,date=isoDate(daysAgo(now,index%90)),time=atDay(now,index%90,7+(index%10),index%60),cancelled=index%47===0;insert(db,'waste_dumps',{id:id('waste',index),project_id:id('project',project),work_date:date,dumped_at:time,material_type:pick(['Excavated soil','Broken concrete','Mixed construction waste'],index),dump_location:pick(['North disposal area','Municipal approved dump','On-site reuse stockpile'],index),truck_profile_id:id('truck',driver),truck_plate:`DEMO-${String(driver+1).padStart(3,'0')}`,driver_profile_id:id('driver',driver),driver_name:`DEMO · Driver ${String(driver+1).padStart(2,'0')}`,notes:index%13===0?'Counter-created demo trip':null,status:cancelled?'Cancelled':'Active',cancellation_reason:cancelled?'DEMO accidental counter tap':null,cancelled_at:cancelled?time:null,created_at:time,updated_at:time});}
  for(let project=0;project<9;project++)for(let driver=0;driver<3;driver++)insert(db,'waste_counter_presets',{id:`demo_backup_counter_${project}_${driver}`,project_id:id('project',project),driver_profile_id:id('driver',(project+driver)%12),truck_profile_id:id('truck',(project+driver)%12),material_type:'Excavated soil',dump_location:'North disposal area',notes:'DEMO persistent trip counter',created_at:now.toISOString(),updated_at:now.toISOString()});
}

function seedScheduleAndIssues(db:DatabaseSync,now:Date){
  for(let index=0;index<160;index++){const project=index%9,start=daysAgo(now,15-(index%46)),status=pick(['Planned','In Progress','Blocked','Completed'] as const,index),created=now.toISOString();insert(db,'schedule_tasks',{id:id('schedule',index),project_id:id('project',project),title:`DEMO · ${pick(['Excavate sector','Place road base','Pour concrete','Install drainage','Survey levels'],index)} ${index+1}`,start_date:isoDate(start),end_date:isoDate(new Date(start.getTime()+(index%3)*86400000)),priority:pick(['Low','Normal','High','Urgent'] as const,index),status,responsible_person:`DEMO · Worker ${String((index%20)+1).padStart(2,'0')}`,location:`Zone ${String.fromCharCode(65+(index%5))}`,notes:index%9===0?'Coordinate with supplier delivery.':null,completed_at:status==='Completed'?created:null,created_at:created,updated_at:created});}
  for(let index=0;index<60;index++){const resolved=index%3===0,created=atDay(now,index%45,9,0);insert(db,'project_issues',{id:id('issue',index),project_id:id('project',index%9),title:`DEMO · ${pick(['Access coordination','Drawing clarification','Material approval','Safety barrier','Survey discrepancy'],index)}`,description:'Representative project issue for workflow testing.',priority:pick(['Low','Normal','High','Urgent'] as const,index),status:resolved?'Resolved':'Open',due_date:isoDate(daysAgo(now,-(index%20))),resolved_at:resolved?now.toISOString():null,created_at:created,updated_at:created});}
}

function seedPavement(db:DatabaseSync,now:Date){
  const rates=[60,70,80,90,100,110,120,150],densities=[2.3,2.35,2.4,2.45],looseFactors=[1.18,1.2,1.22,1.25];
  for(let index=0;index<96;index++){
    const project=index%9,length=80+(index%12)*35,width=3.25+(index%4)*.75,area=length*width,rate=rates[index%rates.length]!,density=densities[index%densities.length]!,allowance=[0,3,5,7.5][index%4]!,factor=looseFactors[index%looseFactors.length]!;
    const theoretical=area*rate,allowanceKg=theoretical*allowance/100,planned=theoretical+allowanceKg,thickness=rate/density,loose=thickness*factor,created=atDay(now,index%120,11,index%60);
    insert(db,'pavement_calculations',{id:id('pavement',index),project_id:id('project',project),name:`DEMO · ${pick(['Wearing course','Binder course','Asphalt base','Parking area','Access ramp','Shoulder strip'],index)} ${index+1}`,length_m:length,width_m:width,area_m2:area,spread_rate_kg_m2:rate,density_t_m3:density,allowance_percent:allowance,theoretical_kg:theoretical,allowance_kg:allowanceKg,planned_kg:planned,thickness_mm:thickness,notes:index%10===0?'Verify against approved mix design and trial strip.':null,created_at:created,updated_at:created,loose_thickness_factor:factor,loose_thickness_mm:loose});
  }
}

function seedWalls(db:DatabaseSync,now:Date){
  const systems=['reinforced_concrete','rubble_masonry','cyclopean_concrete'] as const,purposes=['retaining','boundary','other'] as const;
  for(let index=0;index<45;index++){
    const project=index%9,length=12+(index%10)*4,height=1.5+(index%5)*.6,bottom=.45+(index%4)*.15,top=.25+(index%3)*.1,deduction=index%6===0?1.2:0,allowance=[3,5,7.5][index%3]!,net=length*height*(bottom+top)/2-deduction,planned=net*(1+allowance/100),created=atDay(now,index%100,9,index%60),wallId=id('wall',index);
    insert(db,'walls',{id:wallId,project_id:id('project',project),name:`DEMO · ${pick(['North retaining wall','Boundary wall','Ramp wing wall','Drainage headwall','Terrace wall'],index)} ${index+1}`,system:systems[index%systems.length]!,purpose:purposes[index%purposes.length]!,length_m:length,height_m:height,bottom_thickness_m:bottom,top_thickness_m:top,deduction_m3:deduction,allowance_percent:allowance,net_volume_m3:net,planned_volume_m3:planned,notes:index%8===0?'Representative wall with multiple consumption types.':null,created_at:created,updated_at:created});
    seedWallUse(db,wallId,index,now,'ready_mix');
    seedWallUse(db,wallId,index,now,'site_mix');
    seedWallUse(db,wallId,index,now,'rebar');
    seedWallUse(db,wallId,index,now,'stone');
  }
}

function seedWallUse(db:DatabaseSync,wallId:string,index:number,now:Date,type:'ready_mix'|'site_mix'|'rebar'|'stone'){
  const usedOn=isoDate(daysAgo(now,(index*2+(['ready_mix','site_mix','rebar','stone'].indexOf(type)))%100)),created=atDay(now,index%100,13,['ready_mix','site_mix','rebar','stone'].indexOf(type)*10),diameter=[10,12,16,20][index%4]!,count=18+(index%15),lengthEach=6+(index%3)*3,totalLength=count*lengthEach,totalKg=totalLength*diameter*diameter/162;
  insert(db,'wall_consumptions',{id:`${wallId}_${type}`,wall_id:wallId,used_on:usedOn,material_type:type,concrete_purpose:type==='ready_mix'?'structural':type==='site_mix'?'mortar':null,finished_volume_m3:type==='ready_mix'?8+(index%6):type==='site_mix'?3+(index%4):null,cement_bags:type==='site_mix'?35+(index%20):null,cement_bag_kg:type==='site_mix'?50:null,sand_quantity:type==='site_mix'?4+(index%3):null,sand_unit:type==='site_mix'?'m3':null,gravel_quantity:type==='site_mix'?6+(index%4):null,gravel_unit:type==='site_mix'?'m3':null,water_litres:type==='site_mix'?900+(index%6)*80:null,admixture_quantity:type==='site_mix'?8+(index%5):null,admixture_unit:type==='site_mix'?'litres':null,stone_quantity:type==='stone'?12+(index%8):null,stone_unit:type==='stone'?'m3':null,rebar_diameter_mm:type==='rebar'?diameter:null,rebar_count:type==='rebar'?count:null,rebar_length_each_m:type==='rebar'?lengthEach:null,total_rebar_length_m:type==='rebar'?totalLength:null,total_rebar_kg:type==='rebar'?totalKg:null,rebar_grade:type==='rebar'?'B500B':null,notes:`DEMO ${type.replace('_',' ')} consumption entry`,created_at:created});
}

function seedFuel(db:DatabaseSync,now:Date){
  let balance=4200;insert(db,'fuel_movements',{id:'demo_backup_fuel_gauge_0',movement_type:'gauge',confirmed_at:atDay(now,179,6,0),litres:balance,previous_balance_litres:null,difference_litres:null,supplier_id:null,supplier_name:null,equipment_id:null,equipment_name:null,project_id:null,project_name:null,ticket_number:null,odometer_reading:null,reason:'Opening physical gauge',notes:'DEMO tank baseline',price_per_litre_usd_cents:null,subtotal_usd_cents:null,vat_rate_basis_points:null,vat_amount_usd_cents:null,final_total_usd_cents:null,payment_status:'No Payment Due',status:'Active',cancellation_reason:null,cancelled_at:null,created_at:atDay(now,179,6,0)});
  for(let index=0;index<90;index++){const delivery=index%3===0,litres=delivery?1200:120+(index%5)*30,previous=balance;balance=delivery?balance+litres:Math.max(0,balance-litres);const confirmed=atDay(now,178-index*2,delivery?8:15,index%60),subtotal=delivery?litres*105:null,vat=subtotal===null?null:Math.round(subtotal*.11),total=subtotal===null?null:subtotal+(vat??0),movementId=id('fuel',index);insert(db,'fuel_movements',{id:movementId,movement_type:delivery?'delivery':'fill',confirmed_at:confirmed,litres,previous_balance_litres:previous,difference_litres:delivery?litres:-litres,supplier_id:delivery?id('supplier',1):null,supplier_name:delivery?'DEMO · Cedar Fuel':null,equipment_id:delivery?null:id('machine',index%8),equipment_name:delivery?null:`DEMO · ${pick(['Excavator','Wheel Loader','Bulldozer','Roller','Generator','Crane','Backhoe','Water Tanker'],index)}`,project_id:delivery?null:id('project',index%9),project_name:delivery?null:`DEMO project ${index%9+1}`,ticket_number:delivery?`FUEL-${1000+index}`:null,odometer_reading:delivery?null:String(1000+index*12),reason:null,notes:null,price_per_litre_usd_cents:delivery?105:null,subtotal_usd_cents:subtotal,vat_rate_basis_points:delivery?1100:null,vat_amount_usd_cents:vat,final_total_usd_cents:total,payment_status:delivery?(index%2?'Unpaid':'Paid'):'No Payment Due',status:'Active',cancellation_reason:null,cancelled_at:null,created_at:confirmed});if(delivery&&index%2===0&&total)insertPayment(db,`fuel_${index}_paid`,'fuelDelivery',movementId,total,confirmed,null);}
}

function seedOpeningBalances(db:DatabaseSync,now:Date){
  for(let index=0;index<24;index++){const amount=50_000+index*7_500,balanceId=`demo_backup_open_customer_${index}`,status=index%3===0?'Paid':index%3===1?'Partially Paid':'Unpaid';insert(db,'opening_balances',{id:balanceId,party_type:'customer',customer_id:id('customer',index),supplier_id:null,party_name:`DEMO customer ${index+1}`,original_amount_usd_cents:amount,as_of_date:isoDate(daysAgo(now,200)),reference:`DEMO-OB-C-${index+1}`,notes:'Carried-forward demo balance',payment_status:status,created_at:now.toISOString()});if(status==='Paid')insertPayment(db,`open_c_${index}_paid`,'openingBalance',balanceId,amount,now.toISOString(),null);if(status==='Partially Paid')insertPayment(db,`open_c_${index}_partial`,'openingBalance',balanceId,Math.floor(amount/2),now.toISOString(),null);}
  for(let index=0;index<6;index++){const amount=80_000+index*15_000,balanceId=`demo_backup_open_supplier_${index}`;insert(db,'opening_balances',{id:balanceId,party_type:'supplier',customer_id:null,supplier_id:id('supplier',index),party_name:`DEMO supplier ${index+1}`,original_amount_usd_cents:amount,as_of_date:isoDate(daysAgo(now,200)),reference:`DEMO-OB-S-${index+1}`,notes:null,payment_status:index%2?'Partially Paid':'Unpaid',created_at:now.toISOString()});if(index%2)insertPayment(db,`open_s_${index}_partial`,'openingBalance',balanceId,Math.floor(amount/3),now.toISOString(),null);}
}

function seedDocumentsAndMedia(db:DatabaseSync,now:Date){
  for(let index=0;index<30;index++)insert(db,'quick_text_documents',{id:id('quicktext',index),document_number:`QT-DEMO-${String(index+1).padStart(3,'0')}`,created_at:atDay(now,index%60,10,0),title:`DEMO · ${['Site Notice','Delivery Instruction','Safety Reminder'][index%3]}`,reference:`REF-DEMO-${index+1}`,customer_id:id('customer',index%24),customer_name:`DEMO customer ${index%24+1}`,project_id:id('project',index%12),project_name:`DEMO project ${index%12+1}`,message:'This is a representative saved Quick Text document for testing search, history, preview, PDF, and sharing.',alignment:index%3===0?'center':'left',emphasis:index%4===0?'notice':'normal',prepared_by:'Demo Site Manager',show_signature_line:index%2,paper_width:index%2?'80':'58',company_name:'DROMEX Demo Construction',company_address:'Demo Industrial Zone, Lebanon',company_phone:'+961 1 555 010',company_email:'demo@dromex.local',company_tax_vat_number:'DEMO-VAT-001',company_receipt_footer:'DEMO DATA — NOT A REAL FINANCIAL DOCUMENT',company_logo_uri:null});
  for(let index=0;index<24;index++)insert(db,'project_media',{id:id('media',index),project_id:id('project',index%12),uri:`file:///demo/project-${index}.png`,caption:`DEMO site photo ${index+1}`,created_at:atDay(now,index%60,14,30)});
}

function insertPayment(db:DatabaseSync,suffix:string,targetType:'load'|'quarryPurchase'|'openingBalance'|'fuelDelivery',targetId:string,amount:number,date:string,cancellationReason:string|null){insert(db,'payment_entries',{id:`demo_backup_payment_${suffix}`,target_type:targetType,load_id:targetType==='load'?targetId:null,quarry_purchase_id:targetType==='quarryPurchase'?targetId:null,opening_balance_id:targetType==='openingBalance'?targetId:null,fuel_movement_id:targetType==='fuelDelivery'?targetId:null,amount_usd_cents:amount,payment_date:date.slice(0,10),status:cancellationReason?'Cancelled':'Active',cancellation_reason:cancellationReason,cancelled_at:cancellationReason?date:null,created_at:date});}
function insert(db:DatabaseSync,table:string,row:Record<string,Scalar>){const columns=Object.keys(row),marks=columns.map(()=>'?').join(',');db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${marks})`).run(...Object.values(row));}
function id(kind:string,index:number){return`demo_backup_${kind}_${String(index+1).padStart(3,'0')}`;}
function daysAgo(now:Date,days:number){return new Date(now.getTime()-days*86400000);}
function isoDate(value:Date){return value.toISOString().slice(0,10);}
function atDay(now:Date,days:number,hour:number,minute:number){const value=daysAgo(now,days);value.setUTCHours(hour,minute,0,0);return value.toISOString();}
function itemLabel(value:string){return({crusher:'Crusher Run',sand:'Washed Sand',gravel:'Gravel 20mm',base:'Road Base',concrete:'Ready Mix Concrete',blocks:'Concrete Blocks',soil:'Selected Fill',rock:'Quarry Rock',pipe300:'HDPE Pipe 300 mm',pipe600:'Concrete Pipe 600 mm',culvert:'Box Culvert Unit',drain:'Drainage Channel'} as Record<string,string>)[value]??value;}
function pick<T>(values:readonly T[],index:number):T{return values[index%values.length]!;}

function collectCounts(databasePath:string){const tables=['loads','projects','customers','daily_project_reports','quarry_purchases','waste_dumps','fuel_movements','payment_entries','schedule_tasks','pavement_calculations','walls','wall_consumptions','project_issues','project_media','quick_text_documents','suppliers','driver_profiles','truck_profiles','worker_profiles','machine_profiles','catalog_items'];const db=new DatabaseSync(databasePath,{readOnly:true});try{const counts:Record<string,number>={};for(const table of tables)counts[table]=Number((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as{count:number|bigint}).count);return counts;}finally{db.close();}}
function buildMediaLocators(){const archivePath='media/00001.png',values:Array<{table:string;recordId:string;column:string;jsonIndex:number|null;archivePath:string}>=[];for(let index=0;index<24;index++)values.push({table:'project_media',recordId:id('media',index),column:'uri',jsonIndex:null,archivePath});for(let project=0;project<3;project++)for(let day=0;day<20;day++)values.push({table:'daily_project_reports',recordId:`demo_backup_report_${project}_${day}`,column:'photos_json',jsonIndex:0,archivePath});for(let index=0;index<20;index++)values.push({table:'quarry_purchases',recordId:id('quarry',index),column:'photos_json',jsonIndex:0,archivePath});return values;}

const isMain=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(isMain){generateDemoBackup().then(result=>{console.log(JSON.stringify(result,null,2));console.log(`\nRestore password: ${result.password}`);}).catch(cause=>{console.error(cause);process.exitCode=1;});}
