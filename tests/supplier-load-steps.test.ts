import {describe,expect,it} from 'vitest';

import {emptyQuarryPurchaseDraft,quarryEntrySteps,quarryStepIssues,validateQuarryPurchase,type QuarryPurchaseDraft,type QuarrySetup} from '../src/domain/quarry';

/**
 * The New Supplier Load form (Option A): four steps with Back, a running total, a review step and a New supplier sheet. Every field and rule
 * of the old long form is still there; Next only stops for the checks that belong to the step being left.
 */
const read=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;
const screen=read('src/ui/screens/QuarryPurchasesScreen.tsx');
const setup:QuarrySetup={suppliers:[{id:'s1',name:'Main Quarry',phone:null,email:null,address:null,taxVatNumber:null,notes:null,isActive:true,vat:{mode:'none',ratePercent:null}}],projects:[],items:[{id:'i1',name:'Base course',internalCode:null,categoryName:'Aggregates',defaultUnitId:'u1'}],units:[{id:'u1',name:'Cubic metre',symbol:'m³'}],drivers:[],trucks:[],vatRatePercent:11,companySites:[]};
const filled:QuarryPurchaseDraft={...emptyQuarryPurchaseDraft,supplierId:'s1',destinationType:'unassigned',itemId:'i1',unitId:'u1',quantityCubicMetres:'10',deliveryMethod:'supplier'};

describe('the steps and their checks (pure)',()=>{
  it('names the four steps in order',()=>{
    expect([...quarryEntrySteps]).toEqual(['Who and where','What arrived','Price (optional)','Review and save']);
  });
  it('gives every validation message to exactly one of the first three steps, and a valid draft has none',()=>{
    expect(validateQuarryPurchase(filled,setup)).toEqual([]);
    const broken:QuarryPurchaseDraft[]=[
      {...filled,supplierId:''},{...filled,destinationType:'project',projectId:''},{...filled,destinationType:'company_site',companySiteId:''},{...filled,recordDate:'2999-01-01'},
      {...filled,itemId:''},{...filled,unitId:''},{...filled,quantityCubicMetres:'0'},{...filled,pieces:'abc'},{...filled,lengthPerBarM:'-1'},{...filled,weightSource:'junk' as never},
      {...filled,deliveryMethod:'company',driverId:'',truckId:''},{...filled,unitPriceUsd:'1.234'},{...filled,unitPriceUsd:'5',vatMode:'custom',customVatRatePercent:'150'},
    ];
    for(const draft of broken){
      const issues=validateQuarryPurchase(draft,setup);
      expect(issues.length,JSON.stringify(draft)).toBeGreaterThan(0);
      for(const message of issues){
        const owners=[1,2,3].filter(step=>quarryStepIssues(step,[message]).length>0);
        expect(owners,message).toHaveLength(1);
      }
    }
  });
  it('sends supplier, location and date problems to step 1, item and delivery problems to step 2, and price and VAT problems to step 3',()=>{
    const stepOf=(draft:QuarryPurchaseDraft)=>[1,2,3].filter(step=>quarryStepIssues(step,validateQuarryPurchase(draft,setup)).length>0);
    expect(stepOf({...filled,supplierId:''})).toEqual([1]);
    expect(stepOf({...filled,destinationType:'project',projectId:''})).toEqual([1]);
    expect(stepOf({...filled,recordDate:'2999-01-01'})).toEqual([1]);
    expect(stepOf({...filled,quantityCubicMetres:'0'})).toEqual([2]);
    expect(stepOf({...filled,deliveryMethod:'company',driverId:'',truckId:''})).toEqual([2]);
    expect(stepOf({...filled,unitPriceUsd:'1.234'})).toEqual([3]);
    expect(stepOf({...filled,unitPriceUsd:'5',vatMode:'custom',customVatRatePercent:'150'})).toEqual([3]);
    expect(quarryStepIssues(4,['Select a supplier.'])).toEqual([]);
  });
});

describe('the form (screen)',()=>{
  it('shows a progress bar, the step name, and Back (Cancel on step 1) with Next and Save load',()=>{
    expect(screen).toContain('accessibilityRole="progressbar"');expect(screen).toContain('{stepNames[entryStep-1]}');expect(screen).toContain('Step {entryStep} of 4');
    expect(screen).toContain("{entryStep===1?'Cancel':'Back'}");expect(screen).toContain("{entryStep===4?(busy?'Saving...':'Save load'):'Next'}");
    expect(screen).toContain('onPress={entryStep===4?()=>void confirm():goNextStep}');
  });
  it('asks before leaving from step 1 and says the draft is kept',()=>{
    expect(screen).toContain("Alert.alert('Leave this supplier load?','Your draft is kept, so you can come back to it.'");
  });
  it('keeps a running total on every step and a summary you can tap on the last one',()=>{
    expect(screen).toContain("{grandTotal==null?'not priced yet'");expect(screen).toContain('Tap a line to change it.');
    expect(screen).toContain('onPress={()=>setEntryStep(step)}');
    expect(screen).toContain('quarryStepIssues(entryStep,validateQuarryPurchase(draft,setup))');
  });
  it('puts the old fields in their steps without dropping any',()=>{
    const step=(n:number)=>{const a=screen.indexOf(`{entryStep===${n}?`);const b=screen.indexOf(`{entryStep===${n+1}?`);return screen.slice(a,b>a?b:a+9000);};
    expect(step(1)).toContain('label="Record date *"');expect(step(1)).toContain('label="Supplier *"');expect(step(1)).toContain('<FuelDestinationFields');expect(step(1)).toContain('+ New supplier');
    for(const part of ['label="Item *"','label="Measurement unit *"','label="Quantity *"','label="Pieces (optional)"','<SteelItemFields','Rebar calculator: suggest the weight','Delivery handled by','label="Driver *"','label="Truck plate *"','label="Supplier truck / plate (optional)"','label="Supplier ticket / invoice number"','MORE ITEMS ON THIS DELIVERY NOTE','+ Add another item to this delivery','Split the total across the items'])expect(step(2),part).toContain(part);
    expect(step(3)).toContain('<PriceVatControls');expect(step(3)).toContain('No price entered: this supplier load is saved as Unpriced.');
    expect(step(4)).toContain('TICKET PHOTOS · OPTIONAL');expect(step(4)).toContain('label="Notes"');
    expect(screen.match(/calculatedPatch\(/g)?.length).toBe(1);
  });
  it('opens New supplier as a sheet with the name first, the rest under More details, and the VAT choice',()=>{
    expect(screen).toContain('<Modal visible={showSupplier}');expect(screen).toContain('New supplier</Text>');
    expect(screen).toContain('More details · email, address, tax number, notes');
    expect(screen).toContain('...vatFieldsForSupplier(supplier.vat)');
    expect(screen).not.toContain('Quick add supplier');
  });
  it('uses the three VAT choices on the price step and keeps them for the correction form',()=>{
    expect(screen).toContain("const choice:VatChoice={mode:value.vatMode==='company'?'universal':value.vatMode==='custom'?'custom':'none'");
    expect(screen).toContain('<VatChoiceControl value={choice}');expect(screen).toContain('No VAT is added unless you choose it.');
    expect(screen).toContain('Does not include VAT');expect(screen).toContain('Already includes VAT');
    expect(screen).toContain("label:'Location *'");
  });
});

describe('every step in the Open form look',()=>{
  const step=(n:number)=>{const a=screen.indexOf(`{entryStep===${n}?`);const b=screen.indexOf(`{entryStep===${n+1}?`);return screen.slice(a,b>a?b:a+9000);};
  it('has no boxed cards on steps 1 to 3, and groups the fields under small labels',()=>{
    for(const n of [1,2,3,4])expect(step(n)).not.toContain('<Card ');
    for(const label of ['WHEN','WHO','WHERE','WHAT','HOW IT CAME'])expect(screen).toContain(`>${label}</Text>`);
    for(const label of ['PRICE','VAT','WHAT IT COMES TO','NOTES · OPTIONAL'])expect(screen).toContain(`>${label}</Text>`);
  });
  it('uses the underlined fields and the switches, and keeps the other screens on the boxed ones',()=>{
    expect(step(2)).toContain('variant="open"');expect(step(2)).toContain('<OpenSwitch label="Delivery handled by"');
    expect(screen).toContain('<PriceVatControls open value={draft}');
    expect(screen).toContain('<PriceVatControls value={correction}');
  });
  it('shows the steel note only for a steel item, and keeps every extra item editable and removable',()=>{
    expect(step(2)).toContain('{isSteelItem(draft.itemId)?<Text style={styles.openHelp}>Steel: choose the unit kg');
    for(const text of ['+ Add another item to this delivery','Remove','setOpenExtra','Split the total across the items','Rebar calculator for this delivery'])expect(step(2)).toContain(text);
  });
});

describe('the Suppliers page',()=>{
  it('drops the "Incoming material, connected" card, keeps the Add Supplier Load button, the counters and the history, and shows the summary as a plain row',()=>{
    expect(screen).not.toContain('Incoming material, connected');expect(screen).not.toContain("['SUPPLIER','PROJECT','ITEM','PAYMENT','EXCEL']");
    for(const text of ['Add Supplier Load','<SupplierTruckCounters','DELIVERY SUMMARY','Purchase history'])expect(screen).toContain(text);
    expect(screen).toContain('summaryHeader:{backgroundColor:colors.surface');
    expect(screen).not.toContain('borderLeftWidth:5,borderLeftColor:colors.brand,minHeight:82');
  });
});
