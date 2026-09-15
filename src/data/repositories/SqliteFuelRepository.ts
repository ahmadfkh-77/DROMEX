import type {SQLiteDatabase} from 'expo-sqlite';
import {applyFuelLedger,calculateFuelDelivery,calculateFuelFillCost,companySiteKey,describeFuelDestination,localDateKey,normalizeCompanySiteName,resolveFuelDestination,validateFuelPrice,validateGaugeLitres,validatePositiveLitres,type CompanySite,type FuelDestinationType,type FuelDeliveryDraft,type FuelFillDraft,type FuelGaugeDraft,type FuelMovement,type FuelOverview,type FuelPriceDraft,type FuelPriceRecord,type FuelSetup,type FuelType,type FuelCorrectionEntry,type FuelCorrectionChange,type FuelFillCorrectionDraft,type FuelDeliveryCorrectionDraft} from '../../domain/fuel';
import type {FuelRepository} from './FuelRepository';
type Row={id:string;movement_type:'gauge'|'delivery'|'fill';fuel_type:FuelType|null;correction_history_json:string|null;confirmed_at:string;litres:number;previous_balance_litres:number|null;difference_litres:number|null;supplier_id:string|null;supplier_name:string|null;equipment_type:'machine'|'truck';equipment_id:string|null;truck_profile_id:string|null;equipment_name:string|null;project_id:string|null;project_name:string|null;destination_type?:FuelDestinationType|null;company_site_id?:string|null;company_site_name?:string|null;company_site_is_active?:number|null;ticket_number:string|null;odometer_reading:string|null;reason:string|null;notes:string|null;fuel_price_history_id:string|null;price_per_litre_usd_cents:number|null;price_override_reason:string|null;consumption_cost_usd_cents:number|null;subtotal_usd_cents:number|null;vat_rate_basis_points:number|null;vat_amount_usd_cents:number|null;final_total_usd_cents:number|null;payment_status:string;status:'Active'|'Cancelled';cancellation_reason:string|null;cancelled_at:string|null};
type PriceRow={id:string;fuel_type:FuelType|null;price_per_litre_usd_cents:number;effective_at:string;changed_by:string;reason:string|null;created_at:string};
type SiteRow={id:string;name:string;name_key:string;is_active:number;created_at:string;updated_at:string};
// DEC-438. A site's name is read live through this join, so renaming a site never rewrites its fills.
const MOVEMENT_SELECT='SELECT f.*,s.name company_site_name,s.is_active company_site_is_active FROM fuel_movements f LEFT JOIN company_sites s ON s.id=f.company_site_id';
const id=(prefix='fuel')=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;const clean=(v:string)=>v.trim()||null;const cents=(value:number)=>Math.round(value*100);
function timestampForDate(input?:string):string{const value=input??localDateKey(new Date());if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>localDateKey(new Date()))throw new Error('Record date must be today or a valid past date.');const now=new Date(),[year=0,month=0,day=0]=value.split('-').map(Number),date=new Date(year,month-1,day,now.getHours(),now.getMinutes(),now.getSeconds(),now.getMilliseconds());if(localDateKey(date)!==value)throw new Error('Select a valid record date.');return date.toISOString();}
const parseCorrections=(value:string|null)=>{try{const parsed=JSON.parse(value??'[]');return Array.isArray(parsed)?parsed as FuelCorrectionEntry[]:[];}catch{return [];}};
const fromPriceRow=(r:PriceRow):FuelPriceRecord=>({id:r.id,fuelType:r.fuel_type??'diesel',pricePerLitreUsd:r.price_per_litre_usd_cents/100,effectiveAt:r.effective_at,changedBy:r.changed_by,reason:r.reason,createdAt:r.created_at});
const fromSiteRow=(r:SiteRow):CompanySite=>({id:r.id,name:r.name,isActive:r.is_active===1,createdAt:r.created_at,updatedAt:r.updated_at});
const rowDestination=(r:Row):FuelDestinationType=>r.destination_type??(r.project_id?'project':'unassigned');
const fromRow=(r:Row):Omit<FuelMovement,'balanceAfterLitres'>=>({id:r.id,type:r.movement_type,fuelType:r.fuel_type??'diesel',correctionHistory:parseCorrections(r.correction_history_json),confirmedAt:r.confirmed_at,litres:r.litres,previousBalanceLitres:r.previous_balance_litres,differenceLitres:r.difference_litres,supplierId:r.supplier_id,supplierName:r.supplier_name,equipmentType:r.equipment_type??'machine',equipmentId:(r.equipment_type??'machine')==='truck'?r.truck_profile_id:r.equipment_id,equipmentName:r.equipment_name,projectId:r.project_id,projectName:r.project_name,destinationType:r.movement_type==='fill'?rowDestination(r):null,companySiteId:r.company_site_id??null,companySiteName:r.company_site_name??null,companySiteIsActive:r.company_site_id?r.company_site_is_active===1:null,ticketNumber:r.ticket_number,odometerReading:r.odometer_reading,reason:r.reason,notes:r.notes,fuelPriceHistoryId:r.fuel_price_history_id,pricePerLitreUsd:r.price_per_litre_usd_cents==null?null:r.price_per_litre_usd_cents/100,priceOverrideReason:r.price_override_reason,consumptionCostUsd:r.consumption_cost_usd_cents==null?null:r.consumption_cost_usd_cents/100,subtotalUsd:r.subtotal_usd_cents==null?null:r.subtotal_usd_cents/100,vatRatePercent:r.vat_rate_basis_points==null?null:r.vat_rate_basis_points/100,vatAmountUsd:r.vat_amount_usd_cents==null?null:r.vat_amount_usd_cents/100,finalTotalUsd:r.final_total_usd_cents==null?null:r.final_total_usd_cents/100,paymentStatus:r.payment_status,status:r.status,cancellationReason:r.cancellation_reason,cancelledAt:r.cancelled_at});
export class SqliteFuelRepository implements FuelRepository{constructor(private readonly db:SQLiteDatabase){}
async getSetup():Promise<FuelSetup>{const[suppliers,machineRows,truckRows,projects,tax,prices,siteRows]=await Promise.all([this.db.getAllAsync<{id:string;name:string;phone:string|null}>('SELECT id,name,phone FROM suppliers WHERE is_active=1 ORDER BY name COLLATE NOCASE'),this.db.getAllAsync<{id:string;name:string;machine_type:string|null;identifier:string|null}>('SELECT id,name,machine_type,identifier FROM machine_profiles WHERE is_active=1 ORDER BY name COLLATE NOCASE'),this.db.getAllAsync<{id:string;plate:string;make_model:string|null;owner_name:string|null}>('SELECT id,plate,make_model,owner_name FROM truck_profiles WHERE is_active=1 ORDER BY plate COLLATE NOCASE'),this.db.getAllAsync<{id:string;name:string;location:string;start_date:string;end_date:string|null}>("SELECT id,name,location,start_date,end_date FROM projects WHERE status='active' AND is_archived=0 ORDER BY name COLLATE NOCASE"),this.db.getFirstAsync<{rate:number}>("SELECT vat_rate_basis_points rate FROM tax_settings WHERE id='tax'"),this.db.getAllAsync<PriceRow>('SELECT * FROM fuel_price_history ORDER BY effective_at DESC,created_at DESC'),this.db.getAllAsync<SiteRow>('SELECT * FROM company_sites ORDER BY is_active DESC,name_key,id')]);const history=prices.map(fromPriceRow),dieselHistory=history.filter(v=>v.fuelType==='diesel'),gasolineHistory=history.filter(v=>v.fuelType==='gasoline'),machines=machineRows.map(v=>({id:v.id,name:v.name,detail:[v.machine_type,v.identifier].filter(Boolean).join(' · ')||undefined})),trucks=truckRows.map(v=>({id:v.id,name:v.plate,detail:[v.make_model,v.owner_name].filter(Boolean).join(' · ')||undefined}));return{suppliers:suppliers.map(v=>({id:v.id,name:v.name,detail:v.phone??undefined})),machines,trucks,equipment:[...machines,...trucks],projects:projects.map(v=>({id:v.id,name:v.name,detail:v.location,startDate:v.start_date,endDate:v.end_date})),companySites:siteRows.map(fromSiteRow),vatRatePercent:(tax?.rate??0)/100,currentFuelPrice:dieselHistory[0]??null,fuelPriceHistory:dieselHistory,fuelPrices:{diesel:{current:dieselHistory[0]??null,history:dieselHistory},gasoline:{current:gasolineHistory[0]??null,history:gasolineHistory}}};}
async getOverview():Promise<FuelOverview>{const rows=await this.db.getAllAsync<Row>(`${MOVEMENT_SELECT} ORDER BY f.confirmed_at ASC,f.created_at ASC,f.id ASC`);const applied=applyFuelLedger(rows.map(fromRow));const latestGauge=[...applied].reverse().find(v=>v.type==='gauge'&&v.status==='Active')??null;return{currentBalanceLitres:applied.at(-1)?.balanceAfterLitres??0,hasKnownBalance:latestGauge!=null,latestGauge,movements:[...applied].reverse()};}
async setCurrentPrice(draft:FuelPriceDraft):Promise<FuelPriceRecord>{const price=validateFuelPrice(draft.pricePerLitreUsd,true)!;const record=await this.insertPrice(price,clean(draft.reason),new Date().toISOString(),draft.fuelType??'diesel');await this.enqueue('fuelPrice',record.id,record);return record;}
async recordDelivery(draft:FuelDeliveryDraft){const setup=await this.getSetup(),litres=validatePositiveLitres(draft.litres),supplier=setup.suppliers.find(v=>v.id===draft.supplierId)??null,values=calculateFuelDelivery(litres,draft.pricePerLitreUsd,setup.vatRatePercent);if(values.finalTotalUsd!=null&&!supplier)throw new Error('Select a supplier for a priced fuel purchase.');if(draft.supplierId&&!supplier)throw new Error('Select a valid supplier or clear the supplier field.');const movementId=id(),createdAt=new Date().toISOString(),confirmedAt=timestampForDate(draft.recordDate),status=values.finalTotalUsd==null?'Unpriced':values.finalTotalUsd===0?'No Payment Due':'Unpaid';let priceRecord=values.pricePerLitreUsd!=null&&setup.currentFuelPrice&&cents(setup.currentFuelPrice.pricePerLitreUsd)===cents(values.pricePerLitreUsd)?setup.currentFuelPrice:null;await this.db.withTransactionAsync(async()=>{if(values.pricePerLitreUsd!=null&&draft.updateCurrentPrice&&!priceRecord)priceRecord=await this.insertPrice(values.pricePerLitreUsd,'Updated from confirmed fuel purchase.',createdAt);await this.db.runAsync(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,supplier_id,supplier_name,ticket_number,notes,fuel_price_history_id,price_per_litre_usd_cents,subtotal_usd_cents,vat_rate_basis_points,vat_amount_usd_cents,final_total_usd_cents,payment_status,created_at) VALUES (?,'delivery',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,movementId,confirmedAt,litres,supplier?.id??null,supplier?.name??null,clean(draft.ticketNumber),clean(draft.notes),priceRecord?.id??null,values.pricePerLitreUsd==null?null:cents(values.pricePerLitreUsd),values.subtotalUsd==null?null:cents(values.subtotalUsd),values.finalTotalUsd==null?null:Math.round(setup.vatRatePercent*100),values.vatAmountUsd==null?null:cents(values.vatAmountUsd),values.finalTotalUsd==null?null:cents(values.finalTotalUsd),status,createdAt);if(priceRecord&&priceRecord.id!==setup.currentFuelPrice?.id)await this.enqueue('fuelPrice',priceRecord.id,priceRecord);await this.enqueue('fuelMovement',movementId,{type:'delivery',...draft,litres,...values,fuelPriceHistoryId:priceRecord?.id??null,confirmedAt,enteredAt:createdAt});});return (await this.getOverview()).movements.find(v=>v.id===movementId)!;}
async recordFill(draft:FuelFillDraft){
  const setup=await this.getSetup(),litres=validatePositiveLitres(draft.litres),choices=draft.equipmentType==='truck'?setup.trucks:setup.machines,equipment=choices.find(v=>v.id===draft.equipmentId);
  if(!equipment)throw new Error(`Select a valid ${draft.equipmentType}.`);
  const destination=resolveFuelDestination(draft);
  const project=destination.projectId?setup.projects.find(v=>v.id===destination.projectId)??null:null;
  if(destination.projectId&&!project)throw new Error('Select a valid project. Only active projects can receive fuel.');
  if(project&&(draft.recordDate<(project.startDate??'')||(project.endDate&&draft.recordDate>project.endDate)))throw new Error('The record date must be within the selected project dates.');
  const site=destination.companySiteId?setup.companySites.find(v=>v.id===destination.companySiteId&&v.isActive)??null:null;
  if(destination.companySiteId&&!site)throw new Error('Select an active company site for this fuel destination.');
  const values=calculateFuelFillCost(litres,draft.pricePerLitreUsd),current=setup.currentFuelPrice,isOverride=values.pricePerLitreUsd!=null&&current!=null&&cents(values.pricePerLitreUsd)!==cents(current.pricePerLitreUsd);
  if(isOverride&&!draft.priceOverrideReason.trim())throw new Error('Enter a reason for overriding the current fuel price.');
  const movementId=id(),createdAt=new Date().toISOString(),confirmedAt=timestampForDate(draft.recordDate),machineId=draft.equipmentType==='machine'?equipment.id:null,truckId=draft.equipmentType==='truck'?equipment.id:null;
  await this.db.withTransactionAsync(async()=>{
    await this.db.runAsync(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,equipment_type,equipment_id,truck_profile_id,equipment_name,destination_type,project_id,project_name,company_site_id,odometer_reading,notes,fuel_price_history_id,price_per_litre_usd_cents,consumption_cost_usd_cents,price_override_reason,created_at,fuel_type) VALUES (?,'fill',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,movementId,confirmedAt,litres,draft.equipmentType,machineId,truckId,equipment.name,destination.destinationType,project?.id??null,project?.name??null,site?.id??null,clean(draft.odometerReading),clean(draft.notes),values.pricePerLitreUsd!=null&&!isOverride?current?.id??null:null,values.pricePerLitreUsd==null?null:cents(values.pricePerLitreUsd),values.consumptionCostUsd==null?null:cents(values.consumptionCostUsd),isOverride?draft.priceOverrideReason.trim():null,createdAt,draft.fuelType??'diesel');
    await this.enqueue('fuelMovement',movementId,{type:'fill',...draft,...destination,litres,equipmentName:equipment.name,projectName:project?.name??null,...values,fuelPriceHistoryId:values.pricePerLitreUsd!=null&&!isOverride?current?.id??null:null,confirmedAt,enteredAt:createdAt});
  });
  return (await this.getOverview()).movements.find(v=>v.id===movementId)!;
}
async recordGauge(draft:FuelGaugeDraft){const litres=validateGaugeLitres(draft.actualLitres);if(!draft.reason.trim())throw new Error('Gauge correction reason is required.');const overview=await this.getOverview(),previous=overview.hasKnownBalance?overview.currentBalanceLitres:null,movementId=id(),createdAt=new Date().toISOString(),confirmedAt=timestampForDate(draft.recordDate);await this.db.withTransactionAsync(async()=>{await this.db.runAsync(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,previous_balance_litres,difference_litres,reason,notes,created_at) VALUES (?,'gauge',?,?,?,?,?,?,?)`,movementId,confirmedAt,litres,previous,previous==null?null:litres-previous,draft.reason.trim(),clean(draft.notes),createdAt);await this.enqueue('fuelMovement',movementId,{type:'gauge',...draft,actualLitres:litres,previousBalanceLitres:previous,differenceLitres:previous==null?null:litres-previous,reason:draft.reason.trim(),notes:clean(draft.notes),confirmedAt,enteredAt:createdAt});});return (await this.getOverview()).movements.find(v=>v.id===movementId)!;}
async cancelMovement(movementId:string,reason:string){const value=reason.trim();if(!value)throw new Error('Cancellation reason is required.');const row=await this.db.getFirstAsync<{status:string}>('SELECT status FROM fuel_movements WHERE id=?',movementId);if(!row)throw new Error('Fuel movement was not found.');if(row.status==='Cancelled')throw new Error('This movement is already cancelled.');const linked=await this.db.getFirstAsync<{count:number}>("SELECT COUNT(*) count FROM payment_entries WHERE fuel_movement_id=? AND status='Active'",movementId);if((linked?.count??0)>0)throw new Error('Cancel active supplier payments before cancelling this fuel purchase.');const now=new Date().toISOString();await this.db.withTransactionAsync(async()=>{await this.db.runAsync("UPDATE fuel_movements SET status='Cancelled',cancellation_reason=?,cancelled_at=? WHERE id=?",value,now,movementId);await this.enqueue('fuelMovement',movementId,{id:movementId,status:'Cancelled',cancellationReason:value,cancelledAt:now});});}

// DEC-438. name_key is computed only here, so no caller can bypass duplicate protection. The partial
// UNIQUE index on active keys is the database backstop; these checks give the readable message.
async createCompanySite(name:string):Promise<CompanySite>{
  const display=this.requireSiteName(name),key=companySiteKey(display);
  await this.assertNoActiveSiteNamed(key,null);
  const now=new Date().toISOString(),site:CompanySite={id:id('company_site'),name:display,isActive:true,createdAt:now,updatedAt:now};
  await this.db.withTransactionAsync(async()=>{
    await this.db.runAsync('INSERT INTO company_sites (id,name,name_key,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)',site.id,site.name,key,now,now);
    await this.enqueue('companySite',site.id,site);
  });
  return site;
}
async renameCompanySite(siteId:string,name:string):Promise<CompanySite>{
  const row=await this.loadSite(siteId),display=this.requireSiteName(name),key=companySiteKey(display);
  if(row.is_active===1)await this.assertNoActiveSiteNamed(key,siteId);
  const now=new Date().toISOString();
  await this.db.withTransactionAsync(async()=>{
    await this.db.runAsync('UPDATE company_sites SET name=?,name_key=?,updated_at=? WHERE id=?',display,key,now,siteId);
    await this.enqueue('companySite',siteId,{id:siteId,name:display,updatedAt:now});
  });
  return fromSiteRow(await this.loadSite(siteId));
}
async setCompanySiteActive(siteId:string,isActive:boolean):Promise<CompanySite>{
  const row=await this.loadSite(siteId);
  if(isActive&&row.is_active!==1)await this.assertNoActiveSiteNamed(row.name_key,siteId);
  const now=new Date().toISOString();
  await this.db.withTransactionAsync(async()=>{
    await this.db.runAsync('UPDATE company_sites SET is_active=?,updated_at=? WHERE id=?',isActive?1:0,now,siteId);
    await this.enqueue('companySite',siteId,{id:siteId,isActive,updatedAt:now});
  });
  return fromSiteRow(await this.loadSite(siteId));
}
private requireSiteName(name:string):string{const display=normalizeCompanySiteName(name);if(!display)throw new Error('Company site name is required.');return display;}
private async loadSite(siteId:string):Promise<SiteRow>{const row=await this.db.getFirstAsync<SiteRow>('SELECT * FROM company_sites WHERE id=?',siteId);if(!row)throw new Error('Company site was not found.');return row;}
private async assertNoActiveSiteNamed(key:string,exceptId:string|null){const existing=await this.db.getFirstAsync<{name:string}>('SELECT name FROM company_sites WHERE name_key=? AND is_active=1 AND id<>?',key,exceptId??'');if(existing)throw new Error(`An active company site named "${existing.name}" already exists.`);}

private async insertPrice(price:number,reason:string|null,effectiveAt:string,fuelType:FuelType='diesel'):Promise<FuelPriceRecord>{const record:FuelPriceRecord={id:id('fuel_price'),fuelType,pricePerLitreUsd:price,effectiveAt,changedBy:'Owner',reason,createdAt:new Date().toISOString()};await this.db.runAsync('INSERT INTO fuel_price_history (id,price_per_litre_usd_cents,effective_at,changed_by,reason,created_at,fuel_type) VALUES (?,?,?,?,?,?,?)',record.id,cents(price),record.effectiveAt,record.changedBy,record.reason,record.createdAt,record.fuelType);return record;}
// DEC-393. Fills and deliveries are corrected in place with a mandatory reason and a field-level
// before/after audit; gauge readings stay cancel-only and cancelled movements are never revived.
private async loadCorrectable(movementId:string,expected:'fill'|'delivery'):Promise<Row>{
  const row=await this.db.getFirstAsync<Row>(`${MOVEMENT_SELECT} WHERE f.id=?`,movementId);
  if(!row)throw new Error('The fuel movement was not found.');
  if(row.movement_type==='gauge')throw new Error('A gauge reading cannot be corrected. Cancel it and record a new reading.');
  if(row.movement_type!==expected)throw new Error(`This movement is not a fuel ${expected}.`);
  if(row.status!=='Active')throw new Error('A cancelled fuel movement cannot be corrected.');
  return row;
}
private appendCorrection(row:Row,reason:string,changes:FuelCorrectionChange[]):string{
  if(!reason.trim())throw new Error('A correction reason is required.');
  const entry:FuelCorrectionEntry={correctedAt:new Date().toISOString(),correctedBy:'Owner',reason:reason.trim(),changes};
  return JSON.stringify([...parseCorrections(row.correction_history_json),entry]);
}
private async activePaymentCents(movementId:string):Promise<number>{
  const row=await this.db.getFirstAsync<{paid:number}>("SELECT COALESCE(SUM(amount_usd_cents),0) paid FROM payment_entries WHERE fuel_movement_id=? AND status='Active'",movementId);
  return row?.paid??0;
}
private changeRecorder(changes:FuelCorrectionChange[]){return (field:string,before:string|null,after:string|null)=>{if((before??null)!==(after??null))changes.push({field,originalValue:before??null,newValue:after??null});};}

async correctFill(movementId:string,draft:FuelFillCorrectionDraft):Promise<FuelMovement>{
  const row=await this.loadCorrectable(movementId,'fill');
  const setup=await this.getSetup(),litres=validatePositiveLitres(draft.litres),fuelType=draft.fuelType??'diesel';
  const pool=draft.equipmentType==='truck'?setup.trucks:setup.machines;
  const equipment=pool.find(v=>v.id===draft.equipmentId);
  if(!equipment)throw new Error('Select the saved equipment that was filled.');
  const destination=resolveFuelDestination(draft);
  const project=destination.projectId?setup.projects.find(v=>v.id===destination.projectId)??null:null;
  if(destination.projectId&&!project)throw new Error('Select a valid project. Only active projects can receive fuel.');
  // A fill may stay on the site it already has after that site is deactivated (as DEC-417 keeps an
  // assigned inactive agency); moving a fill onto a site requires the site to be active.
  const site=destination.companySiteId?setup.companySites.find(v=>v.id===destination.companySiteId)??null:null;
  if(destination.companySiteId&&(!site||(!site.isActive&&site.id!==row.company_site_id)))throw new Error('Select an active company site for this fuel destination.');
  const values=calculateFuelFillCost(litres,draft.pricePerLitreUsd),confirmedAt=timestampForDate(draft.recordDate);
  const changes:FuelCorrectionChange[]=[],note=this.changeRecorder(changes);
  note('Fuel type',row.fuel_type??'diesel',fuelType);
  note('Litres',String(row.litres),String(litres));
  note('Equipment',row.equipment_name,equipment.name);
  note('Fuel destination',describeFuelDestination({destinationType:rowDestination(row),projectName:row.project_name,companySiteName:row.company_site_name??null}),describeFuelDestination({destinationType:destination.destinationType,projectName:project?.name??null,companySiteName:site?.name??null}));
  note('Date',localDateKey(row.confirmed_at),draft.recordDate);
  note('Price per litre',row.price_per_litre_usd_cents==null?null:String(row.price_per_litre_usd_cents/100),values.pricePerLitreUsd==null?null:String(values.pricePerLitreUsd));
  note('Cost',row.consumption_cost_usd_cents==null?null:String(row.consumption_cost_usd_cents/100),values.consumptionCostUsd==null?null:String(values.consumptionCostUsd));
  note('Odometer',row.odometer_reading,clean(draft.odometerReading));
  note('Notes',row.notes,clean(draft.notes));
  const history=this.appendCorrection(row,draft.correctionReason,changes);
  const machineId=draft.equipmentType==='truck'?null:equipment.id,truckId=draft.equipmentType==='truck'?equipment.id:null;
  await this.db.withTransactionAsync(async()=>{
    await this.db.runAsync('UPDATE fuel_movements SET confirmed_at=?,litres=?,fuel_type=?,equipment_type=?,equipment_id=?,truck_profile_id=?,equipment_name=?,destination_type=?,project_id=?,project_name=?,company_site_id=?,odometer_reading=?,notes=?,price_per_litre_usd_cents=?,consumption_cost_usd_cents=?,correction_history_json=? WHERE id=?',
      confirmedAt,litres,fuelType,draft.equipmentType,machineId,truckId,equipment.name,destination.destinationType,project?.id??null,project?.name??null,site?.id??null,clean(draft.odometerReading),clean(draft.notes),
      values.pricePerLitreUsd==null?null:cents(values.pricePerLitreUsd),values.consumptionCostUsd==null?null:cents(values.consumptionCostUsd),history,movementId);
    await this.enqueue('fuelMovement',movementId,{id:movementId,corrected:true});
  });
  return (await this.getOverview()).movements.find(v=>v.id===movementId)!;
}

async correctDelivery(movementId:string,draft:FuelDeliveryCorrectionDraft):Promise<FuelMovement>{
  const row=await this.loadCorrectable(movementId,'delivery');
  const setup=await this.getSetup(),litres=validatePositiveLitres(draft.litres);
  const supplier=draft.supplierId?setup.suppliers.find(v=>v.id===draft.supplierId)??null:null;
  if(draft.supplierId&&!supplier)throw new Error('Select a valid supplier or clear the supplier field.');
  const values=calculateFuelDelivery(litres,draft.pricePerLitreUsd,setup.vatRatePercent);
  if(values.finalTotalUsd!=null&&!supplier)throw new Error('Select a supplier for a priced fuel purchase.');
  const paidCents=await this.activePaymentCents(movementId);
  if(values.finalTotalUsd==null&&paidCents>0)throw new Error('This delivery has active payments and cannot be corrected to Unpriced. Cancel its payments first.');
  const confirmedAt=timestampForDate(draft.recordDate);
  const changes:FuelCorrectionChange[]=[],note=this.changeRecorder(changes);
  note('Litres',String(row.litres),String(litres));
  note('Supplier',row.supplier_name,supplier?.name??null);
  note('Date',localDateKey(row.confirmed_at),draft.recordDate);
  note('Price per litre',row.price_per_litre_usd_cents==null?null:String(row.price_per_litre_usd_cents/100),values.pricePerLitreUsd==null?null:String(values.pricePerLitreUsd));
  note('Total',row.final_total_usd_cents==null?null:String(row.final_total_usd_cents/100),values.finalTotalUsd==null?null:String(values.finalTotalUsd));
  note('Ticket',row.ticket_number,clean(draft.ticketNumber));
  note('Notes',row.notes,clean(draft.notes));
  const history=this.appendCorrection(row,draft.correctionReason,changes);
  const totalCents=values.finalTotalUsd==null?null:cents(values.finalTotalUsd);
  // Reducing a total below what has already been paid is allowed and reads as Overpaid (DEC-075).
  const status=totalCents==null?'Unpriced':totalCents===0?'No Payment Due':paidCents>totalCents?'Overpaid':paidCents===0?'Unpaid':paidCents<totalCents?'Partially Paid':'Paid';
  await this.db.withTransactionAsync(async()=>{
    await this.db.runAsync('UPDATE fuel_movements SET confirmed_at=?,litres=?,supplier_id=?,supplier_name=?,ticket_number=?,notes=?,price_per_litre_usd_cents=?,subtotal_usd_cents=?,vat_rate_basis_points=?,vat_amount_usd_cents=?,final_total_usd_cents=?,payment_status=?,correction_history_json=? WHERE id=?',
      confirmedAt,litres,supplier?.id??null,supplier?.name??null,clean(draft.ticketNumber),clean(draft.notes),
      values.pricePerLitreUsd==null?null:cents(values.pricePerLitreUsd),values.subtotalUsd==null?null:cents(values.subtotalUsd),
      values.finalTotalUsd==null?null:Math.round(setup.vatRatePercent*100),values.vatAmountUsd==null?null:cents(values.vatAmountUsd),totalCents,status,history,movementId);
    await this.enqueue('fuelMovement',movementId,{id:movementId,corrected:true});
  });
  return (await this.getOverview()).movements.find(v=>v.id===movementId)!;
}

private async enqueue(entityType:'fuelMovement'|'fuelPrice'|'companySite',entityId:string,payload:unknown){await this.db.runAsync('INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,\'upsert\',?,?)',entityType,entityId,JSON.stringify(payload),new Date().toISOString());}}
