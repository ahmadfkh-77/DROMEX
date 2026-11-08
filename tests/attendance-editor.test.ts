import {describe,expect,it} from 'vitest';

import type {AttendanceEntry,AttendancePlace,AttendanceSubject} from '../src/domain/attendance';
import {
  addTypedPlace,countWorked,diffEditor,editorFromEntries,editorKey,missingPlaces,togglePlace,toggleWorked,type EditorState,
} from '../src/domain/attendanceEditor';

/** DEC-544. The editing rules of the attendance screen, apart from the screen itself. Nothing is saved until Save attendance. */
const samir:AttendanceSubject={type:'person',id:'d1'};
const omar:AttendanceSubject={type:'person',id:'d2'};
const truck:AttendanceSubject={type:'truck',id:'t1'};
const road:AttendancePlace={type:'project',id:'p1',name:'Haret Saida road'};
const plant:AttendancePlace={type:'company_site',id:'s1',name:'Majbal'};
const entry=(subject:AttendanceSubject,places:AttendancePlace[],name='X'):AttendanceEntry=>({id:`e-${subject.id}`,workDate:'2026-11-06',subjectType:subject.type,subjectId:subject.id,name,detail:null,places});

describe('marking and unmarking',()=>{
  it('marks someone as worked, and a second tap takes the mark off',()=>{
    let state:EditorState={};
    state=toggleWorked(state,samir);expect(state[editorKey(samir)]).toEqual({worked:true,places:[]});
    state=toggleWorked(state,samir);expect(state[editorKey(samir)]).toBeUndefined();
  });
  it('taking the mark off also clears that person\'s places',()=>{
    let state=togglePlace({},samir,road);state=toggleWorked(state,samir);
    expect(state[editorKey(samir)]).toBeUndefined();
  });
});

describe('adding and removing places',()=>{
  it('adding a place to someone not yet marked marks them as worked',()=>{
    const state=togglePlace({},samir,road);
    expect(state[editorKey(samir)]).toEqual({worked:true,places:[road]});
  });
  it('adds several places in a row, in the order they were chosen',()=>{
    let state=togglePlace({},samir,road);state=togglePlace(state,samir,plant);
    expect(state[editorKey(samir)]!.places.map(p=>p.name)).toEqual(['Haret Saida road','Majbal']);
  });
  it('tapping a chosen place again removes it, and taking the last one off removes the mark',()=>{
    let state=togglePlace({},samir,road);state=togglePlace(state,samir,plant);
    state=togglePlace(state,samir,road);expect(state[editorKey(samir)]!.places.map(p=>p.name)).toEqual(['Majbal']);
    state=togglePlace(state,samir,plant);expect(state[editorKey(samir)]).toBeUndefined();
  });
  it('adds a typed place for the day, once, whatever the capital letters, without an id',()=>{
    let state=addTypedPlace({},truck,'  Yard  ');state=addTypedPlace(state,truck,'yard');
    expect(state[editorKey(truck)]).toEqual({worked:true,places:[{type:'typed',id:null,name:'Yard'}]});
  });
  it('ignores an empty typed place',()=>{expect(addTypedPlace({},truck,'   ')).toEqual({});});
  it('does not change the state it was given',()=>{
    const before:EditorState={};togglePlace(before,samir,road);expect(before).toEqual({});
  });
});

describe('counts and what is missing',()=>{
  it('counts how many of a list worked ("x of N worked")',()=>{
    const state=togglePlace({},samir,road);
    expect(countWorked(state,[samir,omar])).toBe(1);
  });
  it('names who is marked as worked but has no place yet, so Save can ask for one',()=>{
    const state=toggleWorked(togglePlace({},omar,road),samir);
    expect(missingPlaces(state)).toEqual([samir]);
  });
});

describe('what Save has to do',()=>{
  const saved=[entry(samir,[road]),entry(truck,[plant])];
  it('starts from what is saved, so an untouched screen has nothing to save',()=>{
    expect(diffEditor(saved,editorFromEntries(saved))).toEqual({save:[],remove:[]});
  });
  it('saves a newly marked person and a person whose places changed, and removes someone unmarked',()=>{
    let state=editorFromEntries(saved);
    state=togglePlace(state,omar,road);state=togglePlace(state,samir,plant);state=toggleWorked(state,truck);
    const diff=diffEditor(saved,state);
    expect(diff.save.map(s=>[s.subject.id,s.places.map(p=>p.name)])).toEqual([['d1',['Haret Saida road','Majbal']],['d2',['Haret Saida road']]]);
    expect(diff.remove).toEqual([truck]);
  });
  it('does not save a person who is marked but has no place (Save asks for a place instead)',()=>{
    const state=toggleWorked(editorFromEntries(saved),omar);
    expect(diffEditor(saved,state).save).toEqual([]);expect(missingPlaces(state)).toEqual([omar]);
  });
});
