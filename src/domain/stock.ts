import {noVatChoice,resolveVatRate,validateAccountVat,type AccountVat,type VatChoice} from './accountVat';
import {localDateKey} from './fuel';

/**
 * Stock (Phase 1). Any Catalog item can be added to Stock. A batch is one delivery of that item, counted in the unit the item was added
 * with, and a use is recorded by hand: it is taken from the oldest open batches first and carries on into the next batch when one runs
 * out. A use is never rewritten; cancelling it adds reversal rows, so the history always shows why a figure changed. Bitumen and diesel
 * keep their own screens and tables. Usage rules that count loads come in a later phase.
 *
 * Everything here is pure; the repository decides what to load and what to persist.
 */
export type StockPriceBasis='per_unit'|'whole';
export type StockBatchStatus='in_use'|'waiting'|'closed'|'cancelled';
export type StockRecordStatus='Active'|'Cancelled';

export type StockUnit={id:string;name:string;symbol:string};
export type StockSupplier={id:string;name:string;/** The supplier's account VAT, where a new batch starts. */vat?:AccountVat};
/** A Catalog item that can be added to Stock. `unitId` is its default unit; an item without one asks for a unit the first time. */
export type StockCatalogItem={id:string;name:string;categoryName:string;unitId:string|null;unitSymbol:string|null;inStock:boolean};
export type StockSetup={suppliers:StockSupplier[];catalogItems:StockCatalogItem[];units:StockUnit[];vatRatePercent:number};

/** What the Add batch form sends. Quantity and price are text so the form can show what was typed. */
export type StockBatchDraft={
  itemId:string;/** Only used the first time an item is added to Stock, when it has no default unit. */unitId:string;
  recordDate:string;supplierId:string;invoiceNumber:string;quantity:string;priceBasis:StockPriceBasis;price:string;/** No VAT (the start), Universal or Own %. It starts from the supplier's account. */vat:VatChoice;notes:string;
};
export type StockBatchEditDraft=StockBatchDraft&{reason:string};
export const emptyStockBatch:StockBatchDraft={itemId:'',unitId:'',recordDate:localDateKey(new Date()),supplierId:'',invoiceNumber:'',quantity:'',priceBasis:'per_unit',price:'',vat:noVatChoice,notes:''};
export type StockUseDraft={itemId:string;quantity:string;usedOn:string;note:string};
export const emptyStockUse:StockUseDraft={itemId:'',quantity:'',usedOn:localDateKey(new Date()),note:''};

export type StockCorrectionEntry={at:string;reason:string;changes:{field:string;before:string;after:string}[]};

export type StockBatch={
  id:string;itemId:string;batchNumber:string;arrivedAt:string;supplierId:string|null;supplierName:string|null;invoiceNumber:string|null;notes:string|null;
  quantity:number;usedQuantity:number;remainingQuantity:number;
  priceBasis:StockPriceBasis|null;priceUsd:number|null;vatRatePercent:number|null;subtotalUsd:number|null;totalUsd:number|null;priced:boolean;
  status:StockBatchStatus;recordStatus:StockRecordStatus;
  cancellationReason:string|null;cancelledAt:string|null;correctionHistory:StockCorrectionEntry[];createdAt:string;
};

/** One row of the use table: a use takes quantity out of a batch, a reversal puts it back (negative quantity). */
export type StockUseRow={id:string;groupId:string;itemId:string;batchId:string;kind:'use'|'reversal';quantity:number;usedOn:string;note:string|null;reason:string|null;createdAt:string};
export type StockUseRecord={
  groupId:string;itemId:string;usedOn:string;quantity:number;note:string|null;createdAt:string;
  lines:{batchId:string;batchNumber:string;quantity:number}[];
  status:StockRecordStatus;cancellationReason:string|null;
};

export type StockItemOverview={
  itemId:string;itemName:string;unitSymbol:string;unitName:string;prefix:string;
  totalRemaining:number;totalReceived:number;totalUsed:number;
  batches:StockBatch[];uses:StockUseRecord[];
};
export type StockOverview={items:StockItemOverview[]};

export const stockStatusLabels:Record<StockBatchStatus,string>={in_use:'Open · In use',waiting:'Open · Waiting',closed:'Closed',cancelled:'Cancelled'};
export const priceBasisLabels:Record<StockPriceBasis,string>={per_unit:'Per unit',whole:'As a whole'};
export const STOCK_EPSILON=0.0005;

const round2=(value:number)=>Math.round(value*100)/100;
const round3=(value:number)=>Math.round(value*1000)/1000;
const decimal=(value:string)=>Number(value.trim().replace(',','.'));
const decimalFormat=(value:string)=>/^\d+([.,]\d+)?$/.test(value.trim());

export function formatStockBatchNumber(prefix:string,sequence:number):string{return `${prefix}-${String(sequence).padStart(4,'0')}`;}

/** A short code for an item's batch numbers: the first three letters of its name, made different from every code already taken. */
export function stockPrefix(name:string,taken:ReadonlySet<string>):string{
  const letters=name.normalize('NFKD').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  const base=(letters.slice(0,3)||'STK').padEnd(3,'X');
  if(!taken.has(base))return base;
  for(let n=2;n<1000;n+=1){const candidate=`${base.slice(0,2)}${n}`.slice(0,4);if(!taken.has(candidate))return candidate;}
  throw new Error('A batch code could not be made for this item.');
}

export function validateStockQuantity(value:string,what='Quantity'):number{
  const parsed=decimal(value);
  if(!decimalFormat(value)||!Number.isFinite(parsed)||parsed<=0)throw new Error(`${what} must be a number greater than zero.`);
  const rounded=round3(parsed);
  if(rounded<=0)throw new Error(`${what} must be a number greater than zero.`);
  return rounded;
}
export function validateStockPrice(value:string):number|null{
  if(!value.trim())return null;
  const parsed=decimal(value);
  if(!Number.isFinite(parsed)||parsed<0||!/^\d+([.,]\d{1,2})?$/.test(value.trim()))throw new Error('Price must be zero or greater with no more than two decimals.');
  return parsed;
}

/**
 * Subtotal, VAT and total of a delivery. The price is per unit or for the whole batch. No price means Unpriced: the amounts are null and
 * are never treated as zero. VAT is applied only when the form asked for it, and never by default.
 */
export function calculateStockPrice(quantity:number,basis:StockPriceBasis,priceText:string,vatRatePercent:number):{priceUsd:number|null;subtotalUsd:number|null;vatAmountUsd:number|null;totalUsd:number|null}{
  const price=validateStockPrice(priceText);
  if(price==null)return {priceUsd:null,subtotalUsd:null,vatAmountUsd:null,totalUsd:null};
  const subtotal=round2(basis==='per_unit'?quantity*price:price);
  const vat=round2(subtotal*vatRatePercent/100);
  return {priceUsd:price,subtotalUsd:subtotal,vatAmountUsd:vat,totalUsd:round2(subtotal+vat)};
}

/** The same figures for a form being filled in: null while the quantity, price or VAT is not yet valid. */
export function previewStockPrice(draft:Pick<StockBatchDraft,'quantity'|'priceBasis'|'price'|'vat'>,universalRatePercent:number){
  try{return calculateStockPrice(validateStockQuantity(draft.quantity),draft.priceBasis,draft.price,resolveVatRate(validateAccountVat(draft.vat),universalRatePercent));}catch{return null;}
}

export const formatStockQuantity=(quantity:number,symbol:string)=>`${quantity.toLocaleString('en-US',{maximumFractionDigits:3})} ${symbol}`;
export const formatUsd=(value:number)=>`$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export const stockPriceText=(batch:Pick<StockBatch,'priceBasis'|'priceUsd'>,symbol:string)=>batch.priceUsd==null||!batch.priceBasis?'Unpriced':batch.priceBasis==='whole'?`${formatUsd(batch.priceUsd)} as a whole`:`${formatUsd(batch.priceUsd)} / ${symbol}`;
export const isOpenStockBatch=(batch:Pick<StockBatch,'status'>)=>batch.status==='in_use'||batch.status==='waiting';

export type StockBatchBase=Omit<StockBatch,'status'|'remainingQuantity'|'usedQuantity'>;

/**
 * Sets each batch's used and remaining figures and its status, and groups the use rows into records. An active batch is open while it has
 * stock left; the first open one (by arrival, then number) is in use. A cancelled batch is kept and labelled Cancelled.
 */
export function buildStockItemOverview(item:{itemId:string;itemName:string;unitSymbol:string;unitName:string;prefix:string},batches:readonly StockBatchBase[],rows:readonly StockUseRow[]):StockItemOverview{
  const used=new Map<string,number>();
  for(const row of rows)used.set(row.batchId,round3((used.get(row.batchId)??0)+row.quantity));
  const sorted=[...batches].sort((a,b)=>a.arrivedAt.localeCompare(b.arrivedAt)||a.batchNumber.localeCompare(b.batchNumber));
  const withFigures=sorted.map(batch=>({...batch,usedQuantity:used.get(batch.id)??0,remainingQuantity:round3(batch.quantity-(used.get(batch.id)??0))}));
  const isOpen=(batch:{recordStatus:StockRecordStatus;remainingQuantity:number})=>batch.recordStatus==='Active'&&batch.remainingQuantity>STOCK_EPSILON;
  const first=withFigures.find(isOpen);
  const list:StockBatch[]=withFigures.map(batch=>({...batch,status:batch.recordStatus==='Cancelled'?'cancelled':!isOpen(batch)?'closed':batch===first?'in_use':'waiting'}));
  const open=list.filter(isOpenStockBatch);
  const numbers=new Map(list.map(batch=>[batch.id,batch.batchNumber]));
  const groups=new Map<string,StockUseRow[]>();
  for(const row of rows)groups.set(row.groupId,[...(groups.get(row.groupId)??[]),row]);
  const uses=[...groups.entries()].map(([groupId,groupRows]):StockUseRecord=>{
    const first=groupRows.find(row=>row.kind==='use')??groupRows[0]!;
    const reversals=groupRows.filter(row=>row.kind==='reversal');
    const perBatch=new Map<string,number>();
    for(const row of groupRows)perBatch.set(row.batchId,round3((perBatch.get(row.batchId)??0)+row.quantity));
    const gross=round3(groupRows.filter(row=>row.kind==='use').reduce((sum,row)=>sum+row.quantity,0));
    return {
      groupId,itemId:first.itemId,usedOn:first.usedOn,quantity:gross,note:first.note,createdAt:first.createdAt,
      lines:groupRows.filter(row=>row.kind==='use').map(row=>({batchId:row.batchId,batchNumber:numbers.get(row.batchId)??'',quantity:row.quantity})),
      status:reversals.length?'Cancelled':'Active',cancellationReason:reversals[0]?.reason??null,
    };
  }).sort((a,b)=>b.usedOn.localeCompare(a.usedOn)||b.createdAt.localeCompare(a.createdAt));
  return {
    ...item,
    totalRemaining:round3(open.reduce((sum,batch)=>sum+batch.remainingQuantity,0)),
    totalReceived:round3(list.filter(batch=>batch.recordStatus==='Active').reduce((sum,batch)=>sum+batch.quantity,0)),
    totalUsed:round3(rows.reduce((sum,row)=>sum+row.quantity,0)),
    batches:list,uses,
  };
}

export type StockUseLine={batchId:string;quantity:number};

/**
 * Which batches a use of `quantity` comes from: the oldest open batch first, then the next. Only batches that had arrived by the day of
 * the use can supply it. Throws when the stock on hand on that day cannot cover the quantity; nothing is ever taken from thin air.
 */
export function planStockUse(batches:readonly StockBatch[],quantity:number,usedOn:string,unitSymbol:string):StockUseLine[]{
  const usable=batches.filter(batch=>batch.recordStatus==='Active'&&batch.remainingQuantity>STOCK_EPSILON&&localDateKey(new Date(batch.arrivedAt))<=usedOn)
    .sort((a,b)=>a.arrivedAt.localeCompare(b.arrivedAt)||a.batchNumber.localeCompare(b.batchNumber));
  const available=round3(usable.reduce((sum,batch)=>sum+batch.remainingQuantity,0));
  if(quantity>available+STOCK_EPSILON)throw new Error(`Only ${formatStockQuantity(available,unitSymbol)} is in stock for that day. Record a delivery first, or enter a smaller quantity.`);
  const lines:StockUseLine[]=[];
  let left=quantity;
  for(const batch of usable){
    if(left<=STOCK_EPSILON)break;
    const take=round3(Math.min(left,batch.remainingQuantity));
    if(take>STOCK_EPSILON){lines.push({batchId:batch.id,quantity:take});left=round3(left-take);}
  }
  return lines;
}

/** The line on a Stock list for one item. */
export function stockItemLine(item:Pick<StockItemOverview,'totalRemaining'|'unitSymbol'|'batches'>):string{
  const open=item.batches.filter(isOpenStockBatch).length;
  return `${open} open batch${open===1?'':'es'}`;
}
