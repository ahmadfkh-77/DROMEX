import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract for the redesigned Project Financial Review. No React Native renderer is available,
// so these pin structure and the rule that the screen adds nothing up itself: every money figure comes
// from the ProjectFinancialSummary and the presentation helpers, which have their own tests.
const screen=readFileSync(join(__dirname,'..','src/ui/screens/ProjectFinancialReviewScreen.tsx'),'utf8');
const style=(name:string)=>new RegExp(`\\b${name}: \\{([^}]*)\\}`).exec(screen)?.[1]??'';

describe('Project Financial Review layout',()=>{
  it('shows the three money directions as separate collapsible cards, closed by default, headline visible',()=>{
    for(const title of ['title="Customer Revenue"','title="Supplier Payables"','title="Project Costs"'])expect(screen).toContain(title);
    expect(screen).toMatch(/useState<Set<string>>\(\(\) => new Set\(\)\)/);
    const section=screen.slice(screen.indexOf('function SectionCard'),screen.indexOf('function MoneyTile'));
    expect(section).toContain('accessibilityState={{ expanded: open }}');
    expect(section).toContain('<Toggle open={open} />');
    expect(section).toContain('{headlineValue}');
    expect(screen).not.toContain('function LedgerFolder');
  });
  it('uses + to open and × to close everywhere something expands',()=>{
    const toggle=screen.slice(screen.indexOf('function Toggle'));
    expect(toggle).toContain("open ? '×' : '+'");
    expect(screen.match(/<Toggle open=\{open\} \/>/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it('gives Billed and Paid their own quiet coloured boxes',()=>{
    expect(style('tileBilled')).toMatch(/backgroundColor: '#[0-9A-F]{6}'/);
    expect(style('tilePaid')).toMatch(/backgroundColor: '#[0-9A-F]{6}'/);
    expect(style('tileBilled')).not.toEqual(style('tilePaid'));
  });
  it('redesigns each supplier as its own collapsible card with billed, paid and outstanding',()=>{
    const supplier=screen.slice(screen.indexOf('function SupplierCard'),screen.indexOf('function EmptyExpectation'));
    expect(supplier).toContain('accessibilityState={{ expanded: open }}');
    for(const role of ['role="billed"','role="paid"','role="outstanding"'])expect(supplier).toContain(role);
    expect(supplier).toContain('group.materials.map(');
  });
  it('drops coloured side stripes and ordinal section numbers',()=>{
    expect(screen).not.toMatch(/borderLeftWidth: 3/);
    expect(screen).not.toMatch(/number="0\d"/);
  });
  it('adds nothing up itself',()=>{
    expect(screen).not.toMatch(/\.reduce\(/);
    expect(screen).not.toMatch(/Usd\s*[+-]\s*[a-z]/);
  });
});
