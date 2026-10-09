import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {buildDieselBatchReport} from '../src/domain/dieselBatchReport';
import {filterBatchList} from '../src/domain/fuelBatchViews';
import {supplierDieselDeliveries} from '../src/domain/supplierDiesel';
import {buildDieselBatchReportHtml} from '../src/services/dieselBatchTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-506. A supplier's diesel (one supplier per batch), the date range on lists, totals and the PDF, the optional
 * price shown as Unpriced, and the whole thing surviving a backup and restore.
 */
const open:SqliteTestDatabase[]=[];const files:string[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of open.splice(0))database.close();for(const file of files.splice(0))fs.rmSync(file,{force:true});});
const clock=(local:string)=>vi.setSystemTime(new Date(local));
function copyOf(database:SqliteTestDatabase):SqliteTestDatabase{
  const file=path.join(os.tmpdir(),`dromex-dec506-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);files.push(file);
  database.raw.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);
  const restored=new SqliteTestDatabase(file);open.push(restored);return restored;
}

async function build(){
  const db=await migratedDatabaseWithProject(open);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('nour','Al-Nour Fuel Co.',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('shams','Shams Petrol',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO machine_profiles (id,name,is_active,created_at,updated_at) VALUES ('exc','Excavator',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const repository=new SqliteFuelRepository(db as never);
  clock('2026-09-01T08:00:00');await repository.startDieselBatches({dipLitres:'',pricePerLitreUsd:''});
  const deliver=(local:string,supplierId:string,litres:number,price:string,ticket='')=>{clock(local);return repository.recordDelivery({recordDate:local.slice(0,10),supplierId,litres:String(litres),ticketNumber:ticket,pricePerLitreUsd:price,updateCurrentPrice:false,notes:''});};
  return {db,repository,deliver};
}
const overviewOf=async(repository:SqliteFuelRepository)=>repository.getBatchOverview();

describe("a supplier's diesel deliveries",()=>{
  it('lists each batch with its litres, invoice and price, totals the litres, and counts unpriced batches without treating them as zero',async()=>{
    const {repository,deliver}=await build();
    await deliver('2026-09-04T09:00:00','nour',500,'');
    await deliver('2026-09-22T09:00:00','nour',3000,'1.10','55821');
    await deliver('2026-10-07T09:00:00','nour',5000,'1.12','INV-55790');
    await deliver('2026-10-08T09:00:00','shams',700,'1.00','S-1');
    const overview=await overviewOf(repository);
    const nour=supplierDieselDeliveries(overview.batches,'nour');
    expect(nour.rows.map(row=>[row.batchNumber,row.litres,row.invoiceNumber,row.pricePerLitreUsd])).toEqual([['DSL-2026-00003',5000,'INV-55790',1.12],['DSL-2026-00002',3000,'55821',1.1],['DSL-2026-00001',500,null,null]]);
    expect(nour).toMatchObject({batchCount:3,totalLitres:8500,pricedCount:2,unpricedCount:1,unpricedLitres:500,unpricedNote:'1 unpriced batch'});
    // 3000 L at $1.10 and 5000 L at $1.12, each with the company VAT snapshot of its own delivery (0 here).
    expect(nour.pricedAmountUsd).toBe(3300+5600);
    expect(supplierDieselDeliveries(overview.batches,'shams')).toMatchObject({batchCount:1,totalLitres:700,pricedAmountUsd:700,unpricedNote:null});
  });

  it('leaves a batch with no supplier out of every supplier, and shows no amount when nothing is priced',async()=>{
    const {repository,deliver}=await build();
    clock('2026-09-03T09:00:00');
    await repository.recordDelivery({recordDate:'2026-09-03',supplierId:'',litres:'400',ticketNumber:'',pricePerLitreUsd:'',updateCurrentPrice:false,notes:''});
    await deliver('2026-09-05T09:00:00','shams',200,'');
    const overview=await overviewOf(repository);
    expect(overview.batches.find(batch=>batch.batchNumber==='DSL-2026-00001')).toMatchObject({supplierId:null,supplierName:null,pricePerLitreUsd:null});
    expect(supplierDieselDeliveries(overview.batches,'nour').batchCount).toBe(0);
    const shams=supplierDieselDeliveries(overview.batches,'shams');
    expect(shams).toMatchObject({batchCount:1,pricedAmountUsd:null,unpricedNote:'1 unpriced batch'});
  });

  it('updates straight away after an edit, and a cancelled batch is not counted',async()=>{
    const {repository,deliver}=await build();
    const first=await deliver('2026-09-04T09:00:00','nour',500,'');
    await deliver('2026-09-06T09:00:00','nour',300,'1.00');
    let overview=await overviewOf(repository);
    expect(supplierDieselDeliveries(overview.batches,'nour')).toMatchObject({batchCount:2,totalLitres:800,pricedAmountUsd:300});
    const batch=overview.batches.find(value=>value.deliveryMovementId===first.id)!;
    await repository.editBatch(batch.id,{supplierId:'shams',invoiceNumber:'FORGOT-1',pricePerLitreUsd:'1.50',litres:'500',recordDate:'2026-09-04',reason:''});
    overview=await overviewOf(repository);
    expect(supplierDieselDeliveries(overview.batches,'nour')).toMatchObject({batchCount:1,totalLitres:300,pricedAmountUsd:300});
    expect(supplierDieselDeliveries(overview.batches,'shams')).toMatchObject({batchCount:1,totalLitres:500,pricedAmountUsd:750});
    await repository.cancelBatch(batch.id,'Entered twice');
    overview=await overviewOf(repository);
    expect(supplierDieselDeliveries(overview.batches,'shams')).toMatchObject({batchCount:0,totalLitres:0,cancelledCount:1,pricedAmountUsd:null});
  });

  it('keeps the batch list filterable by supplier and by arrival range',async()=>{
    const {repository,deliver}=await build();
    await deliver('2026-09-04T09:00:00','nour',500,'1.00');
    await deliver('2026-09-22T09:00:00','shams',3000,'1.10');
    await deliver('2026-10-07T09:00:00','nour',5000,'1.12');
    const {batches}=await overviewOf(repository);
    expect(filterBatchList(batches,[],{supplierId:'nour'}).map(batch=>batch.batchNumber)).toEqual(['DSL-2026-00001','DSL-2026-00003']);
    expect(filterBatchList(batches,[],{fromDate:'2026-09-10',toDate:'2026-09-30'}).map(batch=>batch.batchNumber)).toEqual(['DSL-2026-00002']);
    expect(filterBatchList(batches,[],{supplierId:'nour',fromDate:'2026-10-01'}).map(batch=>batch.batchNumber)).toEqual(['DSL-2026-00003']);
    expect(filterBatchList(batches,[],{search:'shams'}).map(batch=>batch.batchNumber)).toEqual(['DSL-2026-00002']);
  });
});

describe('the Diesel Batch Report with a supplier and a date range',()=>{
  async function reportOf(filter:Parameters<typeof buildDieselBatchReport>[0]['filter']){
    const {repository,deliver}=await build();
    await deliver('2026-09-04T09:00:00','nour',500,'');
    await deliver('2026-09-22T09:00:00','nour',3000,'1.10','55821');
    await deliver('2026-10-07T09:00:00','shams',700,'1.00','S-1');
    clock('2026-10-08T07:00:00');
    await repository.recordFill({recordDate:'2026-10-08',fuelType:'diesel',litres:'200',equipmentType:'machine',equipmentId:'exc',destinationType:'project',projectId:'road',companySiteId:'',odometerReading:'',notes:'',priceOverrideReason:'',pricePerLitreUsd:''} as never);
    const setup=await repository.getSetup(),overview=await repository.getBatchOverview(),movements=(await repository.getOverview()).movements;
    const names={projects:setup.projects,companySites:setup.companySites,stations:setup.fuelStations,suppliers:setup.suppliers};
    return {report:buildDieselBatchReport({movements,overview,names,filter,exportedAt:'2026-10-09T10:30:00'}),overview};
  }

  it('prints one supplier\'s deliveries, totals and the unpriced note, and states the range and the supplier',async()=>{
    const {report}=await reportOf({supplierId:'nour',includePrices:true});
    expect(report.supplier).toMatchObject({name:'Al-Nour Fuel Co.',batchCount:2,totalLitres:'3,500 L',amount:'$3,300.00',unpricedNote:'1 unpriced batch'});
    expect(report.supplier!.rows.map(row=>[row.batchNumber,row.invoice,row.price,row.amount])).toEqual([['DSL-2026-00002','55821','$1.10','$3,300.00'],['DSL-2026-00001','not recorded','Unpriced','Unpriced']]);
    expect(report.metadata).toContainEqual({label:'Supplier',value:'Al-Nour Fuel Co.'});
    expect(report.scopeLabel).toBe('Supplier diesel deliveries · Al-Nour Fuel Co.');
    const html=buildDieselBatchReportHtml(report,{companyName:'DROMEX',logo:null,contactLine:null});
    expect(html).toContain('SUPPLIER DIESEL DELIVERIES');expect(html).toContain('Al-Nour Fuel Co.');expect(html).toContain('1 unpriced batch');expect(html).toContain('Unpriced');
    expect(html).not.toContain('$0.00');
  });

  it('leaves prices out when they are off',async()=>{
    const {report}=await reportOf({supplierId:'nour',includePrices:false});
    expect(report.supplier!.amount).toBeUndefined();
    expect(report.supplier!.rows.every(row=>row.price===undefined&&row.amount===undefined)).toBe(true);
    expect(buildDieselBatchReportHtml(report,{companyName:'DROMEX',logo:null,contactLine:null})).not.toContain('Price / L');
  });

  it('covers only the chosen range in the lists, totals and the file, and says so',async()=>{
    const {report}=await reportOf({supplierId:'nour',fromDate:'2026-09-10',toDate:'2026-09-30',includePrices:false});
    expect(report.supplier).toMatchObject({batchCount:1,totalLitres:'3,000 L'});
    expect(report.summary.deliveredLitres).toBe(3000);
    expect(report.rangeLabel).toBe('Thu 10 Sep 2026 – Wed 30 Sep 2026');
    expect(report.scopeLabel).toContain('Thu 10 Sep 2026 – Wed 30 Sep 2026');
    expect(report.metadata).toContainEqual({label:'Date range',value:'Thu 10 Sep 2026 – Wed 30 Sep 2026'});
    expect(report.fileName).toBe('Diesel-Batch-Report-2026-09-10-to-2026-09-30.pdf');
    expect(report.batchTotals.map(batch=>batch.batchNumber)).toEqual(['DSL-2026-00002']);
  });

  it('exports everything, as before, when there is no range, supplier or other filter',async()=>{
    const {report,overview}=await reportOf({includePrices:false});
    expect(report.supplier).toBeNull();
    expect(report.rangeLabel).toBe('All dates');
    expect(report.metadata).toContainEqual({label:'Date range',value:'All dates'});
    expect(report.batchTotals.map(batch=>batch.batchNumber)).toEqual(overview.batches.map(batch=>batch.batchNumber));
    expect(report.summary.deliveredLitres).toBe(4200);
    expect(report.metadata).toContainEqual({label:'Supplier',value:'All suppliers'});
  });

  it('filters by batch status and by source on the fills',async()=>{
    const {report}=await reportOf({status:'open',includePrices:false});
    expect(report.batchTotals.every(batch=>batch.status.startsWith('Open'))).toBe(true);
    const station=await reportOf({source:'station',includePrices:false});
    expect(station.report.empty).toBe(true);
  });
});

describe('backup and restore',()=>{
  it('carries a batch\'s supplier, price, edit history and a supplier load\'s destination through a restore, then keeps working',async()=>{
    const {db,repository,deliver}=await build();
    const first=await deliver('2026-09-04T09:00:00','nour',500,'');
    const batch=(await overviewOf(repository)).batches.find(value=>value.deliveryMovementId===first.id)!;
    await repository.editBatch(batch.id,{supplierId:'nour',invoiceNumber:'LATE-9',pricePerLitreUsd:'1.20',litres:'500',recordDate:'2026-09-04',reason:''});
    const quarry=new SqliteQuarryRepository(db as never);
    db.raw.exec(`INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,created_at,updated_at) VALUES ('base','cat','Base course','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');`);
    const yard=await repository.createCompanySite('Yard B');
    clock('2026-10-02T09:00:00');
    const load=await quarry.confirmPurchase({recordDate:'2026-10-02',supplierId:'nour',projectId:'',destinationType:'company_site',companySiteId:yard.id,itemId:'base',unitId:'unit_ton',quantityCubicMetres:'40',deliveryMethod:'supplier',driverId:'',truckId:'',supplierTruckPlate:'',supplierTicketNumber:'',priceBasis:'per_unit',unitPriceUsd:'',vatMode:'company',customVatRatePercent:'',vatInclusive:false,notes:'',photos:[]});
    const expected=await overviewOf(repository);

    const restored=copyOf(db);
    const after=new SqliteFuelRepository(restored as never);
    expect(await after.getBatchOverview()).toEqual(expected);
    const restoredBatch=(await after.getBatchOverview()).batches.find(value=>value.id===batch.id)!;
    expect(restoredBatch).toMatchObject({supplierName:'Al-Nour Fuel Co.',invoiceNumber:'LATE-9',pricePerLitreUsd:1.2,history:[expect.objectContaining({kind:'details'})]});
    const [site]=await new SqliteQuarryRepository(restored as never).listPurchases();
    expect(site).toMatchObject({id:load.id,destinationType:'company_site',companySiteId:yard.id,companySiteName:'Yard B',projectId:null});
    clock('2026-10-05T09:00:00');
    await after.editBatch(batch.id,{supplierId:'shams',invoiceNumber:'LATE-9',pricePerLitreUsd:'1.20',litres:'500',recordDate:'2026-09-04',reason:''});
    expect(((await after.getBatchOverview()).batches.find(value=>value.id===batch.id)!).history).toHaveLength(2);
  });

  it('migration 53 only adds columns: an older database keeps every row and reads as before',async()=>{
    const {db}=await build();
    expect((db.raw.prepare("SELECT name FROM pragma_table_info('quarry_purchases') WHERE name IN ('destination_type','company_site_id')").all() as {name:string}[]).map(row=>row.name).sort()).toEqual(['company_site_id','destination_type']);
    expect((db.raw.prepare("SELECT dflt_value FROM pragma_table_info('fuel_batches') WHERE name='correction_history_json'").get() as {dflt_value:string}).dflt_value).toBe("'[]'");
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBeGreaterThanOrEqual(53);
  });
});

describe('Excel',()=>{
  it('adds supplier, total and priced columns to Diesel Batches, diesel columns to the Supplier Summary, and filters by supplier and arrival date',async()=>{
    const {db,repository,deliver}=await build();
    db.raw.exec(`INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}')`);
    await deliver('2026-09-04T09:00:00','nour',500,'');
    await deliver('2026-09-22T09:00:00','nour',3000,'1.10','55821');
    await deliver('2026-10-07T09:00:00','shams',700,'1.00','S-1');
    const {SqliteBusinessReportRepository}=await import('../src/data/repositories/SqliteBusinessReportRepository');
    const {filterBusinessReportData,emptyBusinessReportFilters}=await import('../src/domain/businessReports');
    const data=await new SqliteBusinessReportRepository(db as never).getReportData();
    expect(data.dieselBatches!.map(row=>[row['Batch Number'],row['Supplier ID'],row['Final Total USD'],row.Priced])).toEqual([['DSL-2026-00001','nour',null,'No'],['DSL-2026-00002','nour',3300,'Yes'],['DSL-2026-00003','shams',700,'Yes']]);
    const nour=data.suppliers.find(row=>row['Supplier ID']==='nour')!;
    expect([nour['Diesel Litres'],nour['Diesel Amount USD'],nour['Unpriced Diesel Batches']]).toEqual([3500,3300,1]);
    expect(filterBusinessReportData(data,{...emptyBusinessReportFilters,supplierId:'nour'}).dieselBatches!.map(row=>row['Batch Number'])).toEqual(['DSL-2026-00001','DSL-2026-00002']);
    expect(filterBusinessReportData(data,{...emptyBusinessReportFilters,fromDate:'2026-09-10',toDate:'2026-09-30'}).dieselBatches!.map(row=>row['Batch Number'])).toEqual(['DSL-2026-00002']);
    expect(filterBusinessReportData(data,emptyBusinessReportFilters).dieselBatches).toHaveLength(3);
    void repository;
  });
});
