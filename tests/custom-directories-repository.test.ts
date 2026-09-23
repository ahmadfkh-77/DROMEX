import {afterEach,describe,expect,it} from 'vitest';

import {SqliteCustomDirectoryRepository} from '../src/data/repositories/SqliteCustomDirectoryRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {addCustomResourceEntry,setCustomResourceNote} from '../src/domain/customDirectories';
import {emptyDailyReport} from '../src/domain/projectReports';
import {migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/** DEC-478. Owner-defined resource directories in two generic tables, snapshotted into reports. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=await migratedDatabaseWithProject(databases);
  return {database,directories:new SqliteCustomDirectoryRepository(database as never),reports:new SqliteProjectReportRepository(database as never)};
}

describe('directories',()=>{
  it('creates directories in display order with a normalized, unique name',async()=>{
    const {directories}=await setup();
    const engineers=await directories.createDirectory({name:'  Site   Engineers ',description:'Resident and site engineers'});
    const pickups=await directories.createDirectory({name:'Pickups'});
    expect(engineers).toMatchObject({name:'Site Engineers',description:'Resident and site engineers',isActive:true});
    expect((await directories.listDirectories()).map(value=>value.id)).toEqual([engineers.id,pickups.id]);
    await expect(directories.createDirectory({name:'site ENGINEERS'})).rejects.toThrow('A directory named "Site Engineers" already exists.');
    await expect(directories.createDirectory({name:'   '})).rejects.toThrow('Directory name is required.');
    await expect(directories.createDirectory({name:'x'.repeat(61)})).rejects.toThrow('60 characters or fewer');
  });

  it('renames in place and keeps its id; a rename into another directory\'s name is refused',async()=>{
    const {directories}=await setup();
    const engineers=await directories.createDirectory({name:'Engineers'});
    await directories.createDirectory({name:'Surveyors'});
    expect(await directories.updateDirectory(engineers.id,{name:'Site Engineers'})).toMatchObject({id:engineers.id,name:'Site Engineers'});
    await expect(directories.updateDirectory(engineers.id,{name:'surveyors'})).rejects.toThrow('already exists');
    await expect(directories.updateDirectory('missing',{name:'X'})).rejects.toThrow('Directory was not found.');
  });

  it('archives instead of deleting, and reorders by stable id',async()=>{
    const {directories}=await setup();
    const a=await directories.createDirectory({name:'A'});
    const b=await directories.createDirectory({name:'B'});
    await directories.moveDirectory(b.id,-1);
    expect((await directories.listDirectories()).map(value=>value.name)).toEqual(['B','A']);
    await directories.setDirectoryActive(a.id,false);
    expect((await directories.listDirectories()).find(value=>value.id===a.id)?.isActive).toBe(false);
  });
});

describe('entries',()=>{
  it('adds entries with an optional identifier and notes, unique by name within one directory only',async()=>{
    const {directories}=await setup();
    const engineers=await directories.createDirectory({name:'Engineers'});
    const pickups=await directories.createDirectory({name:'Pickups'});
    const rami=await directories.createEntry(engineers.id,{name:'Rami Saad',identifier:'ENG-4',notes:'Resident engineer'});
    expect(rami).toMatchObject({directoryId:engineers.id,name:'Rami Saad',identifier:'ENG-4',notes:'Resident engineer',isActive:true});
    await expect(directories.createEntry(engineers.id,{name:'rami  saad'})).rejects.toThrow('"Rami Saad" is already in Engineers.');
    await expect(directories.createEntry(pickups.id,{name:'Rami Saad'})).resolves.toMatchObject({directoryId:pickups.id});
    await expect(directories.createEntry('missing',{name:'X'})).rejects.toThrow('Directory was not found.');
  });

  it('edits, archives and reorders entries by stable id',async()=>{
    const {directories}=await setup();
    const pickups=await directories.createDirectory({name:'Pickups'});
    const first=await directories.createEntry(pickups.id,{name:'Pickup 1'});
    const second=await directories.createEntry(pickups.id,{name:'Pickup 2',identifier:'ABC 123'});
    await directories.moveEntry(second.id,-1);
    expect((await directories.listEntries(pickups.id)).map(value=>value.name)).toEqual(['Pickup 2','Pickup 1']);
    expect(await directories.updateEntry(first.id,{name:'Pickup One',identifier:'  ',notes:''})).toMatchObject({id:first.id,name:'Pickup One',identifier:null,notes:null});
    await directories.setEntryActive(first.id,false);
    expect((await directories.listEntries(pickups.id)).find(value=>value.id===first.id)?.isActive).toBe(false);
  });

  it('offers only active directories with their active entries for new selection',async()=>{
    const {directories}=await setup();
    const engineers=await directories.createDirectory({name:'Engineers'});
    const retired=await directories.createDirectory({name:'Retired'});
    await directories.createEntry(retired.id,{name:'Old'});
    await directories.setDirectoryActive(retired.id,false);
    await directories.createEntry(engineers.id,{name:'Rami'});
    const archived=await directories.createEntry(engineers.id,{name:'Archived'});
    await directories.setEntryActive(archived.id,false);
    const options=await directories.listSelectionOptions();
    expect(options.map(group=>[group.directory.name,group.entries.map(entry=>entry.name)])).toEqual([['Engineers',['Rami']]]);
  });

  it('queues each change for synchronization',async()=>{
    const {database,directories}=await setup();
    const engineers=await directories.createDirectory({name:'Engineers'});
    await directories.createEntry(engineers.id,{name:'Rami'});
    const types=database.raw.prepare('SELECT entity_type FROM sync_outbox ORDER BY id').all().map(row=>(row as {entity_type:string}).entity_type);
    expect(types).toEqual(['customDirectory','customDirectoryEntry']);
  });
});

describe('Daily Report custom resource snapshots',()=>{
  it('saves the snapshot and keeps it unchanged after the directory and entry are renamed and archived',async()=>{
    const {directories,reports}=await setup();
    const engineers=await directories.createDirectory({name:'Engineers'});
    const rami=await directories.createEntry(engineers.id,{name:'Rami Saad',identifier:'ENG-4'});
    let snapshots=addCustomResourceEntry([],engineers,rami,[engineers.id]);
    snapshots=setCustomResourceNote(snapshots,engineers.id,rami.id,'Checked formwork');
    await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-20',workDescription:'Formwork',customResources:snapshots});
    await directories.updateDirectory(engineers.id,{name:'Site Engineers'});
    await directories.updateEntry(rami.id,{name:'Rami S.',identifier:'ENG-99'});
    await directories.setEntryActive(rami.id,false);
    await directories.setDirectoryActive(engineers.id,false);
    const saved=(await reports.listReports('road'))[0]!;
    expect(saved.customResources).toEqual([{directoryId:engineers.id,directoryName:'Engineers',entries:[{entryId:rami.id,name:'Rami Saad',identifier:'ENG-4',note:'Checked formwork'}]}]);
  });

  it('exposes active directory options to the report editor and reads old reports as having none',async()=>{
    const {directories,reports}=await setup();
    const engineers=await directories.createDirectory({name:'Engineers'});
    await directories.createEntry(engineers.id,{name:'Rami'});
    expect((await reports.getSetup()).customDirectories.map(group=>group.directory.name)).toEqual(['Engineers']);
    await reports.saveReport({...emptyDailyReport('road'),workDate:'2026-08-21',workDescription:'Work'});
    expect((await reports.listReports('road'))[0]!.customResources).toEqual([]);
  });
});
