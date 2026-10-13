import type {SQLiteDatabase} from 'expo-sqlite';

import {localDateKey} from '../../domain/fuel';
import {
  buildBitumenOverview,calculateBitumenPrice,formatBitumenBatchNumber,formatKg,isOpenBatch,priceBasisLabels,validatePositiveKg,
  type BitumenBatch,type BitumenCorrectionEntry,type BitumenDeliveryDraft,type BitumenEditDraft,type BitumenGrade,type BitumenOverview,type BitumenPriceBasis,type BitumenSetup,
} from '../../domain/bitumen';
import {
  adjustmentFor,DEFAULT_RULE,mixKgForLoad,planMoveLoad,reconcileBitumenUse,USE_EPSILON,
  type BitumenAdjustment,type BitumenRule,type BitumenRuleDraft,type BitumenUseRow,type BitumenUseSetup,type SyncResult,type UseBatch,type UseLoad,type UseRowInput,
} from '../../domain/bitumenUse';
import type {BitumenRepository} from './BitumenRepository';

type UseDbRow={id:string;load_id:string;batch_id:string|null;kind:BitumenUseRow['kind'];kg:number;mix_kg:number;rule_aggregate_kg:number;rule_bitumen_kg:number;load_number:string|null;load_confirmed_at:string|null;item_name:string;note:string|null;created_at:string};
const useFromRow=(row:UseDbRow):BitumenUseRow=>({id:row.id,loadId:row.load_id,batchId:row.batch_id,kind:row.kind,kg:row.kg,mixKg:row.mix_kg,ruleAggregateKg:row.rule_aggregate_kg,ruleBitumenKg:row.rule_bitumen_kg,loadNumber:row.load_number,loadConfirmedAt:row.load_confirmed_at??row.created_at,itemName:row.item_name,note:row.note,createdAt:row.created_at});
type LoadDbRow={id:string;item_id:string;item_name:string;load_number:string|null;transaction_number:string;confirmed_at:string;status:'Active'|'Cancelled';is_archived:number|null;quantity_method:'weighbridge'|'direct'|null;net_weight_kg:number|null;direct_quantity:number|null;direct_unit_symbol:string|null;billed_quantity:number|null;output_unit_symbol:string|null};
const round3=(value:number)=>Math.round(value*1000)/1000;
const positive=(value:string,what:string)=>{const parsed=Number(value.trim().replace(',','.'));if(!/^\d+([.,]\d+)?$/.test(value.trim())||!Number.isFinite(parsed)||parsed<=0)throw new Error(`${what} must be a number greater than zero.`);return parsed;};

type Row={
  id:string;batch_number:string;year:number;sequence:number;arrived_at:string;delivered_kg:number;grade_id:string|null;grade_name:string;supplier_id:string|null;supplier_name:string|null;
  invoice_number:string|null;ticket_number:string|null;price_basis:BitumenPriceBasis|null;price_usd_cents:number|null;vat_basis_points:number|null;subtotal_usd_cents:number|null;total_usd_cents:number|null;
  notes:string|null;status:'Active'|'Cancelled';cancellation_reason:string|null;cancelled_at:string|null;correction_history_json:string|null;created_at:string;updated_at:string;
};
const makeId=()=>`bitumen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const clean=(value:string)=>value.trim().replace(/\s+/g,' ')||null;
const cents=(value:number)=>Math.round(value*100);
const parseHistory=(value:string|null):BitumenCorrectionEntry[]=>{try{const parsed=JSON.parse(value??'[]');return Array.isArray(parsed)?parsed as BitumenCorrectionEntry[]:[];}catch{return [];}};

/** The chosen record date at the current time of day, so batches of one day keep the order they were entered in. */
function timestampForDate(input:string):string{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input)||input>localDateKey(new Date()))throw new Error('Record date must be today or a valid past date.');
  const now=new Date(),[year=0,month=0,day=0]=input.split('-').map(Number);
  const value=new Date(year,month-1,day,now.getHours(),now.getMinutes(),now.getSeconds(),now.getMilliseconds());
  if(localDateKey(value)!==input)throw new Error('Select a valid record date.');
  return value.toISOString();
}

function fromRow(row:Row):Omit<BitumenBatch,'status'|'remainingKg'>{
  const priced=row.price_usd_cents!=null&&row.total_usd_cents!=null&&row.price_basis!=null;
  const price=row.price_usd_cents==null?null:row.price_usd_cents/100;
  return {
    id:row.id,batchNumber:row.batch_number,arrivedAt:row.arrived_at,supplierId:row.supplier_id,supplierName:row.supplier_name,gradeId:row.grade_id,gradeName:row.grade_name,
    invoiceNumber:row.invoice_number,ticketNumber:row.ticket_number,notes:row.notes,deliveredKg:row.delivered_kg,usedKg:0,adjustmentKg:0,
    priceBasis:row.price_basis,priceUsd:price,vatRatePercent:row.vat_basis_points==null?null:row.vat_basis_points/100,subtotalUsd:row.subtotal_usd_cents==null?null:row.subtotal_usd_cents/100,totalUsd:row.total_usd_cents==null?null:row.total_usd_cents/100,
    pricePerTonUsd:price==null||!row.price_basis||row.price_basis==='whole'?null:row.price_basis==='per_ton'?price:Math.round(price*1000*100)/100,
    priced,recordStatus:row.status,cancellationReason:row.cancellation_reason,cancelledAt:row.cancelled_at,correctionHistory:parseHistory(row.correction_history_json),createdAt:row.created_at,
  };
}

export class SqliteBitumenRepository implements BitumenRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async getSetup():Promise<BitumenSetup>{
    const[suppliers,grades,tax]=await Promise.all([
      this.db.getAllAsync<{id:string;name:string}>('SELECT id,name FROM suppliers WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;name:string;is_active:number}>('SELECT id,name,is_active FROM bitumen_grades ORDER BY is_active DESC,name COLLATE NOCASE'),
      this.db.getFirstAsync<{rate:number}>("SELECT vat_rate_basis_points rate FROM tax_settings WHERE id='tax'"),
    ]);
    return {suppliers,grades:grades.map((row):BitumenGrade=>({id:row.id,name:row.name,isActive:row.is_active===1})),vatRatePercent:(tax?.rate??0)/100};
  }

  async getOverview():Promise<BitumenOverview>{
    const rows=await this.db.getAllAsync<Row>('SELECT * FROM bitumen_batches ORDER BY arrived_at,batch_number');
    const settings=await this.db.getFirstAsync<{using_batch_id:string|null}>("SELECT using_batch_id FROM bitumen_settings WHERE id='bitumen'");
    const useRows=(await this.db.getAllAsync<UseDbRow>('SELECT * FROM bitumen_use ORDER BY created_at,rowid')).map(useFromRow);
    const adjustments=(await this.db.getAllAsync<{id:string;batch_id:string;kg:number;reason:string;estimated_before:number;real_after:number;created_at:string}>('SELECT * FROM bitumen_adjustments ORDER BY created_at,rowid')).map((row):BitumenAdjustment=>({id:row.id,batchId:row.batch_id,kg:row.kg,reason:row.reason,estimatedBefore:row.estimated_before,realAfter:row.real_after,createdAt:row.created_at}));
    const enabled=await this.db.getFirstAsync<{count:number}>('SELECT COUNT(*) count FROM bitumen_item_rules WHERE is_enabled=1');
    const used=new Map<string,number>(),adjusted=new Map<string,number>();
    for(const row of useRows)if(row.batchId)used.set(row.batchId,round3((used.get(row.batchId)??0)+row.kg));
    for(const adjustment of adjustments)adjusted.set(adjustment.batchId,round3((adjusted.get(adjustment.batchId)??0)+adjustment.kg));
    const overview=buildBitumenOverview(rows.map(fromRow).map(batch=>({...batch,usedKg:used.get(batch.id)??0,adjustmentKg:adjusted.get(batch.id)??0})),settings?.using_batch_id??null);
    return {...overview,useRows,adjustments,rulesEnabled:enabled?.count??0};
  }

  private async batch(id:string):Promise<BitumenBatch>{
    const found=(await this.getOverview()).batches.find(value=>value.id===id);
    if(!found)throw new Error('The bitumen batch was not found.');
    return found;
  }

  private async nextNumber(arrivedAt:string):Promise<{year:number;sequence:number;batchNumber:string}>{
    const year=Number(localDateKey(new Date(arrivedAt)).slice(0,4));
    const counter=await this.db.getFirstAsync<{sequence:number}>(`INSERT INTO bitumen_batch_counters (year,next_number) VALUES (?,2)
      ON CONFLICT(year) DO UPDATE SET next_number = next_number + 1 RETURNING next_number - 1 AS sequence`,year);
    if(!counter)throw new Error('The batch number could not be generated.');
    return {year,sequence:Number(counter.sequence),batchNumber:formatBitumenBatchNumber(year,Number(counter.sequence))};
  }

  private async enqueue(id:string,payload:unknown){
    await this.db.runAsync('INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)','bitumenBatch',id,'upsert',JSON.stringify(payload),new Date().toISOString());
  }

  /** Validates the form and works out everything a batch stores, so recording and editing agree. */
  private async prepare(draft:BitumenDeliveryDraft){
    const setup=await this.getSetup();
    const kg=validatePositiveKg(draft.kg);
    const supplier=setup.suppliers.find(value=>value.id===draft.supplierId);
    if(!supplier)throw new Error('Select an active supplier.');
    const grade=setup.grades.find(value=>value.id===draft.gradeId);
    if(!grade)throw new Error('Select a bitumen grade.');
    const price=calculateBitumenPrice(kg,draft.priceBasis,draft.price,draft.vat?setup.vatRatePercent:0);
    return {kg,supplier,grade,price,vatPercent:draft.vat&&price.priceUsd!=null?setup.vatRatePercent:null,arrivedAt:timestampForDate(draft.recordDate)};
  }

  async recordDelivery(draft:BitumenDeliveryDraft):Promise<BitumenBatch>{
    const {kg,supplier,grade,price,vatPercent,arrivedAt}=await this.prepare(draft);
    const id=makeId(),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      const number=await this.nextNumber(arrivedAt);
      await this.db.runAsync(`INSERT INTO bitumen_batches (id,batch_number,year,sequence,arrived_at,delivered_kg,grade_id,grade_name,supplier_id,supplier_name,invoice_number,ticket_number,price_basis,price_usd_cents,vat_basis_points,subtotal_usd_cents,total_usd_cents,notes,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,number.batchNumber,number.year,number.sequence,arrivedAt,kg,grade.id,grade.name,supplier.id,supplier.name,clean(draft.invoiceNumber),clean(draft.ticketNumber),
        price.priceUsd==null?null:draft.priceBasis,price.priceUsd==null?null:cents(price.priceUsd),vatPercent==null?null:Math.round(vatPercent*100),price.subtotalUsd==null?null:cents(price.subtotalUsd),price.totalUsd==null?null:cents(price.totalUsd),clean(draft.notes),now,now);
      await this.enqueue(id,{id,batchNumber:number.batchNumber,arrivedAt,deliveredKg:kg,supplierId:supplier.id,gradeId:grade.id,status:'Active'});
    });
    return this.batch(id);
  }

  async editBatch(id:string,draft:BitumenEditDraft):Promise<BitumenBatch>{
    const row=await this.db.getFirstAsync<Row>('SELECT * FROM bitumen_batches WHERE id=?',id);
    if(!row)throw new Error('The bitumen batch was not found.');
    if(row.status==='Cancelled')throw new Error('A cancelled batch cannot be edited.');
    const before=fromRow(row);
    const {kg,supplier,grade,price,vatPercent,arrivedAt}=await this.prepare({...draft,recordDate:draft.recordDate});
    const dateChanged=localDateKey(new Date(row.arrived_at))!==draft.recordDate;
    const kgChanged=Math.abs(kg-row.delivered_kg)>0.0005;
    const reason=draft.reason.trim();
    if((dateChanged||kgChanged)&&!reason)throw new Error('Enter the reason for changing the quantity or the date.');
    if(kg<before.usedKg)throw new Error('The quantity cannot be less than the bitumen already used from this batch.');
    const priceBasis=price.priceUsd==null?null:draft.priceBasis;
    const changes:BitumenCorrectionEntry['changes']=[];
    const note=(field:string,from:string|null,to:string|null)=>{if((from??'')!==(to??''))changes.push({field,before:from??'—',after:to??'—'});};
    note('Supplier',row.supplier_name,supplier.name);note('Grade',row.grade_name,grade.name);note('Invoice',row.invoice_number,clean(draft.invoiceNumber));note('Weighbridge ticket',row.ticket_number,clean(draft.ticketNumber));
    note('Quantity',kgChanged?formatKg(row.delivered_kg):null,kgChanged?formatKg(kg):null);
    note('Date',dateChanged?localDateKey(new Date(row.arrived_at)):null,dateChanged?draft.recordDate:null);
    note('Price',row.price_usd_cents==null?'Unpriced':`${priceBasis===row.price_basis||!row.price_basis?'':''}${(row.price_usd_cents/100).toFixed(2)} ${row.price_basis?priceBasisLabels[row.price_basis]:''}`.trim(),price.priceUsd==null?'Unpriced':`${price.priceUsd.toFixed(2)} ${priceBasis?priceBasisLabels[priceBasis]:''}`.trim());
    note('VAT',row.vat_basis_points==null?'None':`${row.vat_basis_points/100}%`,vatPercent==null?'None':`${vatPercent}%`);
    note('Notes',row.notes,clean(draft.notes));
    const now=new Date().toISOString();
    const history=[...before.correctionHistory,...(changes.length?[{at:now,reason:reason||'No reason needed (details only)',changes}]:[])];
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`UPDATE bitumen_batches SET arrived_at=?,delivered_kg=?,grade_id=?,grade_name=?,supplier_id=?,supplier_name=?,invoice_number=?,ticket_number=?,price_basis=?,price_usd_cents=?,vat_basis_points=?,subtotal_usd_cents=?,total_usd_cents=?,notes=?,correction_history_json=?,updated_at=? WHERE id=?`,
        dateChanged?arrivedAt:row.arrived_at,kg,grade.id,grade.name,supplier.id,supplier.name,clean(draft.invoiceNumber),clean(draft.ticketNumber),priceBasis,price.priceUsd==null?null:cents(price.priceUsd),vatPercent==null?null:Math.round(vatPercent*100),
        price.subtotalUsd==null?null:cents(price.subtotalUsd),price.totalUsd==null?null:cents(price.totalUsd),clean(draft.notes),JSON.stringify(history),now,id);
      await this.enqueue(id,{id,edited:true,changes,reason});
    });
    return this.batch(id);
  }

  async cancelBatch(id:string,reason:string):Promise<BitumenBatch>{
    const value=reason.trim();
    if(!value)throw new Error('Enter the reason for cancelling this batch.');
    const row=await this.db.getFirstAsync<Row>('SELECT * FROM bitumen_batches WHERE id=?',id);
    if(!row)throw new Error('The bitumen batch was not found.');
    if(row.status==='Cancelled')throw new Error('This batch is already cancelled.');
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync("UPDATE bitumen_batches SET status='Cancelled',cancellation_reason=?,cancelled_at=?,updated_at=? WHERE id=?",value,now,now,id);
      await this.db.runAsync("UPDATE bitumen_settings SET using_batch_id=NULL WHERE id='bitumen' AND using_batch_id=?",id);
      await this.enqueue(id,{id,status:'Cancelled',cancellationReason:value,cancelledAt:now});
    });
    return this.batch(id);
  }

  async setUsingBatch(batchId:string|null):Promise<BitumenOverview>{
    // Loads confirmed so far stay with the batch that was in use until now.
    await this.syncUse();
    if(batchId){
      const open=(await this.getOverview()).batches.find(value=>value.id===batchId);
      if(!open||!isOpenBatch(open))throw new Error('Choose a batch that is still open.');
    }
    await this.db.runAsync("INSERT INTO bitumen_settings (id,using_batch_id,created_at) VALUES ('bitumen',?,?) ON CONFLICT(id) DO UPDATE SET using_batch_id=excluded.using_batch_id",batchId,new Date().toISOString());
    return this.getOverview();
  }

  // ---- Phase C: rules and use from asphalt loads
  async getUseSetup():Promise<BitumenUseSetup>{
    const items=await this.db.getAllAsync<{id:string;name:string;category_name:string;series_id:string|null;prefix:string|null}>(`SELECT i.id,i.name,c.name category_name,i.load_number_series_id series_id,s.prefix FROM catalog_items i JOIN categories c ON c.id=i.category_id LEFT JOIN load_number_series s ON s.id=i.load_number_series_id WHERE i.is_active=1 AND i.loads_enabled=1 ORDER BY i.name COLLATE NOCASE`);
    const seriesRows=await this.db.getAllAsync<{id:string;prefix:string;display_name:string}>('SELECT id,prefix,display_name FROM load_number_series WHERE is_active=1 ORDER BY prefix');
    const rules=await this.db.getAllAsync<{item_id:string;name:string;is_enabled:number;aggregate_kg:number;bitumen_kg:number;count_from:string}>('SELECT r.item_id,i.name,r.is_enabled,r.aggregate_kg,r.bitumen_kg,r.count_from FROM bitumen_item_rules r JOIN catalog_items i ON i.id=r.item_id ORDER BY i.name COLLATE NOCASE');
    return {
      items:items.map(row=>({id:row.id,name:row.name,categoryName:row.category_name,seriesId:row.series_id,seriesPrefix:row.prefix})),
      series:seriesRows.map(row=>({id:row.id,prefix:row.prefix,name:row.display_name,itemIds:items.filter(item=>item.series_id===row.id).map(item=>item.id)})).filter(series=>series.itemIds.length>0),
      rules:rules.map((row):BitumenRule=>({itemId:row.item_id,itemName:row.name,enabled:row.is_enabled===1,aggregateKg:row.aggregate_kg,bitumenKg:row.bitumen_kg,countFrom:row.count_from})),
    };
  }

  async saveRule(draft:BitumenRuleDraft):Promise<BitumenRule>{
    const item=await this.db.getFirstAsync<{id:string;name:string}>('SELECT id,name FROM catalog_items WHERE id=? AND is_active=1 AND loads_enabled=1',draft.itemId);
    if(!item)throw new Error('Select an active item that is used on receipts.');
    const aggregateKg=round3(positive(draft.aggregateTons,'The mix quantity')*1000),bitumenKg=round3(positive(draft.bitumenKg,'The bitumen quantity'));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.countFrom))throw new Error('Choose the day to start counting loads from.');
    const now=new Date().toISOString();
    await this.db.runAsync(`INSERT INTO bitumen_item_rules (item_id,is_enabled,aggregate_kg,bitumen_kg,count_from,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(item_id) DO UPDATE SET is_enabled=excluded.is_enabled,aggregate_kg=excluded.aggregate_kg,bitumen_kg=excluded.bitumen_kg,count_from=excluded.count_from,updated_at=excluded.updated_at`,item.id,draft.enabled?1:0,aggregateKg,bitumenKg,draft.countFrom,now,now);
    return {itemId:item.id,itemName:item.name,enabled:draft.enabled,aggregateKg,bitumenKg,countFrom:draft.countFrom};
  }

  async enableSeries(seriesId:string,countFrom:string):Promise<BitumenRule[]>{
    const setup=await this.getUseSetup();
    const series=setup.series.find(value=>value.id===seriesId);
    if(!series)throw new Error('That series has no items used on receipts.');
    const saved:BitumenRule[]=[];
    for(const itemId of series.itemIds){
      const existing=setup.rules.find(rule=>rule.itemId===itemId);
      saved.push(await this.saveRule({itemId,enabled:true,aggregateTons:String((existing?.aggregateKg??DEFAULT_RULE.aggregateKg)/1000),bitumenKg:String(existing?.bitumenKg??DEFAULT_RULE.bitumenKg),countFrom:existing?.countFrom??countFrom}));
    }
    return saved;
  }

  async syncUse():Promise<SyncResult>{
    const overview=await this.getOverview();
    const setup=await this.getUseSetup();
    const loadRows=await this.db.getAllAsync<LoadDbRow>(`SELECT id,item_id,item_name,load_number,transaction_number,confirmed_at,status,is_archived,quantity_method,net_weight_kg,direct_quantity,direct_unit_symbol,billed_quantity,output_unit_symbol FROM loads
      WHERE item_id IN (SELECT item_id FROM bitumen_item_rules WHERE is_enabled=1) OR id IN (SELECT DISTINCT load_id FROM bitumen_use) ORDER BY confirmed_at,id`);
    if(!loadRows.length)return {added:0,attention:[]};
    const loads:UseLoad[]=loadRows.map(row=>({id:row.id,itemId:row.item_id,itemName:row.item_name,loadNumber:row.load_number??row.transaction_number,confirmedAt:row.confirmed_at,active:row.status==='Active'&&(row.is_archived??0)===0,
      mixKg:mixKgForLoad({quantityMethod:row.quantity_method??'weighbridge',netWeightKg:row.net_weight_kg,directQuantity:row.direct_quantity,directUnitSymbol:row.direct_unit_symbol,billedQuantity:row.billed_quantity,outputUnitSymbol:row.output_unit_symbol})}));
    const batches:UseBatch[]=overview.batches.map(batch=>({id:batch.id,arrivedDay:localDateKey(new Date(batch.arrivedAt)),active:batch.recordStatus==='Active',deliveredKg:batch.deliveredKg,adjustmentKg:batch.adjustmentKg}));
    const {rows,attention}=reconcileBitumenUse({rules:setup.rules,loads,existing:overview.useRows??[],batches,usingBatchId:overview.usingBatchId??null});
    if(rows.length)await this.insertUseRows(rows);
    return {added:rows.length,attention};
  }

  private async insertUseRows(rows:UseRowInput[]){
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      for(const row of rows){
        const id=`bitumen_use_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
        await this.db.runAsync('INSERT INTO bitumen_use (id,load_id,batch_id,kind,kg,mix_kg,rule_aggregate_kg,rule_bitumen_kg,load_number,load_confirmed_at,item_name,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,row.loadId,row.batchId,row.kind,row.kg,row.mixKg,row.ruleAggregateKg,row.ruleBitumenKg,row.loadNumber,row.loadConfirmedAt,row.itemName,row.note,now);
      }
      for(const loadId of new Set(rows.map(row=>row.loadId)))await this.enqueueUse(loadId,rows.filter(row=>row.loadId===loadId));
    });
  }

  private async enqueueUse(loadId:string,rows:UseRowInput[]){
    await this.db.runAsync('INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)','bitumenUse',loadId,'upsert',JSON.stringify({loadId,rows:rows.map(row=>({batchId:row.batchId,kind:row.kind,kg:row.kg}))}),new Date().toISOString());
  }

  async moveLoad(loadId:string,toBatchId:string):Promise<BitumenOverview>{
    await this.syncUse();
    const overview=await this.getOverview();
    const target=overview.batches.find(batch=>batch.id===toBatchId);
    if(!target||!(target.status==='in_use'||target.status==='waiting'))throw new Error('Choose a batch that is still open.');
    const loadRows=(overview.useRows??[]).filter(row=>row.loadId===loadId);
    const rows=planMoveLoad(loadRows,toBatchId);
    if(!rows.length)throw new Error('This load has no bitumen use to move.');
    const moving=rows.filter(row=>row.kind==='moved').reduce((sum,row)=>sum+row.kg,0);
    if(moving>target.remainingKg+USE_EPSILON)throw new Error(`${target.batchNumber} has only ${target.remainingKg.toLocaleString('en-US',{maximumFractionDigits:3})} kg left, not enough for this load.`);
    await this.insertUseRows(rows);
    return this.getOverview();
  }

  async adjustBatch(batchId:string,realRemainingKg:string,reason:string):Promise<BitumenOverview>{
    await this.syncUse();
    const overview=await this.getOverview();
    const batch=overview.batches.find(value=>value.id===batchId);
    if(!batch||batch.recordStatus==='Cancelled')throw new Error('Choose a batch that is still on record.');
    const text=reason.trim();
    if(!text)throw new Error('Enter the reason for the adjustment.');
    const trimmed=realRemainingKg.trim();
    const real=trimmed==='0'||trimmed==='0.0'?0:positive(realRemainingKg,'The real amount');
    const difference=adjustmentFor(batch.remainingKg,round3(real));
    if(Math.abs(difference)<=USE_EPSILON)throw new Error('The real amount is the same as the estimate, so there is nothing to adjust.');
    const now=new Date().toISOString(),id=`bitumen_adj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO bitumen_adjustments (id,batch_id,kg,reason,estimated_before,real_after,created_at) VALUES (?,?,?,?,?,?,?)',id,batchId,difference,text,batch.remainingKg,round3(real),now);
      await this.enqueue(batchId,{id:batchId,adjustment:difference,reason:text});
    });
    return this.getOverview();
  }

  async getCompanyIdentity():Promise<{name:string;logoUri:string|null;contactLine:string|null}>{
    const row=await this.db.getFirstAsync<{company_name:string|null;logo_uri:string|null;address:string|null;phone:string|null;email:string|null}>("SELECT company_name,logo_uri,address,phone,email FROM company_settings WHERE id='company'");
    const contact=[row?.address,row?.phone,row?.email].map(value=>value?.trim()).filter(Boolean).join(' · ');
    return {name:row?.company_name?.trim()||'DROMEX',logoUri:row?.logo_uri?.trim()||null,contactLine:contact||null};
  }

  async addGrade(name:string):Promise<BitumenGrade>{
    const value=clean(name);
    if(!value)throw new Error('Enter the grade name.');
    const key=value.toLocaleLowerCase('en-US');
    const existing=await this.db.getFirstAsync<{id:string;name:string;is_active:number}>('SELECT id,name,is_active FROM bitumen_grades WHERE name_key=?',key);
    if(existing){
      if(existing.is_active!==1)await this.db.runAsync('UPDATE bitumen_grades SET is_active=1,updated_at=? WHERE id=?',new Date().toISOString(),existing.id);
      return {id:existing.id,name:existing.name,isActive:true};
    }
    const id=`bitumen_grade_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,now=new Date().toISOString();
    await this.db.runAsync('INSERT INTO bitumen_grades (id,name,name_key,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)',id,value,key,now,now);
    return {id,name:value,isActive:true};
  }

  /** A grade used by a batch is deactivated, never deleted, so history stays valid. */
  async setGradeActive(id:string,isActive:boolean):Promise<void>{
    await this.db.runAsync('UPDATE bitumen_grades SET is_active=?,updated_at=? WHERE id=?',isActive?1:0,new Date().toISOString(),id);
  }
}
