import {useEffect,useState} from 'react';
import {ActivityIndicator,StyleSheet,Text,View} from 'react-native';

import type {BusinessDocumentRepository} from '../../../data/repositories/BusinessDocumentRepository';
import {documentKindInfo,documentKinds,formatDocumentNumber,type DocumentKind,type DocumentSettings} from '../../../domain/businessDocuments';
import {AppButton,AppField,AppPage,Feedback,PageHeader} from '../../components/AppPrimitives';
import {colors} from '../../theme';

type TextKey='legalName'|'tradingName'|'address'|'phone'|'email'|'website'|'taxRegistrationNumber'|'companyRegistrationNumber'|'bankDetails'|'paymentTerms'|'footerNote';
const identity:[TextKey,string,boolean?][]=[['legalName','Legal or business name'],['tradingName','Trading name'],['address','Business address',true],['phone','Phone'],['email','Email'],['website','Website'],['taxRegistrationNumber','Tax / VAT registration number'],['companyRegistrationNumber','Company registration number']];
const termsFields:[TextKey,string,boolean?][]=[['paymentTerms','Payment terms (for example: Net 30)'],['bankDetails','Bank and payment instructions',true],['footerNote','Footer or legal note',true]];

/**
 * DEC-487 (4). Reusable business details for Official Bills / Invoices, with per-document overrides on
 * each draft. Nothing here is invented: an empty field reads Not configured and prints nothing. Company
 * Settings fill in where a field here is empty.
 */
export function BusinessDocumentSettingsScreen({documents,onBack,onOpenSigners}:{documents:BusinessDocumentRepository;onBack:()=>void;onOpenSigners:()=>void}){
  const year=new Date().getFullYear();
  const[settings,setSettings]=useState<DocumentSettings|null>(null);
  const[values,setValues]=useState<Record<TextKey,string>>({} as Record<TextKey,string>);
  const[prefixes,setPrefixes]=useState<Record<DocumentKind,string>>({} as Record<DocumentKind,string>);
  const[next,setNext]=useState<Record<DocumentKind,string>>({} as Record<DocumentKind,string>);
  const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  const apply=(loaded:DocumentSettings)=>{
    setSettings(loaded);
    setValues(Object.fromEntries([...identity,...termsFields].map(([key])=>[key,loaded[key]??''])) as Record<TextKey,string>);
    setPrefixes({...loaded.prefixes});
    setNext(Object.fromEntries(documentKinds.map(kind=>[kind,String(loaded.nextNumbers[kind])])) as Record<DocumentKind,string>);
  };
  useEffect(()=>{documents.getSettings(year).then(apply).catch(cause=>setError(cause instanceof Error?cause.message:'Settings could not be loaded.'));},[documents,year]);

  const save=async()=>{
    if(!settings)return;setBusy(true);setError(null);setMessage(null);
    try{
      const saved=await documents.saveSettings({...settings,...values,prefixes:Object.fromEntries(documentKinds.map(kind=>[kind,prefixes[kind].trim().toUpperCase()])) as Record<DocumentKind,string>});
      for(const kind of documentKinds){const wanted=Number(next[kind]);if(wanted!==saved.nextNumbers[kind])await documents.setNextDocumentNumber(kind,year,wanted);}
      apply(await documents.getSettings(year));setMessage('Business document settings saved. Issued documents keep the details they were issued with.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Settings could not be saved.');}finally{setBusy(false);}
  };

  if(!settings)return <AppPage><PageHeader eyebrow="DOCUMENT SETTINGS" title="Business documents" onBack={onBack}/>{error?<Feedback kind="error">{error}</Feedback>:<ActivityIndicator color={colors.brand}/>}</AppPage>;
  const fallback:Partial<Record<TextKey,string|null>>={legalName:settings.company.name,address:settings.company.address,phone:settings.company.phone,email:settings.company.email,taxRegistrationNumber:settings.company.taxVatNumber};

  return <AppPage keyboard>
    <PageHeader eyebrow="DOCUMENT SETTINGS" title="Business documents" onBack={onBack}/>
    <Text style={styles.lead}>Used on Official Bills and Invoices. You can override any of it on a single draft. DROMEX provides the fields; you remain responsible for local legal and tax requirements.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {message?<Feedback kind="success">{message}</Feedback>:null}

    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Your business</Text>
      {identity.map(([key,label,multiline])=><View key={key} style={styles.field}>
        <AppField label={label} value={values[key]} onChangeText={value=>setValues(current=>({...current,[key]:value}))} multiline={multiline}/>
        {!values[key]?.trim()?<Text style={styles.state}>{fallback[key]?`Not set here — Company Settings gives “${fallback[key]}”`:'Not configured — left off documents'}</Text>:null}
      </View>)}
      <Text style={styles.helper}>The company logo from Company Settings prints on documents. Each issued document keeps the logo it was issued with.</Text>
    </View>

    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Terms</Text>
      {termsFields.map(([key,label,multiline])=><View key={key} style={styles.field}>
        <AppField label={label} value={values[key]} onChangeText={value=>setValues(current=>({...current,[key]:value}))} multiline={multiline}/>
        {!values[key]?.trim()?<Text style={styles.state}>Not configured — left off documents</Text>:null}
      </View>)}
      <View style={styles.currency}><Text style={styles.currencyLabel}>Currency</Text><Text style={styles.currencyValue}>USD</Text><Text style={styles.helper}>Every DROMEX amount is recorded in US dollars, so documents state USD. Other currencies are not supported yet.</Text></View>
    </View>

    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Numbering in {year}</Text>
      <Text style={styles.helper}>Numbers are given when a document is issued, never reused, and the next number can only move forward.</Text>
      {documentKinds.map(kind=><View key={kind} style={styles.numbering}>
        <Text style={styles.kindLabel}>{documentKindInfo[kind].mode==='internal'?`Internal ${documentKindInfo[kind].label.toLocaleLowerCase('en-US')}`:`Official ${documentKindInfo[kind].label}`}</Text>
        <View style={styles.numberRow}>
          <View style={styles.prefix}><AppField label="Prefix" value={prefixes[kind]} onChangeText={value=>setPrefixes(current=>({...current,[kind]:value.toUpperCase()}))} autoCapitalize="characters" maxLength={6}/></View>
          <View style={styles.prefix}><AppField label="Next number" value={next[kind]} onChangeText={value=>setNext(current=>({...current,[kind]:value.replace(/\D/g,'')}))} keyboardType="number-pad" maxLength={6}/></View>
        </View>
        <Text style={styles.preview}>Next: {formatDocumentNumber(prefixes[kind]||'—',year,Number(next[kind])||1)}</Text>
      </View>)}
    </View>

    <AppButton label="Save settings" onPress={()=>void save()} busy={busy}/>
    <AppButton label="Authorized signers" tone="secondary" onPress={onOpenSigners} hint="Saved names, titles and signatures for documents"/>
  </AppPage>;
}

const styles=StyleSheet.create({
  lead:{color:'#4F5B66',fontSize:14,lineHeight:20},
  helper:{color:'#4F5B66',fontSize:13,lineHeight:19},
  panel:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:'#E3DBCD',padding:16,gap:12},
  panelTitle:{color:colors.ink,fontSize:17,fontWeight:'800'},
  field:{gap:4},
  state:{color:'#5A6570',fontSize:12,fontStyle:'italic'},
  currency:{gap:2,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,paddingTop:10},
  currencyLabel:{color:colors.ink,fontSize:13,fontWeight:'800'},
  currencyValue:{color:colors.navy,fontSize:17,fontWeight:'800'},
  numbering:{gap:6,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,paddingTop:10},
  kindLabel:{color:colors.navy,fontSize:14,fontWeight:'700'},
  numberRow:{flexDirection:'row',gap:10},
  prefix:{flex:1,minWidth:0},
  preview:{color:colors.ink,fontSize:14,fontWeight:'700',fontVariant:['tabular-nums']},
});
