import type { DriverProfile, Project, TruckProfile } from './loads';

export type Supplier = { id: string; name: string; phone: string | null; email: string | null; address: string | null; taxVatNumber: string | null; notes: string | null; isActive: boolean };
export type SupplierDraft = { name: string; phone?: string; email?: string; address?: string; taxVatNumber?: string; notes?: string };
export type SupplierUnit = { id: string; name: string; symbol: string };
export type QuarryItem = { id: string; name: string; internalCode: string | null; categoryName: string; defaultUnitId?: string | null };
export type QuarrySetup = { suppliers: Supplier[]; projects: Project[]; items: QuarryItem[]; units: SupplierUnit[]; drivers: DriverProfile[]; trucks: TruckProfile[]; vatRatePercent: number };
export type QuarryDeliveryMethod = 'company' | 'supplier';
export type SupplierPriceBasis = 'per_unit' | 'whole';
export type SupplierVatMode = 'company' | 'none' | 'custom';
export type QuarryPurchaseDraft = {
  supplierId: string; projectId: string; itemId: string; unitId: string; quantityCubicMetres: string;
  deliveryMethod: QuarryDeliveryMethod; driverId: string; truckId: string; supplierTruckPlate: string;
  supplierTicketNumber: string; priceBasis: SupplierPriceBasis; unitPriceUsd: string; vatMode: SupplierVatMode;
  customVatRatePercent: string; vatInclusive: boolean; notes: string; photos: string[];
};
export type QuarryCorrectionDraft = Omit<QuarryPurchaseDraft,'photos'> & { correctionReason: string };
export type QuarryCalculation = { subtotalUsd: number | null; vatRatePercent: number | null; vatAmountUsd: number | null; finalTotalUsd: number | null };
export type SupplierCorrectionChange = { field: string; originalValue: string | null; newValue: string | null };
export type SupplierCorrectionEntry = { correctedAt: string; correctedBy: string; reason: string; changes: SupplierCorrectionChange[] };
export type QuarryPurchase = {
  id: string; purchaseNumber: string; confirmedAt: string; supplierId:string; supplierName: string;
  projectId:string|null; projectName:string|null; itemId:string; itemName: string; itemCode: string | null;
  categoryName: string; unitId:string; unitName:string; unitSymbol:string; quantityCubicMetres: number;
  deliveryMethod:QuarryDeliveryMethod; driverId:string; driverName: string; truckId:string; truckPlate: string;
  supplierTicketNumber: string | null; priceBasis:SupplierPriceBasis; unitPriceUsd: number | null;
  subtotalUsd: number | null; vatMode:SupplierVatMode; vatInclusive:boolean; vatRatePercent: number | null;
  vatAmountUsd: number | null; finalTotalUsd: number | null;
  paymentStatus: 'Unpriced' | 'No Payment Due' | 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overpaid';
  notes: string | null; photos: string[]; status:'Active'|'Cancelled'; cancellationReason:string|null;
  cancelledAt:string|null; correctionHistory:SupplierCorrectionEntry[]; updatedAt:string;
};
export type QuarryProjectGroup={id:string|null;name:string;purchases:QuarryPurchase[]};
export type QuarrySupplierGroup={id:string;name:string;purchases:QuarryPurchase[];projectGroups:QuarryProjectGroup[]};
export type QuarryDailyCounter={key:string;sourcePurchaseId:string;supplierName:string;projectName:string|null;itemName:string;unitId:string;unitSymbol:string;deliveryMethod:QuarryDeliveryMethod;driverName:string;truckPlate:string;tripCount:number;totalQuantityCubicMetres:number;defaultQuantityCubicMetres:number;lastConfirmedAt:string};

export const emptyQuarryPurchaseDraft: QuarryPurchaseDraft = {
  supplierId: '', projectId:'', itemId: '', unitId:'unit_m3', quantityCubicMetres: '', deliveryMethod:'company',
  driverId: '', truckId: '', supplierTruckPlate:'', supplierTicketNumber: '', priceBasis:'per_unit', unitPriceUsd: '',
  vatMode:'company',customVatRatePercent:'',vatInclusive:false,notes: '', photos: [],
};

export function selectedVatRate(draft:Pick<QuarryPurchaseDraft,'vatMode'|'customVatRatePercent'>,companyVatRatePercent:number):number|null{
  if(draft.vatMode==='none')return 0;
  if(draft.vatMode==='company')return companyVatRatePercent;
  const rate=Number(draft.customVatRatePercent.trim().replace(',','.'));
  return Number.isFinite(rate)&&rate>=0&&rate<=100?rate:null;
}

export function calculateQuarryPurchase(draft: QuarryPurchaseDraft, companyVatRatePercent: number): QuarryCalculation {
  if (!draft.unitPriceUsd.trim()) return { subtotalUsd: null, vatRatePercent:null, vatAmountUsd: null, finalTotalUsd: null };
  const price = Number(draft.unitPriceUsd.replace(',', '.')); const quantity = Number(draft.quantityCubicMetres);
  const vatRatePercent=selectedVatRate(draft,companyVatRatePercent);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || quantity <= 0 || vatRatePercent===null) return { subtotalUsd: null, vatRatePercent:null, vatAmountUsd: null, finalTotalUsd: null };
  const quotedCents=Math.round((draft.priceBasis==='per_unit'?quantity*price:price)*100);
  if(draft.vatInclusive){
    const subtotalCents=Math.round(quotedCents/(1+vatRatePercent/100));
    return{subtotalUsd:subtotalCents/100,vatRatePercent,vatAmountUsd:(quotedCents-subtotalCents)/100,finalTotalUsd:quotedCents/100};
  }
  const vatCents=Math.round(quotedCents*vatRatePercent/100);
  return{subtotalUsd:quotedCents/100,vatRatePercent,vatAmountUsd:vatCents/100,finalTotalUsd:(quotedCents+vatCents)/100};
}

export function validateQuarryPurchase(draft: QuarryPurchaseDraft, setup: QuarrySetup): string[] {
  const issues: string[] = [];
  if (!setup.suppliers.some((value) => value.id === draft.supplierId)) issues.push('Select a supplier.');
  if (draft.projectId && !setup.projects.some((value) => value.id === draft.projectId)) issues.push('Select a valid project or clear the project field.');
  if (!setup.items.some((value) => value.id === draft.itemId)) issues.push('Select an item enabled for suppliers.');
  if (!setup.units.some((value) => value.id === draft.unitId)) issues.push('Select a measurement unit.');
  const quantity = Number(draft.quantityCubicMetres); if (!Number.isFinite(quantity) || quantity <= 0) issues.push('Quantity must be greater than zero.');
  if (draft.deliveryMethod==='company') {
    if (!setup.drivers.some((value) => value.id === draft.driverId)) issues.push('Select a driver.');
    if (!setup.trucks.some((value) => value.id === draft.truckId)) issues.push('Select a truck.');
  }
  if (draft.unitPriceUsd.trim()) {
    const priceText=draft.unitPriceUsd.trim().replace(',','.');
    if (!/^\d+(\.\d{1,2})?$/.test(priceText)) issues.push('Price must be zero or more with no more than two decimals.');
    if(selectedVatRate(draft,setup.vatRatePercent)===null)issues.push('Custom VAT must be between 0 and 100.');
  }
  return issues;
}

export function groupQuarryPurchases(purchases:QuarryPurchase[]):QuarrySupplierGroup[]{
  const suppliers=new Map<string,{id:string;name:string;purchases:QuarryPurchase[];projects:Map<string,QuarryProjectGroup>}>();
  for(const purchase of purchases){
    let supplier=suppliers.get(purchase.supplierId);
    if(!supplier){supplier={id:purchase.supplierId,name:purchase.supplierName,purchases:[],projects:new Map()};suppliers.set(purchase.supplierId,supplier);}
    supplier.purchases.push(purchase);
    const projectKey=purchase.projectId??'__unlinked__';let project=supplier.projects.get(projectKey);
    if(!project){project={id:purchase.projectId,name:purchase.projectName??'No project linked',purchases:[]};supplier.projects.set(projectKey,project);}
    project.purchases.push(purchase);
  }
  return [...suppliers.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(supplier=>({id:supplier.id,name:supplier.name,purchases:supplier.purchases,projectGroups:[...supplier.projects.values()].sort((a,b)=>a.id===null?1:b.id===null?-1:a.name.localeCompare(b.name))}));
}

export function quarryDailyCounters(purchases:QuarryPurchase[],workDate:string):QuarryDailyCounter[]{
  const counters=new Map<string,QuarryDailyCounter>();
  for(const purchase of purchases){
    if(purchase.status!=='Active'||localDate(purchase.confirmedAt)!==workDate)continue;
    const transportKey=purchase.deliveryMethod==='supplier'?`supplier:${purchase.truckPlate.trim().toLocaleLowerCase('en-US')}`:`company:${purchase.driverId}:${purchase.truckId}`;
    const key=[purchase.projectId??'',purchase.supplierId,purchase.itemId,purchase.unitId,transportKey].join('|');
    const current=counters.get(key);
    if(!current){counters.set(key,{key,sourcePurchaseId:purchase.id,supplierName:purchase.supplierName,projectName:purchase.projectName,itemName:purchase.itemName,unitId:purchase.unitId,unitSymbol:purchase.unitSymbol,deliveryMethod:purchase.deliveryMethod,driverName:purchase.driverName,truckPlate:purchase.truckPlate,tripCount:1,totalQuantityCubicMetres:purchase.quantityCubicMetres,defaultQuantityCubicMetres:purchase.quantityCubicMetres,lastConfirmedAt:purchase.confirmedAt});continue;}
    current.tripCount+=1;current.totalQuantityCubicMetres+=purchase.quantityCubicMetres;
    if(purchase.confirmedAt>current.lastConfirmedAt){current.sourcePurchaseId=purchase.id;current.defaultQuantityCubicMetres=purchase.quantityCubicMetres;current.lastConfirmedAt=purchase.confirmedAt;}
  }
  return [...counters.values()].sort((a,b)=>b.lastConfirmedAt.localeCompare(a.lastConfirmedAt));
}

function localDate(value:string){const date=new Date(value);return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
