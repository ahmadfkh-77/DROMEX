import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import type {WorkspaceRepository} from '../../data/repositories/WorkspaceRepository';
import {attentionGroups,attentionSectionFor,attentionSections,attentionSummary} from '../../domain/attention';
import type {AttentionSnapshot,GlobalSearchRoute} from '../../domain/workspace';
import {AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {countMeaningfulStoredDrafts} from '../draftRecognition';
import {colors} from '../theme';

type Item={key:keyof AttentionSnapshot|'otherDrafts';title:string;hint:string;route:GlobalSearchRoute|'drafts'|'attention';tone:'danger'|'warning'|'navy'};
const items:Item[]=[{key:'missingReportsToday',title:'Missing Daily Reports',hint:'Active projects with a load today but no daily report.',route:'reports',tone:'danger'},{key:'blockedSchedule',title:'Blocked Scheduled Work',hint:'Planned work explicitly marked Blocked.',route:'schedule',tone:'danger'},{key:'openIssues',title:'Open Project Issues',hint:'Project blockers and follow-up work still open.',route:'projects',tone:'warning'},{key:'unpricedLoads',title:'Unpriced Receipts',hint:'Confirmed loads that still need a price.',route:'loads',tone:'warning'},{key:'outstandingRecords',title:'Outstanding Balances',hint:'Unpaid or partially paid customer and supplier records.',route:'financials',tone:'warning'},{key:'incompleteWaste',title:'Incomplete Waste Details',hint:'Active dumps missing material, location, driver, or truck.',route:'waste',tone:'warning'},{key:'syncPending',title:'Pending Synchronization',hint:'Local changes waiting in the offline synchronization queue.',route:'attention',tone:'navy'},{key:'loadDrafts',title:'Receipt Drafts',hint:'Unfinished outgoing-load entries saved locally.',route:'drafts',tone:'navy'},{key:'otherDrafts',title:'Other Drafts',hint:'Unfinished daily report, quarry, fuel, or Quick Text work.',route:'drafts',tone:'navy'}];

/** Needs Attention, the quiet list (DEC-534): one plain heading with the count, then one white list grouped by how soon each item needs you. Every item opens the same screen as before. */
export function AttentionScreen({repository,onBack,onOpen}:{repository:WorkspaceRepository;onBack:()=>void;onOpen:(route:GlobalSearchRoute|'drafts')=>void}){
  const[snapshot,setSnapshot]=useState<AttentionSnapshot|null>(null);const[otherDrafts,setOtherDrafts]=useState(0);const[error,setError]=useState<string|null>(null);
  const refresh=useCallback(async()=>{const[next,keys]=await Promise.all([repository.getAttentionSnapshot(),Storage.getAllKeys()]);const draftKeys=keys.filter(key=>key.startsWith('dromex.draft.'));const values=await Promise.all(draftKeys.map(key=>Storage.getItem(key)));setSnapshot(next);setOtherDrafts(countMeaningfulStoredDrafts(draftKeys.map((key,index)=>[key,values[index]??null])));},[repository]);
  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Needs Attention could not be loaded.'));},[refresh]);
  if(!snapshot)return <View style={styles.loading}><Text style={styles.helper}>Checking records that need attention…</Text></View>;
  const active=items.map(item=>({...item,count:item.key==='otherDrafts'?otherDrafts:snapshot[item.key]})).filter(item=>item.count>0);
  const groups=attentionGroups(snapshot,otherDrafts);
  return <AppPage>
    <PageHeader eyebrow="DAILY CONTROL" title="Needs Attention" onBack={onBack}/>
    <View accessible accessibilityLabel={groups.total?`${groups.total} item${groups.total===1?'':'s'} to review. ${attentionSummary(groups)}`:'Nothing needs attention'}>
      <Text style={styles.big}>{groups.total?`${groups.total} to review`:'All clear'}</Text>
      <Text style={styles.sub}>{groups.total?attentionSummary(groups):'All records are in order.'}</Text>
    </View>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {active.length?<View style={styles.list}>
      {attentionSections.map(section=>{
        const rows=active.filter(item=>attentionSectionFor(item.tone)===section.key);
        if(!rows.length)return null;
        return <View key={section.key}>
          <Text style={styles.sectionTitle} accessibilityRole="header">{section.title}</Text>
          {rows.map(item=>{const opens=item.route!=='attention';const tint=item.tone==='danger'?colors.danger:item.tone==='warning'?colors.warning:colors.navy;return <TouchableOpacity key={item.key} style={styles.item} onPress={()=>{if(item.route!=='attention')onOpen(item.route);}} disabled={!opens} accessibilityRole={opens?'button':'text'} accessibilityLabel={`${item.title}. ${item.count}. ${item.hint}`}>
            <View style={[styles.dot,{backgroundColor:tint}]}/>
            <View style={styles.flex}><Text style={styles.title}>{item.title}</Text><Text style={styles.hint}>{item.hint}</Text></View>
            <Text style={[styles.count,{color:tint}]}>{item.count}</Text>
            {opens?<Text style={styles.arrow} importantForAccessibility="no">›</Text>:<View style={styles.arrowSpace}/>}
          </TouchableOpacity>;})}
        </View>;
      })}
    </View>:<EmptyState title="Nothing needs attention" body="No missing reports, blocked work, open issues, incomplete dumps, drafts, or outstanding record alerts were found."/>}
  </AppPage>;
}
const styles=StyleSheet.create({
  loading:{flex:1,alignItems:'center',justifyContent:'center'},
  helper:{color:colors.muted,fontSize:12},
  big:{color:colors.navy,fontSize:34,fontWeight:'900',lineHeight:38},
  sub:{color:colors.muted,fontSize:13,marginTop:3},
  flex:{flex:1,minWidth:0},
  list:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:colors.line,overflow:'hidden'},
  sectionTitle:{color:colors.muted,fontSize:11,fontWeight:'800',letterSpacing:1.4,paddingHorizontal:14,paddingTop:12,paddingBottom:4},
  item:{minHeight:62,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:10,paddingHorizontal:14,borderTopWidth:1,borderTopColor:'#EFEBE3'},
  dot:{width:10,height:10,borderRadius:5},
  title:{color:colors.ink,fontSize:14,fontWeight:'800'},
  hint:{color:colors.muted,fontSize:11,lineHeight:15,marginTop:1},
  count:{fontSize:17,fontWeight:'900'},
  arrow:{color:colors.muted,fontSize:22,width:14,textAlign:'center'},
  arrowSpace:{width:14},
});
