import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks: there is no React Native renderer in the test stack. The filtering itself is covered by customer-filter.test.ts.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

describe('customer filter screens',()=>{
  const explorer=source('src/ui/components/totals/TotalsExplorer.tsx');
  const loadTotals=source('src/ui/screens/CompanyLoadTotalsScreen.tsx');
  const picker=source('src/ui/components/totals/CustomerFilter.tsx');

  it('offers the filter in Company Totals, and in Project Totals only through the worth-showing rule',()=>{
    expect(explorer).toContain('customerFilterWorthShowing(scope.kind,');
    expect(explorer).toContain('<CustomerFilter choices={customerChoices} selected={filters.customerKeys}');
    expect(explorer).toContain('Supplier deliveries are hidden while a customer is chosen: they are not delivered to a customer.');
  });
  it('offers the filter in Company Load Totals',()=>{
    expect(loadTotals).toContain('<CustomerFilter choices={customerChoices} selected={filters.customerKeys}');
  });
  it('says which customers were applied on the PDF filter line',()=>{
    expect(explorer).toContain('customerFilterLabel(filters.customerKeys,customerChoices)');
    expect(loadTotals).toContain('customerFilterLabel(filters.customerKeys,customerChoices)');
  });
  it('lets several customers be ticked, keeps No customer / Internal reachable, and can be cleared',()=>{
    expect(picker).toContain('accessibilityRole="checkbox"');
    expect(picker).toContain('Own company projects and loads with no customer');
    expect(picker).toContain('Clear customers');
    expect(picker).toContain('None selected: every customer');
    expect(picker).toContain('Search customers');
  });
  it('resets the filter with the others and counts it as one active filter',()=>{
    expect(explorer).toContain('setFilters({...emptyCompanyTotalsFilters(),projectKey:fixedProject})');
  });
});
