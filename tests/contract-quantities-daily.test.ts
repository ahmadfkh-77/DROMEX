import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteContractQuantitiesRepository} from '../src/data/repositories/SqliteContractQuantitiesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {dailyContractProgress,type ContractAdjustment,type ContractItem,type ContractLoad} from '../src/domain/contractQuantities';
import {emptyLoadDraft} from '../src/domain/loads';
import {emptyQuarryPurchaseDraft} from '../src/domain/quarry';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-537. The Daily Report shows each target that moved on the work date: used today, total used to that date and percent complete, plus
 * one whole-project percent. Everything is read as of the end of the work date, so an issued report keeps the percent it had that day.
 */
const item=(over:Partial<ContractItem>={}):ContractItem=>({
  id:'ci1',projectId:'p1',name:'Base course',unitId:'u_m3',unitSymbol:'m³',quantity:100,unitPriceUsd:null,materialIds:['m_base'],
  status:'in_progress',completedOn:null,cancelledAt:null,...over,
});
const load=(over:Partial<ContractLoad>={}):ContractLoad=>({
  id:'l1',source:'company',reference:'L-1',materialId:'m_base',unitId:'u_m3',unitSymbol:'m³',quantity:10,date:'2026-10-10',status:'Active',contractItemId:'ci1',...over,
});
const adj=(over:Partial<ContractAdjustment>={}):ContractAdjustment=>({id:'a1',contractItemId:'ci1',amount:-2,reason:'Left over',createdAt:'2026-10-11T12:00:00',...over});

describe('dailyContractProgress',()=>{
  it('reports used today, total used to the date and percent complete for a target that received a load that day',()=>{
    const report=dailyContractProgress([{item:item(),loads:[load({quantity:30,date:'2026-10-09'}),load({id:'l2',quantity:20,date:'2026-10-10'})],adjustments:[]}],'2026-10-10');
    expect(report.targets).toHaveLength(1);
    expect(report.targets[0]).toMatchObject({usedToday:20,notCountedToday:0,usage:{used:50,percentUsed:50,remaining:50}});
  });
  it('ignores loads after the work date, so an old report keeps the percent it had that day',()=>{
    const report=dailyContractProgress([{item:item(),loads:[load({quantity:20,date:'2026-10-10'}),load({id:'l2',quantity:40,date:'2026-10-15'})],adjustments:[]}],'2026-10-10');
    expect(report.targets[0]!.usage.used).toBe(20);
    expect(report.summary.overallPercentUsed).toBe(20);
  });
  it('omits a target with nothing on the work date, but keeps it in the whole-project percent',()=>{
    const report=dailyContractProgress([
      {item:item(),loads:[load({quantity:50,date:'2026-10-10'})],adjustments:[]},
      {item:item({id:'ci2',name:'Asphalt'}),loads:[load({id:'l2',contractItemId:'ci2',quantity:100,date:'2026-10-08'})],adjustments:[]},
    ],'2026-10-10');
    expect(report.targets.map(target=>target.item.id)).toEqual(['ci1']);
    expect(report.summary).toMatchObject({itemCount:2,overallPercentUsed:75,overallBasis:'items'});
  });
  it('counts a same-day adjustment in used today and ignores a later one',()=>{
    const report=dailyContractProgress([{item:item(),loads:[load({quantity:20,date:'2026-10-10'})],adjustments:[adj({amount:-5,createdAt:'2026-10-10T15:00:00'}),adj({id:'a2',amount:-9,createdAt:'2026-10-12T09:00:00'})]}],'2026-10-10');
    expect(report.targets[0]).toMatchObject({usedToday:15,usage:{used:15}});
  });
  it('lists a target whose only load that day is in another unit, as not counted',()=>{
    const report=dailyContractProgress([{item:item(),loads:[load({unitId:'u_t',unitSymbol:'t',quantity:7,date:'2026-10-10'})],adjustments:[]}],'2026-10-10');
    expect(report.targets[0]).toMatchObject({usedToday:0,notCountedToday:1,usage:{used:0}});
  });
  it('leaves out cancelled loads and cancelled targets',()=>{
    const report=dailyContractProgress([
      {item:item(),loads:[load({quantity:10,date:'2026-10-10'}),load({id:'l2',quantity:30,date:'2026-10-10',status:'Cancelled'})],adjustments:[]},
      {item:item({id:'ci2',cancelledAt:'2026-10-09T08:00:00'}),loads:[load({id:'l3',contractItemId:'ci2',date:'2026-10-10'})],adjustments:[]},
    ],'2026-10-10');
    expect(report.targets).toHaveLength(1);
    expect(report.targets[0]!.usedToday).toBe(10);
    expect(report.summary.itemCount).toBe(1);
  });
  it('shows an over-target item with its warning and over-by quantity',()=>{
    const report=dailyContractProgress([{item:item({quantity:100}),loads:[load({quantity:107,date:'2026-10-10'})],adjustments:[]}],'2026-10-10');
    expect(report.targets[0]!.usage).toMatchObject({percentUsed:107,warning:'over',overBy:7});
  });
  it('treats a target finished after the work date as still in progress on that date',()=>{
    const finished=item({status:'complete',completedOn:'2026-10-20'});
    const earlier=dailyContractProgress([{item:finished,loads:[load({date:'2026-10-10'})],adjustments:[]}],'2026-10-10');
    expect(earlier.targets[0]!.item).toMatchObject({status:'in_progress',completedOn:null});
    const later=dailyContractProgress([{item:finished,loads:[load({date:'2026-10-22'})],adjustments:[]}],'2026-10-22');
    expect(later.targets[0]!.item.status).toBe('complete');
  });
  it('weights the whole-project percent by value when every target has a price',()=>{
    const report=dailyContractProgress([
      {item:item({unitPriceUsd:10}),loads:[load({quantity:100,date:'2026-10-10'})],adjustments:[]},
      {item:item({id:'ci2',quantity:300,unitPriceUsd:30}),loads:[load({id:'l2',contractItemId:'ci2',quantity:30,date:'2026-10-10'})],adjustments:[]},
    ],'2026-10-10');
    expect(report.summary).toMatchObject({overallBasis:'value',overallPercentUsed:19});
  });
  it('returns nothing and no percent for a project without targets',()=>{
    expect(dailyContractProgress([],'2026-10-10')).toMatchObject({targets:[],summary:{itemCount:0,overallPercentUsed:null}});
  });
});

const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

describe('listLinkedContractProgress',()=>{
  it('reads company and supplier loads as of the work date, from the real schema',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    db.raw.exec(`
      INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
      INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1000,'${SEED_TIME}');
      INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
      INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,quarry_enabled,created_at,updated_at) VALUES ('asphalt','cat','Asphalt','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}');
      INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Majbal Quarry',1,'${SEED_TIME}','${SEED_TIME}');
      INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}');
      INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${SEED_TIME}','${SEED_TIME}','driver');
    `);
    const loads=new SqliteLoadRepository(db as never),quarry=new SqliteQuarryRepository(db as never),contracts=new SqliteContractQuantitiesRepository(db as never);
    const target=await contracts.createItem('road',{name:'Asphalt binder',unitId:'unit_ton',quantity:'100',unitPriceUsd:'',materialIds:['asphalt']});
    const company=await loads.confirmLoad({...emptyLoadDraft,vat:{mode:'none',ratePercent:''},recordDate:'2026-10-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'weighbridge',emptyWeightKg:'10000',fullWeightKg:'29500',conversionId:'conversion_kg_ton',unitPriceUsd:'',contractItemId:target.id});
    const supplier=await quarry.confirmPurchase({...emptyQuarryPurchaseDraft,recordDate:'2026-10-21',supplierId:'sup',destinationType:'project',projectId:'road',itemId:'asphalt',unitId:'unit_ton',quantityCubicMetres:'12',deliveryMethod:'supplier',supplierTruckPlate:'T-1',contractItemId:target.id});
    expect(company.contractItemId).toBe(target.id);
    expect(supplier.contractItemId).toBe(target.id);
    const reports=new SqliteProjectReportRepository(db as never);

    const first=await reports.listLinkedContractProgress('road','2026-10-20');
    expect(first.targets).toHaveLength(1);
    expect(first.targets[0]).toMatchObject({usedToday:19.5,usage:{used:19.5,percentUsed:19.5}});
    const second=await reports.listLinkedContractProgress('road','2026-10-21');
    expect(second.targets[0]).toMatchObject({usedToday:12,usage:{used:31.5,percentUsed:31.5}});
    expect(second.summary.overallPercentUsed).toBe(31.5);
    expect((await reports.listLinkedContractProgress('road','2026-10-22')).targets).toEqual([]);
    // Created on the 24th with nothing dated before the 20th: not part of an earlier day, but part of the day it was created.
    expect((await reports.listLinkedContractProgress('road','2026-10-19')).summary.itemCount).toBe(0);
    expect((await reports.listLinkedContractProgress('road','2026-10-24')).summary).toMatchObject({itemCount:1,overallPercentUsed:31.5});
  });
});
