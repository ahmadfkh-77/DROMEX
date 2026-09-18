import {useCallback,useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {WallRepository} from '../../data/repositories/WallRepository';
import type {ConstructionSection} from '../../domain/constructionSections';
import {CURING_WARNING_BODY,CURING_WARNING_TITLE,baseStatusLabels} from '../../domain/wallBase';
import type {Foundation} from '../../domain/foundations';
import type {FoundationComposition} from '../../domain/wallFoundation';
import {calculateWallVolume,formatCubicMetres,wallPurposeLabels,wallSystemLabels,type SavedConcretePurpose,type Wall,type WallConsumption,type WallDraft,type WallSystem} from '../../domain/walls';
import type {WallLayerDraft} from '../../domain/wallDiagram';
import {AppButton,AppCard,AppField,Feedback,MetricCard,PageHeader} from '../components/AppPrimitives';
import {FoundationCompositionCard} from '../components/FoundationCompositionCard';
import {FoundationCuringPanel} from '../components/FoundationCuringPanel';
import {FoundationGeometryForm,emptyFoundationForm,foundationDraftFrom,foundationFormFrom,type FoundationGeometryFormValues} from '../components/FoundationGeometryForm';
import {emptyLayerRow,layerDraftsFromRows,layerRowsFromDrafts,WallLayersEditor,type LayerRowForm} from '../components/WallLayersEditor';
import {emptyWallUseForm,wallDraftFromForm,WallConsumptionForm,wallUseFormFromEntry} from '../components/WallConsumptionForm';
import {WallConsumptionHistory} from '../components/WallConsumptionHistory';
import {WallDiagramView} from '../components/WallDiagramView';
import {FoundationStageStepper,FOUNDATION_STAGES,type FoundationStageKey} from '../components/FoundationStageStepper';
import {SearchableSelect} from '../components/SearchableSelect';
import {colors} from '../theme';

const n=(value:string)=>{const parsed=Number(value.trim().replace(',','.'));return Number.isFinite(parsed)?parsed:0;};
type WallForm={name:string;system:WallSystem;purpose:WallDraft['purpose'];length:string;height:string;bottom:string;top:string;deduction:string;allowance:string;notes:string};
const emptyWallForm=(foundation:Foundation):WallForm=>({name:'',system:'reinforced_concrete',purpose:'retaining',length:String(foundation.lengthM),height:'',bottom:String(foundation.bottomThicknessM),top:String(foundation.topThicknessM),deduction:'0',allowance:'0',notes:''});

/**
 * DEC-464. Checkpoint 4's guided Foundation workspace: one foundation, its five organizational
 * stages, and (once created) its one linked wall. Every stage is reachable regardless of curing
 * status (DEC-463) -- the only thing this screen ever locks is nothing at all.
 */
export function FoundationWorkspaceScreen({repository,foundationId,projectId,section,onBack,onChanged}:{
  repository:WallRepository;foundationId:string;projectId:string;section:ConstructionSection|null;onBack:()=>void;
  onChanged?:()=>void;
}){
  const[foundation,setFoundation]=useState<Foundation|null>(null);
  const[composition,setComposition]=useState<FoundationComposition|null>(null);
  const[wall,setWall]=useState<Wall|null>(null);
  const[entries,setEntries]=useState<WallConsumption[]>([]);
  const[layers,setLayers]=useState<LayerRowForm[]>([]);
  const[purposes,setPurposes]=useState<SavedConcretePurpose[]>([]);
  const[availableWalls,setAvailableWalls]=useState<Wall[]>([]);
  const[stage,setStage]=useState<FoundationStageKey>('foundation');
  const[editingGeometry,setEditingGeometry]=useState(false);
  const[geometryForm,setGeometryForm]=useState<FoundationGeometryFormValues>(emptyFoundationForm());
  const[correctionReason,setCorrectionReason]=useState('');
  const[wallForm,setWallForm]=useState<WallForm|null>(null);
  const[linkChoice,setLinkChoice]=useState<string|null>(null);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[message,setMessage]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const[nextFoundation,nextComposition,nextPurposes,allWalls]=await Promise.all([
      repository.getFoundation(foundationId),repository.getFoundationComposition(foundationId),repository.listConcretePurposes(),repository.listWalls(projectId),
    ]);
    if(!nextFoundation)throw new Error('Foundation was not found.');
    setFoundation(nextFoundation);setComposition(nextComposition);setPurposes(nextPurposes);
    setGeometryForm(current=>editingGeometry?current:foundationFormFrom(nextFoundation));
    const linkedWall=allWalls.find(value=>value.foundationId===foundationId)??null;
    setWall(linkedWall);
    setAvailableWalls(allWalls.filter(value=>!value.foundationId&&value.baseRequired));
    if(linkedWall){
      const detail=await repository.getWall(linkedWall.id);
      setEntries(detail.entries);setLayers(layerRowsFromDrafts(detail.layers));
    }else{setEntries([]);setLayers([]);}
  },[repository,foundationId,projectId,editingGeometry]);

  useEffect(()=>{setLoading(true);void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this foundation.')).finally(()=>setLoading(false));},[foundationId]);

  async function run(action:()=>Promise<unknown>,success?:string){setBusy(true);setError(null);setMessage(null);try{await action();await refresh();onChanged?.();if(success)setMessage(success);}catch(cause){setError(cause instanceof Error?cause.message:'That change could not be saved.');}finally{setBusy(false);}}

  if(loading||!foundation)return <View style={styles.loading}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading foundation…'}</Text></View>;

  const stageLock=composition?null:null; // no lock: kept for clarity that nothing here gates access
  void stageLock;
  const curingConfirmed=foundation.status==='cured';
  const completed=new Set<FoundationStageKey>(['foundation',...(curingConfirmed?['curing'] as const:[]),...(wall?['wall'] as const:[]),...(layers.length?['layers'] as const:[])]);
  const totals=entries.length;

  return <View style={styles.screen}>
    <PageHeader eyebrow={section?section.name.toUpperCase():'FOUNDATION'} title={foundation.reference} onBack={onBack}/>
    <View style={styles.summary}>
      <Text style={styles.summaryTitle}>{foundation.reference}{foundation.location?` · ${foundation.location}`:''}</Text>
      <Text style={styles.summaryLine}>{section?`${section.name} · `:''}{baseStatusLabels[foundation.status]} · net {formatCubicMetres(foundation.netVolumeM3)}{wall?` · linked to ${wall.name}`:' · no wall linked yet'}</Text>
    </View>
    {!curingConfirmed?<View style={styles.curingNotice} accessibilityLiveRegion="polite">
      <Text style={styles.curingNoticeTitle}>{CURING_WARNING_TITLE}</Text>
      <Text style={styles.curingNoticeBody}>{CURING_WARNING_BODY}</Text>
    </View>:null}
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {message?<Feedback kind="success">{message}</Feedback>:null}

    <View style={styles.body}>
      <View style={styles.stepperColumn}><FoundationStageStepper active={stage} completed={completed} onSelect={setStage}/></View>
      <View style={styles.contentColumn}>
        {stage==='foundation'?<AppCard title="1 · Foundation">
          {!editingGeometry?<>
            <Text style={styles.summaryLine}>{foundation.lengthM} m × {foundation.heightM} m × {foundation.bottomThicknessM===foundation.topThicknessM?`${foundation.bottomThicknessM} m`:`${foundation.bottomThicknessM} to ${foundation.topThicknessM} m`}</Text>
            <Text style={styles.summaryLine}>Gross {formatCubicMetres(foundation.grossVolumeM3)} · deduction {formatCubicMetres(foundation.deductionM3)} · net {formatCubicMetres(foundation.netVolumeM3)}</Text>
            <Text style={styles.summaryLine}>Recorded {foundation.quantity==null?'not recorded':`${foundation.quantity} ${foundation.quantityUnit==='tonnes'?'t':'m³'}`}{foundation.manualOverride?' (manual override)':''}</Text>
            {foundation.correctionHistory.length?<Text style={styles.summaryLine}>{foundation.correctionHistory.length} correction{foundation.correctionHistory.length===1?'':'s'} recorded, latest: {foundation.correctionHistory.at(-1)!.reason}</Text>:null}
            <AppButton label="Edit Geometry" tone="secondary" onPress={()=>{setGeometryForm(foundationFormFrom(foundation));setEditingGeometry(true);}}/>
          </>:<>
            <AppField label="Correction reason *" value={correctionReason} onChangeText={setCorrectionReason} multiline placeholder="Example: site survey re-measured"/>
            <FoundationGeometryForm form={geometryForm} onChange={patch=>setGeometryForm({...geometryForm,...patch})} savedPurposes={purposes} busy={busy} error={null} saveLabel="Save Correction"
              onCreatePurpose={async label=>{const created=await repository.createConcretePurpose(label);setPurposes(await repository.listConcretePurposes());return created;}}
              onSave={()=>void run(async()=>{await repository.correctFoundation(foundationId,{...foundationDraftFrom(geometryForm,foundation.projectId,foundation.constructionSectionId),correctionReason});setEditingGeometry(false);setCorrectionReason('');},'Foundation corrected.')}/>
            <AppButton label="Discard Changes" tone="secondary" onPress={()=>{setGeometryForm(foundationFormFrom(foundation));setEditingGeometry(false);setCorrectionReason('');}}/>
          </>}
          <FoundationCompositionCard base={foundation} composition={composition} busy={busy}
            onSetMode={(mode,stoneCoreMode)=>run(()=>repository.setFoundationMode(foundationId,mode,stoneCoreMode))}
            onSavePosition={position=>run(()=>repository.saveStoneCorePosition(foundationId,position))}
            onSaveOffsets={offsets=>run(()=>repository.saveStoneCoreOffsets(foundationId,offsets))}
            onAddRecord={(materialType,quantityM3,recordedOn,notes)=>run(()=>repository.addFoundationCompositionRecord({foundationId,materialType,quantityM3,recordedOn,notes}),`${materialType==='stone'?'Stone':'Ready Mix'} recorded.`)}
            onCancelRecord={(recordId,reason)=>run(()=>repository.cancelFoundationCompositionRecord(recordId,reason),'Record cancelled.')}
            onCorrectRecord={(recordId,quantityM3,recordedOn,notes,reason)=>run(()=>repository.correctFoundationCompositionRecord(recordId,{foundationId,materialType:composition?.records.find(record=>record.id===recordId)?.materialType??'stone',quantityM3,recordedOn,notes,correctionReason:reason}),'Correction saved.')}/>
        </AppCard>:null}

        {stage==='curing'?<AppCard title="2 · Curing"><FoundationCuringPanel foundation={foundation} busy={busy} onChangeStatus={change=>run(()=>repository.changeFoundationStatus(foundationId,change),change.status==='cured'?'Foundation confirmed cured.':`Foundation marked ${change.status}.`)}/></AppCard>:null}

        {stage==='wall'?<AppCard title="3 · Wall">
          {wall?<>
            <Text style={styles.summaryTitle}>{wall.name}</Text>
            <Text style={styles.summaryLine}>{wallSystemLabels[wall.system]} · {wallPurposeLabels[wall.purpose]} · {formatCubicMetres(wall.plannedVolumeM3)} planned</Text>
            <WallDiagramView input={{wall:{name:wall.name,lengthM:wall.lengthM,heightM:wall.heightM,bottomThicknessM:wall.bottomThicknessM,topThicknessM:wall.topThicknessM},layers:layerDraftsFromRows(layers),base:null}} caption="Wall geometry, generated from the recorded dimensions."/>
          </>:<>
            <Text style={styles.summaryLine}>No wall linked to this foundation yet. Create one, or link an existing unlinked wall.</Text>
            {wallForm?<>
              <AppField label="Wall or section name *" value={wallForm.name} onChangeText={name=>setWallForm({...wallForm,name})} placeholder="Example: Retaining wall · Section A"/>
              <SearchableSelect label="Wall system *" options={(Object.keys(wallSystemLabels) as WallSystem[]).map(id=>({id,label:wallSystemLabels[id]}))} selectedId={wallForm.system} onSelect={system=>setWallForm({...wallForm,system:system as WallSystem})}/>
              <SearchableSelect label="Wall purpose" options={(Object.keys(wallPurposeLabels) as WallDraft['purpose'][]).map(id=>({id,label:wallPurposeLabels[id]}))} selectedId={wallForm.purpose} onSelect={purpose=>setWallForm({...wallForm,purpose:purpose as WallDraft['purpose']})}/>
              <View style={styles.pair}><View style={styles.flex}><AppField label="Length (m) *" value={wallForm.length} onChangeText={length=>setWallForm({...wallForm,length})} keyboardType="decimal-pad"/></View><View style={styles.flex}><AppField label="Height (m) *" value={wallForm.height} onChangeText={height=>setWallForm({...wallForm,height})} keyboardType="decimal-pad"/></View></View>
              <View style={styles.pair}><View style={styles.flex}><AppField label="Bottom thickness (m) *" value={wallForm.bottom} onChangeText={bottom=>setWallForm({...wallForm,bottom})} keyboardType="decimal-pad"/></View><View style={styles.flex}><AppField label="Top thickness (m) *" value={wallForm.top} onChangeText={top=>setWallForm({...wallForm,top})} keyboardType="decimal-pad"/></View></View>
              <AppField label="Notes" value={wallForm.notes} onChangeText={notes=>setWallForm({...wallForm,notes})} multiline/>
              <View style={styles.pair}>
                <View style={styles.flex}><AppButton label="Save Linked Wall" tone="navy" busy={busy} onPress={()=>void run(async()=>{
                  const result=calculateWallVolume(n(wallForm.length),n(wallForm.height),n(wallForm.bottom),n(wallForm.top),n(wallForm.deduction),n(wallForm.allowance));
                  if(result.netVolumeM3<=0)throw new Error('Wall net volume must be greater than zero.');
                  await repository.saveWall({projectId,name:wallForm.name,system:wallForm.system,purpose:wallForm.purpose,lengthM:n(wallForm.length),heightM:n(wallForm.height),bottomThicknessM:n(wallForm.bottom),topThicknessM:n(wallForm.top),deductionM3:n(wallForm.deduction),allowancePercent:n(wallForm.allowance),notes:wallForm.notes,foundationId});
                  setWallForm(null);
                },'Wall created and permanently linked to this foundation.')}/></View>
                <View style={styles.flex}><AppButton label="Cancel" tone="secondary" onPress={()=>setWallForm(null)}/></View>
              </View>
            </>:<View style={styles.pair}>
              <View style={styles.flex}><AppButton label="Create Linked Wall" tone="navy" onPress={()=>setWallForm(emptyWallForm(foundation))}/></View>
              {availableWalls.length?<View style={styles.flex}><SearchableSelect label="Or link an existing wall" options={availableWalls.map(value=>({id:value.id,label:value.name}))} selectedId={linkChoice??''} onSelect={setLinkChoice}/></View>:null}
            </View>}
            {linkChoice?<AppButton label="Link Selected Wall" tone="secondary" busy={busy} onPress={()=>{const chosen=linkChoice;void run(()=>repository.linkWallToFoundation(chosen,foundationId).then(()=>{setLinkChoice(null);}),'Wall linked to this foundation.');}}/>:null}
          </>}
        </AppCard>:null}

        {stage==='layers'?<AppCard title="4 · Layers and Materials">
          {!wall?<Text style={styles.summaryLine}>Create the wall first, in the Wall stage, to record its layers and materials.</Text>:<>
            <View style={styles.metrics}>
              <MetricCard label="Material records" value={String(totals)} result/>
              <MetricCard label="Layers recorded" value={String(layers.length)} result/>
            </View>
            <WallLayersEditor rows={layers} wall={wall} busy={busy} onChange={setLayers} onSave={drafts=>void run(()=>repository.saveLayers(wall.id,drafts),drafts.length?'Wall layers saved.':'Layers cleared.')}/>
            <WallConsumptionForm mode="add" initial={emptyWallUseForm()} wall={wall} savedPurposes={purposes}
              onCreatePurpose={async label=>{const created=await repository.createConcretePurpose(label);setPurposes(await repository.listConcretePurposes());return created;}}
              onSubmit={async form=>{await run(()=>repository.addConsumption(wallDraftFromForm(form,wall.id)),'Wall consumption recorded.');}}/>
          </>}
        </AppCard>:null}

        {stage==='history'?<AppCard title="5 · History and Reports">
          {!wall?<Text style={styles.summaryLine}>No wall consumption history yet -- create the wall first.</Text>:
            <WallConsumptionHistory entries={entries} renderCorrection={(entry,close)=><WallConsumptionForm mode="correct" initial={wallUseFormFromEntry(entry)} wall={wall} savedPurposes={purposes}
              onCreatePurpose={async label=>{const created=await repository.createConcretePurpose(label);setPurposes(await repository.listConcretePurposes());return created;}}
              onDiscard={close} onSubmit={async form=>{await run(()=>repository.correctConsumption(entry.id,{...wallDraftFromForm(form,entry.wallId),correctionReason:form.reason}));close();}}/>}/>}
          <Text style={styles.hint}>Export this foundation's diagram, quantities, and correction history from Reports → Daily Report or Project Completion Report, grouped by Construction Section.</Text>
        </AppCard>:null}
      </View>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  loading:{padding:24},
  detail:{color:colors.muted,fontSize:13},
  summary:{gap:2},
  summaryTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},
  summaryLine:{color:colors.muted,fontSize:12,lineHeight:17},
  curingNotice:{backgroundColor:'#FFF3D8',borderRadius:10,padding:10,gap:3},
  curingNoticeTitle:{color:colors.warning,fontSize:12,fontWeight:'900'},
  curingNoticeBody:{color:colors.warning,fontSize:12,fontWeight:'700',lineHeight:17},
  body:{flexDirection:'row',gap:12,flexWrap:'wrap'},
  stepperColumn:{minWidth:170,flexBasis:170},
  contentColumn:{flex:1,minWidth:260,gap:10},
  pair:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
  metrics:{flexDirection:'row',gap:8},
  hint:{color:colors.muted,fontSize:11,lineHeight:16,marginTop:8},
});
