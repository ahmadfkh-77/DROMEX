import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks for the Project Totals screen (DEC-481), following the established pattern:
// no React Native renderer is available, so these pin structure, wording and the rule that the screen
// performs no arithmetic of its own. Calculations are covered by project-totals-domain/-repository.
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
  const screen=read('src/ui/screens/ProjectTotalsScreen.tsx');
  it('computes nothing itself: every figure comes from the domain helpers',()=>{
    for(const helper of ['buildItemLedger(','summarizeFuel(','summarizeConstruction(','describeTotalsRange(','totalsFilterChoices(','validateTotalsFilters('])expect(screen).toContain(helper);
    expect(screen).not.toMatch(/\.reduce\(/);
    expect(screen).not.toMatch(/quantity\s*[+-]\s*[a-z]/i);
  });
  it('keeps Delivered and Used as separate measures and says Not recorded instead of a false zero',()=>{
    expect(screen).toContain('Total delivered');
    expect(screen).toContain('Total used');
    expect(screen).toContain('Not recorded');
    expect(screen).toContain('Delivered minus recorded use');
    expect(screen).toMatch(/not an inventory balance/i);
  });
  it('names the date range and the unit beside every total',()=>{
    expect(screen).toContain('rangeLabel');
    expect(screen).toMatch(/unitSymbol/);
  });
  it('offers date, item, supplier, unit and delivered/used filters',()=>{
    for(const label of ['label="From"','label="To"','label="Item"','label="Supplier"','label="Unit"'])expect(screen).toContain(label);
    expect(screen).toMatch(/<SegmentedChoice[^>]*mode="tabs"/);
  });
  it('separates fuel types and construction sources and states why',()=>{
    expect(screen).toContain('Fuel used');
    expect(screen).toContain('fuelTypeLabels');
    expect(screen).toContain('constructionSourceLabels');
    expect(screen).toMatch(/never added together/i);
  });
  it('drills down to contributing records and handles loading, error and empty states',()=>{
    expect(screen).toContain('listContributingRecords(');
    expect(screen).toContain('<FocusedSheet');
    expect(screen).toContain('ActivityIndicator');
    expect(screen).toContain('<EmptyState');
    expect(screen).toContain('Try again');
  });
});
