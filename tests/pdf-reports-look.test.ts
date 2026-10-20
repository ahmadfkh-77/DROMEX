import {describe,expect,it} from 'vitest';

import {loadHistoryRows,loadHistorySummary,loadHistoryUnitTotals} from '../src/domain/loadHistoryPdf';
import type {ConfirmedLoad} from '../src/domain/loads';
import type {SupplierDeliveriesPdf} from '../src/domain/supplierDeliveriesPdf';
import {buildWasteHistory,wasteRangeLabel,type WasteHistoryRow} from '../src/domain/wasteHistory';
import {buildLoadHistoryHtml} from '../src/services/loadHistoryTemplate';
import {buildSupplierDeliveriesHtml} from '../src/services/supplierDeliveriesTemplate';
import {buildWasteHistoryHtml} from '../src/services/wasteHistoryTemplate';

/**
 * DEC-520, Phase 2. The supplier Totals, Load History and Waste Dump History PDFs share the Totals look: square boxes, navy bars with the orange rule,
 * Total rows, numbered Notes, the section bar repeated in the table header, and no rounded cards, badges or pills.
 */
const noWbr=(html:string)=>html.replace(/<wbr>/g,'');
const load=(reference:string,item:string,quantityText:string)=>({id:reference,reference,recordedAt:'2026-09-03T09:10:00',item,quantityText,driver:'Supplier delivering',ticket:'4471',pieces:null,length:null,meters:null,weightNote:null,status:'Active',statusNote:null,unitPrice:undefined,total:undefined});
const total=(item:string,categoryName:string,unitSymbol:string,quantity:number,count:number)=>({item,categoryName,unitSymbol,quantity,quantityText:`${quantity} ${unitSymbol}`,count,pieces:0,piecesText:''});
const report={
  supplierName:'Al-Nour Quarry',generatedAt:'2026-10-19T10:30:00',meta:[{label:'Period',value:'3 Sep 2026 – 29 Sep 2026'},{label:'Prices',value:'Not shown'}],
  destinations:[
    {key:'p',type:'project',name:'Ain Qana - Jbaa',label:'Ain Qana - Jbaa',loads:[load('SUP-00021','Base course','20 t'),load('SUP-00022','Sand','12 m³'),load('SUP-00027','Base course','21 t')],totals:[total('Base course','Aggregates','t',41,2),total('Sand','Aggregates','m³',12,1)],unpricedCount:0},
    {key:'s',type:'company_site',name:'Yard B',label:'Yard B (Company site)',loads:[load('SUP-00031','Rebar 12 mm','800 kg')],totals:[total('Rebar 12 mm','Steel','kg',800,1)],unpricedCount:0},
  ],
  totals:[total('Rebar 12 mm','Steel','kg',800,1),total('Sand','Aggregates','m³',12,1),total('Base course','Aggregates','t',41,2)],
  loadCount:4,hasPieces:false,hasLength:false,categories:[],diesel:null,includePrices:false,empty:false,fileName:'Totals-Al-Nour.pdf',
} as unknown as SupplierDeliveriesPdf;

describe('the supplier Totals PDF',()=>{
  const html=noWbr(buildSupplierDeliveriesHtml({companyName:'DROMEX S.A.R.L',logo:null,contactLine:'Kfour-Nabatieh',report}));
  it('is square boxes with no rounded corners, clipped boxes or pills',()=>{
    expect(html).not.toContain('border-radius');expect(html).not.toContain('overflow:hidden');expect(html).not.toContain('class="pill');
  });
  it('lists each material once in "Received from this supplier", grouped by category, each unit on its own',()=>{
    expect(html).toContain('Received from this supplier <span>4 loads · 3 materials</span>');
    expect(html.indexOf('>Aggregates<')).toBeLessThan(html.indexOf('>Steel<'));
    expect(html).toContain('<td class="indent"><bdi dir="auto">Base course</bdi></td><td>t</td><td class="num">2</td><td class="num">41 t</td>');
    expect(html).toContain('<td class="indent"><bdi dir="auto">Sand</bdi></td><td>m³</td><td class="num">1</td><td class="num">12 m³</td>');
    expect(html).toContain('<tr class="total-row"><td colspan="2">Total loads</td><td class="num">4</td><td class="num muted">each unit on its own</td></tr>');
  });
  it('gives each destination its own box whose navy bar repeats in the table header, with Totals by material under the loads',()=>{
    expect(html).toContain('<tr class="bar-row"><th colspan="7"><div class="block-bar"><span class="block-index">1</span><span class="block-name"><bdi dir="auto">Ain Qana - Jbaa</bdi></span><span class="block-figures">3 loads · 2 materials</span></div></th></tr>');
    expect(html).toContain('<tr class="bar-row"><th colspan="7"><div class="block-bar"><span class="block-index">2</span>');
    expect(html).toContain('<tr class="sub-row"><td colspan="4">Totals by material</td><td class="num">Loads</td><td class="num">Quantity</td><td colspan="1"></td></tr>');
    expect(html).toContain('<tr class="total-row"><td colspan="4"><bdi dir="auto">Base course</bdi></td><td class="num">2</td><td class="num">41 t</td><td colspan="1"></td></tr>');
  });
  it('has the key cells, the orange rule, numbered Notes and Page x of y',()=>{
    expect(html).toContain('<div class="panel keys"><div><span class="figure-label">Period</span><b><bdi dir="auto">3 Sep 2026 – 29 Sep 2026</bdi></b></div>');
    expect(html).toContain('border-bottom:.8mm solid #C84B31');
    expect(html).toContain('<div class="notes"><h4>Notes</h4><ol><li>Quantities are added only to the same unit');
    expect(html).toContain('@bottom-right{content:"Page " counter(page) " of " counter(pages)');
  });
});

const change=(field:string)=>({field,originalValue:'a',newValue:'b'});
const confirmed=(over:Partial<ConfirmedLoad>):ConfirmedLoad=>({quantityMethod:'direct',id:'l1',transactionNumber:'20261009-A-00127',confirmedAt:'2026-10-09T09:05:00',customerName:'Al Amal Contracting',projectId:'road',projectName:'Highway Link',projectLocation:null,destinationAddress:null,itemName:'Asphalt',itemCode:null,categoryName:'x',
  driverName:'Walid Khoury',truckPlate:'B 884211',requestedQuantityKg:null,emptyWeightKg:null,fullWeightKg:null,netWeightKg:null,conversionName:null,conversionRule:null,directQuantity:1,directUnitName:null,directUnitSymbol:null,outputUnitSymbol:'m³',unitPriceUsd:null,vatRatePercent:null,
  paymentStatus:'Unpriced',signatureStatus:'Unsigned',signaturePaths:[],notes:null,companyName:'DROMEX S.A.R.L.',companyAddress:null,companyPhone:null,companyEmail:null,companyTaxVatNumber:null,companyReceiptFooter:null,companyLogoUri:null,status:'Active',cancellationReason:null,cancelledAt:null,
  correctionHistory:[],loadNumber:'ASP-00001',convertedQuantity:4.167,billedQuantity:4.167,subtotalUsd:null,vatAmountUsd:null,finalTotalUsd:null,...over} as ConfirmedLoad);

describe('the Load History PDF',()=>{
  const loads=[confirmed({correctionHistory:[{correctedAt:'2026-10-09T10:00:00',correctedBy:'Admin',reason:'x',changes:[change('Truck plate')]}]}),confirmed({id:'l2',loadNumber:'ASP-00003',transactionNumber:'20261008-A-00130',confirmedAt:'2026-10-08T14:30:00',itemName:'Sand',billedQuantity:12,outputUnitSymbol:'t'})];
  const rows=loadHistoryRows(loads);
  const summary=loadHistorySummary({fromDate:'2026-10-01',toDate:'2026-10-09',customer:'Al Amal Contracting',item:''},rows.length);
  const html=noWbr(buildLoadHistoryHtml({companyName:'DROMEX S.A.R.L',logo:null,contactLine:null,generatedAt:'2026-10-19T10:30:00',summary,rows,totals:loadHistoryUnitTotals(loads)}));
  it('is square boxes with the key cells in one bordered row, and no rounded corners, clipped boxes or pills',()=>{
    expect(html).not.toContain('border-radius');expect(html).not.toContain('overflow:hidden');expect(html).not.toContain('class="pill');
    expect(html).toContain('<div class="tiles"><div class="tile"><span class="figure-label">Period</span>');
  });
  it('repeats the section bar in the table header and ends the list with a Total row for each unit',()=>{
    expect(html).toContain('<tr class="bar-row"><th colspan="9"><div class="block-bar"><span class="block-index">1</span><span class="block-name">All loads, newest first</span></div></th></tr>');
    expect(html).toMatch(/<tr class="total-row"><td colspan="7">Total · 1 load<\/td><td class="num">4\.167 m³<\/td><td><\/td><\/tr>/);
    expect(html).toMatch(/<tr class="total-row"><td colspan="7">Total · 1 load<\/td><td class="num">12 t<\/td><td><\/td><\/tr>/);
  });
  it('keeps the notes as a numbered list, and the page number and running title',()=>{
    expect(html).toContain('<div class="notes"><h4>Notes</h4><ol><li>Each unit is totalled on its own');
    expect(html).toContain('@bottom-right{content:"Page " counter(page) " of " counter(pages)');
    expect(html).toContain('DROMEX S.A.R.L · Load History · Export only, no records changed');
  });
});

describe('the Waste Dump History PDF',()=>{
  let n=0;
  const row=(day:string,projectId:string,projectName:string,driver:string):WasteHistoryRow=>({id:`d${++n}`,projectId,projectName,projectLocation:null,workDate:day,dumpedAt:`${day}T09:00:00.000Z`,materialType:null,dumpLocation:null,truckProfileId:null,truckPlate:null,driverProfileId:`drv_${driver}`,driverName:driver,notes:null,status:'Active',cancellationReason:null,cancelledAt:null,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'} as unknown as WasteHistoryRow);
  const history=buildWasteHistory([row('2026-10-12','z','Zebdine','Ali kazem'),row('2026-10-12','z','Zebdine','Ali kazem'),row('2026-10-10','a','Ain Qana','Mahmoud')],{fromDate:'2026-10-01',toDate:'2026-10-31'});
  const html=noWbr(buildWasteHistoryHtml({companyName:'DROMEX S.A.R.L',logo:null,contactLine:null,generatedAt:'2026-10-19T10:30:00.000Z',projectLabel:'All locations',periodLabel:wasteRangeLabel(history.range),history,includeAllProjectsDriverTotals:true}));
  it('is square boxes with the key cells in one bordered row, and the project name still in the project colour',()=>{
    expect(html).not.toContain('border-radius');expect(html).not.toContain('overflow:hidden');
    expect(html).toContain('<div class="tiles"><div class="tile"><span class="figure-label">Period</span>');
    expect(html).toContain('.pname{font-size:10.5pt;font-weight:700;color:#C84B31');
  });
  it('keeps each day as its own box with a navy bar and the orange rule, total rows under the drivers, and numbered Notes',()=>{
    expect(html).toContain('.block-bar{display:flex;align-items:baseline;gap:3mm;background:#173F67;color:#FFFFFF;padding:2.7mm 3.5mm;border-bottom:.8mm solid #C84B31');
    expect(html).toContain('<tr class="tot"><td>Project total</td><td class="num">2</td></tr>');
    expect(html).toContain('<div class="notes"><h4>Notes</h4><ol><li>Every number is a count of dumps');
    expect(html).toContain('@bottom-right{content:"Page " counter(page) " of " counter(pages)');
  });
});
