import {useEffect,useState} from 'react';
import {Alert,Image,StyleSheet,Text,View} from 'react-native';

import type {CompanyHeaderRepository} from '../../data/repositories/CompanyHeaderRepository';
import type {DocumentSignerRepository} from '../../data/repositories/DocumentSignerRepository';
import type {ProfileRepository} from '../../data/repositories/ProfileRepository';
import {projectCompanyState,validateProjectCompanyDraft,type ProjectCompanyProfile} from '../../domain/companyHeaders';
import type {DocumentSigner} from '../../domain/documentSigners';
import type {Customer} from '../../domain/profiles';
import {pickPersistentImage} from '../../services/media';
import {AppButton,AppCard,AppField,AppPage,Feedback,PageHeader} from '../components/AppPrimitives';
import {HeaderSignerField,type HeaderSignerValue} from '../components/HeaderSignerField';
import {SearchableSelect} from '../components/SearchableSelect';
import {colors} from '../theme';

/**
 * Settings › Company setups › Project Company. Chooses which EXISTING customer is the project owner and
 * adds header details to it. The link never renames, moves, merges or changes the customer or any record.
 */
export function ProjectCompanyScreen({profiles,headers,signers,onBack,initialCustomerId}:{profiles:ProfileRepository;headers:CompanyHeaderRepository;signers:DocumentSignerRepository;onBack:()=>void;
  /** Opened from a customer's page: that customer starts selected. */initialCustomerId?:string|null}){
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[customers,setCustomers]=useState<Customer[]>([]);
  const[signerList,setSignerList]=useState<DocumentSigner[]>([]);
  const[existing,setExisting]=useState<ProjectCompanyProfile|null>(null);
  const[customerId,setCustomerId]=useState('');
  const[logoUri,setLogoUri]=useState<string|null>(null);
  const[address,setAddress]=useState('');const[phone,setPhone]=useState('');const[email,setEmail]=useState('');
  const[taxVatNumber,setTaxVatNumber]=useState('');const[registrationNumber,setRegistrationNumber]=useState('');const[footer,setFooter]=useState('');
  const[signer,setSigner]=useState<HeaderSignerValue>({signerId:null,display:null});
  const[error,setError]=useState<string|null>(null);const[saved,setSaved]=useState<string|null>(null);const[busy,setBusy]=useState(false);

  useEffect(()=>{
    let active=true;
    Promise.all([profiles.listCustomers(),signers.listSigners(),headers.getProjectCompany()]).then(([allCustomers,allSigners,profile])=>{
      if(!active)return;
      setCustomers(allCustomers);setSignerList(allSigners);setExisting(profile);
      if(profile){setCustomerId(profile.customerId);setLogoUri(profile.logoUri);setAddress(profile.address??'');setPhone(profile.phone??'');setEmail(profile.email??'');setTaxVatNumber(profile.taxVatNumber??'');setRegistrationNumber(profile.registrationNumber??'');setFooter(profile.receiptFooter??'');setSigner({signerId:profile.signerId,display:profile.signerDisplay});}
      // DEC-507. With nothing saved yet, the Owner's own-company customer is the one to link (it receives the plant's materials).
      if(!profile){const own=allCustomers.find(value=>value.isOwnCompany&&value.isActive);const first=initialCustomerId&&allCustomers.some(value=>value.id===initialCustomerId)?initialCustomerId:own?.id;if(first)setCustomerId(first);}
      else if(initialCustomerId&&allCustomers.some(value=>value.id===initialCustomerId))setCustomerId(initialCustomerId);
      setStatus('ready');
    }).catch(()=>{if(active)setStatus('error');});
    return()=>{active=false;};
  },[profiles,headers,signers,initialCustomerId]);

  const customerOptions=customers
    .filter(value=>value.isActive||value.id===customerId)
    .map(value=>({id:value.id,label:value.isOwnCompany?`${value.name} (Own company)`:value.name,detail:value.isActive?undefined:'Archived'}));
  const state=projectCompanyState(existing);

  async function save(){
    const draft={customerId,logoUri,address,phone,email,taxVatNumber,registrationNumber,receiptFooter:footer,signerId:signer.signerId,signerDisplay:signer.display};
    const issue=validateProjectCompanyDraft(draft)[0];
    if(issue){setSaved(null);setError(issue);return;}
    setBusy(true);setError(null);setSaved(null);
    try{const profile=await headers.saveProjectCompany(draft);setExisting(profile);setCustomerId(profile.customerId);setSaved('Project Company saved. No customer or record was changed.');}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not save the Project Company.');}
    finally{setBusy(false);}
  }
  function remove(){
    Alert.alert('Remove Project Company setup?','This only deletes the header details and the link. The customer and all records stay untouched, and PDFs fall back to the Plant Company header.',[
      {text:'Keep it',style:'cancel'},
      {text:'Remove setup',style:'destructive',onPress:()=>{setBusy(true);setError(null);setSaved(null);
        void headers.removeProjectCompany().then(()=>{setExisting(null);setCustomerId('');setLogoUri(null);setAddress('');setPhone('');setEmail('');setTaxVatNumber('');setRegistrationNumber('');setFooter('');setSigner({signerId:null,display:null});setSaved('Project Company setup removed. No customer or record was changed.');})
          .catch(cause=>setError(cause instanceof Error?cause.message:'Could not remove the setup.')).finally(()=>setBusy(false));}},
    ]);
  }

  return <AppPage keyboard>
    <PageHeader eyebrow="COMPANY SETUPS" title="Project Company" onBack={onBack}/>
    {status==='loading'?<Text style={styles.helper}>Loading the Project Company…</Text>:null}
    {status==='error'?<Feedback kind="error">The Project Company could not be loaded. Go back and try again.</Feedback>:null}
    {status==='ready'?<>
      {error?<Feedback kind="error">{error}</Feedback>:null}
      {saved?<Feedback kind="success">{saved}</Feedback>:null}
      {state==='customer_archived'?<Feedback kind="warning">The linked customer is archived. The header still prints from the saved details. Records are unaffected.</Feedback>:null}
      <AppCard title="Which customer is it?" hint="The project owner is one of your existing customers, including your own company. Choosing it only adds header details to that customer.">
        <SearchableSelect label="Customer *" options={customerOptions} selectedId={customerId} onSelect={setCustomerId} placeholder={customerOptions.length?'Search and select a customer':'Create a customer first'}/>
        <Text style={styles.helper}>The link never renames, moves, merges or changes the customer, its loads, payments or projects. If the customer is renamed later, the header follows its new name.</Text>
      </AppCard>
      <AppCard title="Header details" hint="Used only when you choose Project Company as the header on a PDF.">
        <View style={styles.logoPanel}>
          <View style={styles.logoHeading}><View style={styles.flex}><Text style={styles.logoTitle}>Company logo</Text><Text style={styles.helper}>Optional.</Text></View><Text style={[styles.logoStatus,!!logoUri&&styles.logoStatusReady]}>{logoUri?'READY':'OPTIONAL'}</Text></View>
          {logoUri?<Image source={{uri:logoUri}} style={styles.logoPreview} resizeMode="contain"/>:<View style={styles.logoEmpty}><Text style={styles.logoMonogram}>P</Text><Text style={styles.logoEmptyText}>No logo selected</Text></View>}
          <View style={styles.logoActions}><View style={styles.logoAction}><AppButton label={logoUri?'Replace Logo':'Choose Logo'} tone="secondary" onPress={()=>void pickPersistentImage('company').then(uri=>{if(uri)setLogoUri(uri);}).catch(cause=>setError(cause instanceof Error?cause.message:'Could not select the logo.'))}/></View>{logoUri?<View style={styles.logoAction}><AppButton label="Remove Logo" tone="danger" onPress={()=>setLogoUri(null)}/></View>:null}</View>
        </View>
        <AppField label="Address" value={address} onChangeText={setAddress} multiline/>
        <AppField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad"/>
        <AppField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"/>
        <AppField label="Tax / VAT registration number" value={taxVatNumber} onChangeText={setTaxVatNumber}/>
        <AppField label="Company registration number" value={registrationNumber} onChangeText={setRegistrationNumber}/>
        <AppField label="Footer text" value={footer} onChangeText={setFooter} multiline/>
      </AppCard>
      <AppCard title="Default signer" hint="Chosen from Authorized signers. Optional: with no signer, the signature area is simply left off this header.">
        <HeaderSignerField signers={signerList} value={signer} onChange={setSigner}/>
      </AppCard>
      <AppButton label="Save Project Company" busy={busy} onPress={()=>void save()}/>
      {existing?<><AppButton label="Remove Project Company Setup" tone="danger" disabled={busy} onPress={remove}/><Text style={styles.helper}>Removing the setup only deletes the header details. The customer and all records stay untouched.</Text></>:null}
    </>:null}
  </AppPage>;
}

const styles=StyleSheet.create({
  helper:{color:colors.muted,fontSize:13,lineHeight:19},flex:{flex:1,minWidth:0},
  logoPanel:{borderWidth:1,borderColor:colors.line,borderRadius:13,backgroundColor:'#FCFBF8',padding:13,gap:12},
  logoHeading:{flexDirection:'row',alignItems:'flex-start',gap:10},logoTitle:{color:colors.ink,fontSize:15,fontWeight:'900'},
  logoStatus:{color:colors.muted,backgroundColor:'#EEEAE3',borderRadius:10,paddingHorizontal:8,paddingVertical:5,overflow:'hidden',fontSize:9,fontWeight:'900',letterSpacing:.7},logoStatusReady:{color:colors.success,backgroundColor:'#E5F3EC'},
  logoPreview:{width:'100%',height:110,backgroundColor:'#FFF',borderRadius:10},
  logoEmpty:{minHeight:100,borderWidth:1,borderStyle:'dashed',borderColor:colors.line,borderRadius:10,alignItems:'center',justifyContent:'center',gap:6,backgroundColor:colors.surface},
  logoMonogram:{width:38,height:38,borderRadius:19,textAlign:'center',textAlignVertical:'center',color:'#FFF',backgroundColor:colors.navy,fontSize:21,fontWeight:'900',overflow:'hidden'},logoEmptyText:{color:colors.muted,fontSize:12,fontWeight:'700'},
  logoActions:{flexDirection:'row',flexWrap:'wrap',gap:8},logoAction:{flexGrow:1,minWidth:135},
});
