import {useCallback,useEffect,useMemo,useState} from 'react';
import {loadNumberLabel} from '../../domain/loadNumberSeries';
import {Alert,LayoutAnimation,ScrollView,StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';
import type {LoadRepository} from '../../data/repositories/LoadRepository';
import type {DocumentSignerRepository} from '../../data/repositories/DocumentSignerRepository';
import type {ConfirmedLoad} from '../../domain/loads';
import {AppButton,AppCard,Feedback,PageHeader} from '../components/AppPrimitives';
import {LoadCorrectionForm} from '../components/LoadCorrectionForm';
import {SearchableSelect} from '../components/SearchableSelect';
import {CollapsibleFilterCard} from '../components/CollapsibleFilterCard';
import {useReducedMotion} from '../components/ExpandableMenu';
import {colors} from '../theme';

type GroupMode='project'|'customer';
type Stage='browse'|'blocked'|'edit';

const localDate=(value:string)=>{const date=new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const unique=(values:string[])=>[...new Set(values)].sort((a,b)=>a.localeCompare(b));

export function LoadCorrectionsScreen({repository,onBack,initialLoadId,signers}:{repository:LoadRepository;onBack:()=>void;initialLoadId?:string|null;
  /** Phase 4. Saved signers for re-signing the supplier signature. */
  signers?:DocumentSignerRepository}){
  const reducedMotion=useReducedMotion();
  const[loads,setLoads]=useState<ConfirmedLoad[]>([]);const[selected,setSelected]=useState<ConfirmedLoad|null>(null);const[stage,setStage]=useState<Stage>('browse');const[signing,setSigning]=useState(false);
  const[groupMode,setGroupMode]=useState<GroupMode>('project');const[projectFilter,setProjectFilter]=useState('');const[customerFilter,setCustomerFilter]=useState('');const[fromDate,setFromDate]=useState('');const[toDate,setToDate]=useState('');const[search,setSearch]=useState('');
  const[message,setMessage]=useState<string|null>(null);
  const refresh=useCallback(async()=>{setLoads(await repository.listLoads());},[repository]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{if(initialLoadId&&loads.length&&!selected){const match=loads.find(load=>load.id===initialLoadId);if(match)choose(match);}},[initialLoadId,loads]); // eslint-disable-line react-hooks/exhaustive-deps
  const projectOptions=useMemo(()=>unique(loads.map(load=>load.projectName??'No project')).map(value=>({id:value,label:value})),[loads]);
  const customerOptions=useMemo(()=>unique(loads.map(load=>load.customerName)).map(value=>({id:value,label:value})),[loads]);
  const filtered=useMemo(()=>{const query=search.trim().toLocaleLowerCase('en-US');return loads.filter(load=>{const date=localDate(load.confirmedAt);if(projectFilter&&(load.projectName??'No project')!==projectFilter)return false;if(customerFilter&&load.customerName!==customerFilter)return false;if(fromDate&&date<fromDate)return false;if(toDate&&date>toDate)return false;if(query&&!`${load.loadNumber??''} ${load.transactionNumber} ${load.customerName} ${load.projectName??''} ${load.itemName} ${load.driverName} ${load.truckPlate}`.toLocaleLowerCase('en-US').includes(query))return false;return true;});},[customerFilter,fromDate,loads,projectFilter,search,toDate]);
  const groups=useMemo(()=>{const map=new Map<string,ConfirmedLoad[]>();for(const load of filtered){const key=groupMode==='project'?(load.projectName??'No project'):load.customerName;map.set(key,[...(map.get(key)??[]),load]);}return [...map].sort(([a],[b])=>a.localeCompare(b));},[filtered,groupMode]);

  function animateLayout(){if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);}
  function choose(load:ConfirmedLoad){animateLayout();setSelected(load);setMessage(null);setStage(load.status==='Cancelled'?'blocked':'edit');}
  function chooseAnother(){animateLayout();setSelected(null);setStage('browse');setMessage(null);setSigning(false);}
  function clearFilters(){setProjectFilter('');setCustomerFilter('');setFromDate('');setToDate('');setSearch('');}

  return <ScrollView scrollEnabled={!signing} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <PageHeader eyebrow="AUDITED CORRECTION" title={stage==='edit'?'Correct this load':'Correct Confirmed Load'} onBack={stage==='edit'?chooseAnother:onBack}/>
    {stage==='edit'?null:<Text style={styles.helper}>Confirmed loads are never edited directly. Every correction records a reason and keeps the original in the history alongside the load.</Text>}
    {message?<Feedback kind="success">{message}</Feedback>:null}

    {stage==='browse'?<>
      <CollapsibleFilterCard title="Find a load" summary={`${filtered.length} matching load${filtered.length===1?'':'s'}`}>
        <View style={styles.row}><Text style={styles.helper}>Group and narrow confirmed loads</Text><TouchableOpacity onPress={clearFilters} accessibilityRole="button"><Text style={styles.clear}>Clear filters</Text></TouchableOpacity></View>
        <View style={styles.segment}><Choice label="Under project" selected={groupMode==='project'} onPress={()=>setGroupMode('project')}/><Choice label="Under customer" selected={groupMode==='customer'} onPress={()=>setGroupMode('customer')}/></View>
        <SearchableSelect label="Project" options={projectOptions} selectedId={projectFilter} onSelect={setProjectFilter} placeholder="All projects" allowClear/>
        <SearchableSelect label="Customer" options={customerOptions} selectedId={customerFilter} onSelect={setCustomerFilter} placeholder="All customers" allowClear/>
        <Field label="Search load" value={search} onChangeText={setSearch} placeholder="Receipt number, item, driver, or plate"/>
        <Text style={styles.resultCount}>{filtered.length} matching load{filtered.length===1?'':'s'}</Text>
      </CollapsibleFilterCard>
      {groups.length?<View style={styles.groups}>{groups.map(([group,records])=><View key={group} style={styles.group}>
        <View style={styles.groupHeader}><Text style={styles.groupTitle}>{group}</Text><Text style={styles.groupCount}>{records.length}</Text></View>
        {records.map(load=><TouchableOpacity key={load.id} style={styles.loadRow} onPress={()=>choose(load)} accessibilityRole="button" accessibilityLabel={`${loadNumberLabel(load.loadNumber)}, transaction ${load.transactionNumber}${load.status==='Cancelled'?', cancelled':''}`}>
          <View style={styles.row}><Text style={styles.loadNumber}>{loadNumberLabel(load.loadNumber)}</Text><View style={styles.rowRight}>{load.status==='Cancelled'?<View style={styles.cancelledChip}><Text style={styles.cancelledChipText}>CANCELLED</Text></View>:null}<Text style={styles.date}>{localDate(load.confirmedAt)}</Text></View></View>
          <Text style={styles.loadMain}>{load.itemName} · {load.billedQuantity.toFixed(3)} {load.outputUnitSymbol}</Text>
          <Text style={styles.helper}>{groupMode==='project'?load.customerName:(load.projectName??'No project')} · {load.driverName} · {load.truckPlate}</Text>
        </TouchableOpacity>)}
      </View>)}</View>:<View style={styles.empty}><Text style={styles.cardTitle}>No matching loads</Text><Text style={styles.helper}>Change or clear one of the filters.</Text></View>}
    </>:null}

    {stage==='blocked'&&selected?<AppCard title={selected.transactionNumber} hint="A cancelled load cannot be corrected.">
      <Feedback kind="warning">This load was cancelled{selected.cancelledAt?` on ${new Date(selected.cancelledAt).toLocaleString()}`:''}. Reason: {selected.cancellationReason??'—'}.</Feedback>
      <AppButton label="Choose Another Load" tone="secondary" onPress={chooseAnother}/>
    </AppCard>:null}

    {stage==='edit'&&selected?<LoadCorrectionForm key={selected.id+selected.correctionHistory.length} repository={repository} signers={signers} selected={selected} onChooseAnother={chooseAnother} onSigningChange={setSigning} onSaved={updated=>{setSelected(updated);setMessage('Load corrected. The original is saved in the history. The load number and transaction number did not change. Future PDFs and reprints use the corrected values.');void refresh();}}/>:null}
  </ScrollView>;
}

function Choice({label,selected,onPress}:{label:string;selected:boolean;onPress:()=>void}){return <TouchableOpacity style={[styles.choice,selected&&styles.choiceSelected]} onPress={onPress} accessibilityRole="button" accessibilityState={{selected}}><Text style={[styles.choiceText,selected&&styles.choiceTextSelected]}>{label}</Text></TouchableOpacity>;}
function Field({label,...props}:{label:string;value:string;onChangeText:(v:string)=>void;placeholder?:string}){return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} placeholderTextColor="#89939B" {...props}/></View>;}
const styles=StyleSheet.create({
  lockedCrew:{gap:3,padding:12,borderRadius:11,borderWidth:1,borderColor:colors.line,backgroundColor:colors.creamSoft},lockedCrewLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:.5},lockedCrewName:{color:colors.ink,fontSize:15,fontWeight:'900'},
  content:{padding:20,paddingBottom:42,gap:15}, helper:{color:colors.muted,fontSize:13,lineHeight:19}, flex:{flex:1,minWidth:0},
  row:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:10}, rowRight:{flexDirection:'row',alignItems:'center',gap:8},
  segment:{flexDirection:'row',backgroundColor:'#EEEAE2',borderRadius:11,padding:4,gap:4}, choice:{flex:1,minHeight:44,justifyContent:'center',padding:10,borderRadius:8,alignItems:'center'}, choiceSelected:{backgroundColor:colors.navy}, choiceText:{color:colors.muted,fontWeight:'800'}, choiceTextSelected:{color:'#FFF'},
  clear:{color:colors.brandDark,fontWeight:'900',fontSize:13,minHeight:48,textAlignVertical:'center',paddingVertical:14}, field:{gap:6}, label:{color:colors.ink,fontSize:13,fontWeight:'800'}, input:{minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:10,padding:12,color:colors.ink,backgroundColor:'#FCFBF8'},
  resultCount:{color:colors.brandDark,fontWeight:'900'}, groups:{gap:14}, group:{gap:8}, groupHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}, groupTitle:{color:colors.ink,fontSize:18,fontWeight:'900'}, groupCount:{backgroundColor:'#EEEAE2',color:colors.brandDark,fontWeight:'900',paddingHorizontal:9,paddingVertical:4,borderRadius:12},
  loadRow:{backgroundColor:colors.surface,borderRadius:13,padding:14,gap:4,minHeight:48}, loadNumber:{color:colors.ink,fontWeight:'900',flexShrink:1}, loadMain:{color:colors.ink,fontSize:14,fontWeight:'800'}, date:{color:colors.brandDark,fontWeight:'800',fontSize:12},
  cancelledChip:{backgroundColor:'#FCE8E6',borderRadius:8,paddingHorizontal:7,paddingVertical:3}, cancelledChipText:{color:colors.danger,fontWeight:'900',fontSize:10,letterSpacing:.5},
  empty:{borderWidth:1,borderColor:colors.line,borderStyle:'dashed',borderRadius:15,padding:16,gap:5}, cardTitle:{color:colors.ink,fontSize:18,fontWeight:'900'},
  identityRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:10},
  notice:{backgroundColor:'#FFF3D8',color:colors.warning,padding:11,borderRadius:9,lineHeight:17,fontSize:12,fontWeight:'700'},
  historyToggle:{color:colors.navy,fontWeight:'900',fontSize:12,minHeight:44,textAlignVertical:'center',paddingVertical:12}, historyList:{gap:10,borderTopWidth:1,borderTopColor:colors.line,paddingTop:10}, historyEntry:{gap:2}, historyDate:{color:colors.ink,fontWeight:'800',fontSize:12}, historyReason:{color:colors.ink,fontSize:13,fontWeight:'700'},
  columns:{flexDirection:'row',gap:10}, metricRow:{flexDirection:'row',flexWrap:'wrap',gap:8},
  reasonLabel:{color:colors.muted,fontSize:11,fontWeight:'800',letterSpacing:.5}, reasonValue:{color:colors.ink,fontSize:14,fontWeight:'700',marginBottom:4},
  diffRow:{borderTopWidth:1,borderTopColor:colors.line,paddingVertical:10,gap:4}, diffField:{color:colors.muted,fontSize:12,fontWeight:'800'}, diffValues:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8}, diffWas:{color:colors.danger,fontSize:14,fontWeight:'700',flexShrink:1}, diffArrow:{color:colors.muted,fontSize:14,fontWeight:'900'}, diffNow:{color:colors.success,fontSize:15,fontWeight:'900',flexShrink:1},
});
