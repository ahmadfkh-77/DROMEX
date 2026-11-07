import {describe,expect,it} from 'vitest';

import type {CompanyTotalsRecord} from '../src/data/repositories/CompanyTotalsRepository';
import type {BitumenUseRow} from '../src/domain/bitumenUse';
import type {RecordSnapshot} from '../src/domain/businessDocuments';
import type {FuelMovement} from '../src/domain/fuel';
import {bitumenForLoad,loadCompanyDailyReport,type CompanyDailyReportSources} from '../src/services/companyDailyReportLoader';

const DAY='2026-11-06';
const snapshot=(over:Partial<RecordSnapshot>):RecordSnapshot=>({
  recordType:'company_load',recordId:'l1',reference:'20261106-A-00001',loadNumber:'ASP-00001',loadNumberSeriesName:'Asphalt',itemKey:'id:asphalt',itemName:'Asphalt',unitKey:'t',unitSymbol:'t',quantity:22,
  projectId:'p1',projectName:'Airport Road',partyId:'c1',partyName:'Customer',recordedAt:`${DAY}T07:40:00`,enteredAt:null,unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,
  vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null,...over} as RecordSnapshot);
const record=(over:Partial<RecordSnapshot>,extra:Partial<CompanyTotalsRecord>={}):CompanyTotalsRecord=>({key:`k:${over.recordId??'l1'}`,snapshot:snapshot(over),seriesId:null,status:'Active',cancellationReason:null,correctionCount:0,links:[],inclusion:'not_included' as never,
  details:{destination:null,driverName:'Samir',truckPlate:'T-12',deliveredBy:null},...extra});
const use=(over:Partial<BitumenUseRow>):BitumenUseRow=>({id:'u1',createdAt:`${DAY}T07:41:00`,loadId:'l1',batchId:'b1',kind:'use',kg:1100,mixKg:22000,ruleAggregateKg:1000,ruleBitumenKg:50,loadNumber:'ASP-00001',loadConfirmedAt:`${DAY}T07:40:00`,itemName:'Asphalt',note:null,...over});
const movement=(over:Partial<FuelMovement>):FuelMovement=>({id:'f1',type:'fill',fuelType:'diesel',correctionHistory:[],confirmedAt:`${DAY}T06:30:00`,litres:120,equipmentName:'Excavator E-3',equipmentId:'e1',projectId:'p1',projectName:'Airport Road',status:'Active',...over} as FuelMovement);

const sources=(over:{records?:CompanyTotalsRecord[];movements?:FuelMovement[];useRows?:BitumenUseRow[]}={}):CompanyDailyReportSources=>({
  totals:{listRecords:async()=>over.records??[]},
  fuel:{getOverview:async()=>({currentBalanceLitres:0,hasKnownBalance:false,latestGauge:null,movements:over.movements??[]})},
  waste:{listWasteHistory:async()=>[]},
  bitumen:{getOverview:async()=>({usingBatchId:null,totalRemainingKg:0,batches:[],useRows:over.useRows??[]})},
});

describe('bitumenForLoad (uses the existing bitumen engine rows)',()=>{
  it('is not applicable for a load with no bitumen rows',()=>{expect(bitumenForLoad([])).toEqual({applies:false,kg:null});});
  it('counts what the batches took for a covered load',()=>{expect(bitumenForLoad([use({})])).toEqual({applies:true,kg:1100});});
  it('shows "-" (null) for a load whose mix is unknown',()=>{expect(bitumenForLoad([use({mixKg:0,kg:0})]).kg).toBeNull();});
  it('shows "-" (null) for a load that is not fully covered by a batch',()=>{
    expect(bitumenForLoad([use({}),use({id:'u2',batchId:null,kind:'use',kg:300})]).kg).toBeNull();
  });
});

describe('loadCompanyDailyReport - contract targets',()=>{
  const row={itemId:'c1',name:'Asphalt',unitSymbol:'t',quantity:1000,usedBefore:400,usedToday:22,used:422,percentUsed:42.2,left:578,overBy:0,warning:'none' as const};
  it('attaches the targets of each project with every switch OFF, and never queries sites or no project',async()=>{
    const asked:string[]=[];
    const report=await loadCompanyDailyReport(DAY,{...sources({records:[record({})]}),contract:{targetTableOn:async(projectId)=>{asked.push(projectId);return [row];}}});
    expect(asked).toEqual(['p1']);expect(report.places[0]!.contract).toMatchObject({available:true,included:false,rows:[row]});
  });
  it('attaches nothing for a project without targets',async()=>{
    const report=await loadCompanyDailyReport(DAY,{...sources({records:[record({})]}),contract:{targetTableOn:async()=>[]}});
    expect(report.places[0]!.contract).toBeUndefined();
  });
});

describe('loadCompanyDailyReport - prices',()=>{
  it('keeps the recorded price of a load and leaves an unpriced one Unpriced (null, never zero)',async()=>{
    const report=await loadCompanyDailyReport(DAY,sources({records:[record({recordId:'a',unitPriceCents:6200,subtotalCents:136400}),record({recordId:'b'})],movements:[movement({pricePerLitreUsd:0.9,consumptionCostUsd:108} as never)]}));
    const loads=report.places[0]!.loadsOut;
    expect(loads.find(l=>l.id==='a')).toMatchObject({unitPriceCents:6200,amountCents:136400,priceBasis:'per_unit'});
    expect(loads.find(l=>l.id==='b')).toMatchObject({unitPriceCents:null,amountCents:null,priceBasis:null});
    expect(report.places[0]!.fills[0]).toMatchObject({unitPriceCents:90,amountCents:10800});
  });
});

describe('loadCompanyDailyReport',()=>{
  it('collects loads, supplier loads and fills of the day and attaches the bitumen of asphalt loads',async()=>{
    const report=await loadCompanyDailyReport(DAY,sources({
      records:[record({}),record({recordType:'supplier_load',recordId:'s1',reference:'S-1',loadNumber:null,itemName:'Sand',quantity:20,partyName:'Rami Quarry',supplierReference:'T-1'},{details:{destination:null,driverName:null,truckPlate:null,deliveredBy:'supplier'}})],
      movements:[movement({}),movement({id:'f0',confirmedAt:'2026-11-05T06:30:00'}),movement({id:'g',type:'gauge'})],useRows:[use({})]}));
    expect(report.places).toHaveLength(1);
    expect(report.places[0]!.loadsOut[0]!.bitumenKg).toBe(1100);
    expect(report.places[0]!.supplierLoads[0]!.deliveredBy).toBe('supplier');
    expect(report.places[0]!.supplierLoads[0]).toHaveProperty('driverName');
    expect(report.places[0]!.fills.map(f=>f.id)).toEqual(['f1']);
    expect(report.bitumenKg).toBe(1100);
  });
  it('puts a supplier load delivered to a company site under that site, not under a project',async()=>{
    const report=await loadCompanyDailyReport(DAY,sources({records:[record({recordType:'supplier_load',recordId:'s2',projectId:null,projectName:'Main Plant',itemName:'Sand'},{details:{siteId:'site1',destination:null,driverName:null,truckPlate:null,deliveredBy:'company'}})]}));
    expect(report.places.map(p=>[p.name,p.kind])).toEqual([['Main Plant','site']]);
  });
  it('returns an empty report for a day with no records and never reaches a zero figure',async()=>{
    const report=await loadCompanyDailyReport(DAY,sources());
    expect(report.isEmpty).toBe(true);expect(report.tiles).toEqual([]);
  });
});
