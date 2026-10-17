import {useState} from 'react';
import {Text,View} from 'react-native';

import {accountVatDraft,accountVatLabel,type AccountVat,type AccountVatDraft,type VatChoice,type VatMode} from '../../domain/accountVat';
import {AppButton,AppCard,AppField,Feedback} from './AppPrimitives';
import {SegmentedChoice} from './SegmentedChoice';
import {colors} from '../theme';

/**
 * The VAT choice, used on a customer or supplier account and on a single record: No VAT (what everything starts as), Universal (the rate set
 * once in Company Settings) or Own % (a rate typed here). It only decides the VAT of what it is placed on; a saved record keeps its own.
 */
export function VatChoiceControl({value,onChange,universalRatePercent,label='VAT',hint}:{value:VatChoice;onChange:(next:VatChoice)=>void;universalRatePercent:number;label?:string;hint?:string}){
  const universal=universalRatePercent>0?`Universal ${universalRatePercent}%`:'Universal';
  return <View style={{gap:8}}>
    <SegmentedChoice label={label} options={[{id:'none',label:'No VAT'},{id:'universal',label:universal},{id:'custom',label:'Own %'}]} selectedId={value.mode} onSelect={(mode:VatMode)=>onChange({...value,mode})} hint={hint}/>
    {value.mode==='universal'&&universalRatePercent<=0?<Text style={{color:colors.warning,fontSize:12}}>The Universal rate is 0%. Set it in Company Settings.</Text>:null}
    {value.mode==='custom'?<AppField label="VAT rate (%) *" value={value.ratePercent} onChangeText={ratePercent=>onChange({...value,ratePercent})} keyboardType="decimal-pad" placeholder="For example 5"/>:null}
  </View>;
}

/** The same control under its account name, for the supplier forms. */
export const AccountVatControl=VatChoiceControl;

/** A card with the account VAT choice and its own Save, for a saved customer. */
export function AccountVatCard({vat,universalRatePercent,busy,onSave}:{vat:AccountVat;universalRatePercent:number;busy:boolean;onSave:(draft:AccountVatDraft)=>Promise<void>}){
  const[draft,setDraft]=useState<AccountVatDraft>(()=>accountVatDraft(vat));
  const[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false);
  const saving=accountVatDraft(vat);
  const changed=draft.mode!==saving.mode||(draft.mode==='custom'&&draft.ratePercent.trim().replace(',','.')!==saving.ratePercent);
  return <AppCard title="Account VAT" hint="New records for this account start with this choice. Every account starts as No VAT. You can still change VAT on a single record, and records already saved keep their VAT.">
    <Text style={{color:colors.muted,fontSize:12}}>Now: {accountVatLabel(vat,universalRatePercent)}</Text>
    <VatChoiceControl value={draft} onChange={next=>{setDraft(next);setSaved(false);setError(null);}} universalRatePercent={universalRatePercent}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}{saved&&!changed?<Feedback kind="success">VAT setting saved.</Feedback>:null}
    <AppButton label="Save VAT setting" busy={busy} disabled={!changed} onPress={()=>{setError(null);void onSave(draft).then(()=>setSaved(true)).catch(cause=>setError(cause instanceof Error?cause.message:'The VAT setting could not be saved.'));}}/>
  </AppCard>;
}
