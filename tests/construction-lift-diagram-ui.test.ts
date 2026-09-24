import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

/**
 * Phase 4 UI contracts. There is no React Native renderer in this test stack, so where a behaviour
 * cannot be exercised directly these read component source to pin structure, wiring and wording.
 * The behaviour itself -- every coordinate conversion, clamp, nudge, reset, validation message and
 * drawn region -- is covered for real by tests/construction-lift-diagram.test.ts and
 * tests/construction-lift-drag.test.ts against the pure presentation functions those components call.
 * A contract test here is therefore evidence of wiring, never of calculation.
 */
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');
const exists=(path:string)=>existsSync(join(__dirname,'..',path));

const LIFT_VIEW='src/ui/components/ConstructionLiftDiagramView.tsx';
const STACK_VIEW='src/ui/components/ConstructionLiftStackDiagramView.tsx';
const CONTROLS='src/ui/components/StonePlacementControls.tsx';
const DIAGRAM_SCREEN='src/ui/screens/FoundationDiagramScreen.tsx';

describe('Phase 4 components exist and add no dependency',()=>{
  it('registers every new diagram component and screen',()=>{
    for(const path of [LIFT_VIEW,STACK_VIEW,CONTROLS,DIAGRAM_SCREEN,'src/domain/constructionLiftDiagram.ts'])expect(exists(path)).toBe(true);
  });

  it('draws with the react-native-svg and PanResponder the app already uses, adding no new package',()=>{
    const before=JSON.parse(source('package.json')) as {dependencies:Record<string,string>};
    expect(before.dependencies['react-native-svg']).toBeTruthy();
    expect(Object.keys(before.dependencies).some(name=>/gesture|reanimated|d3|victory|chart/i.test(name))).toBe(false);
    expect(source(LIFT_VIEW)).toContain('PanResponder');
  });

  it('never redraws a domain calculation of its own inside a component',()=>{
    for(const path of [LIFT_VIEW,STACK_VIEW,CONTROLS,DIAGRAM_SCREEN]){
      const text=source(path);
      expect(text).not.toContain('bottomThicknessM+');
      expect(text).not.toContain('grossVolumeM3=');
    }
  });
});

describe('Simple and Detailed dragging are wired to the tested pure functions',()=>{
  const view=source(LIFT_VIEW);

  it('claims a gesture only through the shared threshold/hit-test rules',()=>{
    expect(view).toContain('shouldClaimDragGesture');
    expect(view).toContain('stoneTouchesRegion');
    expect(view).toContain('onMoveShouldSetPanResponder');
  });

  it('converts touches through the diagram coordinate space rather than guessing at pixels',()=>{
    expect(view).toContain('viewBoxPointFromTouch');
    expect(view).toContain('liftStonePositionFromViewBoxPoint');
    expect(view).toContain('liftStoneOffsetsFromViewBoxPoint');
  });

  it('remeasures the rendered size so a screen size change keeps the drag accurate',()=>{
    expect(view).toContain('onLayout');
  });

  it('previews the drag live and only reports a committed placement on release',()=>{
    expect(view).toContain('onPanResponderRelease');
    expect(view).toMatch(/onPlacementChange|onPositionChange/);
  });

  it('shows the schematic disclosure in Simple mode and the plane in Detailed mode',()=>{
    expect(view).toContain('LIFT_DIAGRAM_PLANE_LABEL');
    expect(source('src/domain/constructionLiftDiagram.ts')).toContain('Schematic placement — not to scale');
  });

  it('gives visible feedback while a region is selected or being dragged',()=>{
    expect(view).toMatch(/dragging|selected/);
  });
});

describe('Dragging is never the only way to place Stone',()=>{
  const controls=source(CONTROLS);

  it('offers nudge in all four directions, plus a reset',()=>{
    for(const direction of ['left','right','up','down'])expect(controls).toContain(`'${direction}'`);
    expect(controls).toMatch(/Reset to Centre|Reset Position/);
    expect(controls).toContain('nudgeLiftStonePosition');
    expect(controls).toContain('nudgeLiftStoneOffsets');
  });

  it('keeps typed numeric offsets in Detailed mode, including the transverse axis the drawing cannot show',()=>{
    expect(controls).toContain('longitudinalOffsetM');
    expect(controls).toContain('verticalOffsetM');
    expect(controls).toContain('transverseOffsetM');
    expect(controls).toContain('validateLiftStoneOffsets');
  });

  it('describes the current placement and the step size to a screen reader',()=>{
    expect(controls).toContain('describeStonePlacement');
    expect(controls).toContain('accessibilityLabel');
    expect(controls).toContain('accessibilityRole="button"');
  });

  it('uses touch targets large enough to hit on a phone',()=>{
    expect(controls).toMatch(/minHeight:4[4-9]|minHeight:5\d/);
    expect(controls).toMatch(/minWidth:4[4-9]|minWidth:5\d/);
  });

  it('reports a typed offset that would leave the lift instead of silently clamping it',()=>{
    expect(controls).toMatch(/Feedback kind="error"|issues/);
  });
});

describe('Diagrams are placed on the right screens, at the right size',()=>{
  it('puts a compact summary diagram and a View Foundation Diagram action on Foundation Overview',()=>{
    const overview=source('src/ui/screens/FoundationOverviewScreen.tsx');
    expect(overview).toContain('ConstructionLiftStackDiagramView');
    expect(overview).toContain('View Foundation Diagram');
    expect(overview).toContain('compact');
  });

  it('keeps the lifts list to a compact status indicator, never a full diagram per row',()=>{
    const list=source('src/ui/screens/ConstructionLiftsListScreen.tsx');
    expect(list).not.toContain('ConstructionLiftStackDiagramView');
    expect(list).not.toContain('ConstructionLiftDiagramView');
    expect(list).toContain('LiftStatusPill');
  });

  it('shows the selected lift with drag controls in the Stone editor',()=>{
    const stone=source('src/ui/screens/StoneLiftEditorScreen.tsx');
    expect(stone).toContain('ConstructionLiftDiagramView');
    expect(stone).toContain('StonePlacementControls');
    expect(stone).toMatch(/draggable/);
  });

  it('shows the same lift in the Concrete editor, with its concrete state and no dragging',()=>{
    const concrete=source('src/ui/screens/ConcreteMatrixEditorScreen.tsx');
    expect(concrete).toContain('ConstructionLiftDiagramView');
    expect(concrete).not.toContain('StonePlacementControls');
    expect(concrete).toMatch(/draggable=\{false\}|draggable={false}/);
  });

  it('shows the full ordered diagram and legend on Foundation Summary',()=>{
    const summary=source('src/ui/screens/FoundationSummaryScreen.tsx');
    expect(summary).toContain('ConstructionLiftStackDiagramView');
    expect(summary).not.toContain('compact={true}');
  });

  it('shows a combined foundation and wall schematic on Wall Overview',()=>{
    const wall=source('src/ui/screens/WallOverviewScreen.tsx');
    expect(wall).toContain('buildCombinedConstructionLiftDiagram');
  });

  it('keeps History to a static representation with no interactive dragging',()=>{
    const history=source('src/ui/screens/HistoryAndCorrectionsScreen.tsx');
    expect(history).not.toContain('StonePlacementControls');
    expect(history).not.toMatch(/draggable=\{true\}|draggable\s/);
  });

  it('adds no diagram to unrelated screens',()=>{
    for(const path of ['src/ui/screens/FoundationGeometryScreen.tsx','src/ui/screens/FoundationCuringScreen.tsx','src/ui/screens/WallLinkOrCreateScreen.tsx']){
      expect(source(path)).not.toContain('ConstructionLiftDiagramView');
    }
  });
});

describe('Navigation stays complete and honest',()=>{
  const navigator=source('src/ui/screens/FoundationConstructionNavigator.tsx');

  it('registers the foundation diagram route and reaches it from the overview',()=>{
    expect(navigator).toContain('FoundationDiagramScreen');
    expect(navigator).toContain("kind:'diagram'");
    expect(source('src/ui/screens/FoundationOverviewScreen.tsx')).toContain('onOpenDiagram');
  });

  it('returns the diagram screen to where it was opened from, not to a dead end',()=>{
    // DEC-469 replaced the hardcoded parent with a navigation stack, so Back retraces the real path.
    // The stack rules themselves are unit-tested in tests/phase6-device-fixes.test.ts.
    expect(navigator).toMatch(/view\.kind==='diagram'[\s\S]{0,400}onBack=\{goBack\}/);
    expect(navigator).toContain('foundationViewStack');
  });

  it('never routes to a screen that was deleted in Phase 3',()=>{
    for(const path of ['src/ui/screens/FoundationConstructionNavigator.tsx','src/ui/DromexApp.tsx','src/ui/screens/WallConstructionScreen.tsx']){
      expect(source(path)).not.toContain('FoundationWorkspaceScreen');
      expect(source(path)).not.toContain('FoundationStageStepper');
    }
  });

  it('keeps the wall parent context separate from the foundation when opening a lift diagram',()=>{
    expect(navigator).toContain("parentType==='wall'");
  });
});

describe('Existing behaviour the diagrams must not remove',()=>{
  it('keeps curing informational and non-blocking',()=>{
    const curing=source('src/ui/screens/FoundationCuringScreen.tsx');
    expect(curing).not.toContain('disabled={!cured');
    const overview=source('src/ui/screens/FoundationOverviewScreen.tsx');
    expect(overview).toContain('onOpenWall');
  });

  it('keeps the legacy composite stage visible and labelled, not redrawn as lifts',()=>{
    expect(source('src/domain/constructionLiftDiagram.ts')).toContain('legacyStage');
    const summary=source('src/ui/screens/FoundationSummaryScreen.tsx');
    expect(summary).toMatch(/legacyStage|legacy/i);
  });

  it('keeps the old single-core foundation diagram for legacy records',()=>{
    expect(exists('src/ui/components/FoundationDiagramView.tsx')).toBe(true);
    expect(exists('src/domain/wallFoundationDiagram.ts')).toBe(true);
  });

  it('respects the reduced-motion preference the app already honours elsewhere',()=>{
    expect(source(LIFT_VIEW)).toContain('AccessibilityInfo');
  });

  it('warns before leaving the Stone editor with an unsaved placement',()=>{
    const stone=source('src/ui/screens/StoneLiftEditorScreen.tsx');
    expect(stone).toContain('Alert.alert');
    expect(stone).toContain('Discard unsaved changes?');
    expect(stone).toContain('setDirty(true)');
  });

  it('saves a dragged placement only through the screen\'s own save action',()=>{
    const stone=source('src/ui/screens/StoneLiftEditorScreen.tsx');
    // The saved draft carries this screen's own placement state, not the last loaded copy, so a drag
    // reaches the database only through the Save action.
    expect(stone).toMatch(/saveStonePhase\([\s\S]{0,400}position,offsets/);
    expect(stone).toContain('onPlacementChange={placement=>{setPosition(placement.position);setOffsets(placement.offsets);setDirty(true);}}');
  });
});
