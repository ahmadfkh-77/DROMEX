import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, LayoutAnimation, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { DirectoryProfiles, LoadRepository } from '../../data/repositories/LoadRepository';
import { useReducedMotion } from '../components/ExpandableMenu';
import { colors } from '../theme';

type TabName = 'workers' | 'drivers' | 'trucks' | 'machines';
type DirectoryRecord = { id: string; title: string; detail: string; notes: string | null; isActive: boolean };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

const tabConfig: Record<TabName, { label: string; singular: string; searchPlaceholder: string }> = {
  workers: { label: 'Workers', singular: 'worker', searchPlaceholder: 'Search name, role, or phone' },
  drivers: { label: 'Drivers', singular: 'driver', searchPlaceholder: 'Search name, phone, or licence' },
  trucks: { label: 'Trucks', singular: 'truck', searchPlaceholder: 'Search plate, make/model, or owner' },
  machines: { label: 'Machines', singular: 'machine', searchPlaceholder: 'Search name, type, or identifier' },
};

export function PeopleEquipmentScreen({ repository, onBack }: { repository: LoadRepository; onBack: () => void }) {
  const reducedMotion = useReducedMotion();
  const [options, setOptions] = useState<DirectoryProfiles | null>(null); const [tab, setTab] = useState<TabName>('workers');
  const [search, setSearch] = useState(''); const [inactiveOpen, setInactiveOpen] = useState(false);
  const [workerName,setWorkerName]=useState(''); const [workerRole,setWorkerRole]=useState(''); const [workerPhone,setWorkerPhone]=useState(''); const [workerNotes,setWorkerNotes]=useState('');
  const [driverName,setDriverName]=useState(''); const [driverPhone,setDriverPhone]=useState(''); const [license,setLicense]=useState(''); const [driverNotes,setDriverNotes]=useState('');
  const [plate,setPlate]=useState(''); const [makeModel,setMakeModel]=useState(''); const [capacity,setCapacity]=useState(''); const [owner,setOwner]=useState(''); const [truckNotes,setTruckNotes]=useState('');
  const [machineName,setMachineName]=useState(''); const [machineType,setMachineType]=useState(''); const [identifier,setIdentifier]=useState(''); const [machineNotes,setMachineNotes]=useState('');
  const[editingWorkerId,setEditingWorkerId]=useState<string|null>(null);const[editingDriverId,setEditingDriverId]=useState<string|null>(null);
  const[editingTruckId,setEditingTruckId]=useState<string|null>(null);const[editingMachineId,setEditingMachineId]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null); const [message,setMessage]=useState<string|null>(null); const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>setOptions(await repository.getDirectoryProfiles()),[repository]); useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{setSearch('');if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setInactiveOpen(false);},[tab]); // eslint-disable-line react-hooks/exhaustive-deps
  async function execute(action:()=>Promise<void>, success:string){setBusy(true);setError(null);setMessage(null);try{await action();await refresh();setMessage(success);}catch(cause){setError(cause instanceof Error?cause.message:'Could not save the record.');}finally{setBusy(false);}}
  const clearWorker=()=>{setEditingWorkerId(null);setWorkerName('');setWorkerRole('');setWorkerPhone('');setWorkerNotes('');};
  const clearDriver=()=>{setEditingDriverId(null);setDriverName('');setDriverPhone('');setLicense('');setDriverNotes('');};
  function saveWorker(){return execute(async()=>{const value={name:workerName,role:workerRole,phone:workerPhone,notes:workerNotes};if(editingWorkerId)await repository.updateWorker(editingWorkerId,value);else await repository.createWorker(value);clearWorker();},editingWorkerId?'Worker information updated.':'Worker saved and available in Project Reports.');}
  function saveDriver(){return execute(async()=>{const value={name:driverName,phone:driverPhone,licenseNumber:license,notes:driverNotes};if(editingDriverId)await repository.updateDriver(editingDriverId,value);else await repository.createDriver(value);clearDriver();},editingDriverId?'Driver information updated.':'Driver saved and available in loads and Project Reports.');}
  const clearTruck=()=>{setEditingTruckId(null);setPlate('');setMakeModel('');setCapacity('');setOwner('');setTruckNotes('');};
  const clearMachine=()=>{setEditingMachineId(null);setMachineName('');setMachineType('');setIdentifier('');setMachineNotes('');};
  function saveTruck(){return execute(async()=>{const value={plate,makeModel,capacityKg:capacity.trim()?Number(capacity):null,ownerName:owner,notes:truckNotes};if(editingTruckId)await repository.updateTruck(editingTruckId,value);else await repository.createTruck(value);clearTruck();},editingTruckId?'Truck information updated. Historical records keep their original plate snapshot.':'Truck saved and available in loads and Project Reports.');}
  function saveMachine(){return execute(async()=>{const value={name:machineName,machineType,identifier,notes:machineNotes};if(editingMachineId)await repository.updateMachine(editingMachineId,value);else await repository.createMachine(value);clearMachine();},editingMachineId?'Machine information updated. Historical records keep their original snapshot.':'Machine saved and available in Project Reports.');}
  function editWorker(id:string){const value=options?.workers.find(v=>v.id===id);if(!value)return;setEditingWorkerId(id);setWorkerName(value.name);setWorkerRole(value.role??'');setWorkerPhone(value.phone??'');setWorkerNotes(value.notes??'');setError(null);setMessage(null);}
  function editDriver(id:string){const value=options?.drivers.find(v=>v.id===id);if(!value)return;setEditingDriverId(id);setDriverName(value.name);setDriverPhone(value.phone??'');setLicense(value.licenseNumber??'');setDriverNotes(value.notes??'');setError(null);setMessage(null);}
  function editTruck(id:string){const value=options?.trucks.find(v=>v.id===id);if(!value)return;setEditingTruckId(id);setPlate(value.plate);setMakeModel(value.makeModel??'');setCapacity(value.capacityKg==null?'':String(value.capacityKg));setOwner(value.ownerName??'');setTruckNotes(value.notes??'');setError(null);setMessage(null);}
  function editMachine(id:string){const value=options?.machines.find(v=>v.id===id);if(!value)return;setEditingMachineId(id);setMachineName(value.name);setMachineType(value.machineType??'');setIdentifier(value.identifier??'');setMachineNotes(value.notes??'');setError(null);setMessage(null);}
  function toggle(kind:TabName,id:string,isActive:boolean){const action=kind==='workers'?repository.setWorkerActive(id,isActive):kind==='drivers'?repository.setDriverActive(id,isActive):kind==='trucks'?repository.setTruckActive(id,isActive):repository.setMachineActive(id,isActive);return execute(()=>action,isActive?'Profile reactivated.':'Profile deactivated and removed from new-entry selections.');}
  function requestToggle(kind:TabName,id:string,name:string,isActive:boolean){
    if(isActive){
      Alert.alert(
        `Deactivate this ${tabConfig[kind].singular}?`,
        `"${name}" will no longer appear in searchable selections for new records. Existing history is unchanged, and this profile can be reactivated at any time.`,
        [{text:'Keep Active',style:'cancel'},{text:'Deactivate',style:'destructive',onPress:()=>void toggle(kind,id,false)}],
      );
    }else{
      void toggle(kind,id,true);
    }
  }
  function toggleInactiveSection(){if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setInactiveOpen(v=>!v);}

  const records=useMemo<DirectoryRecord[]>(()=>{
    if(!options)return [];
    if(tab==='workers')return options.workers.map(v=>({id:v.id,title:v.name,detail:[v.role,v.phone].filter(Boolean).join(' · '),notes:v.notes,isActive:v.isActive}));
    if(tab==='drivers')return options.drivers.map(v=>({id:v.id,title:v.name,detail:[v.phone,v.licenseNumber?`Licence ${v.licenseNumber}`:null].filter(Boolean).join(' · '),notes:v.notes,isActive:v.isActive}));
    if(tab==='trucks')return options.trucks.map(v=>({id:v.id,title:v.plate,detail:[v.makeModel,v.capacityKg?`${v.capacityKg} kg capacity`:null,v.ownerName].filter(Boolean).join(' · '),notes:v.notes,isActive:v.isActive}));
    return options.machines.map(v=>({id:v.id,title:v.name,detail:[v.machineType,v.identifier].filter(Boolean).join(' · '),notes:v.notes,isActive:v.isActive}));
  },[options,tab]);
  const byTitle=(a:DirectoryRecord,b:DirectoryRecord)=>a.title.localeCompare(b.title);
  const activeAll=useMemo(()=>records.filter(r=>r.isActive).sort(byTitle),[records]);
  const inactiveAll=useMemo(()=>records.filter(r=>!r.isActive).sort(byTitle),[records]);
  const query=search.trim().toLocaleLowerCase('en-US');
  const matches=(r:DirectoryRecord)=>!query||`${r.title} ${r.detail}`.toLocaleLowerCase('en-US').includes(query);
  const activeVisible=useMemo(()=>activeAll.filter(matches),[activeAll,query]); // eslint-disable-line react-hooks/exhaustive-deps
  const inactiveVisible=useMemo(()=>inactiveAll.filter(matches),[inactiveAll,query]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasQuery=query.length>0;

  function onEditFor(kind:TabName){return kind==='trucks'?editTruck:kind==='machines'?editMachine:kind==='workers'?editWorker:editDriver;}
  function onRecordPress(kind:TabName,id:string){onEditFor(kind)(id);}

  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.hero}>
      <View style={styles.heroTopRow}>
        <TouchableOpacity style={styles.heroBack} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back"><Text style={styles.heroBackText}>Back</Text></TouchableOpacity>
        <View style={styles.flex}><Text style={styles.heroEyebrow}>DIRECTORY</Text><Text style={styles.heroTitle}>People & equipment</Text></View>
      </View>
      <Text style={styles.heroPurpose}>Create reusable workers, drivers, trucks, and machines, then choose them from searchable dropdowns.</Text>
      <View style={styles.heroSummaryRow}>
        <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{(options?.workers.length??0)+(options?.drivers.length??0)}</Text><Text style={styles.heroSummaryLabel}>PEOPLE</Text></View>
        <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{(options?.trucks.length??0)+(options?.machines.length??0)}</Text><Text style={styles.heroSummaryLabel}>EQUIPMENT</Text></View>
        <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{activeAll.length}</Text><Text style={styles.heroSummaryLabel}>ACTIVE HERE</Text></View>
      </View>
    </View>
    {error?<Text style={styles.error} accessibilityRole="alert">{error}</Text>:null}{message?<Text style={styles.success} accessibilityRole="text">{message}</Text>:null}

    <View style={styles.tabGroups}>
      <View style={styles.tabGroup}>
        <Text style={styles.tabGroupLabel}>PEOPLE</Text>
        <View style={styles.tabRow}><Tab label="Workers" selected={tab==='workers'} onPress={()=>setTab('workers')}/><Tab label="Drivers" selected={tab==='drivers'} onPress={()=>setTab('drivers')}/></View>
      </View>
      <View style={styles.tabGroup}>
        <Text style={styles.tabGroupLabel}>EQUIPMENT</Text>
        <View style={styles.tabRow}><Tab label="Trucks" selected={tab==='trucks'} onPress={()=>setTab('trucks')}/><Tab label="Machines" selected={tab==='machines'} onPress={()=>setTab('machines')}/></View>
      </View>
    </View>

    {tab==='workers'?<Card title={editingWorkerId?'Edit worker':'Add worker'}><Field label="Worker name *" value={workerName} onChangeText={setWorkerName}/><Field label="Role / trade" value={workerRole} onChangeText={setWorkerRole}/><Field label="Phone" value={workerPhone} onChangeText={setWorkerPhone} keyboardType="phone-pad"/><Field label="Notes" value={workerNotes} onChangeText={setWorkerNotes} multiline/><Save label={editingWorkerId?'Save worker changes':'Save worker'} busy={busy} onPress={()=>void saveWorker()}/>{editingWorkerId?<TouchableOpacity style={styles.cancelEditWrap} onPress={clearWorker} accessibilityRole="button" accessibilityLabel="Cancel editing worker"><Text style={styles.cancelEdit}>Cancel editing</Text></TouchableOpacity>:null}</Card>:null}
    {tab==='drivers'?<Card title={editingDriverId?'Edit driver':'Add driver'}><Field label="Driver name *" value={driverName} onChangeText={setDriverName}/><Field label="Phone" value={driverPhone} onChangeText={setDriverPhone} keyboardType="phone-pad"/><Field label="Licence number" value={license} onChangeText={setLicense}/><Field label="Notes" value={driverNotes} onChangeText={setDriverNotes} multiline/><Save label={editingDriverId?'Save driver changes':'Save driver'} busy={busy} onPress={()=>void saveDriver()}/>{editingDriverId?<TouchableOpacity style={styles.cancelEditWrap} onPress={clearDriver} accessibilityRole="button" accessibilityLabel="Cancel editing driver"><Text style={styles.cancelEdit}>Cancel editing</Text></TouchableOpacity>:null}</Card>:null}
    {tab==='trucks'?<Card title={editingTruckId?'Edit truck':'Add truck'}><Field label="Number plate *" value={plate} onChangeText={setPlate} autoCapitalize="characters"/><Field label="Make / model" value={makeModel} onChangeText={setMakeModel}/><Field label="Capacity kg" value={capacity} onChangeText={setCapacity} keyboardType="number-pad"/><Field label="Owner / company" value={owner} onChangeText={setOwner}/><Field label="Notes" value={truckNotes} onChangeText={setTruckNotes} multiline/><Save label={editingTruckId?'Save truck changes':'Save truck'} busy={busy} onPress={()=>void saveTruck()}/>{editingTruckId?<TouchableOpacity style={styles.cancelEditWrap} onPress={clearTruck} accessibilityRole="button" accessibilityLabel="Cancel editing truck"><Text style={styles.cancelEdit}>Cancel editing</Text></TouchableOpacity>:null}</Card>:null}
    {tab==='machines'?<Card title={editingMachineId?'Edit machine':'Add machine'}><Field label="Machine name *" value={machineName} onChangeText={setMachineName}/><Field label="Type / make / model" value={machineType} onChangeText={setMachineType}/><Field label="Identifier / serial / plate" value={identifier} onChangeText={setIdentifier}/><Field label="Notes" value={machineNotes} onChangeText={setMachineNotes} multiline/><Save label={editingMachineId?'Save machine changes':'Save machine'} busy={busy} onPress={()=>void saveMachine()}/>{editingMachineId?<TouchableOpacity style={styles.cancelEditWrap} onPress={clearMachine} accessibilityRole="button" accessibilityLabel="Cancel editing machine"><Text style={styles.cancelEdit}>Cancel editing</Text></TouchableOpacity>:null}</Card>:null}

    {!options?<View style={styles.loading}><ActivityIndicator size="large" color={colors.brand}/><Text style={styles.helper}>Loading {tabConfig[tab].label.toLocaleLowerCase('en-US')}…</Text></View>:<>
      {records.length?<View style={styles.searchBar}>
        <Text style={styles.searchGlyph}>⌕</Text>
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder={tabConfig[tab].searchPlaceholder} placeholderTextColor="#89939B" accessibilityLabel={`Search ${tabConfig[tab].label.toLocaleLowerCase('en-US')}`}/>
        {search.length?<TouchableOpacity style={styles.searchClear} onPress={()=>setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={styles.searchClearText}>×</Text></TouchableOpacity>:null}
      </View>:null}

      <View style={styles.sectionHeadingRow}><Text style={styles.sectionTitle}>Active {tabConfig[tab].label}</Text><Text style={styles.sectionCount}>{activeAll.length}</Text></View>
      {activeVisible.length?activeVisible.map(record=><Record key={record.id} record={record} busy={busy} onEdit={()=>onRecordPress(tab,record.id)} onToggle={()=>requestToggle(tab,record.id,record.title,record.isActive)}/>):<Empty title={hasQuery?'No matches':`No active ${tabConfig[tab].label.toLocaleLowerCase('en-US')} yet`} body={hasQuery?`No active ${tabConfig[tab].label.toLocaleLowerCase('en-US')} match "${search.trim()}".`:'Add one above to get started.'} onClearSearch={hasQuery?()=>setSearch(''):undefined}/>}

      <TouchableOpacity activeOpacity={.75} style={styles.inactiveBand} onPress={toggleInactiveSection} accessibilityRole="button" accessibilityState={{expanded:inactiveOpen}} accessibilityLabel={`Inactive ${tabConfig[tab].label}, ${inactiveAll.length} record${inactiveAll.length===1?'':'s'}`}>
        <View style={styles.flex}>
          <Text style={styles.inactiveBandTitle}>Inactive {tabConfig[tab].label}</Text>
          <Text style={styles.inactiveBandHint}>{inactiveOpen?'Tap to hide':'Tap to view'} · {inactiveAll.length} record{inactiveAll.length===1?'':'s'}</Text>
        </View>
        <View style={styles.inactiveHeaderRight}><View style={styles.countBadge}><Text style={styles.countBadgeText}>{inactiveAll.length}</Text></View><Text style={styles.expandMark}>{inactiveOpen?'×':'+'}</Text></View>
      </TouchableOpacity>
      {inactiveOpen?(inactiveVisible.length?inactiveVisible.map(record=><Record key={record.id} record={record} busy={busy} onEdit={()=>onRecordPress(tab,record.id)} onToggle={()=>requestToggle(tab,record.id,record.title,record.isActive)}/>):<Empty title={hasQuery?'No matches':`No inactive ${tabConfig[tab].label.toLocaleLowerCase('en-US')}`} body={hasQuery?`No inactive ${tabConfig[tab].label.toLocaleLowerCase('en-US')} match "${search.trim()}".`:`${tabConfig[tab].label} you deactivate will appear here.`} onClearSearch={hasQuery?()=>setSearch(''):undefined}/>):null}
    </>}
  </ScrollView>;
}

function Tab({label,selected,onPress}:{label:string;selected:boolean;onPress:()=>void}){return <TouchableOpacity style={[styles.tab,selected&&styles.tabSelected]} onPress={onPress} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{selected}}><Text style={[styles.tabText,selected&&styles.tabTextSelected]}>{label}</Text></TouchableOpacity>;}
function Card({title,children}:{title:string;children:React.ReactNode}){return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{children}</View>;}
function Record({record,busy,onEdit,onToggle}:{record:DirectoryRecord;busy:boolean;onEdit:()=>void;onToggle:()=>void}){
  return <View style={[styles.record,!record.isActive&&styles.recordInactive]}>
    <View style={styles.recordTop}>
      <View style={[styles.avatar,record.isActive?styles.avatarActive:styles.avatarInactive]}><Text style={[styles.avatarText,!record.isActive&&styles.avatarTextInactive]}>{initials(record.title)}</Text></View>
      <View style={styles.flex}>
        <Text style={styles.recordTitle} numberOfLines={1}>{record.title}</Text>
        <Text style={styles.helper} numberOfLines={1}>{record.detail||'No additional information'}</Text>
      </View>
      <View style={[styles.statusPill,record.isActive?styles.statusPillActive:styles.statusPillInactive]}>
        <View style={[styles.statusDot,record.isActive?styles.statusDotActive:styles.statusDotInactive]}/>
        <Text style={[styles.statusPillText,record.isActive?styles.statusPillTextActive:styles.statusPillTextInactive]}>{record.isActive?'Active':'Inactive'}</Text>
      </View>
    </View>
    {record.notes?<Text style={styles.notes}>{record.notes}</Text>:null}
    <View style={styles.recordActions}>
      <TouchableOpacity style={styles.editChip} disabled={busy} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit information for ${record.title}`} accessibilityState={{disabled:busy,busy}}><Text style={styles.editChipText}>Edit information</Text></TouchableOpacity>
      <TouchableOpacity style={styles.toggleChip} disabled={busy} onPress={onToggle} accessibilityRole="button" accessibilityLabel={record.isActive?`Deactivate ${record.title}`:`Reactivate ${record.title}`} accessibilityState={{disabled:busy,busy}}><Text style={styles.toggleChipText}>{record.isActive?'Deactivate':'Reactivate'}</Text></TouchableOpacity>
    </View>
  </View>;
}
function Field({label,...props}:{label:string;value:string;onChangeText:(value:string)=>void;multiline?:boolean;keyboardType?:'default'|'phone-pad'|'number-pad';autoCapitalize?:'none'|'sentences'|'characters'}){return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input,props.multiline&&styles.multiline]} placeholderTextColor="#89939B" accessibilityLabel={label} {...props}/></View>;}
function Save({label,busy,onPress}:{label:string;busy:boolean;onPress:()=>void}){return <TouchableOpacity style={styles.save} disabled={busy} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:busy,busy}}><Text style={styles.saveText}>{busy?'Saving…':label}</Text></TouchableOpacity>;}
function Empty({title,body,onClearSearch}:{title:string;body:string;onClearSearch?:()=>void}){return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.helper}>{body}</Text>{onClearSearch?<TouchableOpacity style={styles.emptyClear} onPress={onClearSearch} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={styles.emptyClearText}>Clear search</Text></TouchableOpacity>:null}</View>;}

const styles=StyleSheet.create({
  loading:{alignItems:'center',justifyContent:'center',gap:10,paddingVertical:30},
  content:{padding:20,paddingBottom:42,gap:15},
  flex:{flex:1,minWidth:0},helper:{color:colors.muted,fontSize:12,lineHeight:18},
  hero:{backgroundColor:colors.navy,borderRadius:18,padding:18,gap:12,shadowColor:colors.navyDeep,shadowOpacity:.22,shadowRadius:8,shadowOffset:{width:0,height:4},elevation:4},
  heroTopRow:{flexDirection:'row',alignItems:'center',gap:12},
  heroBack:{minHeight:48,minWidth:48,paddingHorizontal:14,borderRadius:10,backgroundColor:'rgba(255,255,255,0.14)',alignItems:'center',justifyContent:'center'},heroBackText:{color:'#FFF8ED',fontWeight:'800'},
  heroEyebrow:{color:'#F2A184',fontSize:11,fontWeight:'900',letterSpacing:1.4},heroTitle:{color:'#FFF8ED',fontSize:26,fontWeight:'900',marginTop:2},
  heroPurpose:{color:'#D5E4EF',fontSize:12,lineHeight:17},
  heroSummaryRow:{flexDirection:'row',gap:12,marginTop:2,paddingTop:12,borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.22)'},
  heroSummaryItem:{flex:1,gap:2},heroSummaryValue:{color:'#FFF8ED',fontSize:20,fontWeight:'900'},heroSummaryLabel:{color:'#D5E4EF',fontSize:9,fontWeight:'800',letterSpacing:.6},
  error:{color:colors.danger,backgroundColor:'#FCE8E6',padding:12,borderRadius:10,fontWeight:'700'},success:{color:colors.success,backgroundColor:'#E5F3EC',padding:12,borderRadius:10,fontWeight:'700'},
  tabGroups:{flexDirection:'row',gap:12},tabGroup:{flex:1,gap:7},tabGroupLabel:{color:colors.muted,fontSize:10,fontWeight:'900',letterSpacing:1},
  tabRow:{flexDirection:'row',gap:7},
  tab:{minHeight:48,flex:1,justifyContent:'center',borderWidth:1,borderColor:colors.line,paddingHorizontal:8,borderRadius:10,alignItems:'center',backgroundColor:colors.surface},
  tabSelected:{borderColor:colors.brand,backgroundColor:'#FBE9E4'},tabText:{color:colors.muted,fontWeight:'800',fontSize:12},tabTextSelected:{color:colors.brandDark},
  card:{backgroundColor:colors.surface,borderRadius:16,padding:17,gap:12},cardTitle:{color:colors.ink,fontSize:19,fontWeight:'900'},
  field:{gap:6},label:{color:colors.ink,fontSize:13,fontWeight:'800'},input:{minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,paddingVertical:11,color:colors.ink,backgroundColor:'#FCFBF8'},multiline:{minHeight:70,textAlignVertical:'top'},
  save:{minHeight:48,backgroundColor:colors.ink,borderRadius:11,padding:14,alignItems:'center',justifyContent:'center'},saveText:{color:'#FFF',fontWeight:'900'},
  cancelEditWrap:{minHeight:44,alignItems:'center',justifyContent:'center'},cancelEdit:{color:colors.muted,fontWeight:'900',textAlign:'center'},
  searchBar:{flexDirection:'row',alignItems:'center',gap:10,minHeight:52,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:14,shadowColor:'#17212B',shadowOpacity:.05,shadowRadius:4,shadowOffset:{width:0,height:2},elevation:1},
  searchGlyph:{color:colors.brand,fontSize:19,fontWeight:'900'},searchInput:{flex:1,color:colors.ink,fontSize:14,fontWeight:'600',paddingVertical:12},
  searchClear:{minHeight:32,minWidth:32,borderRadius:16,backgroundColor:'#EEEAE2',alignItems:'center',justifyContent:'center'},searchClearText:{color:colors.muted,fontSize:16,fontWeight:'900',lineHeight:18},
  sectionHeadingRow:{flexDirection:'row',alignItems:'center',gap:8},sectionTitle:{color:colors.ink,fontSize:18,fontWeight:'900'},
  sectionCount:{color:colors.brandDark,backgroundColor:'#FBE9E4',paddingHorizontal:9,paddingVertical:3,borderRadius:11,fontWeight:'900',fontSize:11},
  record:{backgroundColor:colors.surface,borderRadius:13,padding:14,gap:8},recordInactive:{opacity:.85,borderWidth:1,borderColor:colors.line},
  recordTop:{flexDirection:'row',alignItems:'center',gap:10},
  avatar:{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center'},avatarActive:{backgroundColor:'#E8F0F6'},avatarInactive:{backgroundColor:'#EEEAE3'},
  avatarText:{color:colors.navy,fontWeight:'900',fontSize:13},avatarTextInactive:{color:colors.muted},
  recordTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},
  statusPill:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:9,paddingVertical:5,borderRadius:12,flexShrink:0},
  statusPillActive:{backgroundColor:'#E5F3EC'},statusPillInactive:{backgroundColor:'transparent',borderWidth:1,borderColor:colors.line},
  statusDot:{width:6,height:6,borderRadius:3},statusDotActive:{backgroundColor:colors.success},statusDotInactive:{backgroundColor:colors.muted},
  statusPillText:{fontWeight:'900',fontSize:10},statusPillTextActive:{color:colors.success},statusPillTextInactive:{color:colors.muted},
  recordActions:{flexDirection:'row',flexWrap:'wrap',gap:8},
  editChip:{minHeight:44,justifyContent:'center',borderWidth:1,borderColor:colors.brand,borderRadius:9,paddingHorizontal:12},editChipText:{color:colors.brandDark,fontSize:12,fontWeight:'900'},
  toggleChip:{minHeight:44,justifyContent:'center',borderWidth:1,borderColor:colors.navy,borderRadius:9,paddingHorizontal:12},toggleChipText:{color:colors.navy,fontSize:12,fontWeight:'900'},
  notes:{color:colors.muted,fontSize:12,fontStyle:'italic'},
  inactiveBand:{minHeight:56,backgroundColor:colors.creamSoft,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},
  inactiveBandTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},inactiveBandHint:{color:colors.muted,fontSize:11,marginTop:2},
  inactiveHeaderRight:{flexDirection:'row',alignItems:'center',gap:10},
  countBadge:{minWidth:26,height:26,borderRadius:13,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,alignItems:'center',justifyContent:'center',paddingHorizontal:6},countBadgeText:{color:colors.brandDark,fontWeight:'900',fontSize:12},
  expandMark:{color:colors.brandDark,fontSize:24,fontWeight:'700',width:22,textAlign:'center'},
  empty:{borderWidth:1,borderColor:colors.line,borderStyle:'dashed',borderRadius:14,padding:18,gap:5},emptyTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},
  emptyClear:{minHeight:40,justifyContent:'center',alignSelf:'flex-start',marginTop:2},emptyClearText:{color:colors.brandDark,fontWeight:'900',fontSize:12},
});
