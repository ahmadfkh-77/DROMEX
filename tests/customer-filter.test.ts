import {afterEach,describe,expect,it} from 'vitest';

import {SqliteBusinessDocumentRepository} from '../src/data/repositories/SqliteBusinessDocumentRepository';
import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import {
  buildMaterialTree,countCompanyFilters,customerFilterLabel,customerFilterSummary,customerFilterWorthShowing,emptyCompanyTotalsFilters,NO_CUSTOMER_KEY,NO_CUSTOMER_LABEL,treeTotals,
} from '../src/domain/companyTotals';
import {queriesFor} from '../src/domain/documentStartQuery';
import {type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/** The customer filter in Company Totals, Company Load Totals and the document start list. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const fixture=await recordsDatabase(databases);
  // The owner's own company is the customer on its own projects (DEC-006).
  fixture.db.raw.exec("INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('own','company','DROMEX Asphalt Co.',1,1,'x','x')");
  const {companyLoad,supplierLoad}=fixture;
  const ids={
    roadCo:companyLoad('sand',{project:'road',quantity:10,unit:'t',loadNumber:'AGG-00001'}),                       // customer 'customer' = Road Co
    roadCo2:companyLoad('asphalt',{project:'road',quantity:20,unit:'t',loadNumber:'ASP-00001'}),
    beirut:companyLoad('sand',{project:'other',customer:'cust_b',quantity:5,unit:'m³',loadNumber:'AGG-00002'}),
    own:companyLoad('sand',{project:'road',customer:'own',quantity:7,unit:'t',loadNumber:'AGG-00003'}),
    cancelled:companyLoad('sand',{project:'road',customer:'cust_b',quantity:99,unit:'t',status:'Cancelled'}),
    supplier:supplierLoad('sand',{supplier:'sup_a',project:'road',quantity:8,unit:'m³'}),
  };
  fixture.report('road','2026-08-12',[{itemId:'sand',itemName:'Sand',unitId:'unit_m3',unitSymbol:'m³',quantity:9,movement:'used'}]);
  return {...fixture,ids,totals:new SqliteCompanyTotalsRepository(fixture.db as never)};
}
const totalOf=(data:Awaited<ReturnType<SqliteCompanyTotalsRepository['getCompanyTotals']>>)=>treeTotals(buildMaterialTree(data));
const filters=(customerKeys:string[])=>({...emptyCompanyTotalsFilters(),customerKeys});

describe('customer filter rules',()=>{
  it('starts empty, counts as one filter when used, and changes nothing when empty',()=>{
    expect(emptyCompanyTotalsFilters().customerKeys).toEqual([]);
    expect(countCompanyFilters(emptyCompanyTotalsFilters())).toBe(0);
    expect(countCompanyFilters(filters(['customer','cust_b']))).toBe(1);
  });
  it('writes the chosen customers for a PDF filter line and for the field',()=>{
    const choices=[{key:'customer',name:'Road Co'},{key:'cust_b',name:'Beirut Builders'},{key:NO_CUSTOMER_KEY,name:NO_CUSTOMER_LABEL}];
    expect(customerFilterLabel([],choices)).toBeNull();
    expect(customerFilterLabel(['cust_b','customer'],choices)).toBe('Customers: Road Co, Beirut Builders');
    expect(customerFilterLabel([NO_CUSTOMER_KEY],choices)).toBe('Customers: No customer / Internal');
    expect(customerFilterLabel(['gone'],choices)).toBeNull();
    expect(customerFilterSummary([],choices)).toBe('All customers');
    expect(customerFilterSummary(['customer'],choices)).toBe('Road Co');
    expect(customerFilterSummary(['customer','cust_b'],choices)).toBe('Road Co and 1 more');
  });
  it('shows in Project Totals only when the project has more than one customer',()=>{
    expect(customerFilterWorthShowing('company',0)).toBe(true);
    expect(customerFilterWorthShowing('project',1)).toBe(false);
    expect(customerFilterWorthShowing('project',2)).toBe(true);
  });
});

describe('customer filter in Company Totals',()=>{
  it('behaves exactly as today when no customer is chosen',async()=>{
    const {totals}=await setup();
    const all=await totals.getCompanyTotals(emptyCompanyTotalsFilters());
    expect(totalOf(all).inclusion.total).toBe(5); // 4 Active company loads + 1 supplier load, cancelled left out
    expect(all.usageHiddenReason).toBeNull();
    expect(all.usage.length).toBeGreaterThan(0);
  });
  it('narrows to one customer’s company loads and drops supplier deliveries',async()=>{
    const {totals}=await setup();
    const data=await totals.getCompanyTotals(filters(['customer']));
    expect(data.deliveries.every(row=>row.source==='company_delivery')).toBe(true);
    expect(totalOf(data).inclusion.total).toBe(2);
    const sand=data.deliveries.filter(row=>row.itemKey==='id:sand');
    expect(sand).toHaveLength(1);
    expect(sand[0]!.quantity).toBe(10);
    expect(sand[0]!.unitSymbol).toBe('t');
  });
  it('adds several customers together without mixing units, and never counts a cancelled load',async()=>{
    const {totals}=await setup();
    const data=await totals.getCompanyTotals(filters(['customer','cust_b']));
    expect(totalOf(data).inclusion.total).toBe(3);
    const sand=data.deliveries.filter(row=>row.itemKey==='id:sand').map(row=>`${row.quantity} ${row.unitSymbol}`).sort();
    expect(sand).toEqual(['10 t','5 m³']);
  });
  it('keeps the own company reachable as No customer / Internal',async()=>{
    const {totals}=await setup();
    const data=await totals.getCompanyTotals(filters([NO_CUSTOMER_KEY]));
    expect(totalOf(data).inclusion.total).toBe(1);
    expect(data.deliveries[0]!.quantity).toBe(7);
    const mixed=await totals.getCompanyTotals(filters([NO_CUSTOMER_KEY,'cust_b']));
    expect(totalOf(mixed).inclusion.total).toBe(2);
  });
  it('says use is hidden while a customer is chosen, and returns no use rows',async()=>{
    const {totals}=await setup();
    const data=await totals.getCompanyTotals(filters(['customer']));
    expect(data.usageHiddenReason).toBe('Use is not recorded per customer, so it is hidden while a customer is chosen.');
    expect(data.usage).toEqual([]);
  });
  it('works together with the other filters',async()=>{
    const {totals}=await setup();
    const withItem=await totals.getCompanyTotals({...filters(['customer']),itemKey:'id:asphalt'});
    expect(totalOf(withItem).inclusion.total).toBe(1);
    const withProject=await totals.getCompanyTotals({...filters(['cust_b']),projectKey:'road'});
    expect(totalOf(withProject).inclusion.total).toBe(0);
    const withDates=await totals.getCompanyTotals({...filters(['customer']),fromDate:'2026-09-01'});
    expect(totalOf(withDates).inclusion.total).toBe(0);
  });
  it('lists the records behind the filter, company loads of the chosen customers only',async()=>{
    const {totals}=await setup();
    const records=await totals.listRecords(filters(['customer']));
    expect(records.map(record=>record.snapshot.loadNumber).sort()).toEqual(['AGG-00001','ASP-00001']);
    expect(records.every(record=>record.snapshot.recordType==='company_load')).toBe(true);
  });
});

describe('customer filter in Company Load Totals',()=>{
  it('follows the filter in the totals and in the load list, with status kept apart',async()=>{
    const {totals}=await setup();
    const rows=await totals.getCompanyLoadTotals(filters(['cust_b']));
    expect(rows.filter(row=>row.status==='Active').reduce((sum,row)=>sum+row.loadCount,0)).toBe(1);
    expect(rows.filter(row=>row.status==='Cancelled').reduce((sum,row)=>sum+row.loadCount,0)).toBe(1);
    const active=await totals.listCompanyLoads(filters(['cust_b']),'active');
    expect(active.map(record=>record.snapshot.loadNumber)).toEqual(['AGG-00002']);
    const cancelled=await totals.listCompanyLoads(filters(['cust_b']),'cancelled');
    expect(cancelled).toHaveLength(1);
  });
});

describe('customer choices',()=>{
  it('lists customers with Active company loads and the always-present No customer / Internal',async()=>{
    const {totals}=await setup();
    const choices=await totals.listCustomerChoices({fromDate:'',toDate:''});
    expect(choices.map(choice=>choice.name)).toEqual(['Beirut Builders','Road Co',NO_CUSTOMER_LABEL]);
    expect(choices.find(choice=>choice.key==='customer')).toMatchObject({loadCount:2,projectCount:1,isOwnCompany:false});
    expect(choices.find(choice=>choice.key==='cust_b')).toMatchObject({loadCount:1,projectCount:1});
    expect(choices.find(choice=>choice.key===NO_CUSTOMER_KEY)).toMatchObject({loadCount:1,isOwnCompany:true});
  });
  it('keeps No customer / Internal listed with zero loads, and narrows by date and project',async()=>{
    const {totals}=await setup();
    const none=await totals.listCustomerChoices({fromDate:'2026-09-01',toDate:''});
    expect(none).toEqual([{key:NO_CUSTOMER_KEY,name:NO_CUSTOMER_LABEL,loadCount:0,projectCount:0,isOwnCompany:true}]);
    const road=await totals.listCustomerChoices({fromDate:'',toDate:'',projectKey:'road'});
    expect(road.map(choice=>choice.name)).toEqual(['Road Co',NO_CUSTOMER_LABEL]);
  });
});

describe('customer filter in the document start list',()=>{
  it('starts a document from the filtered customers’ company loads only',async()=>{
    const {db}=await setup();
    const documents=new SqliteBusinessDocumentRepository(db as never);
    const queries=queriesFor({...emptyCompanyTotalsFilters(),customerKeys:['customer']});
    expect(queries.map(query=>query.side)).toEqual(['customer']);
    const found=(await Promise.all(queries.map(query=>documents.listEligibleRecords(query)))).flat();
    expect(found.map(record=>record.snapshot.loadNumber).sort()).toEqual(['AGG-00001','ASP-00001']);
    const internal=await documents.listEligibleRecords(queriesFor({...emptyCompanyTotalsFilters(),customerKeys:[NO_CUSTOMER_KEY]})[0]!);
    expect(internal.map(record=>record.snapshot.loadNumber)).toEqual(['AGG-00003']);
  });
  it('offers nothing when a customer and a specific supplier are both chosen, and both sides when no customer is chosen',()=>{
    expect(queriesFor({...emptyCompanyTotalsFilters(),customerKeys:['customer'],supplierKey:'id:sup_a'})).toEqual([]);
    expect(queriesFor(emptyCompanyTotalsFilters()).map(query=>query.side).sort()).toEqual(['customer','supplier']);
  });
});
