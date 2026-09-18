import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {WallRepository} from '../../data/repositories/WallRepository';
import {formatCubicMetres,type Wall} from '../../domain/walls';
import {AppCard,Feedback,MetricCard,PageHeader} from '../components/AppPrimitives';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors} from '../theme';

/**
 * DEC-466. Dedicated wall geometry and structural volume -- no Stone/Ready Mix entry here. The
 * repository has no wall-geometry correction endpoint yet, so this stays a live read summary of
 * the wall's recorded dimensions and calculated volume, not an edit form.
 */
export function WallGeometryScreen({repository,wallId,trail,onBack}:{repository:WallRepository;wallId:string;trail:string[];onBack:()=>void}){
  const[wall,setWall]=useState<Wall|null>(null);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{const detail=await repository.getWall(wallId);setWall(detail.wall);},[repository,wallId]);
  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this wall.'));},[refresh]);

  if(!wall)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  return <View style={styles.screen}>
    <PageHeader eyebrow="WALL GEOMETRY" title={wall.name} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'Geometry']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppCard title="Structural envelope">
      <Text style={styles.detail}>{wall.lengthM} m × {wall.heightM} m × {wall.bottomThicknessM===wall.topThicknessM?`${wall.bottomThicknessM} m`:`${wall.bottomThicknessM} to ${wall.topThicknessM} m`}</Text>
      <View style={styles.metrics}>
        <MetricCard label="Deductions" value={formatCubicMetres(wall.deductionM3)}/>
        <MetricCard label="Net structural volume" value={formatCubicMetres(wall.netVolumeM3)} result/>
        <MetricCard label="Planned volume (with allowance)" value={formatCubicMetres(wall.plannedVolumeM3)}/>
      </View>
    </AppCard>
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:8},
});
