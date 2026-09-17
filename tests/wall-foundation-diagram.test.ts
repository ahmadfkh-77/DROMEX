import {describe,expect,it} from 'vitest';

import {buildFoundationDiagram,type FoundationDiagramInput} from '../src/domain/wallFoundationDiagram';

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
});
