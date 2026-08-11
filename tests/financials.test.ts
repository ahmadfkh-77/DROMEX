import {describe,expect,it} from 'vitest';
import {paymentStatus,validateOpeningBalance,validatePayment,type FinancialTarget} from '../src/domain/financials';

const target:FinancialTarget={id:'load_1',type:'load',partyId:'customer_1',partyName:'Customer',partyType:'customer',reference:'L-1',recordDate:'2026-08-11',totalUsd:100,paidUsd:40,remainingUsd:60,overpaidUsd:0,status:'Partially Paid',payments:[]};

describe('payments and balances',()=>{
  it('derives each financial status from cents',()=>{expect(paymentStatus(10000,0)).toBe('Unpaid');expect(paymentStatus(10000,4000)).toBe('Partially Paid');expect(paymentStatus(10000,10000)).toBe('Paid');expect(paymentStatus(10000,11000)).toBe('Overpaid');expect(paymentStatus(0,0)).toBe('No Payment Due');});
  it('accepts a partial payment and blocks an excessive payment',()=>{expect(validatePayment({targetType:'load',targetId:'load_1',amountUsd:'60',paymentDate:'2026-08-11'},target)).toEqual([]);expect(validatePayment({targetType:'load',targetId:'load_1',amountUsd:'60.01',paymentDate:'2026-08-11'},target)).toContain('Payment cannot exceed the remaining balance.');});
  it('requires a positive opening balance and matching party',()=>{const parties=[{id:'customer_1',name:'Customer',type:'customer' as const}];expect(validateOpeningBalance({partyType:'customer',partyId:'customer_1',amountUsd:'500',asOfDate:'2026-08-11',reference:'Book 1',notes:''},parties)).toEqual([]);expect(validateOpeningBalance({partyType:'supplier',partyId:'customer_1',amountUsd:'0',asOfDate:'2026-08-11',reference:'',notes:''},parties)).toEqual(expect.arrayContaining(['Select a supplier.','Opening balance amount must be greater than zero with no more than two decimals.']));});
});
