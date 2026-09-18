import {describe,expect,it} from 'vitest';

import {
  buildCombinedCyclopeanDiagram,buildCyclopeanStackDiagram,buildLiftDiagram,liftDiagramLiftFrom,
  LIFT_DIAGRAM_PLANE_LABEL,STONE_FILL,CONCRETE_POURED_FILL,CONCRETE_ESTIMATE_FILL,
  type LiftDiagramLift,type StackDiagramInput,
} from '../src/domain/cyclopeanLiftDiagram';
import type {DiagramElement} from '../src/domain/wallDiagram';
import {reconcileLifts,type CyclopeanLift,type LiftStonePosition} from '../src/domain/wallCyclopeanLift';

const lift=(overrides:Partial<LiftDiagramLift>={}):LiftDiagramLift=>({
  id:'lift-1',sequence:1,reference:'Lift 1',startElevationM:0,
  geometry:{lengthM:10,heightM:.5,bottomThicknessM:1,topThicknessM:1,deductionM3:0},
  netLiftVolumeM3:5,status:'planned',
  calculatedStoneVolumeM3:0,actualStoneQuantityM3:null,stoneGeometry:null,
  estimatedConcreteM3:5,actualReadyMixM3:null,variance:null,position:null,offsets:null,
  ...overrides,
});

const stonePlaced=(overrides:Partial<LiftDiagramLift>={})=>lift({
  status:'stone_placed',calculatedStoneVolumeM3:2,actualStoneQuantityM3:2,
  stoneGeometry:{lengthM:5,heightM:.4,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0},
  estimatedConcreteM3:3,position:{xNorm:.5,yNorm:.5},...overrides,
});

const completed=(overrides:Partial<LiftDiagramLift>={})=>stonePlaced({
  status:'completed',actualReadyMixM3:3.4,variance:{varianceM3:.4,direction:'over'},...overrides,
});

type Polygon=Extract<DiagramElement,{kind:'polygon'}>;
const envelopeOf=(diagram:{elements:DiagramElement[]}):Polygon=>
  diagram.elements.find((element):element is Polygon=>element.kind==='polygon')!;

describe('buildLiftDiagram — a single Cyclopean Lift',()=>{
  it('draws a planned lift as an empty structural envelope with no fabricated Stone or concrete',()=>{
    const diagram=buildLiftDiagram(lift());
    expect(envelopeOf(diagram)).toMatchObject({fill:'none'});
    expect(diagram.elements.some(element=>'fill' in element&&element.fill===STONE_FILL)).toBe(false);
    expect(diagram.svg).toContain('Planned');
    expect(diagram.svg).not.toContain('poured');
  });

  it('labels the lift with its reference, sequence, elevation and both thicknesses',()=>{
    const diagram=buildLiftDiagram(lift({reference:'Lift 1',startElevationM:1.25}));
    expect(diagram.svg).toContain('Lift 1');
    expect(diagram.svg).toContain('1.25');
    expect(diagram.svg).toContain('Bottom');
    expect(diagram.svg).toContain('Top');
  });

  it('states the represented plane so a 2D view never implies unrecorded 3D placement',()=>{
    expect(buildLiftDiagram(lift()).svg).toContain(LIFT_DIAGRAM_PLANE_LABEL);
  });

  it('draws Stone inside the lift envelope, never beside it',()=>{
    const diagram=buildLiftDiagram(stonePlaced());
    const stone=diagram.elements.find(element=>element.kind==='rect'&&element.fill===STONE_FILL);
    expect(stone).toBeTruthy();
    const box=diagram.dragBounds;
    const region=stone as {x:number;y:number;width:number;height:number};
    expect(region.x).toBeGreaterThanOrEqual(box.boxLeft-.001);
    expect(region.y).toBeGreaterThanOrEqual(box.boxTop-.001);
    expect(region.x+region.width).toBeLessThanOrEqual(box.boxLeft+box.boxWidth+.001);
    expect(region.y+region.height).toBeLessThanOrEqual(box.boxTop+box.boxHeight+.001);
  });

  it('shows a Stone-placed lift as pending concrete, never as already poured',()=>{
    const diagram=buildLiftDiagram(stonePlaced());
    expect(envelopeOf(diagram).fill).toBe(CONCRETE_ESTIMATE_FILL);
    expect(diagram.svg).toContain('Concrete fill pending');
    expect(diagram.svg).not.toContain('poured');
  });

  it('surrounds the Stone with the poured concrete matrix once the lift is completed',()=>{
    const diagram=buildLiftDiagram(completed());
    expect(envelopeOf(diagram).fill).toBe(CONCRETE_POURED_FILL);
    expect(diagram.elements.some(element=>'fill' in element&&element.fill===STONE_FILL)).toBe(true);
    expect(diagram.svg).toContain('Completed');
  });

  it('lists actual and estimated quantities with the variance for a completed lift',()=>{
    const diagram=buildLiftDiagram(completed());
    expect(diagram.svg).toContain('3.4');
    expect(diagram.svg).toContain('Variance');
    expect(diagram.legend.some(entry=>entry.label.includes('Stone'))).toBe(true);
  });

  it('carries a phase legend whose entries are distinguished by marker and pattern, not colour alone',()=>{
    const diagram=buildLiftDiagram(completed());
    for(const entry of diagram.legend){
      expect(entry.marker.length).toBeGreaterThan(0);
      expect(entry.pattern).toBeTruthy();
    }
  });

  it('positions the Stone region from a simple-mode normalized position',()=>{
    const left=buildLiftDiagram(stonePlaced({position:{xNorm:0,yNorm:.5}}));
    const right=buildLiftDiagram(stonePlaced({position:{xNorm:1,yNorm:.5}}));
    const x=(diagram:typeof left)=>(diagram.elements.find(element=>element.kind==='rect'&&element.fill===STONE_FILL) as {x:number}).x;
    expect(x(right)).toBeGreaterThan(x(left));
  });

  it('positions the Stone region from detailed-mode physical offsets',()=>{
    const near=buildLiftDiagram(stonePlaced({offsets:{longitudinalOffsetM:0,verticalOffsetM:0,transverseOffsetM:0}}));
    const far=buildLiftDiagram(stonePlaced({offsets:{longitudinalOffsetM:5,verticalOffsetM:.1,transverseOffsetM:0}}));
    const x=(diagram:typeof near)=>(diagram.elements.find(element=>element.kind==='polygon'&&element.fill===STONE_FILL) as {points:[number,number][]}).points[0]![0];
    expect(x(far)).toBeGreaterThan(x(near));
  });

  it('widens a very thin Stone region to stay visible and discloses the exaggeration',()=>{
    const diagram=buildLiftDiagram(stonePlaced({calculatedStoneVolumeM3:.001,stoneGeometry:{lengthM:.05,heightM:.01,bottomThicknessM:.01,topThicknessM:.01,deductionM3:0},offsets:{longitudinalOffsetM:0,verticalOffsetM:0,transverseOffsetM:0}}));
    expect(diagram.exaggerated).toBe(true);
    expect(diagram.svg).toContain('wider than scale');
  });

  it('preserves the relative taper between bottom and top thickness',()=>{
    const diagram=buildLiftDiagram(lift({geometry:{lengthM:10,heightM:.5,bottomThicknessM:2,topThicknessM:.5,deductionM3:0}}));
    const points=envelopeOf(diagram).points;
    const bottomWidth=points[1]![0]-points[0]![0],topWidth=points[2]![0]-points[3]![0];
    expect(bottomWidth).toBeGreaterThan(topWidth*2.5);
  });
});

describe('liftDiagramLiftFrom — the domain stays authoritative',()=>{
  const source=(overrides:Partial<CyclopeanLift>={}):CyclopeanLift=>({
    id:'lift-a',parentType:'foundation',parentId:'f1',sequence:2,reference:'Lift 2',startElevationM:.5,
    geometry:{lengthM:10,heightM:.5,bottomThicknessM:1,topThicknessM:1,deductionM3:0},netLiftVolumeM3:5,
    stonePhase:{calculationSnapshot:{lengthM:5,heightM:.4,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0,grossVolumeM3:1,netVolumeM3:1},
      calculatedStoneVolumeM3:1,actualStoneQuantityM3:1,manualOverride:false,workDate:'2026-09-01',position:{xNorm:.5,yNorm:.5},offsets:null,notes:''},
    concretePhase:null,status:'stone_placed',notes:'',correctionHistory:[],createdAt:'2026-09-01T00:00:00.000Z',updatedAt:null,...overrides,
  });

  it('takes the estimated concrete volume from the domain formula rather than recomputing it',()=>{
    expect(liftDiagramLiftFrom(source()).estimatedConcreteM3).toBe(4);
  });

  it('prefers the recorded concrete phase estimate and variance once one exists',()=>{
    const value=liftDiagramLiftFrom(source({
      status:'completed',
      concretePhase:{liftId:'lift-a',calculationMethod:'estimated_matrix',estimatedMatrixVolumeM3:4,independentCalculation:null,
        actualReadyMixQuantityM3:4.5,manualOverride:false,purpose:'Matrix fill',workDate:'2026-09-02',notes:''},
    }));
    expect(value.actualReadyMixM3).toBe(4.5);
    expect(value.variance).toMatchObject({direction:'over',varianceM3:.5});
  });

  it('carries the measured Stone geometry through from the calculation snapshot',()=>{
    expect(liftDiagramLiftFrom(source()).stoneGeometry).toMatchObject({lengthM:5,heightM:.4});
  });
});

const stack=(lifts:LiftDiagramLift[],overrides:Partial<StackDiagramInput>={}):StackDiagramInput=>({
  title:'Foundation F1',contextLabel:'Section A',parentLabel:'Foundation',
  parentNetVolumeM3:20,lifts,
  reconciliation:reconcileLifts(20,[]),curingNote:null,legacyStage:null,...overrides,
});

const reconcileFor=(parentNetVolumeM3:number,lifts:LiftDiagramLift[])=>
  reconcileLifts(parentNetVolumeM3,lifts.map(value=>({
    netLiftVolumeM3:value.netLiftVolumeM3,
    stonePhase:{calculatedStoneVolumeM3:value.calculatedStoneVolumeM3,actualStoneQuantityM3:value.actualStoneQuantityM3},
    concretePhase:value.actualReadyMixM3==null&&value.status!=='completed'?null:{estimatedMatrixVolumeM3:value.estimatedConcreteM3,actualReadyMixQuantityM3:value.actualReadyMixM3},
  })) as unknown as CyclopeanLift[]);

describe('buildCyclopeanStackDiagram — every lift in a foundation or wall',()=>{
  const three=[completed({id:'l1',sequence:1,reference:'Lift 1'}),stonePlaced({id:'l2',sequence:2,reference:'Lift 2'}),lift({id:'l3',sequence:3,reference:'Lift 3'})];

  it('renders lifts in construction order regardless of the array order given',()=>{
    const shuffled=buildCyclopeanStackDiagram(stack([three[2]!,three[0]!,three[1]!],{reconciliation:reconcileFor(20,three)}));
    expect(shuffled.bands.map(band=>band.sequence)).toEqual([1,2,3]);
  });

  it('never overlaps two lift envelopes',()=>{
    const diagram=buildCyclopeanStackDiagram(stack(three,{reconciliation:reconcileFor(20,three)}));
    const ordered=[...diagram.bands].sort((a,b)=>a.top-b.top);
    for(const[index,band]of ordered.entries()){
      const next=ordered[index+1];
      if(next)expect(band.top+band.height).toBeLessThanOrEqual(next.top+.001);
    }
  });

  it('stacks later lifts above earlier ones, matching how they are built',()=>{
    const diagram=buildCyclopeanStackDiagram(stack(three,{reconciliation:reconcileFor(20,three)}));
    const first=diagram.bands.find(band=>band.sequence===1)!,last=diagram.bands.find(band=>band.sequence===3)!;
    expect(last.top).toBeLessThan(first.top);
  });

  it('shows each lift honestly with its own status, including incomplete ones',()=>{
    const diagram=buildCyclopeanStackDiagram(stack(three,{reconciliation:reconcileFor(20,three)}));
    expect(diagram.svg).toContain('Concrete fill pending');
    expect(diagram.svg).toContain('Planned');
  });

  it('shows unallocated structural volume separately from the lifts',()=>{
    const diagram=buildCyclopeanStackDiagram(stack(three,{reconciliation:reconcileFor(20,three)}));
    expect(diagram.svg).toContain('Unallocated');
    expect(diagram.unallocated).toBeGreaterThan(0);
  });

  it('renders parent over-allocation as an explicit error state',()=>{
    const diagram=buildCyclopeanStackDiagram(stack(three,{parentNetVolumeM3:4,reconciliation:reconcileFor(4,three)}));
    expect(diagram.overAllocated).toBe(true);
    expect(diagram.svg).toContain('Over-allocated');
  });

  it('switches to a compact representation when there are many lifts, instead of full-size cards',()=>{
    const many=Array.from({length:24},(_,index)=>stonePlaced({id:`l${index}`,sequence:index+1,reference:`Lift ${index+1}`}));
    const diagram=buildCyclopeanStackDiagram(stack(many,{parentNetVolumeM3:200,reconciliation:reconcileFor(200,many)}));
    expect(diagram.compact).toBe(true);
    expect(diagram.height).toBeLessThan(1400);
    expect(diagram.bands).toHaveLength(24);
  });

  it('keeps a selected lift legible alongside the compact overview',()=>{
    const many=Array.from({length:24},(_,index)=>stonePlaced({id:`l${index}`,sequence:index+1,reference:`Lift ${index+1}`}));
    const diagram=buildCyclopeanStackDiagram(stack(many,{parentNetVolumeM3:200,reconciliation:reconcileFor(200,many),selectedLiftId:'l5'}));
    expect(diagram.selected?.sequence).toBe(6);
    expect(diagram.svg).toContain('Lift 6');
  });

  it('keeps the Construction Section context visible',()=>{
    expect(buildCyclopeanStackDiagram(stack(three,{reconciliation:reconcileFor(20,three)})).svg).toContain('Section A');
  });

  it('shows curing as information only and never as a gate on the drawing',()=>{
    const diagram=buildCyclopeanStackDiagram(stack(three,{reconciliation:reconcileFor(20,three),curingNote:'Curing since 1 September'}));
    expect(diagram.svg).toContain('Curing since 1 September');
    expect(diagram.bands).toHaveLength(3);
  });

  it('labels an imported legacy composite stage instead of inventing lifts for it',()=>{
    const diagram=buildCyclopeanStackDiagram(stack([],{
      reconciliation:reconcileFor(20,[]),
      legacyStage:{foundationId:'f1',label:'Imported legacy composite stage',netFoundationVolumeM3:20,activeStoneM3:6,estimatedConcreteM3:14,activeReadyMixM3:0,variance:null},
    }));
    expect(diagram.svg).toContain('Imported legacy composite stage');
    expect(diagram.bands).toHaveLength(0);
  });

  it('does not clip a long lift reference',()=>{
    const long=stonePlaced({reference:'Retaining foundation lift with an extremely long descriptive reference name'});
    const diagram=buildCyclopeanStackDiagram(stack([long],{reconciliation:reconcileFor(20,[long])}));
    const texts=diagram.elements.filter((element):element is Extract<typeof element,{kind:'text'}>=>element.kind==='text');
    for(const item of texts)expect(item.x).toBeLessThanOrEqual(diagram.width);
    expect(diagram.svg).toContain('…');
  });

  it('draws right-to-left references from their own right edge',()=>{
    const arabic=stonePlaced({reference:'أساس الجدار الاستنادي'});
    const diagram=buildCyclopeanStackDiagram(stack([arabic],{reconciliation:reconcileFor(20,[arabic])}));
    const rtl=diagram.elements.find(element=>element.kind==='text'&&element.rtl);
    expect(rtl).toMatchObject({anchor:'end'});
    expect(diagram.svg).toContain('direction="rtl"');
  });

  it('keeps mixed direction text inside the drawing',()=>{
    const mixed=stonePlaced({reference:'Lift 1 — أساس A'});
    const diagram=buildCyclopeanStackDiagram(stack([mixed],{reconciliation:reconcileFor(20,[mixed])}));
    expect(diagram.svg).toContain('أساس');
    expect(diagram.elements.every(element=>element.kind!=='text'||element.x<=diagram.width)).toBe(true);
  });
});

describe('buildCombinedCyclopeanDiagram — foundation and its linked wall',()=>{
  const foundationLifts=[completed({id:'f1',sequence:1,reference:'F Lift 1'})];
  const wallLifts=[stonePlaced({id:'w1',sequence:1,reference:'W Lift 1'})];

  it('distinguishes the foundation from the wall and draws the wall above it',()=>{
    const diagram=buildCombinedCyclopeanDiagram({
      foundation:stack(foundationLifts,{reconciliation:reconcileFor(20,foundationLifts)}),
      wall:stack(wallLifts,{title:'Wall W1',parentLabel:'Wall',reconciliation:reconcileFor(20,wallLifts)}),
    });
    expect(diagram.svg).toContain('Foundation');
    expect(diagram.svg).toContain('Wall');
    const wallBand=diagram.bands.find(band=>band.parentLabel==='Wall')!;
    const foundationBand=diagram.bands.find(band=>band.parentLabel==='Foundation')!;
    expect(wallBand.top).toBeLessThan(foundationBand.top);
  });

  it('draws the foundation alone when no wall is linked yet',()=>{
    const diagram=buildCombinedCyclopeanDiagram({foundation:stack(foundationLifts,{reconciliation:reconcileFor(20,foundationLifts)}),wall:null});
    expect(diagram.bands.every(band=>band.parentLabel==='Foundation')).toBe(true);
    expect(diagram.svg).toContain('No wall linked');
  });

  it('shows a foundation curing warning without hiding any wall content',()=>{
    const diagram=buildCombinedCyclopeanDiagram({
      foundation:stack(foundationLifts,{reconciliation:reconcileFor(20,foundationLifts),curingNote:'Foundation still curing'}),
      wall:stack(wallLifts,{title:'Wall W1',parentLabel:'Wall',reconciliation:reconcileFor(20,wallLifts)}),
    });
    expect(diagram.svg).toContain('Foundation still curing');
    expect(diagram.bands.some(band=>band.parentLabel==='Wall')).toBe(true);
  });
});

describe('diagram text and SVG safety',()=>{
  const hostile=['<script>alert(1)</script>','</svg><script/>','<img src=x onerror=alert(1)>','"quoted" & \'single\'','A & B <> C'];

  it('escapes hostile text so no markup or script can survive into the drawing',()=>{
    for(const value of hostile){
      const svg=buildLiftDiagram(stonePlaced({reference:value})).svg;
      expect(svg).not.toContain('<script');
      // The characters may survive inside an escaped text node -- what must never survive is an
      // actual element carrying an event handler, which is what this asserts.
      expect(svg).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
      expect(svg).not.toContain('</svg><');
      if(value.includes('<'))expect(svg).toContain('&lt;');
      if(value.includes('&'))expect(svg).toContain('&amp;');
      if(value.includes('"'))expect(svg).toContain('&quot;');
    }
  });

  it('escapes hostile text in the stack diagram and its legend too',()=>{
    const hostileLift=stonePlaced({reference:'<script>alert(1)</script>'});
    const svg=buildCyclopeanStackDiagram(stack([hostileLift],{title:'<b>F</b>',contextLabel:'"A"&B',reconciliation:reconcileFor(20,[hostileLift])})).svg;
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&amp;');
  });

  it('contains no JavaScript, no external URL, and no external font or image',()=>{
    const svg=buildCyclopeanStackDiagram(stack([completed()],{reconciliation:reconcileFor(20,[completed()])})).svg;
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('@import');
    expect(svg).not.toMatch(/\bon[a-z]+=/);
    expect(svg).not.toContain('javascript:');
  });

  it('is deterministic and self-contained for the same input',()=>{
    const input=stack([completed()],{reconciliation:reconcileFor(20,[completed()])});
    expect(buildCyclopeanStackDiagram(input).svg).toBe(buildCyclopeanStackDiagram(input).svg);
    expect(buildLiftDiagram(completed()).svg).toBe(buildLiftDiagram(completed()).svg);
  });
});

describe('grayscale and colour-vision safety',()=>{
  it('gives every legend entry a non-colour marker and a distinct pattern',()=>{
    const diagram=buildLiftDiagram(completed());
    const markers=diagram.legend.map(entry=>entry.marker);
    expect(new Set(markers).size).toBe(markers.length);
    expect(diagram.legend.every(entry=>entry.pattern.length>0)).toBe(true);
  });

  it('separates the Stone and concrete regions with a stroke as well as a fill',()=>{
    const diagram=buildLiftDiagram(completed());
    const stone=diagram.elements.find(element=>'fill' in element&&element.fill===STONE_FILL) as {stroke:string|null};
    expect(stone.stroke).toBeTruthy();
  });

  it('uses no gradient, no 3D effect and no photographic texture',()=>{
    const svg=buildCyclopeanStackDiagram(stack([completed()],{reconciliation:reconcileFor(20,[completed()])})).svg;
    expect(svg).not.toContain('Gradient');
    expect(svg).not.toContain('filter');
    expect(svg).not.toContain('feGaussian');
  });
});

describe('accessible placement description',()=>{
  it('describes the current Stone placement in words for a screen reader',async()=>{
    const {describeStonePlacement}=await import('../src/domain/cyclopeanLiftDiagram');
    const description=describeStonePlacement(stonePlaced({position:{xNorm:0,yNorm:0} as LiftStonePosition}));
    expect(description).toContain('Stone');
    expect(description.toLowerCase()).toContain('left');
  });
});
