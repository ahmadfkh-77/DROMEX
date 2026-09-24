import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import {
  buildLiftDiagram,liftDragBounds,offsetTextMatchesValue,parseOffsetText,stoneLinearFraction,
  withPreviewedStone,CONCRETE_ESTIMATE_FILL,CONCRETE_POURED_FILL,CONCRETE_POURED_PATTERN_ID,
  CONCRETE_PATTERN_ID,STONE_FILL,STONE_PATTERN_ID,type LiftDiagramLift,
} from '../src/domain/constructionLiftDiagram';
import {liftHistoryEvents} from '../src/domain/constructionLiftReport';
import {backView,currentView,popToView,pushView,type FoundationView} from '../src/ui/navigation/foundationViewStack';
import type {ConstructionLift} from '../src/domain/wallConstructionLift';

/**
 * Phase 6 defect fixes, each found by the Owner on a physical device through Expo Go. The pure
 * seams are tested for real here; where a fix is only reachable through a React Native screen the
 * check reads component source and says so, because this test stack has no renderer.
 */
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

const lift=(overrides:Partial<LiftDiagramLift>={}):LiftDiagramLift=>({
  id:'lift-1',sequence:1,reference:'Lift 1',startElevationM:0,
  geometry:{lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},
  netLiftVolumeM3:9,status:'stone_placed',
  calculatedStoneVolumeM3:4.5,actualStoneQuantityM3:4.5,
  stoneGeometry:{lengthM:30,heightM:.4,bottomThicknessM:.375,topThicknessM:.375,deductionM3:0},
  estimatedConcreteM3:4.5,actualReadyMixM3:null,variance:null,
  position:{xNorm:.5,yNorm:.5},offsets:null,...overrides,
});

// Defect 3: half the lift volume must read as about half the drawing, not a tenth of it.
describe('defect 3: the Stone region is drawn in proportion to its volume',()=>{
  it('scales both dimensions so the drawn area matches the volume fraction',()=>{
    for(const ratio of [.25,.5,.75]){
      const value=lift({calculatedStoneVolumeM3:9*ratio,actualStoneQuantityM3:9*ratio});
      const bounds=liftDragBounds(value);
      const drawnArea=bounds.stoneWidthPx*bounds.stoneHeightPx;
      const boxArea=bounds.boxWidth*bounds.boxHeight;
      expect(drawnArea/boxArea).toBeCloseTo(ratio,1);
    }
  });

  it('draws a half-volume Stone far larger than the old fixed 32 percent width',()=>{
    const bounds=liftDragBounds(lift());
    expect(bounds.stoneWidthPx/bounds.boxWidth).toBeGreaterThan(.6);
    expect(bounds.stoneHeightPx/bounds.boxHeight).toBeGreaterThan(.6);
  });

  it('always leaves a visible concrete margin around the Stone, even at full volume',()=>{
    const bounds=liftDragBounds(lift({calculatedStoneVolumeM3:9,actualStoneQuantityM3:9}));
    expect(bounds.stoneWidthPx).toBeLessThan(bounds.boxWidth);
    expect(bounds.stoneHeightPx).toBeLessThan(bounds.boxHeight);
  });

  it('keeps a tiny Stone visible without letting it claim the envelope',()=>{
    const bounds=liftDragBounds(lift({calculatedStoneVolumeM3:.001,actualStoneQuantityM3:.001}));
    expect(bounds.stoneWidthPx).toBeGreaterThanOrEqual(9);
    expect(bounds.stoneWidthPx/bounds.boxWidth).toBeLessThan(.25);
  });

  it('exposes the same linear fraction the drawing uses',()=>{
    expect(stoneLinearFraction(lift())).toBeCloseTo(Math.sqrt(.5),6);
    expect(stoneLinearFraction(lift({calculatedStoneVolumeM3:0,actualStoneQuantityM3:0}))).toBe(0);
  });

  it('still keeps the drawn Stone inside the envelope at every extreme position',()=>{
    for(const position of [{xNorm:0,yNorm:0},{xNorm:1,yNorm:1}]){
      const diagram=buildLiftDiagram(lift({position}));
      const bounds=diagram.dragBounds;
      const stone=diagram.elements.find(element=>element.kind==='rect'&&element.fill===STONE_FILL) as {x:number;y:number;width:number;height:number};
      expect(stone.x).toBeGreaterThanOrEqual(bounds.boxLeft-.001);
      expect(stone.x+stone.width).toBeLessThanOrEqual(bounds.boxLeft+bounds.boxWidth+.001);
      expect(stone.y).toBeGreaterThanOrEqual(bounds.boxTop-.001);
      expect(stone.y+stone.height).toBeLessThanOrEqual(bounds.boxTop+bounds.boxHeight+.001);
    }
  });
});

// Defect 7: once concrete is poured the fill went solid, leaving colour as the only cue.
describe('defect 7: poured concrete keeps a pattern of its own',()=>{
  const poured=()=>lift({status:'completed',actualReadyMixM3:4.8,variance:{varianceM3:.3,direction:'over'}});

  it('hatches estimated concrete and poured concrete with different patterns',()=>{
    const estimated=buildLiftDiagram(lift()).svg;
    const done=buildLiftDiagram(poured()).svg;
    expect(estimated).toContain(`url(#${CONCRETE_PATTERN_ID})`);
    expect(done).toContain(`url(#${CONCRETE_POURED_PATTERN_ID})`);
    expect(done).not.toContain(`url(#${CONCRETE_PATTERN_ID})`);
  });

  it('keeps the poured fill colour as well as the pattern',()=>{
    const diagram=buildLiftDiagram(poured());
    const envelope=diagram.elements.find(element=>element.kind==='polygon')!;
    expect(envelope).toMatchObject({fill:CONCRETE_POURED_FILL});
    expect(diagram.svg).toContain(`url(#${CONCRETE_POURED_PATTERN_ID})`);
  });

  it('defines every pattern it references',()=>{
    for(const value of [lift(),poured()]){
      const diagram=buildLiftDiagram(value);
      for(const match of diagram.svg.matchAll(/url\(#([^)]+)\)/g))
        expect(diagram.patterns.some(pattern=>pattern.id===match[1])).toBe(true);
    }
  });

  it('never hatches the envelope of a planned lift, because no concrete exists in it yet',()=>{
    const planned=buildLiftDiagram(lift({status:'planned',calculatedStoneVolumeM3:0,actualStoneQuantityM3:null,estimatedConcreteM3:9}));
    const polygons=planned.elements.filter((element):element is Extract<typeof element,{kind:'polygon'}>=>element.kind==='polygon');
    expect(polygons[0]).toMatchObject({fill:'none'});
    // The legend swatch may still illustrate the estimate; the drawing itself must not imply concrete.
    expect(polygons.some(polygon=>polygon.fill.includes(CONCRETE_PATTERN_ID)||polygon.fill.includes(CONCRETE_POURED_PATTERN_ID))).toBe(false);
  });

  it('gives every legend entry the pattern id its swatch is drawn with',()=>{
    const diagram=buildLiftDiagram(poured());
    for(const entry of diagram.legend){
      expect(entry.patternId.length).toBeGreaterThan(0);
      expect([STONE_PATTERN_ID,CONCRETE_PATTERN_ID,CONCRETE_POURED_PATTERN_ID]).toContain(entry.patternId);
    }
    expect(diagram.legend.some(entry=>entry.patternId===CONCRETE_POURED_PATTERN_ID)).toBe(true);
  });

  it('keeps the stack diagram consistent with the single-lift figure',async()=>{
    const {buildConstructionLiftStackDiagram}=await import('../src/domain/constructionLiftDiagram');
    const {reconcileLifts}=await import('../src/domain/wallConstructionLift');
    const diagram=buildConstructionLiftStackDiagram({title:'F1',contextLabel:null,parentLabel:'Foundation',
      parentNetVolumeM3:9,lifts:[poured()],reconciliation:reconcileLifts(9,[]),curingNote:null,legacyStage:null});
    expect(diagram.svg).toContain(`url(#${CONCRETE_POURED_PATTERN_ID})`);
  });
});

// Defect 5: the Stone editor kept the saved estimate (9) beside a previewed 4.5 m³ of Stone.
describe('defect 5: a previewed Stone recomputes the estimated concrete matrix',()=>{
  const saved=lift({calculatedStoneVolumeM3:0,actualStoneQuantityM3:null,stoneGeometry:null,status:'planned',estimatedConcreteM3:9});

  it('derives the estimate from the previewed Stone, not the saved one',()=>{
    const preview=withPreviewedStone(saved,{calculatedStoneVolumeM3:4.5,actualStoneQuantityM3:4.5,
      stoneGeometry:lift().stoneGeometry,position:{xNorm:.5,yNorm:.5},offsets:null,status:'stone_placed'});
    expect(preview.estimatedConcreteM3).toBe(4.5);
    expect(preview.calculatedStoneVolumeM3).toBe(4.5);
  });

  it('never lets the previewed Stone plus concrete exceed the lift envelope',()=>{
    const preview=withPreviewedStone(saved,{calculatedStoneVolumeM3:6,actualStoneQuantityM3:6,
      stoneGeometry:null,position:null,offsets:null,status:'stone_placed'});
    expect(preview.calculatedStoneVolumeM3+preview.estimatedConcreteM3).toBeCloseTo(9,6);
  });

  it('keeps a recorded concrete phase estimate rather than recomputing over it',()=>{
    const withConcrete=lift({actualReadyMixM3:4.8,estimatedConcreteM3:4.5,status:'completed'});
    const preview=withPreviewedStone(withConcrete,{calculatedStoneVolumeM3:5,actualStoneQuantityM3:5,
      stoneGeometry:null,position:null,offsets:null,status:'completed'});
    expect(preview.estimatedConcreteM3).toBe(4.5);
  });

  it('shows no Stone and the whole envelope as estimated concrete while still planned',()=>{
    const preview=withPreviewedStone(saved,{calculatedStoneVolumeM3:0,actualStoneQuantityM3:null,
      stoneGeometry:null,position:null,offsets:null,status:'planned'});
    expect(preview.estimatedConcreteM3).toBe(9);
  });
});

// Defect 4: typing "0." was destroyed by re-rendering String(Number(text)) each keystroke.
describe('defect 4: a decimal offset can actually be typed',()=>{
  it('parses a partially typed decimal without losing it',()=>{
    expect(parseOffsetText('0.')).toBe(0);
    expect(parseOffsetText('0.5')).toBe(.5);
    expect(parseOffsetText('.5')).toBe(.5);
    expect(parseOffsetText('12.25')).toBe(12.25);
    expect(parseOffsetText('0,5')).toBe(.5);
  });

  it('treats blank or nonsense as not-a-number so validation can report it',()=>{
    for(const text of ['','   ','abc','--1'])expect(Number.isNaN(parseOffsetText(text))).toBe(true);
  });

  it('recognises that a half-typed decimal still matches its committed value, so the text is never clobbered',()=>{
    expect(offsetTextMatchesValue('0.',0)).toBe(true);
    expect(offsetTextMatchesValue('0.50',.5)).toBe(true);
    expect(offsetTextMatchesValue('1.',1)).toBe(true);
    expect(offsetTextMatchesValue('0.',0.05)).toBe(false);
    expect(offsetTextMatchesValue('',0)).toBe(false);
  });

  it('keeps the typed text when a nudge did not change the value',()=>{
    expect(offsetTextMatchesValue('3.',3)).toBe(true);
    expect(offsetTextMatchesValue('3.',3.05)).toBe(false);
  });

  it('is wired into the placement controls as text state, not a re-stringified number',()=>{
    const controls=source('src/ui/components/StonePlacementControls.tsx');
    expect(controls).toContain('parseOffsetText');
    expect(controls).toContain('offsetTextMatchesValue');
    expect(controls).not.toMatch(/value=\{Number\.isFinite\([^)]*\)\?String\(/);
  });

  it('stops rebuilding the whole diagram on every keystroke',()=>{
    for(const path of ['src/ui/screens/StoneLiftEditorScreen.tsx','src/ui/screens/ConcreteMatrixEditorScreen.tsx'])
      expect(source(path)).toContain('useMemo');
  });
});

// Defect 6: Back always jumped to a hardcoded parent, so Concrete Matrix could not return to Stone.
describe('defect 6: Back retraces the path actually taken',()=>{
  const start:FoundationView[]=[{kind:'overview'}];

  it('returns from the concrete editor to the Stone editor it was opened from',()=>{
    const lifts=pushView(start,{kind:'lifts'});
    const stone=pushView(lifts,{kind:'stoneEditor',lift:{liftId:'l1',reference:'Lift 1',parentType:'foundation'}});
    const concrete=pushView(stone,{kind:'concreteEditor',lift:{liftId:'l1',reference:'Lift 1',parentType:'foundation'}});
    expect(currentView(concrete).kind).toBe('concreteEditor');
    expect(currentView(backView(concrete)).kind).toBe('stoneEditor');
    expect(currentView(backView(backView(concrete))).kind).toBe('lifts');
    expect(currentView(backView(backView(backView(concrete)))).kind).toBe('overview');
  });

  it('returns from the concrete editor to the list when it was opened from the list',()=>{
    const lifts=pushView(start,{kind:'lifts'});
    const concrete=pushView(lifts,{kind:'concreteEditor',lift:{liftId:'l1',reference:'Lift 1',parentType:'foundation'}});
    expect(currentView(backView(concrete)).kind).toBe('lifts');
  });

  it('never pops past the first screen, so the workspace root stays reachable',()=>{
    expect(backView(start)).toEqual(start);
    expect(currentView(backView(start)).kind).toBe('overview');
  });

  it('reports when Back should leave the workspace entirely',async()=>{
    const {isRootView}=await import('../src/ui/navigation/foundationViewStack');
    expect(isRootView(start)).toBe(true);
    expect(isRootView(pushView(start,{kind:'lifts'}))).toBe(false);
  });

  it('returns to the lifts list after a save, without stranding the editor on the stack',()=>{
    const stone=pushView(pushView(start,{kind:'lifts'}),{kind:'stoneEditor',lift:{liftId:'l1',reference:'Lift 1',parentType:'foundation'}});
    const concrete=pushView(stone,{kind:'concreteEditor',lift:{liftId:'l1',reference:'Lift 1',parentType:'foundation'}});
    const saved=popToView(concrete,'lifts');
    expect(currentView(saved).kind).toBe('lifts');
    expect(saved).toHaveLength(2);
    expect(currentView(backView(saved)).kind).toBe('overview');
  });

  it('falls back to the root when popping to a screen that was never visited',()=>{
    const stack=pushView(start,{kind:'lifts'});
    expect(currentView(popToView(stack,'wallLifts')).kind).toBe('overview');
  });

  it('keeps foundation and wall lift contexts distinct on the stack',()=>{
    const stack=pushView(pushView(start,{kind:'wall'}),{kind:'wallLifts'});
    expect(currentView(stack).kind).toBe('wallLifts');
    expect(currentView(backView(stack)).kind).toBe('wall');
  });

  it('is what the navigator actually uses',()=>{
    const navigator=source('src/ui/screens/FoundationConstructionNavigator.tsx');
    expect(navigator).toContain('foundationViewStack');
    expect(navigator).toContain('backView');
    expect(navigator).not.toMatch(/onBack=\{\(\)=>setView\(\{kind:'overview'\}\)\}/);
  });
});

// Defect 8: History only ever read correctionHistory, so recorded phases were invisible.
describe('defect 8: History shows the Stone, concrete and status chronology',()=>{
  const record=(overrides:Partial<ConstructionLift>={}):ConstructionLift=>({
    id:'lift-1',parentType:'foundation',parentId:'f1',sequence:1,reference:'Lift 1',startElevationM:0,
    geometry:{lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0},netLiftVolumeM3:9,
    stonePhase:{calculationSnapshot:null,calculatedStoneVolumeM3:4.5,actualStoneQuantityM3:4.5,manualOverride:false,
      workDate:'2026-09-10',position:null,offsets:null,notes:''},
    concretePhase:{liftId:'lift-1',calculationMethod:'estimated_matrix',estimatedMatrixVolumeM3:4.5,independentCalculation:null,
      actualReadyMixQuantityM3:4.8,manualOverride:false,purpose:'Matrix fill',workDate:'2026-09-11',notes:''},
    status:'completed',notes:'',correctionHistory:[],createdAt:'2026-09-09T08:00:00.000Z',updatedAt:null,...overrides,
  });

  it('lists the lift being created, its Stone phase and its concrete phase',()=>{
    const events=liftHistoryEvents([record()]);
    expect(events.map(event=>event.kind)).toEqual(expect.arrayContaining(['created','stone','concrete']));
    expect(events.find(event=>event.kind==='stone')?.summary).toContain('4.5');
    expect(events.find(event=>event.kind==='concrete')?.summary).toContain('4.8');
  });

  it('is newest first',()=>{
    const events=liftHistoryEvents([record()]);
    const dates=events.map(event=>event.at);
    expect([...dates].sort((a,b)=>b.localeCompare(a))).toEqual(dates);
    expect(events[0]!.kind).toBe('concrete');
  });

  it('names the lift each event belongs to',()=>{
    for(const event of liftHistoryEvents([record()]))expect(event.source).toContain('Lift 1');
  });

  it('shows a Stone-only lift with no concrete event yet',()=>{
    const events=liftHistoryEvents([record({concretePhase:null,status:'stone_placed'})]);
    expect(events.some(event=>event.kind==='concrete')).toBe(false);
    expect(events.some(event=>event.kind==='stone')).toBe(true);
  });

  it('shows a planned lift as created only',()=>{
    const events=liftHistoryEvents([record({concretePhase:null,status:'planned',
      stonePhase:{...record().stonePhase,actualStoneQuantityM3:null,workDate:null,calculatedStoneVolumeM3:0}})]);
    expect(events.map(event=>event.kind)).toEqual(['created']);
  });

  it('includes reasoned corrections with their before and after values',()=>{
    const events=liftHistoryEvents([record({correctionHistory:[{correctedAt:'2026-09-12T09:00:00.000Z',correctedBy:'Owner',
      reason:'Re-counted on site',changes:[{field:'Stone actual quantity (m³)',originalValue:'4.5',newValue:'4.6'}]}]})]);
    const correction=events.find(event=>event.kind==='correction')!;
    expect(correction.summary).toContain('Re-counted on site');
    expect(correction.changes).toHaveLength(1);
    expect(events[0]).toBe(correction);
  });

  it('keeps every lift of a parent in one chronology',()=>{
    const events=liftHistoryEvents([record(),record({id:'lift-2',sequence:2,reference:'Lift 2',createdAt:'2026-09-13T08:00:00.000Z',
      concretePhase:null,status:'stone_placed',stonePhase:{...record().stonePhase,workDate:'2026-09-14'}})]);
    expect(events.some(event=>event.source.includes('Lift 2'))).toBe(true);
    expect(events[0]!.source).toContain('Lift 2');
  });

  it('is what the History screen reads',()=>{
    const history=source('src/ui/screens/HistoryAndCorrectionsScreen.tsx');
    expect(history).toContain('liftHistoryEvents');
    expect(history).not.toContain('No corrections recorded');
  });
});

// Defect 9: correctLift existed in the repository but no screen could reach it.
describe('defect 9: a lift can be corrected with a reason from the UI',()=>{
  it('has a dedicated correction screen wired into the navigator',()=>{
    expect(()=>source('src/ui/screens/LiftCorrectionScreen.tsx')).not.toThrow();
    const screen=source('src/ui/screens/LiftCorrectionScreen.tsx');
    expect(screen).toContain('correctLift');
    expect(screen).toContain('correctionReason');
    const navigator=source('src/ui/screens/FoundationConstructionNavigator.tsx');
    expect(navigator).toContain('LiftCorrectionScreen');
    expect(navigator).toContain("kind:'liftCorrection'");
  });

  it('requires a reason before it can be saved',()=>{
    const screen=source('src/ui/screens/LiftCorrectionScreen.tsx');
    expect(screen).toMatch(/disabled=\{[^}]*correctionReason/);
  });

  it('is reachable from the lifts list',()=>{
    expect(source('src/ui/screens/ConstructionLiftsListScreen.tsx')).toContain('onCorrectLift');
  });
});

/**
 * Defect 10, found on the device the moment a lift was opened: "Rendered more hooks than during the
 * previous render." A `useMemo` added for the diagram preview sat *after* the `if(!lift) return
 * …Loading…` guard, so the loading render ran fewer hooks than the loaded one -- a Rules of Hooks
 * violation that neither typecheck nor any existing test could see. This guards every screen in the
 * workflow, not only the two that were broken.
 */
describe('defect 10: no screen calls a hook after an early return',()=>{
  const screens=[
    'src/ui/screens/StoneLiftEditorScreen.tsx','src/ui/screens/ConcreteMatrixEditorScreen.tsx',
    'src/ui/screens/ConstructionLiftsListScreen.tsx','src/ui/screens/FoundationOverviewScreen.tsx',
    'src/ui/screens/FoundationSummaryScreen.tsx','src/ui/screens/FoundationGeometryScreen.tsx',
    'src/ui/screens/FoundationDiagramScreen.tsx','src/ui/screens/FoundationCuringScreen.tsx',
    'src/ui/screens/WallOverviewScreen.tsx','src/ui/screens/HistoryAndCorrectionsScreen.tsx',
    'src/ui/screens/LiftCorrectionScreen.tsx','src/ui/screens/FoundationConstructionNavigator.tsx',
    'src/ui/components/StonePlacementControls.tsx','src/ui/components/ConstructionLiftDiagramView.tsx',
  ];

  it('keeps every useState, useEffect, useCallback and useMemo above the first early return',()=>{
    for(const path of screens){
      const text=source(path);
      const guard=text.search(/\n\s*if\([^)]*\)\s*return </);
      if(guard<0)continue;
      const afterGuard=text.slice(guard);
      const offending=[...afterGuard.matchAll(/\b(useState|useEffect|useCallback|useMemo|useRef)\(/g)].map(match=>match[1]);
      expect(offending,`${path} calls ${offending.join(', ')} after an early return`).toEqual([]);
    }
  });

  it('still guards the loading state on both lift editors',()=>{
    for(const path of ['src/ui/screens/StoneLiftEditorScreen.tsx','src/ui/screens/ConcreteMatrixEditorScreen.tsx']){
      const text=source(path);
      expect(text).toContain('!previewLift');
      expect(text).toMatch(/Loading…/);
    }
  });
});

// Defects 1 and 2: the Owner's wording and explanation requests.
describe('defects 1 and 2: wording and the capacity explanation',()=>{
  it('calls them Lifts in the foundation workspace',()=>{
    expect(source('src/ui/screens/FoundationOverviewScreen.tsx')).toContain('label="Lifts"');
    expect(source('src/ui/screens/WallOverviewScreen.tsx')).toContain('label="Wall Lifts"');
    // DEC-473. The breadcrumb reads plainly "Lifts" now; the retired "Cyclopean Lifts" wording must
    // not come back anywhere the Owner reads.
    expect(source('src/ui/screens/FoundationConstructionNavigator.tsx')).toContain("'Lifts'");
    expect(source('src/ui/screens/FoundationConstructionNavigator.tsx')).not.toMatch(/Cyclopean/i);
  });

  it('explains what the structural capacity figures mean',()=>{
    const panel=source('src/ui/components/LiftReconciliationPanel.tsx');
    expect(panel).toMatch(/envelope is the space/i);
    expect(panel).toMatch(/allocated/i);
    expect(panel).toMatch(/Stone and concrete/i);
  });
});
