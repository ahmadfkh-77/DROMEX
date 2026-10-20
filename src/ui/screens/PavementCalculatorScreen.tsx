import {useCallback,useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import type {PavementRepository} from '../../data/repositories/PavementRepository';
import {calculatePavement,looseThickness,pavementSpreadRates,type PavementCalculation,type PavementSetup} from '../../domain/pavement';
import {
  areaOfPavementForm,areaPageIssue,defaultTruckPayloadTonnes,draftFromPavementForm,emptyPavementForm,formNumber,looseFactorOfPavementForm,looseFactorPresets,pavementFormFromRecord,rateOfPavementForm,ratePageIssue,trucksForPlanned,
  type PavementAreaMode,type PavementForm,
} from '../../domain/pavementForm';
import {AppButton,AppField,EmptyState} from '../components/AppPrimitives';
import {OpenSwitch} from '../components/OpenSwitch';
import {PavementTools,usePavementTools} from '../components/PavementTools';
import {PavementPageFrame} from '../components/PavementPageFrame';
import {PavementSectionsEditor} from '../components/PavementSectionsEditor';
import {SearchableSelect} from '../components/SearchableSelect';
import {exportPavementExcel,exportPavementPdf} from '../../services/pavementExport';
import {colors,radius} from '../theme';

/**
 * The Asphalt Calculator as separate pages (DEC-519): 1 Area, 2 Rate and thickness, 3 Result with Save, then More tools and Saved calculations opened
 * from the Result page. The area comes from Length × width, Road sections (DEC-518) or a Direct net area; each keeps its own values. No formula changes.
 */
type Page='area'|'rate'|'result'|'tools'|'saved';
const format=(value:number,digits=1)=>value.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});

export function PavementCalculatorScreen({repository,onBack,initialProjectId}:{repository:PavementRepository;onBack:()=>void;initialProjectId?:string|null}){
  const[setup,setSetup]=useState<PavementSetup|null>(null);const[form,setForm]=useState<PavementForm>(()=>emptyPavementForm(initialProjectId??''));const[records,setRecords]=useState<PavementCalculation[]>([]);const[editingId,setEditingId]=useState<string|null>(null);
  const[page,setPage]=useState<Page>('area');const[showErrors,setShowErrors]=useState(false);const[payload,setPayload]=useState(String(defaultTruckPayloadTonnes));
  const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);
  const locked=!!initialProjectId;
  // The typed values of the seven tools live here, so they survive going to another page and coming back.
  const tools=usePavementTools();
  const refresh=useCallback(async()=>{const next=await repository.getSetup();setSetup(next);setRecords(await repository.listCalculations(initialProjectId??null));},[initialProjectId,repository]);
  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load pavement calculations.'));},[refresh]);

  const area=useMemo(()=>areaOfPavementForm(form),[form]);
  const density=formNumber(form.density),rate=rateOfPavementForm(form),looseFactor=looseFactorOfPavementForm(form),allowance=formNumber(form.allowance);
  const result=useMemo(()=>area.areaM2>0&&rate>0&&density>0?calculatePavement(area.areaM2,rate,density,Math.max(0,allowance)):null,[allowance,area.areaM2,density,rate]);
  const rateOptions=useMemo(()=>[...pavementSpreadRates.map(value=>({id:String(value),label:`${value} kg/m²`,detail:density>0?`${(value/density).toFixed(1)} mm compacted at ${density.toFixed(2)} t/m³`:'Enter density to see thickness'})),{id:'custom',label:'Custom kg/m²',detail:'Enter any positive spread rate'}],[density]);
  const looseFactorOptions=useMemo(()=>[...looseFactorPresets.map(value=>({id:value.toFixed(2),label:`${value.toFixed(2)} × project factor`,detail:'Planning option — confirm from the project mix and paver trial'})),{id:'custom',label:'Custom project factor',detail:'Use your calibrated loose-to-compacted factor'}],[]);
  const projects=setup?.projects??[],activeProjects=projects.filter(project=>project.status==='active');
  const projectName=projects.find(value=>value.id===form.projectId)?.name??'Selected project';
  const set=(changes:Partial<PavementForm>)=>setForm(current=>({...current,...changes}));
  const go=(next:Page)=>{setError(null);setMessage(null);setPage(next);};

  const visible=initialProjectId?records:form.projectId?records.filter(value=>value.projectId===form.projectId):records;
  const totalArea=visible.reduce((sum,value)=>sum+value.areaM2,0),totalPlanned=visible.reduce((sum,value)=>sum+value.plannedKg,0)/1000;
  const exportProject=form.projectId?projectName:initialProjectId?projectName:'All Projects';
  const trucks=result?trucksForPlanned(result.plannedTonnes,formNumber(payload)):null;
  const figures=area.areaM2>0?`${format(area.areaM2)} m²${result?` · ${format(result.plannedTonnes,3)} t`:''}`:'—';

  function nextFromArea(){const issue=areaPageIssue(form,area);setShowErrors(true);if(issue){setError(issue);return;}go('rate');}
  function nextFromRate(){const issue=ratePageIssue(form);if(issue){setError(issue);return;}go('result');}
  async function save(){setBusy(true);setError(null);setMessage(null);try{await repository.saveCalculation(draftFromPavementForm(form),editingId??undefined);const updated=!!editingId;setEditingId(null);setForm(emptyPavementForm(initialProjectId??form.projectId));setShowErrors(false);await refresh();setPage('saved');setMessage(updated?'Pavement calculation updated.':'Pavement calculation saved under the project.');}catch(cause){setError(cause instanceof Error?cause.message:'Could not save the pavement calculation.');}finally{setBusy(false);}}
  function edit(record:PavementCalculation){setEditingId(record.id);setForm(pavementFormFromRecord(record));setShowErrors(false);setError(null);setMessage(null);setPage('area');}
  function cancelEditing(){setEditingId(null);setForm(emptyPavementForm(initialProjectId??form.projectId));setShowErrors(false);setError(null);setMessage(null);setPage('area');}
  async function runExport(kind:'pdf'|'excel'){setBusy(true);setError(null);setMessage(null);try{if(kind==='pdf')await exportPavementPdf(visible,exportProject);else await exportPavementExcel(visible,exportProject);setMessage(`${kind==='pdf'?'PDF':'Excel workbook'} created and ready to share.`);}catch(cause){setError(cause instanceof Error?cause.message:'Could not export pavement calculations.');}finally{setBusy(false);}}

  if(page==='area')return <PavementPageFrame dots={{total:3,current:1}} band={{mark:'1',title:'Area',hint:'How big is the paved area?',tone:'navy'}} onBack={onBack} error={error} message={message}
    bar={{label:area.areaM2>0&&form.areaMode==='sections'?`TOTAL AREA · ${form.sections.length} SECTION${form.sections.length===1?'':'S'}`:'NET AREA',value:area.areaM2>0?`${format(area.areaM2)} m²`:'—',muted:showErrors&&!!area.sections?.errors.length,secondary:{label:editingId?'Cancel editing':'Cancel',onPress:editingId?cancelEditing:onBack},primary:{label:'Next',onPress:nextFromArea}}}>
    <View style={styles.group}>
      {editingId?<Text style={styles.help}>Editing a saved calculation. Save at the end to update it.</Text>:null}
      {locked?<View style={styles.locked}><Text style={styles.lockedLabel}>PROJECT LOCKED</Text><Text style={styles.lockedValue}>{projectName}</Text></View>:<SearchableSelect variant="open" label="Project *" options={activeProjects.map(project=>({id:project.id,label:project.name,detail:`${project.customerName} · ${project.location}`}))} selectedId={form.projectId} onSelect={projectId=>set({projectId})} placeholder="Choose an active project"/>}
      <AppField variant="open" label="Section or layer name *" value={form.name} onChangeText={name=>set({name})} placeholder="Example: Wearing course · Station 0+000–0+500"/>
    </View>
    <View style={styles.group}>
      <Text style={styles.groupLabel}>HOW DO YOU KNOW THE AREA?</Text>
      <OpenSwitch options={[{id:'lw' as PavementAreaMode,label:'Length × width'},{id:'sections' as PavementAreaMode,label:'Road sections'},{id:'direct' as PavementAreaMode,label:'Direct area'}]} selectedId={form.areaMode} onSelect={areaMode=>set({areaMode})}/>
      {form.areaMode==='lw'?<>
        <View style={styles.two}><View style={styles.half}><AppField variant="open" label="Length (m)" value={form.length} onChangeText={length=>set({length})} keyboardType="decimal-pad"/></View><View style={styles.half}><AppField variant="open" label="Average width (m)" value={form.width} onChangeText={width=>set({width})} keyboardType="decimal-pad"/></View></View>
        <View style={styles.areaBand}><Text style={styles.areaLabel}>NET AREA</Text><Text style={styles.areaValue}>{format(area.areaM2,2)} m²</Text></View>
      </>:null}
      {form.areaMode==='direct'?<>
        <AppField variant="open" label="Direct net area (m²)" value={form.directArea} onChangeText={directArea=>set({directArea})} keyboardType="decimal-pad" placeholder="A measured or surveyed net area"/>
        <View style={styles.areaBand}><Text style={styles.areaLabel}>NET AREA</Text><Text style={styles.areaValue}>{format(area.areaM2,2)} m²</Text></View>
      </>:null}
      {form.areaMode==='sections'&&area.sections?<PavementSectionsEditor sections={form.sections} analysis={area.sections} showErrors={showErrors} onChange={sections=>set({sections})}/>:null}
    </View>
  </PavementPageFrame>;

  if(page==='rate')return <PavementPageFrame dots={{total:3,current:2}} band={{mark:'2',title:'Rate and thickness',hint:'How much asphalt per m², and how thick?',tone:'orange'}} onBack={()=>go('area')} error={error} message={message}
    bar={{label:'AREA · RATE',value:`${area.areaM2>0?format(area.areaM2):'—'} m² · ${format(rate,0)} kg/m²`,secondary:{label:'Back',onPress:()=>go('area')},primary:{label:'Next',onPress:nextFromRate}}}>
    <View style={styles.group}>
      <Text style={styles.groupLabel}>SPREAD RATE</Text>
      <SearchableSelect variant="open" label="Target spread rate *" options={rateOptions} selectedId={form.rateId} onSelect={rateId=>set({rateId})}/>
      {form.rateId==='custom'?<AppField variant="open" label="Custom rate (kg/m²) *" value={form.customRate} onChangeText={customRate=>set({customRate})} keyboardType="decimal-pad"/>:null}
    </View>
    <View style={styles.group}>
      <Text style={styles.groupLabel}>MATERIAL</Text>
      <View style={styles.two}><View style={styles.half}><AppField variant="open" label="Compacted density (t/m³) *" value={form.density} onChangeText={value=>set({density:value})} keyboardType="decimal-pad"/></View><View style={styles.half}><AppField variant="open" label="Allowance (%)" value={form.allowance} onChangeText={value=>set({allowance:value})} keyboardType="decimal-pad"/></View></View>
    </View>
    <View style={styles.group}>
      <Text style={styles.groupLabel}>LOOSE THICKNESS · OPTIONAL</Text>
      <SearchableSelect variant="open" label="Loose-to-compacted thickness factor" options={looseFactorOptions} selectedId={form.looseFactorId} onSelect={looseFactorId=>set({looseFactorId})} placeholder="Choose your project/paver factor (optional)"/>
      {form.looseFactorId==='custom'?<AppField variant="open" label="Custom loose-thickness factor" value={form.customLooseFactor} onChangeText={customLooseFactor=>set({customLooseFactor})} keyboardType="decimal-pad" placeholder="Example: 1.20"/>:null}
      <Text style={styles.note}>No universal factor is assumed. Use the value established by the mix, paver setup, trial strip, or project specification.</Text>
    </View>
    <View style={styles.group}>
      <Text style={styles.groupLabel}>SO FAR</Text>
      <Row label="Finished thickness" value={result?`${format(result.thicknessMm)} mm`:'—'}/>
      <Row label="Loose thickness" value={result&&looseFactor?`${format(looseThickness(result.thicknessMm,looseFactor))} mm`:'Choose a factor'}/>
    </View>
  </PavementPageFrame>;

  if(page==='tools')return <PavementTools tools={tools} areaM2={area.areaM2} plannedTonnes={result?.plannedTonnes??0} onBack={()=>go('result')} error={error} message={message} onUseArea={value=>{set({areaMode:'direct',directArea:value.toFixed(2)});setMessage(`Direct net area set to ${format(value,2)} m². Open 1 · Area to see it.`);}}/>;

  if(page==='saved')return <PavementPageFrame band={{mark:'▤',title:'Saved calculations',hint:`${visible.length} ${form.projectId||initialProjectId?`under ${projectName}`:'saved'} · ${format(totalArea,1)} m² · ${format(totalPlanned,3)} t`,tone:'cream'}} onBack={()=>go('result')} error={error} message={message}
    bar={{label:'COMBINED PLANNED',value:`${format(totalPlanned,3)} t`,secondary:{label:'Back to result',onPress:()=>go('result')}}}>
    {visible.length?<View style={styles.two}><View style={styles.half}><AppButton label="Export PDF" tone="secondary" disabled={busy} onPress={()=>void runExport('pdf')}/></View><View style={styles.half}><AppButton label="Export Excel" tone="secondary" disabled={busy} onPress={()=>void runExport('excel')}/></View></View>:null}
    {visible.length?visible.map(record=><TouchableOpacity key={record.id} style={styles.record} onPress={()=>edit(record)} accessibilityRole="button" accessibilityLabel={`Edit ${record.name}`}>
      <View style={styles.recordCopy}><Text style={styles.recordProject}>{record.projectName.toUpperCase()}</Text><Text style={styles.recordTitle}>{record.name}</Text>
        <Text style={styles.recordDetail}>{format(record.spreadRateKgM2,0)} kg/m² · {format(record.thicknessMm)} mm finished{record.looseThicknessMm!==null?` · ${format(record.looseThicknessMm)} mm loose`:''} · {format(record.areaM2,2)} m²{record.areaSections?.length?` · ${record.areaSections.length} road section${record.areaSections.length===1?'':'s'}`:''} · {format(record.densityTM3,2)} t/m³ · {format(record.allowancePercent)}% allowance</Text></View>
      <View style={styles.recordSide}><Text style={styles.recordValue}>{format(record.plannedKg/1000,3)} t</Text><Text style={styles.recordEdit}>Edit ›</Text></View>
    </TouchableOpacity>):<EmptyState title="No saved calculations" body="Your project-linked asphalt layers and quantities will appear here."/>}
  </PavementPageFrame>;

  return <PavementPageFrame dots={{total:3,current:3}} band={{mark:'3',title:'Result',hint:'What to order, and save it under the project.',tone:'teal'}} onBack={()=>go('rate')} error={error} message={message}
    bar={{label:editingId?'UPDATE UNDER':'SAVE UNDER',value:form.projectId?projectName:'Choose a project',secondary:{label:'Back',onPress:()=>go('rate')},primary:{label:editingId?'Update':'Save',onPress:()=>void save(),busy,disabled:!result||!form.projectId||!form.name.trim()||busy}}}>
    <View style={styles.group}>
      <View style={styles.hero}><Text style={styles.heroLabel}>PLANNED ASPHALT</Text><Text style={styles.heroValue}>{result?`${format(result.plannedTonnes,3)} t`:'—'}</Text>
        <View style={styles.heroRow}><View><Text style={styles.heroLabel}>AREA</Text><Text style={styles.heroSmall}>{format(area.areaM2)} m²</Text></View><View><Text style={styles.heroLabel}>FINISHED</Text><Text style={styles.heroSmall}>{result?`${format(result.thicknessMm)} mm`:'—'}</Text></View></View></View>
      <Row label="Theoretical quantity" value={result?`${format(result.theoreticalTonnes,3)} t`:'—'}/>
      <Row label={`Allowance (${format(allowance)}%)`} value={result?`${format(result.allowanceKg/1000,3)} t`:'—'}/>
      <Row label={looseFactor?`Loose thickness (${format(looseFactor,2)} ×)`:'Loose thickness'} value={result&&looseFactor?`${format(looseThickness(result.thicknessMm,looseFactor))} mm`:'Choose a factor'}/>
      <Row label={`Trucks at ${payload.trim()||'—'} t payload`} value={trucks===null?'—':String(trucks)}/>
      <AppField variant="open" label="Truck payload (t) · for the truck count only" value={payload} onChangeText={setPayload} keyboardType="decimal-pad"/>
    </View>
    <View style={styles.group}>
      <Text style={styles.groupLabel}>NOTES</Text>
      <AppField variant="open" label="Notes" value={form.notes} onChangeText={notes=>set({notes})} multiline placeholder="Mix, station limits, exclusions, or site notes"/>
    </View>
    <View style={styles.group}>
      <TouchableOpacity style={styles.rowLink} onPress={()=>go('tools')} accessibilityRole="button"><View style={styles.recordCopy}><Text style={styles.rowLinkTitle}>More tools</Text><Text style={styles.recordDetail}>Layers, coats, milling, slopes, delivery</Text></View><Text style={styles.chevron}>›</Text></TouchableOpacity>
      <TouchableOpacity style={styles.rowLink} onPress={()=>go('saved')} accessibilityRole="button"><View style={styles.recordCopy}><Text style={styles.rowLinkTitle}>Saved calculations</Text><Text style={styles.recordDetail}>{visible.length} {form.projectId||initialProjectId?'under this project':'saved'}</Text></View><Text style={styles.chevron}>›</Text></TouchableOpacity>
      {editingId?<AppButton label="Cancel editing" tone="secondary" disabled={busy} onPress={cancelEditing}/>:null}
    </View>
  </PavementPageFrame>;
}

function Row({label,value}:{label:string;value:string}){return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>;}

const styles=StyleSheet.create({
  group:{borderTopWidth:1,borderTopColor:colors.line,paddingTop:12,gap:8},
  groupLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1.2},
  help:{color:colors.muted,fontSize:12,lineHeight:17},
  note:{color:colors.navy,backgroundColor:'#E9EEF4',borderRadius:12,padding:12,fontSize:13,lineHeight:19},
  two:{flexDirection:'row',gap:12},half:{flex:1,minWidth:0},
  locked:{gap:3,paddingVertical:4},lockedLabel:{color:colors.brandDark,fontSize:9,fontWeight:'900',letterSpacing:1},lockedValue:{color:colors.ink,fontSize:18,fontWeight:'900'},
  areaBand:{backgroundColor:colors.result,borderWidth:2,borderColor:colors.resultDark,borderRadius:14,padding:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},
  areaLabel:{color:colors.resultSoft,fontSize:10,fontWeight:'900',letterSpacing:.9},areaValue:{color:'#FFF',fontSize:24,fontWeight:'900'},
  row:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',gap:10,paddingVertical:11,paddingHorizontal:2,borderBottomWidth:1,borderBottomColor:'#E6E0D4'},
  rowLabel:{color:colors.muted,fontSize:12,flex:1},rowValue:{color:colors.resultDark,fontSize:17,fontWeight:'900'},
  hero:{backgroundColor:colors.result,borderWidth:2,borderColor:colors.resultDark,borderRadius:14,padding:14,gap:4},
  heroLabel:{color:colors.resultSoft,fontSize:10,fontWeight:'900',letterSpacing:.9},heroValue:{color:'#FFF',fontSize:34,fontWeight:'900'},heroRow:{flexDirection:'row',gap:24,marginTop:6},heroSmall:{color:'#FFF',fontSize:18,fontWeight:'900'},
  rowLink:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:14,minHeight:60,borderBottomWidth:1,borderBottomColor:'#E0DACD'},
  rowLinkTitle:{color:colors.navy,fontSize:15,fontWeight:'800'},chevron:{color:colors.brand,fontSize:24,fontWeight:'700'},
  record:{flexDirection:'row',gap:12,alignItems:'center',paddingVertical:14,minHeight:76,borderBottomWidth:1,borderBottomColor:'#E0DACD'},
  recordCopy:{flex:1,minWidth:0,gap:2},recordProject:{color:colors.brand,fontSize:9,fontWeight:'900',letterSpacing:.7},recordTitle:{color:colors.navy,fontSize:15,fontWeight:'800'},recordDetail:{color:colors.muted,fontSize:12,lineHeight:17},
  recordSide:{alignItems:'flex-end',gap:4},recordValue:{color:colors.resultDark,fontSize:15,fontWeight:'900'},recordEdit:{color:colors.brand,fontSize:12,fontWeight:'800',borderRadius:radius.sm},
});
