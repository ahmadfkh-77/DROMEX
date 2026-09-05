export type FinancialPartyType='customer'|'supplier';
export type FinancialTargetType='load'|'quarryPurchase'|'openingBalance'|'fuelDelivery';
export type PaymentStatus='Unpriced'|'No Payment Due'|'Unpaid'|'Partially Paid'|'Paid'|'Overpaid';
export type FinancialParty={id:string;name:string;type:FinancialPartyType};
export type PaymentEntry={id:string;targetType:FinancialTargetType;targetId:string;amountUsd:number;paymentDate:string;status:'Active'|'Cancelled';cancellationReason:string|null;cancelledAt:string|null;createdAt:string};
export type FinancialTarget={id:string;type:FinancialTargetType;partyId:string;partyName:string;partyType:FinancialPartyType;reference:string;recordDate:string;projectId?:string|null;projectName?:string|null;projectStatus?:string|null;itemName?:string|null;quantity?:number|null;unitSymbol?:string|null;totalUsd:number;paidUsd:number;remainingUsd:number;overpaidUsd:number;status:PaymentStatus;payments:PaymentEntry[]};
export type FinancialOverview={parties:FinancialParty[];targets:FinancialTarget[]};
export type ProjectFinancialSummary={projectId:string;billedUsd:number;paidUsd:number;outstandingUsd:number;overpaidUsd:number;recordCount:number;statusCounts:Record<PaymentStatus,number>;firstRecordDate:string|null;lastRecordDate:string|null;excludedCancelledLoads:number;excludedUnpricedLoads:number;targets:FinancialTarget[]};
export type OpeningBalanceDraft={partyType:FinancialPartyType;partyId:string;amountUsd:string;asOfDate:string;reference:string;notes:string};
export type PaymentDraft={targetType:FinancialTargetType;targetId:string;amountUsd:string;paymentDate:string};

export function localFinancialDate(date=new Date()):string{return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function validDate(value:string):boolean{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));return localFinancialDate(date)===value;}
export const emptyOpeningBalanceDraft:OpeningBalanceDraft={partyType:'customer',partyId:'',amountUsd:'',asOfDate:localFinancialDate(),reference:'',notes:''};
export function paymentStatus(totalCents:number,paidCents:number):PaymentStatus{if(paidCents>totalCents)return 'Overpaid';if(totalCents===0)return 'No Payment Due';if(paidCents===0)return 'Unpaid';if(paidCents<totalCents)return 'Partially Paid';return 'Paid';}
export const emptyPaymentStatusCounts=():Record<PaymentStatus,number>=>({Unpriced:0,'No Payment Due':0,Unpaid:0,'Partially Paid':0,Paid:0,Overpaid:0});
// Revenue-only project rollup: the caller supplies the project's already-filtered targets plus the
// counts of records deliberately kept out of the money totals. Totals accumulate in cents so a long
// record list cannot drift by fractions of a cent.
export function summarizeProjectFinancials(projectId:string,targets:FinancialTarget[],excluded:{cancelledLoads:number;unpricedLoads:number}):ProjectFinancialSummary{
  const statusCounts=emptyPaymentStatusCounts();let billed=0,paid=0,outstanding=0,overpaid=0,firstRecordDate:string|null=null,lastRecordDate:string|null=null;
  for(const target of targets){
    statusCounts[target.status]+=1;
    billed+=Math.round(target.totalUsd*100);paid+=Math.round(target.paidUsd*100);outstanding+=Math.round(target.remainingUsd*100);overpaid+=Math.round(target.overpaidUsd*100);
    const date=target.recordDate.slice(0,10);
    if(!firstRecordDate||date<firstRecordDate)firstRecordDate=date;
    if(!lastRecordDate||date>lastRecordDate)lastRecordDate=date;
  }
  return{projectId,billedUsd:billed/100,paidUsd:paid/100,outstandingUsd:outstanding/100,overpaidUsd:overpaid/100,recordCount:targets.length,statusCounts,firstRecordDate,lastRecordDate,excludedCancelledLoads:excluded.cancelledLoads,excludedUnpricedLoads:excluded.unpricedLoads,targets};
}
// Records still owing money, most owed first — what a financial review should lead with.
export function projectAttentionTargets(targets:FinancialTarget[]):FinancialTarget[]{return targets.filter(target=>target.remainingUsd>0).sort((a,b)=>b.remainingUsd-a.remainingUsd);}
// Every payment event across a project's records, newest first, each keeping the record it belongs to.
export function projectPaymentEvents(targets:FinancialTarget[]):{target:FinancialTarget;payment:PaymentEntry}[]{
  return targets.flatMap(target=>target.payments.map(payment=>({target,payment}))).sort((a,b)=>b.payment.paymentDate.localeCompare(a.payment.paymentDate)||b.payment.createdAt.localeCompare(a.payment.createdAt));
}
export function validateOpeningBalance(draft:OpeningBalanceDraft,parties:FinancialParty[]):string[]{const issues:string[]=[];if(!parties.some((p)=>p.id===draft.partyId&&p.type===draft.partyType))issues.push(`Select a ${draft.partyType}.`);const amountText=draft.amountUsd.trim().replace(',','.');const amount=Number(amountText);if(!/^\d+(\.\d{1,2})?$/.test(amountText)||!Number.isFinite(amount)||amount<=0)issues.push('Opening balance amount must be greater than zero with no more than two decimals.');if(!validDate(draft.asOfDate)||draft.asOfDate>localFinancialDate())issues.push('As-of date must be today or an earlier valid date.');return issues;}
export function validatePayment(draft:PaymentDraft,target:FinancialTarget|null):string[]{const issues:string[]=[];if(!target||target.id!==draft.targetId||target.type!==draft.targetType)issues.push('Select a financial record.');const amountText=draft.amountUsd.trim().replace(',','.');const amount=Number(amountText);if(!/^\d+(\.\d{1,2})?$/.test(amountText)||!Number.isFinite(amount)||amount<=0)issues.push('Payment amount must be greater than zero with no more than two decimals.');else if(target&&Math.round(amount*100)>Math.round(target.remainingUsd*100))issues.push('Payment cannot exceed the remaining balance.');if(!validDate(draft.paymentDate)||draft.paymentDate>localFinancialDate())issues.push('Payment date must be today or an earlier valid date.');return issues;}
