import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks, following fuel-destination-ui.test.ts: the project has no React Native
// renderer in its test stack, so these read component source to pin wording, accessibility, touch
// targets, reduced motion, and the no-zero rule. Behaviour is covered by the domain and repository tests.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

describe('Wall Construction UI contract',()=>{
  const screen=source('src/ui/screens/WallConstructionScreen.tsx');
  const form=source('src/ui/components/WallConsumptionForm.tsx');
  const volume=source('src/ui/components/WallVolumeCalculator.tsx');
  const purpose=source('src/ui/components/ConcretePurposeField.tsx');
  const history=source('src/ui/components/WallConsumptionHistory.tsx');

  it('replaces the covered-area calculator with a section 1 style volume calculator for Stone and Ready Mix',()=>{
    expect(existsSync(join(__dirname,'..','src/ui/components/WallAreaCalculator.tsx'))).toBe(false);
    expect(form).toContain('supportsVolumeCalculation(');
    expect(form).toContain('<WallVolumeCalculator');
    expect(volume).toContain('Calculate volume from wall dimensions');
    expect(volume).toContain('parseWallVolumeInput(');
    for(const label of ['Length (m) *','Height (m) *','Bottom thickness (m) *','Top thickness (m) *','Volume deductions (m³)','Gross volume','Deductions','Net volume'])expect(volume).toContain(label);
    for(const file of [form,volume,history])expect(file).not.toMatch(/covered|m²|Openings/i);
  });

  it('fills the consumed quantity from the calculated net volume and sets stone to m³',()=>{
    expect(form).toMatch(/onCalculated=\{/);
    expect(form).toContain("stoneUnit:'m3'");
    expect(volume).toContain('fills the consumed quantity');
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

  it('never shows a missing calculation or ingredient as zero',()=>{
    expect(history).toContain('formatVolumeCalculation(');
    expect(history).toContain('describeWallConsumptionQuantity(');
    expect(screen).not.toMatch(/value\.cementBags\?\?0,0\)\} cement bags/);
  });

  it('keeps touch targets, accessibility state, and reduced motion',()=>{
    for(const file of [volume,history,purpose])expect(file).toMatch(/minHeight:(4[4-9]|[5-9]\d)/);
    expect(history).toContain('accessibilityState={{expanded');
    for(const file of [volume,history])expect(file).toContain('useReducedMotion');
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
    expect(reports).toContain('formatVolumeCalculation(entry)');
    expect(reports).not.toContain('formatWallArea');
  });

  it('uses no em-dash in new wall-construction copy',()=>{
    for(const file of [form,volume,purpose,history])expect(file).not.toContain('—');
  });
});
