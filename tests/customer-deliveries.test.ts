import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';

import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import {buildMaterialTree,treeTotals} from '../src/domain/companyTotals';
import {countCustomerDeliveryFilters,customerDeliveryFilters,customerDeliveryLabels,describeDeliveredLoad,emptyCustomerDeliveryScope} from '../src/domain/customerDeliveries';
import {LEGACY_LOAD_NUMBER_LABEL} from '../src/domain/loadNumberSeries';
import {buildTotalsHtml} from '../src/services/totalsTemplate';
import {type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/** A customer's page: what was delivered to them, grouped by material, with the history of delivered loads. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

async function setup(){
  const fixture=await recordsDatabase(databases);
  const {companyLoad,supplierLoad}=fixture;
  companyLoad('sand',{project:'road',quantity:10,unit:'t',loadNumber:'AGG-00001',day:'2026-08-10'});
  companyLoad('sand',{project:'road',quantity:6,unit:'m³',loadNumber:'AGG-00002',day:'2026-08-11'});
  companyLoad('asphalt',{project:'other',quantity:20,unit:'t',loadNumber:'ASP-00001',day:'2026-08-12'});
  companyLoad('asphalt',{project:'road',quantity:15,unit:'t',loadNumber:null,day:'2026-07-01'});                       // a legacy load
  companyLoad('sand',{project:'road',quantity:99,unit:'t',status:'Cancelled',loadNumber:'AGG-00003'});                   // cancelled: never shown
  companyLoad('sand',{project:'road',customer:'cust_b',quantity:5,unit:'t',loadNumber:'AGG-00004'});                      // another customer
  supplierLoad('sand',{supplier:'sup_a',project:'road',quantity:8,unit:'m³'});                                           // not delivered to a customer
  return {...fixture,totals:new SqliteCompanyTotalsRepository(fixture.db as never)};
}

describe('customer delivery scope',()=>{
  it('narrows Company Totals to the one customer, delivered only',()=>{
    const filters=customerDeliveryFilters('customer',{...emptyCustomerDeliveryScope(),fromDate:'2026-08-01',projectKey:'road',itemKey:'id:sand'});
    expect(filters).toMatchObject({customerKeys:['customer'],fromDate:'2026-08-01',projectKey:'road',itemKey:'id:sand',view:'delivered'});
  });
  it('counts only the pages own filters, never the customer',()=>{
    expect(countCustomerDeliveryFilters(emptyCustomerDeliveryScope())).toBe(0);
    expect(countCustomerDeliveryFilters({fromDate:'2026-08-01',toDate:'2026-08-31',projectKey:'road',itemKey:''})).toBe(2);
  });
  it('says on the PDF who and what it covers',()=>{
    const names={project:'Mountain Road',item:'Sand'};
    const scope={fromDate:'',toDate:'',projectKey:'road',itemKey:'id:sand'};
    expect(customerDeliveryLabels('Road Co',emptyCustomerDeliveryScope(),{})).toEqual([expect.any(String),'Customer: Road Co']);
    expect(customerDeliveryLabels('Road Co',scope,names)).toContain('Project: Mountain Road');
    expect(customerDeliveryLabels('Road Co',scope,names)).toContain('Item: Sand');
  });
});

describe('what was delivered to a customer',()=>{
  it('groups by material with a total per unit, never mixing units, and leaves out cancelled, other customers and Supplier Loads',async()=>{
    const {totals}=await setup();
    const data=await totals.getCompanyTotals(customerDeliveryFilters('customer',emptyCustomerDeliveryScope()));
    const tree=buildMaterialTree(data);
    expect(tree.map(material=>material.itemName)).toEqual(['Asphalt','Sand']);
    const figures=(name:string)=>tree.find(material=>material.itemName===name)!.units.map(unit=>`${unit.delivered!.quantity} ${unit.unitSymbol}`).sort();
    expect(figures('Sand')).toEqual(['10 t','6 m³']);
    expect(figures('Asphalt')).toEqual(['35 t']);
    expect(treeTotals(tree).inclusion.total).toBe(4);
    expect(data.deliveries.every(row=>row.source==='company_delivery')).toBe(true);
  });
  it('drills Material to Project',async()=>{
    const {totals}=await setup();
    const tree=buildMaterialTree(await totals.getCompanyTotals(customerDeliveryFilters('customer',emptyCustomerDeliveryScope())));
    const asphalt=tree.find(material=>material.itemName==='Asphalt')!;
    expect(asphalt.projects.map(project=>`${project.projectName}: ${project.units[0]!.delivered!.quantity}`).sort()).toEqual(['Coastal Road: 20','Mountain Road: 15']);
  });
  it('follows the date range, project and material filters',async()=>{
    const {totals}=await setup();
    const inRange=await totals.listRecords(customerDeliveryFilters('customer',{...emptyCustomerDeliveryScope(),fromDate:'2026-08-01'}));
    expect(inRange.map(record=>record.snapshot.loadNumber)).toEqual(['AGG-00001','AGG-00002','ASP-00001']);
    const byProject=await totals.listRecords(customerDeliveryFilters('customer',{...emptyCustomerDeliveryScope(),projectKey:'other'}));
    expect(byProject.map(record=>record.snapshot.loadNumber)).toEqual(['ASP-00001']);
    const byItem=await totals.listRecords(customerDeliveryFilters('customer',{...emptyCustomerDeliveryScope(),itemKey:'id:asphalt'}));
    expect(byItem).toHaveLength(2);
  });
  it('lists the history oldest first with the load number, a legacy load labelled as such, and never a cancelled load',async()=>{
    const {totals}=await setup();
    const history=await totals.listRecords(customerDeliveryFilters('customer',emptyCustomerDeliveryScope()));
    expect(history.map(record=>record.snapshot.loadNumber)).toEqual([null,'AGG-00001','AGG-00002','ASP-00001']);
    expect(history.every(record=>record.status==='Active')).toBe(true);
    const lines=history.map(describeDeliveredLoad);
    expect(lines[0]!.title).toBe(LEGACY_LOAD_NUMBER_LABEL);
    expect(lines[0]!.legacy).toBe(true);
    expect(lines[1]).toMatchObject({title:'AGG-00001',legacy:false,project:'Mountain Road',status:'Active'});
    expect(lines.map(line=>line.destination).every(text=>text.length>0)).toBe(true);
  });
  it('shows an empty page for a customer with no deliveries, not a zero',async()=>{
    const {totals}=await setup();
    const data=await totals.getCompanyTotals(customerDeliveryFilters('cust_none',emptyCustomerDeliveryScope()));
    expect(buildMaterialTree(data)).toEqual([]);
  });
  it('is read-only: nothing in the database changes',async()=>{
    const {totals,db}=await setup();
    const count=()=>(db.raw.prepare('SELECT COUNT(*) n FROM loads').get() as {n:number}).n;
    const before=count();
    await totals.getCompanyTotals(customerDeliveryFilters('customer',emptyCustomerDeliveryScope()));
    await totals.listRecords(customerDeliveryFilters('customer',emptyCustomerDeliveryScope()));
    expect(count()).toBe(before);
  });
});

describe('describeDeliveredLoad',()=>{
  it('says Not recorded for a missing destination and never a blank',async()=>{
    const {totals}=await setup();
    const [record]=await totals.listRecords(customerDeliveryFilters('customer',{...emptyCustomerDeliveryScope(),itemKey:'id:asphalt',projectKey:'other'}));
    const none={destination:null,driverName:null,truckPlate:null,deliveredBy:null};
    const line=describeDeliveredLoad({...record!,details:none});
    expect(line.destination).toBe('Not recorded');
    expect(line.destinationRecorded).toBe(false);
    expect(describeDeliveredLoad({...record!,details:{...none,destination:'Zahle, km 12'}}).destination).toBe('Zahle, km 12');
  });
});

describe('Customer Deliveries PDF',()=>{
  it('names the customer, carries the filter line, lists the loads and keeps prices off by default',async()=>{
    const {totals}=await setup();
    const filters=customerDeliveryFilters('customer',emptyCustomerDeliveryScope());
    const data=await totals.getCompanyTotals(filters),records=await totals.listRecords(filters);
    const plain=buildTotalsHtml({companyName:'DROMEX Plant',logo:null,contactLine:'Beirut · Tax/VAT: 1',title:'Customer Deliveries',scope:'company',filters:customerDeliveryLabels('Road Co',emptyCustomerDeliveryScope(),{}),
      generatedAt:'2026-10-05T16:30:00',includePrices:false,showProject:true,data,records,issuedTo:'Road Co'});
    expect(plain).toContain('Customer Deliveries');
    expect(plain).toContain('Issued to: <span dir="auto">Road Co</span>');
    expect(plain).toContain('Customer: Road Co');
    expect(plain).toContain('AGG-00001');
    expect(plain).toContain(LEGACY_LOAD_NUMBER_LABEL);
    expect(plain).not.toContain('AGG-00003');
    expect(plain).not.toContain('AGG-00004');
    expect(plain).not.toMatch(/\$\d/);
  });
});

describe('customer page screen',()=>{
  const screen=source('src/ui/components/customers/CustomerDeliveries.tsx');
  const customers=source('src/ui/screens/CustomersScreen.tsx');
  const app=source('src/ui/DromexApp.tsx');
  it('has the approved parts: closed Covering filter, material cards, history, Export PDF, Delivered vs paid',()=>{
    for(const text of ['Delivered to this customer','Covering','useState(false)','History of delivered loads','Export PDF','Delivered vs paid','label="Project"','label="Material"','label="From"','label="To"','No loads have been delivered to this customer yet.'])expect(screen).toContain(text);
  });
  it('links Delivered vs paid to Payments & Balances only, with no figure of its own',()=>{
    expect(screen).toContain('onPress={onOpenPayments}');
    expect(screen).toContain('See what was paid and what remains in Payments & Balances');
    expect(screen).not.toMatch(/paid\.toFixed|remaining\.toFixed|formatUsd|formatCents/);
    expect(customers).toContain('onOpenPayments={() => setShowCustomerFinancials(true)}');
  });
  it('opens a load from the history and returns to the same customer',()=>{
    expect(screen).toContain('onOpenRecord(record.snapshot)');
    expect(customers).toContain('initialCustomerId');
    expect(app).toContain('initialCustomerId={customerFocusId}');
    expect(app).toContain('onOpenRecord={openOriginalRecord}');
  });
  it('sits between the contact details and the customer balance',()=>{
    expect(customers.indexOf('Contact details')).toBeLessThan(customers.indexOf('<CustomerDeliveries'));
    expect(customers.indexOf('<CustomerDeliveries')).toBeLessThan(customers.indexOf('Customer balance'));
  });
});
