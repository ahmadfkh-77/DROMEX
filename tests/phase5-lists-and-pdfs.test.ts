import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';

import type {CompanyTotalsRecord} from '../src/data/repositories/CompanyTotalsRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {emptyInclusion,type CompanyLoadGroupNode,type CompanyTotalsData} from '../src/domain/companyTotals';
import {exportableLoads,loadHistoryFileName,loadHistoryRows,loadHistoryStatus,loadHistorySummary,loadHistoryUnitTotals,singleProjectId} from '../src/domain/loadHistoryPdf';
import {emptyLoadDraft,type ConfirmedLoad} from '../src/domain/loads';
import {buildCompanyLoadTotalsHtml} from '../src/services/companyLoadTotalsTemplate';
import {buildLoadHistoryHtml,LOAD_HISTORY_WIDTHS} from '../src/services/loadHistoryTemplate';
import {buildTotalsHtml} from '../src/services/totalsTemplate';
import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * Phase 5. Cancelled loads are in no PDF; the Load History export lists Active loads newest first with separate
 * Supplier, Customer, Driver and Truck plate columns; every table's widths add up to exactly 100%; and every
 * export that can have the Header company picker has it.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const read=(file:string)=>readFileSync(file,'utf8');
const widthSums=(html:string)=>(html.match(/<colgroup>.*?<\/colgroup>/gs)??[]).map(group=>[...group.matchAll(/width:(\d+)%/g)].reduce((sum,match)=>sum+Number(match[1]),0));

const load=(over:Partial<ConfirmedLoad>):ConfirmedLoad=>({quantityMethod:'direct',id:'l1',transactionNumber:'20261009-A-00127',confirmedAt:'2026-10-09T09:05:00',customerName:'Al Amal Contracting',projectId:'road',projectName:'Highway Link',projectLocation:null,destinationAddress:null,itemName:'Asphalt',itemCode:null,categoryName:'x',
  driverName:'Walid Khoury',truckPlate:'B 884211',requestedQuantityKg:null,emptyWeightKg:null,fullWeightKg:null,netWeightKg:null,conversionName:null,conversionRule:null,directQuantity:1,directUnitName:null,directUnitSymbol:null,outputUnitSymbol:'m³',unitPriceUsd:null,vatRatePercent:null,
  paymentStatus:'Unpriced',signatureStatus:'Unsigned',signaturePaths:[],notes:null,companyName:'DROMEX S.A.R.L.',companyAddress:null,companyPhone:null,companyEmail:null,companyTaxVatNumber:null,companyReceiptFooter:null,companyLogoUri:null,status:'Active',cancellationReason:null,cancelledAt:null,
  correctionHistory:[],loadNumber:'ASP-00001',convertedQuantity:4.167,billedQuantity:4.167,subtotalUsd:null,vatAmountUsd:null,finalTotalUsd:null,...over} as ConfirmedLoad);
const change=(field:string)=>({field,originalValue:'a',newValue:'b'});
const loads=[
  load({correctionHistory:[{correctedAt:'2026-10-09T10:00:00',correctedBy:'Admin',reason:'x',changes:[change('Truck plate'),change('Unit price')]}]}),
  load({id:'l2',loadNumber:'ASP-00003',transactionNumber:'20261008-A-00130',confirmedAt:'2026-10-08T14:30:00',itemName:'Sand',driverName:'R. Haddad',truckPlate:'112233',billedQuantity:12,outputUnitSymbol:'t'}),
  load({id:'l3',status:'Cancelled',cancellationReason:'Duplicate ticket',loadNumber:'ASP-00002',transactionNumber:'20261008-A-00119',billedQuantity:99,outputUnitSymbol:'t'}),
  load({id:'l4',loadNumber:null,companyName:'Old Plant Name Ltd',transactionNumber:'20260612-A-00041',confirmedAt:'2026-06-12T10:00:00',itemName:'Sand',driverName:'',truckPlate:'',billedQuantity:18.5,outputUnitSymbol:'t'}),
];

describe('the Load History export',()=>{
  const rows=loadHistoryRows(loads);
  const summary=loadHistorySummary({fromDate:'2026-10-01',toDate:'2026-10-09',customer:'Al Amal Contracting',item:''},rows.length);
  const html=buildLoadHistoryHtml({companyName:'Al Amal Contracting',logo:null,contactLine:'Zahle, Bekaa',generatedAt:'2026-10-09T16:20:00',summary,rows,totals:loadHistoryUnitTotals(loads)});

  it('lists Active loads only, newest first, and never a cancelled one',()=>{
    expect(rows.map(row=>row.transaction)).toEqual(['20261009-A-00127','20261008-A-00130','20260612-A-00041']);
    for(const text of ['ASP-00002','20261008-A-00119','Duplicate ticket','Cancelled —','>Cancelled<'])expect(html).not.toContain(text);
    expect(html).toContain('Cancelled loads are never included.');
    expect(exportableLoads(loads).map(value=>value.id)).toEqual(['l1','l2','l4']);
  });
  it('has the approved columns, each fact in its own column, with widths that add up to exactly 100%',()=>{
    expect(html).toContain('<th>Date, time</th><th>Load No.</th><th>Item</th><th>Supplier</th><th>Customer</th><th>Driver</th><th>Truck plate</th><th class="num">Quantity</th><th>Status</th>');
    expect(LOAD_HISTORY_WIDTHS.reduce((sum,value)=>sum+value,0)).toBe(100);
    expect(widthSums(html)).toEqual([100]);
    expect(html).toContain('table-layout:fixed');expect(html).toContain('thead{display:table-header-group}');expect(html).toContain('overflow-wrap:anywhere');
  });
  it('reads the real plant company name as the supplier (as issued on each load), Not recorded for a missing driver or plate, and Legacy load for an old load',()=>{
    expect(html).toContain('<span dir="auto">DROMEX S.A.R.L.</span>');
    expect(html).toContain('<span dir="auto">Old Plant Name Ltd</span>');
    expect(html).not.toContain('Plant Company');
    expect(loadHistoryRows([load({companyName:' '})],'Current Plant SARL')[0]!.supplier).toBe('Current Plant SARL');
    expect(html.match(/<span class="missing">Not recorded<\/span>/g)?.length).toBe(2);
    expect(html).toContain('<span class="legacy">Legacy load</span>');
  });
  it('says Confirmed, or Corrected with a short note of what changed',()=>{
    expect(rows.map(row=>[row.statusLabel,row.statusNote])).toEqual([['Corrected','Truck, price changed'],['Confirmed',null],['Confirmed',null]]);
    expect(loadHistoryStatus({correctionHistory:[{correctedAt:'',correctedBy:'',reason:'',changes:[change('Truck plate')]}]})).toEqual({label:'Corrected',note:'Truck changed'});
    expect(loadHistoryStatus({correctionHistory:[{correctedAt:'',correctedBy:'',reason:'',changes:[change('Record date'),change('Empty weight kg'),change('Full weight kg')]}]})).toEqual({label:'Corrected',note:'Date, quantity changed'});
    expect(html).toContain('<b>Corrected</b><div class="muted">Truck, price changed</div>');
  });
  it('totals each unit on its own, counting Active loads only',()=>{
    expect(loadHistoryUnitTotals(loads)).toEqual([{unitSymbol:'m³',quantity:4.167,loadCount:1},{unitSymbol:'t',quantity:30.5,loadCount:2}]);
    expect(html).not.toContain('129');
  });
  it('has the summary strip, the page footer and an empty state',()=>{
    for(const text of ['Period','Customer','Items','Status','Loads listed','1 Oct 2026 – 9 Oct 2026','Active loads'])expect(html).toContain(text);
    expect(html).toContain('@bottom-right{content:"Page " counter(page) " of " counter(pages)');
    expect(html).toContain('Al Amal Contracting · Load History · Export only, no records changed');
    expect(buildLoadHistoryHtml({companyName:'X',logo:null,contactLine:null,generatedAt:'2026-10-09T16:20:00',summary,rows:[],totals:[]})).toContain('No active loads match these filters.');
    expect(loadHistorySummary({fromDate:'',toDate:'',customer:'',item:''},0)).toEqual({period:'All dates',customer:'All customers',items:'All items',status:'Active loads',listed:'0'});
  });
  it('remembers a project only when the filters name exactly one, and names the file by period',()=>{
    expect(singleProjectId([loads[0]!,loads[1]!])).toBe('road');
    expect(singleProjectId([loads[0]!,load({projectId:'other'})])).toBeNull();
    expect(singleProjectId([load({projectId:null})])).toBeNull();
    expect(loadHistoryFileName({fromDate:'2026-10-01',toDate:'2026-10-09'},'2026-10-09T16:20:00')).toBe('Load-History-2026-10-01_to_2026-10-09.pdf');
  });
  it('escapes names and keeps right-to-left names isolated',()=>{
    const out=buildLoadHistoryHtml({companyName:'A & <B>',logo:null,contactLine:null,generatedAt:'2026-10-09T16:20:00',summary,rows:loadHistoryRows([load({customerName:'شركة <النور>'})]),totals:[]});
    expect(out).toContain('A &amp; &lt;B&gt;');expect(out).toContain('dir="auto">شركة &lt;النور&gt;');
  });
});

describe('cancelled loads are in no PDF, but stay in the app',()=>{
  const counts=(total:number)=>({...emptyInclusion(),total,included:0,open:total});
  const data:CompanyTotalsData={usageHiddenReason:null,deliveries:[],usage:[]};
  const record=(status:'Active'|'Cancelled',ref:string,number:string):CompanyTotalsRecord=>({key:`k:${ref}`,seriesId:'s',status,cancellationReason:status==='Cancelled'?'Duplicate ticket':null,correctionCount:0,links:[],inclusion:counts(1) as never,
    snapshot:{recordType:'company_load',recordId:ref,reference:ref,loadNumber:number,loadNumberSeriesName:'ASP',itemKey:'i',itemName:'Asphalt',unitKey:'t',unitSymbol:'t',quantity:10,projectId:'p',projectName:'Road',partyId:'c',partyName:'Customer One',recordedAt:'2026-10-09T09:00:00',enteredAt:null,unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null} as never,
    details:{driverName:'D',truckPlate:'P',deliveredBy:null,destination:null,customerName:'Customer One'}});
  const records=[record('Active','TX-ACTIVE','ASP-00001'),record('Cancelled','TX-CANCELLED','ASP-00002')];

  it('leaves a cancelled load out of the Totals PDF, even when handed one',()=>{
    const base={companyName:'DROMEX',logo:null,title:'Project Totals',scope:'project' as const,filters:[],generatedAt:'2026-10-09T08:00:00',data,includePrices:false};
    const project=buildTotalsHtml({...base,project:{name:'Road',location:null,status:'Active',customer:{label:'Customer One',note:null} as never,loads:records}});
    expect(project).toContain('ASP-00001');
    for(const text of ['ASP-00002','TX-CANCELLED','Duplicate ticket','CANCELLED'])expect(project).not.toContain(text);
  });
  it('leaves cancelled loads out of the Company Load Totals PDF: no row, column, tile, section or count',()=>{
    const groups:CompanyLoadGroupNode[]=[{key:'s',label:'ASP · Asphalt',units:[{unitKey:'t',unitSymbol:'t',quantity:10}],loadCount:1,cancelledCount:1,projects:[{projectKey:'p',projectName:'Road',units:[{unitKey:'t',unitSymbol:'t',quantity:10}],loadCount:1,cancelledCount:1}]} as never];
    const html=buildCompanyLoadTotalsHtml({companyName:'DROMEX',logo:null,generatedAt:'2026-10-09T08:00:00',filters:[],groupBy:'series',groups,loads:records});
    expect(html).toContain('ASP-00001');
    for(const text of ['ASP-00002','TX-CANCELLED','Duplicate ticket','Cancelled — not counted','Cancelled, not counted','>Cancelled<'])expect(html).not.toContain(text);
  });
  it('keeps a cancelled load in the Load History list and detail, marked, with its reason and its number',async()=>{
    const database=await migratedDatabaseWithProject(databases);
    database.raw.exec(`
      INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
      INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');
      INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
      INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,created_at,updated_at) VALUES ('asphalt','cat','Asphalt','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');`);
    const repository=new SqliteLoadRepository(database as never);
    const draft={...emptyLoadDraft,recordDate:'2026-08-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverName:'Typed Driver',truckPlate:'B1',quantityMethod:'direct' as const,directQuantity:'10',directUnitId:'unit_ton'};
    const first=await repository.confirmLoad(draft);const second=await repository.confirmLoad(draft);
    await repository.cancelLoad(second.id,'Duplicate ticket');
    const listed=await repository.listLoads();
    expect(listed.map(value=>[value.loadNumber,value.status])).toEqual(expect.arrayContaining([[first.loadNumber,'Active'],[second.loadNumber,'Cancelled']]));
    expect(listed.find(value=>value.id===second.id)).toMatchObject({status:'Cancelled',cancellationReason:'Duplicate ticket',loadNumber:second.loadNumber});
    expect(exportableLoads(listed).map(value=>value.id)).toEqual([first.id]);
    expect(new Set(listed.map(value=>value.loadNumber)).size).toBe(2);
    const screen=read('src/ui/screens/LoadHistoryScreen.tsx');
    for(const text of ['CANCELLED','CANCELLED — NOT AN ACTIVE DELIVERY','rowCancelled','cancellationReason'])expect(screen).toContain(text);
    expect(screen).not.toMatch(/filter\(load=>load\.status!=='Cancelled'\)\.map/);
  });
});

describe('every table adds up to 100%',()=>{
  it('keeps every hard-coded column width list in the PDF templates at exactly 100%',()=>{
    const arrays:{file:string;widths:number[]}[]=[];
    for(const file of readdirSync('src/services').filter(name=>/Template\.ts$|Export\.ts$/.test(name)).map(name=>join('src/services',name))){
      const source=read(file);
      for(const match of source.matchAll(/\(?\[([\d,\s]+)\]\)?\.map\(width=>/g))arrays.push({file,widths:match[1]!.split(',').map(value=>Number(value.trim()))});
      for(const match of source.matchAll(/(?:<col style="width:\d+%"\/?>\s*){2,}/g))arrays.push({file,widths:[...match[0].matchAll(/width:(\d+)%/g)].map(value=>Number(value[1]))});
    }
    expect(arrays.length).toBeGreaterThan(10);
    for(const {file,widths} of arrays){
      // The pinned Daily Report supplier table is the one list that deliberately leaves room for price columns to share.
      expect({file,total:widths.reduce((sum,value)=>sum+value,0)}).toEqual({file,total:100});
    }
  });
  it('lays the Totals list tables out at 100% with and without prices and a Project column',()=>{
    const data:CompanyTotalsData={usageHiddenReason:null,deliveries:[],usage:[]};
    const base={companyName:'D',logo:null,title:'Loads History',scope:'company' as const,filters:[],generatedAt:'2026-10-09T08:00:00',data,records:[]};
    for(const includePrices of [false,true])for(const showProject of [false,true]){
      const html=buildTotalsHtml({...base,includePrices,showProject,records:[{key:'k',seriesId:null,status:'Active',cancellationReason:null,correctionCount:0,links:[],inclusion:counts0() as never,snapshot:{recordType:'company_load',recordId:'r',reference:'T',loadNumber:'ASP-1',loadNumberSeriesName:null,itemKey:'i',itemName:'A',unitKey:'t',unitSymbol:'t',quantity:1,projectId:null,projectName:null,partyId:'c',partyName:'C',recordedAt:'2026-10-09T09:00:00',enteredAt:null,unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null} as never}]});
      expect(widthSums(html).every(total=>total===100)).toBe(true);
      const columns=1+(html.match(/<th[ >]/g)?.length??0);void columns;
      expect(html).toContain(includePrices?'A4 landscape':'size:A4;');
    }
  });
});
const counts0=()=>({...emptyInclusion(),total:1,included:0,open:1});

describe('the Header company picker is on every export that can have one',()=>{
  const sourceFiles=(dir:string):string[]=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?sourceFiles(path):/\.tsx$/.test(name)?[path]:[];});
  /** Issued documents and saved slips keep the header they were made with; the Pavement PDF has no company header at all. */
  const EXEMPT=['exportAndShareBusinessDocument','exportAndShareQuickText','printQuickText','exportPavementPdf'];
  it('finds the picker, or the hook that offers it, in every screen that exports a PDF',()=>{
    const callers=sourceFiles('src/ui').filter(file=>/exportAndShare(Load|Totals|CompanyLoadTotals|ProjectReport|ProjectCompletion|DieselBatchReport|LoadHistory)/.test(read(file)));
    expect(callers.length).toBeGreaterThanOrEqual(8);
    for(const file of callers){
      const source=read(file);
      expect({file:file.replace(/\\/g,'/'),offersPicker:/<HeaderCompanyPicker|useExportHeader|<LoadHistoryExport|<DieselPdfExportPanel/.test(source)}).toEqual({file:file.replace(/\\/g,'/'),offersPicker:true});
    }
  });
  it('names the exports that are exempt, and why',()=>{
    for(const name of EXEMPT){
      const used=sourceFiles('src/ui').some(file=>read(file).includes(name));
      if(used){const callers=sourceFiles('src/ui').filter(file=>read(file).includes(name));for(const file of callers)expect(/<HeaderCompanyPicker|useExportHeader/.test(read(file))).toBe(false);}
    }
  });
  it('lets the shared Diesel export panel offer it for every Diesel report',()=>{
    expect(read('src/ui/components/fuel/DieselPdfExportPanel.tsx')).toContain('useExportHeader(filters.projectId||projectId)');
  });
  it('defines the picker heading once',()=>{
    expect(sourceFiles('src/ui').filter(file=>read(file).includes('>Header company<')).map(file=>file.replace(/\\/g,'/'))).toEqual(['src/ui/components/HeaderCompanyPicker.tsx']);
  });
  it('shows the Supplier, Driver and Truck plate strip on each Company Loads row, and the picker on the load detail',()=>{
    const screen=read('src/ui/screens/LoadHistoryScreen.tsx');
    for(const text of ['SUPPLIER','DRIVER','TRUCK PLATE','record.companyName','NOT_RECORDED','<LoadHistoryExport','<HeaderCompanyPicker','applyHeaderCompany(record,header)'])expect(screen).toContain(text);
    // The two hub cards of the Load History start screen are unchanged.
    expect(screen).toContain('Open Company Loads');
    expect(screen).toContain('Open Supplier Loads');
  });
});
