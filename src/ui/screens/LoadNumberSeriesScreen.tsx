import {useCallback,useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';

import type {CatalogRepository} from '../../data/repositories/CatalogRepository';
import type {LoadNumberSeriesRepository} from '../../data/repositories/LoadNumberSeriesRepository';
import type {CatalogItem} from '../../domain/catalog';
import {normalizeSeriesPrefix,validateSeriesDraft,type LoadNumberSeries,type LoadNumberSeriesDraft} from '../../domain/loadNumberSeries';
import {AppButton,AppField,AppPage,Feedback,PageHeader} from '../components/AppPrimitives';
import {FocusedSheet,SheetActions} from '../components/FocusedSheet';
import {colors} from '../theme';

type Editing={id:string|null;draft:LoadNumberSeriesDraft;prefixLocked:boolean;isDefault:boolean};

/**
 * DEC-487 (6). Company Load Number Series. Unassigned items use the default LOAD series; an item can
 * be given its own series, or several items can share one counter. Every change affects future loads
 * only: numbers already given never change and are never reused.
 */
export function LoadNumberSeriesScreen({repository,catalog,onBack}:{repository:LoadNumberSeriesRepository;catalog:CatalogRepository;onBack:()=>void}){
  const[series,setSeries]=useState<LoadNumberSeries[]|null>(null);
  const[items,setItems]=useState<CatalogItem[]>([]);
  const[editing,setEditing]=useState<Editing|null>(null);
  const[itemSearch,setItemSearch]=useState('');
  const[sheetError,setSheetError]=useState<string|null>(null);
  const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{try{const [list,all]=await Promise.all([repository.listSeries(),catalog.listItems()]);setSeries(list);setItems(all.filter(item=>item.usageAreas.includes('loads')));}catch(cause){setError(cause instanceof Error?cause.message:'Series could not be loaded.');setSeries(current=>current??[]);}},[repository,catalog]);
  useEffect(()=>{void refresh();},[refresh]);

  const itemName=useMemo(()=>new Map(items.map(item=>[item.id,item.name])),[items]);
  const owner=useMemo(()=>{const map=new Map<string,LoadNumberSeries>();for(const value of series??[])for(const id of value.itemIds)map.set(id,value);return map;},[series]);
  const assignedElsewhere=new Set((series??[]).filter(value=>!value.isDefault).flatMap(value=>value.itemIds));
  const unassigned=items.filter(item=>!assignedElsewhere.has(item.id));

  const save=async()=>{
    if(!editing||!series)return;
    const issues=validateSeriesDraft(editing.draft,series,editing.id??undefined);if(issues.length){setSheetError(issues.join('\n'));return;}
    setBusy(true);setSheetError(null);
    try{if(editing.id)await repository.updateSeries(editing.id,editing.draft);else await repository.createSeries(editing.draft);setEditing(null);await refresh();setMessage('Saved. Future loads use this setup; numbers already given are unchanged.');}
    catch(cause){setSheetError(cause instanceof Error?cause.message:'The series could not be saved.');}finally{setBusy(false);}
  };
  const toggleActive=(value:LoadNumberSeries)=>Alert.alert(value.isActive?`Deactivate ${value.prefix}?`:`Activate ${value.prefix}?`,
    value.isActive?`Its items will use the default series for future loads until you activate it again. Numbers already given keep ${value.prefix}.`:'Its assigned items will use it again for future loads.',
    [{text:'Keep as is',style:'cancel'},{text:value.isActive?'Deactivate':'Activate',onPress:()=>{setBusy(true);repository.setSeriesActive(value.id,!value.isActive).then(refresh).then(()=>setMessage(value.isActive?'Series deactivated for future loads.':'Series active again.')).catch(cause=>setError(cause instanceof Error?cause.message:'That did not work.')).finally(()=>setBusy(false));}}]);

  if(!series)return <AppPage><PageHeader eyebrow="SETUP" title="Load number series" onBack={onBack}/><ActivityIndicator color={colors.brand}/></AppPage>;
  const visibleItems=items.filter(item=>item.name.toLocaleLowerCase().includes(itemSearch.trim().toLocaleLowerCase()));

  return <AppPage keyboard>
    <PageHeader eyebrow="SETUP" title="Load number series" onBack={onBack}/>
    <Text style={styles.lead}>Every company load gets a number like LOAD-2026-001 when it is confirmed. Give an item its own series, or let several items share one counter. Numbering restarts each year.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    <AppButton label="Add series" disabled={busy} onPress={()=>{setSheetError(null);setItemSearch('');setEditing({id:null,draft:{prefix:'',displayName:'',itemIds:[]},prefixLocked:false,isDefault:false});}}/>
    <View style={styles.list}>
      {series.map(value=><View key={value.id} style={[styles.card,!value.isActive&&styles.cardOff]}>
        <View style={styles.cardTop}>
          <View style={styles.prefix}><Text style={styles.prefixText}>{value.prefix}</Text></View>
          <View style={styles.flex}><Text style={styles.name}>{value.displayName}</Text><Text style={styles.meta}>{value.isDefault?'Default series':value.isActive?'Active':'Inactive — its items use the default'} · {value.issuedCount} number{value.issuedCount===1?'':'s'} given</Text></View>
        </View>
        <Text style={styles.next}>Next: <Text style={styles.nextValue}>{value.nextNumber}</Text></Text>
        <Text style={styles.items}>{value.isDefault?(unassigned.length?`Used by every item without its own series: ${unassigned.map(item=>item.name).join(', ')}`:'Every load item has its own series.')
          :value.itemIds.length?`Items: ${value.itemIds.map(id=>itemName.get(id)??'Inactive item').join(', ')}`:'No items assigned yet.'}</Text>
        <View style={styles.actions}>
          <Pressable style={styles.quiet} disabled={busy} onPress={()=>{setSheetError(null);setItemSearch('');setEditing({id:value.id,draft:{prefix:value.prefix,displayName:value.displayName,itemIds:[...value.itemIds]},prefixLocked:value.prefixLocked,isDefault:value.isDefault});}} accessibilityRole="button" accessibilityLabel={`Edit ${value.prefix}`}><Text style={styles.quietText}>Edit</Text></Pressable>
          {!value.isDefault?<Pressable style={styles.quiet} disabled={busy} onPress={()=>toggleActive(value)} accessibilityRole="button"><Text style={styles.quietText}>{value.isActive?'Deactivate':'Activate'}</Text></Pressable>:null}
        </View>
      </View>)}
    </View>
    <Text style={styles.helper}>Loads confirmed before series existed keep no number and read “Legacy load — no generated load number”. Load numbers are separate from transaction numbers, receipts, invoices and bills.</Text>

    <FocusedSheet visible={!!editing} eyebrow={editing?.id?'EDIT SERIES':'NEW SERIES'} title={editing?.draft.prefix?normalizeSeriesPrefix(editing.draft.prefix):'Series'} onClose={()=>setEditing(null)}
      footer={<SheetActions primaryLabel="Save series" busy={busy} onCancel={()=>setEditing(null)} onPrimary={()=>void save()}/>}>
      {editing?<>
        {sheetError?<Feedback kind="error">{sheetError}</Feedback>:null}
        {editing.prefixLocked?<View style={styles.locked}><Text style={styles.lockedLabel}>Prefix</Text><Text style={styles.prefixText}>{editing.draft.prefix}</Text><Text style={styles.helper}>Locked: loads already carry this prefix.</Text></View>
          :<AppField label="Prefix * (2 to 5 letters)" value={editing.draft.prefix} onChangeText={prefix=>setEditing({...editing,draft:{...editing.draft,prefix:prefix.toUpperCase().replace(/[^A-Z]/g,'')}})} autoCapitalize="characters" maxLength={5}/>}
        <AppField label="Display name *" value={editing.draft.displayName} onChangeText={displayName=>setEditing({...editing,draft:{...editing.draft,displayName}})} maxLength={60} placeholder="Asphalt, Aggregates…"/>
        <Text style={styles.preview}>Numbers will look like {normalizeSeriesPrefix(editing.draft.prefix)||'ABC'}-{new Date().getFullYear()}-001</Text>
        {editing.isDefault?<Text style={styles.helper}>The default series is used by every item that has no series of its own. It cannot be deactivated.</Text>:<>
          <Text style={styles.sheetTitle}>Items using this series</Text>
          <Text style={styles.helper}>An item belongs to one series. Choosing an item that is in another series moves it here.</Text>
          <TextInput style={styles.search} value={itemSearch} onChangeText={setItemSearch} placeholder="Find an item" placeholderTextColor="#6B7681" accessibilityLabel="Find an item"/>
          <View style={styles.chips}>
            {visibleItems.map(item=>{const on=editing.draft.itemIds.includes(item.id);const other=owner.get(item.id);const elsewhere=other&&other.id!==editing.id&&!other.isDefault;
              return <Pressable key={item.id} onPress={()=>setEditing({...editing,draft:{...editing.draft,itemIds:on?editing.draft.itemIds.filter(id=>id!==item.id):[...editing.draft.itemIds,item.id]}})}
                style={[styles.chip,on&&styles.chipOn]} accessibilityRole="checkbox" accessibilityState={{checked:on}} accessibilityLabel={`${item.name}${elsewhere&&!on?`, now in ${other.prefix}`:''}`}>
                <Text style={[styles.chipText,on&&styles.chipTextOn]}>{on?'✓ ':''}{item.name}</Text>{elsewhere&&!on?<Text style={styles.chipNote}>now in {other.prefix}</Text>:null}
              </Pressable>;})}
          </View>
          {!items.length?<Text style={styles.helper}>No items are enabled for company loads yet. Enable Loads on an item in the Item catalog.</Text>:null}
        </>}
      </>:null}
    </FocusedSheet>
  </AppPage>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  lead:{color:'#4F5B66',fontSize:14,lineHeight:20},
  helper:{color:'#4F5B66',fontSize:13,lineHeight:19},
  list:{gap:10},
  card:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:'#D9CFBE',padding:14,gap:8},
  cardOff:{backgroundColor:'#F7F4EE'},
  cardTop:{flexDirection:'row',alignItems:'center',gap:12},
  prefix:{minWidth:56,height:46,paddingHorizontal:8,borderRadius:13,backgroundColor:'#E8F0F6',alignItems:'center',justifyContent:'center'},
  prefixText:{color:colors.navy,fontSize:17,fontWeight:'900',letterSpacing:.5},
  name:{color:colors.ink,fontSize:16,fontWeight:'700'},
  meta:{color:'#4F5B66',fontSize:12,marginTop:1},
  next:{color:'#4F5B66',fontSize:13},
  nextValue:{color:colors.ink,fontWeight:'800',fontVariant:['tabular-nums']},
  items:{color:'#4F5B66',fontSize:13,lineHeight:19},
  actions:{flexDirection:'row',gap:4},
  quiet:{minHeight:48,justifyContent:'center',paddingHorizontal:10},
  quietText:{color:colors.brandDark,fontSize:14,fontWeight:'700'},
  locked:{gap:4,backgroundColor:'#F7F4EE',borderRadius:12,padding:12},
  lockedLabel:{color:colors.ink,fontSize:13,fontWeight:'800'},
  preview:{color:colors.navy,fontSize:14,fontWeight:'700',fontVariant:['tabular-nums']},
  sheetTitle:{color:colors.ink,fontSize:16,fontWeight:'800',marginTop:6},
  search:{minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,backgroundColor:'#FCFBF8',color:colors.ink,fontSize:15},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:8},
  chip:{minHeight:48,justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:12,paddingHorizontal:12,paddingVertical:6,backgroundColor:colors.surface,maxWidth:'100%'},
  chipOn:{borderColor:colors.navy,borderWidth:2,backgroundColor:'#F4F7FB'},
  chipText:{color:colors.ink,fontSize:14,fontWeight:'600'},
  chipTextOn:{color:colors.navy,fontWeight:'800'},
  chipNote:{color:colors.warning,fontSize:11,fontWeight:'600'},
});
