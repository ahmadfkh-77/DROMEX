export type FuelMovementType='gauge'|'delivery'|'fill';
export type FuelMovementStatus='Active'|'Cancelled';
export type FuelOption={id:string;name:string;detail?:string};
export type FuelSetup={suppliers:FuelOption[];equipment:FuelOption[];projects:FuelOption[];vatRatePercent:number};
export type FuelMovement={id:string;type:FuelMovementType;confirmedAt:string;litres:number;previousBalanceLitres:number|null;differenceLitres:number|null;supplierId:string|null;supplierName:string|null;equipmentId:string|null;equipmentName:string|null;projectId:string|null;projectName:string|null;ticketNumber:string|null;odometerReading:string|null;reason:string|null;notes:string|null;pricePerLitreUsd:number|null;subtotalUsd:number|null;vatRatePercent:number|null;vatAmountUsd:number|null;finalTotalUsd:number|null;paymentStatus:string;status:FuelMovementStatus;cancellationReason:string|null;cancelledAt:string|null;balanceAfterLitres:number};
export type FuelOverview={currentBalanceLitres:number;latestGauge:FuelMovement|null;movements:FuelMovement[]};
export type FuelDeliveryDraft={litres:string;supplierId:string;ticketNumber:string;pricePerLitreUsd:string;notes:string};
export type FuelFillDraft={litres:string;equipmentId:string;projectId:string;odometerReading:string;notes:string};
export type FuelGaugeDraft={actualLitres:string;reason:string;notes:string};
export const emptyFuelDelivery:FuelDeliveryDraft={litres:'',supplierId:'',ticketNumber:'',pricePerLitreUsd:'',notes:''};
export const emptyFuelFill:FuelFillDraft={litres:'',equipmentId:'',projectId:'',odometerReading:'',notes:''};
export const emptyFuelGauge:FuelGaugeDraft={actualLitres:'',reason:'',notes:''};

const decimal=(value:string)=>Number(value.trim().replace(',','.'));
const decimalFormat=(value:string)=>/^\d+([.,]\d+)?$/.test(value.trim());
export function validatePositiveLitres(value:string):number{const parsed=decimal(value);if(!decimalFormat(value)||!Number.isFinite(parsed)||parsed<=0)throw new Error('Litres must be a number greater than zero.');return parsed;}
export function validateGaugeLitres(value:string):number{const parsed=decimal(value);if(!decimalFormat(value)||!Number.isFinite(parsed)||parsed<0)throw new Error('Actual gauge litres must be a number zero or greater.');return parsed;}
export function calculateFuelDelivery(litres:number,priceText:string,vatRatePercent:number){if(!priceText.trim())return{pricePerLitreUsd:null,subtotalUsd:null,vatAmountUsd:null,finalTotalUsd:null};const price=decimal(priceText);if(!Number.isFinite(price)||price<0||!/^[0-9]+([.,][0-9]{1,2})?$/.test(priceText.trim()))throw new Error('Price per litre must be zero or greater with no more than two decimals.');const subtotal=Math.round(litres*price*100)/100;const vat=Math.round(subtotal*vatRatePercent)/100;return{pricePerLitreUsd:price,subtotalUsd:subtotal,vatAmountUsd:vat,finalTotalUsd:Math.round((subtotal+vat)*100)/100};}

export function applyFuelLedger(movements:Omit<FuelMovement,'balanceAfterLitres'>[]):FuelMovement[]{let balance=0;return [...movements].sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt)).map(movement=>{let previousBalanceLitres=movement.previousBalanceLitres;let differenceLitres=movement.differenceLitres;if(movement.status==='Active'){if(movement.type==='gauge'){previousBalanceLitres=balance;differenceLitres=movement.litres-balance;balance=movement.litres;}else if(movement.type==='delivery')balance+=movement.litres;else balance-=movement.litres;}return{...movement,previousBalanceLitres,differenceLitres,balanceAfterLitres:balance};});}
