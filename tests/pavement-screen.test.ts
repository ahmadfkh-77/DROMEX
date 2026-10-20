import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';


/**
 * The Asphalt Calculator pages (DEC-519) and the Road sections editor (DEC-518), checked from the source because the screens need a device.
 * The pure rules and the saved data are tested in pavement-sections.test.ts and pavement-form.test.ts.
 */
const read=(path:string)=>readFileSync(path,'utf8');
const screen=read('src/ui/screens/PavementCalculatorScreen.tsx');
const editor=read('src/ui/components/PavementSectionsEditor.tsx');
const frame=read('src/ui/components/PavementPageFrame.tsx');
const constant=(name:string)=>new RegExp("export const "+name+"='([^']*)'").exec(editor)?.[1]??'';
const AREA_RULE_TITLE=constant('AREA_RULE_TITLE'),AREA_RULE_BODY=constant('AREA_RULE_BODY');

describe('the calculator is separate pages',()=>{
  it('has the three steps with their own bands and progress dots, then More tools and Saved calculations as pages',()=>{
    for(const text of ["title:'Area'","title:'Rate and thickness'","title:'Result'","title:'More tools'","title:'Saved calculations'"])expect(screen).toContain(text);
    for(const tone of ["tone:'navy'","tone:'orange'","tone:'teal'","tone:'cream'"])expect(screen).toContain(tone);
    expect(screen).toContain('dots={{total:3,current:1}}');expect(screen).toContain('dots={{total:3,current:2}}');expect(screen).toContain('dots={{total:3,current:3}}');
    expect(frame).toContain('accessibilityRole="progressbar"');expect(frame).toContain('Step ${dots.current} of ${dots.total}');
  });
  it('moves on with Next, goes back with Back, and saves from the Result page',()=>{
    for(const text of ["label:'Next',onPress:nextFromArea","label:'Next',onPress:nextFromRate","label:editingId?'Update':'Save'","secondary:{label:'Back'"])expect(screen).toContain(text);
    expect(screen).toContain('areaPageIssue(form,area)');expect(screen).toContain('ratePageIssue(form)');
  });
  it('no longer folds the core sections or uses cards and stripes, and keeps the seven tools and their formulas',()=>{
    expect(screen).not.toContain('ExpandableMenuSection');expect(screen).not.toContain('<AppCard');expect(screen).not.toContain('borderLeftWidth');
    expect(screen).toContain('<PavementAdvancedSections areaM2={area.areaM2} plannedTonnes={result?.plannedTonnes??0}');
    expect(screen).toContain('calculatePavement(area.areaM2,rate,density,Math.max(0,allowance))');
  });
  it('gives the area three ways, each with its own fields, and the truck count uses a payload that is not saved',()=>{
    for(const text of ["label:'Length × width'","label:'Road sections'","label:'Direct area'","form.areaMode==='sections'",'<PavementSectionsEditor','Truck payload (t)'])expect(screen).toContain(text);
    expect(screen).toContain('trucksForPlanned(result.plannedTonnes,formNumber(payload))');
    expect(screen).not.toContain('payload:');
  });
});

describe('the Road sections editor',()=>{
  it('shows the area rule as plain text above the first section, never inside a fold, popup or alert',()=>{
    expect(AREA_RULE_TITLE).toBe('Section area = Length × (Width 1 + Width 2) ÷ 2.');
    expect(AREA_RULE_BODY).toBe('Example: 10 × (4 + 4.4) ÷ 2 = 42.0 m². Total area = the sum of all section areas. Straight edges are assumed inside each section: if the road bends or the width changes unevenly, split it into more sections.');
    expect(editor.indexOf('{AREA_RULE_TITLE}')).toBeGreaterThan(0);expect(editor.indexOf('{AREA_RULE_TITLE}')).toBeLessThan(editor.indexOf('{sections.map('));
    for(const forbidden of ['ExpandableMenuSection','Modal','Alert','Tooltip','open&&','collapsed'])expect(editor,forbidden).not.toContain(forbidden);
    expect(editor).toContain('accessibilityRole="text"');
  });
  it('adds, duplicates and removes sections, starts a new one at the last Width 2, and names a problem in the error panel',()=>{
    for(const text of ['nextSectionWidthStart(sections)','duplicateSectionText(sections[index]!)','+ Add section','Duplicate','Remove','analysis.errors.join'])expect(editor).toContain(text);
    expect(editor).toContain('showErrors&&analysis.errors.length');
  });
  it('shows each section\'s own area and the total, in the result teal',()=>{
    for(const text of ['analysis.areas[index]','TOTAL AREA','analysis.totalM2','colors.resultDark','colors.result,'])expect(editor).toContain(text);
  });
});

describe('the shared pieces keep their default look',()=>{
  it('adds the open field as an opt-in variant only',()=>{
    const primitives=read('src/ui/components/AppPrimitives.tsx');
    expect(primitives).toContain("variant?:'open'");expect(primitives).toContain('open?styles.inputOpen:styles.input');
  });
});
