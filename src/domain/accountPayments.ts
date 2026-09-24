import {localFinancialDate,type FinancialOverview,type FinancialPartyType,type FinancialTarget,type FinancialTargetType,type PaymentStatus} from './financials';

/**
 * DEC-482 / DEC-483. Account payments and Open Balance cancellation.
 *
 * One real payment is recorded once, for one customer or supplier account. It can be applied three
 * ways: to the account as a whole (it stays unallocated), to the oldest unpaid records first, or to
 * records the owner selects with exact amounts. A fourth, internal mode ('record') is a payment made
 * from one record's own screen. Whatever mode is used:
 *
 * - a record never receives more than it still owes;
 * - a payment is never allocated beyond its own amount;
 * - what is not allocated stays visible as unallocated and lowers the account balance, and money
 *   beyond what the account owes is shown as credit, never as a negative balance.
 *
 * Every amount is handled in whole cents. All customer and supplier money is USD, so there is no
 * currency to mix; quantities and units are never part of a payment.
 */
export type PaymentMethod='cash'|'cheque'|'bank_transfer'|'other';
export const paymentMethodLabels:Record<PaymentMethod,string>={cash:'Cash',cheque:'Cheque',bank_transfer:'Bank transfer',other:'Other'};
export type ApplicationMode='overall'|'oldest'|'selected'|'record';
export const applicationModeLabels:Record<ApplicationMode,string>={overall:'Overall balance',oldest:'Oldest unpaid records',selected:'Selected records',record:'This record'};

export type PaymentSelection={targetType:FinancialTargetType;targetId:string;amountUsd:string};
export type AccountPaymentDraft={partyType:FinancialPartyType;partyId:string;amountUsd:string;paymentDate:string;method:PaymentMethod;reference:string;note:string;mode:ApplicationMode;selections:PaymentSelection[]};
export const emptyAccountPaymentDraft=(partyType:FinancialPartyType,partyId:string):AccountPaymentDraft=>({partyType,partyId,amountUsd:'',paymentDate:localFinancialDate(),method:'cash',reference:'',note:'',mode:'overall',selections:[]});

export type AllocationLine={targetType:FinancialTargetType;targetId:string;reference:string;recordDate:string;amountCents:number};
export type AllocationPlan={amountCents:number;allocations:AllocationLine[];allocatedCents:number;unallocatedCents:number;issues:string[]};

export type AccountPaymentAllocation={paymentEntryId:string;targetType:FinancialTargetType;targetId:string;reference:string;amountUsd:number;status:'Active'|'Cancelled';/** When this amount was applied; later than the payment when unallocated money was applied afterwards. */createdAt?:string};
export type AccountPayment={id:string;partyType:FinancialPartyType;partyId:string;partyName:string;amountUsd:number;paymentDate:string;method:PaymentMethod;reference:string|null;note:string|null;mode:ApplicationMode;status:'Active'|'Cancelled';cancellationReason:string|null;cancelledAt:string|null;createdAt:string;allocations:AccountPaymentAllocation[];allocatedUsd:number;unallocatedUsd:number};
export type CancelledOpeningBalance={id:string;partyType:FinancialPartyType;partyId:string;partyName:string;reference:string;amountUsd:number;asOfDate:string;cancellationReason:string;cancelledAt:string;statusBeforeCancellation:PaymentStatus|null};
/** What the repository returns next to the per-record overview. */
export type AccountLedger={accountPayments:AccountPayment[];cancelledOpenings:CancelledOpeningBalance[]};

const cents=(usd:number)=>Math.round(usd*100);
const usd=(value:number)=>`$${(value/100).toFixed(2)}`;

/** A typed amount in whole cents, or null when it is not a positive amount with at most two decimals. */
export function parseAmountCents(text:string):number|null{
  const value=text.trim().replace(',','.');
  if(!/^\d+(\.\d{1,2})?$/.test(value))return null;
  const amount=Math.round(Number(value)*100);
  return amount>0?amount:null;
}

function validDate(value:string):boolean{
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(!match)return false;
  return localFinancialDate(new Date(Number(match[1]),Number(match[2])-1,Number(match[3])))===value;
}

export function validateAccountPaymentDraft(draft:AccountPaymentDraft):string[]{
  const issues:string[]=[];
  if(parseAmountCents(draft.amountUsd)==null)issues.push('Payment amount must be greater than zero with no more than two decimals.');
  if(!validDate(draft.paymentDate)||draft.paymentDate>localFinancialDate())issues.push('Payment date must be today or an earlier valid date.');
  if(!(draft.method in paymentMethodLabels))issues.push('Choose how the payment was made.');
  return issues;
}

/** Oldest first; records on the same day keep a stable order by reference. */
export function oldestFirst(targets:readonly FinancialTarget[]):FinancialTarget[]{
  return [...targets].sort((a,b)=>a.recordDate.localeCompare(b.recordDate)||a.reference.localeCompare(b.reference,undefined,{numeric:true}));
}

/**
 * How a payment would be applied, before anything is saved. `open` is the account's records that
 * still owe money. The same plan is shown as the preview and re-checked by the repository inside the
 * saving transaction.
 */
export function planAllocation(draft:AccountPaymentDraft,open:readonly FinancialTarget[]):AllocationPlan{
  const amountCents=parseAmountCents(draft.amountUsd)??0;
  const issues:string[]=[];
  const allocations:AllocationLine[]=[];
  const owing=open.filter(target=>target.remainingUsd>0);
  if(draft.mode==='oldest'){
    let left=amountCents;
    for(const target of oldestFirst(owing)){
      if(left<=0)break;
      const amount=Math.min(left,cents(target.remainingUsd));
      allocations.push({targetType:target.type,targetId:target.id,reference:target.reference,recordDate:target.recordDate,amountCents:amount});
      left-=amount;
    }
  }else if(draft.mode==='selected'||draft.mode==='record'){
    const chosen=draft.selections.filter(selection=>selection.amountUsd.trim()!=='');
    if(!chosen.length)issues.push('Select at least one record and enter an amount for it.');
    for(const selection of chosen){
      const target=owing.find(value=>value.id===selection.targetId&&value.type===selection.targetType);
      if(!target){issues.push('A selected record is no longer open on this account.');continue;}
      const amount=parseAmountCents(selection.amountUsd);
      if(amount==null){issues.push(`Enter a valid amount for ${target.reference}.`);continue;}
      const remaining=cents(target.remainingUsd);
      if(amount>remaining){issues.push(`${target.reference} still owes ${usd(remaining)}; it cannot receive ${usd(amount)}.`);continue;}
      allocations.push({targetType:target.type,targetId:target.id,reference:target.reference,recordDate:target.recordDate,amountCents:amount});
    }
    const selectedCents=allocations.reduce((sum,line)=>sum+line.amountCents,0);
    if(selectedCents>amountCents)issues.push(`The selected amounts (${usd(selectedCents)}) are more than the payment (${usd(amountCents)}).`);
    if(draft.mode==='record'&&chosen.length!==1)issues.push('A record payment applies to exactly one record.');
    if(draft.mode==='record'&&!issues.length&&selectedCents!==amountCents)issues.push('A record payment must be applied to that record in full.');
  }
  const allocatedCents=allocations.reduce((sum,line)=>sum+line.amountCents,0);
  return {amountCents,allocations,allocatedCents,unallocatedCents:Math.max(0,amountCents-allocatedCents),issues:[...new Set(issues)]};
}

/** Applying money that an earlier payment left unallocated: oldest first, or to selected records. */
export type ApplyUnallocatedDraft={mode:'oldest'|'selected';amountUsd:string;selections:PaymentSelection[]};

/**
 * DEC-485. The plan for applying part or all of a payment's unallocated money to records. It uses the
 * same per-record rules as a new payment; the original payment's amount, date, method and mode never
 * change, and nothing beyond what is still unallocated can be applied.
 */
export function planApplyUnallocated(payment:AccountPayment,draft:ApplyUnallocatedDraft,open:readonly FinancialTarget[]):AllocationPlan{
  const plan=planAllocation({...emptyAccountPaymentDraft(payment.partyType,payment.partyId),mode:draft.mode,amountUsd:draft.amountUsd,selections:draft.selections},open);
  const issues:string[]=[];
  const available=cents(payment.unallocatedUsd);
  if(payment.status==='Cancelled')issues.push('A cancelled payment cannot be applied to records.');
  else if(available<=0)issues.push('Nothing is left unallocated on this payment.');
  else if(parseAmountCents(draft.amountUsd)==null)issues.push('Enter the amount to apply, greater than zero with no more than two decimals.');
  else if(plan.amountCents>available)issues.push(`You can apply at most ${usd(available)}, the unallocated part of this payment.`);
  if(!issues.length&&draft.mode==='oldest'&&!plan.allocations.length)issues.push('This account has no unpaid records to apply it to.');
  return {...plan,issues:[...issues,...plan.issues]};
}

export function validateOpeningBalanceCancellation(reason:string,activePaymentCount:number):string[]{
  const issues:string[]=[];
  if(!reason.trim())issues.push('Enter the reason for cancelling this Open Balance.');
  if(activePaymentCount>0)issues.push(`This Open Balance has ${activePaymentCount} active payment${activePaymentCount===1?'':'s'}. Cancel those payments first, then cancel the balance.`);
  return issues;
}

export type AccountSummary={billedUsd:number;recordPaidUsd:number;unallocatedUsd:number;paidUsd:number;outstandingRecordsUsd:number;balanceUsd:number;creditUsd:number;openRecordCount:number;cancelledCount:number};

/**
 * One account's statement figures. Billed and the records' outstanding amounts come from the records;
 * Paid is what records received plus active unallocated money; Balance is what is still owed after
 * unallocated money, never below zero; Credit is unallocated money beyond what is owed. Cancelled
 * Open Balances are only counted, never added to any amount.
 */
export function summarizeAccount(targets:readonly FinancialTarget[],payments:readonly AccountPayment[],cancelled:readonly CancelledOpeningBalance[]):AccountSummary{
  let billed=0,recordPaid=0,outstanding=0,open=0,unallocated=0;
  for(const target of targets){billed+=cents(target.totalUsd);recordPaid+=cents(target.paidUsd);outstanding+=cents(target.remainingUsd);if(target.remainingUsd>0)open+=1;}
  for(const payment of payments)if(payment.status==='Active')unallocated+=cents(payment.unallocatedUsd);
  return {billedUsd:billed/100,recordPaidUsd:recordPaid/100,unallocatedUsd:unallocated/100,paidUsd:(recordPaid+unallocated)/100,outstandingRecordsUsd:outstanding/100,balanceUsd:Math.max(0,outstanding-unallocated)/100,creditUsd:Math.max(0,unallocated-outstanding)/100,openRecordCount:open,cancelledCount:cancelled.length};
}

/** The balance and credit the account would show once this plan is saved; shown before confirming. */
export function balanceAfterPayment(summary:AccountSummary,plan:AllocationPlan):{balanceUsd:number;creditUsd:number}{
  const outstanding=cents(summary.outstandingRecordsUsd)-plan.allocatedCents;
  const unallocated=cents(summary.unallocatedUsd)+plan.unallocatedCents;
  return {balanceUsd:Math.max(0,outstanding-unallocated)/100,creditUsd:Math.max(0,unallocated-outstanding)/100};
}

export type AccountRow={partyType:FinancialPartyType;partyId:string;name:string;summary:AccountSummary};

/** Every account that has records, payments or cancelled balances; the largest balance first. */
export function accountList(overview:FinancialOverview,payments:readonly AccountPayment[],cancelled:readonly CancelledOpeningBalance[]):AccountRow[]{
  const rows:AccountRow[]=[];
  for(const party of overview.parties){
    const mine=(value:{partyType:FinancialPartyType;partyId:string})=>value.partyType===party.type&&value.partyId===party.id;
    const targets=overview.targets.filter(mine),own=payments.filter(mine),gone=cancelled.filter(mine);
    if(!targets.length&&!own.length&&!gone.length)continue;
    rows.push({partyType:party.type,partyId:party.id,name:party.name,summary:summarizeAccount(targets,own,gone)});
  }
  return rows.sort((a,b)=>b.summary.balanceUsd-a.summary.balanceUsd||a.name.localeCompare(b.name));
}

export type AccountTotals={receivableUsd:number;payableUsd:number;customerCreditUsd:number;supplierCreditUsd:number;customerAccounts:number;supplierAccounts:number};

/** The list's headline figures: customer and supplier money kept apart, never netted together. */
export function accountTotals(rows:readonly AccountRow[]):AccountTotals{
  let receivable=0,payable=0,customerCredit=0,supplierCredit=0,customers=0,suppliers=0;
  for(const row of rows){
    if(row.partyType==='customer'){receivable+=cents(row.summary.balanceUsd);customerCredit+=cents(row.summary.creditUsd);customers+=1;}
    else{payable+=cents(row.summary.balanceUsd);supplierCredit+=cents(row.summary.creditUsd);suppliers+=1;}
  }
  return {receivableUsd:receivable/100,payableUsd:payable/100,customerCreditUsd:customerCredit/100,supplierCreditUsd:supplierCredit/100,customerAccounts:customers,supplierAccounts:suppliers};
}

export type AccountActivityEvent=
  | {kind:'record';date:string;target:FinancialTarget}
  | {kind:'payment';date:string;payment:AccountPayment}
  | {kind:'paymentCancelled';date:string;payment:AccountPayment}
  | {kind:'applied';date:string;payment:AccountPayment;amountUsd:number;references:string[]}
  | {kind:'openingCancelled';date:string;opening:CancelledOpeningBalance};

/** A dated account timeline built only from real records, payments and cancellations; newest first. */
export function accountActivity(targets:readonly FinancialTarget[],payments:readonly AccountPayment[],cancelled:readonly CancelledOpeningBalance[]):AccountActivityEvent[]{
  const events:AccountActivityEvent[]=[];
  for(const target of targets)events.push({kind:'record',date:target.recordDate.slice(0,10),target});
  for(const payment of payments){
    events.push({kind:'payment',date:payment.paymentDate,payment});
    if(payment.status==='Cancelled'&&payment.cancelledAt)events.push({kind:'paymentCancelled',date:payment.cancelledAt.slice(0,10),payment});
    // Amounts applied after the payment was recorded (DEC-485), one event per application.
    const later=new Map<string,{cents:number;references:string[]}>();
    for(const line of payment.allocations){
      if(!line.createdAt||line.createdAt===payment.createdAt)continue;
      const group=later.get(line.createdAt)??{cents:0,references:[]};
      group.cents+=cents(line.amountUsd);group.references.push(line.reference);later.set(line.createdAt,group);
    }
    for(const [createdAt,group] of later)events.push({kind:'applied',date:createdAt.slice(0,10),payment,amountUsd:group.cents/100,references:group.references});
  }
  for(const opening of cancelled)events.push({kind:'openingCancelled',date:opening.cancelledAt.slice(0,10),opening});
  const rank:Record<AccountActivityEvent['kind'],number>={openingCancelled:0,paymentCancelled:1,applied:2,payment:3,record:4};
  return events.sort((a,b)=>b.date.localeCompare(a.date)||rank[a.kind]-rank[b.kind]);
}
