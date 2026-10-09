import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {customizedListHeader,defaultHeaderCustomization,type HeaderCompany} from '../src/domain/companyHeaders';
import {emptyQuarryPurchaseDraft,type QuarryPurchaseDraft} from '../src/domain/quarry';
import {buildSupplierDeliveriesPdf,supplierPdfChoices} from '../src/domain/supplierDeliveriesPdf';
import {buildSupplierDeliveriesHtml} from '../src/services/supplierDeliveriesTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-506. The PDF of what one supplier delivered: "Totals" with the supplier's name in bold, grouped by project or
 * site, every load listed with its number and prefix, units never mixed, Unpriced never $0, and the header the
 * person chose.
 */
const open:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-09T10:30:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of open.splice(0))database.close();});
const read=(file:string)=>readFileSync(join(__dirname,'..',file),'utf8');

async function build(){
  const db=await migratedDatabaseWithProject(open);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('nour','Al-Nour Quarry',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('other','Other Supplier',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,created_at,updated_at) VALUES ('base','cat','Base course','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,created_at,updated_at) VALUES ('sand','cat','Sand','unit_m3',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const quarry=new SqliteQuarryRepository(db as never),fuel=new SqliteFuelRepository(db as never);
  const yard=await fuel.createCompanySite('Yard B');
  const draft=(extra:Partial<QuarryPurchaseDraft>):QuarryPurchaseDraft=>({...emptyQuarryPurchaseDraft,recordDate:'2026-10-02',supplierId:'nour',itemId:'base',unitId:'unit_ton',quantityCubicMetres:'20',deliveryMethod:'supplier',supplierTruckPlate:'',...extra});
  const a=await quarry.confirmPurchase(draft({destinationType:'project',projectId:'road',recordDate:'2026-09-03',unitPriceUsd:'12.50'}));
  const b=await quarry.confirmPurchase(draft({destinationType:'project',projectId:'road',recordDate:'2026-09-17',supplierTruckPlate:'T-1'}));
  const c=await quarry.confirmPurchase(draft({destinationType:'company_site',companySiteId:yard.id,recordDate:'2026-09-29',quantityCubicMetres:'40'}));
  const d=await quarry.confirmPurchase(draft({itemId:'sand',unitId:'unit_m3',quantityCubicMetres:'12',recordDate:'2026-09-05'}));
  const gone=await quarry.confirmPurchase(draft({destinationType:'project',projectId:'road',quantityCubicMetres:'99'}));
  await quarry.cancelPurchase(gone.id,'Entered twice');
  await quarry.confirmPurchase(draft({supplierId:'other',destinationType:'project',projectId:'road',quantityCubicMetres:'7'}));
  await quarry.correctPurchase(b.id,{...draft({destinationType:'project',projectId:'road',recordDate:'2026-09-17',supplierTruckPlate:'T-1',quantityCubicMetres:'21'}),correctionReason:'Weighbridge'} as never);
  const purchases=await quarry.listPurchases();
  return {db,quarry,fuel,yard,purchases,ids:{a:a.id,b:b.id,c:c.id,d:d.id}};
}
const base={includePrices:false,includeDiesel:false};

describe('what the supplier PDF lists',()=>{
  it('groups Active loads by project, then site, then unassigned, one row per load with its number, and leaves cancelled loads out',async()=>{
    const {purchases,yard}=await build();
    const pdf=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,filters:base,generatedAt:'2026-10-09T10:30:00'});
    expect(pdf.destinations.map(group=>[group.label,group.type,group.loads.length])).toEqual([['Mountain Road','project',2],['Yard B (Site)','company_site',1],['Unassigned deliveries','unassigned',1]]);
    expect(pdf.loadCount).toBe(4);
    const all=pdf.destinations.flatMap(group=>group.loads);
    expect(all.every(load=>/^SUP-\d{8}-[A-Z0-9]+-\d{5}$/.test(load.reference))).toBe(true);
    expect(all.some(load=>load.quantityText.startsWith('99'))).toBe(false);
    expect(pdf.destinations[0]!.loads.map(load=>[load.quantityText,load.status])).toEqual([['20 t','Active'],['21 t','Corrected']]);
    expect(pdf.destinations[1]!.loads[0]!.driver).toBe('Supplier Delivering');
    void yard;
  });

  it('totals each material in its own unit and never adds tons to cubic metres',async()=>{
    const {purchases}=await build();
    const pdf=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,filters:base,generatedAt:'2026-10-09T10:30:00'});
    expect(pdf.totals.map(total=>[total.item,total.quantityText,total.count])).toEqual([['Base course','81 t',3],['Sand','12 m³',1]]);
    expect(pdf.destinations[0]!.totals.map(total=>[total.item,total.quantityText])).toEqual([['Base course','41 t']]);
    expect(pdf.destinations[1]!.totals.map(total=>total.quantityText)).toEqual(['40 t']);
  });

  it('filters by dates, materials and destinations, and states them',async()=>{
    const {purchases,yard}=await build();
    const sand=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,filters:{...base,itemIds:['sand']},generatedAt:'2026-10-09T10:30:00'});
    expect(sand.loadCount).toBe(1);expect(sand.meta).toContainEqual({label:'Materials',value:'Sand'});
    const site=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,filters:{...base,destinationKeys:[`site:${yard.id}`]},generatedAt:'2026-10-09T10:30:00'});
    expect(site.destinations.map(group=>group.label)).toEqual(['Yard B (Site)']);
    expect(site.meta).toContainEqual({label:'Destinations',value:'Yard B (Site)'});
    const september=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,filters:{...base,fromDate:'2026-09-10',toDate:'2026-09-30'},generatedAt:'2026-10-09T10:30:00'});
    expect(september.loadCount).toBe(2);expect(september.meta).toContainEqual({label:'Dates',value:'10 Sep 2026 – 30 Sep 2026'});
    expect(september.fileName).toBe('Totals-Al-Nour-Quarry-2026-09-10_to_2026-09-30.pdf');
    const empty=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,filters:{...base,fromDate:'2027-01-01'},generatedAt:'2026-10-09T10:30:00'});
    expect(empty.empty).toBe(true);
  });

  it('prints prices only when asked, with Unpriced instead of $0.00',async()=>{
    const {purchases}=await build();
    const without=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,filters:base,generatedAt:'2026-10-09T10:30:00'});
    expect(without.destinations.flatMap(group=>group.loads).every(load=>load.unitPrice===undefined&&load.total===undefined)).toBe(true);
    const htmlWithout=buildSupplierDeliveriesHtml({companyName:'DROMEX',logo:null,contactLine:null,report:without});
    expect(htmlWithout).not.toContain('Unpriced');expect(htmlWithout).not.toContain('<th class="num">Price</th>');
    const withPrices=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,filters:{...base,includePrices:true},generatedAt:'2026-10-09T10:30:00'});
    const loads=withPrices.destinations.flatMap(group=>group.loads);
    expect(loads.find(load=>load.unitPrice==='$12.50')).toBeTruthy();
    expect(loads.filter(load=>load.unitPrice==='Unpriced').length).toBe(3);
    const html=buildSupplierDeliveriesHtml({companyName:'DROMEX',logo:null,contactLine:null,report:withPrices});
    expect(html).toContain('Unpriced');expect(html).not.toContain('$0.00');expect(html).toContain('unpriced load');
  });

  it('offers exactly the supplier\'s own active materials and destinations to choose from',async()=>{
    const {purchases,yard}=await build();
    const choices=supplierPdfChoices(purchases,'nour');
    expect(choices.items.map(item=>[item.name,item.unitSymbol,item.count])).toEqual([['Base course','t',3],['Sand','m³',1]]);
    expect(choices.destinations.map(value=>[value.name,value.type,value.key,value.count])).toEqual([['Mountain Road','project','road',2],['Yard B','company_site',`site:${yard.id}`,1],['Unassigned','unassigned','__unassigned__',1]]);
  });
});

describe('the page itself',()=>{
  it('is headed Totals with the supplier name in bold, shows the filters and every load number, and isolates long and Arabic names',async()=>{
    const {purchases}=await build();
    const pdf=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'مؤسسة النور للمقالع والمحاجر — Al-Nour Quarry and Crushing Company',purchases,filters:base,generatedAt:'2026-10-09T10:30:00'});
    const html=buildSupplierDeliveriesHtml({companyName:'DROMEX Construction',logo:null,contactLine:'Aley · 01 234 567',report:pdf});
    expect(html).toContain('<h1>Totals</h1>');
    expect(html).toContain('<div class="who"><bdi dir="auto">مؤسسة النور للمقالع والمحاجر — Al-Nour Quarry and Crushing Company</bdi></div>');
    expect(html).not.toContain('Company Totals');
    for(const load of pdf.destinations.flatMap(group=>group.loads))expect(html).toContain(load.reference);
    expect(html).toContain('Yard B (Site)');expect(html).toContain('Not recorded');
    expect(html).toContain('thead{display:table-header-group}');expect(html).toContain('Page " counter(page)');
    expect(html).toContain('DROMEX Construction');expect(html).toContain('Aley · 01 234 567');
  });

  it('prints diesel in litres as its own block, never in the material totals',async()=>{
    const {db,fuel,purchases}=await build();
    vi.setSystemTime(new Date('2026-09-01T08:00:00'));await fuel.startDieselBatches({dipLitres:'',pricePerLitreUsd:''});
    vi.setSystemTime(new Date('2026-09-22T09:00:00'));
    await fuel.recordDelivery({recordDate:'2026-09-22',supplierId:'nour',litres:'3000',ticketNumber:'55821',pricePerLitreUsd:'1.10',updateCurrentPrice:false,notes:''});
    vi.setSystemTime(new Date('2026-09-25T09:00:00'));
    await fuel.recordDelivery({recordDate:'2026-09-25',supplierId:'nour',litres:'500',ticketNumber:'',pricePerLitreUsd:'',updateCurrentPrice:false,notes:''});
    const batches=(await fuel.getBatchOverview()).batches;
    const pdf=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,batches,filters:{includePrices:true,includeDiesel:true},generatedAt:'2026-10-09T10:30:00'});
    expect(pdf.diesel).toMatchObject({batchCount:2,totalLitres:'3,500 L',amount:'$3,300.00',unpricedNote:'1 unpriced batch'});
    expect(pdf.totals.every(total=>total.unitSymbol!=='L')).toBe(true);
    const html=buildSupplierDeliveriesHtml({companyName:'DROMEX',logo:null,contactLine:null,report:pdf});
    expect(html).toContain('Diesel delivered (litres only)');expect(html).toContain('Litres are never added to tons or m³.');
    const off=buildSupplierDeliveriesPdf({supplierId:'nour',supplierName:'Al-Nour Quarry',purchases,batches,filters:{includePrices:false,includeDiesel:false},generatedAt:'2026-10-09T10:30:00'});
    expect(off.diesel).toBeNull();
    void db;
  });
});

describe('the header the person chooses',()=>{
  const header:HeaderCompany={kind:'plant',name:'DROMEX Construction',logoUri:'file:///logo.png',address:'Aley',phone:'01 234 567',email:'info@dromex.test',taxVatNumber:'123',registrationNumber:null,footer:null,signer:null,note:null};
  it('prints the saved company exactly as it is by default',()=>{
    expect(customizedListHeader(header,defaultHeaderCustomization)).toEqual({companyName:'DROMEX Construction',logoUri:'file:///logo.png',contactLine:'Aley · 01 234 567 · info@dromex.test · Tax/VAT: 123'});
  });
  it('lets one PDF drop the logo, rename itself and choose its details, without touching the company',()=>{
    expect(customizedListHeader(header,{showLogo:false,name:'DROMEX Plant Division',address:true,phone:false,email:true,taxVatNumber:false})).toEqual({companyName:'DROMEX Plant Division',logoUri:null,contactLine:'Aley · info@dromex.test'});
    expect(customizedListHeader(header,{...defaultHeaderCustomization,address:false,phone:false,email:false,taxVatNumber:false}).contactLine).toBeNull();
    expect(header.name).toBe('DROMEX Construction');
  });
});

describe('where the controls live',()=>{
  it('puts Export PDF inside an opened supplier on the Supplier Loads page and in no other place that changes data',()=>{
    const screen=read('src/ui/screens/QuarryPurchasesScreen.tsx');
    expect(screen).toContain('<SupplierDeliveriesExport');expect(screen).toContain('What I received from this supplier');
    expect(screen).toContain('exportAndShareSupplierDeliveries');
    expect(read('src/ui/DromexApp.tsx')).toContain('<QuarryPurchasesScreen repository={quarryRepository} fuel={fuelRepository}');
  });
  it('offers the header customizer on every list PDF that has a Header company picker',()=>{
    for(const file of ['src/ui/components/useExportHeader.tsx','src/ui/components/LoadHistoryExport.tsx','src/ui/components/totals/TotalsExplorer.tsx'])expect(read(file)).toContain('<HeaderCustomizer');
  });
});
