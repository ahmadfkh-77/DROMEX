import {useState} from 'react';
import {Alert,LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {CompanySite} from '../../domain/fuel';
import {colors,radius} from '../theme';
import {AppButton,AppCard,AppField,EmptyState,Feedback} from './AppPrimitives';
import {useReducedMotion} from './ExpandableMenu';

type SiteActions={createCompanySite:(name:string)=>Promise<unknown>;renameCompanySite:(id:string,name:string)=>Promise<unknown>;setCompanySiteActive:(id:string,isActive:boolean)=>Promise<unknown>};

/**
 * DEC-438. Saved company sites for fuel destinations. A site is deactivated rather than removed, so
 * every fill already recorded to it keeps its destination.
 */
export function CompanySitesManager({sites,actions,onChanged}:{sites:CompanySite[];actions:SiteActions;onChanged:()=>Promise<void>}){
  const[newName,setNewName]=useState('');
  const[editing,setEditing]=useState<{id:string;name:string}|null>(null);
  const[inactiveOpen,setInactiveOpen]=useState(false);
  const[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
  const reducedMotion=useReducedMotion();
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};
  const active=sites.filter(site=>site.isActive),inactive=sites.filter(site=>!site.isActive);

  const run=async(action:()=>Promise<unknown>,success:string)=>{setBusy(true);setError(null);setMessage(null);try{await action();await onChanged();animate();setMessage(success);}catch(cause){setError(cause instanceof Error?cause.message:'The company site could not be saved.');}finally{setBusy(false);}};
  const confirmDeactivate=(site:CompanySite)=>Alert.alert(`Deactivate ${site.name}?`,'It will no longer be offered for new fills. Fills already recorded to it keep showing its name in fuel usage.',[{text:'Keep site',style:'cancel'},{text:'Deactivate',style:'destructive',onPress:()=>void run(()=>actions.setCompanySiteActive(site.id,false),`${site.name} deactivated. Its fill history is unchanged.`)}]);

  const row=(site:CompanySite)=>editing?.id===site.id
    ?<View key={site.id} style={styles.row}>
      <AppField label="Site name *" value={editing.name} onChangeText={name=>setEditing({id:site.id,name})} autoFocus accessibilityLabel={`New name for ${site.name}`}/>
      <View style={styles.actions}>
        <View style={styles.flex}><AppButton label="Save Name" tone="navy" busy={busy} disabled={!editing.name.trim()} onPress={()=>void run(async()=>{await actions.renameCompanySite(site.id,editing.name);setEditing(null);},'Site renamed. Its fills now show the new name.')}/></View>
        <View style={styles.flex}><AppButton label="Keep Name" tone="secondary" onPress={()=>{animate();setEditing(null);}}/></View>
      </View>
    </View>
    :<View key={site.id} style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={[styles.name,!site.isActive&&styles.nameInactive]}>{site.name}</Text>
        {site.isActive?null:<Text style={styles.inactiveTag}>Inactive</Text>}
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.smallButton} disabled={busy} onPress={()=>{animate();setError(null);setMessage(null);setEditing({id:site.id,name:site.name});}} accessibilityRole="button" accessibilityLabel={`Rename ${site.name}`}><Text style={styles.smallButtonText}>Rename</Text></TouchableOpacity>
        {site.isActive
          ?<TouchableOpacity style={[styles.smallButton,styles.smallDanger]} disabled={busy} onPress={()=>confirmDeactivate(site)} accessibilityRole="button" accessibilityLabel={`Deactivate ${site.name}`} accessibilityHint="Stops offering this site for new fills"><Text style={[styles.smallButtonText,styles.smallDangerText]}>Deactivate</Text></TouchableOpacity>
          :<TouchableOpacity style={styles.smallButton} disabled={busy} onPress={()=>void run(()=>actions.setCompanySiteActive(site.id,true),`${site.name} is active again.`)} accessibilityRole="button" accessibilityLabel={`Reactivate ${site.name}`} accessibilityHint="Offers this site for new fills again"><Text style={styles.smallButtonText}>Reactivate</Text></TouchableOpacity>}
      </View>
    </View>;

  return <>
    <AppCard title="Company Sites" hint="Saved company places that use fuel outside construction projects, such as the asphalt plant, main yard, workshop, or warehouse. Deactivating a site keeps every fill already recorded to it.">
      {error?<Feedback kind="error">{error}</Feedback>:null}
      {message?<Feedback kind="success">{message}</Feedback>:null}
      <AppField label="New company site name *" value={newName} onChangeText={setNewName} autoCapitalize="words" returnKeyType="done"/>
      <AppButton label="Add Company Site" tone="navy" busy={busy} disabled={!newName.trim()} onPress={()=>void run(async()=>{const name=newName;await actions.createCompanySite(name);setNewName('');},'Company site added. Choose it as the fuel destination on a fill.')}/>
    </AppCard>

    <Text style={styles.sectionTitle}>Active sites  {active.length}</Text>
    {active.length?<View style={styles.list}>{active.map(row)}</View>:<EmptyState title="No active company sites" body="Add the plant, yard, workshop, or warehouse that receives fuel. It will then appear under Fuel destination on every new fill."/>}

    {inactive.length?<View style={styles.inactiveGroup}>
      <TouchableOpacity style={styles.inactiveHeader} onPress={()=>{animate();setInactiveOpen(value=>!value);}} accessibilityRole="button" accessibilityState={{expanded:inactiveOpen}} accessibilityLabel={`Inactive sites, ${inactive.length}`}>
        <View style={styles.flex}><Text style={styles.inactiveTitle}>Inactive sites  {inactive.length}</Text><Text style={styles.helper}>Hidden from new fills. Their fill history stays in fuel usage.</Text></View>
        <Text style={styles.fold}>{inactiveOpen?'×':'+'}</Text>
      </TouchableOpacity>
      {inactiveOpen?<View style={styles.inactiveList}>{inactive.map(row)}</View>:null}
    </View>:null}
  </>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  sectionTitle:{color:colors.ink,fontSize:19,fontWeight:'900'},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  list:{gap:10},
  row:{gap:10,padding:15,borderRadius:radius.lg,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface},
  rowTop:{flexDirection:'row',alignItems:'center',gap:8},
  name:{flex:1,color:colors.ink,fontSize:16,fontWeight:'900'},
  nameInactive:{color:colors.muted},
  inactiveTag:{color:colors.muted,fontSize:11,fontWeight:'900',borderWidth:1,borderColor:colors.line,borderRadius:8,paddingHorizontal:6,paddingVertical:1},
  actions:{flexDirection:'row',gap:8},
  smallButton:{minHeight:48,minWidth:96,flexGrow:1,alignItems:'center',justifyContent:'center',paddingHorizontal:14,borderRadius:radius.md,borderWidth:1,borderColor:colors.navy,backgroundColor:colors.surface},
  smallButtonText:{color:colors.navy,fontSize:14,fontWeight:'900'},
  smallDanger:{borderColor:colors.danger},
  smallDangerText:{color:colors.danger},
  inactiveGroup:{borderRadius:radius.lg,borderWidth:1,borderColor:'#E8DED0',backgroundColor:colors.cream,overflow:'hidden'},
  inactiveHeader:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:15,paddingVertical:12},
  inactiveTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},
  inactiveList:{gap:10,padding:12,paddingTop:0},
  fold:{color:colors.brand,fontSize:24,fontWeight:'900',width:24,textAlign:'center'},
});
