import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks, following wall-construction-ui.test.ts: no React Native renderer in this
// test stack, so these read component source to pin structure, wording, and behaviour that can be
// verified without one. Calculation/persistence behaviour is covered by the domain and repository tests.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');
const exists=(path:string)=>existsSync(join(__dirname,'..',path));

describe('Lift UI: route/screen registration',()=>{
  it('wires a Lift repository alongside the wall repository, all the way to the screen',()=>{
    const app=source('src/ui/DromexApp.tsx');
    expect(app).toContain('SqliteConstructionLiftRepository');
    expect(app).toContain('constructionLiftRepository');
    expect(app).toMatch(/<WallConstructionScreen[^;]*liftRepository=\{constructionLiftRepository\}/);
    const screen=source('src/ui/screens/WallConstructionScreen.tsx');
    expect(screen).toContain('liftRepository:ConstructionLiftRepository');
    expect(screen).toContain('<FoundationConstructionNavigator');
  });
  it('registers every dedicated screen file the approved architecture requires',()=>{
    for(const path of [
      'src/ui/screens/FoundationOverviewScreen.tsx','src/ui/screens/FoundationGeometryScreen.tsx',
      'src/ui/screens/ConstructionLiftsListScreen.tsx','src/ui/screens/StoneLiftEditorScreen.tsx',
      'src/ui/screens/ConcreteMatrixEditorScreen.tsx','src/ui/screens/FoundationSummaryScreen.tsx',
      'src/ui/screens/FoundationCuringScreen.tsx','src/ui/screens/WallOverviewScreen.tsx',
      'src/ui/screens/WallGeometryScreen.tsx','src/ui/screens/WallMaterialsScreen.tsx',
      'src/ui/screens/WallLinkOrCreateScreen.tsx','src/ui/screens/HistoryAndCorrectionsScreen.tsx',
      'src/ui/screens/FoundationConstructionNavigator.tsx',
    ])expect(exists(path)).toBe(true);
  });
});

describe('Construction Section -> Foundation navigation stays intact',()=>{
  it('the directory still lists sections and foundations and opens the new navigator',()=>{
    const screen=source('src/ui/screens/WallConstructionScreen.tsx');
    expect(screen).toContain('setOpenFoundationId');
    expect(screen).toMatch(/<FoundationConstructionNavigator repository=\{repository\} liftRepository=\{liftRepository\} foundationId=\{openFoundationId\}/);
  });
});

describe('Foundation Overview actions',()=>{
  const overview=source('src/ui/screens/FoundationOverviewScreen.tsx');
  it('shows summaries only, with one action per destination',()=>{
    for(const label of ['Edit Geometry','Lifts','Foundation Summary','Curing','History'])expect(overview).toContain(label);
    expect(overview).not.toContain('<LiftVolumeCalculator');
    expect(overview).not.toContain('<StoneLiftEditorScreen');
  });
  it('shows structural capacity via the shared reconciliation panel, not a duplicated calculation',()=>{
    expect(overview).toContain('<LiftReconciliationPanel');
    expect(overview).toContain('reconcileFoundation(');
  });
  it('shows an imported legacy composite stage honestly, without inventing lifts for it',()=>{
    expect(overview).toContain('getLegacyCompositeStage(');
    expect(overview).toContain('Imported legacy composite stage');
  });
});

describe('Wall Overview actions',()=>{
  const overview=source('src/ui/screens/WallOverviewScreen.tsx');
  it('shows summaries and separate navigation to Geometry, Lifts, Materials, and History',()=>{
    for(const label of ['Wall Geometry','Wall Lifts','Layers and Materials','History and Corrections'])expect(overview).toContain(label);
    expect(overview).toContain('reconcileWall(');
    expect(overview).toContain('<LiftReconciliationPanel');
  });
});

describe('Dedicated geometry screens never mix in material or lift calculators',()=>{
  it('Foundation Geometry has no Lift calculator or Stone/Concrete phase forms',()=>{
    const geometry=source('src/ui/screens/FoundationGeometryScreen.tsx');
    expect(geometry).toContain('<FoundationGeometryForm');
    expect(geometry).not.toContain('<LiftVolumeCalculator');
    expect(geometry).not.toContain('saveStonePhase');
    expect(geometry).not.toContain('saveConcreteMatrixPhase');
  });
  it('Wall Geometry has no Stone/Ready Mix entry form',()=>{
    const geometry=source('src/ui/screens/WallGeometryScreen.tsx');
    expect(geometry).not.toContain('<AppField');
    expect(geometry).not.toContain('saveStonePhase');
    expect(geometry).not.toContain('saveConcreteMatrixPhase');
  });
});

describe('Lifts list ordering and pending-concrete next action',()=>{
  const list=source('src/ui/screens/ConstructionLiftsListScreen.tsx');
  it('lists lifts through the repository, which orders them deterministically by sequence',()=>{
    expect(list).toContain('listLiftsForFoundation(');
    expect(list).toContain('listLiftsForWall(');
    const repo=source('src/data/repositories/SqliteConstructionLiftRepository.ts');
    expect(repo).toContain('orderLiftsBySequence(');
  });
  it('shows one clear primary action per lift, matching its honest status',()=>{
    expect(list).toContain('Record Stone Phase');
    expect(list).toContain('Continue to Concrete Matrix');
    expect(list).toContain('<LiftStatusPill');
  });
  it('reuses the shared calculation and status components rather than duplicating them',()=>{
    expect(list).toContain('<LiftVolumeCalculator');
    expect(list).toContain('deriveLiftStatus(');
  });
});

describe('Stone Lift Editor context and calculator autofill',()=>{
  const editor=source('src/ui/screens/StoneLiftEditorScreen.tsx');
  it('shows lift context and never shows a Ready Mix input',()=>{
    expect(editor).toContain('<ParentContextHeader');
    expect(editor).not.toContain('Final Ready Mix quantity');
    expect(editor).not.toContain('saveConcreteMatrixPhase');
    expect(editor).not.toContain('<ConcreteMatrixEditorScreen');
  });
  it('autofills the final quantity from the calculated Stone volume, keeping manual override honest',()=>{
    expect(editor).toContain('Use Calculated');
    expect(editor).toContain('setManualOverride(false)');
    expect(editor).toContain('setManualOverride(true)');
    expect(editor).toContain('Manual override');
  });
  it('offers Save and Continue to the concrete matrix only after saving',()=>{
    expect(editor).toContain('<SaveContinueFooter');
    expect(editor).toContain('Continue to Concrete Matrix');
    expect(editor).toContain('onContinueToConcrete');
  });
});

describe('Concrete Matrix Editor is linked to the exact lift and shows both calculation methods',()=>{
  const editor=source('src/ui/screens/ConcreteMatrixEditorScreen.tsx');
  it('is keyed by liftId, never by list position',()=>{
    expect(editor).toContain('liftId:string');
    expect(editor).toContain('saveConcreteMatrixPhase(liftId,');
  });
  it('offers both the estimated matrix requirement and the independent calculator',()=>{
    expect(editor).toContain('Use estimated matrix requirement');
    expect(editor).toContain('Calculate independently');
    expect(editor).toContain('<LiftVolumeCalculator');
  });
  it('always shows the estimated matrix requirement even when the independent method is used',()=>{
    expect(editor).toContain('estimatedConcreteMatrixVolume(');
    expect(editor).toMatch(/Stone[^=]*=\s*estimated matrix/);
  });
  it('shows variance without ever rejecting an actual quantity for differing from the estimate',()=>{
    expect(editor).toContain('<LiftVarianceRow');
    expect(editor).toContain('concreteMatrixVariance(');
  });
});

describe('Save and resume, unsaved-change protection, and validation persistence',()=>{
  it('warns with a native Alert before discarding unsaved Stone or Concrete phase changes',()=>{
    const stone=source('src/ui/screens/StoneLiftEditorScreen.tsx');
    const concrete=source('src/ui/screens/ConcreteMatrixEditorScreen.tsx');
    for(const file of [stone,concrete]){
      expect(file).toContain('Alert.alert');
      expect(file).toContain('Discard unsaved changes?');
      expect(file).toContain('Keep Editing');
      expect(file).toMatch(/const\[dirty,setDirty\]=useState/);
    }
  });
  it('keeps field values in component state, never clearing a draft on a validation/save error',()=>{
    const stone=source('src/ui/screens/StoneLiftEditorScreen.tsx');
    // On failure the catch block only records the error message; it never resets quantity/geometry/notes state.
    expect(stone).toMatch(/catch\(cause\)\{setError\(/);
    expect(stone).not.toMatch(/catch\(cause\)\{[^}]*setQuantity\(''\)/);
  });
});

describe('Curing remains non-blocking',()=>{
  it('every other Foundation Overview action stays reachable regardless of curing status',()=>{
    const overview=source('src/ui/screens/FoundationOverviewScreen.tsx');
    const actionsBlock=overview.slice(overview.indexOf('<View style={styles.actions}>'),overview.indexOf('</View>\n  </View>;'));
    expect(actionsBlock).not.toContain('curingConfirmed');
    expect(actionsBlock).not.toContain('disabled=');
    for(const label of ['Edit Geometry','Lifts','Foundation Summary','Curing','History'])expect(actionsBlock).toContain(label);
  });
});

describe('Legacy wall access remains available',()=>{
  it('the legacy walls panel and its workflow are untouched',()=>{
    const screen=source('src/ui/screens/WallConstructionScreen.tsx');
    expect(screen).toContain('LegacyWallsPanel');
    expect(screen).toContain('Legacy walls');
  });
});

describe('Touch targets, keyboard-safe layout, and reduced motion',()=>{
  it('every new screen wraps content in the keyboard-safe AppPage',()=>{
    const navigator=source('src/ui/screens/FoundationConstructionNavigator.tsx');
    expect(navigator.match(/<AppPage keyboard>/g)?.length).toBeGreaterThanOrEqual(10);
  });
  it('shared interactive components keep comfortable touch targets',()=>{
    // SaveContinueFooter composes AppButton, whose own minHeight:48 (AppPrimitives.tsx) already guarantees the target size.
    expect(source('src/ui/components/SaveContinueFooter.tsx')).toContain('<AppButton');
    for(const path of ['src/ui/screens/ConstructionLiftsListScreen.tsx','src/ui/screens/StoneLiftEditorScreen.tsx'])
      expect(source(path)).toMatch(/minHeight:(4[4-9]|[5-9]\d)/);
  });
});

describe('History and Corrections is separate from every entry form',()=>{
  it('is its own screen, not mixed into the Stone/Concrete editors',()=>{
    const history=source('src/ui/screens/HistoryAndCorrectionsScreen.tsx');
    expect(history).toContain('correctionHistory');
    const stone=source('src/ui/screens/StoneLiftEditorScreen.tsx');
    const concrete=source('src/ui/screens/ConcreteMatrixEditorScreen.tsx');
    expect(stone).not.toContain('correctionHistory');
    expect(concrete).not.toContain('correctionHistory');
  });
});

describe('uses no em-dash in new wall-construction copy',()=>{
  it('checks every new screen and shared component',()=>{
    const paths=[
      'src/ui/components/LiftVolumeCalculator.tsx','src/ui/components/LiftStatusPill.tsx','src/ui/components/LiftVarianceRow.tsx',
      'src/ui/components/ParentContextHeader.tsx','src/ui/components/SaveContinueFooter.tsx','src/ui/components/LiftReconciliationPanel.tsx',
      'src/ui/screens/ConstructionLiftsListScreen.tsx','src/ui/screens/StoneLiftEditorScreen.tsx','src/ui/screens/ConcreteMatrixEditorScreen.tsx',
      'src/ui/screens/FoundationOverviewScreen.tsx','src/ui/screens/FoundationGeometryScreen.tsx','src/ui/screens/FoundationSummaryScreen.tsx',
      'src/ui/screens/FoundationCuringScreen.tsx','src/ui/screens/WallOverviewScreen.tsx','src/ui/screens/WallGeometryScreen.tsx',
      'src/ui/screens/WallMaterialsScreen.tsx','src/ui/screens/WallLinkOrCreateScreen.tsx','src/ui/screens/HistoryAndCorrectionsScreen.tsx',
    ];
    for(const path of paths)expect(source(path)).not.toContain('—');
  });
});
