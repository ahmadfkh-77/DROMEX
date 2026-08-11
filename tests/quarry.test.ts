import { describe, expect, it } from 'vitest';
import { calculateQuarryPurchase, emptyQuarryPurchaseDraft, validateQuarryPurchase, type QuarrySetup } from '../src/domain/quarry';

const setup: QuarrySetup = {
  suppliers: [{ id:'s1',name:'Main Quarry',phone:null,email:null,address:null,taxVatNumber:null,notes:null,isActive:true }],
  items: [{ id:'i1',name:'Aggregate',internalCode:null,categoryName:'Quarry' }],
  drivers: [{ id:'d1',name:'Ali',phone:null,licenseNumber:null,notes:null,isActive:true }],
  trucks: [{ id:'t1',plate:'123456',makeModel:null,capacityKg:null,ownerName:null,notes:null,isActive:true }],
  vatRatePercent: 11,
};

describe('quarry purchases',()=>{
  it('calculates subtotal, universal VAT, and final total',()=>{
    const result=calculateQuarryPurchase({...emptyQuarryPurchaseDraft,quantityCubicMetres:'10',unitPriceUsd:'20'},11);
    expect(result).toEqual({subtotalUsd:200,vatAmountUsd:22,finalTotalUsd:222});
  });
  it('leaves VAT empty for quantity-only purchases',()=>{
    expect(calculateQuarryPurchase({...emptyQuarryPurchaseDraft,quantityCubicMetres:'10'},11)).toEqual({subtotalUsd:null,vatAmountUsd:null,finalTotalUsd:null});
  });
  it('requires saved profiles and positive whole cubic metres',()=>{
    expect(validateQuarryPurchase(emptyQuarryPurchaseDraft,setup).length).toBe(5);
    const valid={...emptyQuarryPurchaseDraft,supplierId:'s1',itemId:'i1',quantityCubicMetres:'12',driverId:'d1',truckId:'t1'};
    expect(validateQuarryPurchase(valid,setup)).toEqual([]);
    expect(validateQuarryPurchase({...valid,quantityCubicMetres:'12.5'},setup)).toContain('Quantity must be a positive whole number of cubic metres.');
  });
});
