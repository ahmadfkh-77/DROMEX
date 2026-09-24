import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract for the redesigned Payments & Balances (DEC-482 / DEC-483). No React Native renderer
// is available, so these pin structure, wording, accessible labels, and the rule that the screens add
// nothing up themselves: every figure comes from domain/accountPayments.ts or domain/financials.ts.
const read=(path:string)=>existsSync(join(__dirname,'..',path))?readFileSync(join(__dirname,'..',path),'utf8'):'';
const hub=read('src/ui/screens/FinancialsScreen.tsx');
const pay=read('src/ui/screens/finance/AddPaymentScreen.tsx');
const record=read('src/ui/screens/finance/FinanceRecordScreen.tsx');
const parts=read('src/ui/screens/finance/financeParts.tsx');
const all=[hub,pay,record,parts].join('\n');

describe('Payments & Balances structure',()=>{
  it('lists accounts from the domain with search and a customer/supplier filter',()=>{
    for(const helper of ['accountList(','accountTotals(','summarizeAccount(','accountActivity('])expect(hub).toContain(helper);
    expect(hub).toContain('accessibilityLabel="Search accounts"');
    expect(hub).toMatch(/<SegmentedChoice[^>]*label="Show"/);
  });
  it('shows each account row with balance, paid and open records, opening its detail',()=>{
    const row=hub.slice(hub.indexOf('function AccountRowCard'),hub.indexOf('function AccountDetail'));
    expect(row).toContain('summary.balanceUsd');
    expect(row).toContain('summary.paidUsd');
    expect(row).toContain('summary.openRecordCount');
    expect(row).toContain('accessibilityHint="Opens the account statement"');
  });
  it('gives the account detail one primary Add Payment action and the statement sections',()=>{
    const detail=hub.slice(hub.indexOf('function AccountDetail'));
    expect(detail.match(/label="Add Payment"/g)).toHaveLength(1);
    for(const title of ['title="Open records"','title="Payment history"','title="Cancelled balances"','title="Account activity"'])expect(detail).toContain(title);
  });
  it('explains all three ways to apply a payment before confirmation and previews the result',()=>{
    for(const mode of ["'overall'","'oldest'","'selected'"])expect(pay).toContain(`mode:${mode}`);
    expect(pay).toContain('accessibilityRole="radio"');
    expect(pay).toContain('planAllocation(');
    expect(pay).toContain('Unallocated');
    expect(pay).toContain('recordAccountPayment(');
    expect(pay).toMatch(/Save payment of \$\{formatMoney/);
  });
  it('lets one record be paid in full or in part, shows its payment history, and cancels an Open Balance with a reason',()=>{
    for(const label of ['Mark paid in full','Record partial payment','Payment history','Cancel this Open Balance','cancelOpeningBalance('])expect(record).toContain(label);
    expect(record).toMatch(/Reason for cancelling/);
  });
  it('lets an unallocated payment be applied to records later, oldest first or selected, with a preview',()=>{
    const apply=read('src/ui/screens/finance/ApplyUnallocatedScreen.tsx');
    expect(hub).toMatch(/payment\.unallocatedUsd>0[^\n]*Apply unallocated payment/);
    expect(hub).toContain("event.kind==='applied'");
    for(const text of ['planApplyUnallocated(','applyUnallocatedPayment(','accessibilityRole="radio"',"mode:'oldest'","mode:'selected'"])expect(apply).toContain(text);
    expect(apply).toMatch(/Apply \$\{formatMoney/);
    expect(apply).not.toMatch(/\.reduce\(/);
  });
  it('explains in Project Financial Review why project Paid can differ from the account total',()=>{
    const review=read('src/ui/screens/ProjectFinancialReviewScreen.tsx');
    expect(review).toMatch(/belong to no project/);
    expect(review).toMatch(/Payments & Balances/);
  });
  it('names every state in words, never by colour alone',()=>{
    for(const word of ["'Unpaid'","'Partially Paid'","'Paid'","'Cancelled'","'Unallocated'"])expect(all).toContain(word);
  });
  it('adds nothing up in the screens',()=>{
    expect(all).not.toMatch(/\.reduce\(/);
  });
});
