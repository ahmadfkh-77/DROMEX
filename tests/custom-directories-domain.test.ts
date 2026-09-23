import {describe,expect,it} from 'vitest';

import {
  addCustomResourceEntry,customDirectoryNameKey,normalizeCustomResourceSnapshots,removeCustomResourceEntry,
  setCustomResourceNote,validateCustomDirectoryDraft,validateCustomDirectoryEntryDraft,
  type CustomDirectory,type CustomDirectoryEntry,type CustomResourceSnapshot,
} from '../src/domain/customDirectories';

const directory=(id:string,name:string,displayOrder=0):CustomDirectory=>({id,name,description:null,displayOrder,isActive:true,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'});
const entry=(id:string,directoryId:string,name:string,identifier:string|null=null):CustomDirectoryEntry=>({id,directoryId,name,identifier,notes:null,displayOrder:0,isActive:true,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'});

describe('custom directory names (DEC-478)',()=>{
  it('normalizes to a case-insensitive, whitespace-collapsed key',()=>{
    expect(customDirectoryNameKey('  Site   ENGINEERS ')).toBe('site engineers');
    expect(customDirectoryNameKey(' مهندسون ')).toBe('مهندسون');
  });
  it('rejects empty and excessively long names and descriptions',()=>{
    expect(validateCustomDirectoryDraft({name:'   '})).toContain('Directory name is required.');
    expect(validateCustomDirectoryDraft({name:'x'.repeat(61)})).toContain('Directory name must be 60 characters or fewer.');
    expect(validateCustomDirectoryDraft({name:'Engineers',description:'d'.repeat(201)})).toContain('Description must be 200 characters or fewer.');
    expect(validateCustomDirectoryDraft({name:'Engineers',description:'Site and office engineers'})).toEqual([]);
  });
  it('rejects empty or excessively long entries, identifiers and notes',()=>{
    expect(validateCustomDirectoryEntryDraft({name:''})).toContain('Name is required.');
    expect(validateCustomDirectoryEntryDraft({name:'x'.repeat(81)})).toContain('Name must be 80 characters or fewer.');
    expect(validateCustomDirectoryEntryDraft({name:'Pickup 1',identifier:'i'.repeat(61)})).toContain('Identifier must be 60 characters or fewer.');
    expect(validateCustomDirectoryEntryDraft({name:'Pickup 1',notes:'n'.repeat(501)})).toContain('Notes must be 500 characters or fewer.');
    expect(validateCustomDirectoryEntryDraft({name:'Pickup 1',identifier:'ABC 123',notes:'White Hilux'})).toEqual([]);
  });
});

describe('Daily Report custom resource snapshots',()=>{
  const engineers=directory('dir_eng','Engineers',0);
  const pickups=directory('dir_pick','Pickups',1);
  const order=['dir_eng','dir_pick'];

  it('copies the directory name, entry name and identifier at the moment of selection',()=>{
    const snapshots=addCustomResourceEntry([],engineers,entry('e1','dir_eng','Rami Saad','ENG-4'),order);
    expect(snapshots).toEqual([{directoryId:'dir_eng',directoryName:'Engineers',entries:[{entryId:'e1',name:'Rami Saad',identifier:'ENG-4',note:null}]}]);
  });

  it('orders directory groups by the directory order and entries in the order they were selected',()=>{
    let snapshots:CustomResourceSnapshot[]=[];
    snapshots=addCustomResourceEntry(snapshots,pickups,entry('p2','dir_pick','Pickup B'),order);
    snapshots=addCustomResourceEntry(snapshots,engineers,entry('e2','dir_eng','Zeina'),order);
    snapshots=addCustomResourceEntry(snapshots,engineers,entry('e1','dir_eng','Adel'),order);
    expect(snapshots.map(group=>group.directoryId)).toEqual(['dir_eng','dir_pick']);
    expect(snapshots[0]!.entries.map(value=>value.entryId)).toEqual(['e2','e1']);
  });

  it('never adds the same entry twice',()=>{
    const once=addCustomResourceEntry([],engineers,entry('e1','dir_eng','Rami'),order);
    expect(addCustomResourceEntry(once,engineers,entry('e1','dir_eng','Rami'),order)).toEqual(once);
  });

  it('keeps a group\'s recorded directory name when a renamed directory later adds to an existing report',()=>{
    const saved=addCustomResourceEntry([],engineers,entry('e1','dir_eng','Rami'),order);
    const renamed={...engineers,name:'Site Engineers'};
    const next=addCustomResourceEntry(saved,renamed,entry('e2','dir_eng','Nour'),order);
    expect(next[0]!.directoryName).toBe('Engineers');
    expect(next[0]!.entries.map(value=>value.name)).toEqual(['Rami','Nour']);
  });

  it('removes an entry and drops a directory group left empty',()=>{
    const snapshots=addCustomResourceEntry([],engineers,entry('e1','dir_eng','Rami'),order);
    expect(removeCustomResourceEntry(snapshots,'dir_eng','e1')).toEqual([]);
  });

  it('stores a trimmed report-specific note, capped at 300 characters, and clears a blank one',()=>{
    const snapshots=addCustomResourceEntry([],engineers,entry('e1','dir_eng','Rami'),order);
    expect(setCustomResourceNote(snapshots,'dir_eng','e1','  On site until noon ')[0]!.entries[0]!.note).toBe('On site until noon');
    expect(setCustomResourceNote(snapshots,'dir_eng','e1','   ')[0]!.entries[0]!.note).toBeNull();
    expect(setCustomResourceNote(snapshots,'dir_eng','e1','n'.repeat(400))[0]!.entries[0]!.note).toHaveLength(300);
  });

  it('normalizes stored snapshots defensively: malformed values are dropped, empty groups omitted',()=>{
    const stored=[
      {directoryId:'dir_eng',directoryName:'Engineers',entries:[{entryId:'e1',name:'Rami',identifier:null,note:null},{entryId:'',name:'',identifier:null,note:null}]},
      {directoryId:'dir_pick',directoryName:'Pickups',entries:[]},
      'garbage',
      {directoryId:'x'},
    ];
    expect(normalizeCustomResourceSnapshots(stored)).toEqual([{directoryId:'dir_eng',directoryName:'Engineers',entries:[{entryId:'e1',name:'Rami',identifier:null,note:null}]}]);
    expect(normalizeCustomResourceSnapshots('not an array')).toEqual([]);
  });
});
