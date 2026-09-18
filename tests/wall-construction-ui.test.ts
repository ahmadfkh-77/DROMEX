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

  it('DEC-464: stages the foundation and curing as tracked information, never a lock on wall work',()=>{
    const curing=source('src/ui/components/FoundationCuringPanel.tsx');
    expect(curing).toContain('Confirm Foundation Is Cured');
    expect(curing).toContain('inspected and is ready');
    expect(curing).not.toMatch(/Approved|Certified|certif/i);
    expect(curing).not.toContain('locked until');
    const geometry=source('src/ui/components/FoundationGeometryForm.tsx');
    expect(geometry).toContain('validateFoundationDraft(');
    expect(geometry).toContain('calculateFoundationVolume(');
    expect(geometry).toContain('Manual quantity override');
  });

  it('DEC-464/466: gates wall work only on a recorded foundation, and shows a non-blocking curing notice rather than hiding anything',()=>{
    const screen3=source('src/ui/screens/WallConstructionScreen.tsx');
    const overview=source('src/ui/screens/FoundationOverviewScreen.tsx');
    expect(screen3).not.toContain('<WallBaseWorkflow');
    expect(existsSync(join(__dirname,'..','src/ui/components/WallBaseWorkflow.tsx'))).toBe(false);
    // DEC-463/464/466. The only thing ever hidden for is a missing foundation; curing is a warning shown
    // on the overview, never a lock on any other screen.
    expect(overview).toContain('CURING_WARNING_TITLE');
    expect(overview).toContain('CURING_WARNING_BODY');
    expect(overview).not.toMatch(/locked until|Wall construction is locked/);
    expect(overview).toContain('curingConfirmed');
  });

  it('DEC-464: Project -> Construction Section -> Foundation -> Wall directory, with inline section/foundation creation',()=>{
    const screen3=source('src/ui/screens/WallConstructionScreen.tsx');
    expect(screen3).toContain('listConstructionSections(');
    expect(screen3).toContain('createConstructionSection(');
    expect(screen3).toContain('listFoundations(');
    expect(screen3).toContain('+ New Construction Section');
    expect(screen3).toContain('+ New Foundation In This Section');
    // Legacy walls (no foundation concept) keep their own untouched workflow.
    expect(screen3).toContain('Legacy walls');
    expect(screen3).toContain('LegacyWallsPanel');
  });

  it('DEC-466: opening a foundation reaches a separated-screen navigator, not the old single-page stepper',()=>{
    const screen3=source('src/ui/screens/WallConstructionScreen.tsx');
    expect(existsSync(join(__dirname,'..','src/ui/screens/FoundationWorkspaceScreen.tsx'))).toBe(false);
    expect(existsSync(join(__dirname,'..','src/ui/components/FoundationStageStepper.tsx'))).toBe(false);
    expect(screen3).not.toContain('FoundationWorkspaceScreen');
    expect(screen3).toContain('<FoundationConstructionNavigator');
    const overview=source('src/ui/screens/FoundationOverviewScreen.tsx');
    for(const action of ['Edit Geometry','Cyclopean Lifts','Foundation Summary','Curing','History'])expect(overview).toContain(action);
    expect(overview).not.toContain('<FoundationGeometryForm'); // summaries only, no forms on the overview itself
  });

  it('DEC-464: one active wall per foundation, selectable in every curing status, with cross-project/section refusal handled by the repository',()=>{
    const repo=source('src/data/repositories/SqliteWallRepository.ts');
    expect(repo).toContain('walls.foundation_id');
    expect(repo).toContain('already has a wall linked to it');
    expect(repo).toContain('different project');
    const migrations=source('src/data/database/migrations.ts');
    expect(migrations).toContain('idx_walls_foundation');
  });

  it('Checkpoint 5: the Stone core supports real touch dragging in Simple mode, with nudge/reset as an accessible alternative',()=>{
    const diagramView=source('src/ui/components/FoundationDiagramView.tsx');
    expect(diagramView).toContain('PanResponder');
    expect(diagramView).toContain('onPanResponderMove');
    expect(diagramView).toContain('onPanResponderRelease');
    expect(diagramView).toContain('stoneCorePositionFromViewBoxPoint');
    expect(diagramView).toContain('viewBoxPointFromTouch');
    const card=source('src/ui/components/FoundationCompositionCard.tsx');
    expect(card).toContain('draggable={stoneCoreMode');
    expect(card).toContain('onDragPosition');
    expect(card).toContain('Reset to Centre');
    expect(card).toContain('NudgeButton'); // typed/keyboard-safe alternative to the drag gesture
  });

  it('uses no em-dash in new wall-construction copy',()=>{
    for(const file of [form,volume,purpose,history])expect(file).not.toContain('—');
  });
});
