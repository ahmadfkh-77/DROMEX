import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks for the Project Totals screen (DEC-481), following the established pattern:
// no React Native renderer is available, so these pin structure, wording and the rule that the screen
// performs no arithmetic of its own. Calculations are covered by project-totals-domain/-repository.
const read=(path:string)=>existsSync(join(__dirname,'..',path))?readFileSync(join(__dirname,'..',path),'utf8'):'';
const between=(source:string,start:string,end?:string)=>{const from=source.indexOf(start);if(from<0)return '';const to=end?source.indexOf(end,from+start.length):-1;return source.slice(from,to<0?undefined:to);};

describe('Project Totals navigation',()=>{
  it('is a destination inside each project',()=>{
    const command=read('src/ui/screens/ProjectCommandCenterScreen.tsx');
    expect(command).toContain('onTotals');
    expect(command).toMatch(/title="Totals"/);
    const app=read('src/ui/DromexApp.tsx');
    expect(app).toContain("screen==='projectTotals'");
    expect(app).toContain('SqliteProjectTotalsRepository');
  });
});

describe('Project Totals screen',()=>{
  const screen=read('src/ui/screens/ProjectTotalsScreen.tsx');
  const itemRow=between(screen,'function ItemRow','function SourceRow');
  it('computes nothing itself: every figure comes from the domain helpers',()=>{
    for(const helper of ['buildItemLedger(','splitItemSources(','summarizeFuel(','summarizeConstruction(','describeTotalsRange(','totalsFilterChoices(','validateTotalsFilters(','countActiveTotalsFilters('])expect(screen).toContain(helper);
    expect(screen).not.toMatch(/\.reduce\(/);
    expect(screen).not.toMatch(/quantity\s*[+-]\s*[a-z]/i);
  });
  it('shows each item with its whole-project Delivered and Used totals as separate columns, per unit',()=>{
    expect(itemRow).toContain('>Delivered<');
    expect(itemRow).toContain('>Used<');
    expect(itemRow).toMatch(/item\.units\.map\(/);
    expect(screen).toContain('Not recorded');
    expect(screen).toContain('Delivered minus recorded use');
    expect(screen).toMatch(/not an inventory balance/i);
    expect(screen).toMatch(/fontVariant:\['tabular-nums'\]/);
  });
  it('expands an item with + and collapses it with ×, labelled for assistive technology',()=>{
    expect(itemRow).toContain("open?'×':'+'");
    expect(itemRow).toContain('accessibilityState={{expanded:open}}');
    expect(itemRow).toContain('`${open?\'Hide\':\'Show\'} suppliers for ${item.itemName}`');
  });
  it('lists suppliers, then the company\'s own deliveries, and opens a focused supplier view',()=>{
    expect(itemRow).toContain('[...sources.suppliers,...(sources.company?[sources.company]:[])]');
    expect(itemRow).toContain('company={supplier===sources.company}');
    expect(screen).toMatch(/own loads/i);
    const sheet=between(screen,'function SupplierSheet','function RecordsSheet');
    expect(sheet).toContain('<FocusedSheet');
    expect(sheet).toContain('listContributingRecords(');
    expect(sheet).toContain('supplierKey:supplier.supplierKey');
    expect(sheet).toContain('source:supplier.source');
    expect(sheet).toMatch(/not recorded per supplier/i);
  });
  it('gives every item, fuel type and construction material its own bordered card',()=>{
    expect(screen).toMatch(/ledger\.map\(item=><View key=\{item\.itemKey\} style=\{styles\.itemCard\}>/);
    expect(screen).toMatch(/fuel\.map\(type=><View key=\{type\.fuelType\} style=\{styles\.itemCard\}>/);
    expect(screen).toMatch(/construction\.map\(group=><View key=\{`\$\{group\.materialKey\}-\$\{group\.unitKey\}`\} style=\{styles\.itemCard\}>/);
    expect(screen).toMatch(/itemCard:\{[^}]*borderWidth:1/);
  });
  it('tells Delivered and Used apart by a quiet tint as well as by their written labels',()=>{
    expect(itemRow).toContain('styles.tileDelivered');
    expect(itemRow).toContain('styles.tileUsed');
    expect(screen).toMatch(/tileDelivered:\{backgroundColor:'#[0-9A-F]{6}'/);
    expect(screen).toMatch(/tileUsed:\{backgroundColor:'#[0-9A-F]{6}'/);
  });
  it('explains an item with nothing delivered instead of showing an empty list',()=>{
    expect(itemRow).toContain('No deliveries recorded');
  });
  it('names the date range and the unit beside every total',()=>{
    expect(screen).toContain('rangeLabel');
    expect(screen).toMatch(/unitSymbol/);
  });
  it('keeps date, item, supplier, unit and delivered/used filters behind one closed-by-default control',()=>{
    for(const label of ['label="From"','label="To"','label="Item"','label="Supplier"','label="Unit"'])expect(screen).toContain(label);
    expect(screen).toMatch(/<SegmentedChoice[^>]*mode="tabs"/);
    expect(screen).toMatch(/\[filtersOpen,setFiltersOpen\]=useState\(false\)/);
    expect(screen).toContain('accessibilityState={{expanded:filtersOpen}}');
  });
  it('separates fuel types and construction sources and states why',()=>{
    expect(screen).toContain('Fuel used');
    expect(screen).toContain('fuelTypeLabels');
    expect(screen).toContain('constructionSourceLabels');
    expect(screen).toMatch(/never added together/i);
  });
  it('drills down to contributing records and handles loading, error and empty states',()=>{
    expect(screen).toContain('listContributingRecords(');
    expect(screen).toContain('ActivityIndicator');
    expect(screen).toContain('<EmptyState');
    expect(screen).toContain('Try again');
  });
});
