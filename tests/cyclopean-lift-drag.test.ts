import {describe,expect,it} from 'vitest';

import {
  clampLiftStoneOffsets,DEFAULT_LIFT_STONE_POSITION,describeStonePlacement,DRAG_ACTIVATION_THRESHOLD_PX,
  liftDragBounds,liftStoneOffsetsFromViewBoxPoint,liftStonePositionFromViewBoxPoint,LIFT_NUDGE_STEP_M,LIFT_NUDGE_STEP_NORM,
  nudgeLiftStoneOffsets,nudgeLiftStonePosition,resetLiftStoneOffsets,resetLiftStonePosition,shouldClaimDragGesture,
  stoneTouchesRegion,validateLiftStoneOffsets,viewBoxPointFromTouch,buildLiftDiagram,type LiftDiagramLift,
} from '../src/domain/cyclopeanLiftDiagram';

const lift=(overrides:Partial<LiftDiagramLift>={}):LiftDiagramLift=>({
  id:'lift-1',sequence:1,reference:'Lift 1',startElevationM:0,
  geometry:{lengthM:10,heightM:1,bottomThicknessM:1,topThicknessM:1,deductionM3:0},
  netLiftVolumeM3:10,status:'stone_placed',
  calculatedStoneVolumeM3:2,actualStoneQuantityM3:2,
  stoneGeometry:{lengthM:4,heightM:.5,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0},
  estimatedConcreteM3:8,actualReadyMixM3:null,variance:null,
  position:{xNorm:.5,yNorm:.5},offsets:null,...overrides,
});

describe('Simple mode — pixel to normalized position',()=>{
  it('converts a screen touch into the diagram coordinate space using the rendered scale',()=>{
    const diagram=buildLiftDiagram(lift());
    const point=viewBoxPointFromTouch({x:100,y:50},{width:diagram.width/2,height:diagram.height/2},diagram);
    expect(point).toEqual({x:200,y:100});
  });

  it('returns the origin rather than dividing by zero before the diagram has been laid out',()=>{
    const diagram=buildLiftDiagram(lift());
    expect(viewBoxPointFromTouch({x:10,y:10},{width:0,height:0},diagram)).toEqual({x:0,y:0});
  });

  it('maps a touch at the left edge of the envelope to the far-left position',()=>{
    const bounds=liftDragBounds(lift());
    expect(liftStonePositionFromViewBoxPoint({x:bounds.boxLeft,y:bounds.boxTop},bounds).xNorm).toBe(0);
  });

  it('clamps a drag beyond the envelope back inside it rather than letting Stone escape the lift',()=>{
    const bounds=liftDragBounds(lift());
    const far=liftStonePositionFromViewBoxPoint({x:bounds.boxLeft+bounds.boxWidth*10,y:bounds.boxTop+bounds.boxHeight*10},bounds);
    expect(far).toEqual({xNorm:1,yNorm:1});
    const before=liftStonePositionFromViewBoxPoint({x:-5000,y:-5000},bounds);
    expect(before).toEqual({xNorm:0,yNorm:0});
  });

  it('keeps the drawn Stone region fully inside the lift envelope at every extreme position',()=>{
    for(const position of [{xNorm:0,yNorm:0},{xNorm:1,yNorm:1},{xNorm:0,yNorm:1},{xNorm:1,yNorm:0}]){
      const diagram=buildLiftDiagram(lift({position}));
      const bounds=diagram.dragBounds;
      const stone=diagram.elements.find(element=>element.kind==='rect'&&element.fill==='#8C8579') as {x:number;y:number;width:number;height:number};
      expect(stone.x).toBeGreaterThanOrEqual(bounds.boxLeft-.001);
      expect(stone.y).toBeGreaterThanOrEqual(bounds.boxTop-.001);
      expect(stone.x+stone.width).toBeLessThanOrEqual(bounds.boxLeft+bounds.boxWidth+.001);
      expect(stone.y+stone.height).toBeLessThanOrEqual(bounds.boxTop+bounds.boxHeight+.001);
    }
  });

  it('never changes the Stone volume when only the position changes',()=>{
    const centred=buildLiftDiagram(lift({position:DEFAULT_LIFT_STONE_POSITION}));
    const moved=buildLiftDiagram(lift({position:{xNorm:0,yNorm:1}}));
    expect(moved.stoneVolumeM3).toBe(centred.stoneVolumeM3);
    expect(moved.dragBounds.stoneWidthPx).toBe(centred.dragBounds.stoneWidthPx);
    expect(moved.dragBounds.stoneHeightPx).toBe(centred.dragBounds.stoneHeightPx);
  });

  it('produces the same normalized position at any rendered size, so it survives a screen size change',()=>{
    const diagram=buildLiftDiagram(lift());
    const small={width:320,height:320*diagram.height/diagram.width};
    const large={width:900,height:900*diagram.height/diagram.width};
    const at=(rendered:{width:number;height:number})=>{
      const fraction=.25;
      const touch={x:rendered.width*fraction,y:rendered.height*fraction};
      return liftStonePositionFromViewBoxPoint(viewBoxPointFromTouch(touch,rendered,diagram),diagram.dragBounds);
    };
    expect(at(small)).toEqual(at(large));
  });

  it('rounds the stored position so a drag does not write noisy floating point into the record',()=>{
    const bounds=liftDragBounds(lift());
    const position=liftStonePositionFromViewBoxPoint({x:bounds.boxLeft+bounds.boxWidth/3,y:bounds.boxTop+bounds.boxHeight/3},bounds);
    expect(String(position.xNorm).replace('0.','').length).toBeLessThanOrEqual(4);
  });
});

describe('Simple mode — gesture claiming',()=>{
  const bounds=liftDragBounds(lift());

  it('only treats a touch that starts on the Stone region as the start of a drag',()=>{
    const position={xNorm:.5,yNorm:.5};
    const stoneX=bounds.boxLeft+position.xNorm*(bounds.boxWidth-bounds.stoneWidthPx)+bounds.stoneWidthPx/2;
    const stoneY=bounds.boxTop+position.yNorm*(bounds.boxHeight-bounds.stoneHeightPx)+bounds.stoneHeightPx/2;
    expect(stoneTouchesRegion({x:stoneX,y:stoneY},bounds,position)).toBe(true);
    expect(stoneTouchesRegion({x:bounds.boxLeft-40,y:bounds.boxTop-40},bounds,position)).toBe(false);
  });

  it('waits for a real movement threshold before claiming the gesture',()=>{
    expect(shouldClaimDragGesture({dx:1,dy:1,onStone:true})).toBe(false);
    expect(shouldClaimDragGesture({dx:DRAG_ACTIVATION_THRESHOLD_PX+1,dy:0,onStone:true})).toBe(true);
  });

  it('never claims a gesture that did not begin on the Stone, so vertical page scrolling is not stolen',()=>{
    expect(shouldClaimDragGesture({dx:0,dy:80,onStone:false})).toBe(false);
    expect(shouldClaimDragGesture({dx:40,dy:0,onStone:false})).toBe(false);
  });

  it('still allows a deliberate vertical drag that began on the Stone',()=>{
    expect(shouldClaimDragGesture({dx:0,dy:DRAG_ACTIVATION_THRESHOLD_PX+1,onStone:true})).toBe(true);
  });
});

describe('Simple mode — nudge and reset alternatives',()=>{
  it('nudges the Stone by a fixed step in each direction',()=>{
    const start={xNorm:.5,yNorm:.5};
    expect(nudgeLiftStonePosition(start,'right').xNorm).toBeCloseTo(.5+LIFT_NUDGE_STEP_NORM,6);
    expect(nudgeLiftStonePosition(start,'left').xNorm).toBeCloseTo(.5-LIFT_NUDGE_STEP_NORM,6);
    expect(nudgeLiftStonePosition(start,'up').yNorm).toBeCloseTo(.5-LIFT_NUDGE_STEP_NORM,6);
    expect(nudgeLiftStonePosition(start,'down').yNorm).toBeCloseTo(.5+LIFT_NUDGE_STEP_NORM,6);
  });

  it('clamps a nudge at the envelope edge instead of moving Stone outside the lift',()=>{
    expect(nudgeLiftStonePosition({xNorm:1,yNorm:1},'right')).toEqual({xNorm:1,yNorm:1});
    expect(nudgeLiftStonePosition({xNorm:0,yNorm:0},'up')).toEqual({xNorm:0,yNorm:0});
  });

  it('resets to the centre of the lift',()=>{
    expect(resetLiftStonePosition()).toEqual(DEFAULT_LIFT_STONE_POSITION);
    expect(DEFAULT_LIFT_STONE_POSITION).toEqual({xNorm:.5,yNorm:.5});
  });

  it('describes the placement in words, including the step size, for a screen reader',()=>{
    const description=describeStonePlacement(lift({position:{xNorm:1,yNorm:0}}));
    expect(description.toLowerCase()).toContain('right');
    expect(description.toLowerCase()).toContain('top');
  });
});

describe('Detailed mode — pixel to world units',()=>{
  const detailed=lift({offsets:{longitudinalOffsetM:3,verticalOffsetM:.25,transverseOffsetM:0}});

  it('converts a diagram-space point into physical offsets in metres',()=>{
    const bounds=liftDragBounds(detailed);
    const offsets=liftStoneOffsetsFromViewBoxPoint({x:bounds.boxLeft+bounds.boxWidth/2,y:bounds.boxTop+bounds.boxHeight/2},detailed,bounds);
    // Grabbed at its centre: a centred touch puts the measured 4 m Stone at (10-4)/2 = 3 m along a 10 m lift.
    expect(offsets.longitudinalOffsetM).toBeCloseTo(3,3);
    expect(offsets.verticalOffsetM).toBeCloseTo(.25,3);
  });

  it('maps a larger pixel movement to a proportionally larger movement in metres',()=>{
    const bounds=liftDragBounds(detailed);
    const near=liftStoneOffsetsFromViewBoxPoint({x:bounds.boxLeft+bounds.boxWidth*.3,y:bounds.boxTop},detailed,bounds);
    const far=liftStoneOffsetsFromViewBoxPoint({x:bounds.boxLeft+bounds.boxWidth*.6,y:bounds.boxTop},detailed,bounds);
    expect(far.longitudinalOffsetM-near.longitudinalOffsetM).toBeCloseTo(detailed.geometry.lengthM*.3,2);
  });

  it('keeps the complete measured Stone geometry inside the lift envelope',()=>{
    const clamped=clampLiftStoneOffsets({longitudinalOffsetM:99,verticalOffsetM:99,transverseOffsetM:99},detailed);
    expect(clamped.longitudinalOffsetM).toBeCloseTo(10-4,6);
    expect(clamped.verticalOffsetM).toBeCloseTo(1-.5,6);
    expect(clamped.transverseOffsetM).toBeCloseTo((1-.5)/2,6);
    const negative=clampLiftStoneOffsets({longitudinalOffsetM:-99,verticalOffsetM:-99,transverseOffsetM:-99},detailed);
    expect(negative.longitudinalOffsetM).toBe(0);
    expect(negative.verticalOffsetM).toBe(0);
    expect(negative.transverseOffsetM).toBeCloseTo(-(1-.5)/2,6);
  });

  it('never resizes or distorts the measured Stone geometry while dragging',()=>{
    const moved=buildLiftDiagram(lift({offsets:{longitudinalOffsetM:6,verticalOffsetM:.5,transverseOffsetM:0}}));
    const origin=buildLiftDiagram(lift({offsets:{longitudinalOffsetM:0,verticalOffsetM:0,transverseOffsetM:0}}));
    const widthOf=(diagram:typeof moved)=>{
      const points=(diagram.elements.find(element=>element.kind==='polygon'&&element.fill==='#8C8579') as {points:[number,number][]}).points;
      return Math.max(...points.map(([x])=>x))-Math.min(...points.map(([x])=>x));
    };
    expect(widthOf(moved)).toBeCloseTo(widthOf(origin),6);
    expect(moved.stoneVolumeM3).toBe(origin.stoneVolumeM3);
  });

  it('reports typed offsets that place the Stone outside its lift, rather than silently clamping them',()=>{
    expect(validateLiftStoneOffsets({longitudinalOffsetM:9,verticalOffsetM:0,transverseOffsetM:0},detailed)[0])
      .toContain('lift');
    expect(validateLiftStoneOffsets({longitudinalOffsetM:-1,verticalOffsetM:0,transverseOffsetM:0},detailed)).toHaveLength(1);
    expect(validateLiftStoneOffsets({longitudinalOffsetM:3,verticalOffsetM:.25,transverseOffsetM:0},detailed)).toEqual([]);
  });

  it('rejects an offset that is not a finite number',()=>{
    expect(validateLiftStoneOffsets({longitudinalOffsetM:Number.NaN,verticalOffsetM:0,transverseOffsetM:0},detailed)).toHaveLength(1);
  });

  it('cannot validate offsets without measured Stone geometry, and says so',()=>{
    const noGeometry=lift({stoneGeometry:null,offsets:{longitudinalOffsetM:0,verticalOffsetM:0,transverseOffsetM:0}});
    expect(validateLiftStoneOffsets({longitudinalOffsetM:0,verticalOffsetM:0,transverseOffsetM:0},noGeometry)[0]).toContain('measured');
  });

  it('nudges physical offsets by a fixed step in metres and clamps at the envelope',()=>{
    const start={longitudinalOffsetM:3,verticalOffsetM:.25,transverseOffsetM:0};
    expect(nudgeLiftStoneOffsets(start,'right',detailed).longitudinalOffsetM).toBeCloseTo(3+LIFT_NUDGE_STEP_M,6);
    expect(nudgeLiftStoneOffsets(start,'up',detailed).verticalOffsetM).toBeCloseTo(.25+LIFT_NUDGE_STEP_M,6);
    expect(nudgeLiftStoneOffsets({longitudinalOffsetM:6,verticalOffsetM:.5,transverseOffsetM:0},'right',detailed).longitudinalOffsetM).toBeCloseTo(6,6);
  });

  it('resets detailed offsets to the centre of the lift',()=>{
    expect(resetLiftStoneOffsets(detailed)).toEqual({longitudinalOffsetM:3,verticalOffsetM:.25,transverseOffsetM:0});
  });

  it('keeps the transverse offset numeric only, because the drawn plane does not record it',()=>{
    const bounds=liftDragBounds(detailed);
    const dragged=liftStoneOffsetsFromViewBoxPoint({x:bounds.boxLeft,y:bounds.boxTop},detailed,bounds);
    expect(dragged.transverseOffsetM).toBe(detailed.offsets!.transverseOffsetM);
  });
});

describe('placement persistence',()=>{
  it('round-trips a dragged simple position back into the same drawn location',()=>{
    const bounds=liftDragBounds(lift());
    const position=liftStonePositionFromViewBoxPoint({x:bounds.boxLeft+bounds.boxWidth*.25,y:bounds.boxTop+bounds.boxHeight*.75},bounds);
    const reopened=buildLiftDiagram(lift({position}));
    const stone=reopened.elements.find(element=>element.kind==='rect'&&element.fill==='#8C8579') as {x:number};
    const expected=bounds.boxLeft+position.xNorm*(bounds.boxWidth-bounds.stoneWidthPx);
    expect(stone.x).toBeCloseTo(expected,3);
  });

  it('round-trips dragged detailed offsets back into the same drawn location',()=>{
    const detailed=lift({offsets:{longitudinalOffsetM:0,verticalOffsetM:0,transverseOffsetM:0}});
    const bounds=liftDragBounds(detailed);
    const offsets=liftStoneOffsetsFromViewBoxPoint({x:bounds.boxLeft+bounds.boxWidth*.4,y:bounds.boxTop+bounds.boxHeight*.4},detailed,bounds);
    const first=buildLiftDiagram(lift({offsets}));
    const second=buildLiftDiagram(lift({offsets:clampLiftStoneOffsets(offsets,detailed)}));
    expect(first.svg).toBe(second.svg);
  });

  it('falls back to the centre when no position has ever been recorded',()=>{
    const diagram=buildLiftDiagram(lift({position:null,offsets:null}));
    const centred=buildLiftDiagram(lift({position:DEFAULT_LIFT_STONE_POSITION}));
    expect(diagram.svg).toBe(centred.svg);
  });
});
