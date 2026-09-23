import {afterEach,describe,expect,it} from 'vitest';

import {SqliteConstructionLiftRepository} from '../src/data/repositories/SqliteConstructionLiftRepository';
import {SqliteProjectTotalsRepository} from '../src/data/repositories/SqliteProjectTotalsRepository';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';
import {buildItemLedger,emptyTotalsFilters,summarizeConstruction} from '../src/domain/projectTotals';
import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/** DEC-481. Project Totals aggregates in SQL, per source, and never adds one source to another. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

const T=SEED_TIME;
async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('other','customer','Other Project','Tyre','active','2026-08-01','${T}','${T}',0);
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Materials','${T}','${T}');
    INSERT INTO catalog_items (id,category_id,name,loads_enabled,quarry_enabled,daily_reports_enabled,created_at,updated_at) VALUES
      ('sand','cat','Sand',1,1,1,'${T}','${T}'),('asphalt','cat','Asphalt',1,1,1,'${T}','${T}'),('readymix','cat','Ready Mix',1,1,1,'${T}','${T}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup_a','Alpha Quarry',1,'${T}','${T}'),('sup_b','Beta Quarry',0,'${T}','${T}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${T}','${T}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${T}','${T}','driver');
  `);
  let n=0;
  const supplierLoad=(project:string,item:string,itemName:string,supplier:string,supplierName:string,quantity:number,unit:string,symbol:string,day:string,status='Active')=>{
    n+=1;
    db.raw.exec(`INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,project_id,project_name,item_id,item_name,category_name,unit_id,unit_name,unit_symbol,quantity_cubic_metres,delivery_method,driver_profile_id,driver_name,truck_profile_id,truck_plate,payment_status,photos_json,status)
      VALUES ('q${n}','QP-${n}','${day}T10:00:00','${supplier}','${supplierName}','${project}','P','${item}','${itemName}','Materials','${unit}','${symbol}','${symbol}',${quantity},'supplier','system_supplier_delivery_driver','Supplier Delivering','system_supplier_delivery_truck','','Unpriced','[]','${status}')`);
  };
  const companyLoad=(item:string,itemName:string,quantity:number,day:string,extra:{status?:string;archived?:number}={})=>{
    n+=1;
    db.raw.exec(`INSERT INTO loads (id,transaction_number,confirmed_at,customer_id,customer_name,project_id,project_name,item_id,item_name,category_name,driver_name,truck_plate,driver_profile_id,truck_profile_id,
      empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,payment_status,company_name,quantity_method,direct_quantity,direct_unit_id,direct_unit_name,direct_unit_symbol,status,is_archived)
      VALUES ('l${n}','TX-${n}','${day}T09:00:00','customer','Road Co','road','Mountain Road','${item}','${itemName}','Materials','Omar','B123','driver','truck',0,1,1,'conversion_kg_ton','Direct quantity','Entered directly','t',${quantity},${quantity},'Unpriced','DROMEX','direct',${quantity},'unit_ton','Metric ton','t','${extra.status??'Active'}',${extra.archived??0})`);
  };
  const report=(day:string,materials:string)=>{db.raw.exec(`INSERT INTO daily_project_reports (id,project_id,work_date,work_description,materials_json,created_at,updated_at) VALUES ('r_${day}','road','${day}','Work','${materials}','${T}','${T}')`);};
  const fill=(fuelType:string,equipment:string,litres:number,day:string,status='Active',project='road')=>{
    n+=1;
    db.raw.exec(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,equipment_name,fuel_type,project_id,destination_type,status,created_at) VALUES ('f${n}','fill','${day}T08:00:00',${litres},'${equipment}','${fuelType}','${project}','project','${status}','${T}')`);
  };
  return {db,totals:new SqliteProjectTotalsRepository(db as never),supplierLoad,companyLoad,report,fill};
}

describe('supplier and company deliveries',()=>{
  it('totals supplier deliveries per item, supplier and unit, excluding cancelled loads and other projects',async()=>{
    const {totals,supplierLoad}=await setup();
    supplierLoad('road','sand','Sand','sup_a','Alpha Quarry',20,'unit_ton','t','2026-08-10');
    supplierLoad('road','sand','Sand','sup_a','Alpha Quarry',12.5,'unit_ton','t','2026-08-11');
    supplierLoad('road','sand','Sand','sup_a','Alpha Quarry',6,'unit_m3','m³','2026-08-11');
    supplierLoad('road','sand','Sand','sup_a','Alpha Quarry',99,'unit_ton','t','2026-08-12','Cancelled');
    supplierLoad('other','sand','Sand','sup_a','Alpha Quarry',77,'unit_ton','t','2026-08-12');
    const data=await totals.getProjectTotals('road',{fromDate:'',toDate:''});
    expect(data.deliveries.filter(row=>row.source==='supplier_delivery').map(row=>[row.itemName,row.supplierName,row.unitSymbol,row.quantity,row.recordCount]).sort()).toEqual([
      ['Sand','Alpha Quarry','m³',6,1],['Sand','Alpha Quarry','t',32.5,2],
    ]);
  });

  it('keeps archived suppliers and deactivated items in historical totals',async()=>{
    const {db,totals,supplierLoad}=await setup();
    supplierLoad('road','asphalt','Asphalt','sup_b','Beta Quarry',15,'unit_ton','t','2026-08-10');
    db.raw.exec("UPDATE catalog_items SET is_active=0 WHERE id='asphalt'");
    const rows=(await totals.getProjectTotals('road',{fromDate:'',toDate:''})).deliveries;
    expect(rows).toContainEqual(expect.objectContaining({itemKey:'id:asphalt',itemName:'Asphalt',supplierKey:'id:sup_b',supplierName:'Beta Quarry',quantity:15}));
  });

  it('applies an inclusive date range on the delivery date',async()=>{
    const {totals,supplierLoad}=await setup();
    for(const day of ['2026-08-09','2026-08-10','2026-08-15','2026-08-16'])supplierLoad('road','sand','Sand','sup_a','Alpha Quarry',1,'unit_ton','t',day);
    const rows=(await totals.getProjectTotals('road',{fromDate:'2026-08-10',toDate:'2026-08-15'})).deliveries;
    expect(rows).toEqual([expect.objectContaining({quantity:2,recordCount:2})]);
  });

  it('totals company deliveries by the receipt quantity in its own unit, excluding cancelled and archived receipts',async()=>{
    const {totals,companyLoad}=await setup();
    companyLoad('sand','Sand',10,'2026-08-10');
    companyLoad('sand','Sand',5,'2026-08-10',{status:'Cancelled'});
    companyLoad('sand','Sand',7,'2026-08-10',{archived:1});
    const rows=(await totals.getProjectTotals('road',{fromDate:'',toDate:''})).deliveries.filter(row=>row.source==='company_delivery');
    expect(rows).toEqual([{source:'company_delivery',itemKey:'id:sand',itemName:'Sand',supplierKey:'company',supplierName:'Company deliveries',unitKey:'unit_ton',unitSymbol:'t',quantity:10,recordCount:1}]);
  });
});

describe('recorded usage, fuel, and construction',()=>{
  it('reads Daily Report materials as Used and Transported, and tolerates a damaged material list',async()=>{
    const {totals,report}=await setup();
    report('2026-08-10',JSON.stringify([{id:'m1',itemId:'sand',itemName:'Sand',unitId:'unit_ton',unitName:'Metric ton',unitSymbol:'t',quantity:8,movement:'used'},{id:'m2',itemId:'sand',itemName:'Sand',unitId:'unit_ton',unitName:'Metric ton',unitSymbol:'t',quantity:3,movement:'transported'}]));
    report('2026-08-11',JSON.stringify([{id:'m3',itemId:'sand',itemName:'Sand',unitId:'unit_ton',unitName:'Metric ton',unitSymbol:'t',quantity:4.5,movement:'used'}]));
    report('2026-08-12','{damaged');
    const usage=(await totals.getProjectTotals('road',{fromDate:'',toDate:''})).usage;
    expect(usage.map(row=>[row.movement,row.itemName,row.unitSymbol,row.quantity,row.recordCount]).sort()).toEqual([['transported','Sand','t',3,1],['used','Sand','t',12.5,2]]);
  });

  it('totals only active fuel fills of this project, per fuel type and equipment',async()=>{
    const {totals,fill}=await setup();
    fill('diesel','Excavator',100,'2026-08-10');fill('diesel','Excavator',20,'2026-08-11');fill('gasoline','Generator',15,'2026-08-11');
    fill('diesel','Excavator',500,'2026-08-11','Cancelled');fill('diesel','Excavator',300,'2026-08-11','Active','other');
    const fuel=(await totals.getProjectTotals('road',{fromDate:'',toDate:''})).fuel;
    expect(fuel.map(row=>[row.fuelType,row.equipmentName,row.litres,row.recordCount]).sort()).toEqual([['diesel','Excavator',120,2],['gasoline','Generator',15,1]]);
  });

  it('lists wall consumption, Lift actuals and legacy foundation records as separate sources, never estimates',async()=>{
    const {db,totals}=await setup();
    const walls=new SqliteWallRepository(db as never),lifts=new SqliteConstructionLiftRepository(db as never);
    db.raw.exec(`INSERT INTO walls (id,project_id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,net_volume_m3,planned_volume_m3,created_at,updated_at) VALUES ('wall','road','Wall W1','reinforced_concrete','retaining',10,2,.4,.3,7,7,'${T}','${T}')`);
    await walls.addConsumption({wallId:'wall',usedOn:'2026-08-10',type:'ready_mix',concretePurpose:'structural',customPurposeId:null,finishedVolumeM3:6,cementBags:null,cementBagKg:null,sandQuantity:null,sandUnit:null,gravelQuantity:null,gravelUnit:null,waterLitres:null,admixtureQuantity:null,admixtureUnit:null,stoneQuantity:null,stoneUnit:null,rebarDiameterMm:null,rebarCount:null,rebarLengthEachM:null,rebarGrade:'',notes:'',volume:null});
    const section=await walls.createConstructionSection({projectId:'road',name:'Section A',location:'Km 1',description:''});
    await walls.createFoundation({projectId:'road',constructionSectionId:section.id,reference:'F1',location:'',lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0,materialType:'stone',concretePurpose:null,customPurposeId:null,quantity:5,quantityUnit:'tonnes',manualOverride:true,consumptionDate:'2026-08-11',notes:''});
    const planned=await walls.createFoundation({projectId:'road',constructionSectionId:section.id,reference:'F2',location:'',lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0,materialType:null,concretePurpose:null,customPurposeId:null,quantity:null,quantityUnit:null,manualOverride:false,consumptionDate:null,notes:''});
    const lift=await lifts.createLift({parentType:'foundation',parentId:planned.id,sequence:1,reference:'Lift 1',startElevationM:0,geometry:{lengthM:30,heightM:.2,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},notes:''});
    await lifts.saveStonePhase(lift.id,{calculationDimensions:{lengthM:30,heightM:.2,bottomThicknessM:.375,topThicknessM:.375,deductionM3:0},actualStoneQuantityM3:2.25,manualOverride:false,workDate:'2026-08-12',position:null,offsets:null,notes:''});
    await lifts.saveConcreteMatrixPhase(lift.id,{calculationMethod:'estimated_matrix',independentDimensions:null,actualReadyMixQuantityM3:2,manualOverride:false,purpose:'Matrix',workDate:'2026-08-13',notes:''});
    const estimateOnly=await lifts.createLift({parentType:'foundation',parentId:planned.id,sequence:2,reference:'Lift 2',startElevationM:.2,geometry:{lengthM:30,heightM:.2,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},notes:''});
    await lifts.saveStonePhase(estimateOnly.id,{calculationDimensions:{lengthM:30,heightM:.2,bottomThicknessM:.375,topThicknessM:.375,deductionM3:0},actualStoneQuantityM3:null,manualOverride:false,workDate:'2026-08-14',position:null,offsets:null,notes:''});
    const construction=summarizeConstruction((await totals.getProjectTotals('road',{fromDate:'',toDate:''})).construction);
    expect(construction.map(group=>[group.materialLabel,group.unitSymbol,group.sources.map(source=>[source.source,source.quantity,source.recordCount])])).toEqual([
      ['Ready-mix concrete','m³',[['wall_consumption',6,1],['lift_ready_mix',2,1]]],
      ['Stone','m³',[['lift_stone',2.25,1]]],
      ['Stone','t',[['foundation_legacy',5,1]]],
    ]);
  });

  it('never double counts: a Lift pour and a Daily Report Ready Mix record stay in separate sections',async()=>{
    const {db,totals,report}=await setup();
    const walls=new SqliteWallRepository(db as never),lifts=new SqliteConstructionLiftRepository(db as never);
    const section=await walls.createConstructionSection({projectId:'road',name:'S',location:'',description:''});
    const foundation=await walls.createFoundation({projectId:'road',constructionSectionId:section.id,reference:'F',location:'',lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0,materialType:null,concretePurpose:null,customPurposeId:null,quantity:null,quantityUnit:null,manualOverride:false,consumptionDate:null,notes:''});
    const lift=await lifts.createLift({parentType:'foundation',parentId:foundation.id,sequence:1,reference:'Lift 1',startElevationM:0,geometry:{lengthM:30,heightM:.2,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},notes:''});
    await lifts.saveStonePhase(lift.id,{calculationDimensions:null,actualStoneQuantityM3:1,manualOverride:false,workDate:'2026-08-12',position:null,offsets:null,notes:''});
    await lifts.saveConcreteMatrixPhase(lift.id,{calculationMethod:'estimated_matrix',independentDimensions:null,actualReadyMixQuantityM3:4,manualOverride:false,purpose:'Matrix',workDate:'2026-08-12',notes:''});
    report('2026-08-12',JSON.stringify([{id:'m1',itemId:'readymix',itemName:'Ready Mix',unitId:'unit_m3',unitName:'Cubic metre',unitSymbol:'m³',quantity:4,movement:'used'}]));
    const data=await totals.getProjectTotals('road',{fromDate:'',toDate:''});
    const ledger=buildItemLedger(data,emptyTotalsFilters());
    expect(ledger.find(item=>item.itemName==='Ready Mix')!.units[0]!.used).toEqual({quantity:4,recordCount:1});
    expect(data.construction.find(row=>row.source==='lift_ready_mix')).toMatchObject({quantity:4});
    expect(JSON.stringify(ledger)).not.toContain('"quantity":8');
  });
});

describe('drill-down and scale',()=>{
  it('lists the records behind a delivered total, newest first, with their own references',async()=>{
    const {totals,supplierLoad}=await setup();
    supplierLoad('road','sand','Sand','sup_a','Alpha Quarry',20,'unit_ton','t','2026-08-10');
    supplierLoad('road','sand','Sand','sup_a','Alpha Quarry',12.5,'unit_ton','t','2026-08-11');
    supplierLoad('road','sand','Sand','sup_a','Alpha Quarry',6,'unit_m3','m³','2026-08-11');
    const records=await totals.listContributingRecords('road',{kind:'delivery',itemKey:'id:sand',unitKey:'unit_ton',supplierKey:'id:sup_a',fromDate:'',toDate:''});
    expect(records.map(record=>[record.reference,record.date,record.quantity,record.unitSymbol,record.source])).toEqual([['QP-2','2026-08-11',12.5,'t','supplier_delivery'],['QP-1','2026-08-10',20,'t','supplier_delivery']]);
  });

  it('lists the Daily Reports behind a used total',async()=>{
    const {totals,report}=await setup();
    report('2026-08-10',JSON.stringify([{id:'m1',itemId:'sand',itemName:'Sand',unitId:'unit_ton',unitName:'Metric ton',unitSymbol:'t',quantity:8,movement:'used'}]));
    const records=await totals.listContributingRecords('road',{kind:'usage',movement:'used',itemKey:'id:sand',unitKey:'unit_ton',fromDate:'',toDate:''});
    expect(records).toEqual([{id:'r_2026-08-10',reference:'Daily Report',date:'2026-08-10',party:null,quantity:8,unitSymbol:'t',source:'report_material'}]);
  });

  it('aggregates thousands of loads in the database instead of loading them into memory',async()=>{
    const {db,totals}=await setup();
    db.raw.exec('BEGIN');
    const insert=db.raw.prepare(`INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,project_id,project_name,item_id,item_name,category_name,unit_id,unit_name,unit_symbol,quantity_cubic_metres,delivery_method,driver_profile_id,driver_name,truck_profile_id,truck_plate,payment_status,photos_json,status)
      VALUES (?,?, '2026-08-10T10:00:00','sup_a','Alpha Quarry','road','P','sand','Sand','Materials','unit_ton','t','t',1.5,'supplier','system_supplier_delivery_driver','Supplier Delivering','system_supplier_delivery_truck','','Unpriced','[]','Active')`);
    for(let index=0;index<3000;index+=1)insert.run(`bulk_${index}`,`B-${index}`);
    db.raw.exec('COMMIT');
    const started=Date.now();
    const rows=(await totals.getProjectTotals('road',{fromDate:'',toDate:''})).deliveries;
    expect(rows).toEqual([expect.objectContaining({quantity:4500,recordCount:3000})]);
    expect(Date.now()-started).toBeLessThan(2000);
  });
});
