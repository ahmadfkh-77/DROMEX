import type {PaymentStatus,ProjectFinancialSummary,ProjectMoneyBlock} from '../../domain/financials';

// Presentation decisions for the Project Financial Review, kept out of the screen file so they can
// be tested directly: this project has no React Native test renderer, and importing the .tsx would
// pull in react-native. Nothing here calculates money; it only decides how a settled value reads.

/** Money is already exact to two decimals in the domain (it totals in cents), so this only groups it. */
export function formatMoney(value:number):string{
  const cents=Math.round(value*100);
  const [whole='0',fraction='00']=(Math.abs(cents)/100).toFixed(2).split('.');
  return `${cents<0?'-':''}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${fraction}`;
}

/** Quantities keep the existing three-decimal settlement; only trailing zeros and grouping change. */
export function formatQuantity(value:number):string{
  const rounded=Number.isInteger(value)?value:Number(value.toFixed(3));
  const [whole='0',fraction]=String(rounded).split('.');
  const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return fraction?`${grouped}.${fraction}`:grouped;
}

export type StatusTone='success'|'warning'|'danger'|'neutral';

// Attention first: a review is read to find what still needs money moved.
const STATUS_ORDER:PaymentStatus[]=['Unpaid','Partially Paid','Overpaid','Paid','No Payment Due','Unpriced'];

export function statusTone(status:PaymentStatus):StatusTone{
  if(status==='Paid')return 'success';
  if(status==='Unpaid')return 'danger';
  if(status==='No Payment Due')return 'neutral';
  return 'warning';
}

/** Only the statuses a reader cannot infer from the words alone carry an explanation. */
export function statusGloss(status:PaymentStatus):string|null{
  if(status==='No Payment Due')return 'No Payment Due: the record was confirmed at $0.00 on purpose, so nothing is owed on it.';
  if(status==='Overpaid')return 'Overpaid: recorded payments come to more than the amount billed.';
  if(status==='Unpriced')return 'Unpriced: no price was entered, so the record carries no money value.';
  return null;
}

/** A status with no records is not information, so it is left out of the strip entirely. */
export function presentStatuses(counts:Record<PaymentStatus,number>):{status:PaymentStatus;count:number}[]{
  return STATUS_ORDER.filter(status=>counts[status]>0).map(status=>({status,count:counts[status]}));
}

export function exclusionPhrase(block:Pick<ProjectMoneyBlock,'excludedCancelled'|'excludedUnpriced'>,singular:string,plural:string):string|null{
  const parts:string[]=[];
  if(block.excludedCancelled>0)parts.push(`${block.excludedCancelled} cancelled ${block.excludedCancelled===1?singular:plural}`);
  if(block.excludedUnpriced>0)parts.push(`${block.excludedUnpriced} unpriced ${block.excludedUnpriced===1?singular:plural}`);
  return parts.length?parts.join(' and '):null;
}

/**
 * True only when the project recorded nothing at all. A project holding only cancelled or unpriced
 * records is not empty: collapsing it would hide the exclusion strips that say where those went.
 */
export function isProjectFinanciallyEmpty(summary:ProjectFinancialSummary):boolean{
  const blockEmpty=(block:ProjectMoneyBlock)=>block.recordCount===0&&block.excludedCancelled===0&&block.excludedUnpriced===0;
  return blockEmpty(summary.revenue)&&blockEmpty(summary.supplierPayables)&&summary.fuel.fillCount===0&&summary.uncosted.length===0;
}

export function billingPeriodText(block:Pick<ProjectMoneyBlock,'firstRecordDate'|'lastRecordDate'>):string{
  if(!block.firstRecordDate||!block.lastRecordDate)return 'No billing recorded yet';
  if(block.firstRecordDate===block.lastRecordDate)return `Billing recorded on ${block.firstRecordDate}`;
  return `Billing recorded ${block.firstRecordDate} to ${block.lastRecordDate}`;
}

export const plural=(count:number,noun:string,pluralForm?:string)=>`${count} ${count===1?noun:(pluralForm??`${noun}s`)}`;
