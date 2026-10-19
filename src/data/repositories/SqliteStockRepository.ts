import {accountVatFromRow,resolveVatRate,validateAccountVat} from '../../domain/accountVat';
import type {SQLiteDatabase} from 'expo-sqlite';

import {localDateKey} from '../../domain/fuel';
import {
  batchPriceFromLoad,buildStockItemOverview,calculateStockPrice,formatStockBatchNumber,formatStockQuantity,isOpenStockBatch,planStockUse,stockPrefix,STOCK_EPSILON,validateStockQuantity,
  type StockBatch,type StockLinkableLoad,type StockBatchBase,type StockBatchDraft,type StockBatchEditDraft,type StockCatalogItem,type StockCorrectionEntry,type StockOverview,type StockPriceBasis,type StockSetup,type StockUseDraft,type StockUseRecord,type StockUseRow,
} from '../../domain/stock';
import {reconcileStockUse,type RuleBatch,type RuleLoad,type RuleOverride,type StockRule,type StockRuleDraft,type StockRuleLine,type StockRulesSetup,type StockSyncResult} from '../../domain/stockRules';
import type {StockRepository} from './StockRepository';
import {activeClosure,insertClosure,loadClosures,reopenClosure} from './batchClosures';

type ItemRow={item_id:string;item_name:string;unit_symbol:string;unit_name:string;prefix:string;next_number:number};
type BatchRow={
  source_purchase_id?:string|null;
  id:string;item_id:string;batch_number:string;sequence:number;arrived_at:string;quantity:number;supplier_id:string|null;supplier_name:string|null;invoice_number:string|null;
  price_basis:StockPriceBasis|null;price_usd_cents:number|null;vat_basis_points:number|null;subtotal_usd_cents:number|null;total_usd_cents:number|null;notes:string|null;
  status:'Active'|'Cancelled';cancellation_reason:string|null;cancelled_at:string|null;correction_history_json:string|null;created_at:string;updated_at:string;
};
type LinkableLoadRow={id:string;purchase_number:string;confirmed_at:string;supplier_id:string;supplier_name:string;destination_name:string|null;quantity:number;unit_id:string|null;unit_symbol:string|null;supplier_ticket_number:string|null;unit_price_usd_cents:number|null;final_total_usd_cents:number|null};
type LinkLoadRow={id:string;purchase_number:string;confirmed_at:string;supplier_id:string;supplier_name:string;item_id:string;quantity:number;unit_id:string|null;unit_name:string|null;unit_symbol:string|null;supplier_ticket_number:string|null;price_basis:'per_unit'|'whole'|null;unit_price_usd_cents:number|null;subtotal_usd_cents:number|null;vat_rate_basis_points:number|null;final_total_usd_cents:number|null;status:'Active'|'Cancelled'};
type UseDbRow={id:string;group_id:string;item_id:string;batch_id:string;kind:'use'|'reversal';quantity:number;used_on:string;note:string|null;reason:string|null;created_at:string;source?:string|null;load_id?:string|null;load_number?:string|null;load_quantity?:number|null;load_unit?:string|null;rule_id?:string|null;rule_version_id?:string|null;rule_per_quantity?:number|null;rule_amount?:number|null};

const makeId=()=>`stock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const clean=(value:string)=>value.trim().replace(/\s+/g,' ')||null;
const cents=(value:number)=>Math.round(value*100);
const round3=(value:number)=>Math.round(value*1000)/1000;
const parseHistory=(value:string|null):StockCorrectionEntry[]=>{try{const parsed=JSON.parse(value??'[]');return Array.isArray(parsed)?parsed as StockCorrectionEntry[]:[];}catch{return [];}};
const useFromRow=(row:UseDbRow):StockUseRow=>({id:row.id,groupId:row.group_id,itemId:row.item_id,batchId:row.batch_id,kind:row.kind,quantity:row.quantity,usedOn:row.used_on,note:row.note,reason:row.reason,createdAt:row.created_at,source:row.source==='load'?'load':'manual',loadId:row.load_id??null,loadNumber:row.load_number??null,loadQuantity:row.load_quantity??null,loadUnit:row.load_unit??null,ruleId:row.rule_id??null,ruleVersionId:row.rule_version_id??null,rulePerQuantity:row.rule_per_quantity??null,ruleAmount:row.rule_amount??null});

/** The chosen date at the current time of day, so batches of one day keep the order they were entered in. */
function timestampForDate(input:string,what='Record date'):string{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input)||input>localDateKey(new Date()))throw new Error(`${what} must be today or a valid past date.`);
  const now=new Date(),[year=0,month=0,day=0]=input.split('-').map(Number);
  const value=new Date(year,month-1,day,now.getHours(),now.getMinutes(),now.getSeconds(),now.getMilliseconds());
  if(localDateKey(value)!==input)throw new Error('Select a valid date.');
  return value.toISOString();
}

function baseFromRow(row:BatchRow):StockBatchBase{
  const priced=row.price_usd_cents!=null&&row.total_usd_cents!=null&&row.price_basis!=null;
  return {
    id:row.id,itemId:row.item_id,batchNumber:row.batch_number,arrivedAt:row.arrived_at,supplierId:row.supplier_id,supplierName:row.supplier_name,invoiceNumber:row.invoice_number,notes:row.notes,
    quantity:row.quantity,priceBasis:row.price_basis,priceUsd:row.price_usd_cents==null?null:row.price_usd_cents/100,vatRatePercent:row.vat_basis_points==null?null:row.vat_basis_points/100,
    subtotalUsd:row.subtotal_usd_cents==null?null:row.subtotal_usd_cents/100,totalUsd:row.total_usd_cents==null?null:row.total_usd_cents/100,priced,
    sourcePurchaseId:row.source_purchase_id??null,recordStatus:row.status,cancellationReason:row.cancellation_reason,cancelledAt:row.cancelled_at,correctionHistory:parseHistory(row.correction_history_json),createdAt:row.created_at,
  };
}

export class SqliteStockRepository implements StockRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async getSetup():Promise<StockSetup>{
    const[suppliers,items,units,stocked,tax]=await Promise.all([
      this.db.getAllAsync<{id:string;name:string;vat_mode:string|null;vat_rate_basis_points:number|null}>('SELECT id,name,vat_mode,vat_rate_basis_points FROM suppliers WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;name:string;category_name:string;unit_id:string|null;symbol:string|null}>(`SELECT i.id,i.name,c.name category_name,i.default_unit_id unit_id,u.symbol FROM catalog_items i JOIN categories c ON c.id=i.category_id LEFT JOIN measurement_units u ON u.id=i.default_unit_id AND u.is_active=1 WHERE i.is_active=1 ORDER BY c.name COLLATE NOCASE,i.name COLLATE NOCASE`),
      this.db.getAllAsync<{id:string;name:string;symbol:string}>('SELECT id,name,symbol FROM measurement_units WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{item_id:string}>('SELECT item_id FROM stock_items WHERE is_active=1'),
      this.db.getFirstAsync<{rate:number}>("SELECT vat_rate_basis_points rate FROM tax_settings WHERE id='tax'"),
    ]);
    const inStock=new Set(stocked.map(row=>row.item_id));
    return {
      suppliers:suppliers.map(row=>({id:row.id,name:row.name,vat:accountVatFromRow(row.vat_mode,row.vat_rate_basis_points)})),units,vatRatePercent:(tax?.rate??0)/100,
      catalogItems:items.map((row):StockCatalogItem=>({id:row.id,name:row.name,categoryName:row.category_name,unitId:row.symbol?row.unit_id:null,unitSymbol:row.symbol,inStock:inStock.has(row.id)})),
    };
  }

  async getOverview():Promise<StockOverview>{
    const items=await this.db.getAllAsync<ItemRow>('SELECT item_id,item_name,unit_symbol,unit_name,prefix,next_number FROM stock_items WHERE is_active=1 ORDER BY item_name COLLATE NOCASE');
    const batches=await this.db.getAllAsync<BatchRow>('SELECT * FROM stock_batches ORDER BY arrived_at,batch_number');
    const uses=(await this.db.getAllAsync<UseDbRow>('SELECT * FROM stock_use ORDER BY created_at,rowid')).map(useFromRow);
    const closures=await loadClosures(this.db,'stock');
    return {items:items.map(item=>buildStockItemOverview(
      {itemId:item.item_id,itemName:item.item_name,unitSymbol:item.unit_symbol,unitName:item.unit_name,prefix:item.prefix},
      batches.filter(row=>row.item_id===item.item_id).map(baseFromRow),
      uses.filter(row=>row.itemId===item.item_id),
      closures,
    ))};
  }

  private async batch(id:string):Promise<StockBatch>{
    const row=await this.db.getFirstAsync<BatchRow>('SELECT * FROM stock_batches WHERE id=?',id);
    if(!row)throw new Error('The stock batch was not found.');
    const overview=await this.getOverview();
    const found=overview.items.find(item=>item.itemId===row.item_id)?.batches.find(value=>value.id===id);
    if(!found)throw new Error('The stock batch was not found.');
    return found;
  }

  private async enqueue(entity:'stockBatch'|'stockUse'|'stockRule',id:string,payload:unknown){
    await this.db.runAsync('INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)',entity,id,'upsert',JSON.stringify(payload),new Date().toISOString());
  }

  /** The price, VAT and supplier of a form, worked out once so recording and editing agree. */
  private async priceAndSupplier(draft:StockBatchDraft,quantity:number){
    const supplierId=draft.supplierId.trim();
    let supplier:{id:string;name:string}|null=null;
    if(supplierId){
      supplier=(await this.db.getFirstAsync<{id:string;name:string}>('SELECT id,name FROM suppliers WHERE id=? AND is_active=1',supplierId))??null;
      if(!supplier)throw new Error('Select an active supplier, or leave it empty.');
    }
    const tax=await this.db.getFirstAsync<{rate:number}>("SELECT vat_rate_basis_points rate FROM tax_settings WHERE id='tax'");
    const vatRate=resolveVatRate(validateAccountVat(draft.vat),(tax?.rate??0)/100);
    const price=calculateStockPrice(quantity,draft.priceBasis,draft.price,vatRate);
    return {supplier,price,vatPercent:vatRate>0&&price.priceUsd!=null?vatRate:null};
  }

  async recordBatch(draft:StockBatchDraft):Promise<StockBatch>{
    const quantity=validateStockQuantity(draft.quantity);
    const arrivedAt=timestampForDate(draft.recordDate);
    const item=await this.db.getFirstAsync<{id:string;name:string;unit_id:string|null}>('SELECT id,name,default_unit_id unit_id FROM catalog_items WHERE id=? AND is_active=1',draft.itemId);
    if(!item)throw new Error('Select an active item from your Catalog.');
    const {supplier,price,vatPercent}=await this.priceAndSupplier(draft,quantity);
    const existing=await this.db.getFirstAsync<ItemRow>('SELECT item_id,item_name,unit_symbol,unit_name,prefix,next_number FROM stock_items WHERE item_id=?',item.id);
    let unit:{symbol:string;name:string}|null=null;
    if(!existing){
      const unitId=draft.unitId.trim()||item.unit_id||'';
      unit=(await this.db.getFirstAsync<{symbol:string;name:string}>('SELECT symbol,name FROM measurement_units WHERE id=? AND is_active=1',unitId))??null;
      if(!unit)throw new Error('Select the unit this item is counted in.');
    }
    const id=makeId(),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      if(!existing){
        const taken=new Set((await this.db.getAllAsync<{prefix:string}>('SELECT prefix FROM stock_items')).map(row=>row.prefix));
        await this.db.runAsync('INSERT INTO stock_items (item_id,item_name,unit_symbol,unit_name,prefix,next_number,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?)',item.id,item.name,unit!.symbol,unit!.name,stockPrefix(item.name,taken),now,now);
      }
      const counter=await this.db.getFirstAsync<{sequence:number;prefix:string}>('UPDATE stock_items SET next_number = next_number + 1,updated_at = ? WHERE item_id = ? RETURNING next_number - 1 AS sequence,prefix',now,item.id);
      if(!counter)throw new Error('The batch number could not be generated.');
      const sequence=Number(counter.sequence),batchNumber=formatStockBatchNumber(counter.prefix,sequence);
      await this.db.runAsync(`INSERT INTO stock_batches (id,item_id,batch_number,sequence,arrived_at,quantity,supplier_id,supplier_name,invoice_number,price_basis,price_usd_cents,vat_basis_points,subtotal_usd_cents,total_usd_cents,notes,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Active',?,?)`,
        id,item.id,batchNumber,sequence,arrivedAt,quantity,supplier?.id??null,supplier?.name??null,clean(draft.invoiceNumber),price.priceUsd==null?null:draft.priceBasis,
        price.priceUsd==null?null:cents(price.priceUsd),vatPercent==null?null:Math.round(vatPercent*100),price.subtotalUsd==null?null:cents(price.subtotalUsd),price.totalUsd==null?null:cents(price.totalUsd),clean(draft.notes),now,now);
      await this.enqueue('stockBatch',id,{id,itemId:item.id,batchNumber,arrivedAt,quantity,supplierId:supplier?.id??null,invoiceNumber:clean(draft.invoiceNumber),priceUsd:price.priceUsd,totalUsd:price.totalUsd,status:'Active'});
    });
    return this.batch(id);
  }

  async listLinkableLoads(itemId:string):Promise<StockLinkableLoad[]>{
    const stocked=await this.db.getFirstAsync<{unit_symbol:string;item_name:string}>('SELECT unit_symbol,item_name FROM stock_items WHERE item_id=?',itemId);
    const rows=await this.db.getAllAsync<LinkableLoadRow>(`SELECT p.id,p.purchase_number,p.confirmed_at,p.supplier_id,p.supplier_name,COALESCE(p.project_name,s.name) destination_name,p.quantity_cubic_metres quantity,p.unit_id,p.unit_symbol,
        p.supplier_ticket_number,p.unit_price_usd_cents,p.final_total_usd_cents
      FROM quarry_purchases p LEFT JOIN company_sites s ON s.id=p.company_site_id
      WHERE p.item_id=? AND p.status='Active' AND NOT EXISTS (SELECT 1 FROM stock_batches b WHERE b.source_purchase_id=p.id AND b.status='Active')
      ORDER BY p.confirmed_at,p.purchase_number`,itemId);
    return rows.map(row=>{
      const symbol=row.unit_symbol??'';
      const sameUnit=!stocked||symbol.trim().toLowerCase()===stocked.unit_symbol.trim().toLowerCase();
      return{id:row.id,purchaseNumber:row.purchase_number,arrivedAt:row.confirmed_at,supplierId:row.supplier_id,supplierName:row.supplier_name,destinationName:row.destination_name,quantity:row.quantity,unitId:row.unit_id,unitSymbol:symbol,
        invoiceNumber:row.supplier_ticket_number,priced:row.unit_price_usd_cents!=null&&row.final_total_usd_cents!=null,totalUsd:row.final_total_usd_cents==null?null:row.final_total_usd_cents/100,
        usable:sameUnit,unusableReason:sameUnit?null:`This load is counted in ${symbol||'another unit'}, but ${stocked!.item_name} is in Stock in ${stocked!.unit_symbol}.`};
    });
  }

  async recordBatchesFromLoads(loadIds:string[]):Promise<StockBatch[]>{
    const ids=[...new Set(loadIds.map(value=>value.trim()).filter(Boolean))];
    if(!ids.length)throw new Error('Choose at least one Supplier Load.');
    const loads:LinkLoadRow[]=[];
    for(const id of ids){
      const row=await this.db.getFirstAsync<LinkLoadRow>('SELECT id,purchase_number,confirmed_at,supplier_id,supplier_name,item_id,quantity_cubic_metres quantity,unit_id,unit_name,unit_symbol,supplier_ticket_number,price_basis,unit_price_usd_cents,subtotal_usd_cents,vat_rate_basis_points,final_total_usd_cents,status FROM quarry_purchases WHERE id=?',id);
      if(!row)throw new Error('A chosen Supplier Load was not found.');
      if(row.status!=='Active')throw new Error(`Supplier Load ${row.purchase_number} is cancelled, so it cannot go into Stock.`);
      const linked=await this.db.getFirstAsync<{batch_number:string}>("SELECT batch_number FROM stock_batches WHERE source_purchase_id=? AND status='Active'",id);
      if(linked)throw new Error(`Supplier Load ${row.purchase_number} is already in Stock as ${linked.batch_number}.`);
      loads.push(row);
    }
    const first=loads[0]!;
    if(loads.some(load=>load.item_id!==first.item_id))throw new Error('Link the loads of one item at a time.');
    const symbol=(first.unit_symbol??'').trim().toLowerCase();
    if(loads.some(load=>(load.unit_symbol??'').trim().toLowerCase()!==symbol))throw new Error('These loads are counted in different units. Link the loads of one unit at a time.');
    const item=await this.db.getFirstAsync<{id:string;name:string}>('SELECT id,name FROM catalog_items WHERE id=? AND is_active=1',first.item_id);
    if(!item)throw new Error('The item of these loads is not an active Catalog item.');
    const existing=await this.db.getFirstAsync<ItemRow>('SELECT item_id,item_name,unit_symbol,unit_name,prefix,next_number FROM stock_items WHERE item_id=?',item.id);
    if(existing&&existing.unit_symbol.trim().toLowerCase()!==symbol)throw new Error(`These loads are counted in ${first.unit_symbol||'another unit'}, but ${existing.item_name} is in Stock in ${existing.unit_symbol}.`);
    if(!existing&&!first.unit_symbol)throw new Error('These loads have no unit, so the item cannot be added to Stock from them.');
    const ordered=[...loads].sort((a,b)=>a.confirmed_at.localeCompare(b.confirmed_at)||a.purchase_number.localeCompare(b.purchase_number));
    const created:string[]=[];const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      if(!existing){
        const taken=new Set((await this.db.getAllAsync<{prefix:string}>('SELECT prefix FROM stock_items')).map(row=>row.prefix));
        await this.db.runAsync('INSERT INTO stock_items (item_id,item_name,unit_symbol,unit_name,prefix,next_number,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?)',item.id,item.name,first.unit_symbol,first.unit_name??first.unit_symbol,stockPrefix(item.name,taken),now,now);
      }
      for(const load of ordered){
        const counter=await this.db.getFirstAsync<{sequence:number;prefix:string}>('UPDATE stock_items SET next_number = next_number + 1,updated_at = ? WHERE item_id = ? RETURNING next_number - 1 AS sequence,prefix',now,item.id);
        if(!counter)throw new Error('The batch number could not be generated.');
        const id=makeId(),sequence=Number(counter.sequence),batchNumber=formatStockBatchNumber(counter.prefix,sequence);
        const price=batchPriceFromLoad({quantity:load.quantity,priceBasis:load.price_basis,unitPriceCents:load.unit_price_usd_cents,subtotalCents:load.subtotal_usd_cents,vatBasisPoints:load.vat_rate_basis_points,totalCents:load.final_total_usd_cents});
        await this.db.runAsync(`INSERT INTO stock_batches (id,item_id,batch_number,sequence,arrived_at,quantity,supplier_id,supplier_name,invoice_number,price_basis,price_usd_cents,vat_basis_points,subtotal_usd_cents,total_usd_cents,notes,source_purchase_id,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,'Active',?,?)`,
          id,item.id,batchNumber,sequence,load.confirmed_at,load.quantity,load.supplier_id,load.supplier_name,clean(load.supplier_ticket_number??''),price?.priceBasis??null,price?.priceCents??null,price?.vatBasisPoints??null,price?.subtotalCents??null,price?.totalCents??null,load.id,now,now);
        await this.enqueue('stockBatch',id,{id,itemId:item.id,batchNumber,arrivedAt:load.confirmed_at,quantity:load.quantity,supplierId:load.supplier_id,invoiceNumber:clean(load.supplier_ticket_number??''),priceUsd:price?price.priceCents/100:null,totalUsd:price?price.totalCents/100:null,sourcePurchaseId:load.id,status:'Active'});
        created.push(id);
      }
    });
    const overview=await this.getOverview();
    const batches=overview.items.find(value=>value.itemId===item.id)?.batches??[];
    return created.map(id=>{const found=batches.find(value=>value.id===id);if(!found)throw new Error('The stock batch was not found.');return found;});
  }

  async editBatch(id:string,draft:StockBatchEditDraft):Promise<StockBatch>{
    const row=await this.db.getFirstAsync<BatchRow>('SELECT * FROM stock_batches WHERE id=?',id);
    if(!row)throw new Error('The stock batch was not found.');
    if(row.status==='Cancelled')throw new Error('A cancelled batch cannot be edited.');
    if(draft.itemId&&draft.itemId!==row.item_id)throw new Error('A batch cannot be moved to another item.');
    const quantity=validateStockQuantity(draft.quantity);
    const used=(await this.db.getFirstAsync<{total:number|null}>('SELECT SUM(quantity) total FROM stock_use WHERE batch_id=?',id))?.total??0;
    if(quantity<round3(used)-STOCK_EPSILON)throw new Error(`${formatStockQuantity(round3(used),(await this.unitOf(row.item_id)))} of this batch is already used, so the quantity cannot be lower than that.`);
    const firstUse=await this.db.getFirstAsync<{day:string|null}>("SELECT MIN(used_on) day FROM stock_use WHERE batch_id=? AND kind='use'",id);
    const arrivedDay=localDateKey(new Date(row.arrived_at));
    const dateChanged=draft.recordDate!==arrivedDay;
    const arrivedAt=dateChanged?timestampForDate(draft.recordDate):row.arrived_at;
    if(dateChanged&&firstUse?.day&&draft.recordDate>firstUse.day)throw new Error(`Stock from this batch was used on ${firstUse.day}, so it cannot arrive after that day.`);
    const {supplier,price,vatPercent}=await this.priceAndSupplier(draft,quantity);
    const unit=await this.unitOf(row.item_id);
    const changes:StockCorrectionEntry['changes']=[];
    const note=(field:string,before:string|null,after:string|null)=>{if((before??'')!==(after??''))changes.push({field,before:before??'none',after:after??'none'});};
    note('Quantity',String(row.quantity),String(quantity));note('Date',arrivedDay,draft.recordDate);
    note('Supplier',row.supplier_name,supplier?.name??null);note('Invoice',row.invoice_number,clean(draft.invoiceNumber));
    note('Price',row.price_usd_cents==null?null:String(row.price_usd_cents/100),price.priceUsd==null?null:String(price.priceUsd));
    note('VAT',row.vat_basis_points==null?null:`${row.vat_basis_points/100}%`,vatPercent==null?null:`${vatPercent}%`);note('Notes',row.notes,clean(draft.notes));
    if(!changes.length)return this.batch(id);
    const reason=draft.reason.trim();
    if(changes.some(change=>change.field==='Quantity'||change.field==='Date')&&!reason)throw new Error('Enter a reason when the quantity or the date changes.');
    const history:StockCorrectionEntry[]=[...parseHistory(row.correction_history_json),{at:new Date().toISOString(),reason:reason||'Details updated',changes}];
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`UPDATE stock_batches SET arrived_at=?,quantity=?,supplier_id=?,supplier_name=?,invoice_number=?,price_basis=?,price_usd_cents=?,vat_basis_points=?,subtotal_usd_cents=?,total_usd_cents=?,notes=?,correction_history_json=?,updated_at=? WHERE id=?`,
        arrivedAt,quantity,supplier?.id??null,supplier?.name??null,clean(draft.invoiceNumber),price.priceUsd==null?null:draft.priceBasis,price.priceUsd==null?null:cents(price.priceUsd),vatPercent==null?null:Math.round(vatPercent*100),
        price.subtotalUsd==null?null:cents(price.subtotalUsd),price.totalUsd==null?null:cents(price.totalUsd),clean(draft.notes),JSON.stringify(history),now,id);
      await this.enqueue('stockBatch',id,{id,itemId:row.item_id,batchNumber:row.batch_number,arrivedAt,quantity,unit,priceUsd:price.priceUsd,totalUsd:price.totalUsd,status:'Active',correction:history.at(-1)});
    });
    return this.batch(id);
  }

  async cancelBatch(id:string,reason:string):Promise<StockBatch>{
    const row=await this.db.getFirstAsync<BatchRow>('SELECT * FROM stock_batches WHERE id=?',id);
    if(!row)throw new Error('The stock batch was not found.');
    if(row.status==='Cancelled')throw new Error('This batch is already cancelled.');
    const why=reason.trim();
    if(!why)throw new Error('Enter a reason for cancelling this batch.');
    const used=(await this.db.getFirstAsync<{total:number|null}>('SELECT SUM(quantity) total FROM stock_use WHERE batch_id=?',id))?.total??0;
    if(Math.abs(used)>STOCK_EPSILON)throw new Error('Stock from this batch is recorded as used. Cancel those uses first, then cancel the batch.');
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync("UPDATE stock_batches SET status='Cancelled',cancellation_reason=?,cancelled_at=?,updated_at=? WHERE id=?",why,now,now,id);
      await this.enqueue('stockBatch',id,{id,itemId:row.item_id,batchNumber:row.batch_number,status:'Cancelled',cancellationReason:why,cancelledAt:now});
    });
    return this.batch(id);
  }

  private async unitOf(itemId:string):Promise<string>{
    return (await this.db.getFirstAsync<{unit_symbol:string}>('SELECT unit_symbol FROM stock_items WHERE item_id=?',itemId))?.unit_symbol??'';
  }

  async recordUse(draft:StockUseDraft):Promise<StockUseRecord>{
    const quantity=validateStockQuantity(draft.quantity,'The amount used');
    const usedAt=timestampForDate(draft.usedOn,'The date');
    const item=await this.db.getFirstAsync<ItemRow>('SELECT item_id,item_name,unit_symbol,unit_name,prefix,next_number FROM stock_items WHERE item_id=? AND is_active=1',draft.itemId);
    if(!item)throw new Error('This item is not in Stock yet. Add a batch of it first.');
    const overview=(await this.getOverview()).items.find(value=>value.itemId===item.item_id);
    const lines=planStockUse(overview?.batches??[],quantity,draft.usedOn,item.unit_symbol);
    const groupId=makeId(),now=new Date().toISOString(),note=clean(draft.note);
    await this.db.withTransactionAsync(async()=>{
      for(const line of lines){
        await this.db.runAsync("INSERT INTO stock_use (id,group_id,item_id,batch_id,kind,quantity,used_on,note,reason,created_at) VALUES (?,?,?,?,'use',?,?,?,NULL,?)",makeId(),groupId,item.item_id,line.batchId,line.quantity,draft.usedOn,note,now);
      }
      await this.enqueue('stockUse',groupId,{groupId,itemId:item.item_id,quantity,usedOn:draft.usedOn,usedAt,note,lines});
    });
    const record=(await this.getOverview()).items.find(value=>value.itemId===item.item_id)?.uses.find(value=>value.groupId===groupId);
    if(!record)throw new Error('The use could not be read back.');
    return record;
  }

  private async loadRules():Promise<StockRule[]>{
    const rules=await this.db.getAllAsync<{id:string;load_item_id:string;load_item_name:string;unit_symbol:string;is_enabled:number}>('SELECT id,load_item_id,load_item_name,unit_symbol,is_enabled FROM stock_rules ORDER BY load_item_name COLLATE NOCASE');
    const versions=await this.db.getAllAsync<{id:string;rule_id:string;effective_from:string;per_quantity:number;lines_json:string;created_at:string}>('SELECT id,rule_id,effective_from,per_quantity,lines_json,created_at FROM stock_rule_versions ORDER BY effective_from,created_at');
    const parse=(value:string):StockRuleLine[]=>{try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed as StockRuleLine[]:[];}catch{return [];}};
    return rules.map((rule):StockRule=>({id:rule.id,loadItemId:rule.load_item_id,loadItemName:rule.load_item_name,unitSymbol:rule.unit_symbol,enabled:rule.is_enabled===1,versions:versions.filter(version=>version.rule_id===rule.id).map(version=>({id:version.id,effectiveFrom:version.effective_from,perQuantity:version.per_quantity,lines:parse(version.lines_json),createdAt:version.created_at}))}));
  }

  async getRulesSetup():Promise<StockRulesSetup>{
    const[items,units,stocked,bitumen,rules]=await Promise.all([
      this.db.getAllAsync<{id:string;name:string;category_name:string;unit_id:string|null;symbol:string|null}>('SELECT i.id,i.name,c.name category_name,i.default_unit_id unit_id,u.symbol FROM catalog_items i JOIN categories c ON c.id=i.category_id LEFT JOIN measurement_units u ON u.id=i.default_unit_id AND u.is_active=1 WHERE i.is_active=1 AND i.loads_enabled=1 ORDER BY c.name COLLATE NOCASE,i.name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;name:string;symbol:string}>('SELECT id,name,symbol FROM measurement_units WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{item_id:string;item_name:string;unit_symbol:string}>('SELECT item_id,item_name,unit_symbol FROM stock_items WHERE is_active=1 ORDER BY item_name COLLATE NOCASE'),
      this.db.getAllAsync<{item_id:string}>('SELECT item_id FROM bitumen_item_rules WHERE is_enabled=1'),
      this.loadRules(),
    ]);
    const watched=new Set(rules.map(rule=>rule.loadItemId)),bitumenItems=new Set(bitumen.map(row=>row.item_id));
    return{units,rules,materials:stocked.map(row=>({id:row.item_id,name:row.item_name,unitSymbol:row.unit_symbol})),loadItems:items.map(row=>({id:row.id,name:row.name,categoryName:row.category_name,unitId:row.symbol?row.unit_id:null,unitSymbol:row.symbol,hasRule:watched.has(row.id),bitumen:bitumenItems.has(row.id)}))};
  }

  async saveRule(draft:StockRuleDraft):Promise<StockRule>{
    const existing=draft.ruleId?await this.db.getFirstAsync<{id:string;load_item_id:string;unit_symbol:string}>('SELECT id,load_item_id,unit_symbol FROM stock_rules WHERE id=?',draft.ruleId):null;
    if(draft.ruleId&&!existing)throw new Error('The rule was not found.');
    const item=await this.db.getFirstAsync<{id:string;name:string}>('SELECT id,name FROM catalog_items WHERE id=? AND is_active=1 AND loads_enabled=1',existing?.load_item_id??draft.loadItemId);
    if(!item)throw new Error('Select an active item that is delivered on receipts.');
    if(!existing){
      if(await this.db.getFirstAsync('SELECT id FROM stock_rules WHERE load_item_id=?',item.id))throw new Error('This item already has a rule. Edit that rule instead.');
      if(await this.db.getFirstAsync('SELECT item_id FROM bitumen_item_rules WHERE item_id=? AND is_enabled=1',item.id))throw new Error('Bitumen already counts this item from its loads, so a Stock rule cannot also take from it.');
    }
    let unitSymbol=existing?.unit_symbol??'';
    if(!existing){
      const unit=await this.db.getFirstAsync<{symbol:string}>('SELECT symbol FROM measurement_units WHERE id=? AND is_active=1',draft.unitId);
      if(!unit)throw new Error('Select the unit the rule is per, for example m³.');
      unitSymbol=unit.symbol;
    }
    const perQuantity=validateStockQuantity(draft.perQuantity,'The quantity the rule is per');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)||Number.isNaN(new Date(draft.effectiveFrom).getTime()))throw new Error('Choose the date the rule applies from.');
    if(!draft.lines.length)throw new Error('Add at least one material to the rule.');
    const materials=await this.db.getAllAsync<{item_id:string;item_name:string}>('SELECT item_id,item_name FROM stock_items WHERE is_active=1');
    const seen=new Set<string>(),lines:StockRuleLine[]=[];
    for(const line of draft.lines){
      const material=materials.find(value=>value.item_id===line.stockItemId);
      if(!material)throw new Error('Choose each material from your Stock.');
      if(seen.has(material.item_id))throw new Error(`${material.item_name} is listed twice in this rule.`);
      seen.add(material.item_id);
      lines.push({stockItemId:material.item_id,amount:validateStockQuantity(line.amount,`The amount of ${material.item_name}`)});
    }
    const now=new Date().toISOString(),ruleId=existing?.id??makeId(),versionId=makeId();
    await this.db.withTransactionAsync(async()=>{
      if(!existing)await this.db.runAsync('INSERT INTO stock_rules (id,load_item_id,load_item_name,unit_symbol,is_enabled,created_at,updated_at) VALUES (?,?,?,?,1,?,?)',ruleId,item.id,item.name,unitSymbol,now,now);
      else await this.db.runAsync('UPDATE stock_rules SET load_item_name=?,updated_at=? WHERE id=?',item.name,now,ruleId);
      await this.db.runAsync('INSERT INTO stock_rule_versions (id,rule_id,effective_from,per_quantity,lines_json,created_at) VALUES (?,?,?,?,?,?)',versionId,ruleId,draft.effectiveFrom,perQuantity,JSON.stringify(lines),now);
      await this.enqueue('stockRule',ruleId,{id:ruleId,loadItemId:item.id,unitSymbol,version:{id:versionId,effectiveFrom:draft.effectiveFrom,perQuantity,lines}});
    });
    const saved=(await this.loadRules()).find(rule=>rule.id===ruleId);
    if(!saved)throw new Error('The rule could not be read back.');
    return saved;
  }

  async setRuleEnabled(ruleId:string,enabled:boolean):Promise<void>{
    const now=new Date().toISOString();
    const result=await this.db.runAsync('UPDATE stock_rules SET is_enabled=?,updated_at=? WHERE id=?',enabled?1:0,now,ruleId);
    if(!result.changes)throw new Error('The rule was not found.');
    await this.enqueue('stockRule',ruleId,{id:ruleId,enabled,updatedAt:now});
  }

  async closeBatch(batchId:string,closedOn:string,reason:string):Promise<StockOverview>{
    // Loads confirmed so far are counted first, so the leftover shown is what is really left.
    await this.syncUse();
    const row=await this.db.getFirstAsync<BatchRow>('SELECT * FROM stock_batches WHERE id=?',batchId);
    if(!row)throw new Error('The stock batch was not found.');
    const batch=(await this.getOverview()).items.find(item=>item.itemId===row.item_id)?.batches.find(value=>value.id===batchId);
    if(!batch)throw new Error('The stock batch was not found.');
    if(!isOpenStockBatch(batch))throw new Error('Only a batch that is still open can be closed.');
    await this.db.withTransactionAsync(async()=>{
      await insertClosure(this.db,'stock',batchId,{closedOn,reason,leftover:batch.remainingQuantity});
    });
    return this.getOverview();
  }

  async reopenBatch(batchId:string,reason:string):Promise<StockOverview>{
    const row=await this.db.getFirstAsync<BatchRow>('SELECT * FROM stock_batches WHERE id=?',batchId);
    if(!row)throw new Error('The stock batch was not found.');
    if(row.status==='Cancelled')throw new Error('A cancelled batch cannot be reopened.');
    await reopenClosure(this.db,'stock',batchId,reason);
    return this.getOverview();
  }

  async syncUse():Promise<StockSyncResult>{
    const rules=await this.loadRules();
    if(!rules.length)return{added:0,attention:[]};
    const closures=await loadClosures(this.db,'stock');
    const[loadRows,batchRows,useRows,overrideRows]=await Promise.all([
      this.db.getAllAsync<{id:string;item_id:string;item_name:string;load_number:string|null;confirmed_at:string;status:string;is_archived:number|null;output_unit_symbol:string|null;billed_quantity:number|null}>('SELECT id,item_id,item_name,load_number,confirmed_at,status,is_archived,output_unit_symbol,billed_quantity FROM loads WHERE item_id IN (SELECT load_item_id FROM stock_rules)'),
      this.db.getAllAsync<{id:string;item_id:string;arrived_at:string;quantity:number;status:string}>('SELECT id,item_id,arrived_at,quantity,status FROM stock_batches'),
      this.db.getAllAsync<UseDbRow>('SELECT * FROM stock_use ORDER BY created_at,rowid'),
      this.db.getAllAsync<{load_id:string;stock_item_id:string;quantity:number;reason:string;created_at:string}>('SELECT load_id,stock_item_id,quantity,reason,created_at FROM stock_use_overrides'),
    ]);
    const plan=reconcileStockUse({
      rules,
      loads:loadRows.map((row):RuleLoad=>({id:row.id,itemId:row.item_id,itemName:row.item_name,loadNumber:row.load_number,confirmedAt:row.confirmed_at,active:row.status==='Active'&&row.is_archived!==1,quantity:row.billed_quantity,unitSymbol:row.output_unit_symbol})),
      rows:useRows.map(useFromRow),
      batches:batchRows.map((row):RuleBatch=>({id:row.id,itemId:row.item_id,arrivedDay:localDateKey(new Date(row.arrived_at)),active:row.status==='Active',quantity:row.quantity,closedAt:activeClosure(closures,row.id)?.closedAt??null})),
      overrides:overrideRows.map((row):RuleOverride=>({loadId:row.load_id,stockItemId:row.stock_item_id,quantity:row.quantity,reason:row.reason,createdAt:row.created_at})),
    });
    if(plan.rows.length){
      const now=new Date().toISOString();
      await this.db.withTransactionAsync(async()=>{
        for(const row of plan.rows){
          await this.db.runAsync("INSERT INTO stock_use (id,group_id,item_id,batch_id,kind,quantity,used_on,note,reason,created_at,source,load_id,load_number,load_quantity,load_unit,rule_id,rule_version_id,rule_per_quantity,rule_amount) VALUES (?,?,?,?,?,?,?,?,NULL,?,'load',?,?,?,?,?,?,?,?)",makeId(),row.groupId,row.itemId,row.batchId,row.kind,row.quantity,row.usedOn,row.note,now,row.loadId,row.loadNumber,row.loadQuantity,row.loadUnit,row.ruleId,row.ruleVersionId,row.rulePerQuantity,row.ruleAmount);
        }
        for(const groupId of new Set(plan.rows.map(row=>row.groupId)))await this.enqueue('stockUse',groupId,{groupId,source:'load',counted:plan.rows.filter(row=>row.groupId===groupId).map(row=>({batchId:row.batchId,quantity:row.quantity,kind:row.kind}))});
      });
    }
    return{added:plan.rows.length,attention:plan.attention};
  }

  async adjustLoadUse(loadId:string,stockItemId:string,quantity:string,reason:string):Promise<void>{
    const why=reason.trim();
    if(!why)throw new Error('Enter a reason for the real amount.');
    const text=quantity.trim().replace(',','.');
    const value=Number(text);
    if(!/^\d+(\.\d+)?$/.test(text)||!Number.isFinite(value))throw new Error('The real amount must be a number, zero or more.');
    const counted=await this.db.getFirstAsync<{count:number}>("SELECT COUNT(*) count FROM stock_use WHERE load_id=? AND item_id=? AND source='load'",loadId,stockItemId);
    if(!counted||counted.count<=0)throw new Error('That load has not been counted for this material, so there is nothing to adjust.');
    const load=await this.db.getFirstAsync<{status:string;is_archived:number|null}>('SELECT status,is_archived FROM loads WHERE id=?',loadId);
    if(!load||load.status!=='Active'||load.is_archived===1)throw new Error('A cancelled load cannot be adjusted.');
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO stock_use_overrides (id,load_id,stock_item_id,quantity,reason,created_at) VALUES (?,?,?,?,?,?)',makeId(),loadId,stockItemId,Math.round(value*1000)/1000,why,now);
    });
    await this.syncUse();
  }

  async getCompanyIdentity():Promise<{name:string;logoUri:string|null;contactLine:string|null}>{
    const row=await this.db.getFirstAsync<{company_name:string|null;logo_uri:string|null;address:string|null;phone:string|null;email:string|null}>("SELECT company_name,logo_uri,address,phone,email FROM company_settings WHERE id='company'");
    const contact=[row?.address,row?.phone,row?.email].map(value=>value?.trim()).filter(Boolean).join(' · ');
    return{name:row?.company_name?.trim()||'DROMEX',logoUri:row?.logo_uri?.trim()||null,contactLine:contact||null};
  }

  async cancelUse(groupId:string,reason:string):Promise<void>{
    const why=reason.trim();
    if(!why)throw new Error('Enter a reason for cancelling this use.');
    const rows=await this.db.getAllAsync<UseDbRow>('SELECT * FROM stock_use WHERE group_id=? ORDER BY rowid',groupId);
    if(!rows.length)throw new Error('That recorded use was not found.');
    if(rows.some(row=>row.kind==='reversal'))throw new Error('This use is already cancelled.');
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      for(const row of rows){
        await this.db.runAsync("INSERT INTO stock_use (id,group_id,item_id,batch_id,kind,quantity,used_on,note,reason,created_at) VALUES (?,?,?,?,'reversal',?,?,?,?,?)",makeId(),groupId,row.item_id,row.batch_id,-row.quantity,row.used_on,row.note,why,now);
      }
      await this.enqueue('stockUse',groupId,{groupId,itemId:rows[0]!.item_id,status:'Cancelled',cancellationReason:why,cancelledAt:now});
    });
  }
}
