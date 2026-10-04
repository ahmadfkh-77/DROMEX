import {afterEach,describe,expect,it} from 'vitest';

import {SqliteLoadNumberSeriesRepository,issueLoadNumber} from '../src/data/repositories/SqliteLoadNumberSeriesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {LEGACY_LOAD_NUMBER_LABEL,formatLoadNumber,formatSeriesNumber,loadNumberLabel,normalizeSeriesPrefix,validateSeriesDraft} from '../src/domain/loadNumberSeries';
import {emptyLoadDraft} from '../src/domain/loads';
import {SEED_TIME,type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/** DEC-500 (6)-(7). Configurable Company Load Number Series. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

describe('load number rules',()=>{
  it('formats new numbers as PREFIX-NNNNN (5 digits, no year) and widens past 99999 rather than wrapping',()=>{
    expect(formatSeriesNumber('ASP',1)).toBe('ASP-00001');
    expect(formatSeriesNumber('ASP',58)).toBe('ASP-00058');
    expect(formatSeriesNumber('LOAD',99999)).toBe('LOAD-99999');
    expect(formatSeriesNumber('CON',100000)).toBe('CON-100000');
  });

  it('still formats the PREFIX-YEAR-NNN numbers issued by builds 23 to 25',()=>{
    expect(formatLoadNumber('LOAD',2026,1)).toBe('LOAD-2026-001');
    expect(formatLoadNumber('ASP',2026,42)).toBe('ASP-2026-042');
    expect(formatLoadNumber('AGG',2027,1234)).toBe('AGG-2027-1234');
  });

  it('labels a legacy load honestly instead of inventing a number',()=>{
    expect(loadNumberLabel(null)).toBe(LEGACY_LOAD_NUMBER_LABEL);
    expect(LEGACY_LOAD_NUMBER_LABEL).toBe('Legacy load — no generated load number');
    expect(loadNumberLabel('ASP-2026-001')).toBe('ASP-2026-001');
  });

  it('normalizes a prefix to trimmed upper case',()=>{
    expect(normalizeSeriesPrefix('  asp ')).toBe('ASP');
  });

  it('requires a 2-5 letter prefix, a display name, and a prefix unused by another series',()=>{
    const existing=[{id:'series_load',prefix:'LOAD'},{id:'s_asp',prefix:'ASP'}];
    expect(validateSeriesDraft({prefix:'CON',displayName:'Concrete'},existing)).toEqual([]);
    expect(validateSeriesDraft({prefix:'C',displayName:'Concrete'},existing)).toEqual(['The prefix must be 2 to 5 letters A–Z.']);
    expect(validateSeriesDraft({prefix:'CONCRE',displayName:'Concrete'},existing)).toEqual(['The prefix must be 2 to 5 letters A–Z.']);
    expect(validateSeriesDraft({prefix:'C0N',displayName:'Concrete'},existing)).toEqual(['The prefix must be 2 to 5 letters A–Z.']);
    expect(validateSeriesDraft({prefix:'asp',displayName:'Asphalt again'},existing)).toEqual(['Another series already uses the prefix ASP.']);
    expect(validateSeriesDraft({prefix:'ASP',displayName:'Asphalt'},existing,'s_asp')).toEqual([]);
    expect(validateSeriesDraft({prefix:'CON',displayName:'  '},existing)).toEqual(['Enter a display name.']);
  });
});

async function setup(){
  const fixture=await recordsDatabase(databases);
  return {...fixture,series:new SqliteLoadNumberSeriesRepository(fixture.db as never)};
}

describe('series configuration',()=>{
  it('lists the default LOAD series first with its next number for a year',async()=>{
    const {series}=await setup();
    const list=await series.listSeries(2026);
    expect(list).toEqual([expect.objectContaining({prefix:'LOAD',displayName:'Company loads',isDefault:true,isActive:true,issuedCount:0,prefixLocked:false,itemIds:[],nextNumber:'LOAD-00001'})]);
  });

  it('creates custom series, assigns items, and lets several items share one series',async()=>{
    const {series}=await setup();
    const asp=await series.createSeries({prefix:'asp',displayName:'Asphalt',itemIds:['asphalt']});
    const agg=await series.createSeries({prefix:'AGG',displayName:'Aggregates',itemIds:['sand','gravel']});
    expect(asp).toMatchObject({prefix:'ASP',itemIds:['asphalt']});
    expect(agg.itemIds.sort()).toEqual(['gravel','sand']);
    await expect(series.createSeries({prefix:'ASP',displayName:'Again',itemIds:[]})).rejects.toThrow('Another series already uses the prefix ASP.');
  });

  it('moves an item between series so it never belongs to two',async()=>{
    const {db,series}=await setup();
    const asp=await series.createSeries({prefix:'ASP',displayName:'Asphalt',itemIds:['asphalt']});
    await series.createSeries({prefix:'BIT',displayName:'Bitumen mixes',itemIds:['asphalt']});
    expect((await series.listSeries(2026)).find(value=>value.id===asp.id)?.itemIds).toEqual([]);
    await series.assignItem('asphalt',null);
    expect(db.raw.prepare("SELECT load_number_series_id FROM catalog_items WHERE id='asphalt'").get()).toEqual({load_number_series_id:null});
  });

  it('never deactivates the default series and refuses assignment to an inactive series',async()=>{
    const {series}=await setup();
    await expect(series.setSeriesActive('series_load',false)).rejects.toThrow('The default series is always active.');
    const con=await series.createSeries({prefix:'CON',displayName:'Concrete',itemIds:[]});
    await series.setSeriesActive(con.id,false);
    await expect(series.assignItem('concrete',con.id)).rejects.toThrow('Choose an active series.');
  });

  it('records an audit entry for every configuration change',async()=>{
    const {db,series}=await setup();
    const con=await series.createSeries({prefix:'CON',displayName:'Concrete',itemIds:['concrete']});
    await series.updateSeries(con.id,{prefix:'CON',displayName:'Ready-mix concrete',itemIds:['concrete']});
    await series.setSeriesActive(con.id,false);
    expect((db.raw.prepare("SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='loadNumberSeries'").get() as {n:number}).n).toBe(3);
  });
});

describe('issuing numbers',()=>{
  const issue=async(db:SqliteTestDatabase,loadId:string,itemId:string,recordDate='2026-08-10')=>{
    let result!:Awaited<ReturnType<typeof issueLoadNumber>>;
    await db.withTransactionAsync(async()=>{result=await issueLoadNumber(db as never,{loadId,itemId,recordDate,issuedAt:SEED_TIME});});
    return result;
  };

  it('gives unassigned items the default LOAD series in order',async()=>{
    const {db,companyLoad}=await setup();
    const a=companyLoad('sand'),b=companyLoad('gravel');
    expect((await issue(db,a,'sand')).loadNumber).toBe('LOAD-00001');
    expect((await issue(db,b,'gravel')).loadNumber).toBe('LOAD-00002');
    expect(db.raw.prepare('SELECT load_number,load_number_series_id,load_number_series_name FROM loads WHERE id=?').get(b)).toEqual({load_number:'LOAD-00002',load_number_series_id:'series_load',load_number_series_name:'Company loads'});
  });

  it('keeps custom, shared and default counters apart',async()=>{
    const {db,series,companyLoad}=await setup();
    await series.createSeries({prefix:'ASP',displayName:'Asphalt',itemIds:['asphalt']});
    await series.createSeries({prefix:'AGG',displayName:'Aggregates',itemIds:['sand','gravel']});
    const numbers=[];
    for(const item of ['asphalt','sand','gravel','concrete','asphalt','sand'])numbers.push((await issue(db,companyLoad(item),item)).loadNumber);
    expect(numbers).toEqual(['ASP-00001','AGG-00001','AGG-00002','LOAD-00001','ASP-00002','AGG-00003']);
  });

  it('never restarts the count at a new year',async()=>{
    const {db,companyLoad}=await setup();
    expect((await issue(db,companyLoad('sand',{day:'2026-12-31'}),'sand','2026-12-31')).loadNumber).toBe('LOAD-00001');
    expect((await issue(db,companyLoad('sand',{day:'2027-01-01'}),'sand','2027-01-01')).loadNumber).toBe('LOAD-00002');
    expect((await issue(db,companyLoad('sand',{day:'2026-11-02'}),'sand','2026-11-02')).loadNumber).toBe('LOAD-00003');
  });

  describe('series that already issued numbers in the old PREFIX-YEAR-NNN format',()=>{
    /** Reproduces what builds 23 to 25 stored for one load. */
    const legacyIssue=(db:SqliteTestDatabase,loadId:string,prefix:string,seriesId:string,year:number,sequence:number)=>{
      const number=formatLoadNumber(prefix,year,sequence);
      db.raw.prepare('UPDATE loads SET load_number=?,load_number_series_id=?,load_number_series_name=? WHERE id=?').run(number,seriesId,'Asphalt',loadId);
      db.raw.prepare('INSERT INTO load_number_issues (load_number,load_id,series_id,prefix,year,sequence,item_id,issued_at) VALUES (?,?,?,?,?,?,?,?)').run(number,loadId,seriesId,prefix,year,sequence,'asphalt',SEED_TIME);
      db.raw.prepare('INSERT INTO load_number_counters (prefix_key,year,next_number) VALUES (?,?,?) ON CONFLICT(prefix_key,year) DO UPDATE SET next_number=excluded.next_number').run(prefix,year,sequence+1);
      return number;
    };

    it('continues the count after everything the series already issued, across years, and keeps the old numbers',async()=>{
      const {db,series,companyLoad}=await setup();
      const asp=await series.createSeries({prefix:'ASP',displayName:'Asphalt',itemIds:['asphalt']});
      const old:string[]=[];
      for(let n=1;n<=5;n++)old.push(legacyIssue(db,companyLoad('asphalt'),'ASP',asp.id,2025,n));
      for(let n=1;n<=7;n++)old.push(legacyIssue(db,companyLoad('asphalt'),'ASP',asp.id,2026,n));
      expect((await series.listSeries(2026)).find(value=>value.id===asp.id)?.nextNumber).toBe('ASP-00013');
      expect(await series.previewNextLoadNumber('asphalt','2026-09-01')).toMatchObject({loadNumber:'ASP-00013'});
      expect((await issue(db,companyLoad('asphalt'),'asphalt','2026-09-01')).loadNumber).toBe('ASP-00013');
      expect((await issue(db,companyLoad('asphalt'),'asphalt','2026-09-02')).loadNumber).toBe('ASP-00014');
      expect(db.raw.prepare("SELECT load_number FROM load_number_issues WHERE sequence<=7 AND prefix='ASP' ORDER BY year,sequence").all().map((row:any)=>row.load_number)).toEqual(['ASP-2025-001','ASP-2025-002','ASP-2025-003','ASP-2025-004','ASP-2025-005','ASP-2026-001','ASP-2026-002','ASP-2026-003','ASP-2026-004','ASP-2026-005','ASP-2026-006','ASP-2026-007']);
      expect(old).toHaveLength(12);
    });

    it('starts a series that never issued anything at 00001',async()=>{
      const {db,series,companyLoad}=await setup();
      await series.createSeries({prefix:'CON',displayName:'Concrete',itemIds:['concrete']});
      expect((await issue(db,companyLoad('concrete'),'concrete')).loadNumber).toBe('CON-00001');
    });
  });

  it('falls back to the default series while an item’s series is inactive',async()=>{
    const {db,series,companyLoad}=await setup();
    const con=await series.createSeries({prefix:'CON',displayName:'Concrete',itemIds:['concrete']});
    await series.setSeriesActive(con.id,false);
    expect((await issue(db,companyLoad('concrete'),'concrete')).loadNumber).toBe('LOAD-00001');
  });

  it('applies configuration changes to future loads only',async()=>{
    const {db,series,companyLoad}=await setup();
    const first=companyLoad('asphalt');await issue(db,first,'asphalt');
    await series.createSeries({prefix:'ASP',displayName:'Asphalt',itemIds:['asphalt']});
    await issue(db,companyLoad('asphalt'),'asphalt');
    expect(db.raw.prepare('SELECT load_number FROM loads WHERE id=?').get(first)).toEqual({load_number:'LOAD-00001'});
  });

  it('issues distinct numbers when several confirmations race',async()=>{
    const {db,companyLoad}=await setup();
    const ids=Array.from({length:25},()=>companyLoad('sand'));
    const results=await Promise.all(ids.map(id=>issueLoadNumber(db as never,{loadId:id,itemId:'sand',recordDate:'2026-08-10',issuedAt:SEED_TIME})));
    const numbers=results.map(value=>value.loadNumber);
    expect(new Set(numbers).size).toBe(25);
    expect(numbers.sort()).toEqual(Array.from({length:25},(_,index)=>formatSeriesNumber('LOAD',index+1)));
  });

  it('records every issued number in the immutable history',async()=>{
    const {db,companyLoad}=await setup();
    const id=companyLoad('sand');await issue(db,id,'sand');
    expect(db.raw.prepare('SELECT load_number,load_id,series_id,prefix,year,sequence,item_id FROM load_number_issues').all()).toEqual([{load_number:'LOAD-00001',load_id:id,series_id:'series_load',prefix:'LOAD',year:2026,sequence:1,item_id:'sand'}]);
  });

  it('locks a prefix once its series has issued a number, while the name stays editable',async()=>{
    const {db,series,companyLoad}=await setup();
    const asp=await series.createSeries({prefix:'ASP',displayName:'Asphalt',itemIds:['asphalt']});
    await issue(db,companyLoad('asphalt'),'asphalt');
    await expect(series.updateSeries(asp.id,{prefix:'ASX',displayName:'Asphalt',itemIds:['asphalt']})).rejects.toThrow('This prefix is locked because loads already carry it.');
    await expect(series.updateSeries(asp.id,{prefix:'ASP',displayName:'Hot-mix asphalt',itemIds:['asphalt']})).resolves.toMatchObject({displayName:'Hot-mix asphalt',prefixLocked:true,issuedCount:1});
  });

  it('previews the next number without consuming it',async()=>{
    const {db,series,companyLoad}=await setup();
    await series.createSeries({prefix:'ASP',displayName:'Asphalt',itemIds:['asphalt']});
    expect(await series.previewNextLoadNumber('asphalt','2026-08-10')).toEqual({seriesId:expect.any(String),prefix:'ASP',displayName:'Asphalt',loadNumber:'ASP-00001'});
    expect(await series.previewNextLoadNumber('asphalt','2026-08-10')).toMatchObject({loadNumber:'ASP-00001'});
    await issue(db,companyLoad('asphalt'),'asphalt');
    expect(await series.previewNextLoadNumber('asphalt','2026-08-10')).toMatchObject({loadNumber:'ASP-00002'});
  });
});

describe('Make Company Load integration',()=>{
  async function confirm(repository:SqliteLoadRepository,itemId:string){
    return repository.confirmLoad({...emptyLoadDraft,recordDate:'2026-08-10',customerId:'customer',projectId:'road',itemId,driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'direct',directQuantity:'12',directUnitId:'unit_ton'});
  }
  async function loadSetup(){
    const fixture=await setup();
    fixture.db.raw.exec(`INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');`);
    return {...fixture,loads:new SqliteLoadRepository(fixture.db as never)};
  }

  it('generates the number on confirmation and returns it with the load',async()=>{
    const {loads,series}=await loadSetup();
    await series.createSeries({prefix:'ASP',displayName:'Asphalt',itemIds:['asphalt']});
    const saved=await confirm(loads,'asphalt');
    expect(saved).toMatchObject({loadNumber:'ASP-00001',loadNumberSeriesName:'Asphalt'});
    expect((await loads.listLoads())[0]).toMatchObject({loadNumber:'ASP-00001'});
  });

  it('never reuses a number after cancellation and keeps it through correction',async()=>{
    const {loads}=await loadSetup();
    const first=await confirm(loads,'sand');
    await loads.cancelLoad(first.id,'Wrong truck');
    const second=await confirm(loads,'sand');
    expect(second.loadNumber).toBe('LOAD-00002');
    const corrected=await loads.correctLoad(second.id,{requestedQuantityKg:'',emptyWeightKg:'',fullWeightKg:'',directQuantity:'14',unitPriceUsd:'',destinationAddress:'',notes:'Re-weighed',correctionReason:'Ticket showed 14 t'});
    expect(corrected.loadNumber).toBe('LOAD-00002');
    expect((await loads.listLoads()).find(value=>value.id===first.id)).toMatchObject({loadNumber:'LOAD-00001',status:'Cancelled'});
  });

  it('keeps legacy loads without a number',async()=>{
    const {loads,companyLoad}=await loadSetup();
    const legacy=companyLoad('sand');
    expect((await loads.listLoads()).find(value=>value.id===legacy)).toMatchObject({loadNumber:null,loadNumberSeriesName:null});
  });

  it('saves nothing when the number cannot be generated',async()=>{
    const {db,loads}=await loadSetup();
    db.raw.exec("CREATE TRIGGER fail_issue BEFORE INSERT ON load_number_issues BEGIN SELECT RAISE(ABORT,'disk full'); END;");
    await expect(confirm(loads,'sand')).rejects.toThrow('disk full');
    expect(db.raw.prepare('SELECT COUNT(*) n FROM loads').get()).toEqual({n:0});
    expect(db.raw.prepare('SELECT COUNT(*) n FROM load_number_counters').get()).toEqual({n:0});
  });
});
