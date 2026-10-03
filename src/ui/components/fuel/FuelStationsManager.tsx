import {useState} from 'react';
import {Alert,LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {FuelStation,FuelStationDraft} from '../../../domain/fuel';
import {colors,radius} from '../../theme';
import {AppButton,AppCard,AppField,EmptyState,Feedback} from '../AppPrimitives';
import {useReducedMotion} from '../ExpandableMenu';

type StationActions={createFuelStation:(draft:FuelStationDraft)=>Promise<unknown>;renameFuelStation:(id:string,name:string)=>Promise<unknown>;setFuelStationActive:(id:string,isActive:boolean)=>Promise<unknown>};

/**
 * DEC-492. The saved list of outside fuel stations. A station is deactivated rather than removed, so every
 * fill already recorded from it keeps its station name. There is no payment or balance for a station.
 */
export function FuelStationsManager({stations,actions,onChanged}:{stations:FuelStation[];actions:StationActions;onChanged:()=>Promise<void>}){
  const[name,setName]=useState(''),[location,setLocation]=useState('');
  const[editing,setEditing]=useState<{id:string;name:string}|null>(null);
  const[inactiveOpen,setInactiveOpen]=useState(false);
  const[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
  const reducedMotion=useReducedMotion();
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};
  const active=stations.filter(station=>station.isActive),inactive=stations.filter(station=>!station.isActive);

  const run=async(action:()=>Promise<unknown>,success:string)=>{setBusy(true);setError(null);setMessage(null);try{await action();await onChanged();animate();setMessage(success);}catch(cause){setError(cause instanceof Error?cause.message:'The fuel station could not be saved.');}finally{setBusy(false);}};
  const confirmDeactivate=(station:FuelStation)=>Alert.alert(`Deactivate ${station.name}?`,'It will no longer be offered for new fills. Fills already recorded from it keep showing its name.',[{text:'Keep station',style:'cancel'},{text:'Deactivate',style:'destructive',onPress:()=>void run(()=>actions.setFuelStationActive(station.id,false),`${station.name} was deactivated. Its recorded fills are unchanged.`)}]);

  const row=(station:FuelStation)=>editing?.id===station.id
    ?<View key={station.id} style={styles.row}>
      <AppField label="Station name *" value={editing.name} onChangeText={next=>setEditing({id:station.id,name:next})} autoFocus accessibilityLabel={`New name for ${station.name}`}/>
      <View style={styles.actions}>
        <View style={styles.flex}><AppButton label="Save Name" tone="navy" busy={busy} disabled={!editing.name.trim()} onPress={()=>void run(async()=>{await actions.renameFuelStation(station.id,editing.name);setEditing(null);},'Station renamed. Fills already recorded keep the name they were saved with.')}/></View>
        <View style={styles.flex}><AppButton label="Keep Name" tone="secondary" onPress={()=>{animate();setEditing(null);}}/></View>
      </View>
    </View>
    :<View key={station.id} style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.flex}>
          <Text style={[styles.name,!station.isActive&&styles.nameInactive]}>{station.name}</Text>
          {station.location?<Text style={styles.location}>{station.location}</Text>:null}
        </View>
        {station.isActive?null:<Text style={styles.inactiveTag}>Inactive</Text>}
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.smallButton} disabled={busy} onPress={()=>{animate();setError(null);setMessage(null);setEditing({id:station.id,name:station.name});}} accessibilityRole="button" accessibilityLabel={`Rename ${station.name}`}><Text style={styles.smallText}>Rename</Text></TouchableOpacity>
        {station.isActive
          ?<TouchableOpacity style={[styles.smallButton,styles.smallDanger]} disabled={busy} onPress={()=>confirmDeactivate(station)} accessibilityRole="button" accessibilityLabel={`Deactivate ${station.name}`}><Text style={[styles.smallText,styles.dangerText]}>Deactivate</Text></TouchableOpacity>
          :<TouchableOpacity style={styles.smallButton} disabled={busy} onPress={()=>void run(()=>actions.setFuelStationActive(station.id,true),`${station.name} is active again.`)} accessibilityRole="button" accessibilityLabel={`Reactivate ${station.name}`}><Text style={styles.smallText}>Reactivate</Text></TouchableOpacity>}
      </View>
    </View>;

  return <>
    <AppCard title="Fuel Stations" hint="Stations where equipment is sometimes filled outside your own tank. Station fills are kept for history only: they never change the tank, and there is no payment or balance for a station.">
      {error?<Feedback kind="error">{error}</Feedback>:null}
      {message?<Feedback kind="success">{message}</Feedback>:null}
      <AppField label="New station name *" value={name} onChangeText={setName} autoCapitalize="words" returnKeyType="next"/>
      <AppField label="Location (optional)" value={location} onChangeText={setLocation} autoCapitalize="words" returnKeyType="done"/>
      <AppButton label="Add Station" tone="navy" busy={busy} disabled={!name.trim()} onPress={()=>void run(async()=>{await actions.createFuelStation({name,location,notes:''});setName('');setLocation('');},'Station added. Choose it on an Outside station fill.')}/>
    </AppCard>

    <Text style={styles.sectionTitle}>Active stations  {active.length}</Text>
    {active.length?<View style={styles.list}>{active.map(row)}</View>:<EmptyState title="No active stations" body="Add a station to record fuel bought outside your tank. It will then appear on every Outside station fill."/>}

    {inactive.length?<View style={styles.inactiveGroup}>
      <TouchableOpacity style={styles.inactiveHeader} onPress={()=>{animate();setInactiveOpen(value=>!value);}} accessibilityRole="button" accessibilityState={{expanded:inactiveOpen}} accessibilityLabel={`Inactive stations, ${inactive.length}`}>
        <Text style={styles.inactiveTitle}>Inactive stations  {inactive.length}</Text><Text style={styles.expand}>{inactiveOpen?'−':'+'}</Text>
      </TouchableOpacity>
      {inactiveOpen?<View style={styles.list}>{inactive.map(row)}</View>:null}
    </View>:null}
  </>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  sectionTitle:{color:colors.navy,fontSize:12,fontWeight:'900',letterSpacing:1,textTransform:'uppercase'},
  list:{gap:10},
  row:{backgroundColor:colors.surface,borderRadius:radius.lg,padding:14,gap:10,borderWidth:1,borderColor:'#E8DED0'},
  rowTop:{flexDirection:'row',alignItems:'flex-start',gap:10},
  name:{color:colors.ink,fontSize:15,fontWeight:'900',flexShrink:1},
  nameInactive:{color:colors.muted},
  location:{color:colors.muted,fontSize:12,marginTop:2},
  inactiveTag:{color:colors.muted,fontSize:11,fontWeight:'900',borderWidth:1,borderColor:colors.line,borderRadius:6,paddingHorizontal:7,paddingVertical:2},
  actions:{flexDirection:'row',gap:10,flexWrap:'wrap'},
  smallButton:{minHeight:48,minWidth:96,paddingHorizontal:14,borderRadius:radius.md,borderWidth:1,borderColor:colors.navy,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface},
  smallDanger:{borderColor:colors.danger},
  smallText:{color:colors.navy,fontSize:13,fontWeight:'900'},
  dangerText:{color:colors.danger},
  inactiveGroup:{gap:10},
  inactiveHeader:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,borderRadius:radius.md,backgroundColor:colors.navy},
  inactiveTitle:{color:'#FFFFFF',fontSize:14,fontWeight:'900'},
  expand:{color:'#FFFFFF',fontSize:18,fontWeight:'900'},
});
