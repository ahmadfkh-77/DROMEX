import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,View} from 'react-native';

import type {WallRepository} from '../../data/repositories/WallRepository';
import type {Foundation} from '../../domain/foundations';
import {calculateWallVolume,wallPurposeLabels,wallSystemLabels,type Wall,type WallDraft,type WallSystem} from '../../domain/walls';
import {AppButton,AppCard,AppField,Feedback,PageHeader} from '../components/AppPrimitives';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {SearchableSelect} from '../components/SearchableSelect';
import {colors} from '../theme';

const n=(value:string)=>{const parsed=Number(value.trim().replace(',','.'));return Number.isFinite(parsed)?parsed:0;};
type WallForm={name:string;system:WallSystem;purpose:WallDraft['purpose'];length:string;height:string;bottom:string;top:string;deduction:string;allowance:string;notes:string};
const emptyWallForm=(foundation:Foundation):WallForm=>({name:'',system:'cyclopean_concrete',purpose:'retaining',length:String(foundation.lengthM),height:'',bottom:String(foundation.bottomThicknessM),top:String(foundation.topThicknessM),deduction:'0',allowance:'0',notes:''});

/** DEC-466. Reached from Foundation Overview only while no wall is linked yet -- creates one permanently linked, or links an existing unlinked wall. */
export function WallLinkOrCreateScreen({repository,foundation,trail,onBack,onLinked}:{
  repository:WallRepository;foundation:Foundation;trail:string[];onBack:()=>void;onLinked:(wallId:string)=>void;
}){
  const[availableWalls,setAvailableWalls]=useState<Wall[]>([]);
  const[form,setForm]=useState<WallForm|null>(null);
  const[linkChoice,setLinkChoice]=useState<string|null>(null);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const allWalls=await repository.listWalls(foundation.projectId);
    setAvailableWalls(allWalls.filter(value=>!value.foundationId&&value.baseRequired));
  },[repository,foundation.projectId]);

  useEffect(()=>{void refresh();},[refresh]);

  async function createWall(){
    if(!form)return;
    setBusy(true);setError(null);
    try{
      const result=calculateWallVolume(n(form.length),n(form.height),n(form.bottom),n(form.top),n(form.deduction),n(form.allowance));
      if(result.netVolumeM3<=0)throw new Error('Wall net volume must be greater than zero.');
      const wall=await repository.saveWall({projectId:foundation.projectId,name:form.name,system:form.system,purpose:form.purpose,lengthM:n(form.length),heightM:n(form.height),bottomThicknessM:n(form.bottom),topThicknessM:n(form.top),deductionM3:n(form.deduction),allowancePercent:n(form.allowance),notes:form.notes,foundationId:foundation.id});
      onLinked(wall.id);
    }catch(cause){setError(cause instanceof Error?cause.message:'The wall could not be saved.');}
    finally{setBusy(false);}
  }

  async function linkExisting(){
    if(!linkChoice)return;
    setBusy(true);setError(null);
    try{await repository.linkWallToFoundation(linkChoice,foundation.id);onLinked(linkChoice);}
    catch(cause){setError(cause instanceof Error?cause.message:'The wall could not be linked.');}
    finally{setBusy(false);}
  }

  return <View style={styles.screen}>
    <PageHeader eyebrow="LINKED WALL" title={foundation.reference} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'Wall']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}

    <AppCard title="No wall linked yet" hint="Create one above this foundation, or link an existing unlinked wall.">
      {form?<View style={styles.fields}>
        <AppField label="Wall or section name *" value={form.name} onChangeText={name=>setForm({...form,name})} placeholder="Example: Retaining wall · Section A"/>
        <SearchableSelect label="Wall system *" options={(Object.keys(wallSystemLabels) as WallSystem[]).map(id=>({id,label:wallSystemLabels[id]}))} selectedId={form.system} onSelect={system=>setForm({...form,system:system as WallSystem})}/>
        <SearchableSelect label="Wall purpose" options={(Object.keys(wallPurposeLabels) as WallDraft['purpose'][]).map(id=>({id,label:wallPurposeLabels[id]}))} selectedId={form.purpose} onSelect={purpose=>setForm({...form,purpose:purpose as WallDraft['purpose']})}/>
        <View style={styles.pair}><View style={styles.flex}><AppField label="Length (m) *" value={form.length} onChangeText={length=>setForm({...form,length})} keyboardType="decimal-pad"/></View><View style={styles.flex}><AppField label="Height (m) *" value={form.height} onChangeText={height=>setForm({...form,height})} keyboardType="decimal-pad"/></View></View>
        <View style={styles.pair}><View style={styles.flex}><AppField label="Bottom thickness (m) *" value={form.bottom} onChangeText={bottom=>setForm({...form,bottom})} keyboardType="decimal-pad"/></View><View style={styles.flex}><AppField label="Top thickness (m) *" value={form.top} onChangeText={top=>setForm({...form,top})} keyboardType="decimal-pad"/></View></View>
        <AppField label="Notes" value={form.notes} onChangeText={notes=>setForm({...form,notes})} multiline/>
        <View style={styles.pair}>
          <View style={styles.flex}><AppButton label="Save Linked Wall" tone="navy" busy={busy} onPress={()=>void createWall()}/></View>
          <View style={styles.flex}><AppButton label="Cancel" tone="secondary" onPress={()=>setForm(null)}/></View>
        </View>
      </View>:<View style={styles.pair}>
        <View style={styles.flex}><AppButton label="Create Linked Wall" tone="navy" onPress={()=>setForm(emptyWallForm(foundation))}/></View>
        {availableWalls.length?<View style={styles.flex}><SearchableSelect label="Or link an existing wall" options={availableWalls.map(value=>({id:value.id,label:value.name}))} selectedId={linkChoice??''} onSelect={setLinkChoice}/></View>:null}
      </View>}
      {linkChoice&&!form?<AppButton label="Link Selected Wall" tone="secondary" busy={busy} onPress={()=>void linkExisting()}/>:null}
    </AppCard>
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  fields:{gap:10},
  pair:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
});
