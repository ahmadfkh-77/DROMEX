import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks for the Project Totals screen (DEC-481, redesigned by DEC-487), following the
// established pattern: no React Native renderer is available, so these pin structure, wording and the
// rule that the screen performs no arithmetic of its own. Calculations are covered by the domain and
// repository suites.
const read=(path:string)=>existsSync(join(__dirname,'..',path))?readFileSync(join(__dirname,'..',path),'utf8'):'';

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
  // DEC-487: the project's materials use the shared Totals explorer (one summary band per level and one
  // ruled list, not a card per item); the fuel and wall/foundation sections stay as DEC-481 defined them.
  const screen=read('src/ui/screens/ProjectTotalsScreen.tsx');
  const explorer=read('src/ui/components/totals/TotalsExplorer.tsx');
  const parts=read('src/ui/components/totals/TotalsParts.tsx');
  const presentation=read('src/ui/totalsPresentation.ts');
  it('computes nothing itself: every figure comes from the domain helpers',()=>{
    for(const helper of ['buildMaterialTree(','treeTotals(','unitDifferences(','countCompanyFilters('])expect(explorer).toContain(helper);
    for(const helper of ['summarizeFuel(','summarizeConstruction('])expect(screen).toContain(helper);
    for(const source of [screen,explorer,parts]){
      expect(source).not.toMatch(/\.reduce\(/);
      expect(source).not.toMatch(/quantity\s*[+-]\s*[a-z]/i);
    }
  });
  it('runs the project through the shared explorer with the project fixed, so a document is the same everywhere',()=>{
    expect(screen).toContain("scope={{kind:'project',projectId:project.id,projectName:project.name}}");
    expect(explorer).toContain("scope.kind==='project'?material.projects[0]");
  });
  it('shows Delivered and Used as separate labelled columns, per unit, with Not recorded where missing',()=>{
    expect(parts).toContain('>Delivered<');
    expect(parts).toContain('>Used<');
    expect(presentation).toContain("'Not recorded'");
    expect(explorer).toContain('Delivered minus recorded use');
    expect(explorer).toMatch(/not an inventory balance/i);
    expect(parts).toMatch(/fontVariant:\['tabular-nums'\]/);
  });
  it('tells Delivered and Used apart by a quiet tint as well as by their written labels',()=>{
    expect(parts).toMatch(/deliveredCell:\{backgroundColor:'#[0-9A-F]{6}'/);
    expect(parts).toMatch(/usedCell:\{backgroundColor:'#[0-9A-F]{6}'/);
  });
  it('lists suppliers, then the company’s own deliveries, and never splits use by supplier',()=>{
    expect(explorer).toContain('Suppliers first, then the company’s own loads, which are not a supplier.');
    expect(explorer).toMatch(/Use is not recorded per supplier/);
  });
  it('replaces the wall of item cards with one ruled ledger per level',()=>{
    expect(parts).toMatch(/ledger:\{[^}]*borderWidth:1/);
    expect(parts).toContain('rowRule');
    expect(screen).not.toContain('styles.itemCard');
  });
  it('names the period beside the totals',()=>{
    expect(explorer).toContain('rangeLabel');
    expect(explorer).toContain('Covering');
  });
  it('keeps the filters behind one closed-by-default control, including series and document status',()=>{
    for(const label of ['label="From"','label="To"','label="Material / item"','label="Supplier"','label="Unit"','label="Company-load number series"','label="Document status"'])expect(explorer).toContain(label);
    expect(explorer).toMatch(/\[filtersOpen,setFiltersOpen\]=useState\(false\)/);
    expect(explorer).toContain('accessibilityState={{expanded:filtersOpen}}');
  });
  it('separates fuel types and construction sources and states why',()=>{
    expect(screen).toContain('Fuel used');
    expect(screen).toContain('fuelTypeLabels');
    expect(screen).toContain('constructionSourceLabels');
    expect(screen).toMatch(/never added together/i);
  });
  it('drills down to original records and handles loading, error and empty states',()=>{
    expect(explorer).toContain('listRecords(');
    expect(explorer).toContain('listUsageRecords(');
    expect(explorer).toContain('ActivityIndicator');
    expect(explorer).toContain('<EmptyState');
    expect(explorer).toContain('Try again');
  });
});
