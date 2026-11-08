import {useCallback,useEffect,useMemo,useState} from 'react';
import {Alert,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';

import type {AttendanceChoice,AttendanceRepository,AttendanceSetup} from '../../data/repositories/AttendanceRepository';
import type {AttendancePlace,AttendanceSubject} from '../../domain/attendance';
import {addTypedPlace,countWorked,diffEditor,editorFromEntries,editorKey,missingPlaces,togglePlace,toggleWorked,type EditorState} from '../../domain/attendanceEditor';
import {AppButton,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {DatePickerField} from '../components/DatePickerField';
import {colors} from '../theme';
import {todayKey} from '../../domain/companyDailyReport';
import {Fold} from './CompanyDailyReportScreen';

const subjectOf=(choice:AttendanceChoice):AttendanceSubject=>({type:choice.subjectType,id:choice.id});

/**
 * DEC-544. The daily attendance editor. Tap a name to mark who worked; tap the + beside any row to add places in a bottom sheet (several in a row,
 * tapping a place again removes it); adding a place marks the person as worked. Changes are kept on the screen and written together by
 * "Save attendance". Presence and places only: no hours, no pay.
 */
export function AttendanceScreen({repository,day,onDayChange,onBack}:{repository:Pick<AttendanceRepository,'getSetup'|'saveEntry'|'removeEntry'>;day:string;onDayChange:(day:string)=>void;onBack:()=>void}){
  const[setup,setSetup]=useState<AttendanceSetup|null>(null);
  const[editor,setEditor]=useState<EditorState>({});
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[error,setError]=useState<string|null>(null);
  const[message,setMessage]=useState<string|null>(null);
  const[saving,setSaving]=useState(false);
  const[sheet,setSheet]=useState<AttendanceChoice|null>(null);
  const[open,setOpen]=useState<Record<string,boolean>>({people:true});

  const load=useCallback(async()=>{
    setStatus('loading');setError(null);
    try{const value=await repository.getSetup(day);setSetup(value);setEditor(editorFromEntries(value.entries));setStatus('ready');}catch{setStatus('error');}
  },[repository,day]);
  useEffect(()=>{void load();},[load]);

  const diff=useMemo(()=>setup?diffEditor(setup.entries,editor):{save:[],remove:[]},[setup,editor]);
  const dirty=diff.save.length>0||diff.remove.length>0||missingPlaces(editor).length>0;
  const names=useMemo(()=>new Map([...(setup?.people??[]),...(setup?.trucks??[]),...(setup?.machines??[])].map(c=>[editorKey(subjectOf(c)),c.name])),[setup]);

  /** Asks before throwing away changes that were not saved. */
  const guard=(proceed:()=>void)=>{
    if(!dirty){proceed();return;}
    Alert.alert('Unsaved changes','These attendance changes are not saved yet.',[{text:'Keep editing',style:'cancel'},{text:'Discard changes',style:'destructive',onPress:proceed}]);
  };

  const save=async()=>{
    setError(null);setMessage(null);
    const missing=missingPlaces(editor);
    if(missing.length){setError(`Choose a place for: ${missing.map(s=>names.get(editorKey(s))??'?').join(', ')}. Tap the + beside their name.`);return;}
    setSaving(true);
    try{
      for(const item of diff.save)await repository.saveEntry(day,item.subject,item.places);
      for(const subject of diff.remove)await repository.removeEntry(day,subject);
      const worked=Object.keys(editor).length;
      await load();setMessage(`Saved. ${worked} worked on this day.`);
    }catch(cause){setError(cause instanceof Error?cause.message:'The attendance could not be saved.');}
    finally{setSaving(false);}
  };

  const group=(id:string,title:string,list:AttendanceChoice[])=>{
    const worked=countWorked(editor,list.map(subjectOf));
    return <Fold key={id} title={title} hint={`${worked} of ${list.length} worked`} open={open[id]===true} onToggle={()=>setOpen(current=>({...current,[id]:!current[id]}))}>
      {!list.length?<Text style={styles.hint}>Nobody is listed here yet. Add them in People & equipment.</Text>:null}
      {list.map(item=>{
        const subject=subjectOf(item);const entry=editor[editorKey(subject)];const on=Boolean(entry);
        return <View key={item.id} style={styles.row}>
          <View style={styles.rowTop}>
            <Pressable onPress={()=>setEditor(current=>toggleWorked(current,subject))} accessibilityRole="checkbox" accessibilityState={{checked:on}} accessibilityLabel={`${item.name}${item.detail?`, ${item.detail}`:''}. ${on?'Worked':'Not today'}`} style={styles.name}>
              <View style={[styles.box,on&&styles.boxOn]}><Text style={styles.check}>{on?'✓':''}</Text></View>
              <View style={styles.copy}><Text style={styles.nameText}>{item.name}</Text>{item.detail?<Text style={styles.hint}>{item.detail}</Text>:null}</View>
              <Text style={[styles.state,on&&styles.stateOn]}>{on?'Worked':'Not today'}</Text>
            </Pressable>
            <Pressable onPress={()=>setSheet(item)} accessibilityRole="button" accessibilityLabel={`Add a place for ${item.name}`} style={styles.plus} hitSlop={4}><Text style={styles.plusText}>+</Text></Pressable>
          </View>
          {entry?.places.length?<View style={styles.chips}>{entry.places.map(place=>
            <Pressable key={`${place.type}:${place.id??place.name}`} onPress={()=>setEditor(current=>togglePlace(current,subject,place))} accessibilityRole="button" accessibilityLabel={`Remove ${place.name}`} style={[styles.chip,place.type==='typed'&&styles.chipTyped]}>
              <Text style={[styles.chipText,place.type==='typed'&&styles.chipTypedText]}>{place.name}</Text><Text style={styles.chipX}>×</Text>
            </Pressable>)}</View>:null}
        </View>;
      })}
    </Fold>;
  };

  return <>
    <AppPage keyboard>
      <PageHeader eyebrow="COMPANY DAILY REPORT" title="Attendance" onBack={()=>guard(onBack)}/>
      <DatePickerField label="Day" value={day} onChange={value=>guard(()=>onDayChange(value))} maxDate={todayKey()}/>
      <View style={styles.note}><Text style={styles.noteTitle}>Who worked where</Text><Text style={styles.hint}>Tap a name to mark worked. Tap + to add a place. Presence and places only: no hours, no pay.</Text></View>
      {status==='loading'&&!setup?<Feedback kind="warning">Reading the lists…</Feedback>:null}
      {status==='error'?<><Feedback kind="error">The attendance could not be read.</Feedback><AppButton label="Try again" tone="secondary" onPress={()=>void load()}/></>:null}
      {setup?<>
        {!setup.people.length&&!setup.trucks.length&&!setup.machines.length?<EmptyState title="No people or equipment yet" body="Add people, trucks and machines in People & equipment, then mark who worked here."/>:null}
        {group('people','People',setup.people)}{group('trucks','Trucks',setup.trucks)}{group('machines','Machines',setup.machines)}
      </>:null}
      {error?<Feedback kind="error">{error}</Feedback>:null}
      {message?<Feedback kind="success">{message}</Feedback>:null}
      <AppButton label="Save attendance" onPress={()=>void save()} busy={saving} disabled={!setup||!dirty} hint={dirty?'Writes every change on this screen together.':'Nothing to save.'}/>
    </AppPage>
    {sheet&&setup?<PlaceSheet name={sheet.name} setup={setup} chosen={editor[editorKey(subjectOf(sheet))]?.places??[]}
      onTogglePlace={place=>setEditor(current=>togglePlace(current,subjectOf(sheet),place))} onTyped={text=>setEditor(current=>addTypedPlace(current,subjectOf(sheet),text))} onDone={()=>setSheet(null)}/>:null}
  </>;
}

/** The bottom sheet for one entry: tap a place to add it ("Added ✓"), tap again to remove it. It stays open so several can be added in a row. */
function PlaceSheet({name,setup,chosen,onTogglePlace,onTyped,onDone}:{name:string;setup:AttendanceSetup;chosen:AttendancePlace[];onTogglePlace:(place:AttendancePlace)=>void;onTyped:(text:string)=>void;onDone:()=>void}){
  const[query,setQuery]=useState('');const[typed,setTyped]=useState('');
  const matches=(value:string)=>value.toLowerCase().includes(query.trim().toLowerCase());
  const added=(type:AttendancePlace['type'],id:string)=>chosen.some(place=>place.type===type&&place.id===id);
  const option=(type:'project'|'company_site',item:{id:string;name:string},label:string)=>{
    const on=added(type,item.id);
    return <Pressable key={`${type}:${item.id}`} onPress={()=>onTogglePlace({type,id:item.id,name:item.name})} accessibilityRole="button" accessibilityState={{selected:on}} accessibilityLabel={`${item.name}. ${on?'Added. Tap to remove':'Tap to add'}`} style={styles.option}>
      <View style={styles.copy}><Text style={styles.nameText}>{item.name}</Text><Text style={styles.hint}>{label}</Text></View>
      <Text style={styles.added}>{on?'Added ✓':''}</Text>
    </Pressable>;
  };
  const projects=setup.projects.filter(p=>matches(p.name)),sites=setup.sites.filter(p=>matches(p.name));
  return <Modal visible transparent animationType="slide" onRequestClose={onDone}>
    <View style={styles.shade}>
      <Pressable style={styles.shadeTap} onPress={onDone} accessibilityLabel="Close"/>
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}><Text style={styles.sheetTitle} numberOfLines={2}>Add a place for {name}</Text><Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel="Done" style={styles.done}><Text style={styles.doneText}>Done</Text></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
            <TextInput value={query} onChangeText={setQuery} placeholder="Search projects and sites…" style={styles.input} accessibilityLabel="Search projects and company sites"/>
            <Text style={styles.label}>Projects</Text>
            {projects.map(p=>option('project',p,'Active project'))}{!projects.length?<Text style={styles.hint}>No project matches.</Text>:null}
            <Text style={styles.label}>Company sites</Text>
            {sites.map(p=>option('company_site',p,'Company site'))}{!sites.length?<Text style={styles.hint}>No site matches.</Text>:null}
            <Text style={styles.label}>Not in the list? Type a place</Text>
            <View style={styles.typedRow}>
              <TextInput value={typed} onChangeText={setTyped} placeholder="Name of the place" maxLength={80} style={[styles.input,styles.flex]} accessibilityLabel="Name of the typed place"/>
              <Pressable onPress={()=>{onTyped(typed);setTyped('');}} disabled={!typed.trim()} accessibilityRole="button" accessibilityLabel="Add the typed place" style={[styles.addTyped,!typed.trim()&&styles.addTypedOff]}><Text style={styles.doneText}>Add</Text></Pressable>
            </View>
            <Text style={styles.hint}>A typed place is kept for this day only. It does not create a project or site.</Text>
            {chosen.filter(p=>p.type==='typed').length?<Text style={styles.hint}>Typed here: {chosen.filter(p=>p.type==='typed').map(p=>p.name).join(', ')}</Text>:null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}

const styles=StyleSheet.create({
  flex:{flex:1},copy:{flex:1},hint:{color:colors.muted,fontSize:12},
  note:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:12,padding:10,gap:2},noteTitle:{color:colors.navy,fontWeight:'800',fontSize:14},
  row:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:12,marginTop:8},
  rowTop:{flexDirection:'row',alignItems:'center',paddingHorizontal:6},
  name:{flex:1,flexDirection:'row',alignItems:'center',gap:10,minHeight:56,paddingHorizontal:4},
  nameText:{color:colors.ink,fontWeight:'800',fontSize:14},
  box:{width:28,height:28,borderRadius:7,borderWidth:2,borderColor:colors.navy,alignItems:'center',justifyContent:'center'},boxOn:{backgroundColor:colors.navy},check:{color:'#FFFFFF',fontWeight:'900'},
  state:{color:colors.muted,fontSize:12,fontWeight:'800'},stateOn:{color:colors.navy},
  plus:{width:48,height:48,alignItems:'center',justifyContent:'center'},plusText:{color:colors.brand,fontSize:26,lineHeight:30},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:6,paddingBottom:10,paddingLeft:48,paddingRight:8},
  chip:{flexDirection:'row',alignItems:'center',gap:6,minHeight:40,paddingHorizontal:12,borderRadius:999,borderWidth:1,borderColor:'#9FB0C2',backgroundColor:'#EAF0F6'},
  chipTyped:{backgroundColor:'#FFF1E8',borderColor:colors.brand},chipText:{color:colors.navy,fontWeight:'700',fontSize:13},chipTypedText:{color:colors.brandDark},chipX:{color:colors.brand,fontWeight:'900',fontSize:18},
  shade:{flex:1,backgroundColor:'rgba(20,30,40,0.45)',justifyContent:'flex-end'},shadeTap:{flex:1},
  sheet:{backgroundColor:colors.surface,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:560},
  sheetHead:{flexDirection:'row',alignItems:'center',gap:8,padding:14,borderBottomWidth:1,borderBottomColor:colors.line},sheetTitle:{flex:1,color:colors.navy,fontWeight:'900',fontSize:15},
  done:{minHeight:44,paddingHorizontal:18,borderRadius:12,backgroundColor:colors.navy,alignItems:'center',justifyContent:'center'},doneText:{color:'#FFFFFF',fontWeight:'800'},
  sheetBody:{padding:14,paddingBottom:28,gap:2},
  input:{minHeight:48,borderWidth:1.5,borderColor:'#9FB0C2',borderRadius:10,paddingHorizontal:12,fontSize:14,color:colors.ink,backgroundColor:colors.surface},
  label:{color:colors.muted,fontSize:11,fontWeight:'800',letterSpacing:1,textTransform:'uppercase',marginTop:12,marginBottom:2},
  option:{flexDirection:'row',alignItems:'center',minHeight:52,paddingHorizontal:6,borderBottomWidth:1,borderBottomColor:colors.line},added:{minWidth:76,textAlign:'right',color:colors.navy,fontWeight:'800'},
  typedRow:{flexDirection:'row',gap:8,marginTop:4,marginBottom:6},addTyped:{minHeight:48,paddingHorizontal:18,borderRadius:10,backgroundColor:colors.brand,alignItems:'center',justifyContent:'center'},addTypedOff:{opacity:0.45},
});
