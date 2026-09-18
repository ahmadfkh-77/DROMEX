import {useCallback,useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import type {WallRepository} from '../../data/repositories/WallRepository';
import type {ConstructionSection} from '../../domain/constructionSections';
import type {Foundation} from '../../domain/foundations';
import {baseStatusLabels} from '../../domain/wallBase';
import {formatCubicMetres,summarizeWallConsumption,wallSystemLabels,type SavedConcretePurpose,type Wall,type WallDetail} from '../../domain/walls';
import {AppButton,AppCard,AppField,AppPage,EmptyState,Feedback,MetricCard,PageHeader} from '../components/AppPrimitives';
import {ExpandableMenuSection} from '../components/ExpandableMenu';
import {emptyFoundationForm,foundationDraftFrom,type FoundationGeometryFormValues,FoundationGeometryForm} from '../components/FoundationGeometryForm';
import {SearchableSelect} from '../components/SearchableSelect';
import {emptyWallUseForm,wallDraftFromForm,WallConsumptionForm,wallUseFormFromEntry} from '../components/WallConsumptionForm';
import {WallConsumptionHistory} from '../components/WallConsumptionHistory';
import {WallDiagramView} from '../components/WallDiagramView';
import {layerRowsFromDrafts,WallLayersEditor,type LayerRowForm} from '../components/WallLayersEditor';
import {FoundationWorkspaceScreen} from './FoundationWorkspaceScreen';
import {colors, radius} from '../theme';

const f=(value:number,digits=2)=>value.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});
const pair=(first:number,firstUnit:string,second:number,secondUnit:string)=>[first?`${f(first)} ${firstUnit}`:null,second?`${f(second)} ${secondUnit}`:null].filter(Boolean).join(' · ');

/**
 * DEC-464. Project -> Construction Section -> Foundation -> Wall. This screen is the directory:
 * choose (or lock to) a project, browse its Construction Sections and the Foundations inside each
 * one, create a Foundation independently of any wall, and open a Foundation's five-stage workspace.
 * Legacy walls (created before DEC-459, with no base/foundation concept at all) keep their original,
 * untouched consumption workflow in their own section below.
 */
export function WallConstructionScreen({repository,onBack,initialProjectId}:{repository:WallRepository;onBack:()=>void;initialProjectId?:string|null}){
  const locked=!!initialProjectId;
  const[projects,setProjects]=useState<{id:string;name:string;customerName:string;location:string;status:string}[]>([]);
  const[projectId,setProjectId]=useState<string|null>(initialProjectId??null);
  const[sections,setSections]=useState<ConstructionSection[]>([]);
  const[foundations,setFoundations]=useState<Foundation[]>([]);
  const[legacyWalls,setLegacyWalls]=useState<Wall[]>([]);
  const[openSections,setOpenSections]=useState<Set<string>>(()=>new Set());
  const[openFoundationId,setOpenFoundationId]=useState<string|null>(null);
  const[creatingFoundationSection,setCreatingFoundationSection]=useState<string|null>(null);
  const[foundationForm,setFoundationForm]=useState<FoundationGeometryFormValues>(emptyFoundationForm());
  const[creatingSection,setCreatingSection]=useState(false);
  const[sectionName,setSectionName]=useState('');
  const[sectionLocation,setSectionLocation]=useState('');
  const[sectionDescription,setSectionDescription]=useState('');
  const[purposes,setPurposes]=useState<SavedConcretePurpose[]>([]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[message,setMessage]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const setup=await repository.getSetup();
    setProjects(setup.projects.filter(value=>value.status==='active').map(value=>({id:value.id,name:value.name,customerName:value.customerName,location:value.location,status:value.status})));
    if(projectId){
      const[nextSections,nextFoundations,allWalls,nextPurposes]=await Promise.all([
        repository.listConstructionSections(projectId),repository.listFoundations(projectId),repository.listWalls(projectId),repository.listConcretePurposes(),
      ]);
      setSections(nextSections);setFoundations(nextFoundations);setLegacyWalls(allWalls.filter(value=>!value.baseRequired));setPurposes(nextPurposes);
    }else{setSections([]);setFoundations([]);setLegacyWalls([]);}
  },[repository,projectId]);

  useEffect(()=>{setLoading(true);void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load wall construction records.')).finally(()=>setLoading(false));},[projectId]);

  const toggleSection=(id:string)=>setOpenSections(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});

  async function createFoundation(){
    if(!projectId||!creatingFoundationSection)return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const created=await repository.createFoundation(foundationDraftFrom(foundationForm,projectId,creatingFoundationSection));
      await refresh();setCreatingFoundationSection(null);setFoundationForm(emptyFoundationForm());setMessage('Foundation created.');setOpenFoundationId(created.id);
    }catch(cause){setError(cause instanceof Error?cause.message:'The foundation could not be saved.');}
    finally{setBusy(false);}
  }

  if(openFoundationId&&projectId)return <AppPage keyboard>
    <FoundationWorkspaceScreen repository={repository} foundationId={openFoundationId} projectId={projectId}
      section={sections.find(value=>value.id===foundations.find(f2=>f2.id===openFoundationId)?.constructionSectionId)??null}
      onBack={()=>{setOpenFoundationId(null);void refresh();}} onChanged={()=>void refresh()}/>
  </AppPage>;

  return <AppPage keyboard>
    <PageHeader eyebrow="CONSTRUCTION QUANTITIES" title="Wall Construction" onBack={onBack}/>
    <AppCard tone="navy" title="Organized by Construction Section and Foundation" hint="A foundation is created before its wall, and can be recorded regardless of curing status.">
      <Text style={styles.disclaimer}>Dimensions, reinforcement, material proportions, drainage, and stability come from approved drawings or the project engineer. DROMEX tracks quantities only.</Text>
    </AppCard>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {message?<Feedback kind="success">{message}</Feedback>:null}

    {!locked?<AppCard title="Project"><SearchableSelect label="Project *" options={projects.map(value=>({id:value.id,label:value.name,detail:`${value.customerName} · ${value.location}`}))} selectedId={projectId??''} onSelect={setProjectId} placeholder="Choose an active project"/></AppCard>:null}

    {!projectId?<EmptyState title="Choose a project" body="Select a project above to see its Construction Sections and Foundations."/>:loading?<Text style={styles.detail} accessibilityLiveRegion="polite">Loading…</Text>:<>
      <AppCard title="Construction Sections" hint="Each section can hold several independent foundations.">
        {!creatingSection?<AppButton label="+ New Construction Section" tone="secondary" onPress={()=>setCreatingSection(true)}/>:<View style={styles.createForm}>
          <AppField label="Section name *" value={sectionName} onChangeText={setSectionName} placeholder="Example: Section A, North Retaining Wall"/>
          <AppField label="Location (optional)" value={sectionLocation} onChangeText={setSectionLocation} placeholder="Example: Km 3+000"/>
          <AppField label="Description (optional)" value={sectionDescription} onChangeText={setSectionDescription} multiline/>
          <View style={styles.metrics}>
            <AppButton label="Save Section" tone="navy" busy={busy} disabled={!sectionName.trim()} onPress={()=>void(async()=>{
              setBusy(true);setError(null);
              try{await repository.createConstructionSection({projectId,name:sectionName,location:sectionLocation,description:sectionDescription});await refresh();setCreatingSection(false);setSectionName('');setSectionLocation('');setSectionDescription('');}
              catch(cause){setError(cause instanceof Error?cause.message:'The Construction Section could not be created.');}
              finally{setBusy(false);}
            })()}/>
            <AppButton label="Cancel" tone="secondary" onPress={()=>setCreatingSection(false)}/>
          </View>
        </View>}
      </AppCard>

      {sections.length===0?<EmptyState title="No Construction Sections yet" body="Create one above to start recording independent foundations under this project."/>:
        sections.map(section=>{
          const sectionFoundations=foundations.filter(value=>value.constructionSectionId===section.id);
          const linkedCount=sectionFoundations.filter(value=>value.legacyWallId).length;
          return <ExpandableMenuSection key={section.id} title={section.name} hint={`${sectionFoundations.length} foundation${sectionFoundations.length===1?'':'s'}${section.location?` · ${section.location}`:''}`} tone="cream" open={openSections.has(section.id)} onToggle={()=>toggleSection(section.id)}>
            <AppCard>
              {sectionFoundations.length===0?<Text style={styles.detail}>No foundations recorded in this section yet.</Text>:sectionFoundations.map(foundation=>
                <TouchableOpacity key={foundation.id} style={styles.foundationRow} onPress={()=>setOpenFoundationId(foundation.id)} accessibilityRole="button">
                  <Text style={styles.foundationName}>{foundation.reference}</Text>
                  <Text style={styles.detail}>{baseStatusLabels[foundation.status]} · net {formatCubicMetres(foundation.netVolumeM3)}{foundation.location?` · ${foundation.location}`:''}</Text>
                </TouchableOpacity>)}
              {creatingFoundationSection===section.id?<View style={styles.createForm}>
                <FoundationGeometryForm form={foundationForm} onChange={patch=>setFoundationForm({...foundationForm,...patch})} savedPurposes={purposes} busy={busy} error={null} saveLabel="Save Foundation"
                  onCreatePurpose={async label=>{const created=await repository.createConcretePurpose(label);setPurposes(await repository.listConcretePurposes());return created;}}
                  onSave={()=>void createFoundation()}/>
                <AppButton label="Cancel" tone="secondary" onPress={()=>setCreatingFoundationSection(null)}/>
              </View>:<AppButton label="+ New Foundation In This Section" tone="secondary" onPress={()=>{setFoundationForm(emptyFoundationForm());setCreatingFoundationSection(section.id);}}/>}
            </AppCard>
          </ExpandableMenuSection>;
        })}

      {legacyWalls.length?<ExpandableMenuSection title="Legacy walls" hint="Created before Construction Sections and foundations existed. Their own workflow is unchanged." tone="navy" open={openSections.has('legacy')} onToggle={()=>toggleSection('legacy')}>
        <LegacyWallsPanel repository={repository} walls={legacyWalls} purposes={purposes} onPurposesChanged={async()=>setPurposes(await repository.listConcretePurposes())}/>
      </ExpandableMenuSection>:null}
    </>}
  </AppPage>;
}

/** Unchanged pre-DEC-459 consumption workflow, kept exactly as it worked before -- these walls have no base or foundation concept. */
function LegacyWallsPanel({repository,walls,purposes,onPurposesChanged}:{repository:WallRepository;walls:Wall[];purposes:SavedConcretePurpose[];onPurposesChanged:()=>Promise<void>}){
  const[selected,setSelected]=useState<WallDetail|null>(null);
  const[layerRows,setLayerRows]=useState<LayerRowForm[]>([]);
  const[formKey,setFormKey]=useState(0);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState<string|null>(null);

  async function chooseWall(value:Wall){setBusy(true);try{const detail=await repository.getWall(value.id);setSelected(detail);setLayerRows(layerRowsFromDrafts(detail.layers));setFormKey(key=>key+1);}finally{setBusy(false);}}
  async function reloadSelected(wallId:string){const detail=await repository.getWall(wallId);setSelected(detail);setLayerRows(layerRowsFromDrafts(detail.layers));}
  async function createPurpose(label:string){const created=await repository.createConcretePurpose(label);await onPurposesChanged();return created;}
  function saveLayers(drafts:Parameters<WallRepository['saveLayers']>[1]){if(!selected)return;void repository.saveLayers(selected.wall.id,drafts).then(()=>reloadSelected(selected.wall.id)).then(()=>setMessage('Wall layers saved.'));}

  const totals=useMemo(()=>summarizeWallConsumption(selected?.entries??[]),[selected]);
  const metrics=[
    {label:'Structural concrete used',value:totals.structural?`${f(totals.structural)} m³`:''},
    {label:'Filling / mortar used',value:totals.filling?`${f(totals.filling)} m³`:''},
    {label:'Stone consumed',value:pair(totals.stoneM3,'m³',totals.stoneT,'t')},
  ].filter(metric=>metric.value);

  return <View style={styles.legacyWrap}>
    <AppCard>{walls.map(value=>{const isSelected=selected?.wall.id===value.id;return <TouchableOpacity key={value.id} style={[styles.foundationRow,isSelected&&styles.legacySelected]} onPress={()=>void chooseWall(value)} accessibilityRole="button" accessibilityState={{selected:isSelected}}><Text style={styles.foundationName}>{value.name}</Text><Text style={styles.detail}>{wallSystemLabels[value.system]} · {f(value.plannedVolumeM3)} m³ planned</Text></TouchableOpacity>;})}</AppCard>
    {message?<Feedback kind="success">{message}</Feedback>:null}
    {selected?<>
      {metrics.length?<View style={styles.metrics}>{metrics.map(metric=><MetricCard key={metric.label} label={metric.label} value={metric.value} result/>)}</View>:null}
      <AppCard title="Wall drawing and layers"><WallDiagramView input={{wall:{name:selected.wall.name,lengthM:selected.wall.lengthM,heightM:selected.wall.heightM,bottomThicknessM:selected.wall.bottomThicknessM,topThicknessM:selected.wall.topThicknessM},layers:selected.layers,base:null}} caption="Generated from this wall's own data."/>
        <WallLayersEditor rows={layerRows} wall={selected.wall} busy={busy} onChange={setLayerRows} onSave={saveLayers}/></AppCard>
      <AppCard title="Record consumed materials"><WallConsumptionForm key={`${selected.wall.id}-${formKey}`} mode="add" initial={emptyWallUseForm()} wall={selected.wall} savedPurposes={purposes} onCreatePurpose={createPurpose} onSubmit={async form=>{await repository.addConsumption(wallDraftFromForm(form,selected.wall.id));await reloadSelected(selected.wall.id);setMessage('Wall consumption recorded.');}}/></AppCard>
      <AppCard title="Consumption history"><WallConsumptionHistory entries={selected.entries} renderCorrection={(entry,close)=><WallConsumptionForm mode="correct" initial={wallUseFormFromEntry(entry)} wall={selected.wall} savedPurposes={purposes} onCreatePurpose={createPurpose} onDiscard={close} onSubmit={async form=>{await repository.correctConsumption(entry.id,{...wallDraftFromForm(form,entry.wallId),correctionReason:form.reason});close();await reloadSelected(entry.wallId);setMessage('Correction saved.');}}/>}/></AppCard>
    </>:null}
  </View>;
}

const styles=StyleSheet.create({
  disclaimer:{color:'#FFF8ED',fontSize:12,lineHeight:18,fontWeight:'700'},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:8},
  foundationRow:{backgroundColor:colors.surface,borderRadius:radius.md,padding:12,marginBottom:8,borderLeftWidth:4,borderLeftColor:colors.navy},
  legacySelected:{borderLeftColor:colors.result,backgroundColor:colors.resultSoft},
  foundationName:{color:colors.ink,fontSize:15,fontWeight:'900'},
  createForm:{gap:10,marginTop:10,backgroundColor:colors.cream,borderRadius:radius.md,padding:10},
  legacyWrap:{gap:10},
});
