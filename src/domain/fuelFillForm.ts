import type {FuelBatchTracking,FuelDestinationType,FuelFillDraft} from './fuel';
import type {BatchDetail,FillCost,TankFillPreviewResult} from './fuelBatches';

/**
 * DEC-505, Screen B. The wording and numbers of the Record Fill form and its "Before you save" panel,
 * kept apart from the screen so they can be tested and so every fuel screen prints litres the same way.
 */
const group=(digits:string)=>digits.replace(/\B(?=(\d{3})+(?!\d))/g,',');

/** Every quantity shows its unit, thousands separators and at most one decimal; a negative uses a real minus sign. */
export function formatLitres(value:number):string{
  const rounded=Math.round(Math.abs(value)*10)/10;
  const [whole='0',decimals]=String(rounded).split('.');
  return `${value<0&&rounded>0?'−':''}${group(whole)}${decimals?`.${decimals}`:''} L`;
}

export function formatMoney(value:number):string{
  const [whole='0',decimals='00']=Math.abs(value).toFixed(2).split('.');
  return `${value<0?'−':''}$${group(whole)}.${decimals}`;
}

/** Money for a priced fill, money plus the unpriced litres when only part is priced, and Unpriced otherwise. Never $0.00. */
export function costSummaryLabel(cost:FillCost):string{
  if(cost.costUsd==null)return 'Unpriced';
  return cost.fullyPriced?formatMoney(cost.costUsd):`${formatMoney(cost.costUsd)} + ${formatLitres(cost.unpricedLitres)} Unpriced`;
}

/** `station`: bought outside the tank. `tank_batch`: diesel from the tank once batches are tracked. `tank_plain`: as before batches, and gasoline. */
export type FillFormKind='station'|'tank_batch'|'tank_plain';

export function fillFormKind(draft:Pick<FuelFillDraft,'fuelSource'|'fuelType'>,tracking:FuelBatchTracking):FillFormKind{
  if(draft.fuelSource==='station')return 'station';
  if((draft.fuelType??'diesel')==='gasoline')return 'tank_plain';
  return tracking.started?'tank_batch':'tank_plain';
}

export function fillFormHelper(kind:FillFormKind):string{
  if(kind==='tank_batch')return 'Diesel from the tank is taken from the oldest batch first.';
  if(kind==='station')return 'Fuel bought at a station. It is kept for history and does not change the tank.';
  return 'Record the fuel put into this equipment.';
}

export function fillFormReady(draft:Pick<FuelFillDraft,'litres'|'equipmentId'|'stationId'>,kind:FillFormKind):boolean{
  return draft.litres.trim()!==''&&draft.equipmentId.trim()!==''&&(kind!=='station'||Boolean(draft.stationId?.trim()));
}

export function batchOptionDetail(batch:Pick<BatchDetail,'status'|'remainingLitres'|'kind'>):string{
  const lead=batch.status==='in_use'?'Oldest open batch':'Waiting';
  return `${lead} · ${formatLitres(batch.remainingLitres)} remaining${batch.kind==='opening'?' · Opening stock':''}`;
}

/** The open batches a fill may be taken from, oldest first, each with its invoice and the litres left. */
export function openBatchOptions(batches:BatchDetail[]):{id:string;label:string;detail:string}[]{
  return batches.filter(batch=>batch.status==='in_use'||batch.status==='waiting')
    .map(batch=>({id:batch.id,label:`${batch.batchNumber} · Invoice ${batch.invoiceNumber??'not recorded'}`,detail:batchOptionDetail(batch)}));
}

export type PreviewLine={label:string;value:string;kind:'portion'|'total'|'detail'|'alert';note?:string};

export function tankFillPreviewLines(preview:TankFillPreviewResult,totalLitres:number):PreviewLine[]{
  const lines:PreviewLine[]=preview.portions.map((portion):PreviewLine=>({
    label:`From ${portion.batchNumber}`,
    note:portion.closesBatch?`uses the last ${formatLitres(portion.litres)} · batch closes`:portion.statusBefore==='waiting'?'becomes the batch in use':`${formatLitres(portion.remainingAfterLitres)} left in this batch`,
    value:formatLitres(portion.litres),kind:'portion',
  }));
  if(preview.shortfallLitres>0)lines.push({label:'No diesel left in any open batch',note:'still saved, with an Overfill Alert',value:formatLitres(preview.shortfallLitres),kind:'alert'});
  const suffix=preview.portions.length>1?' · shown as one fill, split':preview.shortfallLitres>0&&preview.portions.length>0?' · shown as one fill':'';
  lines.push({label:`Total fill${suffix}`,value:formatLitres(totalLitres),kind:'total'});
  lines.push({label:'Tank after this fill',value:`${formatLitres(preview.tankBeforeLitres)} → ${formatLitres(preview.tankAfterLitres)}`,kind:'detail'});
  lines.push({label:'Cost',value:costSummaryLabel(preview.cost),kind:'detail'});
  return lines;
}

export function overfillMessage(preview:Pick<TankFillPreviewResult,'shortfallLitres'|'overfillAlert'>):string|null{
  if(!preview.overfillAlert||preview.shortfallLitres<=0)return null;
  return `Overfill Alert: this fill is ${formatLitres(preview.shortfallLitres)} more than all the diesel recorded in the tank. It will still be saved, and the alert stays until a delivery or a dip reading resolves it.`;
}

export function stationFillPreviewLines(input:{stationName:string;litres:number;tankLitres:number;equipmentName:string;destinationType:FuelDestinationType}):PreviewLine[]{
  const counts=input.destinationType==='project'?`${input.equipmentName} · project fuel · Daily Report`:input.destinationType==='company_site'?`${input.equipmentName} · company site fuel · Daily Report`:`${input.equipmentName} · equipment fuel history`;
  return [
    {label:`Outside station · ${input.stationName}`,value:formatLitres(input.litres),kind:'total'},
    {label:'Tank',value:`No change (${formatLitres(input.tankLitres)})`,kind:'detail'},
    {label:'Counts in',value:counts,kind:'detail'},
  ];
}
