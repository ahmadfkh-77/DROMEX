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

  it('renders the generated diagram natively from the same model as the PDF',()=>{
    const view=source('src/ui/components/WallDiagramView.tsx');
    expect(view).toContain("from 'react-native-svg'");
    expect(view).toContain('buildWallDiagram');
    expect(view).not.toContain('<Image');
    expect(view).not.toContain('http');
    expect(view).toContain('accessibilityLabel');
  });

  it('edits layers and construction phases with reorder, uniform thickness, and live totals',()=>{
    const editor=source('src/ui/components/WallLayersEditor.tsx');
    expect(editor).toContain('Layers and construction phases');
    expect(editor).toContain('validateWallLayers(');
    expect(editor).toContain('Same thickness top and bottom');
    expect(editor).toContain('Move up');
    expect(editor).toContain('Move down');
    expect(editor).toContain('Remove');
    expect(editor).toMatch(/minHeight:(4[4-9]|[5-9]\d)/);
    expect(editor).toContain('useReducedMotion');
    expect(editor).toContain('accessibilityLiveRegion');
    expect(editor).not.toContain('—');
    const screen2=source('src/ui/screens/WallConstructionScreen.tsx');
    expect(screen2).toContain('<WallDiagramView');
    expect(screen2).toContain('<WallLayersEditor');
    expect(screen2).toContain('saveLayers(');
  });

  it('stages the base and curing as tracked information, never a lock on wall work',()=>{
    const base=source('src/ui/components/WallBaseWorkflow.tsx');
    expect(base).toContain('A · Base and Wall Geometry');
    for(const stage of ['Base geometry','Base material and volume','Construction and curing','Wall geometry and layers'])expect(base).toContain(stage);
    expect(base).toContain('Confirm Base Is Cured');
    expect(base).toContain('inspected and is ready for wall work');
    expect(base).not.toMatch(/Approved|Certified|certif/i);
    // DEC-463. Curing is a non-blocking, warning-styled notice, never a lock on the wall sections.
    expect(base).not.toContain('Wall construction locked until base is cured');
    expect(base).toContain('CURING_WARNING_TITLE');
    expect(base).toContain('CURING_WARNING_BODY');
    expect(base).toContain('validateWallBase(');
    expect(base).toContain('calculateBaseVolume(');
    expect(base).toContain('Manual quantity override');
    expect(base).toContain('Base not recorded');
    expect(base).toMatch(/minHeight:(4[4-9]|[5-9]\d)/);
    expect(base).toContain('useReducedMotion');
    expect(base).toContain('accessibilityLiveRegion');
    expect(base).not.toContain('—');
  });

  it('gates the wall sections only on a recorded base, and shows a non-blocking curing notice rather than hiding anything',()=>{
    const screen3=source('src/ui/screens/WallConstructionScreen.tsx');
    expect(screen3).toContain('<WallBaseWorkflow');
    expect(screen3).toContain('stage.locked');
    expect(screen3).toContain('selected.stage.reason');
    // DEC-463. The wall sections are only ever hidden for a missing base; curing produces a warning, not a lock.
    expect(screen3).toContain('selected.stage.curingConfirmed');
    expect(screen3).toContain('selected.stage.warningTitle');
    expect(screen3).toContain('selected.stage.warningBody');
  });

  it('uses no em-dash in new wall-construction copy',()=>{
    for(const file of [form,volume,purpose,history])expect(file).not.toContain('—');
  });
});
