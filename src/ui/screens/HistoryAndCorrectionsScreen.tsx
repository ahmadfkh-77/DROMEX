import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {ConstructionLiftRepository} from '../../data/repositories/ConstructionLiftRepository';
import type {WallRepository} from '../../data/repositories/WallRepository';
import {liftHistoryEvents,type LiftHistoryEvent,type LiftHistoryEventKind} from '../../domain/constructionLiftReport';
import type {ConstructionLiftParentType} from '../../domain/wallConstructionLift';
import type {WallCorrectionEntry} from '../../domain/walls';
import {AppCard,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors,radius} from '../theme';

type Entry={source:string;entry:WallCorrectionEntry};
const kindLabels:Record<LiftHistoryEventKind,string>={created:'Lift created',stone:'Stone phase',concrete:'Concrete matrix',correction:'Correction'};

/**
 * DEC-466/469. One chronological timeline for this foundation or wall: when each lift was created,
 * when its Stone was placed, when its concrete matrix was poured, plus every reasoned correction to a
 * lift, a legacy composite record, or (for a wall) its own material records. Kept separate from every
 * entry form, never mixed into them. Before DEC-469 this screen read only correction history, so a
 * lift with a recorded Stone and concrete phase still showed an empty History.
 */
export function HistoryAndCorrectionsScreen({liftRepository,wallRepository,parentType,parentId,trail,onBack}:{
  liftRepository:ConstructionLiftRepository;wallRepository:WallRepository;parentType:ConstructionLiftParentType;parentId:string;trail:string[];onBack:()=>void;
}){
  const[events,setEvents]=useState<LiftHistoryEvent[]|null>(null);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const lifts=parentType==='foundation'?await liftRepository.listLiftsForFoundation(parentId):await liftRepository.listLiftsForWall(parentId);
    const liftEvents=liftHistoryEvents(lifts);
    let materialEntries:Entry[]=[];
    if(parentType==='foundation'){
      const composition=await wallRepository.getFoundationComposition(parentId);
      materialEntries=(composition?.records??[]).flatMap(record=>record.correctionHistory.map(entry=>({source:`Legacy ${record.materialType==='stone'?'Stone':'Ready Mix'} record`,entry})));
    }else{
      const detail=await wallRepository.getWall(parentId);
      materialEntries=detail.entries.flatMap(consumption=>consumption.correctionHistory.map(entry=>({source:'Wall material record',entry})));
    }
    const materialEvents:LiftHistoryEvent[]=materialEntries.map(item=>({
      at:item.entry.correctedAt,source:item.source,kind:'correction',summary:`Corrected: ${item.entry.reason}`,
      changes:item.entry.changes.map(change=>({field:change.field,originalValue:change.originalValue,newValue:change.newValue})),
    }));
    setEvents([...liftEvents,...materialEvents].sort((first,second)=>second.at.localeCompare(first.at)));
  },[liftRepository,wallRepository,parentType,parentId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load history.'));},[refresh]);

  return <View style={styles.screen}>
    <PageHeader eyebrow="HISTORY AND CORRECTIONS" title={parentType==='foundation'?'Foundation History':'Wall History'} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'History']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {events===null?null:events.length===0?<EmptyState title="Nothing recorded yet" body="Once a lift is created and its Stone and concrete phases are recorded, they appear here in order, together with any reasoned corrections and their before/after values."/>:
      events.map((event,index)=><AppCard key={`${event.at}-${index}`}>
        <Text style={styles.source}>{event.source} · {kindLabels[event.kind]} · {event.at.slice(0,10)}</Text>
        <Text style={styles.reason}>{event.summary}</Text>
        {event.changes.map(change=><View key={change.field} style={styles.changeRow}>
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
