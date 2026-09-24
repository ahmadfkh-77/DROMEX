import {useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {CustomDirectoryRepository} from '../../data/repositories/CustomDirectoryRepository';
import type {CustomDirectory,CustomDirectoryDraft,CustomDirectoryEntry,CustomDirectoryEntryDraft} from '../../domain/customDirectories';
import {AppButton,AppField,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {useReducedMotion} from '../components/ExpandableMenu';
import {FocusedSheet,SheetActions} from '../components/FocusedSheet';
import {colors} from '../theme';

type DirectorySheet={id:string|null;draft:Required<CustomDirectoryDraft>};
type EntrySheet={id:string|null;draft:Required<CustomDirectoryEntryDraft>};

/**
 * DEC-478. Owner-defined resource directories. The first view lists directories; opening one lists its
 * entries. Each edit happens in a focused sheet with one primary action. Nothing is deleted: archiving
 * hides a directory or entry from new Daily Reports while every report that used it keeps its snapshot.
 */
export function CustomDirectoriesScreen({repository,onBack}:{repository:CustomDirectoryRepository;onBack:()=>void}){
  const reducedMotion=useReducedMotion();
  const[directories,setDirectories]=useState<CustomDirectory[]|null>(null);
  const[entries,setEntries]=useState<CustomDirectoryEntry[]>([]);
  const[openId,setOpenId]=useState<string|null>(null);
  const[directorySheet,setDirectorySheet]=useState<DirectorySheet|null>(null);
  const[entrySheet,setEntrySheet]=useState<EntrySheet|null>(null);
  const[sheetError,setSheetError]=useState<string|null>(null);
  const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);
  const[busy,setBusy]=useState(false);const[archivedOpen,setArchivedOpen]=useState(false);

  const open=directories?.find(directory=>directory.id===openId)??null;
  const refresh=useCallback(async()=>{
    try{const next=await repository.listDirectories();setDirectories(next);setEntries(openId?await repository.listEntries(openId):[]);}
    catch(cause){setError(cause instanceof Error?cause.message:'Directories could not be loaded.');setDirectories(current=>current??[]);}
  },[openId,repository]);
  useEffect(()=>{void refresh();},[refresh]);

  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};
  async function run(action:()=>Promise<unknown>,success:string){setBusy(true);setError(null);setMessage(null);try{await action();await refresh();setMessage(success);}catch(cause){setError(cause instanceof Error?cause.message:'The change could not be saved.');}finally{setBusy(false);}}
  async function saveSheet(action:()=>Promise<unknown>,success:string,close:()=>void){setBusy(true);setSheetError(null);try{await action();close();await refresh();setMessage(success);}catch(cause){setSheetError(cause instanceof Error?cause.message:'The change could not be saved.');}finally{setBusy(false);}}
  function confirmArchive(name:string,kind:'directory'|'entry',onConfirm:()=>void){
    Alert.alert(`Archive this ${kind}?`,`"${name}" will no longer be offered for new Daily Reports. Reports that already list it keep it exactly as recorded, and you can restore it at any time.`,
      [{text:'Keep active',style:'cancel'},{text:'Archive',style:'destructive',onPress:onConfirm}]);
  }
  function openDirectory(id:string|null){animate();setOpenId(id);setArchivedOpen(false);setError(null);setMessage(null);}

  if(!directories)return <AppPage><PageHeader eyebrow="PEOPLE & EQUIPMENT" title="Custom directories" onBack={onBack}/><View style={styles.loading}><ActivityIndicator size="large" color={colors.brand}/><Text style={styles.helper}>Loading directories…</Text></View></AppPage>;

  const directorySheetView=<FocusedSheet visible={!!directorySheet} eyebrow={directorySheet?.id?'EDIT DIRECTORY':'NEW DIRECTORY'} title={directorySheet?.draft.name.trim()||'Directory'} onClose={()=>setDirectorySheet(null)}
    footer={<SheetActions primaryLabel="Save directory" busy={busy} onCancel={()=>setDirectorySheet(null)} onPrimary={()=>{if(!directorySheet)return;const {id,draft}=directorySheet;void saveSheet(()=>id?repository.updateDirectory(id,draft):repository.createDirectory(draft),id?'Directory updated. Existing reports keep the name they recorded.':'Directory created.',()=>setDirectorySheet(null));}}/>}>
    {directorySheet?<>
      {sheetError?<Feedback kind="error">{sheetError}</Feedback>:null}
      <AppField label="Directory name *" value={directorySheet.draft.name} onChangeText={name=>setDirectorySheet({...directorySheet,draft:{...directorySheet.draft,name}})} maxLength={60} placeholder="Engineers, Pickups, Generators…"/>
      <AppField label="Description" value={directorySheet.draft.description} onChangeText={description=>setDirectorySheet({...directorySheet,draft:{...directorySheet.draft,description}})} maxLength={200} multiline/>
      <Text style={styles.helper}>Each entry has a name, an optional identifier, and optional notes.</Text>
    </>:null}
  </FocusedSheet>;

  const entrySheetView=<FocusedSheet visible={!!entrySheet} eyebrow={entrySheet?.id?'EDIT ENTRY':`NEW ENTRY · ${(open?.name??'').toLocaleUpperCase()}`} title={entrySheet?.draft.name.trim()||'Entry'} onClose={()=>setEntrySheet(null)}
    footer={<SheetActions primaryLabel="Save entry" busy={busy} onCancel={()=>setEntrySheet(null)} onPrimary={()=>{if(!entrySheet||!open)return;const {id,draft}=entrySheet;void saveSheet(()=>id?repository.updateEntry(id,draft):repository.createEntry(open.id,draft),id?'Entry updated. Existing reports keep what they recorded.':'Entry added.',()=>setEntrySheet(null));}}/>}>
    {entrySheet?<>
      {sheetError?<Feedback kind="error">{sheetError}</Feedback>:null}
      <AppField label="Name *" value={entrySheet.draft.name} onChangeText={name=>setEntrySheet({...entrySheet,draft:{...entrySheet.draft,name}})} maxLength={80}/>
      <AppField label="Identifier / reference" value={entrySheet.draft.identifier} onChangeText={identifier=>setEntrySheet({...entrySheet,draft:{...entrySheet.draft,identifier}})} maxLength={60} placeholder="Plate, serial, licence, staff number…"/>
      <AppField label="Notes" value={entrySheet.draft.notes} onChangeText={notes=>setEntrySheet({...entrySheet,draft:{...entrySheet.draft,notes}})} maxLength={500} multiline/>
    </>:null}
  </FocusedSheet>;

  if(open){
    const active=entries.filter(entry=>entry.isActive),archived=entries.filter(entry=>!entry.isActive);
    return <AppPage keyboard>
      <PageHeader eyebrow="CUSTOM DIRECTORY" title={open.name} onBack={()=>openDirectory(null)}/>
      {open.description?<Text style={styles.helper}>{open.description}</Text>:null}
      {!open.isActive?<Feedback kind="warning">This directory is archived. Its entries are not offered for new Daily Reports.</Feedback>:null}
      {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
      <AppButton label="Add entry" disabled={busy} onPress={()=>{setSheetError(null);setEntrySheet({id:null,draft:{name:'',identifier:'',notes:''}});}}/>
      <Text style={styles.sectionTitle}>Entries · {active.length}</Text>
      {active.length?active.map((entry,index)=><Row key={entry.id} title={entry.name} detail={[entry.identifier,entry.notes].filter(Boolean).join(' · ')||'No identifier or notes'} busy={busy}
        onEdit={()=>{setSheetError(null);setEntrySheet({id:entry.id,draft:{name:entry.name,identifier:entry.identifier??'',notes:entry.notes??''}});}}
        onUp={index>0?()=>void run(()=>repository.moveEntry(entry.id,-1),'Order updated.'):undefined}
        onDown={index<active.length-1?()=>void run(()=>repository.moveEntry(entry.id,1),'Order updated.'):undefined}
        toggleLabel="Archive" onToggle={()=>confirmArchive(entry.name,'entry',()=>void run(()=>repository.setEntryActive(entry.id,false),'Entry archived. Existing reports are unchanged.'))}/>)
        :<EmptyState title="No entries yet" body={`Add the first entry to ${open.name}. It will then be selectable in Daily Reports.`}/>}
      <Band title="Archived entries" count={archived.length} open={archivedOpen} onPress={()=>{animate();setArchivedOpen(value=>!value);}}/>
      {archivedOpen?archived.map(entry=><Row key={entry.id} title={entry.name} detail={entry.identifier??'Archived'} busy={busy} archived
        onEdit={()=>{setSheetError(null);setEntrySheet({id:entry.id,draft:{name:entry.name,identifier:entry.identifier??'',notes:entry.notes??''}});}}
        toggleLabel="Restore" onToggle={()=>void run(()=>repository.setEntryActive(entry.id,true),'Entry restored.')}/>):null}
      {entrySheetView}
    </AppPage>;
  }

  const active=directories.filter(directory=>directory.isActive),archived=directories.filter(directory=>!directory.isActive);
  return <AppPage keyboard>
    <PageHeader eyebrow="PEOPLE & EQUIPMENT" title="Custom directories" onBack={onBack}/>
    <Text style={styles.helper}>Create your own groups — Engineers, Surveyors, Pickups, Generators — and select their entries in Daily Reports. Reports keep what they recorded, even after renaming or archiving.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    <AppButton label="Add directory" disabled={busy} onPress={()=>{setSheetError(null);setDirectorySheet({id:null,draft:{name:'',description:''}});}}/>
    <Text style={styles.sectionTitle}>Directories · {active.length}</Text>
    {active.length?active.map((directory,index)=><Row key={directory.id} title={directory.name} detail={directory.description??'Open to add or edit entries'} busy={busy}
      onOpen={()=>openDirectory(directory.id)}
      onEdit={()=>{setSheetError(null);setDirectorySheet({id:directory.id,draft:{name:directory.name,description:directory.description??''}});}}
      onUp={index>0?()=>void run(()=>repository.moveDirectory(directory.id,-1),'Order updated.'):undefined}
      onDown={index<active.length-1?()=>void run(()=>repository.moveDirectory(directory.id,1),'Order updated.'):undefined}
      toggleLabel="Archive" onToggle={()=>confirmArchive(directory.name,'directory',()=>void run(()=>repository.setDirectoryActive(directory.id,false),'Directory archived. Existing reports are unchanged.'))}/>)
      :<EmptyState title="No directories yet" body="Add a directory such as Engineers or Generators to start recording those resources in Daily Reports."/>}
    <Band title="Archived directories" count={archived.length} open={archivedOpen} onPress={()=>{animate();setArchivedOpen(value=>!value);}}/>
    {archivedOpen?archived.map(directory=><Row key={directory.id} title={directory.name} detail="Archived · not offered for new reports" busy={busy} archived onOpen={()=>openDirectory(directory.id)}
      toggleLabel="Restore" onToggle={()=>void run(()=>repository.setDirectoryActive(directory.id,true),'Directory restored.')}/>):null}
    {directorySheetView}
  </AppPage>;
}

function Row({title,detail,busy,archived=false,onOpen,onEdit,onUp,onDown,toggleLabel,onToggle}:{title:string;detail:string;busy:boolean;archived?:boolean;onOpen?:()=>void;onEdit?:()=>void;onUp?:()=>void;onDown?:()=>void;toggleLabel:string;onToggle:()=>void}){
  return <View style={[styles.row,archived&&styles.rowArchived]}>
    <TouchableOpacity disabled={!onOpen} onPress={onOpen} activeOpacity={.75} accessibilityRole={onOpen?'button':undefined} accessibilityLabel={onOpen?`Open ${title}`:undefined}>
      <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.helper} numberOfLines={2}>{detail}</Text>
    </TouchableOpacity>
    <View style={styles.actions}>
      {onOpen?<Quiet label="Open" onPress={onOpen} busy={busy}/>:null}
      {onEdit?<Quiet label="Edit" onPress={onEdit} busy={busy} accessibilityLabel={`Edit ${title}`}/>:null}
      {onUp?<Quiet label="↑ Up" onPress={onUp} busy={busy} accessibilityLabel={`Move ${title} up`}/>:null}
      {onDown?<Quiet label="↓ Down" onPress={onDown} busy={busy} accessibilityLabel={`Move ${title} down`}/>:null}
      <Quiet label={toggleLabel} onPress={onToggle} busy={busy} accessibilityLabel={`${toggleLabel} ${title}`}/>
    </View>
  </View>;
}
function Quiet({label,onPress,busy,accessibilityLabel}:{label:string;onPress:()=>void;busy:boolean;accessibilityLabel?:string}){
  return <TouchableOpacity style={styles.quiet} onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={accessibilityLabel??label}><Text style={styles.quietText}>{label}</Text></TouchableOpacity>;
}
function Band({title,count,open,onPress}:{title:string;count:number;open:boolean;onPress:()=>void}){
  return <TouchableOpacity activeOpacity={.75} style={styles.band} onPress={onPress} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${title}, ${count}`}>
    <View style={styles.flex}><Text style={styles.bandTitle}>{title}</Text><Text style={styles.helper}>{open?'Tap to hide':'Tap to view'} · {count} record{count===1?'':'s'}</Text></View>
    <Text style={styles.bandMark}>{open?'×':'+'}</Text>
  </TouchableOpacity>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  loading:{alignItems:'center',gap:10,paddingVertical:30},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  sectionTitle:{color:colors.ink,fontSize:18,fontWeight:'900'},
  row:{backgroundColor:colors.surface,borderRadius:13,padding:14,gap:6,borderLeftWidth:3,borderLeftColor:colors.navy},
  rowArchived:{borderLeftColor:colors.line,borderWidth:1,borderColor:colors.line},
  rowTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},
  actions:{flexDirection:'row',flexWrap:'wrap',columnGap:14},
  quiet:{minHeight:44,justifyContent:'center'},quietText:{color:colors.brandDark,fontSize:13,fontWeight:'900'},
  band:{minHeight:56,backgroundColor:colors.creamSoft,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:16,flexDirection:'row',alignItems:'center',gap:10},
  bandTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},bandMark:{color:colors.brandDark,fontSize:24,fontWeight:'700',width:22,textAlign:'center'},
});
