export type FinancialPartyType='customer'|'supplier';
export type FinancialTargetType='load'|'quarryPurchase'|'openingBalance'|'fuelDelivery';
export type PaymentStatus='Unpriced'|'No Payment Due'|'Unpaid'|'Partially Paid'|'Paid'|'Overpaid';
export type FinancialParty={id:string;name:string;type:FinancialPartyType};
export type PaymentEntry={id:string;targetType:FinancialTargetType;targetId:string;amountUsd:number;paymentDate:string;status:'Active'|'Cancelled';cancellationReason:string|null;cancelledAt:string|null;createdAt:string};
export type FinancialTarget={id:string;type:FinancialTargetType;partyId:string;partyName:string;partyType:FinancialPartyType;reference:string;recordDate:string;projectId?:string|null;projectName?:string|null;projectStatus?:string|null;itemName?:string|null;quantity?:number|null;unitSymbol?:string|null;totalUsd:number;paidUsd:number;remainingUsd:number;overpaidUsd:number;status:PaymentStatus;payments:PaymentEntry[]};
export type FinancialOverview={parties:FinancialParty[];targets:FinancialTarget[]};
// A project's money is reported as three sections that never share a total: what the customer was
// billed, what suppliers billed us, and what the project consumed. Combining them would produce a
// figure that reads as profit while omitting labour, equipment and overhead, none of which DROMEX
// tracks (SRS 3.2), so no net or margin is derived anywhere.
export type ProjectMoneyBlock={billedUsd:number;paidUsd:number;outstandingUsd:number;overpaidUsd:number;recordCount:number;statusCounts:Record<PaymentStatus,number>;firstRecordDate:string|null;lastRecordDate:string|null;excludedCancelled:number;excludedUnpriced:number;targets:FinancialTarget[]};
// Quantities the project recorded that carry no price anywhere in the product (DEC-155). They are
// reported beside the costs but never as money, and never as a zero cost.
export type UncostedQuantity={source:'Wall materials'|'Pavement'|'Waste dumps';label:string;quantity:number;unit:string};
export type ProjectFuelCost={litres:number;costUsd:number;unpricedLitres:number;fillCount:number};
export type ProjectFinancialSummary={projectId:string;revenue:ProjectMoneyBlock;supplierPayables:ProjectMoneyBlock;fuel:ProjectFuelCost;uncosted:UncostedQuantity[]};
export type OpeningBalanceDraft={partyType:FinancialPartyType;partyId:string;amountUsd:string;asOfDate:string;reference:string;notes:string};
export type PaymentDraft={targetType:FinancialTargetType;targetId:string;amountUsd:string;paymentDate:string};

export function localFinancialDate(date=new Date()):string{return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function validDate(value:string):boolean{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));return localFinancialDate(date)===value;}
export const emptyOpeningBalanceDraft:OpeningBalanceDraft={partyType:'customer',partyId:'',amountUsd:'',asOfDate:localFinancialDate(),reference:'',notes:''};
export function paymentStatus(totalCents:number,paidCents:number):PaymentStatus{if(paidCents>totalCents)return 'Overpaid';if(totalCents===0)return 'No Payment Due';if(paidCents===0)return 'Unpaid';if(paidCents<totalCents)return 'Partially Paid';return 'Paid';}
export const emptyPaymentStatusCounts=():Record<PaymentStatus,number>=>({Unpriced:0,'No Payment Due':0,Unpaid:0,'Partially Paid':0,Paid:0,Overpaid:0});
// One money block: the caller supplies already-filtered targets plus the counts of records
// deliberately kept out of the money totals. Totals accumulate in cents so a long record list cannot
// drift by fractions of a cent.
export function summarizeMoneyBlock(targets:FinancialTarget[],excluded:{cancelled:number;unpriced:number}):ProjectMoneyBlock{
  const statusCounts=emptyPaymentStatusCounts();let billed=0,paid=0,outstanding=0,overpaid=0,firstRecordDate:string|null=null,lastRecordDate:string|null=null;
  for(const target of targets){
    statusCounts[target.status]+=1;
    billed+=Math.round(target.totalUsd*100);paid+=Math.round(target.paidUsd*100);outstanding+=Math.round(target.remainingUsd*100);overpaid+=Math.round(target.overpaidUsd*100);
    const date=target.recordDate.slice(0,10);
    if(!firstRecordDate||date<firstRecordDate)firstRecordDate=date;
    if(!lastRecordDate||date>lastRecordDate)lastRecordDate=date;
  }
  return{billedUsd:billed/100,paidUsd:paid/100,outstandingUsd:outstanding/100,overpaidUsd:overpaid/100,recordCount:targets.length,statusCounts,firstRecordDate,lastRecordDate,excludedCancelled:excluded.cancelled,excludedUnpriced:excluded.unpriced,targets};
}
// Records still owing money, most owed first — what a financial review should lead with.
export function projectAttentionTargets(targets:FinancialTarget[]):FinancialTarget[]{return targets.filter(target=>target.remainingUsd>0).sort((a,b)=>b.remainingUsd-a.remainingUsd);}
// Every payment event across a project's records, newest first, each keeping the record it belongs to.
export function projectPaymentEvents(targets:FinancialTarget[]):{target:FinancialTarget;payment:PaymentEntry}[]{
  return targets.flatMap(target=>target.payments.map(payment=>({target,payment}))).sort((a,b)=>b.payment.paymentDate.localeCompare(a.payment.paymentDate)||b.payment.createdAt.localeCompare(a.payment.createdAt));
}
export type SupplierPayableGroup={supplier:string;billed:number;outstanding:number;deliveries:number;materials:{key:string;name:string;unit:string;quantity:number;billed:number;deliveries:number}[]};
// Groups priced supplier deliveries by supplier and then by material+unit. Unlike units are never
// merged, matching the Delivery Summary rule.
export function groupSupplierTargets(targets:FinancialTarget[]):SupplierPayableGroup[]{
  const suppliers=new Map<string,SupplierPayableGroup&{materialIndex:Map<string,SupplierPayableGroup['materials'][number]>}>();
  for(const target of targets){
    const name=target.partyName;
    let group=suppliers.get(name);
    if(!group){group={supplier:name,billed:0,outstanding:0,deliveries:0,materials:[],materialIndex:new Map()};suppliers.set(name,group);}
    group.billed+=target.totalUsd;group.outstanding+=target.remainingUsd;group.deliveries+=1;
    const unit=target.unitSymbol??'';const label=target.itemName??'Unspecified material';const key=`${label}|${unit}`;
    const material=group.materialIndex.get(key)??{key,name:label,unit,quantity:0,billed:0,deliveries:0};
    material.quantity+=target.quantity??0;material.billed+=target.totalUsd;material.deliveries+=1;
    group.materialIndex.set(key,material);
  }
  return [...suppliers.values()].sort((a,b)=>b.billed-a.billed||a.supplier.localeCompare(b.supplier)).map(group=>({
    supplier:group.supplier,billed:Number(group.billed.toFixed(2)),outstanding:Number(group.outstanding.toFixed(2)),deliveries:group.deliveries,
    materials:[...group.materialIndex.values()].map(material=>({...material,quantity:Number(material.quantity.toFixed(3)),billed:Number(material.billed.toFixed(2))})).sort((a,b)=>a.name.localeCompare(b.name)||a.unit.localeCompare(b.unit)),
  }));
}

export function validateOpeningBalance(draft:OpeningBalanceDraft,parties:FinancialParty[]):string[]{const issues:string[]=[];if(!parties.some((p)=>p.id===draft.partyId&&p.type===draft.partyType))issues.push(`Select a ${draft.partyType}.`);const amountText=draft.amountUsd.trim().replace(',','.');const amount=Number(amountText);if(!/^\d+(\.\d{1,2})?$/.test(amountText)||!Number.isFinite(amount)||amount<=0)issues.push('Opening balance amount must be greater than zero with no more than two decimals.');if(!validDate(draft.asOfDate)||draft.asOfDate>localFinancialDate())issues.push('As-of date must be today or an earlier valid date.');return issues;}
export function validatePayment(draft:PaymentDraft,target:FinancialTarget|null):string[]{const issues:string[]=[];if(!target||target.id!==draft.targetId||target.type!==draft.targetType)issues.push('Select a financial record.');const amountText=draft.amountUsd.trim().replace(',','.');const amount=Number(amountText);if(!/^\d+(\.\d{1,2})?$/.test(amountText)||!Number.isFinite(amount)||amount<=0)issues.push('Payment amount must be greater than zero with no more than two decimals.');else if(target&&Math.round(amount*100)>Math.round(target.remainingUsd*100))issues.push('Payment cannot exceed the remaining balance.');if(!validDate(draft.paymentDate)||draft.paymentDate>localFinancialDate())issues.push('Payment date must be today or an earlier valid date.');return issues;}
