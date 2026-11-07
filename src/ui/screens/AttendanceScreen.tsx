import {useCallback,useEffect,useState} from 'react';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';

import type {AttendanceChoice,AttendanceRepository,AttendanceSetup} from '../../data/repositories/AttendanceRepository';
import type {AttendanceEntry,AttendancePlace,AttendanceSubject} from '../../domain/attendance';
import {AppButton,AppCard,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {DatePickerField} from '../components/DatePickerField';
import {colors} from '../theme';
import {Fold} from './CompanyDailyReportScreen';

const keyOf=(subject:AttendanceSubject)=>`${subject.type}:${subject.id}`;

/**
 * DEC-544. The daily attendance editor: for one day, tick who worked and choose one or more places (a project, a company site, or a typed place for
 * that day only). Presence and places only: no hours, no pay. Taking the last place off a person removes the tick. Every change is saved at once.
 */
export function AttendanceScreen({repository,day,onDayChange,onBack}:{repository:Pick<AttendanceRepository,'getSetup'|'saveEntry'|'removeEntry'>;day:string;onDayChange:(day:string)=>void;onBack:()=>void}){
  const[setup,setSetup]=useState<AttendanceSetup|null>(null);
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[error,setError]=useState<string|null>(null);
  const[picking,setPicking]=useState<AttendanceSubject|null>(null);
  const[open,setOpen]=useState<Record<string,boolean>>({people:true});
  const entries=new Map<string,AttendanceEntry>((setup?.entries??[]).map(entry=>[keyOf({type:entry.subjectType,id:entry.subjectId}),entry]));

  const load=useCallback(async()=>{setStatus('loading');setError(null);try{setSetup(await repository.getSetup(day));setStatus('ready');}catch{setStatus('error');}},[repository,day]);
  useEffect(()=>{void load();},[load]);

  /** Runs one change and then reads the day again, so the screen always shows what is saved. */
  const run=async(action:()=>Promise<unknown>)=>{setError(null);try{await action();await load();}catch(cause){setError(cause instanceof Error?cause.message:'The change could not be saved.');}};
  const places=(subject:AttendanceSubject)=>entries.get(keyOf(subject))?.places??[];
  const tick=(subject:AttendanceSubject)=>entries.has(keyOf(subject))?run(()=>repository.removeEntry(day,subject)):setPicking(subject);
  const addPlace=(subject:AttendanceSubject,place:AttendancePlace)=>{setPicking(null);return run(()=>repository.saveEntry(day,subject,[...places(subject),place]));};
  const removePlace=(subject:AttendanceSubject,index:number)=>{const rest=places(subject).filter((_,i)=>i!==index);return run(()=>rest.length?repository.saveEntry(day,subject,rest):repository.removeEntry(day,subject));};

  const group=(id:string,title:string,list:AttendanceChoice[])=>{
    const worked=list.filter(item=>entries.has(keyOf({type:item.subjectType,id:item.id}))).length;
    return <Fold key={id} title={title} hint={`${worked} worked today · ${list.length} listed`} open={open[id]===true} onToggle={()=>setOpen(current=>({...current,[id]:!current[id]}))}>
      {!list.length?<Text style={styles.hint}>Nobody is listed here yet. Add them in People & equipment.</Text>:null}
      {list.map(item=>{
        const subject:AttendanceSubject={type:item.subjectType,id:item.id};const on=entries.has(keyOf(subject));
        return <View key={item.id} style={styles.item}>
          <Pressable onPress={()=>void tick(subject)} accessibilityRole="checkbox" accessibilityState={{checked:on}} accessibilityLabel={`${item.name}${item.detail?`, ${item.detail}`:''}. Worked today`} style={styles.tick}>
            <View style={[styles.box,on&&styles.boxOn]}><Text style={styles.check}>{on?'✓':''}</Text></View>
            <View style={styles.copy}><Text style={styles.name}>{item.name}</Text>{item.detail?<Text style={styles.hint}>{item.detail}</Text>:null}</View>
          </Pressable>
          {on?<View style={styles.chips}>
            {places(subject).map((place,index)=><Pressable key={`${place.type}:${place.id??place.name}`} onPress={()=>void removePlace(subject,index)} accessibilityRole="button" accessibilityLabel={`Remove ${place.name}`} style={styles.chip}><Text style={styles.chipText}>{place.name}</Text><Text style={styles.chipX}>×</Text></Pressable>)}
            <Pressable onPress={()=>setPicking(subject)} accessibilityRole="button" accessibilityLabel={`Add a place for ${item.name}`} style={[styles.chip,styles.chipAdd]}><Text style={styles.chipText}>+ Place</Text></Pressable>
          </View>:null}
        </View>;
      })}
    </Fold>;
  };

  return <AppPage keyboard>
    <PageHeader eyebrow="COMPANY DAILY REPORT" title="Attendance" onBack={onBack}/>
    <DatePickerField label="Day" value={day} onChange={onDayChange}/>
    <AppCard title="Who worked where" hint="Tick who worked on this day and choose where. Presence and places only: no hours, no pay."><Text style={styles.hint}>Every change is saved at once. Taking the last place off a person removes the tick.</Text></AppCard>
    {status==='loading'&&!setup?<Feedback kind="warning">Reading the lists…</Feedback>:null}
    {status==='error'?<><Feedback kind="error">The attendance could not be read.</Feedback><AppButton label="Try again" tone="secondary" onPress={()=>void load()}/></>:null}
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {setup?<>
      {!setup.people.length&&!setup.trucks.length&&!setup.machines.length?<EmptyState title="No people or equipment yet" body="Add people, trucks and machines in People & equipment, then tick who worked here."/>:null}
      {group('people','People',setup.people)}{group('trucks','Trucks',setup.trucks)}{group('machines','Machines',setup.machines)}
    </>:null}
    {picking&&setup?<PlacePanel setup={setup} chosen={places(picking)} onPick={place=>void addPlace(picking,place)} onClose={()=>setPicking(null)}/>:null}
  </AppPage>;
}

/** The "+ Place" panel: search the active projects and company sites, or type a place that is used for this day only (it creates no project or site). */
function PlacePanel({setup,chosen,onPick,onClose}:{setup:AttendanceSetup;chosen:AttendancePlace[];onPick:(place:AttendancePlace)=>void;onClose:()=>void}){
  const[query,setQuery]=useState('');const[typing,setTyping]=useState(false);const[typed,setTyped]=useState('');
  const matches=(name:string)=>name.toLowerCase().includes(query.trim().toLowerCase());
  const taken=(type:AttendancePlace['type'],id:string)=>chosen.some(place=>place.type===type&&place.id===id);
  const projects=setup.projects.filter(p=>matches(p.name)&&!taken('project',p.id)),sites=setup.sites.filter(p=>matches(p.name)&&!taken('company_site',p.id));
  return <View style={styles.panel}>
    <View style={styles.panelHead}><Text style={styles.name}>Choose a place</Text><Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><Text style={styles.chipX}>×</Text></Pressable></View>
    <TextInput value={query} onChangeText={setQuery} placeholder="Search projects and sites…" style={styles.search} accessibilityLabel="Search projects and company sites"/>
    {projects.map(p=><Pressable key={`p${p.id}`} onPress={()=>onPick({type:'project',id:p.id,name:p.name})} accessibilityRole="button" style={styles.option}><Text style={styles.name}>{p.name}</Text><Text style={styles.hint}>Active project</Text></Pressable>)}
    {sites.map(p=><Pressable key={`s${p.id}`} onPress={()=>onPick({type:'company_site',id:p.id,name:p.name})} accessibilityRole="button" style={styles.option}><Text style={styles.name}>{p.name}</Text><Text style={styles.hint}>Company site</Text></Pressable>)}
    {!projects.length&&!sites.length?<Text style={styles.hint}>Nothing matches.</Text>:null}
    {!typing?<Pressable onPress={()=>setTyping(true)} accessibilityRole="button" style={styles.option}><Text style={[styles.name,{color:colors.brand}]}>Not in the list? Type a place</Text><Text style={styles.hint}>Free text for this day only. It creates no project or site.</Text></Pressable>
      :<View style={{gap:8,marginTop:6}}><TextInput value={typed} onChangeText={setTyped} placeholder="Name of the place" maxLength={80} style={styles.search} accessibilityLabel="Name of the typed place" autoFocus/><AppButton label="Add this place" disabled={!typed.trim()} onPress={()=>onPick({type:'typed',id:null,name:typed})}/></View>}
  </View>;
}

const styles=StyleSheet.create({
  hint:{color:colors.muted,fontSize:12},name:{color:colors.ink,fontWeight:'800',fontSize:14},
  item:{borderTopWidth:1,borderTopColor:colors.line,paddingVertical:4},
  tick:{flexDirection:'row',alignItems:'center',gap:10,minHeight:48},copy:{flex:1},
  box:{width:26,height:26,borderRadius:6,borderWidth:2,borderColor:colors.navy,alignItems:'center',justifyContent:'center'},boxOn:{backgroundColor:colors.navy},check:{color:'#FFFFFF',fontWeight:'900'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:6,paddingBottom:6,paddingLeft:36},
  chip:{flexDirection:'row',alignItems:'center',gap:6,minHeight:40,paddingHorizontal:12,borderRadius:999,borderWidth:1,borderColor:'#9FB0C2',backgroundColor:'#EAF0F6'},chipAdd:{backgroundColor:colors.surface},
  chipText:{color:colors.navy,fontWeight:'700',fontSize:13},chipX:{color:colors.brand,fontWeight:'900',fontSize:18},
  panel:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.line,padding:12,gap:4},panelHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',minHeight:44},
  search:{borderWidth:1.5,borderColor:'#9FB0C2',borderRadius:10,padding:10,fontSize:14,color:colors.ink,backgroundColor:colors.surface,minHeight:48},
  option:{minHeight:52,justifyContent:'center',paddingVertical:8,paddingHorizontal:4,borderBottomWidth:1,borderBottomColor:colors.line},
});
