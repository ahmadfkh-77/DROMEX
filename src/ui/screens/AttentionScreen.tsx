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

/** Needs Attention (DEC-531): white text on navy for the count, and the rows grouped by how soon they need you. Every item still opens the same screen as before. */
export function AttentionScreen({repository,onBack,onOpen}:{repository:WorkspaceRepository;onBack:()=>void;onOpen:(route:GlobalSearchRoute|'drafts')=>void}){
  const[snapshot,setSnapshot]=useState<AttentionSnapshot|null>(null);const[otherDrafts,setOtherDrafts]=useState(0);const[error,setError]=useState<string|null>(null);
  const refresh=useCallback(async()=>{const[next,keys]=await Promise.all([repository.getAttentionSnapshot(),Storage.getAllKeys()]);const draftKeys=keys.filter(key=>key.startsWith('dromex.draft.'));const values=await Promise.all(draftKeys.map(key=>Storage.getItem(key)));setSnapshot(next);setOtherDrafts(countMeaningfulStoredDrafts(draftKeys.map((key,index)=>[key,values[index]??null])));},[repository]);
  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Needs Attention could not be loaded.'));},[refresh]);
  if(!snapshot)return <View style={styles.loading}><Text style={styles.helper}>Checking records that need attention…</Text></View>;
  const active=items.map(item=>({...item,count:item.key==='otherDrafts'?otherDrafts:snapshot[item.key]})).filter(item=>item.count>0);
  const groups=attentionGroups(snapshot,otherDrafts);
  return <AppPage>
    <PageHeader eyebrow="DAILY CONTROL" title="Needs Attention" onBack={onBack}/>
    <View style={styles.hero} accessible accessibilityLabel={groups.total?`${groups.total} item${groups.total===1?'':'s'} need review. ${attentionSummary(groups)}`:'Nothing needs attention'}>
      <Text style={styles.heroNumber}>{groups.total}</Text>
      <View style={styles.flex}><Text style={styles.heroTitle}>{groups.total===1?'item needs':'items need'} review</Text><Text style={styles.heroHint}>{groups.total?attentionSummary(groups):'All records are in order.'}</Text></View>
    </View>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {active.length?attentionSections.map(section=>{
      const rows=active.filter(item=>attentionSectionFor(item.tone)===section.key);
      if(!rows.length)return null;
      return <View key={section.key} style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{section.title}</Text>
        {rows.map(item=>{const opens=item.route!=='attention';return <TouchableOpacity key={item.key} style={[styles.item,item.tone==='danger'?styles.danger:item.tone==='warning'?styles.warning:styles.house]} onPress={()=>{if(item.route!=='attention')onOpen(item.route);}} disabled={!opens} accessibilityRole={opens?'button':'text'} accessibilityLabel={`${item.title}. ${item.count}. ${item.hint}`}>
          <View style={styles.flex}><Text style={styles.title}>{item.title}</Text><Text style={styles.hint}>{item.hint}</Text></View>
          <View style={[styles.count,item.tone==='danger'?styles.countDanger:item.tone==='warning'?styles.countWarning:styles.countHouse]}><Text style={styles.countText}>{item.count}</Text></View>
          {opens?<Text style={styles.arrow} importantForAccessibility="no">›</Text>:null}
        </TouchableOpacity>;})}
      </View>;
    }):<EmptyState title="Nothing needs attention" body="No missing reports, blocked work, open issues, incomplete dumps, drafts, or outstanding record alerts were found."/>}
  </AppPage>;
}
const styles=StyleSheet.create({
  loading:{flex:1,alignItems:'center',justifyContent:'center'},
  helper:{color:colors.muted,fontSize:12},
  hero:{backgroundColor:colors.navy,borderRadius:20,paddingVertical:16,paddingHorizontal:18,flexDirection:'row',alignItems:'center',gap:16,borderBottomWidth:5,borderBottomColor:colors.brand},
  heroNumber:{color:'#FFF',fontSize:48,fontWeight:'900',lineHeight:54},
  flex:{flex:1,minWidth:0},
  heroTitle:{color:'#FFF',fontSize:18,fontWeight:'800'},
  heroHint:{color:'#D5E4EF',fontSize:12,lineHeight:17,marginTop:3},
  section:{gap:8},
  sectionTitle:{color:colors.muted,fontSize:11,fontWeight:'800',letterSpacing:1.4,marginTop:6,marginLeft:2},
  item:{minHeight:68,borderRadius:14,borderWidth:1,borderColor:colors.line,borderLeftWidth:5,backgroundColor:colors.surface,paddingVertical:10,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:10},
  danger:{borderLeftColor:colors.danger},
  warning:{borderLeftColor:colors.warning},
  house:{borderLeftColor:colors.navy},
  title:{color:colors.ink,fontSize:14,fontWeight:'800'},
  hint:{color:colors.muted,fontSize:11,lineHeight:15,marginTop:2},
  count:{minWidth:34,height:34,borderRadius:17,alignItems:'center',justifyContent:'center',paddingHorizontal:6},
  countDanger:{backgroundColor:colors.danger},
  countWarning:{backgroundColor:colors.warning},
  countHouse:{backgroundColor:colors.navy},
  countText:{color:'#FFF',fontSize:14,fontWeight:'900'},
  arrow:{color:colors.brand,fontSize:25,fontWeight:'900'},
});
