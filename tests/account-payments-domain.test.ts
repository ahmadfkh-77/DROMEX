import {describe,expect,it} from 'vitest';

import {
  accountActivity,accountList,accountTotals,balanceAfterPayment,emptyAccountPaymentDraft,planAllocation,planApplyUnallocated,summarizeAccount,validateAccountPaymentDraft,validateOpeningBalanceCancellation,
  type AccountPayment,type AccountPaymentDraft,type CancelledOpeningBalance,
} from '../src/domain/accountPayments';
import type {FinancialOverview,FinancialTarget} from '../src/domain/financials';

/**
 * Account payments (DEC-482). One real payment is recorded once. It may be applied to the account as
 * a whole (unallocated), to the oldest unpaid records first, or to records the owner selects. A
 * record never receives more than it still owes, a payment is never allocated beyond its own amount,
 * and whatever is not allocated stays visible as unallocated.
 */
const target=(id:string,recordDate:string,totalUsd:number,paidUsd=0,patch:Partial<FinancialTarget>={}):FinancialTarget=>({
  id,type:'quarryPurchase',partyId:'sup_a',partyName:'Alpha Quarry',partyType:'supplier',reference:`QP-${id}`,recordDate,totalUsd,paidUsd,
  remainingUsd:Math.max(0,totalUsd-paidUsd),overpaidUsd:Math.max(0,paidUsd-totalUsd),status:paidUsd===0?'Unpaid':paidUsd<totalUsd?'Partially Paid':'Paid',payments:[],...patch,
});
const open=[target('b','2026-08-10',400),target('a','2026-08-01',300,100),target('c','2026-08-20',500)];
const draft=(patch:Partial<AccountPaymentDraft>):AccountPaymentDraft=>({...emptyAccountPaymentDraft('supplier','sup_a'),paymentDate:'2026-09-01',...patch});

describe('planning how a payment is applied',()=>{
  it('overall balance keeps the whole payment unallocated',()=>{
    const plan=planAllocation(draft({mode:'overall',amountUsd:'1000'}),open);
    expect(plan).toMatchObject({amountCents:100000,allocations:[],allocatedCents:0,unallocatedCents:100000,issues:[]});
  });
  it('oldest unpaid records first, never more than each still owes, remainder shown as unallocated',()=>{
    const plan=planAllocation(draft({mode:'oldest',amountUsd:'650'}),open);
    expect(plan.allocations.map(line=>[line.targetId,line.amountCents])).toEqual([['a',20000],['b',40000],['c',5000]]);
    expect(plan.unallocatedCents).toBe(0);
    const more=planAllocation(draft({mode:'oldest',amountUsd:'1500'}),open);
    expect(more.allocations.map(line=>line.amountCents)).toEqual([20000,40000,50000]);
    expect(more.unallocatedCents).toBe(40000);
  });
  it('selected records take exact full or partial amounts',()=>{
    const plan=planAllocation(draft({mode:'selected',amountUsd:'600',selections:[{targetType:'quarryPurchase',targetId:'c',amountUsd:'500'},{targetType:'quarryPurchase',targetId:'a',amountUsd:'50'}]}),open);
    expect(plan.issues).toEqual([]);
    expect(plan.allocations.map(line=>[line.targetId,line.amountCents])).toEqual([['c',50000],['a',5000]]);
    expect(plan.unallocatedCents).toBe(5000);
  });
  it('refuses to mark more than a record still owes',()=>{
    const plan=planAllocation(draft({mode:'selected',amountUsd:'1000',selections:[{targetType:'quarryPurchase',targetId:'a',amountUsd:'250'}]}),open);
    expect(plan.issues).toContain('QP-a still owes $200.00; it cannot receive $250.00.');
  });
  it('refuses to allocate more than the payment amount',()=>{
    const plan=planAllocation(draft({mode:'selected',amountUsd:'100',selections:[{targetType:'quarryPurchase',targetId:'b',amountUsd:'80'},{targetType:'quarryPurchase',targetId:'c',amountUsd:'40'}]}),open);
    expect(plan.issues).toContain('The selected amounts ($120.00) are more than the payment ($100.00).');
  });
  it('requires at least one selected record, and refuses records that are not open on this account',()=>{
    expect(planAllocation(draft({mode:'selected',amountUsd:'10'}),open).issues).toContain('Select at least one record and enter an amount for it.');
    expect(planAllocation(draft({mode:'selected',amountUsd:'10',selections:[{targetType:'quarryPurchase',targetId:'zzz',amountUsd:'10'}]}),open).issues).toContain('A selected record is no longer open on this account.');
  });
  it('a single-record payment must fit that record exactly, leaving nothing unallocated',()=>{
    const ok=planAllocation(draft({mode:'record',amountUsd:'200',selections:[{targetType:'quarryPurchase',targetId:'a',amountUsd:'200'}]}),open);
    expect(ok).toMatchObject({issues:[],unallocatedCents:0});
    expect(planAllocation(draft({mode:'record',amountUsd:'300',selections:[{targetType:'quarryPurchase',targetId:'a',amountUsd:'300'}]}),open).issues).toContain('QP-a still owes $200.00; it cannot receive $300.00.');
  });
  it('works in whole cents so repeated partial amounts never drift',()=>{
    const plan=planAllocation(draft({mode:'oldest',amountUsd:'0.30'}),[target('x','2026-08-01',0.1),target('y','2026-08-02',0.2)]);
    expect(plan.allocations.map(line=>line.amountCents)).toEqual([10,20]);
    expect(plan.unallocatedCents).toBe(0);
  });
});

describe('validating a payment draft',()=>{
  it('requires a positive amount with at most two decimals, a valid past date and a method',()=>{
    expect(validateAccountPaymentDraft(draft({amountUsd:'0'}))).toContain('Payment amount must be greater than zero with no more than two decimals.');
    expect(validateAccountPaymentDraft(draft({amountUsd:'12.345'}))).toContain('Payment amount must be greater than zero with no more than two decimals.');
    expect(validateAccountPaymentDraft(draft({amountUsd:'10',paymentDate:'2999-01-01'}))).toContain('Payment date must be today or an earlier valid date.');
    expect(validateAccountPaymentDraft(draft({amountUsd:'10'}))).toEqual([]);
  });
});

describe('cancelling an Open Balance',()=>{
  it('requires a reason',()=>{
    expect(validateOpeningBalanceCancellation('   ',0)).toContain('Enter the reason for cancelling this Open Balance.');
  });
  it('is blocked while the balance still has active payments',()=>{
    expect(validateOpeningBalanceCancellation('Entered twice',2)).toContain('This Open Balance has 2 active payments. Cancel those payments first, then cancel the balance.');
    expect(validateOpeningBalanceCancellation('Entered twice',0)).toEqual([]);
  });
});

const payment=(patch:Partial<AccountPayment>):AccountPayment=>({id:'pay_1',partyType:'supplier',partyId:'sup_a',partyName:'Alpha Quarry',amountUsd:500,paymentDate:'2026-09-02',method:'cash',reference:null,note:null,mode:'overall',status:'Active',cancellationReason:null,cancelledAt:null,createdAt:'2026-09-02T10:00:00Z',allocations:[],allocatedUsd:0,unallocatedUsd:500,...patch});
const cancelledOpening:CancelledOpeningBalance={id:'ob_1',partyType:'supplier',partyId:'sup_a',partyName:'Alpha Quarry',reference:'Paper book p.4',amountUsd:900,asOfDate:'2026-07-01',cancellationReason:'Entered twice',cancelledAt:'2026-09-03T09:00:00Z',statusBeforeCancellation:'Unpaid'};

describe('account balance',()=>{
  it('keeps owed, paid, unallocated and remaining separate and never counts cancelled balances',()=>{
    const summary=summarizeAccount(open,[payment({})],[cancelledOpening]);
    expect(summary).toMatchObject({billedUsd:1200,recordPaidUsd:100,unallocatedUsd:500,paidUsd:600,outstandingRecordsUsd:1100,balanceUsd:600,creditUsd:0,openRecordCount:3,cancelledCount:1});
  });
  it('shows money paid beyond what is owed as credit, never as a negative balance',()=>{
    const summary=summarizeAccount([target('a','2026-08-01',100)],[payment({amountUsd:250,unallocatedUsd:250})],[]);
    expect(summary).toMatchObject({balanceUsd:0,creditUsd:150});
  });
  it('ignores cancelled payments',()=>{
    expect(summarizeAccount(open,[payment({status:'Cancelled'})],[]).unallocatedUsd).toBe(0);
  });
});

describe('applying an unallocated payment later',()=>{
  const unallocated=payment({amountUsd:1000,allocatedUsd:0,unallocatedUsd:1000});
  it('applies part or all of what is unallocated, oldest first, without touching the original payment',()=>{
    const plan=planApplyUnallocated(unallocated,{mode:'oldest',amountUsd:'650',selections:[]},open);
    expect(plan.issues).toEqual([]);
    expect(plan.allocations.map(line=>[line.targetId,line.amountCents])).toEqual([['a',20000],['b',40000],['c',5000]]);
  });
  it('applies exact amounts to selected records, full or partial',()=>{
    const plan=planApplyUnallocated(unallocated,{mode:'selected',amountUsd:'300',selections:[{targetType:'quarryPurchase',targetId:'b',amountUsd:'300'}]},open);
    expect(plan).toMatchObject({issues:[],allocatedCents:30000,unallocatedCents:0});
  });
  it('never applies more than is still unallocated, and never from a cancelled payment',()=>{
    expect(planApplyUnallocated(payment({amountUsd:1000,allocatedUsd:900,unallocatedUsd:100}),{mode:'oldest',amountUsd:'150',selections:[]},open).issues).toContain('You can apply at most $100.00, the unallocated part of this payment.');
    expect(planApplyUnallocated(payment({status:'Cancelled'}),{mode:'oldest',amountUsd:'10',selections:[]},open).issues).toContain('A cancelled payment cannot be applied to records.');
    expect(planApplyUnallocated(payment({unallocatedUsd:0,allocatedUsd:500}),{mode:'oldest',amountUsd:'10',selections:[]},open).issues).toContain('Nothing is left unallocated on this payment.');
  });
  it('shows a later application in the account activity on the day it was applied',()=>{
    const later=payment({allocations:[{paymentEntryId:'pe',targetType:'quarryPurchase',targetId:'a',reference:'QP-a',amountUsd:50,status:'Active',createdAt:'2026-09-05T10:00:00Z'}],allocatedUsd:50,unallocatedUsd:450});
    const events=accountActivity([],[later],[]);
    expect(events[0]).toMatchObject({kind:'applied',date:'2026-09-05'});
  });
});

describe('preview after a payment',()=>{
  it('shows the balance and any credit the account would have once the payment is saved',()=>{
    const before=summarizeAccount(open,[],[]);
    expect(balanceAfterPayment(before,planAllocation(draft({mode:'oldest',amountUsd:'650'}),open))).toEqual({balanceUsd:450,creditUsd:0});
    expect(balanceAfterPayment(before,planAllocation(draft({mode:'overall',amountUsd:'1500'}),open))).toEqual({balanceUsd:0,creditUsd:400});
  });
});

describe('list totals',()=>{
  it('adds receivable and payable balances separately and never nets one against the other',()=>{
    const rows=[
      {partyType:'customer' as const,partyId:'c1',name:'A',summary:summarizeAccount([target('x','2026-08-01',100)],[],[])},
      {partyType:'customer' as const,partyId:'c2',name:'B',summary:summarizeAccount([target('y','2026-08-01',50.25)],[],[])},
      {partyType:'supplier' as const,partyId:'s1',name:'C',summary:summarizeAccount([target('z','2026-08-01',80)],[payment({amountUsd:100,unallocatedUsd:100})],[])},
    ];
    expect(accountTotals(rows)).toEqual({receivableUsd:150.25,payableUsd:0,customerCreditUsd:0,supplierCreditUsd:20,customerAccounts:2,supplierAccounts:1});
  });
});

describe('account list and activity',()=>{
  const overview:FinancialOverview={parties:[{id:'sup_a',name:'Alpha Quarry',type:'supplier'},{id:'sup_b',name:'Beta',type:'supplier'},{id:'cus_a',name:'شركة الطرق',type:'customer'}],targets:[...open,target('z','2026-08-05',50,0,{partyId:'cus_a',partyName:'شركة الطرق',partyType:'customer',type:'load',reference:'TX-9'})]};
  it('lists only accounts with records, payments or cancelled balances, largest balance first',()=>{
    const rows=accountList(overview,[payment({})],[cancelledOpening]);
    expect(rows.map(row=>row.name)).toEqual(['Alpha Quarry','شركة الطرق']);
    expect(rows[0]).toMatchObject({partyType:'supplier',partyId:'sup_a',summary:{balanceUsd:600,paidUsd:600,openRecordCount:3}});
  });
  it('builds a dated timeline from real records, payments and cancellations only',()=>{
    const events=accountActivity(open,[payment({allocations:[]})],[cancelledOpening]);
    expect(events[0]).toMatchObject({kind:'openingCancelled',date:'2026-09-03'});
    expect(events.map(event=>event.kind)).toEqual(['openingCancelled','payment','record','record','record']);
  });
});
