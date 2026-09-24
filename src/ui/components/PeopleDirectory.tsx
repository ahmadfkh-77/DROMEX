import {useMemo,useState} from 'react';
import {ActivityIndicator,Alert,LayoutAnimation,StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';

import {
  describeRoleChange,filterPeople,peopleRoleCounts,personRoleLabels,personRolePluralLabels,personRoles,possibleDuplicatePersonIds,
  type PeopleRoleFilter,type PersonDraft,type PersonProfile,type PersonRole,
} from '../../domain/people';
import {colors} from '../theme';
import {AppButton,AppField,Feedback} from './AppPrimitives';
import {useReducedMotion} from './ExpandableMenu';
import {FocusedSheet,SheetActions} from './FocusedSheet';
import {SegmentedChoice} from './SegmentedChoice';

type Editing={id:string|null;draft:Required<PersonDraft>};
const blank=(role:PersonRole):Required<PersonDraft>=>({name:'',role,jobTitle:'',phone:'',licenseNumber:'',notes:''});
const roleOptions=personRoles.map(role=>({id:role,label:personRoleLabels[role]}));

function initials(name:string):string{
  const parts=name.trim().split(/\s+/).filter(Boolean);
  if(!parts.length)return '?';
  if(parts.length===1)return parts[0]!.slice(0,2).toUpperCase();
  return (parts[0]![0]!+parts[1]![0]!).toUpperCase();
}

/**
 * DEC-476. The People tab of People & Equipment: one directory for Workers, Drivers and Operators.
 * Every filter, count and duplicate flag comes from domain/people.ts; this component only arranges
 * them. A role change is always confirmed first, because it changes what new selections offer.
 */
export function PeopleDirectory({people,busy,onSave,onSetActive}:{
  people:PersonProfile[]|null;
  busy:boolean;
  /** Resolves on success; rejects with a message the sheet shows while staying open. */
  onSave:(draft:PersonDraft,id:string|null)=>Promise<void>;
  onSetActive:(person:PersonProfile,isActive:boolean)=>void;
}){
  const reducedMotion=useReducedMotion();
  const[filter,setFilter]=useState<PeopleRoleFilter>('all');
  const[query,setQuery]=useState('');
  const[inactiveOpen,setInactiveOpen]=useState(false);
  const[editing,setEditing]=useState<Editing|null>(null);
  const[sheetError,setSheetError]=useState<string|null>(null);

  const all=useMemo(()=>people??[],[people]);
  const counts=useMemo(()=>peopleRoleCounts(all),[all]);
  const duplicates=useMemo(()=>possibleDuplicatePersonIds(all),[all]);
  const visible=useMemo(()=>filterPeople(all,filter,query),[all,filter,query]);
  const active=visible.filter(person=>person.isActive);
  const inactive=visible.filter(person=>!person.isActive);
  const filterLabel=filter==='all'?'people':personRolePluralLabels[filter];
  const filterOptions=[{id:'all' as const,label:'All',count:counts.all},...personRoles.map(role=>({id:role,label:personRolePluralLabels[role],count:counts[role]}))];

  function openCreate(){setSheetError(null);setEditing({id:null,draft:blank(filter==='all'?'worker':filter)});}
  function openEdit(person:PersonProfile){setSheetError(null);setEditing({id:person.id,draft:{name:person.name,role:person.role,jobTitle:person.jobTitle??'',phone:person.phone??'',licenseNumber:person.licenseNumber??'',notes:person.notes??''}});}
  function update(patch:Partial<PersonDraft>){setEditing(current=>current?{...current,draft:{...current.draft,...patch}}:current);}
  async function persist(){if(!editing)return;setSheetError(null);try{await onSave(editing.draft,editing.id);setEditing(null);}catch(cause){setSheetError(cause instanceof Error?cause.message:'The person could not be saved.');}}
  function save(){
    if(!editing)return;
    const current=editing.id?all.find(person=>person.id===editing.id):null;
    const change=current?describeRoleChange(current,editing.draft.role):null;
    if(!change){void persist();return;}
    Alert.alert(
      'Change role?',
      change,
      [{text:'Keep current role',style:'cancel'},{text:`Change to ${personRoleLabels[editing.draft.role]}`,onPress:()=>void persist()}],
    );
  }
  function toggleInactive(){if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setInactiveOpen(value=>!value);}

  const editingPerson=editing?.id?all.find(person=>person.id===editing.id)??null:null;

  return <View style={styles.section}>
    <SegmentedChoice mode="tabs" options={filterOptions} selectedId={filter} onSelect={setFilter}/>
    <View style={styles.searchBar}>
      <Text style={styles.searchGlyph}>⌕</Text>
      <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search name, job title, phone, or licence" placeholderTextColor="#89939B" accessibilityLabel="Search people"/>
      {query.length?<TouchableOpacity style={styles.searchClear} onPress={()=>setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={styles.searchClearText}>×</Text></TouchableOpacity>:null}
    </View>
    <AppButton label="Add person" onPress={openCreate} disabled={busy||!people} hint="One record per person. Change the role later instead of adding them twice."/>

    {!people?<View style={styles.loading}><ActivityIndicator size="large" color={colors.brand}/><Text style={styles.helper}>Loading people…</Text></View>:<>
      <View style={styles.headingRow}><Text style={styles.heading}>Active {filterLabel}</Text><Text style={styles.headingCount}>{active.length}</Text></View>
      {active.length?active.map(person=><PersonRow key={person.id} person={person} duplicate={duplicates.has(person.id)} busy={busy} onEdit={()=>openEdit(person)} onToggle={()=>onSetActive(person,false)}/>)
        :<Empty title={query.trim()?'No matches':`No active ${filterLabel} yet`} body={query.trim()?`No active ${filterLabel} match "${query.trim()}".`:'Add a person above. Their role decides where they can be selected.'} onClear={query.trim()?()=>setQuery(''):undefined}/>}
      <TouchableOpacity activeOpacity={.75} style={styles.band} onPress={toggleInactive} accessibilityRole="button" accessibilityState={{expanded:inactiveOpen}} accessibilityLabel={`Inactive people, ${inactive.length}`}>
        <View style={styles.flex}><Text style={styles.bandTitle}>Inactive people</Text><Text style={styles.helper}>{inactiveOpen?'Tap to hide':'Tap to view'} · {inactive.length} record{inactive.length===1?'':'s'}</Text></View>
        <Text style={styles.bandMark}>{inactiveOpen?'×':'+'}</Text>
      </TouchableOpacity>
      {inactiveOpen?(inactive.length?inactive.map(person=><PersonRow key={person.id} person={person} duplicate={duplicates.has(person.id)} busy={busy} onEdit={()=>openEdit(person)} onToggle={()=>onSetActive(person,true)}/>)
        :<Empty title="No inactive people" body="People you deactivate stay in history and appear here."/>):null}
    </>}

    <FocusedSheet visible={!!editing} eyebrow={editing?.id?'EDIT PERSON':'NEW PERSON'} title={editing?.draft.name.trim()||(editing?.id?'Person':'Add person')} onClose={()=>setEditing(null)}
      footer={<SheetActions primaryLabel="Save person" onPrimary={save} onCancel={()=>setEditing(null)} busy={busy}/>}>
      {editing?<>
        {sheetError?<Feedback kind="error">{sheetError}</Feedback>:null}
        <AppField label="Name *" value={editing.draft.name} onChangeText={name=>update({name})} maxLength={80} autoCapitalize="words"/>
        <SegmentedChoice label="Role *" options={roleOptions} selectedId={editing.draft.role} onSelect={role=>update({role})}
          hint={editing.draft.role==='worker'?'Workers are listed under Workers in Daily Reports and cannot be named on a receipt.':editing.draft.role==='driver'?'Drivers can be named on receipts, Supplier Loads and Waste Dumps.':'Operators run machines and can also be named on a receipt as Driver / Operator.'}/>
        <AppField label="Job title / trade" value={editing.draft.jobTitle} onChangeText={jobTitle=>update({jobTitle})} placeholder="Mason, foreman, excavator operator…"/>
        <AppField label="Phone" value={editing.draft.phone} onChangeText={phone=>update({phone})} keyboardType="phone-pad"/>
        <AppField label="Licence number" value={editing.draft.licenseNumber} onChangeText={licenseNumber=>update({licenseNumber})}/>
        <AppField label="Notes" value={editing.draft.notes} onChangeText={notes=>update({notes})} multiline/>
        {editingPerson?.roleHistory.length?<View style={styles.history}>
          <Text style={styles.historyTitle}>Role history</Text>
          {editingPerson.roleHistory.slice().reverse().map(change=><Text key={change.changedAt} style={styles.helper}>{personRoleLabels[change.fromRole]} → {personRoleLabels[change.toRole]} · {new Date(change.changedAt).toLocaleDateString()}</Text>)}
          <Text style={styles.helper}>Reports and receipts made before each change keep the role recorded at the time.</Text>
        </View>:null}
      </>:null}
    </FocusedSheet>
  </View>;
}

function PersonRow({person,duplicate,busy,onEdit,onToggle}:{person:PersonProfile;duplicate:boolean;busy:boolean;onEdit:()=>void;onToggle:()=>void}){
  const detail=[person.jobTitle,person.phone,person.licenseNumber?`Licence ${person.licenseNumber}`:null].filter(Boolean).join(' · ');
  return <View style={[styles.record,!person.isActive&&styles.recordInactive]}>
    <View style={styles.recordTop}>
      <View style={[styles.avatar,!person.isActive&&styles.avatarInactive]}><Text style={styles.avatarText}>{initials(person.name)}</Text></View>
      <View style={styles.flex}>
        <Text style={styles.recordTitle} numberOfLines={2}>{person.name}</Text>
        <Text style={styles.helper} numberOfLines={1}>{detail||'No additional information'}</Text>
      </View>
      <View style={styles.rolePill}><Text style={styles.rolePillText}>{personRoleLabels[person.role]}</Text></View>
    </View>
    {duplicate?<Text style={styles.duplicate}>Possible duplicate: another person has the same name. Check before selecting.</Text>:null}
    {!person.isActive?<Text style={styles.helper}>Inactive · hidden from new selections</Text>:null}
    <View style={styles.actions}>
      <TouchableOpacity style={styles.quiet} disabled={busy} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${person.name}`}><Text style={styles.quietText}>Edit person</Text></TouchableOpacity>
      <TouchableOpacity style={styles.quiet} disabled={busy} onPress={onToggle} accessibilityRole="button" accessibilityLabel={person.isActive?`Deactivate ${person.name}`:`Reactivate ${person.name}`}><Text style={styles.quietText}>{person.isActive?'Deactivate':'Reactivate'}</Text></TouchableOpacity>
    </View>
  </View>;
}

function Empty({title,body,onClear}:{title:string;body:string;onClear?:()=>void}){
  return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.helper}>{body}</Text>{onClear?<TouchableOpacity style={styles.quiet} onPress={onClear} accessibilityRole="button"><Text style={styles.quietText}>Clear search</Text></TouchableOpacity>:null}</View>;
}

const styles=StyleSheet.create({
  section:{gap:15},flex:{flex:1,minWidth:0},
  helper:{color:colors.muted,fontSize:12,lineHeight:18},
  loading:{alignItems:'center',justifyContent:'center',gap:10,paddingVertical:30},
  searchBar:{flexDirection:'row',alignItems:'center',gap:10,minHeight:52,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:14,shadowColor:'#17212B',shadowOpacity:.05,shadowRadius:4,shadowOffset:{width:0,height:2},elevation:1},
  searchGlyph:{color:colors.brand,fontSize:19,fontWeight:'900'},searchInput:{flex:1,color:colors.ink,fontSize:14,fontWeight:'600',paddingVertical:12},
  searchClear:{minHeight:32,minWidth:32,borderRadius:16,backgroundColor:'#EEEAE2',alignItems:'center',justifyContent:'center'},searchClearText:{color:colors.muted,fontSize:16,fontWeight:'900',lineHeight:18},
  headingRow:{flexDirection:'row',alignItems:'center',gap:8},heading:{color:colors.ink,fontSize:18,fontWeight:'900'},
  headingCount:{color:colors.brandDark,backgroundColor:'#FBE9E4',paddingHorizontal:9,paddingVertical:3,borderRadius:11,fontWeight:'900',fontSize:11,overflow:'hidden'},
  record:{backgroundColor:colors.surface,borderRadius:13,padding:14,gap:8},recordInactive:{borderWidth:1,borderColor:colors.line},
  recordTop:{flexDirection:'row',alignItems:'center',gap:10},
  avatar:{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center',backgroundColor:'#E8F0F6'},avatarInactive:{backgroundColor:'#EEEAE3'},
  avatarText:{color:colors.navy,fontWeight:'900',fontSize:13},
  recordTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},
  rolePill:{flexShrink:0,paddingHorizontal:10,paddingVertical:5,borderRadius:12,borderWidth:1,borderColor:colors.navy},
  rolePillText:{color:colors.navy,fontSize:11,fontWeight:'900',letterSpacing:.3},
  duplicate:{color:colors.warning,backgroundColor:'#FFF3D8',borderRadius:8,paddingHorizontal:10,paddingVertical:7,fontSize:12,fontWeight:'700'},
  actions:{flexDirection:'row',flexWrap:'wrap',gap:8},
  quiet:{minHeight:44,justifyContent:'center',paddingHorizontal:4},quietText:{color:colors.brandDark,fontSize:13,fontWeight:'900'},
  band:{minHeight:56,backgroundColor:colors.creamSoft,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:16,flexDirection:'row',alignItems:'center',gap:10},
  bandTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},bandMark:{color:colors.brandDark,fontSize:24,fontWeight:'700',width:22,textAlign:'center'},
  empty:{borderWidth:1,borderColor:colors.line,borderStyle:'dashed',borderRadius:14,padding:18,gap:5},emptyTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},
  history:{backgroundColor:colors.surface,borderRadius:13,padding:14,gap:4,borderLeftWidth:3,borderLeftColor:colors.navy},
  historyTitle:{color:colors.ink,fontSize:14,fontWeight:'900'},
});
