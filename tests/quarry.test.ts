import { describe, expect, it } from 'vitest';
import { calculateQuarryPurchase, emptyQuarryPurchaseDraft, groupQuarryPurchases, quarryDailyCounters, validateQuarryPurchase, type QuarryPurchase, type QuarrySetup } from '../src/domain/quarry';

const setup: QuarrySetup = {
  suppliers: [{ id:'s1',name:'Main Quarry',phone:null,email:null,address:null,taxVatNumber:null,notes:null,isActive:true }],
  projects: [{id:'p1',customerId:'c1',customerName:'DROMEX',name:'Mountain Road',location:'Aley',status:'active',notes:null}],
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
  it('rejects stale project references and excessive price decimals',()=>{const valid={...emptyQuarryPurchaseDraft,supplierId:'s1',itemId:'i1',quantityCubicMetres:'12',driverId:'d1',truckId:'t1'};expect(validateQuarryPurchase({...valid,projectId:'missing'},setup)).toContain('Select a valid project or clear the project field.');expect(validateQuarryPurchase({...valid,unitPriceUsd:'10.999'},setup)).toContain('Price per m³ must be zero or more with no more than two decimals.');});
  it('groups purchase history by supplier then linked project with unlinked purchases last',()=>{
    const purchase=(id:string,supplierId:string,supplierName:string,projectId:string|null,projectName:string|null)=>({id,supplierId,supplierName,projectId,projectName} as QuarryPurchase);
    const groups=groupQuarryPurchases([purchase('3','b','Beta Quarry',null,null),purchase('2','a','Alpha Quarry','p2','Zahle Road'),purchase('1','a','Alpha Quarry','p1','Aley Road'),purchase('4','a','Alpha Quarry',null,null)]);
    expect(groups.map(value=>value.name)).toEqual(['Alpha Quarry','Beta Quarry']);
    expect(groups[0]?.projectGroups.map(value=>value.name)).toEqual(['Aley Road','Zahle Road','No project linked']);
    expect(groups[0]?.purchases).toHaveLength(3);
  });
  it('builds separate daily counters per project, supplier, item, driver, and truck',()=>{
    const purchase=(id:string,time:string,truckId:string,truckPlate:string,quantity:number,status:'Active'|'Cancelled'='Active')=>({id,confirmedAt:`2026-08-27T${time}:00`,projectId:'p1',projectName:'Mountain Road',supplierId:'s1',supplierName:'Main Quarry',itemId:'i1',itemName:'Aggregate',driverId:truckId==='t1'?'d1':'d2',driverName:truckId==='t1'?'Ali':'Hassan',truckId,truckPlate,quantityCubicMetres:quantity,status} as QuarryPurchase);
    const counters=quarryDailyCounters([purchase('one','08:00','t1','123456',20),purchase('two','10:00','t1','123456',18),purchase('three','09:00','t2','654321',22),purchase('cancelled','11:00','t1','123456',30,'Cancelled')],'2026-08-27');
    expect(counters).toHaveLength(2);
    expect(counters[0]).toMatchObject({truckPlate:'123456',tripCount:2,totalQuantityCubicMetres:38,defaultQuantityCubicMetres:18,sourcePurchaseId:'two'});
    expect(counters[1]).toMatchObject({truckPlate:'654321',tripCount:1,totalQuantityCubicMetres:22});
  });
});
