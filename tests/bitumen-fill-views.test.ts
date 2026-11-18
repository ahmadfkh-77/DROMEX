import {describe,expect,it} from 'vitest';

import type {BitumenFill} from '../src/domain/bitumenFills';
import {planFill,type FillBatch} from '../src/domain/bitumenFills';
import {batchFillFigures,batchFillLine,cancelledFillNote,fillCostLabel,fillDestinationTotals,fillPreviewLines,fillRowsForBatch,groupFillsByDay} from '../src/domain/bitumenFillViews';

/** The words and numbers the bitumen fill screens show (DEC-557): day cards, destination totals, figures, and "Before you save". */
const fill=(id:string,day:string,kg:number,extra:Partial<BitumenFill>={}):BitumenFill=>({
  id,recordDate:day,confirmedAt:`${day}T08:00:00.000Z`,enteredAt:`${day}T08:00:00.000Z`,truckId:'t',truckName:'72-118',destinationType:'project',projectId:'p1',projectName:'Hasbaya Road',companySiteId:null,companySiteName:null,
  layerNote:null,ticketNumber:null,notes:null,totalKg:kg,portions:[{batchId:'b1',batchNumber:'BIT-1',kg,pricePerKgUsd:1}],cost:{costUsd:kg,pricedKg:kg,unpricedKg:0,fullyPriced:true},status:'Active',cancellationReason:null,cancelledAt:null,...extra,
});

describe('the fills of one batch',()=>{
  it('lists only fills that took from the batch, and shows this batch\'s part of a split fill',()=>{
    const split=fill('f2','2026-11-05',3000,{portions:[{batchId:'b0',batchNumber:'BIT-0',kg:1000,pricePerKgUsd:1},{batchId:'b1',batchNumber:'BIT-1',kg:2000,pricePerKgUsd:1}]});
    const rows=fillRowsForBatch([fill('f1','2026-11-04',500,{portions:[{batchId:'b9',batchNumber:'BIT-9',kg:500,pricePerKgUsd:null}]}),split],'b1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({fillId:'f2',kg:2000,totalKg:3000,split:true});
  });

  it('groups by day newest first and by destination inside a day, with Unassigned last and totals that skip cancelled fills',()=>{
    const fills=[
      fill('a','2026-11-06',2500),fill('b','2026-11-06',1500),
      fill('c','2026-11-05',1200,{destinationType:'company_site',projectId:null,projectName:null,companySiteId:'yard',companySiteName:'Main Yard'}),
      fill('d','2026-11-05',600,{destinationType:'unassigned',projectId:null,projectName:null}),
      fill('e','2026-11-05',9999,{status:'Cancelled',cancellationReason:'Wrong truck',cancelledAt:'2026-11-05T09:00:00.000Z'}),
    ];
    const days=groupFillsByDay(fillRowsForBatch(fills,'b1'),'2026-11-06');
    expect(days.map(d=>[d.day,d.total,d.isToday])).toEqual([['2026-11-06',4000,true],['2026-11-05',1800,false]]);
    expect(days[1]!.groups.map(g=>[g.name,g.total])).toEqual([['Hasbaya Road',0],['Main Yard',1200],['Unassigned',600]]);
    expect(days[1]!.groups[0]!.rows[0]).toMatchObject({cancelled:true});
    expect(cancelledFillNote(days[1]!.groups[0]!.rows[0]!)).toBe('Cancelled · Wrong truck · not counted');
    expect(cancelledFillNote(days[0]!.groups[0]!.rows[0]!)).toBeNull();
  });

  it('totals by destination, biggest first, Unassigned last, and never counts a cancelled fill',()=>{
    const fills=[fill('a','2026-11-06',6000),fill('b','2026-11-05',1800,{projectId:'p2',projectName:'Water Tank'}),fill('c','2026-11-04',600,{destinationType:'unassigned',projectId:null,projectName:null}),fill('d','2026-11-03',5000,{status:'Cancelled'})];
    expect(fillDestinationTotals(fillRowsForBatch(fills,'b1')).map(t=>[t.name,t.kg])).toEqual([['Hasbaya Road',6000],['Water Tank',1800],['Unassigned',600]]);
  });
});

describe('the batch figures',()=>{
  it('keeps fills and asphalt use apart on the bar and never lets them pass the delivered kg',()=>{
    const figures=batchFillFigures({deliveredKg:30000,filledKg:8400,usedKg:14950,adjustmentKg:-150,remainingKg:6500});
    expect(figures).toMatchObject({fillsKg:8400,asphaltKg:14950,adjustmentKg:-150,remainingKg:6500});
    expect(figures.fillsShare+figures.asphaltShare).toBeLessThanOrEqual(1);
    expect(batchFillFigures({deliveredKg:1000,filledKg:900,usedKg:900,adjustmentKg:0,remainingKg:0}).asphaltShare).toBeCloseTo(0.1);
  });
  it('says the list line in words, and leaves the adjustment out when there is none',()=>{
    expect(batchFillLine({filledKg:8400,usedKg:14950,adjustmentKg:-150})).toBe('Fills 8,400 kg · Asphalt loads (est.) 14,950 kg · Adjustment −150 kg');
    expect(batchFillLine({filledKg:4000,usedKg:6900,adjustmentKg:0})).toBe('Fills 4,000 kg · Asphalt loads (est.) 6,900 kg');
  });
});

describe('Before you save',()=>{
  const batch=(id:string,day:string,remainingKg:number,pricePerKgUsd:number|null):FillBatch=>({id,batchNumber:`BIT-${id}`,arrivedDay:day,active:true,closed:false,remainingKg,pricePerKgUsd});
  const plan=(batches:FillBatch[],kg:number)=>planFill({batches,usingBatchId:null,kg,day:'2026-11-06',today:'2026-11-06'});

  it('shows the split across two batches as one fill, with the cost and an Unpriced part',()=>{
    const lines=fillPreviewLines(plan([batch('7','2026-11-01',6500,0.61),batch('8','2026-11-05',20000,null)],7200));
    expect(lines.map(l=>[l.label,l.value])).toEqual([['From BIT-7','6,500 kg'],['From BIT-8','700 kg'],['Total fill · shown as one fill, split','7,200 kg'],['Cost','$3,965.00 + 700 kg Unpriced']]);
    expect(lines[0]!.note).toBe('uses the last 6,500 kg · batch closes');
  });

  it('shows what the open batches hold and Over by when the fill is too big, and no cost',()=>{
    const lines=fillPreviewLines(plan([batch('7','2026-11-01',6500,1),batch('8','2026-11-05',2600,1)],12000));
    expect(lines.map(l=>[l.label,l.value])).toEqual([['Open batches hold','9,100 kg'],['Over by','2,900 kg']]);
  });

  it('shows no lines for another issue, and labels an unpriced cost Unpriced, never zero',()=>{
    expect(fillPreviewLines(plan([batch('7','2026-11-01',100,1)],0))).toEqual([]);
    expect(fillCostLabel({costUsd:null,pricedKg:0,unpricedKg:300,fullyPriced:false})).toBe('Unpriced');
  });
});
