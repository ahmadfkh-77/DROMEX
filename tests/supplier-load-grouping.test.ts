import {describe,expect,it} from 'vitest';

import type {DailyProjectReport,LinkedQuarryLoad,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import {groupSupplierLoads} from '../src/domain/supplierLoadGroups';
import {dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';

/** DEC-480. Supplier Loads in a Daily Report are organised Item -> Supplier -> loads, with per-unit subtotals. */
let sequence=0;
function load(item:[string|null,string],supplier:[string|null,string],quantity:number,unit:[string|null,string],extra:Partial<LinkedQuarryLoad>={}):LinkedQuarryLoad{
  sequence+=1;
  return {id:`q${sequence}`,purchaseNumber:`QP-${String(sequence).padStart(3,'0')}`,confirmedAt:`2026-08-20T${String(6+sequence).padStart(2,'0')}:00:00Z`,
    itemId:item[0],itemName:item[1],supplierId:supplier[0],supplierName:supplier[1],unitId:unit[0],unitSymbol:unit[1],quantity,
    deliveryMethod:'supplier',deliveryLabel:'Supplier Delivering',truckPlate:null,supplierTicketNumber:null,notes:null,...extra};
}
const ASPHALT:[string,string]=['item_asphalt','Asphalt'],READY:[string,string]=['item_ready','Ready Mix'];
const A:[string,string]=['sup_a','Alpha Asphalt'],B:[string,string]=['sup_b','Beta Quarry'],C:[string,string]=['sup_c','Cedar Concrete'];
const TON:[string,string]=['unit_ton','t'],M3:[string,string]=['unit_m3','m³'];

describe('groupSupplierLoads',()=>{
  const loads=[
    load(READY,C,8,M3),load(ASPHALT,B,20,TON),load(ASPHALT,A,12.5,TON),load(ASPHALT,A,10,TON),load(READY,A,6,M3),load(ASPHALT,B,4,M3),
  ];
  const groups=groupSupplierLoads(loads);
  it('orders items by name, suppliers by name, and loads by delivery time',()=>{
    expect(groups.map(item=>item.itemName)).toEqual(['Asphalt','Ready Mix']);
    expect(groups[0]!.suppliers.map(supplier=>supplier.supplierName)).toEqual(['Alpha Asphalt','Beta Quarry']);
    expect(groups[0]!.suppliers[0]!.loads.map(value=>value.purchaseNumber)).toEqual(['QP-003','QP-004']);
  });
  it('keeps the same supplier separate under each item',()=>{
    expect(groups[1]!.suppliers.map(supplier=>supplier.supplierName)).toEqual(['Alpha Asphalt','Cedar Concrete']);
  });
  it('subtotals each supplier per unit and totals each item per unit, never across units',()=>{
    expect(groups[0]!.suppliers[0]!.subtotals).toEqual([{unitKey:'unit_ton',unitSymbol:'t',quantity:22.5,loadCount:2}]);
    expect(groups[0]!.suppliers[1]!.subtotals).toEqual([{unitKey:'unit_m3',unitSymbol:'m³',quantity:4,loadCount:1},{unitKey:'unit_ton',unitSymbol:'t',quantity:20,loadCount:1}]);
    expect(groups[0]!.totals).toEqual([{unitKey:'unit_m3',unitSymbol:'m³',quantity:4,loadCount:1},{unitKey:'unit_ton',unitSymbol:'t',quantity:42.5,loadCount:3}]);
    expect(groups[1]!.totals).toEqual([{unitKey:'unit_m3',unitSymbol:'m³',quantity:14,loadCount:2}]);
  });
  it('neither loses nor duplicates a load',()=>{
    const ids=groups.flatMap(item=>item.suppliers.flatMap(supplier=>supplier.loads.map(value=>value.id)));
    expect(ids.sort()).toEqual(loads.map(value=>value.id).sort());
  });
  it('groups by stable id, so a renamed item still groups with its earlier loads under the recorded label of the first',()=>{
    const renamed=groupSupplierLoads([load(['item_x','Base Course'],A,5,TON),load(['item_x','Base course (0/40)'],A,5,TON)]);
    expect(renamed).toHaveLength(1);
    expect(renamed[0]!.totals[0]!.quantity).toBe(10);
  });
  it('falls back to a normalized name only when a legacy record has no stable id',()=>{
    const legacy=groupSupplierLoads([load([null,'  base   COURSE '],[null,'Old Quarry'],3,[null,'m³']),load([null,'Base course'],[null,'old quarry'],2,[null,'m³'])]);
    expect(legacy).toHaveLength(1);
    expect(legacy[0]!.suppliers).toHaveLength(1);
    expect(legacy[0]!.totals).toEqual([{unitKey:'symbol:m³',unitSymbol:'m³',quantity:5,loadCount:2}]);
  });
  it('adds quantities without floating-point noise',()=>{
    expect(groupSupplierLoads([load(ASPHALT,A,.1,TON),load(ASPHALT,A,.2,TON)])[0]!.totals[0]!.quantity).toBe(.3);
  });
  it('sums priced totals only, and counts unpriced loads instead of treating them as zero',()=>{
    const priced=groupSupplierLoads([load(ASPHALT,A,1,TON,{finalTotalUsd:100.1}),load(ASPHALT,A,1,TON,{finalTotalUsd:null}),load(ASPHALT,A,1,TON,{finalTotalUsd:.2})]);
    expect(priced[0]!.suppliers[0]!).toMatchObject({pricedTotalUsd:100.3,unpricedCount:1});
  });
  it('returns nothing for no loads',()=>{expect(groupSupplierLoads([])).toEqual([]);});
});

const base:DailyProjectReport={id:'r1',projectId:'p1',workDate:'2026-08-20',workDescription:'Paving',workers:[],drivers:[],operators:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',
  consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,createdAt:'2026-08-20T08:00:00Z',updatedAt:'2026-08-20T08:00:00Z'};
const project:ReportProject={id:'p1',name:'Mountain Road',customerName:'Road Co',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};
const LONG='Asphalt Concrete Wearing Course Type B with Polymer-Modified Binder and Recycled Aggregate';

describe('Daily Report PDF Supplier Loads',()=>{
  const loads=[load(['item_long',LONG],A,20,TON,{finalTotalUsd:500}),load(['item_long',LONG],['sup_ar','مقالع الجنوب <ش.م.ل>'],10,TON),load(READY,C,6,M3,{deliveryMethod:'company',deliveryLabel:'Omar Haddad',truckPlate:'B123',supplierTicketNumber:'T-9'})];
  const html=buildProjectReportHtmlWithWaste(base,project,[],loads,[],[],company,null,[]);
  const priced=buildProjectReportHtmlWithWaste(base,project,[],loads,[],[],company,null,[],true);
  it('puts each item heading inside the repeating table heading, so it follows the item across page breaks',()=>{
    expect(html).toMatch(new RegExp(`<thead><tr class="item-heading"><th colspan="\\d+" dir="auto">${LONG}</th></tr><tr><th>Reference</th>`));
    expect(html).toMatch(/<thead><tr class="item-heading"><th colspan="\d+" dir="auto">Ready Mix<\/th><\/tr>/);
  });
  it('labels supplier groups and subtotals in words, readable in grayscale',()=>{
    expect(html).toContain('<tr class="supplier-heading"><td colspan="5" dir="auto">Alpha Asphalt</td></tr>');
    expect(html).toContain('<tr class="subtotal-row"><td colspan="4" dir="auto">Supplier subtotal · Alpha Asphalt</td><td class="number">20 t</td></tr>');
    expect(html).toContain(`<tr class="item-total-row"><td colspan="4" dir="auto">Item total delivered · ${LONG}</td><td class="number">30 t</td></tr>`);
  });
  it('escapes supplier and item names and lets Arabic lay itself out',()=>{
    expect(html).toContain('<td colspan="5" dir="auto">مقالع الجنوب &lt;ش.م.ل&gt;</td>');
    expect(html).not.toContain('<ش.م.ل>');
  });
  it('keeps every existing load field: reference, quantity, delivery, truck and ticket, plus total with prices',()=>{
    // Quantity is the last data column so every subtotal and item total sits directly under it.
    expect(html).toContain('<th>Reference</th><th>Delivery</th><th>Truck</th><th>Ticket</th><th>Quantity</th>');
    expect(html).toMatch(/<td>QP-\d+<\/td><td dir="auto">Omar Haddad<\/td><td>B123<\/td><td>T-9<\/td><td class="number">6 m³<\/td>/);
    expect(priced).toMatch(/Supplier subtotal · Alpha Asphalt<\/td><td class="number">20 t<\/td><td class="number">\$500\.00<\/td>/);
    expect(priced).toContain('<td class="number">Unpriced</td>');
  });
  it('keeps supplier groups and subtotal lines together and never splits a subtotal from its value',()=>{
    expect(html).toMatch(/\.supplier-group\{[^}]*break-inside:avoid/);
    expect(html).toMatch(/\.subtotal-row,\.item-total-row\{[^}]*break-inside:avoid/);
    expect((html.match(/<tbody class="supplier-group">/g)??[]).length).toBe(3);
  });
  it('shows a clear empty state and never one grand total across units',()=>{
    expect(buildProjectReportHtmlWithWaste(base,project,[],[],[],[],company,null,[])).toContain('No project-linked supplier loads for this date');
    expect(html).not.toMatch(/36 t|36 m³|Grand total/);
  });
});

describe('Daily Report workbook Supplier Loads',()=>{
  const loads=[load(ASPHALT,A,20,TON),load(ASPHALT,B,4,M3),load(ASPHALT,B,6,M3)];
  const sheets=dailyReportWorkbookSheets(base,project,[],loads,[],[],company);
  it('keeps the flat, filterable row sheet and adds stable item, supplier and unit ids',()=>{
    expect(sheets.find(sheet=>sheet.name==='Supplier Loads')?.rows[0]).toMatchObject({'Item ID':'item_asphalt',Item:'Asphalt','Supplier ID':'sup_a',Supplier:'Alpha Asphalt','Unit ID':'unit_ton',Unit:'t',Quantity:20});
  });
  it('adds a subtotal sheet at supplier and item level, per unit',()=>{
    expect(sheets.find(sheet=>sheet.name==='Supplier Load Subtotals')?.rows).toEqual([
      {Level:'Supplier subtotal','Item ID':'item_asphalt',Item:'Asphalt','Supplier ID':'sup_a',Supplier:'Alpha Asphalt',Unit:'t','Total Quantity':20,Loads:1},
      {Level:'Supplier subtotal','Item ID':'item_asphalt',Item:'Asphalt','Supplier ID':'sup_b',Supplier:'Beta Quarry',Unit:'m³','Total Quantity':10,Loads:2},
      {Level:'Item total','Item ID':'item_asphalt',Item:'Asphalt','Supplier ID':null,Supplier:null,Unit:'m³','Total Quantity':10,Loads:2},
      {Level:'Item total','Item ID':'item_asphalt',Item:'Asphalt','Supplier ID':null,Supplier:null,Unit:'t','Total Quantity':20,Loads:1},
    ]);
  });
});

describe('Supplier Loads PDF physical-review regressions',()=>{
  it('prints decimal quantities in full: 22.4 t, never 22. t',()=>{
    const html=buildProjectReportHtmlWithWaste(base,project,[],[load(ASPHALT,A,22.4,TON),load(ASPHALT,A,21.9,TON)],[],[],company,null,[]);
    expect(html).toContain('<td class="number">22.4 t</td>');
    expect(html).toContain('<td class="number">44.3 t</td>');
    expect(html).not.toMatch(/\d\. t</);
  });
  it('gives every item table the same fixed columns so their quantities line up down the page',()=>{
    const html=buildProjectReportHtmlWithWaste(base,project,[],[load(ASPHALT,A,1,TON),load(READY,C,2,M3)],[],[],company,null,[]);
    expect((html.match(/<colgroup><col style="width:24%"><col style="width:30%"><col style="width:16%"><col style="width:14%"><col style="width:16%"><\/colgroup>/g)??[]).length).toBe(2);
    expect(html).toMatch(/\.supplier-table\{[^}]*table-layout:fixed/);
  });
  it('shows Unpriced, not a false $0.00, when a supplier or item has no priced load',()=>{
    const html=buildProjectReportHtmlWithWaste(base,project,[],[load(ASPHALT,A,5,TON,{finalTotalUsd:null})],[],[],company,null,[],true);
    const supplierSection=html.slice(html.indexOf('<h3>Supplier Loads</h3>'),html.indexOf('Fuel used that day'));
    expect(supplierSection).not.toContain('$0.00');
    expect(html).toContain('Supplier subtotal · Alpha Asphalt</td><td class="number">5 t</td><td class="number">Unpriced</td>');
  });
});
