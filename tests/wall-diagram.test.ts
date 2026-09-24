import {describe,expect,it} from 'vitest';

import {
  buildWallDiagram,layerAppearance,LAYER_THICKNESS_TOLERANCE_M,validateWallLayers,type WallDiagramInput,type WallLayerDraft,
} from '../src/domain/wallDiagram';
import {calculateWallVolume} from '../src/domain/walls';

const wall={name:'Retaining wall A',lengthM:20,heightM:4,bottomThicknessM:.8,topThicknessM:.4};
const uniform={name:'Boundary wall B',lengthM:12,heightM:2.5,bottomThicknessM:.3,topThicknessM:.3};
const layer=(overrides:Partial<WallLayerDraft>&{name:string;phaseOrder:number}):WallLayerDraft=>({bottomThicknessM:.2,topThicknessM:.2,note:'',materialKey:null,...overrides});
const diagram=(input:Partial<WallDiagramInput>={})=>buildWallDiagram({wall,layers:[],base:null,...input});

describe('wall layer validation',()=>{
  const layers=[layer({name:'Structural core',phaseOrder:1,bottomThicknessM:.6,topThicknessM:.3}),layer({name:'Stone facing',phaseOrder:2,bottomThicknessM:.2,topThicknessM:.1})];

  it('accepts layers whose thicknesses sum to the wall thickness',()=>{
    expect(validateWallLayers(layers,wall)).toEqual([]);
  });

  it('accepts a wall with no layers at all',()=>{
    expect(validateWallLayers([],wall)).toEqual([]);
  });

  it('reports the exact difference when the bottom or top sums disagree',()=>{
    expect(validateWallLayers([layer({name:'Core',phaseOrder:1,bottomThicknessM:.5,topThicknessM:.4})],wall))
      .toEqual(['Layer bottom thicknesses total 0.5 m but the wall bottom thickness is 0.8 m, a difference of 0.3 m.']);
    expect(validateWallLayers([layer({name:'Core',phaseOrder:1,bottomThicknessM:.8,topThicknessM:.55})],wall))
      .toEqual(['Layer top thicknesses total 0.55 m but the wall top thickness is 0.4 m, a difference of 0.15 m.']);
  });

  it('accepts a difference inside the tolerance and rejects one just outside it',()=>{
    const inside=[layer({name:'Core',phaseOrder:1,bottomThicknessM:.8-LAYER_THICKNESS_TOLERANCE_M,topThicknessM:.4})];
    const outside=[layer({name:'Core',phaseOrder:1,bottomThicknessM:.8-LAYER_THICKNESS_TOLERANCE_M*2,topThicknessM:.4})];
    expect(validateWallLayers(inside,wall)).toEqual([]);
    expect(validateWallLayers(outside,wall)).toHaveLength(1);
  });

  it('rejects duplicate, missing, and non-integer phase order',()=>{
    expect(validateWallLayers([layer({name:'A',phaseOrder:1,bottomThicknessM:.4,topThicknessM:.2}),layer({name:'B',phaseOrder:1,bottomThicknessM:.4,topThicknessM:.2})],wall)).toContain('Two layers cannot share construction phase 1.');
    expect(validateWallLayers([layer({name:'A',phaseOrder:0,bottomThicknessM:.8,topThicknessM:.4})],wall)).toContain('Construction phase must be a whole number of 1 or more.');
    expect(validateWallLayers([layer({name:'A',phaseOrder:1.5,bottomThicknessM:.8,topThicknessM:.4})],wall)).toContain('Construction phase must be a whole number of 1 or more.');
  });

  it('rejects an empty name and invalid or non-positive thicknesses',()=>{
    expect(validateWallLayers([layer({name:'   ',phaseOrder:1,bottomThicknessM:.8,topThicknessM:.4})],wall)).toContain('Every layer needs a material or layer name.');
    expect(validateWallLayers([layer({name:'A',phaseOrder:1,bottomThicknessM:0,topThicknessM:.4})],wall)).toContain('Layer 1 bottom thickness must be greater than zero with no more than three decimals.');
    expect(validateWallLayers([layer({name:'A',phaseOrder:1,bottomThicknessM:-.2,topThicknessM:.4})],wall)).toContain('Layer 1 bottom thickness must be greater than zero with no more than three decimals.');
    expect(validateWallLayers([layer({name:'A',phaseOrder:1,bottomThicknessM:Number.NaN,topThicknessM:.4})],wall)).toContain('Layer 1 bottom thickness must be greater than zero with no more than three decimals.');
    expect(validateWallLayers([layer({name:'A',phaseOrder:1,bottomThicknessM:.8,topThicknessM:Number.POSITIVE_INFINITY})],wall)).toContain('Layer 1 top thickness must be greater than zero with no more than three decimals.');
  });

  it('never rewrites the entered thicknesses to make the sum match',()=>{
    const entered=[layer({name:'Core',phaseOrder:1,bottomThicknessM:.5,topThicknessM:.4})];
    validateWallLayers(entered,wall);
    expect(entered[0]).toMatchObject({bottomThicknessM:.5,topThicknessM:.4});
  });
});

describe('deterministic layer appearance',()=>{
  it('gives the same material the same colour and pattern every time',()=>{
    const {marker:_first,...once}=layerAppearance('Stone facing',1);
    const {marker:_second,...again}=layerAppearance('Stone facing',5);
    expect(once).toEqual(again);
    expect(layerAppearance('Stone facing',1).fill).not.toBe(layerAppearance('Structural core',1).fill);
  });

  it('never relies on colour alone: every layer carries a pattern and a numbered marker',()=>{
    const appearance=layerAppearance('Stone facing',3);
    expect(appearance.pattern).toMatch(/^(solid|diagonal|cross|dots|horizontal|vertical)$/);
    expect(appearance.marker).toBe(3);
    expect(appearance.fill).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('generated wall diagram',()=>{
  it('is a self-contained SVG with no script, external resource, or raster image',()=>{
    const {svg}=diagram();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox=');
    for(const forbidden of ['<script','<image','<foreignObject','href=','url(','xlink:','<iframe','javascript:'])expect(svg).not.toContain(forbidden);
  });

  it('draws a geometry-only diagram when no layers are recorded, without inventing materials',()=>{
    const {svg,legend,exaggerated}=diagram();
    expect(legend).toEqual([]);
    expect(exaggerated).toBe(false);
    expect(svg).toContain('20 m');
    expect(svg).toContain('4 m');
    expect(svg).toContain('No layers recorded');
    expect(svg).not.toContain('Phase');
  });

  it('labels the elevation and cross-section with real dimensions and marks a tapered wall',()=>{
    const tapered=diagram().svg,plain=diagram({wall:uniform}).svg;
    expect(tapered).toContain('Elevation');
    expect(tapered).toContain('Cross-section');
    expect(tapered).toContain('0.8 m');
    expect(tapered).toContain('0.4 m');
    expect(tapered).toContain('Tapered');
    expect(plain).toContain('0.3 m');
    expect(plain).not.toContain('Tapered');
  });

  it('shows the same geometry the volume formula uses',()=>{
    const {svg}=diagram();
    const volume=calculateWallVolume(wall.lengthM,wall.heightM,wall.bottomThicknessM,wall.topThicknessM,0);
    expect(svg).toContain(`${volume.grossVolumeM3} m³`);
  });

  it('stacks layers in phase order with markers, patterns, and a legend',()=>{
    const layers=[layer({name:'Stone facing',phaseOrder:2,bottomThicknessM:.2,topThicknessM:.1}),layer({name:'Structural core',phaseOrder:1,bottomThicknessM:.6,topThicknessM:.3})];
    const {svg,legend}=diagram({layers});
    expect(legend.map(entry=>[entry.phase,entry.name])).toEqual([[1,'Structural core'],[2,'Stone facing']]);
    expect(legend.every(entry=>entry.pattern&&entry.marker>0)).toBe(true);
    expect(svg.indexOf('Structural core')).toBeLessThan(svg.indexOf('Stone facing'));
    expect(svg).toContain('Phase 1');
    expect(svg).toContain('Phase 2');
    expect(svg.match(/<pattern /g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a very thin layer visible and says so, without changing the stated measurement',()=>{
    const layers=[layer({name:'Core',phaseOrder:1,bottomThicknessM:.79,topThicknessM:.39}),layer({name:'Thin finish',phaseOrder:2,bottomThicknessM:.01,topThicknessM:.01})];
    const {svg,exaggerated,legend}=diagram({layers});
    expect(exaggerated).toBe(true);
    expect(svg).toContain('Thin layers shown wider than scale');
    expect(legend.find(entry=>entry.name==='Thin finish')).toMatchObject({bottomThicknessM:.01,topThicknessM:.01});
    expect(svg).toContain('0.01 m');
  });

  it('handles many layers, long names, and extreme dimensions without overflowing the drawing',()=>{
    const many=Array.from({length:9},(_,index)=>layer({name:`Layer number ${index+1} with a very long descriptive material name`,phaseOrder:index+1,bottomThicknessM:.8/9,topThicknessM:.4/9}));
    const {svg}=buildWallDiagram({wall:{...wall,lengthM:180,heightM:.6},layers:many,base:null});
    const viewBox=/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
    expect(viewBox).toBeTruthy();
    const width=Number(viewBox![1]),height=Number(viewBox![2]);
    for(const match of svg.matchAll(/<(?:rect|text)[^>]*?\sx="(-?\d+(?:\.\d+)?)"/g))expect(Number(match[1])).toBeGreaterThanOrEqual(0);
    for(const match of svg.matchAll(/<(?:rect|text)[^>]*?\sy="(-?\d+(?:\.\d+)?)"/g)){expect(Number(match[1])).toBeGreaterThanOrEqual(0);expect(Number(match[1])).toBeLessThanOrEqual(height);}
    expect(width).toBeLessThanOrEqual(900);
    expect(svg).toContain('Layer number 9');
  });

  it('escapes user text and never lets it inject markup or a resource',()=>{
    const hostile=[layer({name:'<script>alert("x")</script>',phaseOrder:1,bottomThicknessM:.8,topThicknessM:.4,note:'" onload="alert(1)'})];
    const {svg}=diagram({layers:hostile,wall:{...wall,name:'Wall & "A" <b>'}});
    expect(svg).not.toContain('<script');
    // The hostile text may appear as escaped content, but never as a real attribute: every quote it
    // contains is escaped, so it cannot close an attribute and start a new one.
    expect(svg).not.toMatch(/"\s+onload="/);
    expect(svg).toContain('&quot; onload=&quot;');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
  });

  it('keeps Arabic and mixed-direction labels readable and intact',()=>{
    const arabic=[layer({name:'حجر الواجهة',phaseOrder:1,bottomThicknessM:.8,topThicknessM:.4,note:'طبقة خارجية'})];
    const {svg}=diagram({layers:arabic});
    expect(svg).toContain('حجر الواجهة');
    expect(svg).toMatch(/direction="rtl"|dir="rtl"/);
    expect(svg).toContain('Phase 1');
  });
});
