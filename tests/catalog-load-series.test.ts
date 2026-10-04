import {afterEach,describe,expect,it} from 'vitest';

import {SqliteCatalogRepository} from '../src/data/repositories/SqliteCatalogRepository';
import {SqliteLoadNumberSeriesRepository} from '../src/data/repositories/SqliteLoadNumberSeriesRepository';
import {type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/** DEC-500 (6). The item editor chooses an item's Company Load Number Series in the same save. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const fixture=await recordsDatabase(databases);
  const series=new SqliteLoadNumberSeriesRepository(fixture.db as never);
  const asp=await series.createSeries({prefix:'ASP',displayName:'Asphalt',itemIds:[]});
  return {...fixture,catalog:new SqliteCatalogRepository(fixture.db as never),series,asp};
}
const draft={categoryId:'cat',name:'Asphalt 0/12',usageAreas:['loads' as const]};

describe('item load number series',()=>{
  it('saves the chosen series with a new item and reports it back',async()=>{
    const {catalog,asp}=await setup();
    const item=await catalog.createItem({...draft,loadNumberSeriesId:asp.id});
    expect(item.loadNumberSeriesId).toBe(asp.id);
    expect((await catalog.listItems()).find(value=>value.id===item.id)?.loadNumberSeriesId).toBe(asp.id);
  });

  it('stores the default series as no assignment, and leaves the assignment alone when not given',async()=>{
    const {catalog,asp}=await setup();
    const item=await catalog.createItem({...draft,loadNumberSeriesId:'series_load'});
    expect(item.loadNumberSeriesId).toBeNull();
    await catalog.updateItem(item.id,{...draft,loadNumberSeriesId:asp.id});
    const kept=await catalog.updateItem(item.id,{...draft,name:'Asphalt 0/14'});
    expect(kept.loadNumberSeriesId).toBe(asp.id);
  });

  it('refuses an inactive or unknown series and saves nothing',async()=>{
    const {db,catalog,series,asp}=await setup();
    await series.setSeriesActive(asp.id,false);
    await expect(catalog.createItem({...draft,loadNumberSeriesId:asp.id})).rejects.toThrow('Choose an active load number series.');
    await expect(catalog.createItem({...draft,loadNumberSeriesId:'nope'})).rejects.toThrow('Choose an active load number series.');
    expect(db.raw.prepare("SELECT COUNT(*) n FROM catalog_items WHERE name='Asphalt 0/12'").get()).toEqual({n:0});
  });
});
