import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteContractQuantitiesRepository} from '../src/data/repositories/SqliteContractQuantitiesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import type {CompanyTotalsData} from '../src/domain/companyTotals';
import {contractTotalsTargets,type ContractAdjustment,type ContractItem,type ContractLoad,type ContractTotalsTarget} from '../src/domain/contractQuantities';
import {emptyLoadDraft} from '../src/domain/loads';
import {emptyQuarryPurchaseDraft} from '../src/domain/quarry';
import {buildTotalsHtml} from '../src/services/totalsTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-539. The Project Totals PDF can add, beside each material that has a target in the project, the target's own quantity, what counts
 * toward it and the percent complete. Off by default, and a material without a target prints exactly as before.
 */
const item=(over:Partial<ContractItem>={}):ContractItem=>({
  id:'ci1',projectId:'p1',name:'Base Course Type A',unitId:'u_m3',unitSymbol:'m³',quantity:5000,unitPriceUsd:null,materialIds:['base'],
  status:'in_progress',completedOn:null,cancelledAt:null,...over,
});
const load=(over:Partial<ContractLoad>={}):ContractLoad=>({
  id:'l1',source:'company',reference:'L-1',materialId:'base',unitId:'u_m3',unitSymbol:'m³',quantity:1320,date:'2026-10-20',status:'Active',contractItemId:'ci1',...over,
});
const adj=(over:Partial<ContractAdjustment>={}):ContractAdjustment=>({id:'a1',contractItemId:'ci1',amount:-20,reason:'Returned',createdAt:'2026-10-22T10:00:00',...over});

describe('contractTotalsTargets',()=>{
  it('gives each live target its own quantity, counted quantity and percent',()=>{
    const [target]=contractTotalsTargets([{item:item(),loads:[load()],adjustments:[]}],null);
    expect(target).toMatchObject({id:'ci1',name:'Base Course Type A',unitSymbol:'m³',materialIds:['base'],quantity:5000,counted:1320,percentUsed:26.4,warning:'none',overBy:0});
  });
  it('leaves out cancelled targets and loads that are not linked to the target',()=>{
    const result=contractTotalsTargets([
      {item:item(),loads:[load(),load({id:'l2',contractItemId:null,quantity:500}),load({id:'l3',status:'Cancelled',quantity:900})],adjustments:[]},
      {item:item({id:'ci2',cancelledAt:'2026-10-01T08:00:00'}),loads:[],adjustments:[]},
    ],null);
    expect(result.map(value=>value.id)).toEqual(['ci1']);
    expect(result[0]!.counted).toBe(1320);
  });
  it('reads the To date as an as-of date: later loads and adjustments are ignored',()=>{
    const entry={item:item(),loads:[load({quantity:1000,date:'2026-10-10'}),load({id:'l2',quantity:320,date:'2026-10-25'})],adjustments:[adj()]};
    expect(contractTotalsTargets([entry],'2026-10-15')[0]!.counted).toBe(1000);
    expect(contractTotalsTargets([entry],'2026-10-23')[0]!.counted).toBe(980);
    expect(contractTotalsTargets([entry],null)[0]!.counted).toBe(1300);
  });
  it('marks near and over targets and reports the over quantity',()=>{
    const near=contractTotalsTargets([{item:item({quantity:1200}),loads:[load({quantity:1104})],adjustments:[]}],null)[0]!;
    expect(near).toMatchObject({percentUsed:92,warning:'near',overBy:0});
    const over=contractTotalsTargets([{item:item({quantity:2000}),loads:[load({quantity:2140})],adjustments:[]}],null)[0]!;
    expect(over).toMatchObject({percentUsed:107,warning:'over',overBy:140});
  });
});

describe('Project Totals PDF, target tiles',()=>{
  const data:CompanyTotalsData={usageHiddenReason:null,usage:[],deliveries:[
    {source:'supplier_delivery',itemKey:'id:base',itemName:'BaseCourse',projectKey:'p1',projectName:'Zebdine -Choukine Road',supplierKey:'s1',supplierName:'Choukine supplier',unitKey:'u_m3',unitSymbol:'m³',quantity:1650,recordCount:76,valueCents:null,pricedCount:0,inclusion:{total:76,included:0,inDraft:0,open:76,includedIn:[]}},
    {source:'supplier_delivery',itemKey:'id:sand',itemName:'Sand',projectKey:'p1',projectName:'Zebdine -Choukine Road',supplierKey:'s1',supplierName:'Choukine supplier',unitKey:'u_m3',unitSymbol:'m³',quantity:40,recordCount:2,valueCents:null,pricedCount:0,inclusion:{total:2,included:0,inDraft:0,open:2,includedIn:[]}},
  ]};
  const base={companyName:'DROMEX',logo:null,title:'Project Totals',scope:'project' as const,filters:['All dates'],generatedAt:'2026-11-03T10:00:00',includePrices:false,data};
  const targets:ContractTotalsTarget[]=[
    {id:'t1',name:'Base Course Type A',unitSymbol:'m³',materialIds:['base'],quantity:5000,counted:1320,percentUsed:26.4,warning:'none',overBy:0},
    {id:'t2',name:'Wearing <course>',unitSymbol:'m³',materialIds:['base'],quantity:2000,counted:2140,percentUsed:107,warning:'over',overBy:140},
    {id:'t3',name:'Sub-base',unitSymbol:'m³',materialIds:['other'],quantity:10,counted:1,percentUsed:10,warning:'none',overBy:0},
  ];
  it('prints nothing extra when no targets are given, so the default PDF is unchanged',()=>{
    for(const html of [buildTotalsHtml(base),buildTotalsHtml({...base,targets:[]})]){
      expect(html).not.toContain('class="figure target"');
      expect(html).not.toContain('% complete');
    }
  });
  it('prints one tile group per target that lists the material, beside Records',()=>{
    const html=buildTotalsHtml({...base,targets});
    expect(html.match(/class="figure target"/g)).toHaveLength(2);
    expect(html).toContain('Target &middot; <span dir="auto">Base Course Type A</span>');
    expect(html).toContain('% complete');
    expect(html).toContain('26.4%');
    expect(html).toContain('107.0%');
    expect(html).toContain('pct-over');
    expect(html).toContain('Over target by');
    expect(html).not.toContain('Sub-base');
    expect(html.indexOf('>Records<')).toBeLessThan(html.indexOf('Target &middot;'));
  });
  it('shows a target only under the material it lists, and none for a material without one',()=>{
    const html=buildTotalsHtml({...base,targets});
    const sandBlock=html.slice(html.indexOf('<span class="block-index">2</span>'));
    expect(sandBlock).toContain('Sand');
    expect(sandBlock).not.toContain('class="figure target"');
    const baseBlock=html.slice(html.indexOf('<span class="block-index">1</span>'),html.indexOf('<span class="block-index">2</span>'));
    expect(baseBlock.match(/class="figure target"/g)).toHaveLength(2);
  });
  it('escapes a target name',()=>{
    expect(buildTotalsHtml({...base,targets})).toContain('Wearing &lt;course&gt;');
  });
});

const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

describe('totalsTargets from the real schema',()=>{
  it('counts company and supplier loads linked to the target, as of the To date',async()=>{
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
    await loads.confirmLoad({...emptyLoadDraft,vat:{mode:'none',ratePercent:''},recordDate:'2026-10-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'weighbridge',emptyWeightKg:'10000',fullWeightKg:'29500',conversionId:'conversion_kg_ton',unitPriceUsd:'',contractItemId:target.id});
    await quarry.confirmPurchase({...emptyQuarryPurchaseDraft,recordDate:'2026-10-21',supplierId:'sup',destinationType:'project',projectId:'road',itemId:'asphalt',unitId:'unit_ton',quantityCubicMetres:'12',deliveryMethod:'supplier',supplierTruckPlate:'T-1',contractItemId:target.id});

    const now=await contracts.totalsTargets('road',null);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({id:target.id,name:'Asphalt binder',quantity:100,counted:31.5,percentUsed:31.5,materialIds:['asphalt']});
    expect((await contracts.totalsTargets('road','2026-10-20'))[0]!.counted).toBe(19.5);
    expect(await contracts.totalsTargets('other',null)).toEqual([]);
  });
});
