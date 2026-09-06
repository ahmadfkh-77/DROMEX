import {describe,expect,it} from 'vitest';

import {emptyPaymentStatusCounts,type PaymentStatus,type ProjectFinancialSummary,type ProjectMoneyBlock} from '../src/domain/financials';
import {
  billingPeriodText,
  exclusionPhrase,
  formatMoney,
  formatQuantity,
  isProjectFinanciallyEmpty,
  presentStatuses,
  statusGloss,
  statusTone,
} from '../src/ui/screens/projectFinancialReviewPresentation';

const at=<T,>(items:T[],index:number):T=>{const value=items[index];if(value===undefined)throw new Error(`No item at ${index}`);return value;};

function block(overrides:Partial<ProjectMoneyBlock>={}):ProjectMoneyBlock{
  return {billedUsd:0,paidUsd:0,outstandingUsd:0,overpaidUsd:0,recordCount:0,statusCounts:emptyPaymentStatusCounts(),firstRecordDate:null,lastRecordDate:null,excludedCancelled:0,excludedUnpriced:0,targets:[],...overrides};
}
function summary(overrides:Partial<ProjectFinancialSummary>={}):ProjectFinancialSummary{
  return {projectId:'project_1',revenue:block(),supplierPayables:block(),fuel:{litres:0,costUsd:0,unpricedLitres:0,fillCount:0},uncosted:[],...overrides};
}

describe('project financial review presentation',()=>{
  describe('formatMoney',()=>{
    it('always shows two decimals and groups thousands',()=>{
      expect(formatMoney(0)).toBe('$0.00');
      expect(formatMoney(7.5)).toBe('$7.50');
      expect(formatMoney(1240)).toBe('$1,240.00');
      expect(formatMoney(1234567.89)).toBe('$1,234,567.89');
    });

    it('does not move a cent while grouping',()=>{
      // The domain totals in cents and divides by 100, so every value reaching this is already
      // exact to two decimals. Grouping must be presentation only.
      expect(formatMoney(0.01)).toBe('$0.01');
      expect(formatMoney(0.99)).toBe('$0.99');
      expect(formatMoney(999.99)).toBe('$999.99');
      expect(formatMoney(1000)).toBe('$1,000.00');
      expect(formatMoney(100000.05)).toBe('$100,000.05');
    });

    it('never renders a negative zero',()=>{
      expect(formatMoney(-0)).toBe('$0.00');
      expect(formatMoney(-0.001)).toBe('$0.00');
    });
  });

  describe('formatQuantity',()=>{
    it('keeps whole numbers whole and settles the rest at three decimals',()=>{
      expect(formatQuantity(12)).toBe('12');
      expect(formatQuantity(120.5)).toBe('120.5');
      expect(formatQuantity(1.23456)).toBe('1.235');
    });

    it('groups thousands and carries no currency mark',()=>{
      expect(formatQuantity(12500)).toBe('12,500');
      expect(formatQuantity(12500.25)).toBe('12,500.25');
      expect(formatQuantity(1000)).not.toContain('$');
    });
  });

  describe('status presentation',()=>{
    it('maps every status to a semantic tone, and never leaves unpriced looking like a failure',()=>{
      expect(statusTone('Paid')).toBe('success');
      expect(statusTone('Unpaid')).toBe('danger');
      expect(statusTone('Partially Paid')).toBe('warning');
      expect(statusTone('Overpaid')).toBe('warning');
      expect(statusTone('No Payment Due')).toBe('neutral');
      expect(statusTone('Unpriced')).toBe('warning');
    });

    it('explains only the statuses a reader cannot infer',()=>{
      expect(statusGloss('No Payment Due')).toContain('$0.00');
      expect(statusGloss('Overpaid')).toContain('more than the amount billed');
      expect(statusGloss('Unpriced')).toContain('no money value');
      expect(statusGloss('Paid')).toBeNull();
      expect(statusGloss('Unpaid')).toBeNull();
      expect(statusGloss('Partially Paid')).toBeNull();
    });

    it('omits statuses with no records so the strip never shows a wall of zeros',()=>{
      const counts=emptyPaymentStatusCounts();
      counts.Paid=3;counts['No Payment Due']=1;
      const present=presentStatuses(counts);
      expect(present).toHaveLength(2);
      expect(present.map(entry=>entry.status)).toEqual(['Paid','No Payment Due']);
      expect(at(present,0).count).toBe(3);
    });

    it('leads with what still needs money moved',()=>{
      const counts=emptyPaymentStatusCounts();
      counts.Paid=5;counts.Unpaid=1;counts['Partially Paid']=2;counts.Overpaid=1;
      expect(presentStatuses(counts).map(entry=>entry.status)).toEqual(['Unpaid','Partially Paid','Overpaid','Paid']);
    });

    it('returns nothing at all when the block has no records',()=>{
      expect(presentStatuses(emptyPaymentStatusCounts())).toEqual([]);
    });

    it('covers every status the domain can produce',()=>{
      const every:PaymentStatus[]=['Unpriced','No Payment Due','Unpaid','Partially Paid','Paid','Overpaid'];
      const counts=emptyPaymentStatusCounts();
      for(const status of every)counts[status]=1;
      expect(presentStatuses(counts)).toHaveLength(every.length);
    });
  });

  describe('exclusionPhrase',()=>{
    it('names cancelled and unpriced records separately with correct plurals',()=>{
      expect(exclusionPhrase({excludedCancelled:1,excludedUnpriced:0},'load','loads')).toBe('1 cancelled load');
      expect(exclusionPhrase({excludedCancelled:0,excludedUnpriced:3},'load','loads')).toBe('3 unpriced loads');
      expect(exclusionPhrase({excludedCancelled:2,excludedUnpriced:1},'delivery','deliveries')).toBe('2 cancelled deliveries and 1 unpriced delivery');
    });

    it('is absent when nothing was held out of the totals',()=>{
      expect(exclusionPhrase({excludedCancelled:0,excludedUnpriced:0},'load','loads')).toBeNull();
    });
  });

  describe('billingPeriodText',()=>{
    it('reports a single day, a range, or nothing recorded',()=>{
      expect(billingPeriodText({firstRecordDate:'2026-03-01',lastRecordDate:'2026-03-01'})).toBe('Billing recorded on 2026-03-01');
      expect(billingPeriodText({firstRecordDate:'2026-03-01',lastRecordDate:'2026-04-20'})).toBe('Billing recorded 2026-03-01 to 2026-04-20');
      expect(billingPeriodText({firstRecordDate:null,lastRecordDate:null})).toBe('No billing recorded yet');
    });
  });

  describe('isProjectFinanciallyEmpty',()=>{
    it('is true only when nothing at all was recorded',()=>{
      expect(isProjectFinanciallyEmpty(summary())).toBe(true);
    });

    it('is false when any one of the three sections has something',()=>{
      expect(isProjectFinanciallyEmpty(summary({revenue:block({recordCount:1})}))).toBe(false);
      expect(isProjectFinanciallyEmpty(summary({supplierPayables:block({recordCount:1})}))).toBe(false);
      expect(isProjectFinanciallyEmpty(summary({fuel:{litres:20,costUsd:0,unpricedLitres:20,fillCount:1}}))).toBe(false);
      expect(isProjectFinanciallyEmpty(summary({uncosted:[{source:'Wall materials',label:'Ready mix',quantity:12,unit:'m3'}]}))).toBe(false);
    });

    it('is false for a project whose only records were excluded from the totals',()=>{
      // A project with nothing but cancelled or unpriced records has not recorded nothing: the
      // consolidated empty state would hide the exclusion strips that explain where they went.
      expect(isProjectFinanciallyEmpty(summary({revenue:block({excludedCancelled:2})}))).toBe(false);
      expect(isProjectFinanciallyEmpty(summary({revenue:block({excludedUnpriced:1})}))).toBe(false);
      expect(isProjectFinanciallyEmpty(summary({supplierPayables:block({excludedUnpriced:4})}))).toBe(false);
    });
  });
});
