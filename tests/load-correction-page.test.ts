import {describe,expect,it} from 'vitest';

import {correctionBaseline} from '../src/domain/loadCorrection';
import {changedLoadCorrectionLines,correctedTargetKept,loadCorrectionBarLabel,loadCorrectionIssueSheet,loadCorrectionLines,loadCorrectionTotals} from '../src/domain/loadCorrectionPage';
import type {ConfirmedLoad,LoadSetupOptions} from '../src/domain/loads';

/** DEC-536. The lines of the Company Load correction page, read from the same form the correction saves. */
const options={
  customers:[{id:'c1',name:'Abed Al Tayyar',type:'individual',isOwnCompany:false}],
  items:[{id:'asphalt',name:'Asphalt',categoryName:'Materials'},{id:'sand',name:'Sand',categoryName:'Materials'}],
  projects:[{id:'p1',name:'Abed tayyar project 2',customerId:'c1',customerName:'Abed Al Tayyar',location:'Addousieh',startDate:'2026-10-01',endDate:null},{id:'p2',name:'Coastal Road',customerId:'c1',customerName:'Abed Al Tayyar',location:'Tyre',startDate:'2026-10-01',endDate:null}],
  units:[{id:'unit_kg',name:'Kilogram',symbol:'kg'}],
  conversions:[{id:'kg-t',name:'Tons',inputUnitId:'unit_kg',inputUnitSymbol:'kg',inputQuantity:1000,outputUnitSymbol:'t',outputQuantity:1,decimalPlaces:3}],
  drivers:[{id:'d1',name:'Ali kazem',role:'driver'},{id:'d2',name:'Hassan Nour',role:'driver'}],
  trucks:[{id:'t1',plate:'M333299',makeModel:'Actros'},{id:'t2',plate:'M418820',makeModel:'Volvo FMX'}],
  machines:[],
  companySettings:{companyName:'DROMEX',vatRatePercent:11,address:null,phone:null,email:null,taxVatNumber:null,receiptFooter:null},
} as unknown as LoadSetupOptions;

const load={
  quantityMethod:'direct',customerId:'c1',customerName:'Abed Al Tayyar',projectId:'p1',projectName:'Abed tayyar project 2',itemId:'asphalt',itemName:'Asphalt',
  driverId:'d1',driverName:'Ali kazem',driverRole:'driver',truckId:'t1',truckPlate:'M333299',directQuantity:49745,directUnitId:'unit_kg',directUnitSymbol:'kg',
  conversionId:'kg-t',conversionName:'Tons',unitPriceUsd:null,vatRatePercent:null,notes:null,destinationAddress:null,signaturePaths:[],
  confirmedAt:'2026-10-26T15:18:00',requestedQuantityKg:null,emptyWeightKg:null,fullWeightKg:null,
} as unknown as ConfirmedLoad;

const base=correctionBaseline(load);
const target={label:'Base course · 1 200 t',signature:'ct1'};
const lines=(form=base,t:typeof target|null=target,paid=0)=>loadCorrectionLines(load,form,options,t,paid);

describe('loadCorrectionLines',()=>{
  it('lists the load line by line, in the order of the page',()=>{
    expect(lines().map(line=>[line.label,line.value])).toEqual([
      ['Date','26 Oct 2026'],['Customer','Abed Al Tayyar'],['Delivered to','Project · Abed tayyar project 2'],['Item','Asphalt'],['Counts toward target','Base course · 1 200 t'],
      ['Quantity','49745 kg'],['Converted','None'],['Driver','Ali kazem · Driver'],['Truck','M333299 · Actros'],['Price','Unpriced'],['Notes','None'],
    ]);
  });

  it('hides the target line when the project has no targets and the load is not linked',()=>{
    expect(lines(base,null).map(line=>line.key)).not.toContain('target');
  });

  it('shows the corrected value on the line and nothing else',()=>{
    const form={...base,directQuantity:'50000',conversionId:'kg-t',driverId:'d2',driverName:'Hassan Nour',truckId:'t2',truckPlate:'M418820',unitPriceUsd:'12',notes:'North gate'};
    const text=Object.fromEntries(lines(form).map(line=>[line.key,line.value]));
    expect(text).toMatchObject({quantity:'50000 kg',conversion:'Tons · 50.000 t',driver:'Hassan Nour · Driver',truck:'M418820 · Volvo FMX',price:'$12.00 per t · No VAT',notes:'North gate'});
  });

  it('writes a typed driver and truck as typed for this load',()=>{
    const text=Object.fromEntries(lines({...base,driverId:'',driverName:'Samir Khalil',truckId:'',truckPlate:'b 482113'}).map(line=>[line.key,line.value]));
    expect(text.driver).toBe('Samir Khalil · typed for this load');
    expect(text.truck).toBe('B 482113');
  });

  it('writes the address when the load goes to an outside address',()=>{
    const text=Object.fromEntries(lines({...base,projectId:'',destinationAddress:'Kfar Roummane'}).map(line=>[line.key,line.value]));
    expect(text.place).toBe('Address · Kfar Roummane');
  });

  it('marks the lines a payment locks: customer, project, conversion and price',()=>{
    const locked=lines(base,target,50000).filter(line=>line.locked).map(line=>line.key);
    expect(locked).toEqual(['customer','place','conversion','price']);
    expect(lines().some(line=>line.locked)).toBe(false);
  });

  it('adds VAT to the price line when VAT is chosen',()=>{
    const text=Object.fromEntries(lines({...base,conversionId:'kg-t',unitPriceUsd:'12',vat:{mode:'universal',ratePercent:''}}).map(line=>[line.key,line.value]));
    expect(text.price).toBe('$12.00 per t · 11% VAT');
  });
});

describe('changed lines, totals and the bar',()=>{
  it('finds only the lines whose content changed, with the old and the new text',()=>{
    const before=lines();
    expect(changedLoadCorrectionLines(before,lines())).toEqual([]);
    const after=lines({...base,recordDate:'2026-10-25',truckId:'t2',truckPlate:'M418820'});
    expect(changedLoadCorrectionLines(before,after).map(line=>[line.key,line.was,line.now])).toEqual([['date','26 Oct 2026','25 Oct 2026'],['truck','M333299 · Actros','M418820 · Volvo FMX']]);
  });

  it('treats typing the old value again as no change',()=>{
    const before=lines();
    expect(changedLoadCorrectionLines(before,lines({...base,directQuantity:'50000'})).length).toBe(1);
    expect(changedLoadCorrectionLines(before,lines({...base,directQuantity:'50000'}).length?lines({...base,directQuantity:'49745'}):before)).toEqual([]);
  });

  it('counts a changed target line',()=>{
    const before=lines();
    expect(changedLoadCorrectionLines(before,lines(base,{label:'Not linked',signature:''})).map(line=>[line.key,line.was,line.now])).toEqual([['target','Base course · 1 200 t','Not linked']]);
  });

  it('works out the total from the price, and has none while unpriced',()=>{
    expect(loadCorrectionTotals(load,base,options).total).toBeNull();
    expect(loadCorrectionTotals(load,{...base,conversionId:'kg-t',unitPriceUsd:'12'},options)).toMatchObject({subtotal:596.94,vatRatePercent:0,vatAmount:0,total:596.94});
    expect(loadCorrectionTotals(load,{...base,conversionId:'kg-t',unitPriceUsd:'12',vat:{mode:'universal',ratePercent:''}},options).total).toBe(662.6);
  });

  it('labels the bar TOTAL, or the number of changes',()=>{
    expect(loadCorrectionBarLabel(0)).toBe('TOTAL');
    expect(loadCorrectionBarLabel(1)).toBe('1 CHANGE');
    expect(loadCorrectionBarLabel(4)).toBe('4 CHANGES');
  });

  it('keeps the target only while the project and the material are the same',()=>{
    expect(correctedTargetKept(load,base)).toBe(true);
    expect(correctedTargetKept(load,{...base,projectId:'p2'})).toBe(false);
    expect(correctedTargetKept(load,{...base,itemId:'sand'})).toBe(false);
    expect(correctedTargetKept(load,{...base,directQuantity:'1'})).toBe(true);
  });
});

describe('loadCorrectionIssueSheet',()=>{
  it('sends a message to the sheet it belongs to',()=>{
    expect(loadCorrectionIssueSheet('Record date must be today or a valid past date.')).toBe('date');
    expect(loadCorrectionIssueSheet('The record date must be within the selected project dates.')).toBe('date');
    expect(loadCorrectionIssueSheet('Select a saved customer.')).toBe('customer');
    expect(loadCorrectionIssueSheet('Select a project or enter a destination address.')).toBe('place');
    expect(loadCorrectionIssueSheet('An own-company load requires a project.')).toBe('place');
    expect(loadCorrectionIssueSheet('Select a load-enabled item.')).toBe('item');
    expect(loadCorrectionIssueSheet('Direct quantity must be greater than zero with no more than six decimals.')).toBe('quantity');
    expect(loadCorrectionIssueSheet('Full weight must be greater than empty weight.')).toBe('quantity');
    expect(loadCorrectionIssueSheet('Select a conversion or choose No conversion.')).toBe('conversion');
    expect(loadCorrectionIssueSheet('Select a saved driver or operator.')).toBe('driver');
    expect(loadCorrectionIssueSheet('Truck plate is required.')).toBe('truck');
    expect(loadCorrectionIssueSheet('Unit price must be zero or more with no more than two decimals.')).toBe('price');
    expect(loadCorrectionIssueSheet('Something unexpected')).toBeNull();
  });
});
