import type { DriverProfile, Project, TruckProfile } from './loads';

export type Supplier = { id: string; name: string; phone: string | null; email: string | null; address: string | null; taxVatNumber: string | null; notes: string | null; isActive: boolean };
export type SupplierDraft = { name: string; phone?: string; email?: string; address?: string; taxVatNumber?: string; notes?: string };
export type QuarryItem = { id: string; name: string; internalCode: string | null; categoryName: string };
export type QuarrySetup = { suppliers: Supplier[]; projects: Project[]; items: QuarryItem[]; drivers: DriverProfile[]; trucks: TruckProfile[]; vatRatePercent: number };
export type QuarryPurchaseDraft = { supplierId: string; projectId: string; itemId: string; quantityCubicMetres: string; driverId: string; truckId: string; supplierTicketNumber: string; unitPriceUsd: string; notes: string; photos: string[] };
export type QuarryCorrectionDraft = Pick<QuarryPurchaseDraft,'quantityCubicMetres'|'driverId'|'truckId'|'supplierTicketNumber'|'unitPriceUsd'|'notes'>;
export type QuarryCalculation = { subtotalUsd: number | null; vatAmountUsd: number | null; finalTotalUsd: number | null };
export type QuarryPurchase = { id: string; purchaseNumber: string; confirmedAt: string; supplierId:string; supplierName: string; projectId:string|null;projectName:string|null; itemId:string; itemName: string; itemCode: string | null; categoryName: string; quantityCubicMetres: number; driverId:string; driverName: string; truckId:string; truckPlate: string; supplierTicketNumber: string | null; unitPriceUsd: number | null; subtotalUsd: number | null; vatRatePercent: number | null; vatAmountUsd: number | null; finalTotalUsd: number | null; paymentStatus: 'Unpriced' | 'No Payment Due' | 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overpaid'; notes: string | null; photos: string[];status:'Active'|'Cancelled';cancellationReason:string|null;cancelledAt:string|null };
export type QuarryProjectGroup={id:string|null;name:string;purchases:QuarryPurchase[]};
export type QuarrySupplierGroup={id:string;name:string;purchases:QuarryPurchase[];projectGroups:QuarryProjectGroup[]};
export type QuarryDailyCounter={key:string;sourcePurchaseId:string;supplierName:string;projectName:string|null;itemName:string;driverName:string;truckPlate:string;tripCount:number;totalQuantityCubicMetres:number;defaultQuantityCubicMetres:number;lastConfirmedAt:string};

export const emptyQuarryPurchaseDraft: QuarryPurchaseDraft = { supplierId: '', projectId:'', itemId: '', quantityCubicMetres: '', driverId: '', truckId: '', supplierTicketNumber: '', unitPriceUsd: '', notes: '', photos: [] };

export function calculateQuarryPurchase(draft: QuarryPurchaseDraft, vatRatePercent: number): QuarryCalculation {
  if (!draft.unitPriceUsd.trim()) return { subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
  const price = Number(draft.unitPriceUsd.replace(',', '.')); const quantity = Number(draft.quantityCubicMetres);
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity <= 0) return { subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
  const subtotalCents = Math.round(quantity * price * 100); const vatCents = Math.round(subtotalCents * vatRatePercent / 100);
  return { subtotalUsd: subtotalCents / 100, vatAmountUsd: vatCents / 100, finalTotalUsd: (subtotalCents + vatCents) / 100 };
}

export function validateQuarryPurchase(draft: QuarryPurchaseDraft, setup: QuarrySetup): string[] {
  const issues: string[] = [];
  if (!setup.suppliers.some((value) => value.id === draft.supplierId)) issues.push('Select a quarry / supplier.');
  if (draft.projectId && !setup.projects.some((value) => value.id === draft.projectId)) issues.push('Select a valid project or clear the project field.');
  if (!setup.items.some((value) => value.id === draft.itemId)) issues.push('Select an item enabled for quarry purchases.');
  const quantity = Number(draft.quantityCubicMetres); if (!Number.isInteger(quantity) || quantity <= 0) issues.push('Quantity must be a positive whole number of cubic metres.');
  if (!setup.drivers.some((value) => value.id === draft.driverId)) issues.push('Select a driver.');
  if (!setup.trucks.some((value) => value.id === draft.truckId)) issues.push('Select a truck.');
  if (draft.unitPriceUsd.trim()) { const priceText=draft.unitPriceUsd.trim().replace(',','.');const price = Number(priceText); if (!/^\d+(\.\d{1,2})?$/.test(priceText)||!Number.isFinite(price) || price < 0) issues.push('Price per m³ must be zero or more with no more than two decimals.'); }
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
    const key=[purchase.projectId??'',purchase.supplierId,purchase.itemId,purchase.driverId,purchase.truckId].join('|');
    const current=counters.get(key);
    if(!current){counters.set(key,{key,sourcePurchaseId:purchase.id,supplierName:purchase.supplierName,projectName:purchase.projectName,itemName:purchase.itemName,driverName:purchase.driverName,truckPlate:purchase.truckPlate,tripCount:1,totalQuantityCubicMetres:purchase.quantityCubicMetres,defaultQuantityCubicMetres:purchase.quantityCubicMetres,lastConfirmedAt:purchase.confirmedAt});continue;}
    current.tripCount+=1;current.totalQuantityCubicMetres+=purchase.quantityCubicMetres;
    if(purchase.confirmedAt>current.lastConfirmedAt){current.sourcePurchaseId=purchase.id;current.defaultQuantityCubicMetres=purchase.quantityCubicMetres;current.lastConfirmedAt=purchase.confirmedAt;}
  }
  return [...counters.values()].sort((a,b)=>b.lastConfirmedAt.localeCompare(a.lastConfirmedAt));
}

function localDate(value:string){const date=new Date(value);return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
