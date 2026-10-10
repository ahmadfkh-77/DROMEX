import {afterEach,describe,expect,it} from 'vitest';

import {SqliteBusinessDocumentRepository} from '../src/data/repositories/SqliteBusinessDocumentRepository';
import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import {recordKey} from '../src/domain/businessDocuments';
import {buildCompanyLoadTree,buildMaterialTree,emptyCompanyTotalsFilters,NO_PROJECT_KEY,summarizeInclusionCounts,treeTotals,unitDifferences} from '../src/domain/companyTotals';
import {type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/** DEC-500 (1). Company-wide totals: Material → Project → Supplier → records, with inclusion status from the shared links. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const fixture=await recordsDatabase(databases);
  const {companyLoad,supplierLoad,report}=fixture;
  // Sand: two suppliers on road, one on other, company loads on road and one with no project; use on road.
  const ids={
    qa1:supplierLoad('sand',{supplier:'sup_a',project:'road',quantity:8,unit:'m³',priceCents:1000}),
    qa2:supplierLoad('sand',{supplier:'sup_a',project:'road',quantity:4,unit:'m³'}),
    qb1:supplierLoad('sand',{supplier:'sup_b',project:'road',quantity:6,unit:'t'}),
    qb2:supplierLoad('sand',{supplier:'sup_b',project:'other',quantity:5,unit:'m³'}),
    qx:supplierLoad('sand',{supplier:'sup_a',project:'road',quantity:99,unit:'m³',status:'Cancelled'}),
    l1:companyLoad('sand',{project:'road',quantity:10,unit:'t',loadNumber:'AGG-2026-001'}),
    l2:companyLoad('sand',{project:null,customer:'cust_b',quantity:3,unit:'t',loadNumber:'AGG-2026-002'}),
    l3:companyLoad('asphalt',{project:'road',quantity:20,unit:'t',loadNumber:'ASP-2026-001',priceCents:5000}),
    lx:companyLoad('asphalt',{project:'road',quantity:50,unit:'t',status:'Cancelled',loadNumber:'ASP-2026-002'}),
    legacy:companyLoad('asphalt',{project:'other',quantity:7,unit:'t'}),
  };
  report('road','2026-08-12',[{itemId:'sand',itemName:'Sand',unitId:'unit_m3',unitSymbol:'m³',quantity:9,movement:'used'},{itemId:'sand',itemName:'Sand',unitId:'unit_ton',unitSymbol:'t',quantity:2,movement:'used'}]);
  fixture.db.raw.exec(`
    INSERT INTO load_number_series (id,prefix,prefix_key,display_name,is_default,is_active,created_at,updated_at) VALUES ('s_agg','AGG','AGG','Aggregates',0,1,'x','x'),('s_asp','ASP','ASP','Asphalt',0,1,'x','x');
    UPDATE loads SET load_number_series_id='s_agg', load_number_series_name='Aggregates' WHERE load_number LIKE 'AGG-%';
    UPDATE loads SET load_number_series_id='s_asp', load_number_series_name='Asphalt' WHERE load_number LIKE 'ASP-%';
  `);
  return {...fixture,ids,totals:new SqliteCompanyTotalsRepository(fixture.db as never),docs:new SqliteBusinessDocumentRepository(fixture.db as never)};
}

describe('company totals tree',()=>{
  it('totals each material company-wide per unit, never adding units or cancelled records',async()=>{
    const {totals}=await setup();
    const tree=buildMaterialTree(await totals.getCompanyTotals(emptyCompanyTotalsFilters()));
    expect(tree.map(item=>[item.itemName,item.units.map(unit=>[unit.unitSymbol,unit.delivered?.quantity??null,unit.used?.quantity??null])])).toEqual([
      ['Asphalt',[['t',27,null]]],
      ['Sand',[['m³',17,9],['t',19,2]]],
    ]);
  });

  it('shows only projects with records under a material, then only suppliers with records under a project',async()=>{
    const {totals}=await setup();
    const sand=buildMaterialTree(await totals.getCompanyTotals(emptyCompanyTotalsFilters())).find(item=>item.itemName==='Sand')!;
    expect(sand.projects.map(project=>project.projectName)).toEqual(['Coastal Road','Mountain Road','No project — direct customer deliveries']);
    const road=sand.projects.find(project=>project.projectName==='Mountain Road')!;
    expect(road.suppliers.map(supplier=>[supplier.supplierName,supplier.units.map(unit=>`${unit.quantity} ${unit.unitSymbol}`)])).toEqual([
      ['Alpha Quarry',['12 m³']],['Beta Quarry',['6 t']],['DROMEX',['10 t']],
    ]);
    expect(road.units.map(unit=>[unit.unitSymbol,unit.delivered?.quantity,unit.used?.quantity])).toEqual([['m³',12,9],['t',16,2]]);
  });

  it('states Delivered minus recorded use only where one unit has both measures',async()=>{
    const {totals}=await setup();
    const road=buildMaterialTree(await totals.getCompanyTotals(emptyCompanyTotalsFilters())).find(item=>item.itemName==='Sand')!.projects.find(project=>project.projectKey==='road')!;
    expect(unitDifferences(road.units)).toEqual([{unitKey:'unit_m3',unitSymbol:'m³',difference:3},{unitKey:'unit_ton',unitSymbol:'t',difference:14}]);
    const other=buildMaterialTree(await totals.getCompanyTotals(emptyCompanyTotalsFilters())).find(item=>item.itemName==='Sand')!.projects.find(project=>project.projectKey==='other')!;
    expect(unitDifferences(other.units)).toEqual([]);
  });

  it('adds up identically at every level, so nothing is double counted',async()=>{
    const {totals}=await setup();
    for(const item of buildMaterialTree(await totals.getCompanyTotals(emptyCompanyTotalsFilters()))){
      for(const unit of item.units){
        const fromProjects=item.projects.reduce((sum,project)=>sum+(project.units.find(value=>value.unitKey===unit.unitKey)?.delivered?.quantity??0),0);
        const fromSuppliers=item.projects.flatMap(project=>project.suppliers).reduce((sum,supplier)=>sum+(supplier.units.find(value=>value.unitKey===unit.unitKey)?.quantity??0),0);
        expect(fromProjects).toBe(unit.delivered?.quantity??0);
        expect(fromSuppliers).toBe(unit.delivered?.quantity??0);
      }
    }
  });

  it('sums records, statuses and money across materials without adding any quantities',async()=>{
    const {totals}=await setup();
    const all=treeTotals(buildMaterialTree(await totals.getCompanyTotals(emptyCompanyTotalsFilters())));
    expect(all).toEqual({materialCount:2,inclusion:{total:8,included:0,inDraft:0,open:8,includedIn:[]},value:{totalCents:108000,pricedCount:2,unpricedCount:6}});
  });

  it('reports recorded value only from priced records and says how many are unpriced',async()=>{
    const {totals}=await setup();
    const sand=buildMaterialTree(await totals.getCompanyTotals(emptyCompanyTotalsFilters())).find(item=>item.itemName==='Sand')!;
    expect(sand.value).toEqual({totalCents:8000,pricedCount:1,unpricedCount:5});
  });

  it('applies date, project, supplier, unit and view filters, hiding use when a supplier is chosen',async()=>{
    const {totals}=await setup();
    const bySupplier=buildMaterialTree(await totals.getCompanyTotals({...emptyCompanyTotalsFilters(),supplierKey:'id:sup_b'}));
    expect(bySupplier.map(item=>[item.itemName,item.units.map(unit=>[unit.unitSymbol,unit.delivered?.quantity,unit.used])])).toEqual([['Sand',[['m³',5,null],['t',6,null]]]]);
    const usedOnly=buildMaterialTree(await totals.getCompanyTotals({...emptyCompanyTotalsFilters(),view:'used'}));
    expect(usedOnly.map(item=>item.itemName)).toEqual(['Sand']);
    expect(usedOnly[0]!.units.every(unit=>unit.delivered===null)).toBe(true);
    const noProject=buildMaterialTree(await totals.getCompanyTotals({...emptyCompanyTotalsFilters(),projectKey:NO_PROJECT_KEY}));
    expect(noProject.map(item=>[item.itemName,item.units.map(unit=>unit.delivered?.quantity)])).toEqual([['Sand',[3]]]);
    const dated=await totals.getCompanyTotals({...emptyCompanyTotalsFilters(),fromDate:'2026-09-01'});
    expect(dated.deliveries).toEqual([]);
  });

  it('filters by company-load series, leaving out Supplier Loads and use',async()=>{
    const {totals}=await setup();
    const tree=buildMaterialTree(await totals.getCompanyTotals({...emptyCompanyTotalsFilters(),seriesId:'s_agg'}));
    expect(tree.map(item=>[item.itemName,item.units.map(unit=>[unit.unitSymbol,unit.delivered?.quantity,unit.used])])).toEqual([['Sand',[['t',13,null]]]]);
  });
});

describe('inclusion status in totals',()=>{
  it('summarizes inclusion per node from the shared links and filters by extraction status',async()=>{
    const {totals,docs,ids}=await setup();
    const draft=await docs.createDraft({kind:'supplier_statement',partyId:'sup_a',recordKeys:[recordKey('supplier_load',ids.qa1)],selectionMethod:'manual'});
    const bill=await docs.createDraft({kind:'supplier_bill',partyId:'sup_b',recordKeys:[recordKey('supplier_load',ids.qb1),recordKey('supplier_load',ids.qb2)],selectionMethod:'manual'});
    await docs.issueDocument(bill.id,{issueDate:'2026-09-01'});
    const sand=buildMaterialTree(await totals.getCompanyTotals(emptyCompanyTotalsFilters())).find(item=>item.itemName==='Sand')!;
    expect(summarizeInclusionCounts(sand.inclusion)).toBe('6 records · 2 included · 1 in draft · 3 not included');
    const beta=sand.projects.find(project=>project.projectName==='Mountain Road')!.suppliers.find(supplier=>supplier.supplierName==='Beta Quarry')!;
    expect(summarizeInclusionCounts(beta.inclusion)).toBe('1 record · all included in BILL-2026-001');
    const notIncluded=buildMaterialTree(await totals.getCompanyTotals({...emptyCompanyTotalsFilters(),inclusion:'not_included'}));
    expect(notIncluded.find(item=>item.itemName==='Sand')!.units.map(unit=>[unit.unitSymbol,unit.delivered?.quantity,unit.used])).toEqual([['m³',4,null],['t',13,null]]);
    await docs.cancelDocument(draft.id,'Not needed');
    const inDraft=await totals.getCompanyTotals({...emptyCompanyTotalsFilters(),inclusion:'in_draft'});
    expect(inDraft.deliveries).toEqual([]);
  });

  it('lists the original records behind a leaf with load number, references, history and status',async()=>{
    const {db,totals,ids}=await setup();
    db.raw.exec(`UPDATE loads SET correction_history_json='[{"correctedAt":"2026-08-11T10:00:00Z","correctedBy":"Admin","reason":"Ticket","changes":[]}]' WHERE id='${ids.l1}'`);
    const rows=await totals.listRecords({...emptyCompanyTotalsFilters(),itemKey:'id:sand',projectKey:'road',supplierKey:'company',unitKey:'unit_ton'});
    expect(rows).toEqual([expect.objectContaining({key:recordKey('company_load',ids.l1),correctionCount:1,inclusion:{state:'not_included'},snapshot:expect.objectContaining({loadNumber:'AGG-2026-001',reference:'TX-6',quantity:10,unitSymbol:'t',partyName:'Road Co'})})]);
    const used=await totals.listUsageRecords({...emptyCompanyTotalsFilters(),itemKey:'id:sand',projectKey:'road',unitKey:'unit_m3'});
    expect(used).toEqual([{reportId:'r_road_2026-08-12',projectId:'road',projectName:'Mountain Road',workDate:'2026-08-12',quantity:9,unitSymbol:'m³'}]);
  });
});

describe('company load totals',()=>{
  it('groups company loads by series, then project, keeping units and cancelled loads apart',async()=>{
    const {totals}=await setup();
    const data=await totals.getCompanyLoadTotals({...emptyCompanyTotalsFilters()});
    const tree=buildCompanyLoadTree(data,'series');
    expect(tree.map(group=>[group.label,group.loadCount,group.units.map(unit=>`${unit.quantity} ${unit.unitSymbol}`),group.cancelledCount])).toEqual([
      ['AGG · Aggregates',2,['13 t'],0],
      ['ASP · Asphalt',1,['20 t'],1],
      ['Legacy loads — no generated load number',1,['7 t'],0],
    ]);
    expect(tree[0]!.projects.map(project=>[project.projectName,project.loadCount])).toEqual([['Mountain Road',1],['No project — direct customer deliveries',1]]);
  });

  it('can group by item instead of series',async()=>{
    const {totals}=await setup();
    const tree=buildCompanyLoadTree(await totals.getCompanyLoadTotals(emptyCompanyTotalsFilters()),'item');
    expect(tree.map(group=>[group.label,group.loadCount,group.units.map(unit=>`${unit.quantity} ${unit.unitSymbol}`)])).toEqual([['Asphalt',2,['27 t']],['Sand',2,['13 t']]]);
  });

  it('lists individual loads, including cancelled ones only when asked',async()=>{
    const {totals,ids}=await setup();
    const active=await totals.listCompanyLoads({...emptyCompanyTotalsFilters(),seriesId:'s_asp'});
    expect(active.map(row=>row.snapshot.loadNumber)).toEqual(['ASP-2026-001']);
    const all=await totals.listCompanyLoads({...emptyCompanyTotalsFilters(),seriesId:'s_asp'},'all');
    expect(all.map(row=>[row.snapshot.loadNumber,row.status])).toEqual([['ASP-2026-001','Active'],['ASP-2026-002','Cancelled']]);
    const legacy=await totals.listCompanyLoads({...emptyCompanyTotalsFilters(),seriesId:'legacy'});
    expect(legacy.map(row=>row.key)).toEqual([recordKey('company_load',ids.legacy)]);
  });
});

describe('company totals at scale',()=>{
  it('aggregates 3,000 records with document links in SQL, quickly and without double counting',async()=>{
    const fixture=await recordsDatabase(databases);
    const docs=new SqliteBusinessDocumentRepository(fixture.db as never);
    fixture.db.raw.exec('BEGIN');
    const ids:string[]=[];
    for(let index=0;index<1500;index+=1)ids.push(fixture.supplierLoad(index%2?'sand':'gravel',{supplier:index%3?'sup_a':'sup_b',project:index%5?'road':'other',quantity:2,day:`2026-08-${String(1+index%28).padStart(2,'0')}`}));
    for(let index=0;index<1500;index+=1)fixture.companyLoad(index%2?'asphalt':'sand',{project:index%7?'road':null,customer:index%7?'customer':'cust_b',quantity:3,day:`2026-08-${String(1+index%28).padStart(2,'0')}`});
    fixture.db.raw.exec('COMMIT');
    await docs.issueDocument((await docs.createDraft({kind:'supplier_bill',partyId:'sup_a',recordKeys:ids.filter((_,index)=>index%3).slice(0,200).map(id=>recordKey('supplier_load',id)),selectionMethod:'manual'})).id,{issueDate:'2026-09-01'});
    const started=Date.now();
    const data=await new SqliteCompanyTotalsRepository(fixture.db as never).getCompanyTotals(emptyCompanyTotalsFilters());
    const elapsed=Date.now()-started;
    const tree=buildMaterialTree(data);
    expect(treeTotals(tree).inclusion).toMatchObject({total:3000,included:200});
    expect(tree.flatMap(item=>item.units).reduce((sum,unit)=>sum+(unit.delivered?.quantity??0),0)).toBe(1500*2+1500*3);
    expect(elapsed).toBeLessThan(3000);
  });
});
