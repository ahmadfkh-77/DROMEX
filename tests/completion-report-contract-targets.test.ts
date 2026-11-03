import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteContractQuantitiesRepository} from '../src/data/repositories/SqliteContractQuantitiesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteProjectReportRepository} from '../src/data/repositories/SqliteProjectReportRepository';
import {finalContractReport,type ContractAdjustment,type ContractItem,type ContractLoad} from '../src/domain/contractQuantities';
import {emptyLoadDraft} from '../src/domain/loads';
import {buildProjectCompletionHtml} from '../src/services/projectCompletionTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-540. The Completed Project Report can print a Quantity Targets table in Section 01: each live target's quantity, total used, remaining,
 * percent and status, plus the whole-project percent. Off by switch, and a project without targets prints exactly as before.
 */
const item=(over:Partial<ContractItem>={}):ContractItem=>({
  id:'ci1',projectId:'p1',name:'Base Course Type A',unitId:'u_m3',unitSymbol:'m³',quantity:5000,unitPriceUsd:null,materialIds:['base'],
  status:'in_progress',completedOn:null,cancelledAt:null,...over,
});
const load=(over:Partial<ContractLoad>={}):ContractLoad=>({
  id:'l1',source:'company',reference:'L-1',materialId:'base',unitId:'u_m3',unitSymbol:'m³',quantity:4812,date:'2026-10-20',status:'Active',contractItemId:'ci1',...over,
});
const adj=(over:Partial<ContractAdjustment>={}):ContractAdjustment=>({id:'a1',contractItemId:'ci1',amount:-12,reason:'Returned',createdAt:'2026-10-22T10:00:00',...over});

describe('finalContractReport',()=>{
  it('gives every live target its final usage and the whole-project percent, leaving cancelled targets out',()=>{
    const report=finalContractReport([
      {item:item({status:'complete',completedOn:'2026-10-25'}),loads:[load()],adjustments:[adj()]},
      {item:item({id:'ci2',name:'Sub-base',quantity:1200}),loads:[load({id:'l2',contractItemId:'ci2',quantity:600})],adjustments:[]},
      {item:item({id:'ci3',cancelledAt:'2026-10-01T08:00:00'}),loads:[],adjustments:[]},
    ]);
    expect(report.targets.map(row=>row.item.id)).toEqual(['ci1','ci2']);
    expect(report.targets[0]!.usage.used).toBe(4800);
    expect(report.summary).toMatchObject({itemCount:2,overallBasis:'items'});
    expect(report.summary.overallPercentUsed).toBe(73);
  });
  it('reports no targets as an empty summary',()=>{
    expect(finalContractReport([]).summary.overallPercentUsed).toBeNull();
  });
});

describe('Completed Project Report, Quantity Targets table',()=>{
  const project={id:'p1',name:'Zebdine Road',location:'Zebdine',status:'completed'} as never;
  const company={name:'DROMEX',logoUri:null,address:'',phone:'',email:''} as never;
  const html=(targets?:Parameters<typeof buildProjectCompletionHtml>[7])=>buildProjectCompletionHtml(project,[],[],[],company,null,[],targets);
  const report=finalContractReport([
    {item:item({status:'complete',completedOn:'2026-10-25'}),loads:[load()],adjustments:[]},
    {item:item({id:'ci2',name:'Wearing <course>',quantity:2000}),loads:[load({id:'l2',contractItemId:'ci2',quantity:2140})],adjustments:[]},
    {item:item({id:'ci3',name:'Sub-base',quantity:1200}),loads:[load({id:'l3',contractItemId:'ci3',quantity:100}),load({id:'l4',contractItemId:'ci3',quantity:50,unitId:'u_t',unitSymbol:'t'})],adjustments:[]},
  ]);

  it('prints nothing extra without targets, with the switch off, or for a project without targets',()=>{
    for(const output of [html(),html({report:null,includeWholeProject:true}),html({report:finalContractReport([]),includeWholeProject:true})]){
      expect(output).not.toContain('Quantity targets');
      expect(output).not.toContain('class="target-table"');
    }
  });
  it('prints one row per target with status, remaining and the over quantity, inside Section 01',()=>{
    const output=html({report,includeWholeProject:true});
    expect(output).toContain('<h3>Quantity targets</h3>');
    expect(output).toContain('Completed');
    expect(output).toContain('Over target');
    expect(output).toContain('In progress');
    expect(output).toContain('96.2%');
    expect(output).toContain('over 140 m³');
    expect(output).toContain('1 load in another unit not counted');
    expect(output).toContain('Wearing &lt;course&gt;');
    expect(output.indexOf('Delivered materials')).toBeLessThan(output.indexOf('Quantity targets'));
    expect(output.indexOf('Quantity targets')).toBeLessThan(output.indexOf('Materials entered in daily reports'));
  });
  it('prints the whole-project row only while that switch is on',()=>{
    expect(html({report,includeWholeProject:true})).toContain('Whole project &middot; 3 targets');
    expect(html({report,includeWholeProject:false})).not.toContain('Whole project &middot;');
  });
});

const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

describe('listProjectContractFinal from the real schema',()=>{
  it('returns the final figures of the project targets only',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    db.raw.exec(`
      INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
      INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1000,'${SEED_TIME}');
      INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
      INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,quarry_enabled,created_at,updated_at) VALUES ('asphalt','cat','Asphalt','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}');
      INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}');
      INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${SEED_TIME}','${SEED_TIME}','driver');
    `);
    const loads=new SqliteLoadRepository(db as never),contracts=new SqliteContractQuantitiesRepository(db as never);
    const target=await contracts.createItem('road',{name:'Asphalt binder',unitId:'unit_ton',quantity:'100',unitPriceUsd:'',materialIds:['asphalt']});
    await loads.confirmLoad({...emptyLoadDraft,vat:{mode:'none',ratePercent:''},recordDate:'2026-10-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'weighbridge',emptyWeightKg:'10000',fullWeightKg:'29500',conversionId:'conversion_kg_ton',unitPriceUsd:'',contractItemId:target.id});

    const reports=new SqliteProjectReportRepository(db as never);
    const final=await reports.listProjectContractFinal('road');
    expect(final.targets).toHaveLength(1);
    expect(final.targets[0]!.usage.used).toBe(19.5);
    expect(final.summary.overallPercentUsed).toBe(19.5);
    expect((await reports.listProjectContractFinal('other')).targets).toEqual([]);
  });
});
