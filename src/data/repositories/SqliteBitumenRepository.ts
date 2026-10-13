import type {SQLiteDatabase} from 'expo-sqlite';

import {localDateKey} from '../../domain/fuel';
import {
  buildBitumenOverview,calculateBitumenPrice,formatBitumenBatchNumber,formatKg,isOpenBatch,priceBasisLabels,validatePositiveKg,
  type BitumenBatch,type BitumenCorrectionEntry,type BitumenDeliveryDraft,type BitumenEditDraft,type BitumenGrade,type BitumenOverview,type BitumenPriceBasis,type BitumenSetup,
} from '../../domain/bitumen';
import type {BitumenRepository} from './BitumenRepository';

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
    return buildBitumenOverview(rows.map(fromRow),settings?.using_batch_id??null);
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
    if(batchId){
      const open=(await this.getOverview()).batches.find(value=>value.id===batchId);
      if(!open||!isOpenBatch(open))throw new Error('Choose a batch that is still open.');
    }
    await this.db.runAsync("INSERT INTO bitumen_settings (id,using_batch_id,created_at) VALUES ('bitumen',?,?) ON CONFLICT(id) DO UPDATE SET using_batch_id=excluded.using_batch_id",batchId,new Date().toISOString());
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
