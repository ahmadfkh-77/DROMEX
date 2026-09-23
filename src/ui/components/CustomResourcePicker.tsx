import {StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';

import {
  addCustomResourceEntry,removeCustomResourceEntry,setCustomResourceNote,CUSTOM_REPORT_NOTE_MAX,
  type CustomDirectoryOption,type CustomResourceSnapshot,
} from '../../domain/customDirectories';
import {colors} from '../theme';
import {SearchableSelect} from './SearchableSelect';

/**
 * DEC-478. Selects entries from each Owner-defined directory for one Daily Report. Selecting copies the
 * entry into the report's snapshot at once, so the report keeps exactly what was chosen even if the
 * directory is renamed or archived later. A directory already in this report but since archived still
 * shows its recorded entries so they can be reviewed or removed; it just offers nothing new.
 */
export function CustomResourcePicker({options,value,onChange}:{options:CustomDirectoryOption[];value:CustomResourceSnapshot[];onChange:(next:CustomResourceSnapshot[])=>void}){
  const order=options.map(option=>option.directory.id);
  const archivedGroups=value.filter(group=>!options.some(option=>option.directory.id===group.directoryId));
  if(!options.length&&!archivedGroups.length)return <Text style={styles.helper}>No custom directories yet. Create groups such as Engineers or Generators in People & Equipment → Custom directories.</Text>;
  return <View style={styles.list}>
    {options.map(option=>{
      const group=value.find(snapshot=>snapshot.directoryId===option.directory.id);
      const available=option.entries.filter(entry=>!group?.entries.some(selected=>selected.entryId===entry.id));
      return <View key={option.directory.id} style={styles.group}>
        <Text style={styles.heading}>{group?.directoryName??option.directory.name}</Text>
        {group?group.entries.map(entry=><SelectedEntry key={entry.entryId} directoryId={group.directoryId} entry={entry} value={value} onChange={onChange}/>):<Text style={styles.helper}>None selected for this report.</Text>}
        {available.length?<SearchableSelect label={`Add from ${option.directory.name}`} options={available.map(entry=>({id:entry.id,label:entry.name,detail:entry.identifier??undefined}))} selectedId="" placeholder="Choose an entry"
          onSelect={id=>{const entry=option.entries.find(candidate=>candidate.id===id);if(entry)onChange(addCustomResourceEntry(value,option.directory,entry,order));}}/>:null}
      </View>;
    })}
    {archivedGroups.map(group=><View key={group.directoryId} style={styles.group}>
      <Text style={styles.heading}>{group.directoryName}</Text>
      <Text style={styles.helper}>This directory is archived. Its entries stay on this report as recorded.</Text>
      {group.entries.map(entry=><SelectedEntry key={entry.entryId} directoryId={group.directoryId} entry={entry} value={value} onChange={onChange}/>)}
    </View>)}
  </View>;
}

function SelectedEntry({directoryId,entry,value,onChange}:{directoryId:string;entry:CustomResourceSnapshot['entries'][number];value:CustomResourceSnapshot[];onChange:(next:CustomResourceSnapshot[])=>void}){
  return <View style={styles.entry}>
    <View style={styles.entryTop}>
      <View style={styles.flex}><Text style={styles.entryName}>{entry.name}</Text>{entry.identifier?<Text style={styles.helper}>{entry.identifier}</Text>:null}</View>
      <TouchableOpacity style={styles.remove} onPress={()=>onChange(removeCustomResourceEntry(value,directoryId,entry.entryId))} accessibilityRole="button" accessibilityLabel={`Remove ${entry.name} from this report`}><Text style={styles.removeText}>Remove</Text></TouchableOpacity>
    </View>
    <TextInput style={styles.note} value={entry.note??''} onChangeText={note=>onChange(setCustomResourceNote(value,directoryId,entry.entryId,note))} placeholder="Note for this report (optional)" placeholderTextColor="#89939B" maxLength={CUSTOM_REPORT_NOTE_MAX} accessibilityLabel={`Note for this report about ${entry.name}`}/>
  </View>;
}

const styles=StyleSheet.create({
  list:{gap:14},flex:{flex:1,minWidth:0},
  group:{gap:8,paddingTop:10,borderTopWidth:1,borderTopColor:colors.line},
  heading:{color:colors.navy,fontSize:14,fontWeight:'900'},
  helper:{color:colors.muted,fontSize:12,lineHeight:18},
  entry:{gap:6,padding:10,borderRadius:11,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface},
  entryTop:{flexDirection:'row',alignItems:'center',gap:8},
  entryName:{color:colors.ink,fontSize:14,fontWeight:'800'},
  remove:{minHeight:44,justifyContent:'center',paddingHorizontal:6},removeText:{color:colors.danger,fontSize:12,fontWeight:'900'},
  note:{minHeight:46,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:12,paddingVertical:10,color:colors.ink,backgroundColor:'#FCFBF8'},
});
