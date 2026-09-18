import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {WallRepository} from '../../data/repositories/WallRepository';
import type {Foundation} from '../../domain/foundations';
import {AppCard,Feedback,PageHeader} from '../components/AppPrimitives';
import {FoundationCuringPanel} from '../components/FoundationCuringPanel';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors} from '../theme';

/** DEC-466. Curing on its own screen -- informational and non-blocking; it never locks any other screen. */
export function FoundationCuringScreen({repository,foundationId,trail,onBack,onChanged}:{
  repository:WallRepository;foundationId:string;trail:string[];onBack:()=>void;onChanged?:()=>void;
}){
  const[foundation,setFoundation]=useState<Foundation|null>(null);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const found=await repository.getFoundation(foundationId);
    if(!found)throw new Error('Foundation was not found.');
    setFoundation(found);
  },[repository,foundationId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this foundation.'));},[refresh]);

  if(!foundation)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  return <View style={styles.screen}>
    <PageHeader eyebrow="CURING" title={foundation.reference} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'Curing']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppCard>
      <FoundationCuringPanel foundation={foundation} busy={busy} onChangeStatus={async change=>{
        setBusy(true);setError(null);
        try{await repository.changeFoundationStatus(foundationId,change);await refresh();onChanged?.();}
        catch(cause){setError(cause instanceof Error?cause.message:'The status could not be saved.');}
        finally{setBusy(false);}
      }}/>
    </AppCard>
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
});
