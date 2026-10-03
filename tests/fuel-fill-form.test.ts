import {describe,expect,it} from 'vitest';

import {emptyFuelFill,type FuelFillDraft} from '../src/domain/fuel';
import {fillFormKind,fillFormReady,fillFormHelper,formatLitres,overfillMessage,stationFillPreviewLines,tankFillPreviewLines,costSummaryLabel,batchOptionDetail,openBatchOptions} from '../src/domain/fuelFillForm';
import type {BatchDetail,TankFillPreviewResult} from '../src/domain/fuelBatches';

/** DEC-492, Screen B. The wording and numbers of the Record Fill form and its "Before you save" panel. */
const draft=(extra:Partial<FuelFillDraft>={}):FuelFillDraft=>({...emptyFuelFill,litres:'100',equipmentId:'exc',...extra});
const batch=(number:string,status:BatchDetail['status'],remaining:number,extra:Partial<BatchDetail>={}):BatchDetail=>({
  id:number,batchNumber:`DSL-2026-0000${number}`,arrivedAt:'2026-10-01T08:00:00Z',deliveredLitres:1000,pricePerLitreUsd:1.1,filledLitres:0,adjustmentLitres:0,remainingLitres:remaining,status,
  kind:'delivery',invoiceNumber:'55821',supplierName:null,openingBasis:null,deliveryMovementId:null,openingGaugeMovementId:null,cancellationReason:null,cancelledAt:null,...extra,
});

describe('formatLitres',()=>{
  it('shows a unit, thousands separators and at most one decimal',()=>{
    expect(formatLitres(340)).toBe('340 L');
    expect(formatLitres(1050)).toBe('1,050 L');
    expect(formatLitres(1234567)).toBe('1,234,567 L');
    expect(formatLitres(12.5)).toBe('12.5 L');
    expect(formatLitres(12.34)).toBe('12.3 L');
    expect(formatLitres(0)).toBe('0 L');
  });
  it('uses a real minus sign for a negative quantity',()=>{
    expect(formatLitres(-20)).toBe('−20 L');
  });
});

describe('which form the fill uses',()=>{
  const started={started:true,startedAt:'2026-10-01T08:00:00Z'},notStarted={started:false,startedAt:null};
  it('is an outside station fill when the source is a station',()=>{
    expect(fillFormKind(draft({fuelSource:'station'}),started)).toBe('station');
    expect(fillFormKind(draft({fuelSource:'station',fuelType:'gasoline'}),notStarted)).toBe('station');
  });
  it('is a batch fill for diesel from the tank once tracking has started',()=>{
    expect(fillFormKind(draft(),started)).toBe('tank_batch');
    expect(fillFormKind(draft({fuelSource:'tank'}),started)).toBe('tank_batch');
  });
  it('stays the plain fill before tracking starts, and for gasoline',()=>{
    expect(fillFormKind(draft(),notStarted)).toBe('tank_plain');
    expect(fillFormKind(draft({fuelType:'gasoline'}),started)).toBe('tank_plain');
  });
});

describe('helper sentence under the title',()=>{
  it('says where the diesel comes from, or that a station fill leaves the tank alone',()=>{
    expect(fillFormHelper('tank_batch')).toBe('Diesel from the tank is taken from the oldest batch first.');
    expect(fillFormHelper('station')).toBe('Fuel bought at a station. It is kept for history and does not change the tank.');
    expect(fillFormHelper('tank_plain')).toBe('Record the fuel put into this equipment.');
  });
});

describe('open batches offered for choosing',()=>{
  const batches=[batch('4','in_use',340),batch('5','waiting',1000),batch('3','closed',0),batch('2','cancelled',0)];
  it('lists only open batches, oldest first, with the remaining litres under each',()=>{
    const options=openBatchOptions(batches);
    expect(options.map(option=>option.id)).toEqual(['4','5']);
    expect(options[0]).toEqual({id:'4',label:'DSL-2026-00004 · Invoice 55821',detail:'Oldest open batch · 340 L remaining'});
    expect(options[1]).toEqual({id:'5',label:'DSL-2026-00005 · Invoice 55821',detail:'Waiting · 1,000 L remaining'});
  });
  it('says the invoice is not recorded when it is missing, never hiding the batch',()=>{
    expect(openBatchOptions([batch('6','in_use',10,{invoiceNumber:null})])[0]!.label).toBe('DSL-2026-00006 · Invoice not recorded');
  });
  it('marks the opening stock batch',()=>{
    expect(batchOptionDetail(batch('1','in_use',800,{kind:'opening',invoiceNumber:null,openingBasis:'calculated'}))).toBe('Oldest open batch · 800 L remaining · Opening stock');
  });
});

describe('Before you save: a tank fill',()=>{
  const preview=(extra:Partial<TankFillPreviewResult>={}):TankFillPreviewResult=>({
    portions:[
      {batchId:'4',batchNumber:'DSL-2026-00004',litres:340,closesBatch:true,remainingAfterLitres:0,statusBefore:'in_use'},
      {batchId:'5',batchNumber:'DSL-2026-00005',litres:60,closesBatch:false,remainingAfterLitres:940,statusBefore:'waiting'},
    ],shortfallLitres:0,tankBeforeLitres:1340,tankAfterLitres:940,overfillAlert:false,cost:{costUsd:374,pricedLitres:340,unpricedLitres:60,fullyPriced:false},...extra,
  });

  it('lists one row per batch portion, then the total, the tank after, and the cost',()=>{
    expect(tankFillPreviewLines(preview(),400)).toEqual([
      {label:'From DSL-2026-00004',note:'uses the last 340 L · batch closes',value:'340 L',kind:'portion'},
      {label:'From DSL-2026-00005',note:'becomes the batch in use',value:'60 L',kind:'portion'},
      {label:'Total fill · shown as one fill, split',value:'400 L',kind:'total'},
      {label:'Tank after this fill',value:'1,340 L → 940 L',kind:'detail'},
      {label:'Cost',value:'$374.00 + 60 L Unpriced',kind:'detail'},
    ]);
  });

  it('does not say split for a fill taken from one batch, and shows what is left in it',()=>{
    const lines=tankFillPreviewLines(preview({portions:[{batchId:'4',batchNumber:'DSL-2026-00004',litres:100,closesBatch:false,remainingAfterLitres:240,statusBefore:'in_use'}],tankAfterLitres:1240,cost:{costUsd:110,pricedLitres:100,unpricedLitres:0,fullyPriced:true}}),100);
    expect(lines[0]).toEqual({label:'From DSL-2026-00004',note:'240 L left in this batch',value:'100 L',kind:'portion'});
    expect(lines[1]).toEqual({label:'Total fill',value:'100 L',kind:'total'});
    expect(lines.at(-1)).toEqual({label:'Cost',value:'$110.00',kind:'detail'});
  });

  it('shows the litres no batch can supply as an alert row',()=>{
    const lines=tankFillPreviewLines(preview({portions:[{batchId:'4',batchNumber:'DSL-2026-00004',litres:100,closesBatch:true,remainingAfterLitres:0,statusBefore:'in_use'}],shortfallLitres:30,tankBeforeLitres:100,tankAfterLitres:0,overfillAlert:true,cost:{costUsd:100,pricedLitres:100,unpricedLitres:30,fullyPriced:false}}),130);
    expect(lines).toContainEqual({label:'No diesel left in any open batch',note:'still saved, with an Overfill Alert',value:'30 L',kind:'alert'});
    expect(lines.find(line=>line.kind==='total')).toEqual({label:'Total fill · shown as one fill',value:'130 L',kind:'total'});
  });

  it('writes the overfill explanation in plain words, only when there is an overfill',()=>{
    expect(overfillMessage(preview())).toBeNull();
    expect(overfillMessage(preview({shortfallLitres:30,overfillAlert:true}))).toBe('Overfill Alert: this fill is 30 L more than all the diesel recorded in the tank. It will still be saved, and the alert stays until a delivery or a dip reading resolves it.');
  });
});

describe('cost summary',()=>{
  it('shows money for a priced fill, money plus unpriced litres when partly priced, and Unpriced when none is',()=>{
    expect(costSummaryLabel({costUsd:452,pricedLitres:400,unpricedLitres:0,fullyPriced:true})).toBe('$452.00');
    expect(costSummaryLabel({costUsd:374,pricedLitres:340,unpricedLitres:60,fullyPriced:false})).toBe('$374.00 + 60 L Unpriced');
    expect(costSummaryLabel({costUsd:null,pricedLitres:0,unpricedLitres:400,fullyPriced:false})).toBe('Unpriced');
  });
});

describe('Before you save: an outside station fill',()=>{
  it('says the tank does not change, and where the fill still counts',()=>{
    expect(stationFillPreviewLines({stationName:'Hasbaya Highway Station',litres:60,tankLitres:1340,equipmentName:'Truck 72-118',destinationType:'project'})).toEqual([
      {label:'Outside station · Hasbaya Highway Station',value:'60 L',kind:'total'},
      {label:'Tank',value:'No change (1,340 L)',kind:'detail'},
      {label:'Counts in',value:'Truck 72-118 · project fuel · Daily Report',kind:'detail'},
    ]);
  });
  it('counts a company site or unassigned fill in the equipment history without naming a project',()=>{
    expect(stationFillPreviewLines({stationName:'S',litres:5,tankLitres:0,equipmentName:'Generator',destinationType:'company_site'})[2]!.value).toBe('Generator · company site fuel · Daily Report');
    expect(stationFillPreviewLines({stationName:'S',litres:5,tankLitres:0,equipmentName:'Generator',destinationType:'unassigned'})[2]!.value).toBe('Generator · equipment fuel history');
  });
});

describe('when the form can be saved',()=>{
  it('needs litres, equipment, and a station for a station fill',()=>{
    expect(fillFormReady(draft(),'tank_plain')).toBe(true);
    expect(fillFormReady(draft({litres:''}),'tank_plain')).toBe(false);
    expect(fillFormReady(draft({equipmentId:''}),'tank_batch')).toBe(false);
    expect(fillFormReady(draft({fuelSource:'station',stationId:''}),'station')).toBe(false);
    expect(fillFormReady(draft({fuelSource:'station',stationId:'s1'}),'station')).toBe(true);
  });
});
