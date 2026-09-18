import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {WallRepository} from '../../data/repositories/WallRepository';
import type {Foundation} from '../../domain/foundations';
import {formatCubicMetres} from '../../domain/walls';
import {AppButton,AppCard,AppField,Feedback,MetricCard,PageHeader} from '../components/AppPrimitives';
import {emptyFoundationForm,foundationDraftFrom,foundationFormFrom,FoundationGeometryForm,type FoundationGeometryFormValues} from '../components/FoundationGeometryForm';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors} from '../theme';

/**
 * DEC-466. Geometry only, live-calculated. Correcting it still goes through repository.correctFoundation,
 * which (a pre-existing repository contract this UI phase does not change) also carries the
 * foundation's own single recorded material/quantity field -- a separate, older concept from the
 * Cyclopean Lift material calculators, which never appear on this screen.
 */
export function FoundationGeometryScreen({repository,foundationId,trail,onBack,onChanged}:{
  repository:WallRepository;foundationId:string;trail:string[];onBack:()=>void;onChanged?:()=>void;
}){
  const[foundation,setFoundation]=useState<Foundation|null>(null);
  const[editing,setEditing]=useState(false);
  const[form,setForm]=useState<FoundationGeometryFormValues>(emptyFoundationForm());
  const[purposes,setPurposes]=useState<Awaited<ReturnType<WallRepository['listConcretePurposes']>>>([]);
  const[correctionReason,setCorrectionReason]=useState('');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[message,setMessage]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const[found,nextPurposes]=await Promise.all([repository.getFoundation(foundationId),repository.listConcretePurposes()]);
    if(!found)throw new Error('Foundation was not found.');
    setFoundation(found);setPurposes(nextPurposes);
    setForm(current=>editing?current:foundationFormFrom(found));
  },[repository,foundationId,editing]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this foundation.'));},[foundationId]);

  if(!foundation)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  return <View style={styles.screen}>
    <PageHeader eyebrow="FOUNDATION GEOMETRY" title={foundation.reference} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'Geometry']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {message?<Feedback kind="success">{message}</Feedback>:null}

    {!editing?<AppCard title="Structural envelope">
      <Text style={styles.detail}>{foundation.lengthM} m × {foundation.heightM} m × {foundation.bottomThicknessM===foundation.topThicknessM?`${foundation.bottomThicknessM} m`:`${foundation.bottomThicknessM} to ${foundation.topThicknessM} m`}</Text>
      <View style={styles.metrics}>
        <MetricCard label="Gross volume" value={formatCubicMetres(foundation.grossVolumeM3)}/>
        <MetricCard label="Deductions" value={formatCubicMetres(foundation.deductionM3)}/>
        <MetricCard label="Net structural volume" value={formatCubicMetres(foundation.netVolumeM3)} result/>
      </View>
      {foundation.correctionHistory.length?<Text style={styles.detail}>{foundation.correctionHistory.length} correction{foundation.correctionHistory.length===1?'':'s'} recorded, latest: {foundation.correctionHistory.at(-1)!.reason}</Text>:null}
      <AppButton label="Edit Geometry" tone="secondary" onPress={()=>{setForm(foundationFormFrom(foundation));setEditing(true);}}/>
    </AppCard>:<AppCard title="Correct geometry">
      <AppField label="Correction reason *" value={correctionReason} onChangeText={setCorrectionReason} multiline placeholder="Example: site survey re-measured"/>
      <FoundationGeometryForm form={form} onChange={patch=>setForm({...form,...patch})} savedPurposes={purposes} busy={busy} error={null} saveLabel="Save Correction"
        onCreatePurpose={async label=>{const created=await repository.createConcretePurpose(label);setPurposes(await repository.listConcretePurposes());return created;}}
        onSave={()=>{
          setBusy(true);setError(null);
          void repository.correctFoundation(foundationId,{...foundationDraftFrom(form,foundation.projectId,foundation.constructionSectionId),correctionReason})
            .then(async()=>{await refresh();onChanged?.();setEditing(false);setCorrectionReason('');setMessage('Foundation geometry corrected.');})
            .catch(cause=>setError(cause instanceof Error?cause.message:'The correction could not be saved.'))
            .finally(()=>setBusy(false));
        }}/>
      <AppButton label="Discard Changes" tone="secondary" onPress={()=>{setForm(foundationFormFrom(foundation));setEditing(false);setCorrectionReason('');}}/>
    </AppCard>}
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:8},
});
