import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {WallRepository} from '../../data/repositories/WallRepository';
import {layerRowsFromDrafts,WallLayersEditor,type LayerRowForm} from '../components/WallLayersEditor';
import {emptyWallUseForm,wallDraftFromForm,WallConsumptionForm} from '../components/WallConsumptionForm';
import {AppCard,Feedback,MetricCard,PageHeader} from '../components/AppPrimitives';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {WallDiagramView} from '../components/WallDiagramView';
import type {SavedConcretePurpose,Wall,WallConsumption} from '../../domain/walls';
import {colors} from '../theme';

/** DEC-466. The wall's own layers and recorded materials -- unchanged from the pre-Lift workflow, now its own dedicated screen. */
export function WallMaterialsScreen({repository,wallId,trail,onBack}:{repository:WallRepository;wallId:string;trail:string[];onBack:()=>void}){
  const[wall,setWall]=useState<Wall|null>(null);
  const[entries,setEntries]=useState<WallConsumption[]>([]);
  const[layers,setLayers]=useState<LayerRowForm[]>([]);
  const[purposes,setPurposes]=useState<SavedConcretePurpose[]>([]);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[message,setMessage]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const[detail,nextPurposes]=await Promise.all([repository.getWall(wallId),repository.listConcretePurposes()]);
    setWall(detail.wall);setEntries(detail.entries);setLayers(layerRowsFromDrafts(detail.layers));setPurposes(nextPurposes);
  },[repository,wallId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this wall.'));},[refresh]);

  if(!wall)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  return <View style={styles.screen}>
    <PageHeader eyebrow="LAYERS AND MATERIALS" title={wall.name} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'Materials']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {message?<Feedback kind="success">{message}</Feedback>:null}

    <View style={styles.metrics}>
      <MetricCard label="Material records" value={String(entries.length)}/>
      <MetricCard label="Layers recorded" value={String(layers.length)}/>
    </View>

    <AppCard title="Wall drawing and layers">
      <WallDiagramView input={{wall:{name:wall.name,lengthM:wall.lengthM,heightM:wall.heightM,bottomThicknessM:wall.bottomThicknessM,topThicknessM:wall.topThicknessM},layers:[],base:null}} caption="Generated from this wall's own data."/>
      <WallLayersEditor rows={layers} wall={wall} busy={busy} onChange={setLayers} onSave={drafts=>{
        setBusy(true);
        void repository.saveLayers(wall.id,drafts).then(async()=>{await refresh();setMessage(drafts.length?'Wall layers saved.':'Layers cleared.');}).finally(()=>setBusy(false));
      }}/>
    </AppCard>

    <AppCard title="Record consumed materials">
      <WallConsumptionForm mode="add" initial={emptyWallUseForm()} wall={wall} savedPurposes={purposes}
        onCreatePurpose={async label=>{const created=await repository.createConcretePurpose(label);setPurposes(await repository.listConcretePurposes());return created;}}
        onSubmit={async form=>{await repository.addConsumption(wallDraftFromForm(form,wall.id));await refresh();setMessage('Wall consumption recorded.');}}/>
    </AppCard>
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  metrics:{flexDirection:'row',gap:8},
});
