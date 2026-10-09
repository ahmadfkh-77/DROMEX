import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {SqliteProjectTotalsRepository} from '../src/data/repositories/SqliteProjectTotalsRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {emptyCompanyTotalsFilters,buildMaterialTree} from '../src/domain/companyTotals';
import {emptyQuarryPurchaseDraft,groupQuarryPurchases,purchaseDestination,purchaseDestinationLabel,summarizeSupplierDeliveries,validateQuarryPurchase,type QuarryPurchaseDraft} from '../src/domain/quarry';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-506. A Supplier Load goes to a Destination (project, company site or unassigned) like a fuel fill. A site load is
 * shown under the site's own name and never reaches any project's totals; a load linked to a project before this
 * change reads exactly as it did.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-05T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Al-Nour Quarry',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,created_at,updated_at) VALUES ('base','cat','Base course','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const quarry=new SqliteQuarryRepository(db as never),fuel=new SqliteFuelRepository(db as never);
  const yard=await fuel.createCompanySite('Yard B');
  const draft=(extra:Partial<QuarryPurchaseDraft>={}):QuarryPurchaseDraft=>({...emptyQuarryPurchaseDraft,recordDate:'2026-10-02',supplierId:'sup',itemId:'base',unitId:'unit_ton',quantityCubicMetres:'20',deliveryMethod:'supplier',supplierTruckPlate:'T-1',...extra});
  return {db,quarry,fuel,yard,draft};
}

describe('Destination on a new supplier load',()=>{
  it('saves a project load exactly as before, and a site load with no project at all',async()=>{
    const {db,quarry,yard,draft}=await setup();
    const project=await quarry.confirmPurchase(draft({destinationType:'project',projectId:'road',quantityCubicMetres:'60'}));
    const site=await quarry.confirmPurchase(draft({destinationType:'company_site',companySiteId:yard.id,quantityCubicMetres:'40'}));
    const none=await quarry.confirmPurchase(draft({quantityCubicMetres:'5'}));
    expect(project).toMatchObject({projectId:'road',projectName:'Mountain Road',destinationType:'project',companySiteId:null});
    expect(site).toMatchObject({projectId:null,projectName:null,destinationType:'company_site',companySiteId:yard.id,companySiteName:'Yard B'});
    expect(none).toMatchObject({projectId:null,destinationType:'unassigned',companySiteId:null});
    expect(db.raw.prepare('SELECT project_id,project_name,destination_type,company_site_id FROM quarry_purchases WHERE id=?').get(site.id)).toEqual({project_id:null,project_name:null,destination_type:'company_site',company_site_id:yard.id});
  });

  it('keeps only the link its destination type needs, and validates the choice like a fuel fill',async()=>{
    const {quarry,yard,draft}=await setup();
    const setupData=await quarry.getSetup();
    expect(validateQuarryPurchase(draft({destinationType:'company_site',companySiteId:''}),setupData)).toContain('Select an active company site for this destination.');
    expect(validateQuarryPurchase(draft({destinationType:'project',projectId:''}),setupData)).toContain('Select a project for this destination.');
    expect(validateQuarryPurchase(draft({destinationType:'company_site',companySiteId:yard.id,projectId:'ghost'}),setupData)).toEqual([]);
    const saved=await quarry.confirmPurchase(draft({destinationType:'company_site',companySiteId:yard.id,projectId:'road'}));
    expect(saved.projectId).toBeNull();
    await quarry.getSetup();
    await expect(quarry.confirmPurchase(draft({destinationType:'company_site',companySiteId:'missing'}))).rejects.toThrow('Select an active company site');
  });

  it('shows a site load under the site name and never in a project total',async()=>{
    const {db,quarry,yard,draft}=await setup();
    await quarry.confirmPurchase(draft({destinationType:'project',projectId:'road',quantityCubicMetres:'60'}));
    await quarry.confirmPurchase(draft({destinationType:'company_site',companySiteId:yard.id,quantityCubicMetres:'40'}));
    const purchases=await quarry.listPurchases();
    const summary=summarizeSupplierDeliveries(purchases,{companySites:[{id:yard.id,name:'Yard B'}],projects:[{id:'road',name:'Mountain Road'}]})[0]!;
    expect(summary.materialTotals).toMatchObject([{quantity:100,deliveries:2}]);
    expect(summary.projectGroups.map(group=>[group.projectName,group.destinationType,group.materials[0]!.quantity])).toEqual([['Mountain Road','project',60],['Yard B','company_site',40]]);
    expect(groupQuarryPurchases(purchases)[0]!.projectGroups.map(group=>[group.name,group.destinationType])).toEqual([['Mountain Road','project'],['Yard B','company_site']]);

    const projectTotals=await new SqliteProjectTotalsRepository(db as never).getProjectTotals('road',{fromDate:'',toDate:''});
    expect(projectTotals.deliveries.map(row=>[row.quantity,row.recordCount])).toEqual([[60,1]]);

    const tree=buildMaterialTree(await new SqliteCompanyTotalsRepository(db as never).getCompanyTotals(emptyCompanyTotalsFilters()));
    const base=tree.find(item=>item.itemName==='Base course')!;
    expect(base.projects.map(project=>[project.projectName,project.units[0]!.delivered!.quantity])).toEqual(expect.arrayContaining([['Mountain Road',60],['Yard B (Site)',40]]));
    expect(base.projects.some(project=>project.projectName.startsWith('No project'))).toBe(false);
  });

  it('corrects the destination between project, site and unassigned, with the history and the same rules as other corrections',async()=>{
    const {quarry,yard,draft}=await setup();
    const saved=await quarry.confirmPurchase(draft({destinationType:'project',projectId:'road'}));
    const correction=(extra:Record<string,unknown>)=>({...draft({destinationType:'project',projectId:'road'}),correctionReason:'Wrong place',...extra}) as never;
    await expect(quarry.correctPurchase(saved.id,correction({destinationType:'company_site',companySiteId:yard.id,correctionReason:''}))).rejects.toThrow('Correction reason is required.');
    const moved=await quarry.correctPurchase(saved.id,correction({destinationType:'company_site',companySiteId:yard.id,projectId:''}));
    expect(moved).toMatchObject({projectId:null,projectName:null,destinationType:'company_site',companySiteId:yard.id});
    expect(moved.correctionHistory.at(-1)!.changes).toEqual([{field:'Destination',originalValue:'Project: Mountain Road',newValue:'Company Site: Yard B'}]);
    await expect(quarry.correctPurchase(saved.id,correction({destinationType:'company_site',companySiteId:yard.id,projectId:''}))).rejects.toThrow('No information was changed.');
    const back=await quarry.correctPurchase(saved.id,correction({destinationType:'project',projectId:'road'}));
    expect(back).toMatchObject({projectId:'road',destinationType:'project',companySiteId:null});
    const none=await quarry.correctPurchase(saved.id,correction({destinationType:'unassigned',projectId:''}));
    expect(none).toMatchObject({projectId:null,destinationType:'unassigned'});
    expect(none.correctionHistory).toHaveLength(3);
  });

  it('lets a load stay on a site that was deactivated, but not move onto one',async()=>{
    const {quarry,fuel,yard,draft}=await setup();
    const saved=await quarry.confirmPurchase(draft({destinationType:'company_site',companySiteId:yard.id}));
    const other=await fuel.createCompanySite('Plant');
    await fuel.setCompanySiteActive(yard.id,false);await fuel.setCompanySiteActive(other.id,false);
    const keep=await quarry.correctPurchase(saved.id,{...draft({destinationType:'company_site',companySiteId:yard.id,quantityCubicMetres:'21'}),correctionReason:'Weighbridge'} as never);
    expect(keep.companySiteId).toBe(yard.id);
    await expect(quarry.correctPurchase(saved.id,{...draft({destinationType:'company_site',companySiteId:other.id}),correctionReason:'Move'} as never)).rejects.toThrow('Select an active company site');
  });

  it('copies the destination onto a truck-counter trip and finds site loads by name',async()=>{
    const {db,quarry,yard,draft}=await setup();
    const first=await quarry.confirmPurchase(draft({destinationType:'company_site',companySiteId:yard.id,recordDate:'2026-10-05'}));
    const trip=await quarry.incrementPurchase(first.id,18);
    expect(trip).toMatchObject({destinationType:'company_site',companySiteId:yard.id,projectId:null});
    expect(purchaseDestinationLabel(trip)).toBe('Company Site: Yard B');
    expect(db.raw.prepare("SELECT COUNT(*) n FROM quarry_purchases WHERE company_site_id=?").get(yard.id)).toEqual({n:2});
  });
});

describe('loads linked to a project before this change',()=>{
  it('read exactly as before: same destination, same totals, same numbers, nothing renamed or moved',async()=>{
    const {db,quarry,yard,draft}=await setup();
    // A row written the way every earlier build wrote it: project columns only, the new columns left empty.
    db.raw.exec(`INSERT INTO quarry_purchases (id,purchase_number,confirmed_at,supplier_id,supplier_name,project_id,project_name,item_id,item_name,category_name,unit_id,unit_name,unit_symbol,quantity_cubic_metres,delivery_method,driver_profile_id,driver_name,truck_profile_id,truck_plate,payment_status,photos_json,entered_at)
      VALUES ('old','SUP-20260901-A1-00001','2026-09-01T09:00:00.000Z','sup','Al-Nour Quarry','road','Mountain Road','base','Base course','Aggregates','unit_ton','Ton','t',12.5,'supplier','system_supplier_delivery_driver','Supplier Delivering','system_supplier_delivery_truck','T-9','Unpriced','[]','2026-09-01T09:00:00.000Z')`);
    const before=db.raw.prepare('SELECT * FROM quarry_purchases WHERE id=?').get('old');
    const [old]=await quarry.listPurchases();
    expect(old).toMatchObject({id:'old',purchaseNumber:'SUP-20260901-A1-00001',projectId:'road',projectName:'Mountain Road',quantityCubicMetres:12.5,destinationType:'project',companySiteId:null});
    expect(purchaseDestination(old!)).toMatchObject({type:'project',projectId:'road'});
    expect(purchaseDestinationLabel(old!)).toBe('Project: Mountain Road');
    expect(summarizeSupplierDeliveries([old!]).map(group=>group.projectGroups.map(value=>[value.projectId,value.projectName,value.materials[0]!.quantity]))).toEqual([[['road','Mountain Road',12.5]]]);
    // Adding a site load changes nothing about the old record or its project's totals.
    await quarry.confirmPurchase(draft({destinationType:'company_site',companySiteId:yard.id}));
    expect(db.raw.prepare('SELECT * FROM quarry_purchases WHERE id=?').get('old')).toEqual(before);
    const totals=await new SqliteProjectTotalsRepository(db as never).getProjectTotals('road',{fromDate:'',toDate:''});
    expect(totals.deliveries.map(row=>[row.quantity,row.recordCount])).toEqual([[12.5,1]]);
  });
});
