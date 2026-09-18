import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {CyclopeanLiftRepository} from '../../data/repositories/CyclopeanLiftRepository';
import type {WallRepository} from '../../data/repositories/WallRepository';
import type {CyclopeanLiftParentType} from '../../domain/wallCyclopeanLift';
import type {WallCorrectionEntry} from '../../domain/walls';
import {AppCard,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors,radius} from '../theme';

type Entry={source:string;entry:WallCorrectionEntry};

/**
 * DEC-466. One chronological timeline of every correction recorded against this foundation's or
 * wall's Cyclopean Lifts, its legacy composite records (if any), and (for a wall) its own material
 * corrections -- kept separate from every entry form, never mixed into them.
 */
export function HistoryAndCorrectionsScreen({liftRepository,wallRepository,parentType,parentId,trail,onBack}:{
  liftRepository:CyclopeanLiftRepository;wallRepository:WallRepository;parentType:CyclopeanLiftParentType;parentId:string;trail:string[];onBack:()=>void;
}){
  const[entries,setEntries]=useState<Entry[]|null>(null);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const lifts=parentType==='foundation'?await liftRepository.listLiftsForFoundation(parentId):await liftRepository.listLiftsForWall(parentId);
    const liftEntries:Entry[]=lifts.flatMap(lift=>lift.correctionHistory.map(entry=>({source:`Lift ${lift.reference}`,entry})));
    let materialEntries:Entry[]=[];
    if(parentType==='foundation'){
      const composition=await wallRepository.getFoundationComposition(parentId);
      materialEntries=(composition?.records??[]).flatMap(record=>record.correctionHistory.map(entry=>({source:`Legacy ${record.materialType==='stone'?'Stone':'Ready Mix'} record`,entry})));
    }else{
      const detail=await wallRepository.getWall(parentId);
      materialEntries=detail.entries.flatMap(consumption=>consumption.correctionHistory.map(entry=>({source:'Wall material record',entry})));
    }
    const all=[...liftEntries,...materialEntries].sort((a,b)=>b.entry.correctedAt.localeCompare(a.entry.correctedAt));
    setEntries(all);
  },[liftRepository,wallRepository,parentType,parentId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load history.'));},[refresh]);

  return <View style={styles.screen}>
    <PageHeader eyebrow="HISTORY AND CORRECTIONS" title={parentType==='foundation'?'Foundation History':'Wall History'} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'History']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {entries===null?null:entries.length===0?<EmptyState title="No corrections recorded" body="Reasoned corrections to lifts and materials will appear here, chronologically, with before/after values."/>:
      entries.map((item,index)=><AppCard key={`${item.entry.correctedAt}-${index}`}>
        <Text style={styles.source}>{item.source} · {item.entry.correctedAt}</Text>
        <Text style={styles.reason}>{item.entry.reason}</Text>
        {item.entry.changes.map(change=><View key={change.field} style={styles.changeRow}>
          <Text style={styles.field}>{change.field}</Text>
          <Text style={styles.detail}>{change.originalValue??'(none)'} → {change.newValue??'(none)'}</Text>
        </View>)}
      </AppCard>)}
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  source:{color:colors.ink,fontSize:13,fontWeight:'900'},
  reason:{color:colors.muted,fontSize:12,fontWeight:'700',marginBottom:4},
  changeRow:{borderRadius:radius.sm,backgroundColor:colors.surface,paddingHorizontal:8,paddingVertical:6,marginTop:2},
  field:{color:colors.ink,fontSize:11,fontWeight:'800'},
});
