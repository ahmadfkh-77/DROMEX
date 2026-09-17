import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks, following fuel-destination-ui.test.ts: the project has no React Native
// renderer in its test stack, so these read component source to pin wording, accessibility, touch
// targets, reduced motion, and the no-zero rule. Behaviour is covered by the domain and repository tests.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

describe('Wall Construction UI contract',()=>{
  const screen=source('src/ui/screens/WallConstructionScreen.tsx');
  const form=source('src/ui/components/WallConsumptionForm.tsx');
  const area=source('src/ui/components/WallAreaCalculator.tsx');
  const purpose=source('src/ui/components/ConcretePurposeField.tsx');
  const history=source('src/ui/components/WallConsumptionHistory.tsx');

  it('offers the optional covered-area calculator only for Stone and Ready Mix',()=>{
    expect(form).toContain('supportsCoveredArea(');
    expect(form).toContain('<WallAreaCalculator');
    expect(area).toContain('Add covered wall area');
    expect(area).toContain('parseWallAreaInput(');
    for(const label of ['Gross area','Openings','Net covered area'])expect(area).toContain(label);
    expect(area).toMatch(/Covered area never changes the consumed quantity/);
  });

  it('adds a focused new-purpose form that selects the saved purpose',()=>{
    expect(purpose).toContain('Add new purpose');
    expect(purpose).toContain('<Modal');
    expect(purpose).toContain('validateNewPurposeLabel(');
    expect(purpose).toMatch(/onSelect\(\s*\{kind:'custom',id:created\.id\}\s*\)/);
    expect(purpose).toContain('Save Purpose');
  });

  it('opens a correction from history with a required reason and a distinct, non-destructive action',()=>{
    expect(history).toContain('Correct This Record');
    expect(history).not.toMatch(/tone="danger"/);
    expect(form).toContain('Correction reason *');
    expect(form).toContain('Save Correction');
    expect(form).toContain('Discard Correction');
    expect(history).toContain('correctionHistory');
  });

  it('never shows a missing area or ingredient as zero',()=>{
    expect(history).toContain('formatWallArea(');
    expect(history).toContain('describeWallConsumptionQuantity(');
    expect(screen).not.toMatch(/value\.cementBags\?\?0,0\)\} cement bags/);
  });

  it('keeps touch targets, accessibility state, and reduced motion',()=>{
    for(const file of [area,history,purpose])expect(file).toMatch(/minHeight:(4[4-9]|[5-9]\d)/);
    expect(history).toContain('accessibilityState={{expanded');
    for(const file of [area,history])expect(file).toContain('useReducedMotion');
    expect(form).toContain('accessibilityLiveRegion="polite"');
  });

  it('adds a linked Wall Construction section to the Daily Report editor and both exports',()=>{
    const reports=source('src/ui/screens/ReportsScreen.tsx');
    expect(reports).toMatch(/<LedgerSection number="08" title="Wall Construction"/);
    expect(reports).toMatch(/<LedgerSection number="09" title="Site Notes"/);
    expect(reports).toMatch(/<LedgerSection number="13" title="PDF Headers"/);
    expect(reports).toContain('of 11</Text>');
    expect(reports.match(/repository\.listLinkedWallWork\(project\.id,\s*report\.workDate\)/g)).toHaveLength(2);
    expect(reports).toMatch(/exportAndShareProjectReport\([^;]*,includePrices,wallWork\)/);
    expect(reports).toMatch(/exportAndShareDailyReportWorkbook\([^;]*onProgress:setExportProgress\},wallWork\)/);
    // Missing area renders through the shared domain formatter ("Area not recorded"), never a zero.
    expect(reports).toContain('formatWallArea(null)');
  });

  it('uses no em-dash in new wall-construction copy',()=>{
    for(const file of [form,area,purpose,history])expect(file).not.toContain('—');
  });
});
