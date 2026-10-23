import {useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Alert,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {ContractFormSetup,ContractItemDetail,ContractQuantitiesRepository} from '../../data/repositories/ContractQuantitiesRepository';
import {contractChangeLines,contractHistoryLabel,validateContractItemDraft,type ContractItemDraft} from '../../domain/contractQuantities';
import {localDateKey} from '../../domain/fuel';
import type {Project} from '../../domain/loads';
import {AppButton,AppCard,AppField,AppPage,Feedback,PageHeader} from '../components/AppPrimitives';
import {GroupedSearchableSelect} from '../components/GroupedSearchableSelect';
import {SearchableSelect} from '../components/SearchableSelect';
import {contractDay} from '../components/contracts/ContractParts';
import {colors} from '../theme';

const emptyDraft:ContractItemDraft={name:'',unitId:'',quantity:'',unitPriceUsd:'',materialIds:[]};

/**
 * DEC-522 Phase D1 (mockup tab 4). Add or edit a contract item: name, contract quantity, unit, an optional price, and the Catalog
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
      if(item)setDraft({name:item.item.name,unitId:item.item.unitId,quantity:String(item.item.quantity),unitPriceUsd:item.item.unitPriceUsd===null?'':item.item.unitPriceUsd.toFixed(2),materialIds:item.item.materialIds});
    }).catch(cause=>{if(active)setLoadError(cause instanceof Error?cause.message:'Could not open the contract item.');});
    return()=>{active=false;};
  },[contracts,contractItemId]);

  const change=(patch:Partial<ContractItemDraft>)=>{setDraft(current=>({...current,...patch}));setTouched(true);setError(null);};
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
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not save the contract item.');}finally{setBusy(false);}
  }
  function confirmCancel(){
    if(!detail)return;
    if(!cancelReason.trim()){setError('Enter the reason for cancelling this contract item.');return;}
    Alert.alert('Cancel this contract item?','It stays in the history, keeps its loads listed, and is left out of the project totals. This cannot be undone.',[
      {text:'Keep it',style:'cancel'},
      {text:'Cancel contract item',style:'destructive',onPress:()=>{setBusy(true);setError(null);contracts.cancelItem(detail.item.id,cancelReason).then(onSaved).catch(cause=>setError(cause instanceof Error?cause.message:'Could not cancel the contract item.')).finally(()=>setBusy(false));}},
    ]);
  }

  const title=detail?detail.item.name:'Contract item';
  if(loadError)return <AppPage><PageHeader eyebrow={project.name} title={title} onBack={onBack}/><Feedback kind="error">{loadError}</Feedback></AppPage>;
  if(!setup||(contractItemId&&!detail))return <AppPage><PageHeader eyebrow={project.name} title={title} onBack={onBack}/><View style={styles.center}><ActivityIndicator size="large" color={colors.brand}/></View></AppPage>;

  const showErrors=touched&&!result.ok;
  const mismatched=draft.materialIds.map(id=>setup.materials.find(material=>material.id===id)).filter(material=>material&&draft.unitId&&material.unitId&&material.unitId!==draft.unitId);

  return <AppPage keyboard>
    <PageHeader eyebrow={editing?'Edit':project.name} title={title} onBack={onBack}/>
    {cancelled?<Feedback kind="warning">This contract item was cancelled. It stays in the history and is left out of the totals.</Feedback>:null}
    {showErrors?<Feedback kind="error">{result.errors.join('\n')}</Feedback>:null}
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppCard>
      <AppField label="Name *" value={draft.name} onChangeText={name=>change({name})} placeholder="For example Base course" editable={!cancelled}/>
      <View style={styles.row}>
        <View style={styles.flex}><AppField label="Contract quantity *" value={draft.quantity} onChangeText={quantity=>change({quantity})} keyboardType="decimal-pad" editable={!cancelled}/></View>
        <View style={styles.flex}><SearchableSelect label="Unit *" options={setup.units.map(unit=>({id:unit.id,label:unit.symbol,detail:unit.name}))} selectedId={draft.unitId} onSelect={unitId=>change({unitId})} placeholder="Choose"/></View>
      </View>
      <AppField label={`Contract price per unit, USD${unitSymbol?` / ${unitSymbol}`:''} (optional)`} value={draft.unitPriceUsd} onChangeText={unitPriceUsd=>change({unitPriceUsd})} keyboardType="decimal-pad" placeholder="Not set" editable={!cancelled}/>
    </AppCard>

    <AppCard title="Materials that count" hint="The Catalog materials whose loads can count toward this item. Each shows its usual unit beside the item's unit. Tap a material to take it off.">
      {draft.materialIds.length?draft.materialIds.map(id=>{
        const material=setup.materials.find(value=>value.id===id);
        const materialUnit=material?.unitSymbol??null,same=Boolean(material?.unitId&&material.unitId===draft.unitId);
        return <TouchableOpacity key={id} style={styles.material} onPress={()=>change({materialIds:draft.materialIds.filter(value=>value!==id)})} disabled={cancelled} accessibilityRole="checkbox" accessibilityState={{checked:true}} accessibilityLabel={`${material?.name??id}, take off`}>
          <View style={[styles.box,styles.boxOn]}><Text style={styles.tick}>✓</Text></View>
          <View style={styles.flex}><Text style={styles.materialName}>{material?.name??'Material no longer in the Catalog'}</Text><Text style={styles.helper}>{material?.categoryName??''}</Text></View>
          <View style={styles.units}><Text style={[styles.unit,!same&&materialUnit&&draft.unitId?styles.unitBad:null]}>{materialUnit??'no usual unit'}{draft.unitId&&materialUnit?` ${same?'=':'≠'} ${unitSymbol}`:''}</Text><Text style={styles.unitHint}>material · item</Text></View>
        </TouchableOpacity>;
      }):<Text style={styles.helper}>None ticked yet.</Text>}
      {mismatched.map(material=><Text key={material!.id} style={styles.amber}><Text style={styles.bold}>{material!.name} is usually in {material!.unitSymbol}.</Text> Its loads in {material!.unitSymbol} will be listed as "not counted, unit differs". Only loads recorded in {unitSymbol} count. Nothing is converted.</Text>)}
      {!cancelled?<GroupedSearchableSelect label="Add a material" groups={groups} selectedId="" onSelect={id=>change({materialIds:[...draft.materialIds,id]})} placeholder="Search all Catalog materials"/>:null}
    </AppCard>

    {editing&&changes.length?<Text style={styles.quiet}>Changed: {changes.join(' · ')}.</Text>:null}
    {needsReason&&changes.length?<AppCard>
      <AppField label="Reason for the change *" value={reason} onChangeText={setReason} placeholder="For example Variation order VO-03 approved"/>
      <Text style={styles.helper}>Required because loads or adjustments already count. The old values stay in the history.</Text>
    </AppCard>:null}
    {!cancelled?<AppButton label={editing?'Save change':'Save contract item'} onPress={()=>void save()} disabled={!canSave} busy={busy}/>:null}

    {detail?<AppCard title="History">
      {detail.history.map(line=><View key={line.id} style={styles.history}>
        <Text style={styles.historyTitle}>{contractDay(localDateKey(new Date(line.createdAt)))} · {contractHistoryLabel(line.kind)}</Text>
        {line.reason?<Text style={styles.helper}>{line.reason}</Text>:null}
      </View>)}
    </AppCard>:null}

    {detail&&!cancelled?(cancelling?<AppCard title="Cancel this contract item" hint="It stays in the history with its loads listed, and is left out of the project totals.">
      <AppField label="Reason *" value={cancelReason} onChangeText={setCancelReason} placeholder="For example Created by mistake"/>
      <AppButton label="Cancel contract item" tone="danger" onPress={confirmCancel} busy={busy}/>
      <AppButton label="Keep it" tone="secondary" onPress={()=>{setCancelling(false);setCancelReason('');}}/>
    </AppCard>:<AppButton label="Cancel this contract item" tone="secondary" onPress={()=>setCancelling(true)}/>):null}
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
  amber:{backgroundColor:'#FFF4DC',borderColor:'#EFC979',borderWidth:1,borderRadius:12,padding:10,color:'#5E3A00',fontSize:13,lineHeight:19,overflow:'hidden'},
  quiet:{backgroundColor:'#EEF2F6',borderColor:'#D3DDE7',borderWidth:1,borderRadius:12,padding:10,color:'#24384D',fontSize:13,lineHeight:19,overflow:'hidden'},
  history:{paddingVertical:8,borderTopWidth:1,borderTopColor:'#EEE9DF',gap:2},
  historyTitle:{color:colors.ink,fontSize:14,fontWeight:'800'},
});
