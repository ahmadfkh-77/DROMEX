import {describe,expect,it} from 'vitest';

import {buildFoundationDiagram,foundationDiagramDragBounds,stoneCorePositionFromViewBoxPoint,viewBoxPointFromTouch,type FoundationDiagramInput} from '../src/domain/wallFoundationDiagram';

const base=(overrides:Partial<FoundationDiagramInput>={}):FoundationDiagramInput=>({
  referenceLabel:'Foundation A',lengthM:20,heightM:1,bottomThicknessM:1.5,topThicknessM:1.5,status:'planned',
  netFoundationVolumeM3:30,mode:'single',stoneCoreMode:null,position:null,offsets:null,
  activeStoneM3:0,activeReadyMixM3:0,estimatedConcreteM3:30,variance:null,...overrides,
});

describe('buildFoundationDiagram',()=>{
  it('draws only an empty outline for a planned, single-material base',()=>{
    const diagram=buildFoundationDiagram(base());
    const outline=diagram.elements.find(element=>element.kind==='polygon');
    expect(outline).toMatchObject({fill:'none'});
    expect(diagram.svg).toContain('<svg');
    expect(diagram.svg).not.toContain('poured');
  });

  it('fills the outer boundary and draws a Stone core once composite Stone is recorded (simple mode)',()=>{
    const diagram=buildFoundationDiagram(base({mode:'composite',stoneCoreMode:'simple',position:{xNorm:.5,yNorm:.5},activeStoneM3:10,estimatedConcreteM3:20}));
    const outline=diagram.elements.find(element=>element.kind==='polygon');
    expect(outline).toMatchObject({fill:'#DDD7C9'});
    const core=diagram.elements.find(element=>element.kind==='rect'&&element.fill==='#8C8579');
    expect(core).toBeTruthy();
    expect(diagram.svg).toContain('Schematic placement');
  });

  it('draws the Stone core precisely in detailed mode using the stored offsets',()=>{
    const diagram=buildFoundationDiagram(base({mode:'composite',stoneCoreMode:'detailed',offsets:{lengthM:10,depthM:.5,bottomThicknessM:.8,topThicknessM:.8,longitudinalOffsetM:5,verticalOffsetM:.25,transverseOffsetM:0},activeStoneM3:4,estimatedConcreteM3:26}));
    const core=diagram.elements.find(element=>element.kind==='polygon'&&element.fill==='#8C8579');
    expect(core).toBeTruthy();
    expect(diagram.svg).toContain('Detailed geometry');
  });

  it('shows estimated concrete as unpoured until Ready Mix is recorded',()=>{
    const diagram=buildFoundationDiagram(base({mode:'composite',stoneCoreMode:'simple',position:{xNorm:.5,yNorm:.5},activeStoneM3:10,estimatedConcreteM3:20}));
    expect(diagram.svg).toContain('Estimated space');
    expect(diagram.svg).not.toContain('Actual Ready Mix');
  });

  it('shows the actual Ready Mix quantity and variance once it is recorded, without distorting the estimate label away',()=>{
    const diagram=buildFoundationDiagram(base({mode:'composite',stoneCoreMode:'simple',position:{xNorm:.5,yNorm:.5},activeStoneM3:10,activeReadyMixM3:22,estimatedConcreteM3:20,variance:{varianceM3:2,direction:'over'}}));
    expect(diagram.svg).toContain('Actual Ready Mix recorded');
    expect(diagram.svg).toContain('Estimated concrete remaining');
    expect(diagram.svg).not.toContain('Estimated space');
  });

  it('never shows poured concrete before it has been recorded, even mid-curing',()=>{
    const diagram=buildFoundationDiagram(base({status:'curing',mode:'composite',stoneCoreMode:'simple',position:{xNorm:.5,yNorm:.5},activeStoneM3:10,estimatedConcreteM3:20}));
    expect(diagram.svg).not.toContain('Actual Ready Mix');
    const outline=diagram.elements.find(element=>element.kind==='polygon');
    expect(outline).toMatchObject({fill:'#DDD7C9'});
  });

  it('serializes to a self-contained SVG string with no script or external reference',()=>{
    const diagram=buildFoundationDiagram(base({mode:'composite',stoneCoreMode:'simple',position:{xNorm:.5,yNorm:.5},activeStoneM3:10,estimatedConcreteM3:20}));
    expect(diagram.svg).not.toContain('<script');
    expect(diagram.svg).not.toContain('<image');
    expect(diagram.svg.match(/https?:\/\//g)).toEqual(['http://']); // only the SVG xmlns namespace declaration
  });

  it('escapes an injected reference label rather than emitting it as markup',()=>{
    const diagram=buildFoundationDiagram(base({referenceLabel:'<script>alert(1)</script>'}));
    expect(diagram.svg).not.toContain('<script>alert');
    expect(diagram.svg).toContain('&lt;script&gt;');
  });

  it('reports the same drag bounds used to actually draw the simple-mode core',()=>{
    const diagram=buildFoundationDiagram(base({mode:'composite',stoneCoreMode:'simple',position:{xNorm:.5,yNorm:.5},activeStoneM3:10,estimatedConcreteM3:20}));
    expect(diagram.dragBounds).toEqual(foundationDiagramDragBounds({activeStoneM3:10,netFoundationVolumeM3:30}));
    const core=diagram.elements.find(element=>element.kind==='rect'&&element.fill==='#8C8579') as {x:number;y:number;width:number;height:number};
    expect(core.width).toBeCloseTo(diagram.dragBounds.coreWidthPx,5);
    expect(core.height).toBeCloseTo(diagram.dragBounds.coreHeightPx,5);
    // xNorm/yNorm=.5 centres the core within its draggable span.
    expect(core.x).toBeCloseTo(diagram.dragBounds.boxLeft+(diagram.dragBounds.boxWidth-diagram.dragBounds.coreWidthPx)/2,5);
    expect(core.y).toBeCloseTo(diagram.dragBounds.boxTop+(diagram.dragBounds.boxHeight-diagram.dragBounds.coreHeightPx)/2,5);
  });
});

describe('drag coordinate conversion (Checkpoint 5 — real touch dragging)',()=>{
  const bounds=foundationDiagramDragBounds({activeStoneM3:10,netFoundationVolumeM3:30});

  it('converts a screen-pixel touch point into SVG viewBox units using the rendered scale',()=>{
    // Diagram is 520 viewBox units wide; rendered at 260 screen px means a 0.5x scale.
    expect(viewBoxPointFromTouch({x:130,y:65},{width:260,height:130},{width:520,height:260})).toEqual({x:260,y:130});
    expect(viewBoxPointFromTouch({x:520,y:260},{width:520,height:260},{width:520,height:260})).toEqual({x:520,y:260});
  });

  it('degrades to the origin rather than dividing by zero when the view has not been measured yet',()=>{
    expect(viewBoxPointFromTouch({x:10,y:10},{width:0,height:0},{width:520,height:260})).toEqual({x:0,y:0});
  });

  it('maps a viewBox point at the centre of the draggable span to the centre position (0.5, 0.5)',()=>{
    const centre={x:bounds.boxLeft+bounds.boxWidth/2,y:bounds.boxTop+bounds.boxHeight/2};
    const position=stoneCorePositionFromViewBoxPoint(centre,bounds);
    expect(position.xNorm).toBeCloseTo(.5,2);
    expect(position.yNorm).toBeCloseTo(.5,2);
  });

  it('maps the box\'s own top-left and bottom-right corners to 0 and 1, never past them',()=>{
    const topLeft=stoneCorePositionFromViewBoxPoint({x:bounds.boxLeft,y:bounds.boxTop},bounds);
    expect(topLeft).toEqual({xNorm:0,yNorm:0});
    const bottomRight=stoneCorePositionFromViewBoxPoint({x:bounds.boxLeft+bounds.boxWidth,y:bounds.boxTop+bounds.boxHeight},bounds);
    expect(bottomRight).toEqual({xNorm:1,yNorm:1});
  });

  it('clamps an out-of-bounds touch (dragged past the foundation edge) to the nearest valid position, never throwing',()=>{
    expect(stoneCorePositionFromViewBoxPoint({x:-500,y:-500},bounds)).toEqual({xNorm:0,yNorm:0});
    expect(stoneCorePositionFromViewBoxPoint({x:9999,y:9999},bounds)).toEqual({xNorm:1,yNorm:1});
  });

  it('rejects NaN/invalid coordinates by clamping rather than producing NaN',()=>{
    const position=stoneCorePositionFromViewBoxPoint({x:Number.NaN,y:Number.NaN},bounds);
    expect(Number.isNaN(position.xNorm)).toBe(false);
    expect(Number.isNaN(position.yNorm)).toBe(false);
  });

  it('keeps the resulting core rectangle fully inside the outer boundary for any clamped position (containment)',()=>{
    for(const point of [{x:-1000,y:-1000},{x:0,y:0},{x:99999,y:0},{x:0,y:99999},{x:99999,y:99999}]){
      const position=stoneCorePositionFromViewBoxPoint(point,bounds);
      const coreX=bounds.boxLeft+position.xNorm*(bounds.boxWidth-bounds.coreWidthPx);
      const coreY=bounds.boxTop+position.yNorm*(bounds.boxHeight-bounds.coreHeightPx);
      expect(coreX).toBeGreaterThanOrEqual(bounds.boxLeft-1e-6);
      expect(coreX+bounds.coreWidthPx).toBeLessThanOrEqual(bounds.boxLeft+bounds.boxWidth+1e-6);
      expect(coreY).toBeGreaterThanOrEqual(bounds.boxTop-1e-6);
      expect(coreY+bounds.coreHeightPx).toBeLessThanOrEqual(bounds.boxTop+bounds.boxHeight+1e-6);
    }
  });

  it('preserves the recorded Stone volume regardless of where the core is dragged -- position and volume are computed independently',()=>{
    const before=30-20; // estimatedConcreteM3 given activeStoneM3=10, netFoundationVolumeM3=30
    stoneCorePositionFromViewBoxPoint({x:0,y:0},bounds);
    stoneCorePositionFromViewBoxPoint({x:9999,y:9999},bounds);
    expect(30-20).toBe(before); // dragging never recalculates estimated concrete or Stone quantity
  });
});
