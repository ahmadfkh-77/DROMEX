import {accountVatFromRow,resolveVatRate,validateAccountVat} from '../../domain/accountVat';
import type {SQLiteDatabase} from 'expo-sqlite';

import {localDateKey} from '../../domain/fuel';
import {
  buildStockItemOverview,calculateStockPrice,formatStockBatchNumber,formatStockQuantity,planStockUse,stockPrefix,STOCK_EPSILON,validateStockQuantity,
  type StockBatch,type StockBatchBase,type StockBatchDraft,type StockBatchEditDraft,type StockCatalogItem,type StockCorrectionEntry,type StockOverview,type StockPriceBasis,type StockSetup,type StockUseDraft,type StockUseRecord,type StockUseRow,
} from '../../domain/stock';
import type {StockRepository} from './StockRepository';

type ItemRow={item_id:string;item_name:string;unit_symbol:string;unit_name:string;prefix:string;next_number:number};
type BatchRow={
  id:string;item_id:string;batch_number:string;sequence:number;arrived_at:string;quantity:number;supplier_id:string|null;supplier_name:string|null;invoice_number:string|null;
  price_basis:StockPriceBasis|null;price_usd_cents:number|null;vat_basis_points:number|null;subtotal_usd_cents:number|null;total_usd_cents:number|null;notes:string|null;
  status:'Active'|'Cancelled';cancellation_reason:string|null;cancelled_at:string|null;correction_history_json:string|null;created_at:string;updated_at:string;
};
type UseDbRow={id:string;group_id:string;item_id:string;batch_id:string;kind:'use'|'reversal';quantity:number;used_on:string;note:string|null;reason:string|null;created_at:string};

const makeId=()=>`stock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const clean=(value:string)=>value.trim().replace(/\s+/g,' ')||null;
const cents=(value:number)=>Math.round(value*100);
const round3=(value:number)=>Math.round(value*1000)/1000;
const parseHistory=(value:string|null):StockCorrectionEntry[]=>{try{const parsed=JSON.parse(value??'[]');return Array.isArray(parsed)?parsed as StockCorrectionEntry[]:[];}catch{return [];}};
const useFromRow=(row:UseDbRow):StockUseRow=>({id:row.id,groupId:row.group_id,itemId:row.item_id,batchId:row.batch_id,kind:row.kind,quantity:row.quantity,usedOn:row.used_on,note:row.note,reason:row.reason,createdAt:row.created_at});

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
    recordStatus:row.status,cancellationReason:row.cancellation_reason,cancelledAt:row.cancelled_at,correctionHistory:parseHistory(row.correction_history_json),createdAt:row.created_at,
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
    return {items:items.map(item=>buildStockItemOverview(
      {itemId:item.item_id,itemName:item.item_name,unitSymbol:item.unit_symbol,unitName:item.unit_name,prefix:item.prefix},
      batches.filter(row=>row.item_id===item.item_id).map(baseFromRow),
      uses.filter(row=>row.itemId===item.item_id),
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

  private async enqueue(entity:'stockBatch'|'stockUse',id:string,payload:unknown){
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
