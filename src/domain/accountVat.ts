/**
 * VAT choice. Anything new starts with No VAT. When VAT is wanted, the owner picks Universal (the rate set once in Company Settings) or
 * Own % (a rate typed for that account or record). A customer or supplier account holds this choice and a new record starts from it; the
 * owner can still change it on a single record. A saved record keeps the rate and amount it was saved with, so changing the universal
 * rate or an account later never changes it.
 */
export type VatMode='none'|'universal'|'custom';
/** What an account stores. `ratePercent` is only used by Own %. */
export type AccountVat={mode:VatMode;ratePercent:number|null};
/** What a VAT control sends, for an account or a record: the rate is text so the form can show what was typed. */
export type VatChoice={mode:VatMode;ratePercent:string};
export type AccountVatDraft=VatChoice;

export const noAccountVat:AccountVat={mode:'none',ratePercent:null};
export const noVatChoice:VatChoice={mode:'none',ratePercent:''};
export const emptyAccountVatDraft:AccountVatDraft=noVatChoice;
export const vatModeLabels:Record<VatMode,string>={none:'No VAT',universal:'Universal',custom:'Own %'};

const MODES:readonly string[]=['none','universal','custom'];

/** The setting as the database stores it: a mode, and the rate in basis points (11% is 1100) for Own % only. */
export function accountVatFromRow(mode:string|null|undefined,basisPoints:number|null|undefined):AccountVat{
  if(mode==='universal')return {mode:'universal',ratePercent:null};
  if(mode==='custom'&&basisPoints!=null)return {mode:'custom',ratePercent:basisPoints/100};
  return noAccountVat;
}

/** The form's choice for a saved account. */
export const accountVatDraft=(vat:AccountVat):VatChoice=>({mode:vat.mode,ratePercent:vat.mode==='custom'&&vat.ratePercent!=null?String(vat.ratePercent):''});

/** Checks a choice. No VAT and Universal need no rate; Own % needs a rate from 0 to 100 with at most two decimals. */
export function validateAccountVat(draft:VatChoice|undefined|null):AccountVat{
  if(!draft||!MODES.includes(draft.mode)||draft.mode==='none')return noAccountVat;
  if(draft.mode==='universal')return {mode:'universal',ratePercent:null};
  const text=draft.ratePercent.trim().replace(',','.');
  const rate=Number(text);
  if(!text||!/^\d+(\.\d{1,2})?$/.test(text)||!Number.isFinite(rate)||rate<0||rate>100)throw new Error('VAT must be a percentage from 0 to 100.');
  return {mode:'custom',ratePercent:rate};
}

export const accountVatBasisPoints=(vat:AccountVat):number|null=>vat.mode==='custom'&&vat.ratePercent!=null?Math.round(vat.ratePercent*100):null;
export const accountVatLabel=(vat:AccountVat,universalRatePercent?:number):string=>
  vat.mode==='universal'?(universalRatePercent==null?'Universal VAT':`Universal ${universalRatePercent}%`):vat.mode==='custom'&&vat.ratePercent!=null?`VAT ${vat.ratePercent}%`:'No VAT';

/**
 * The VAT percentage a choice means: 0 for No VAT (no VAT is added and no VAT line shows), the Company Settings rate for Universal, the typed
 * rate for Own %. A bad Own % rate counts as 0 here; the form's own check reports it before anything is saved.
 */
export function resolveVatRate(choice:VatChoice|AccountVat|null|undefined,universalRatePercent:number):number{
  if(!choice||choice.mode==='none')return 0;
  if(choice.mode==='universal')return universalRatePercent>0?universalRatePercent:0;
  const rate=typeof choice.ratePercent==='number'?choice.ratePercent:Number(String(choice.ratePercent).trim().replace(',','.'));
  return Number.isFinite(rate)&&rate>0&&rate<=100?rate:0;
}

/** The choice a new record starts with: the account's setting, or No VAT when there is none. */
export const startingVatChoice=(vat:AccountVat|null|undefined):VatChoice=>vat?accountVatDraft(vat):noVatChoice;
/** The VAT percentage a new record starts with. */
export const startingVatRate=(vat:AccountVat|null|undefined,universalRatePercent:number):number=>resolveVatRate(vat,universalRatePercent);

/** The choice that describes a saved record's rate, for showing it on a form: 0 is No VAT, the universal rate is Universal, any other is Own %. */
export function choiceForRate(ratePercent:number|null|undefined,universalRatePercent:number):VatChoice{
  if(!ratePercent||ratePercent<=0)return noVatChoice;
  if(universalRatePercent>0&&Math.abs(ratePercent-universalRatePercent)<0.0001)return {mode:'universal',ratePercent:''};
  return {mode:'custom',ratePercent:String(ratePercent)};
}
