import type {SQLiteDatabase} from 'expo-sqlite';

export type Slice11LargeDataCounts={customers:number;suppliers:number;projects:number;reports:number;loads:number;quarryPurchases:number;fuelMovements:number;payments:number};

const prefix='slice11_test_';
export const slice11LargeDataCounts:Slice11LargeDataCounts={customers:8,suppliers:4,projects:12,reports:1000,loads:4000,quarryPurchases:800,fuelMovements:901,payments:2669};

async function deleteRows(db:SQLiteDatabase):Promise<void>{
  await db.execAsync(`
    DELETE FROM payment_entries WHERE id LIKE '${prefix}%';
    DELETE FROM fuel_movements WHERE id LIKE '${prefix}%';
    DELETE FROM quarry_purchases WHERE id LIKE '${prefix}%';
    DELETE FROM daily_project_reports WHERE id LIKE '${prefix}%';
    DELETE FROM loads WHERE id LIKE '${prefix}%';
    DELETE FROM projects WHERE id LIKE '${prefix}%';
    DELETE FROM machine_profiles WHERE id LIKE '${prefix}%';
    DELETE FROM truck_profiles WHERE id LIKE '${prefix}%';
    DELETE FROM driver_profiles WHERE id LIKE '${prefix}%';
    DELETE FROM catalog_items WHERE id LIKE '${prefix}%';
    DELETE FROM categories WHERE id LIKE '${prefix}%';
    DELETE FROM suppliers WHERE id LIKE '${prefix}%';
    DELETE FROM customers WHERE id LIKE '${prefix}%';
    DELETE FROM sync_outbox WHERE entity_id LIKE '${prefix}%';
  `);
}

export async function removeSlice11LargeData(db:SQLiteDatabase):Promise<number>{
  const row=await db.getFirstAsync<{count:number}>(`SELECT COUNT(*) count FROM loads WHERE id LIKE '${prefix}%'`);
  await db.withTransactionAsync(()=>deleteRows(db));
  return row?.count??0;
}

export async function seedSlice11LargeData(db:SQLiteDatabase):Promise<Slice11LargeDataCounts>{
  const now=new Date().toISOString();
  await db.withTransactionAsync(async()=>{
    await deleteRows(db);
    for(let n=1;n<=8;n++)await db.runAsync('INSERT INTO customers (id,customer_type,name,phone,email,address,tax_vat_number,notes,is_own_company,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,1,?,?)',`${prefix}customer_${n}`,'company',`Slice 11 Tests - Customer ${n}`,`+961 70 311 ${String(n).padStart(3,'0')}`,`customer${n}@slice11-tests.example`,'Large dataset test address',`S11-C-${n}`,'Slice 11 large dataset customer',now,now);
    for(let n=1;n<=4;n++)await db.runAsync('INSERT INTO suppliers (id,name,phone,email,address,tax_vat_number,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)',`${prefix}supplier_${n}`,`Slice 11 Tests - Supplier ${n}`,`+961 70 411 ${String(n).padStart(3,'0')}`,`supplier${n}@slice11-tests.example`,'Large dataset test quarry',`S11-S-${n}`,'Slice 11 large dataset supplier',now,now);
    await db.runAsync('INSERT INTO categories (id,name,is_active,created_at,updated_at) VALUES (?,?,1,?,?)',`${prefix}category`,'Slice 11 Tests - Dashboard Materials',now,now);
    for(let n=1;n<=6;n++)await db.runAsync('INSERT INTO catalog_items (id,category_id,name,internal_code,description,loads_enabled,quarry_enabled,daily_reports_enabled,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,1,1,1,?,?)',`${prefix}item_${n}`,`${prefix}category`,`Slice 11 Tests - Material ${n}`,`S11-M-${n}`,'Large dashboard and filter test material',now,now);
    for(let n=1;n<=12;n++)await db.runAsync('INSERT INTO driver_profiles (id,name,phone,license_number,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',`${prefix}driver_${n}`,`Slice 11 Tests - Driver ${n}`,`+961 70 511 ${String(n).padStart(3,'0')}`,`S11-DL-${n}`,'Large dataset driver',now,now);
    for(let n=1;n<=10;n++)await db.runAsync('INSERT INTO truck_profiles (id,plate,make_model,capacity_kg,owner_name,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)',`${prefix}truck_${n}`,`S11-${String(n).padStart(3,'0')}`,'Slice 11 Tests heavy truck',30000,'Slice 11 Tests Fleet','Large dataset truck',now,now);
    for(let n=1;n<=8;n++)await db.runAsync('INSERT INTO machine_profiles (id,name,machine_type,identifier,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',`${prefix}machine_${n}`,`Slice 11 Tests - Equipment ${n}`,'Heavy equipment',`S11-EQ-${n}`,'Large dataset equipment',now,now);
    for(let n=1;n<=12;n++)await db.runAsync('INSERT INTO projects (id,customer_id,name,location,status,start_date,end_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',`${prefix}project_${n}`,`${prefix}customer_${((n-1)%8)+1}`,`Slice 11 Tests - Project ${n}`,`Slice 11 test site ${n}`,n<=8?'active':'completed',new Date(Date.now()-220*86400000).toISOString().slice(0,10),n<=8?null:new Date(Date.now()-10*86400000).toISOString().slice(0,10),'Large dataset dashboard project',now,now);

    await db.execAsync(`
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<4000)
      INSERT INTO loads (id,transaction_number,confirmed_at,customer_id,customer_name,project_id,project_name,project_location,destination_address,item_id,item_name,item_code,category_name,driver_name,truck_plate,requested_quantity_kg,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,unit_price_usd_cents,subtotal_usd_cents,vat_rate_basis_points,vat_amount_usd_cents,final_total_usd_cents,payment_status,signature_status,notes,company_name,driver_profile_id,truck_profile_id)
      SELECT '${prefix}load_'||printf('%05d',n),'S11-L-'||printf('%05d',n),datetime('now','-'||((n-1)%180)||' days','-'||((n*7)%20)||' hours'),'${prefix}customer_'||((((n-1)%12)%8)+1),'Slice 11 Tests - Customer '||((((n-1)%12)%8)+1),'${prefix}project_'||(((n-1)%12)+1),'Slice 11 Tests - Project '||(((n-1)%12)+1),'Slice 11 test site '||(((n-1)%12)+1),NULL,'${prefix}item_'||(((n-1)%6)+1),'Slice 11 Tests - Material '||(((n-1)%6)+1),'S11-M-'||(((n-1)%6)+1),'Slice 11 Tests - Dashboard Materials','Slice 11 Tests - Driver '||(((n-1)%12)+1),'S11-'||printf('%03d',((n-1)%10)+1),NULL,9000,27000+(n%10)*1000,18000+(n%10)*1000,'conversion_kg_ton','Kilograms to metric tons','1000 kg = 1 t','t',(18000+(n%10)*1000)/1000.0,(18000+(n%10)*1000)/1000.0,CASE WHEN n%11=0 THEN NULL ELSE 6000 END,CASE WHEN n%11=0 THEN NULL ELSE (18000+(n%10)*1000)*6 END,CASE WHEN n%11=0 THEN NULL ELSE 1100 END,CASE WHEN n%11=0 THEN NULL ELSE ((18000+(n%10)*1000)*6*11)/100 END,CASE WHEN n%11=0 THEN NULL ELSE ((18000+(n%10)*1000)*6*111)/100 END,CASE WHEN n%11=0 THEN 'Unpriced' WHEN n%4=0 THEN 'Paid' WHEN n%3=0 THEN 'Partially Paid' ELSE 'Unpaid' END,'Unsigned','Slice 11 large dataset receipt','DROMEX','${prefix}driver_'||(((n-1)%12)+1),'${prefix}truck_'||(((n-1)%10)+1) FROM seq;

      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000)
      INSERT INTO daily_project_reports (id,project_id,work_date,work_description,workers_json,drivers_json,truck_plates_json,machines_json,materials_json,notes,weather_site_conditions,work_start_time,work_end_time,break_minutes,next_work_planned,created_at,updated_at,photos_json)
      SELECT '${prefix}report_'||printf('%04d',n),'${prefix}project_'||(((n-1)%8)+1),date('now','-'||CAST((n-1)/8 AS INTEGER)||' days'),'Slice 11 Tests daily production report','[]','[]','[]','[]','[]','Generated for dashboard reconciliation','Clear','07:00','16:00',45,'Continue scheduled work',datetime('now'),datetime('now'),'[]' FROM seq;

      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<800)
      INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,item_id,item_name,item_code,category_name,quantity_cubic_metres,driver_profile_id,driver_name,truck_profile_id,truck_plate,supplier_ticket_number,unit_price_usd_cents,subtotal_usd_cents,vat_rate_basis_points,vat_amount_usd_cents,final_total_usd_cents,payment_status,notes,photos_json,status,project_id,project_name)
      SELECT '${prefix}quarry_'||printf('%04d',n),'S11-Q-'||printf('%04d',n),datetime('now','-'||((n-1)%180)||' days'),'${prefix}supplier_'||(((n-1)%4)+1),'Slice 11 Tests - Supplier '||(((n-1)%4)+1),'${prefix}item_'||(((n-1)%6)+1),'Slice 11 Tests - Material '||(((n-1)%6)+1),'S11-M-'||(((n-1)%6)+1),'Slice 11 Tests - Dashboard Materials',20+(n%60),'${prefix}driver_'||(((n-1)%12)+1),'Slice 11 Tests - Driver '||(((n-1)%12)+1),'${prefix}truck_'||(((n-1)%10)+1),'S11-'||printf('%03d',((n-1)%10)+1),'S11-T-'||printf('%04d',n),2500,(20+(n%60))*2500,1100,((20+(n%60))*2500*11)/100,((20+(n%60))*2500*111)/100,CASE WHEN n%2=0 THEN 'Paid' ELSE 'Unpaid' END,'Slice 11 large dataset quarry purchase','[]','Active','${prefix}project_'||(((n-1)%12)+1),'Slice 11 Tests - Project '||(((n-1)%12)+1) FROM seq;

      INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,previous_balance_litres,difference_litres,payment_status,status,created_at,notes)
      VALUES ('${prefix}fuel_0000','gauge',datetime('now','-181 days'),5000,NULL,NULL,'No Payment Due','Active',datetime('now'),'Slice 11 opening fuel gauge');
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<900)
      INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,supplier_id,supplier_name,equipment_id,equipment_name,project_id,project_name,ticket_number,reason,notes,price_per_litre_usd_cents,subtotal_usd_cents,vat_rate_basis_points,vat_amount_usd_cents,final_total_usd_cents,payment_status,status,created_at)
      SELECT '${prefix}fuel_'||printf('%04d',n),CASE WHEN n%2=1 THEN 'delivery' ELSE 'fill' END,datetime('now','-'||((900-n)%180)||' days'),CASE WHEN n%2=1 THEN 600 ELSE 45 END,CASE WHEN n%2=1 THEN '${prefix}supplier_'||(((n-1)%4)+1) ELSE NULL END,CASE WHEN n%2=1 THEN 'Slice 11 Tests - Supplier '||(((n-1)%4)+1) ELSE NULL END,CASE WHEN n%2=0 THEN '${prefix}machine_'||(((n-1)%8)+1) ELSE NULL END,CASE WHEN n%2=0 THEN 'Slice 11 Tests - Equipment '||(((n-1)%8)+1) ELSE NULL END,CASE WHEN n%2=0 THEN '${prefix}project_'||(((n-1)%8)+1) ELSE NULL END,CASE WHEN n%2=0 THEN 'Slice 11 Tests - Project '||(((n-1)%8)+1) ELSE NULL END,CASE WHEN n%2=1 THEN 'S11-F-'||printf('%04d',n) ELSE NULL END,CASE WHEN n%2=0 THEN 'Production use' ELSE NULL END,'Slice 11 large dataset fuel movement',CASE WHEN n%2=1 THEN 120 ELSE NULL END,CASE WHEN n%2=1 THEN 72000 ELSE NULL END,CASE WHEN n%2=1 THEN 1100 ELSE NULL END,CASE WHEN n%2=1 THEN 7920 ELSE NULL END,CASE WHEN n%2=1 THEN 79920 ELSE NULL END,CASE WHEN n%2=1 THEN 'Partially Paid' ELSE 'No Payment Due' END,'Active',datetime('now') FROM seq;

      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<4000)
      INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at)
      SELECT '${prefix}payment_load_'||printf('%05d',n),'load','${prefix}load_'||printf('%05d',n),CASE WHEN n%4=0 THEN ((18000+(n%10)*1000)*6*111)/100 ELSE ((18000+(n%10)*1000)*6*111)/200 END,date('now','-'||((n-1)%180)||' days'),'Active',datetime('now') FROM seq WHERE n%11<>0 AND (n%4=0 OR n%3=0);

      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<800)
      INSERT INTO payment_entries (id,target_type,quarry_purchase_id,amount_usd_cents,payment_date,status,created_at)
      SELECT '${prefix}payment_quarry_'||printf('%04d',n),'quarryPurchase','${prefix}quarry_'||printf('%04d',n),((20+(n%60))*2500*111)/100,date('now','-'||((n-1)%180)||' days'),'Active',datetime('now') FROM seq WHERE n%2=0;

      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<900)
      INSERT INTO payment_entries (id,target_type,fuel_movement_id,amount_usd_cents,payment_date,status,created_at)
      SELECT '${prefix}payment_fuel_'||printf('%04d',n),'fuelDelivery','${prefix}fuel_'||printf('%04d',n),39960,date('now','-'||((900-n)%180)||' days'),'Active',datetime('now') FROM seq WHERE n%2=1;
    `);
  });
  return slice11LargeDataCounts;
}
