import {afterEach,describe,expect,it} from 'vitest';

import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import type {CompanyTotalsRecord} from '../src/data/repositories/CompanyTotalsRepository';
import type {RecordSnapshot} from '../src/domain/businessDocuments';
import {buildMaterialTree,emptyCompanyTotalsFilters,treeTotals,type CompanyTotalsData} from '../src/domain/companyTotals';
import {customerBox} from '../src/domain/projectTotalsPdf';
import {driverChoices,driverKeyOf,driverNamesLabel,groupRecordsByDriver,recordsOfDrivers} from '../src/domain/totalsDrivers';
import {buildTotalsHtml} from '../src/services/totalsTemplate';
import {recordsDatabase} from './support/recordFixtures';
import type {SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * Totals PDF with a driver filter (Owner-approved mockup, 2026-10-22): tick drivers, one Total, then a Drivers table with a
 * subtotal per driver, in the structure of the Project Totals PDF, with no Notes and no change to any record.
 */
const noWbr=(html:string)=>html.replace(/<wbr>/g,'');
let counter=0;
const load=(driver:string|null,plate:string,day:string,over:Partial<RecordSnapshot>={},status:'Active'|'Cancelled'='Active',type:'company_load'|'supplier_load'='company_load'):CompanyTotalsRecord=>{
  counter+=1;
  const snapshot:RecordSnapshot={recordType:type,recordId:`r${counter}`,reference:`TX-${counter}`,loadNumber:type==='company_load'?`ASP-${String(counter).padStart(5,'0')}`:null,loadNumberSeriesName:null,itemKey:'id:asphalt',itemName:'Asphalt',unitKey:'t',unitSymbol:'t',quantity:25,
    projectId:'p1',projectName:'Zebdine - Choukine Road',partyId:'c1',partyName:'Internal project',recordedAt:`2026-10-${day}T08:10:00`,enteredAt:null,unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null,...over};
  return {key:`k${counter}`,snapshot,seriesId:null,status,cancellationReason:null,correctionCount:0,links:[],inclusion:'not_included',
    details:{destination:null,driverName:driver,truckPlate:plate,deliveredBy:null,supplierName:'Fakih Brothers'}} as unknown as CompanyTotalsRecord;
};
const walid=[load('Walid Khoury','B 884211','02'),load('walid khoury ','B 884211','04'),load('Walid Khoury','B 884211','09'),load('Walid Khoury','B 884211','15')];
const ali=[load('Ali Kazem','B 551200','02'),load('Ali Kazem','B 551200','09'),load('Ali Kazem','B 551200','16')];
const rami=[load('Rami Saleh','T 221870','03'),load('Rami Saleh','T 221870','11'),load('Rami Saleh','T 221870','18')];
const outside=[...Array.from({length:6},()=>load('Hassan Trans','M 355965','05')),...Array.from({length:4},()=>load('Mahmoud D.',  '','06'))];
const supplier=load(null,'M 333299','07',{recordType:'supplier_load',itemName:'Gravel'},'Active','supplier_load');
const cancelled=load('Walid Khoury','B 884211','20',{},'Cancelled');
const every=[...walid,...ali,...rami,...outside,supplier,cancelled];

describe('the driver choices',()=>{
  it('lists each driver once, ignoring case and spaces, from the Active company loads only, most loads first',()=>{
    const choices=driverChoices(every);
    expect(choices.map(choice=>[choice.name,choice.loadCount])).toEqual([['Hassan Trans',6],['Mahmoud D.',4],['Walid Khoury',4],['Ali Kazem',3],['Rami Saleh',3]]);
    expect(choices.find(choice=>choice.key==='walid khoury')!.plates).toEqual(['B 884211']);
    expect(choices.map(choice=>choice.name)).not.toContain('');
  });
  it('never offers a Supplier Load, a cancelled load, or a load with no driver',()=>{
    expect(driverChoices([supplier,cancelled,load(null,'X','01'),load('  ','X','01')])).toEqual([]);
    expect(driverKeyOf('  Ali Kazem ')).toBe('ali kazem');
  });
  it('keeps every record when nothing is ticked, and only the ticked drivers\' company loads otherwise',()=>{
    expect(recordsOfDrivers(every,[])).toHaveLength(every.length);
    const picked=recordsOfDrivers(every,['walid khoury','ali kazem','rami saleh']);
    expect(picked).toHaveLength(4+1+3+3);
    expect(picked.some(record=>record.snapshot.recordType==='supplier_load')).toBe(false);
    expect(driverNamesLabel(driverChoices(every),['ali kazem','rami saleh','nobody'])).toBe('Ali Kazem, Rami Saleh');
  });
  it('groups the listed loads by driver in name order, oldest first inside each group',()=>{
    const groups=groupRecordsByDriver(recordsOfDrivers(every,['walid khoury','ali kazem','rami saleh']).filter(record=>record.status==='Active'));
    expect(groups.map(group=>group.name)).toEqual(['Ali Kazem','Rami Saleh','Walid Khoury']);
    expect(groups[2]!.records.map(record=>record.snapshot.recordedAt.slice(8,10))).toEqual(['02','04','09','15']);
    expect(groups[2]!.plates).toEqual(['B 884211']);
  });
});

describe('the driver filter in the totals query',()=>{
  const databases:SqliteTestDatabase[]=[];
  afterEach(()=>{for(const database of databases.splice(0))database.close();});
  it('narrows the company loads to the ticked drivers, drops supplier loads, hides use, and changes nothing',async()=>{
    const fixture=await recordsDatabase(databases);
    const a=fixture.companyLoad('asphalt',{project:'road',quantity:25,unit:'t'}),b=fixture.companyLoad('asphalt',{project:'road',quantity:25,unit:'t'}),c=fixture.companyLoad('asphalt',{project:'road',quantity:50,unit:'t'});
    fixture.supplierLoad('asphalt',{supplier:'sup_a',project:'road',quantity:8,unit:'t'});
    fixture.db.raw.prepare("UPDATE loads SET driver_name = 'Ali Kazem' WHERE id = ?").run(a);
    fixture.db.raw.prepare("UPDATE loads SET driver_name = ' ali kazem' WHERE id = ?").run(b);
    fixture.db.raw.prepare("UPDATE loads SET driver_name = 'Hassan Trans' WHERE id = ?").run(c);
    const before=fixture.db.raw.prepare('SELECT COUNT(*) n FROM loads').get() as {n:number};
    const repository=new SqliteCompanyTotalsRepository(fixture.db as never);
    const whole=await repository.getCompanyTotals({...emptyCompanyTotalsFilters(),projectKey:'road'});
    const picked=await repository.getCompanyTotals({...emptyCompanyTotalsFilters(),projectKey:'road',driverKeys:['ali kazem']});
    const tonnes=(data:CompanyTotalsData)=>buildMaterialTree(data).flatMap(material=>material.units).filter(unit=>unit.unitSymbol==='t').reduce((sum,unit)=>sum+(unit.delivered?.quantity??0),0);
    expect(tonnes(whole)).toBe(108);
    expect(tonnes(picked)).toBe(50);
    expect(treeTotals(buildMaterialTree(picked)).inclusion.total).toBe(2);
    expect(picked.deliveries.every(row=>row.source==='company_delivery')).toBe(true);
    expect(picked.usageHiddenReason).toContain('per driver');
    const records=await repository.listRecords({...emptyCompanyTotalsFilters(),projectKey:'road',driverKeys:['ali kazem']});
    expect(records.map(record=>record.snapshot.recordType)).toEqual(['company_load','company_load']);
    expect((fixture.db.raw.prepare('SELECT COUNT(*) n FROM loads').get() as {n:number}).n).toBe(before.n);
  });
});

describe('the Totals PDF with drivers',()=>{
  const data:CompanyTotalsData={usageHiddenReason:null,usage:[],deliveries:[{source:'company_delivery',itemKey:'id:asphalt',itemName:'Asphalt',projectKey:'p1',projectName:'Zebdine - Choukine Road',supplierKey:'company',supplierName:'Company loads — own deliveries',unitKey:'t',unitSymbol:'t',quantity:500,recordCount:20,valueCents:null,pricedCount:0,inclusion:{total:20,included:0,inDraft:0,open:20,includedIn:[]}}]};
  const base={companyName:'Fakih Brothers Construction S.A.R.L',logo:null,title:'Project Totals',scope:'project' as const,filters:['All recorded dates'],generatedAt:'2026-10-22T10:30:00',data,includePrices:false,contactLine:null};
  const project={name:'Zebdine - Choukine Road',location:'Zebdine nabatieh',status:'Active',customer:customerBox({name:'Fakih Brothers',isOwnCompany:true}),loads:every};
  const drivers={keys:['walid khoury','ali kazem','rami saleh'],names:'Walid Khoury, Ali Kazem, Rami Saleh'};
  const html=noWbr(buildTotalsHtml({...base,project,drivers}));
  const plain=noWbr(buildTotalsHtml({...base,project}));

  it('swaps the Supplier box for a Drivers listed box naming the ticked drivers',()=>{
    expect(html).toContain('<span class="box-label">Drivers listed</span><b><span dir="auto">Walid Khoury, Ali Kazem, Rami Saleh</span></b><div class="muted">3 selected</div>');
    expect(html).not.toContain('<span class="box-label">Supplier</span>');
  });
  it('lists only the ticked drivers\' company loads, grouped by driver with a subtotal each and one total, and no supplier loads',()=>{
    expect(html).toContain('Company loads delivered · selected drivers');
    expect(html).not.toContain('Supplier loads delivered');
    for(const name of ['Ali Kazem','Rami Saleh','Walid Khoury'])expect(html).toContain(`<tr class="group-row"><td colspan="7"><span dir="auto">${name} · `);
    expect(html).toContain('<tr class="sub-row"><td colspan="6"><span dir="auto">Walid Khoury</span> · 4 loads</td><td class="num">100 t</td></tr>');
    expect(html).toContain('<tr class="sub-row"><td colspan="6"><span dir="auto">Ali Kazem</span> · 3 loads</td><td class="num">75 t</td></tr>');
    expect(html).toContain('<tr class="total-row"><td colspan="6">Total · 10 loads</td><td class="num">250 t</td></tr>');
    expect(html).not.toContain('Hassan Trans');expect(html).not.toContain('Mahmoud D.');
  });
  it('leaves out the Supplier column in the driver table, and the cancelled load',()=>{
    const table=html.split('data-kind="project-company-loads"')[1]!;
    expect(table).not.toContain('<th>Supplier</th>');
    expect(table).toContain('<th>Truck plate</th>');
    expect(table).not.toContain('TX-'+String(counter));
  });
  it('removes the Notes at the bottom of a driver PDF only',()=>{
    expect(html).not.toContain('<h4>Notes</h4>');
    expect(plain).toContain('<h4>Notes</h4>');
  });
  it('prints the Total from the data it is given: the whole amount, or only the drivers\' amount',()=>{
    expect(html).toContain('Delivered 500 t');
    const selected=noWbr(buildTotalsHtml({...base,project,drivers,data:{...data,deliveries:[{...data.deliveries[0]!,quantity:250,recordCount:10}]}}));
    expect(selected).toContain('Delivered 250 t');
  });
  it('is unchanged without a driver filter: every load, with the Supplier column and the Notes',()=>{
    expect(plain).toContain('<th>Supplier</th>');
    expect(plain).toContain('Supplier loads delivered');
    expect(plain).toContain('Hassan Trans');
    expect(plain).not.toContain('selected drivers');
  });
  it('lists the ticked drivers in a Company Totals for one customer too',()=>{
    const company=noWbr(buildTotalsHtml({...base,title:'Totals',scope:'company',filters:['Drivers: Walid Khoury'],loads:every,drivers:{keys:['walid khoury'],names:'Walid Khoury'}}));
    expect(company).toContain('Company loads delivered · selected drivers · 4 loads');
    expect(company).toContain('Drivers: Walid Khoury');
    expect(company).not.toContain('Ali Kazem');
  });
});
