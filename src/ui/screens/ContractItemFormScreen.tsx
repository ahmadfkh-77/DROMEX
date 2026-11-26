import {useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Alert,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {ContractFormSetup,ContractItemDetail,ContractQuantitiesRepository} from '../../data/repositories/ContractQuantitiesRepository';
import {contractChangeLines,contractHistoryLabel,contractTrackingMode,validateContractItemDraft,type ContractItemDraft,type ContractTrackingMode} from '../../domain/contractQuantities';
import {localDateKey} from '../../domain/fuel';
import type {Project} from '../../domain/loads';
import {AppButton,AppCard,AppField,AppPage,Feedback,PageHeader} from '../components/AppPrimitives';
import {GroupedSearchableSelect} from '../components/GroupedSearchableSelect';
import {SearchableSelect} from '../components/SearchableSelect';
import {contractDay} from '../components/contracts/ContractParts';
import {colors} from '../theme';

const emptyDraft:ContractItemDraft={name:'',unitId:'',quantity:'',unitPriceUsd:'',materialIds:[],trackingMode:'automatic'};

/** DEC-556 mockup tabs 1 and 2: how "used" is tracked. Chosen when the target is created; changing it later is a later phase. */
const MODES:{id:ContractTrackingMode;title:string;badge:string;text:string}[]=[
  {id:'automatic',title:'Calculated from loads',badge:'AUTOMATIC',text:'Used = the loads you link to this target, plus adjustments. Needs at least one material.'},
  {id:'linked_manual',title:'I enter it, material linked',badge:'LINKED MANUAL',text:'The unit you track on site differs from the delivered unit. You log used by hand; the material stays linked for reference.'},
  {id:'manual',title:'I enter it, no material',badge:'MANUAL',text:'Nothing in the Catalog to calculate from (for example Site clearance).'},
];

/**
 * DEC-522 Phase D1 (mockup tab 4). Add or edit a target: name, target quantity, unit, an optional price, and the Catalog
 * materials whose loads count, each with its usual unit beside the item's unit. Once loads or adjustments count, every edit needs a reason
 * and the old values stay in the history. A mistaken item is cancelled with a reason, never deleted.
 */
export function ContractItemFormScreen({project,contracts,contractItemId,onBack,onSaved}:{
  project:Project;contracts:ContractQuantitiesRepository;contractItemId:string|null;onBack:()=>void;onSaved:()=>void;
}){
  const[setup,setSetup]=useState<ContractFormSetup|null>(null);
  const[detail,setDetail]=useState<ContractItemDetail|null>(null);
  const[loadError,setLoadError]=useState<string|null>(null);
  const[draft,setDraft]=useState<ContractItemDraft>(emptyDraft);
  const[touched,setTouched]=useState(false);
  const[reason,setReason]=useState('');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[cancelling,setCancelling]=useState(false);
  const[cancelReason,setCancelReason]=useState('');

  useEffect(()=>{
    let active=true;
    Promise.all([contracts.getSetup(),contractItemId?contracts.getItem(contractItemId):Promise.resolve(null)]).then(([form,item])=>{
      if(!active)return;
      setSetup(form);setDetail(item);
      if(item)setDraft({name:item.item.name,unitId:item.item.unitId,quantity:String(item.item.quantity),unitPriceUsd:item.item.unitPriceUsd===null?'':item.item.unitPriceUsd.toFixed(2),materialIds:item.item.materialIds,trackingMode:contractTrackingMode(item.item)});
    }).catch(cause=>{if(active)setLoadError(cause instanceof Error?cause.message:'Could not open the target.');});
    return()=>{active=false;};
  },[contracts,contractItemId]);

  const change=(patch:Partial<ContractItemDraft>)=>{setDraft(current=>({...current,...patch}));setTouched(true);setError(null);};
  const mode=contractTrackingMode(draft);
  /** Manual has no material: choosing it clears any ticked material so the saved target is consistent. */
  const chooseMode=(next:ContractTrackingMode)=>change(next==='manual'?{trackingMode:next,materialIds:[]}:{trackingMode:next});
  const result=useMemo(()=>validateContractItemDraft(draft),[draft]);
  const unitSymbol=setup?.units.find(unit=>unit.id===draft.unitId)?.symbol??'';
  const names=useMemo(()=>Object.fromEntries((setup?.materials??[]).map(material=>[material.id,material.name])),[setup]);
  const changes=detail&&result.ok?contractChangeLines(detail.item,{...result.value,unitSymbol,materialIds:[...result.value.materialIds].sort()},names):[];
  const editing=Boolean(detail);
  const cancelled=Boolean(detail?.item.cancelledAt);
  const needsReason=editing&&Boolean(detail?.editNeedsReason);
  const canSave=!busy&&!cancelled&&result.ok&&(!editing||(changes.length>0&&(!needsReason||reason.trim().length>0)));
  const groups=useMemo(()=>{
    const byCategory=new Map<string,{id:string;label:string;options:{id:string;label:string;detail?:string}[]}>();
    for(const material of setup?.materials??[]){
      if(draft.materialIds.includes(material.id))continue;
      const group=byCategory.get(material.categoryName)??{id:material.categoryName,label:material.categoryName,options:[]};
      group.options.push({id:material.id,label:material.name,detail:material.unitSymbol?`Usually in ${material.unitSymbol}`:undefined});
      byCategory.set(material.categoryName,group);
    }
    return [...byCategory.values()];
  },[setup,draft.materialIds]);

  async function save(){
    setBusy(true);setError(null);
    try{
      if(detail)await contracts.editItem(detail.item.id,draft,reason);else await contracts.createItem(project.id,draft);
      onSaved();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not save the target.');}finally{setBusy(false);}
  }
  function confirmCancel(){
    if(!detail)return;
    if(!cancelReason.trim()){setError('Enter the reason for cancelling this target.');return;}
    Alert.alert('Cancel this target?','It stays in the history, keeps its loads listed, and is left out of the project totals. This cannot be undone.',[
      {text:'Keep it',style:'cancel'},
      {text:'Cancel target',style:'destructive',onPress:()=>{setBusy(true);setError(null);contracts.cancelItem(detail.item.id,cancelReason).then(onSaved).catch(cause=>setError(cause instanceof Error?cause.message:'Could not cancel the target.')).finally(()=>setBusy(false));}},
    ]);
  }

  const title=detail?detail.item.name:'Target';
  if(loadError)return <AppPage><PageHeader eyebrow={project.name} title={title} onBack={onBack}/><Feedback kind="error">{loadError}</Feedback></AppPage>;
  if(!setup||(contractItemId&&!detail))return <AppPage><PageHeader eyebrow={project.name} title={title} onBack={onBack}/><View style={styles.center}><ActivityIndicator size="large" color={colors.brand}/></View></AppPage>;

  const showErrors=touched&&!result.ok;
  const mismatched=draft.materialIds.map(id=>setup.materials.find(material=>material.id===id)).filter(material=>material&&draft.unitId&&material.unitId&&material.unitId!==draft.unitId);

  return <AppPage keyboard>
    <PageHeader eyebrow={editing?'Edit':project.name} title={title} onBack={onBack}/>
    {cancelled?<Feedback kind="warning">This target was cancelled. It stays in the history and is left out of the totals.</Feedback>:null}
    {showErrors?<Feedback kind="error">{result.errors.join('\n')}</Feedback>:null}
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppCard>
      <AppField label="Name *" value={draft.name} onChangeText={name=>change({name})} placeholder="For example Base course" editable={!cancelled}/>
      <View style={styles.row}>
        <View style={styles.flex}><AppField label="Target quantity *" value={draft.quantity} onChangeText={quantity=>change({quantity})} keyboardType="decimal-pad" editable={!cancelled}/></View>
        <View style={styles.flex}><SearchableSelect label="Unit *" options={setup.units.map(unit=>({id:unit.id,label:unit.symbol,detail:unit.name}))} selectedId={draft.unitId} onSelect={unitId=>change({unitId})} placeholder="Choose"/></View>
      </View>
      <AppField label={`Target price per unit, USD${unitSymbol?` / ${unitSymbol}`:''} (optional)`} value={draft.unitPriceUsd} onChangeText={unitPriceUsd=>change({unitPriceUsd})} keyboardType="decimal-pad" placeholder="Not set" editable={!cancelled}/>
    </AppCard>

    <AppCard title="How is “used” tracked?" hint={editing?'Chosen when the target was created. Changing it comes in a later phase.':undefined}>
      {MODES.filter(option=>!editing||option.id===mode).map(option=>{
        const on=option.id===mode;
        return <TouchableOpacity key={option.id} style={[styles.mode,on&&styles.modeOn]} onPress={()=>chooseMode(option.id)} disabled={editing||cancelled} accessibilityRole="radio" accessibilityState={{checked:on,disabled:editing||cancelled}} accessibilityLabel={`${option.title}, ${option.badge}`}>
          <View style={styles.radio}>{on?<View style={styles.radioDot}/>:null}</View>
          <View style={styles.flex}><Text style={styles.modeTitle}>{option.title}  <Text style={[styles.badge,option.id==='manual'?styles.badgeManual:option.id==='linked_manual'?styles.badgeLinked:styles.badgeAuto]}> {option.badge} </Text></Text><Text style={styles.helper}>{option.text}</Text></View>
        </TouchableOpacity>;
      })}
      {mode==='manual'?<Text style={styles.quiet}>No material is linked. Used is the sum of the entries you log. After saving, open the target and tap Log used quantity to record what was done each day.</Text>:null}
    </AppCard>

    {mode!=='manual'?<AppCard title={mode==='linked_manual'?'Materials (for reference)':'Materials that count'} hint={mode==='linked_manual'?'Ticking a material does not calculate used. Its delivered quantity is shown beside used, in its own unit.':"The Catalog materials whose loads can count toward this item. Each shows its usual unit beside the item's unit. Tap a material to take it off."}>
      {draft.materialIds.length?draft.materialIds.map(id=>{
        const material=setup.materials.find(value=>value.id===id);
        const materialUnit=material?.unitSymbol??null,same=Boolean(material?.unitId&&material.unitId===draft.unitId);
        return <TouchableOpacity key={id} style={styles.material} onPress={()=>change({materialIds:draft.materialIds.filter(value=>value!==id)})} disabled={cancelled} accessibilityRole="checkbox" accessibilityState={{checked:true}} accessibilityLabel={`${material?.name??id}, take off`}>
          <View style={[styles.box,styles.boxOn]}><Text style={styles.tick}>✓</Text></View>
          <View style={styles.flex}><Text style={styles.materialName}>{material?.name??'Material no longer in the Catalog'}</Text><Text style={styles.helper}>{material?.categoryName??''}</Text></View>
          <View style={styles.units}><Text style={[styles.unit,!same&&materialUnit&&draft.unitId?styles.unitBad:null]}>{materialUnit??'no usual unit'}{draft.unitId&&materialUnit?` ${same?'=':'≠'} ${unitSymbol}`:''}</Text><Text style={styles.unitHint}>material · item</Text></View>
        </TouchableOpacity>;
      }):<Text style={styles.helper}>None ticked yet.</Text>}
      {mismatched.map(material=>mode==='linked_manual'
        ?<Text key={material!.id} style={styles.amber}><Text style={styles.bold}>Two units.</Text> {material!.name} is delivered in {material!.unitSymbol}; this target is used in {unitSymbol}. Nothing is converted and the loads do not count. You log {unitSymbol} by hand.</Text>
        :<Text key={material!.id} style={styles.amber}><Text style={styles.bold}>{material!.name} is usually in {material!.unitSymbol}.</Text> Its loads in {material!.unitSymbol} will be listed as "not counted, unit differs". Only loads recorded in {unitSymbol} count. Nothing is converted.</Text>)}
      {!cancelled?<GroupedSearchableSelect label="Add a material" groups={groups} selectedId="" onSelect={id=>change({materialIds:[...draft.materialIds,id]})} placeholder="Search all Catalog materials"/>:null}
    </AppCard>:null}

    {editing&&changes.length?<Text style={styles.quiet}>Changed: {changes.join(' · ')}.</Text>:null}
    {needsReason&&changes.length?<AppCard>
      <AppField label="Reason for the change *" value={reason} onChangeText={setReason} placeholder="For example Variation order VO-03 approved"/>
      <Text style={styles.helper}>Required because loads or adjustments already count. The old values stay in the history.</Text>
    </AppCard>:null}
    {!cancelled?<AppButton label={editing?'Save change':'Save target'} onPress={()=>void save()} disabled={!canSave} busy={busy}/>:null}

    {detail?<AppCard title="History">
      {detail.history.map(line=><View key={line.id} style={styles.history}>
        <Text style={styles.historyTitle}>{contractDay(localDateKey(new Date(line.createdAt)))} · {contractHistoryLabel(line.kind)}</Text>
        {line.reason?<Text style={styles.helper}>{line.reason}</Text>:null}
      </View>)}
    </AppCard>:null}

    {detail&&!cancelled?(cancelling?<AppCard title="Cancel this target" hint="It stays in the history with its loads listed, and is left out of the project totals.">
      <AppField label="Reason *" value={cancelReason} onChangeText={setCancelReason} placeholder="For example Created by mistake"/>
      <AppButton label="Cancel target" tone="danger" onPress={confirmCancel} busy={busy}/>
      <AppButton label="Keep it" tone="secondary" onPress={()=>{setCancelling(false);setCancelReason('');}}/>
    </AppCard>:<AppButton label="Cancel this target" tone="secondary" onPress={()=>setCancelling(true)}/>):null}
  </AppPage>;
}

const styles=StyleSheet.create({
  center:{alignItems:'center',paddingVertical:30},
  row:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  bold:{fontWeight:'800'},
  material:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8,borderTopWidth:1,borderTopColor:'#EEE9DF'},
  box:{width:26,height:26,borderRadius:7,borderWidth:2,borderColor:colors.navy,alignItems:'center',justifyContent:'center'},
  boxOn:{backgroundColor:colors.navy},
  tick:{color:'#FFF',fontWeight:'900'},
  materialName:{color:colors.ink,fontSize:14,fontWeight:'800'},
  units:{alignItems:'flex-end',gap:3},
  unit:{color:colors.navy,backgroundColor:'#E8EDF3',fontSize:12,fontWeight:'800',borderRadius:8,paddingHorizontal:8,paddingVertical:3,overflow:'hidden'},
  unitBad:{color:colors.danger,backgroundColor:'#FDECEA'},
  unitHint:{color:colors.muted,fontSize:10,fontWeight:'700'},
  mode:{flexDirection:'row',alignItems:'flex-start',gap:10,borderWidth:2,borderColor:'#E1DBCF',borderRadius:14,padding:10,marginTop:6},
  modeOn:{borderColor:colors.navy,backgroundColor:'#F1F5FA'},
  radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:colors.navy,alignItems:'center',justifyContent:'center',marginTop:2},
  radioDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.navy},
  modeTitle:{color:colors.ink,fontSize:14,fontWeight:'800'},
  badge:{fontSize:10,fontWeight:'900',color:'#FFF',overflow:'hidden'},
  badgeAuto:{backgroundColor:'#1E7B4B'},badgeLinked:{backgroundColor:'#B7791F'},badgeManual:{backgroundColor:'#D9571F'},
  amber:{backgroundColor:'#FFF4DC',borderColor:'#EFC979',borderWidth:1,borderRadius:12,padding:10,color:'#5E3A00',fontSize:13,lineHeight:19,overflow:'hidden'},
  quiet:{backgroundColor:'#EEF2F6',borderColor:'#D3DDE7',borderWidth:1,borderRadius:12,padding:10,color:'#24384D',fontSize:13,lineHeight:19,overflow:'hidden'},
  history:{paddingVertical:8,borderTopWidth:1,borderTopColor:'#EEE9DF',gap:2},
  historyTitle:{color:colors.ink,fontSize:14,fontWeight:'800'},
});
