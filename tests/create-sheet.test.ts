import {describe,expect,it} from 'vitest';

import {createGroups,type CreateAction} from '../src/domain/createActions';

/**
 * The Create (+) sheet: the same ten actions as before, in three groups with Make Receipt as the main tile, a slim project bar, and a short
 * "Needs project" label where an action cannot start without a project.
 */
const read=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;
const sheet=read('src/ui/components/CreateActionSheet.tsx'),app=read('src/ui/DromexApp.tsx');
const all=createGroups.flatMap(group=>group.actions);

describe('the actions (pure)',()=>{
  it('keeps all ten actions, each exactly once, with the same names as the old list',()=>{
    const expected:Record<CreateAction,string>={receipt:'Make Receipt',dailyReport:'Daily Report',schedule:'Scheduled Work',waste:'Waste Dump',quarry:'Supplier Load',fuelDelivery:'Fuel Delivery',equipmentFill:'Equipment Fill',quickText:'Quick Text',issue:'Project Issue',photo:'Site Photo'};
    expect(all).toHaveLength(10);
    expect(new Set(all.map(action=>action.id)).size).toBe(10);
    for(const [id,title] of Object.entries(expected))expect(all.find(action=>action.id===id)?.title,id).toBe(title);
  });
  it('groups them as Loads and documents, Site work, then Material and fuel, with Make Receipt first',()=>{
    expect(createGroups.map(group=>group.title)).toEqual(['LOADS AND DOCUMENTS','SITE WORK','MATERIAL AND FUEL']);
    expect(createGroups[0]!.actions[0]!.id).toBe('receipt');
    expect(createGroups.map(group=>group.actions.map(action=>action.id))).toEqual([['receipt','quickText'],['dailyReport','schedule','waste','issue','photo'],['quarry','fuelDelivery','equipmentFill']]);
  });
  it('marks only the actions that go to the Projects list when no project is chosen',()=>{
    expect(all.filter(action=>action.needsProject).map(action=>action.id)).toEqual(['issue','photo']);
    // The code agrees: these two fall through to the Projects screen when there is no active project.
    expect(app).toContain("else if(activeProject){setCommandProject(activeProject);setProjectPanel(action==='issue'?'issues':'photos');navigate('projectCommand');}else navigate('projects');");
  });
  it('gives every action a short hint', ()=>{
    for(const action of all){expect(action.hint.length,action.id).toBeGreaterThan(5);expect(action.hint.length,action.id).toBeLessThan(40);}
  });
});

describe('the sheet (screen)',()=>{
  it('shows a short title and one slim project line instead of the long hint and the big card',()=>{
    expect(sheet).toContain('What are you recording?');expect(sheet).not.toContain('Choose one clear field action');
    expect(sheet).toContain('PROJECT</Text>');expect(sheet).toContain("{activeProject?'Change':'Choose'}");expect(sheet).toContain("'None chosen'");
    expect(sheet).not.toContain('ACTIVE PROJECT');
  });
  it('draws Make Receipt as the main tile and the rest as tiles in groups, with the label only when it is true',()=>{
    expect(sheet).toContain("const primary=group.tone==='orange'&&index===0");
    expect(sheet).toContain('needs=action.needsProject&&!activeProject');expect(sheet).toContain('Needs project</Text>');
    expect(sheet).toContain('{createGroups.map(group=>');
  });
  it('is reachable for a screen reader: each tile says what it does and whether it needs a project',()=>{
    expect(sheet).toContain("accessibilityLabel={`${action.title}. ${action.hint}${needs?'. Needs a project, you will choose one first':''}`}");
    expect(sheet).toContain('accessibilityLabel="Close"');
  });
  it('keeps the exports the app uses',()=>{
    expect(sheet).toContain('export type {CreateAction};');expect(sheet).toContain('export function CreateActionSheet(');
    expect(app).toContain("import {CreateActionSheet,type CreateAction} from './components/CreateActionSheet';");
  });
});
