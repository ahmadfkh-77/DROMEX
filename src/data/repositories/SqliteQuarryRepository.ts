import type { SQLiteDatabase } from 'expo-sqlite';
import type { DriverProfile, Project, TruckProfile } from '../../domain/loads';
import {
  calculateQuarryPurchase,
  type QuarryCorrectionDraft,
  type QuarryPurchase,
  type QuarryPurchaseDraft,
  type QuarrySetup,
  type Supplier,
  type SupplierCorrectionEntry,
  type SupplierDraft,
  validateQuarryPurchase,
} from '../../domain/quarry';
import {paymentStatus} from '../../domain/financials';
import type { QuarryRepository } from './QuarryRepository';

type PurchaseRow = {
  id:string;purchase_number:string;confirmed_at:string;supplier_id:string;supplier_name:string;
  project_id:string|null;project_name:string|null;item_id:string;item_name:string;item_code:string|null;
  category_name:string;unit_id:string|null;unit_name:string|null;unit_symbol:string|null;quantity_cubic_metres:number;
  delivery_method:'company'|'supplier';driver_profile_id:string;driver_name:string;truck_profile_id:string;
  truck_plate:string;supplier_ticket_number:string|null;price_basis:'per_unit'|'whole'|null;
  unit_price_usd_cents:number|null;subtotal_usd_cents:number|null;vat_mode:'company'|'none'|'custom'|null;
  vat_inclusive:number|null;vat_rate_basis_points:number|null;vat_amount_usd_cents:number|null;
  final_total_usd_cents:number|null;payment_status:QuarryPurchase['paymentStatus'];notes:string|null;
  photos_json:string;status:'Active'|'Cancelled';cancellation_reason:string|null;cancelled_at:string|null;
  correction_history_json:string|null;updated_at:string|null;
};
const SUPPLIER_DRIVER_ID='system_supplier_delivery_driver';
const SUPPLIER_TRUCK_ID='system_supplier_delivery_truck';
function makeId(prefix:string){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;}
function clean(value:string){const next=value.trim().replace(/\s+/g,' ');return next||null;}
function dateKey(value:string){const date=new Date(value);return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function cents(value:number|null){return value===null?null:Math.round(value*100);}
function safeHistory(value:string|null):SupplierCorrectionEntry[]{try{return JSON.parse(value||'[]') as SupplierCorrectionEntry[];}catch{return[];}}
function fromRow(row:PurchaseRow):QuarryPurchase{
  return{id:row.id,purchaseNumber:row.purchase_number,confirmedAt:row.confirmed_at,supplierId:row.supplier_id,
    supplierName:row.supplier_name,projectId:row.project_id,projectName:row.project_name,itemId:row.item_id,
    itemName:row.item_name,itemCode:row.item_code,categoryName:row.category_name,unitId:row.unit_id??'unit_m3',
    unitName:row.unit_name??'Cubic metre',unitSymbol:row.unit_symbol??'m³',quantityCubicMetres:row.quantity_cubic_metres,
    deliveryMethod:row.delivery_method??'company',driverId:row.driver_profile_id,driverName:row.driver_name,
    truckId:row.truck_profile_id,truckPlate:row.truck_plate,supplierTicketNumber:row.supplier_ticket_number,
    priceBasis:row.price_basis??'per_unit',unitPriceUsd:row.unit_price_usd_cents==null?null:row.unit_price_usd_cents/100,
    subtotalUsd:row.subtotal_usd_cents==null?null:row.subtotal_usd_cents/100,vatMode:row.vat_mode??'company',
    vatInclusive:row.vat_inclusive===1,vatRatePercent:row.vat_rate_basis_points==null?null:row.vat_rate_basis_points/100,
    vatAmountUsd:row.vat_amount_usd_cents==null?null:row.vat_amount_usd_cents/100,
    finalTotalUsd:row.final_total_usd_cents==null?null:row.final_total_usd_cents/100,paymentStatus:row.payment_status,
    notes:row.notes,photos:JSON.parse(row.photos_json||'[]') as string[],status:row.status,
    cancellationReason:row.cancellation_reason,cancelledAt:row.cancelled_at,
    correctionHistory:safeHistory(row.correction_history_json),updatedAt:row.updated_at??row.confirmed_at};
}

export class SqliteQuarryRepository implements QuarryRepository {
  constructor(private readonly db:SQLiteDatabase){}

  async getSetup():Promise<QuarrySetup>{
    const [suppliers,projects,items,units,drivers,trucks,tax]=await Promise.all([
      this.db.getAllAsync<{id:string;name:string;phone:string|null;email:string|null;address:string|null;tax_vat_number:string|null;notes:string|null;is_active:number}>('SELECT * FROM suppliers WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;customer_id:string;customer_name:string;name:string;location:string;status:'active'|'completed';notes:string|null}>("SELECT p.*,c.name customer_name FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.status='active' AND p.is_archived=0 ORDER BY p.name COLLATE NOCASE"),
      this.db.getAllAsync<{id:string;name:string;internal_code:string|null;category_name:string;default_unit_id:string|null}>('SELECT i.id,i.name,i.internal_code,i.default_unit_id,c.name category_name FROM catalog_items i JOIN categories c ON c.id=i.category_id WHERE i.is_active=1 AND i.quarry_enabled=1 ORDER BY c.name COLLATE NOCASE,i.name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;name:string;symbol:string}>('SELECT id,name,symbol FROM measurement_units WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;name:string;phone:string|null;license_number:string|null;notes:string|null;is_active:number}>('SELECT * FROM driver_profiles WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;plate:string;make_model:string|null;capacity_kg:number|null;owner_name:string|null;notes:string|null;is_active:number}>('SELECT * FROM truck_profiles WHERE is_active=1 ORDER BY plate COLLATE NOCASE'),
      this.db.getFirstAsync<{vat_rate_basis_points:number}>("SELECT vat_rate_basis_points FROM tax_settings WHERE id='tax'"),
    ]);
    return{suppliers:suppliers.map(r=>({id:r.id,name:r.name,phone:r.phone,email:r.email,address:r.address,taxVatNumber:r.tax_vat_number,notes:r.notes,isActive:r.is_active===1})),
      projects:projects.map((r):Project=>({id:r.id,customerId:r.customer_id,customerName:r.customer_name,name:r.name,location:r.location,status:r.status,notes:r.notes})),
      items:items.map(r=>({id:r.id,name:r.name,internalCode:r.internal_code,categoryName:r.category_name,defaultUnitId:r.default_unit_id})),
      units,drivers:drivers.map((r):DriverProfile=>({id:r.id,name:r.name,phone:r.phone,licenseNumber:r.license_number,notes:r.notes,isActive:r.is_active===1})),
      trucks:trucks.map((r):TruckProfile=>({id:r.id,plate:r.plate,makeModel:r.make_model,capacityKg:r.capacity_kg,ownerName:r.owner_name,notes:r.notes,isActive:r.is_active===1})),
      vatRatePercent:(tax?.vat_rate_basis_points??0)/100};
  }

  async createSupplier(draft:SupplierDraft):Promise<Supplier>{
    const name=draft.name.trim().replace(/\s+/g,' ');if(!name)throw new Error('Supplier name is required.');
    const id=makeId('supplier'),now=new Date().toISOString();
    const supplier:Supplier={id,name,phone:clean(draft.phone??''),email:clean(draft.email??''),address:clean(draft.address??''),taxVatNumber:clean(draft.taxVatNumber??''),notes:clean(draft.notes??''),isActive:true};
    await this.db.withTransactionAsync(async()=>{await this.db.runAsync('INSERT INTO suppliers (id,name,phone,email,address,tax_vat_number,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',id,name,supplier.phone,supplier.email,supplier.address,supplier.taxVatNumber,supplier.notes,now,now);await this.enqueue('supplier',id,supplier);});
    return supplier;
  }

  async confirmPurchase(draft:QuarryPurchaseDraft):Promise<QuarryPurchase>{
    const setup=await this.getSetup(),issues=validateQuarryPurchase(draft,setup);if(issues.length)throw new Error(issues.join('\n'));
    const supplier=setup.suppliers.find(v=>v.id===draft.supplierId)!;
    const project=setup.projects.find(v=>v.id===draft.projectId)??null;
    const item=setup.items.find(v=>v.id===draft.itemId)!;
    const unit=setup.units.find(v=>v.id===draft.unitId)!;
    const company=draft.deliveryMethod==='company',driver=company?setup.drivers.find(v=>v.id===draft.driverId)!:null,truck=company?setup.trucks.find(v=>v.id===draft.truckId)!:null;
    const driverId=driver?.id??SUPPLIER_DRIVER_ID,driverName=driver?.name??'Supplier Delivering';
    const truckId=truck?.id??SUPPLIER_TRUCK_ID,truckPlate=truck?.plate??(clean(draft.supplierTruckPlate)??'');
    const calculation=calculateQuarryPurchase(draft,setup.vatRatePercent),price=draft.unitPriceUsd.trim()?Number(draft.unitPriceUsd.replace(',','.')):null;
    const confirmedAt=new Date().toISOString(),id=makeId('supplier_load');let purchaseNumber='';
    await this.db.withTransactionAsync(async()=>{
      purchaseNumber=await this.nextPurchaseNumber(confirmedAt);
      const status:QuarryPurchase['paymentStatus']=price==null?'Unpriced':calculation.finalTotalUsd===0?'No Payment Due':'Unpaid';
      await this.db.runAsync(
        'INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,project_id,project_name,item_id,item_name,item_code,category_name,unit_id,unit_name,unit_symbol,quantity_cubic_metres,delivery_method,driver_profile_id,driver_name,truck_profile_id,truck_plate,supplier_ticket_number,price_basis,unit_price_usd_cents,subtotal_usd_cents,vat_mode,vat_inclusive,vat_rate_basis_points,vat_amount_usd_cents,final_total_usd_cents,payment_status,notes,photos_json,correction_history_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id,purchaseNumber,confirmedAt,supplier.id,supplier.name,project?.id??null,project?.name??null,item.id,item.name,item.internalCode,item.categoryName,
        unit.id,unit.name,unit.symbol,Number(draft.quantityCubicMetres),draft.deliveryMethod,driverId,driverName,truckId,truckPlate,
        clean(draft.supplierTicketNumber),draft.priceBasis,price==null?null:Math.round(price*100),cents(calculation.subtotalUsd),draft.vatMode,
        draft.vatInclusive?1:0,calculation.vatRatePercent==null?null:Math.round(calculation.vatRatePercent*100),cents(calculation.vatAmountUsd),
        cents(calculation.finalTotalUsd),status,clean(draft.notes),JSON.stringify(draft.photos),'[]',confirmedAt);
      await this.enqueue('quarryPurchase',id,{id,purchaseNumber,confirmedAt,projectId:project?.id??null,deliveryMethod:draft.deliveryMethod});
    });
    return this.get(id);
  }

  async incrementPurchase(sourcePurchaseId:string,quantityCubicMetres:number):Promise<QuarryPurchase>{
    if(!Number.isFinite(quantityCubicMetres)||quantityCubicMetres<=0)throw new Error('Trip quantity must be greater than zero.');
    const source=await this.get(sourcePurchaseId);if(source.status!=='Active')throw new Error('A cancelled supplier load cannot be incremented.');
    const confirmedAt=new Date().toISOString();if(dateKey(source.confirmedAt)!==dateKey(confirmedAt))throw new Error('This counter belongs to an earlier day. Create the first supplier load for today.');
    const price=source.unitPriceUsd,calculation=calculateQuarryPurchase({
      ...this.draftFromPurchase(source),quantityCubicMetres:String(quantityCubicMetres),vatMode:'custom',
      customVatRatePercent:String(source.vatRatePercent??0),
    },source.vatRatePercent??0);
    const id=makeId('supplier_load');let purchaseNumber='';
    await this.db.withTransactionAsync(async()=>{
      purchaseNumber=await this.nextPurchaseNumber(confirmedAt);
      const status:QuarryPurchase['paymentStatus']=price===null?'Unpriced':calculation.finalTotalUsd===0?'No Payment Due':'Unpaid';
      await this.db.runAsync(
        'INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,project_id,project_name,item_id,item_name,item_code,category_name,unit_id,unit_name,unit_symbol,quantity_cubic_metres,delivery_method,driver_profile_id,driver_name,truck_profile_id,truck_plate,supplier_ticket_number,price_basis,unit_price_usd_cents,subtotal_usd_cents,vat_mode,vat_inclusive,vat_rate_basis_points,vat_amount_usd_cents,final_total_usd_cents,payment_status,notes,photos_json,correction_history_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id,purchaseNumber,confirmedAt,source.supplierId,source.supplierName,source.projectId,source.projectName,source.itemId,source.itemName,
        source.itemCode,source.categoryName,source.unitId,source.unitName,source.unitSymbol,quantityCubicMetres,source.deliveryMethod,
        source.driverId,source.driverName,source.truckId,source.truckPlate,null,source.priceBasis,price==null?null:Math.round(price*100),
        cents(calculation.subtotalUsd),source.vatMode,source.vatInclusive?1:0,source.vatRatePercent==null?null:Math.round(source.vatRatePercent*100),
        cents(calculation.vatAmountUsd),cents(calculation.finalTotalUsd),status,source.notes,'[]','[]',confirmedAt);
      await this.enqueue('quarryPurchase',id,{id,purchaseNumber,confirmedAt,incrementedFrom:sourcePurchaseId,quantity:quantityCubicMetres,unitSymbol:source.unitSymbol,projectId:source.projectId});
    });
    return this.get(id);
  }

  async listPurchases(){return(await this.db.getAllAsync<PurchaseRow>('SELECT * FROM quarry_purchases ORDER BY confirmed_at DESC')).map(fromRow);}

  async correctPurchase(id:string,draft:QuarryCorrectionDraft):Promise<QuarryPurchase>{
    const existing=await this.get(id);if(existing.status==='Cancelled')throw new Error('A cancelled supplier load cannot be corrected.');
    const reason=draft.correctionReason.trim();if(!reason)throw new Error('Correction reason is required.');
    const setup=await this.getSetup(),issues=validateQuarryPurchase({...draft,photos:[]},setup);if(issues.length)throw new Error(issues.join('\n'));
    const paid=await this.activePaymentCents(id);
    if(draft.supplierId!==existing.supplierId&&paid>0)throw new Error('Cancel active payments before changing the supplier.');
    if(!draft.unitPriceUsd.trim()&&paid>0)throw new Error('Cancel active payments before changing this supplier load to unpriced.');
    const supplier=setup.suppliers.find(v=>v.id===draft.supplierId)!;
    const project=setup.projects.find(v=>v.id===draft.projectId)??null;
    const item=setup.items.find(v=>v.id===draft.itemId)!;
    const unit=setup.units.find(v=>v.id===draft.unitId)!;
    const company=draft.deliveryMethod==='company',driver=company?setup.drivers.find(v=>v.id===draft.driverId)!:null,truck=company?setup.trucks.find(v=>v.id===draft.truckId)!:null;
    const driverId=driver?.id??SUPPLIER_DRIVER_ID,driverName=driver?.name??'Supplier Delivering';
    const truckId=truck?.id??SUPPLIER_TRUCK_ID,truckPlate=truck?.plate??(clean(draft.supplierTruckPlate)??'');
    const calculation=calculateQuarryPurchase({...draft,photos:[]},setup.vatRatePercent);
    const price=draft.unitPriceUsd.trim()?Number(draft.unitPriceUsd.replace(',','.')):null,total=cents(calculation.finalTotalUsd);
    const status:QuarryPurchase['paymentStatus']=total===null?'Unpriced':total===0?'No Payment Due':paymentStatus(total,paid);
    const now=new Date().toISOString();
    const values:Record<string,string|null>={
      Supplier:supplier.name,Project:project?.name??null,Item:item.name,Unit:unit.symbol,Quantity:String(Number(draft.quantityCubicMetres)),
      Delivery:draft.deliveryMethod,Driver:driverName,Truck:truckPlate,Ticket:clean(draft.supplierTicketNumber),
      'Price basis':draft.priceBasis,Price:price===null?null:String(price),VAT:calculation.vatRatePercent===null?null:String(calculation.vatRatePercent),
      'VAT treatment':draft.vatInclusive?'Included':'Excluded',Notes:clean(draft.notes),
    };
    const oldValues:Record<string,string|null>={
      Supplier:existing.supplierName,Project:existing.projectName,Item:existing.itemName,Unit:existing.unitSymbol,Quantity:String(existing.quantityCubicMetres),
      Delivery:existing.deliveryMethod,Driver:existing.driverName,Truck:existing.truckPlate,Ticket:existing.supplierTicketNumber,
      'Price basis':existing.priceBasis,Price:existing.unitPriceUsd===null?null:String(existing.unitPriceUsd),
      VAT:existing.vatRatePercent===null?null:String(existing.vatRatePercent),'VAT treatment':existing.vatInclusive?'Included':'Excluded',Notes:existing.notes,
    };
    const changes=Object.keys(values).filter(field=>values[field]!==oldValues[field]).map(field=>({field,originalValue:oldValues[field]??null,newValue:values[field]??null}));
    if(!changes.length)throw new Error('No information was changed.');
    const history=[...existing.correctionHistory,{correctedAt:now,correctedBy:'Admin',reason,changes}];
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(
        'UPDATE quarry_purchases SET supplier_id=?,supplier_name=?,project_id=?,project_name=?,item_id=?,item_name=?,item_code=?,category_name=?,unit_id=?,unit_name=?,unit_symbol=?,quantity_cubic_metres=?,delivery_method=?,driver_profile_id=?,driver_name=?,truck_profile_id=?,truck_plate=?,supplier_ticket_number=?,price_basis=?,unit_price_usd_cents=?,subtotal_usd_cents=?,vat_mode=?,vat_inclusive=?,vat_rate_basis_points=?,vat_amount_usd_cents=?,final_total_usd_cents=?,payment_status=?,notes=?,correction_history_json=?,updated_at=? WHERE id=?',
        supplier.id,supplier.name,project?.id??null,project?.name??null,item.id,item.name,item.internalCode,item.categoryName,unit.id,unit.name,unit.symbol,
        Number(draft.quantityCubicMetres),draft.deliveryMethod,driverId,driverName,truckId,truckPlate,clean(draft.supplierTicketNumber),
        draft.priceBasis,price==null?null:Math.round(price*100),cents(calculation.subtotalUsd),draft.vatMode,draft.vatInclusive?1:0,
        calculation.vatRatePercent==null?null:Math.round(calculation.vatRatePercent*100),cents(calculation.vatAmountUsd),total,status,
        clean(draft.notes),JSON.stringify(history),now,id);
      await this.enqueue('quarryPurchase',id,{id,correctedAt:now,reason,changes,paymentStatus:status});
    });
    return this.get(id);
  }

  async cancelPurchase(id:string,reason:string):Promise<QuarryPurchase>{
    const value=reason.trim();if(!value)throw new Error('Cancellation reason is required.');
    const existing=await this.get(id);if(existing.status==='Cancelled')throw new Error('A cancelled supplier load cannot be changed.');
    if(await this.activePaymentCents(id)>0)throw new Error('Cancel all active payments for this supplier load first.');
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{await this.db.runAsync("UPDATE quarry_purchases SET status='Cancelled',cancellation_reason=?,cancelled_at=?,updated_at=? WHERE id=?",value,now,now,id);await this.enqueue('quarryPurchase',id,{id,status:'Cancelled',cancellationReason:value,cancelledAt:now});});
    return this.get(id);
  }

  private draftFromPurchase(p:QuarryPurchase):QuarryPurchaseDraft{
    return{supplierId:p.supplierId,projectId:p.projectId??'',itemId:p.itemId,unitId:p.unitId,quantityCubicMetres:String(p.quantityCubicMetres),
      deliveryMethod:p.deliveryMethod,driverId:p.driverId,truckId:p.truckId,supplierTruckPlate:p.truckPlate,
      supplierTicketNumber:p.supplierTicketNumber??'',priceBasis:p.priceBasis,unitPriceUsd:p.unitPriceUsd===null?'':String(p.unitPriceUsd),
      vatMode:p.vatMode,customVatRatePercent:p.vatMode==='custom'?String(p.vatRatePercent??0):'',vatInclusive:p.vatInclusive,notes:p.notes??'',photos:[]};
  }
  private async nextPurchaseNumber(confirmedAt:string){
    const state=await this.db.getFirstAsync<{device_code:string;next_quarry_sequence:number}>('SELECT device_code,next_quarry_sequence FROM device_state WHERE id=?','local');
    if(!state)throw new Error('Device numbering is not configured.');
    const d=new Date(confirmedAt),day=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const number=`SUP-${day}-${state.device_code}-${String(state.next_quarry_sequence).padStart(5,'0')}`;
    await this.db.runAsync('UPDATE device_state SET next_quarry_sequence=next_quarry_sequence+1 WHERE id=?','local');
    return number;
  }
  private async get(id:string){const row=await this.db.getFirstAsync<PurchaseRow>('SELECT * FROM quarry_purchases WHERE id=?',id);if(!row)throw new Error('Supplier load was not found.');return fromRow(row);}
  private async activePaymentCents(id:string){const row=await this.db.getFirstAsync<{total:number}>("SELECT COALESCE(SUM(amount_usd_cents),0) total FROM payment_entries WHERE quarry_purchase_id=? AND status='Active'",id);return row?.total??0;}
  private async enqueue(entityType:string,entityId:string,payload:unknown){await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,'upsert',?,?)",entityType,entityId,JSON.stringify(payload),new Date().toISOString());}
}
