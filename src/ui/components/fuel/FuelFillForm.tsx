import {useEffect,useState,type ReactNode} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {FuelRepository} from '../../../data/repositories/FuelRepository';
import {type FuelFillDraft,type FuelSetup,type FuelSource} from '../../../domain/fuel';
import type {DieselBatchOverview,TankFillPreviewResult} from '../../../domain/fuelBatches';
import {fillFormHelper,fillFormKind,fillFormReady,formatLitres,formatMoney,openBatchOptions,overfillMessage,stationFillPreviewLines,tankFillPreviewLines,type PreviewLine} from '../../../domain/fuelFillForm';
import {colors,radius} from '../../theme';
import {AppButton,AppField,Feedback} from '../AppPrimitives';
import {DatePickerField,todayIso} from '../DatePickerField';
import {FuelDestinationFields} from '../FuelDestinationFields';
import {SearchableSelect} from '../SearchableSelect';
import {SegmentedChoice} from '../SegmentedChoice';

/**
 * DEC-492, Screen B of the approved design. One numbered card per question: the fuel source, the batch
 * or station, the equipment, the destination, then litres and date. A "Before you save" panel says
 * exactly what the fill will do, before it is saved.
 */
type Props={
  setup:FuelSetup;
  batchOverview:DieselBatchOverview;
  draft:FuelFillDraft;
  onChange:(next:FuelFillDraft)=>void;
  lockedProjectId?:string|null;
  projectName?:string;
  currentPrice:number|null;
  busy:boolean;
  onSave:()=>void;
  onManageSites:()=>void;
  onManageStations:()=>void;
  repository:Pick<FuelRepository,'previewTankFill'|'createFuelStation'>;
  onStationsChanged:()=>Promise<void>;
};

export function FuelFillForm({setup,batchOverview,draft,onChange,lockedProjectId,projectName,currentPrice,busy,onSave,onManageSites,onManageStations,repository,onStationsChanged}:Props){
  const kind=fillFormKind(draft,setup.batchTracking),source:FuelSource=draft.fuelSource??'tank',fuelType=draft.fuelType??'diesel';
  const[preview,setPreview]=useState<TankFillPreviewResult|null>(null),[previewNote,setPreviewNote]=useState<string|null>(null);
  const[addingStation,setAddingStation]=useState(false),[stationName,setStationName]=useState(''),[stationBusy,setStationBusy]=useState(false),[stationError,setStationError]=useState<string|null>(null);
  const options=openBatchOptions(batchOverview.batches),oldest=options[0]?.id??'';
  const equipmentPool=draft.equipmentType==='truck'?setup.trucks:setup.machines,equipment=equipmentPool.find(value=>value.id===draft.equipmentId);
  const activeStations=setup.fuelStations.filter(station=>station.isActive);
  const destinationType=draft.destinationType??'unassigned';
  const dateProject=setup.projects.find(project=>project.id===(lockedProjectId??(destinationType==='project'?draft.projectId:'')));
  const litresNumber=Number(draft.litres.trim().replace(',','.'));

  useEffect(()=>{
    if(kind!=='tank_batch'||!draft.litres.trim()){setPreview(null);setPreviewNote(null);return;}
    let cancelled=false;
    const timer=setTimeout(()=>{
      repository.previewTankFill({litres:draft.litres,batchId:draft.batchId??'',recordDate:draft.recordDate}).then(result=>{if(!cancelled){setPreview(result);setPreviewNote(null);}}).catch(cause=>{if(!cancelled){setPreview(null);setPreviewNote(cause instanceof Error?cause.message:'The preview is not available.');}});
    },250);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[kind,draft.litres,draft.batchId,draft.recordDate,repository,batchOverview]);

  const chooseSource=(next:FuelSource)=>{
    if(next===source)return;
    onChange(next==='station'
      ?{...draft,fuelSource:'station',batchId:'',pricePerLitreUsd:'',priceOverrideReason:''}
      :{...draft,fuelSource:'tank',stationId:'',receiptNumber:'',pricePerLitreUsd:currentPrice==null?'':currentPrice.toFixed(2),priceOverrideReason:''});
    setAddingStation(false);setStationError(null);
  };
  const saveStation=async()=>{
    setStationBusy(true);setStationError(null);
    try{const station=await repository.createFuelStation({name:stationName,location:'',notes:''});await onStationsChanged();onChange({...draft,stationId:station.id});setStationName('');setAddingStation(false);}
    catch(cause){setStationError(cause instanceof Error?cause.message:'The station could not be saved.');}
    finally{setStationBusy(false);}
  };

  const priceNumber=Number(draft.pricePerLitreUsd.trim().replace(',','.'));
  const plainCost=draft.pricePerLitreUsd.trim()&&Number.isFinite(priceNumber)&&Number.isFinite(litresNumber)&&litresNumber>0?Math.round(litresNumber*priceNumber*100)/100:null;
  const needsOverride=kind==='tank_plain'&&currentPrice!=null&&Number.isFinite(priceNumber)&&draft.pricePerLitreUsd.trim()!==''&&Math.round(priceNumber*100)!==Math.round(currentPrice*100);

  const stationLines=kind==='station'&&Number.isFinite(litresNumber)&&litresNumber>0&&equipment&&draft.stationId
    ?stationFillPreviewLines({stationName:activeStations.find(station=>station.id===draft.stationId)?.name??'Saved station',litres:litresNumber,tankLitres:batchOverview.tankLitres,equipmentName:equipment.name,destinationType})
    :null;
  const tankLines=kind==='tank_batch'&&preview&&Number.isFinite(litresNumber)?tankFillPreviewLines(preview,litresNumber):null;
  const overfill=preview?overfillMessage(preview):null;

  return <View style={styles.form}>
    <Text style={styles.helper}>{fillFormHelper(kind)}</Text>

    <Step number={1} title="Fuel source">
      <SegmentedChoice label="Fuel source *" options={[{id:'tank',label:'From tank'},{id:'station',label:'Outside station'}]} selectedId={source} onSelect={chooseSource}/>
    </Step>

    {kind==='station'?<Step number={2} title="Station">
      <SearchableSelect label="Station *" options={activeStations.map(station=>({id:station.id,label:station.name,detail:station.location??'Saved station'}))} selectedId={draft.stationId??''} onSelect={stationId=>onChange({...draft,stationId})} placeholder="Select station"/>
      {addingStation?<View style={styles.inline}>
        <AppField label="New station name *" value={stationName} onChangeText={setStationName} autoCapitalize="words" returnKeyType="done"/>
        {stationError?<Feedback kind="error">{stationError}</Feedback>:null}
        <View style={styles.pair}>
          <View style={styles.flex}><AppButton label="Save Station" tone="navy" busy={stationBusy} disabled={!stationName.trim()} onPress={()=>void saveStation()}/></View>
          <View style={styles.flex}><AppButton label="Cancel" tone="secondary" onPress={()=>{setAddingStation(false);setStationError(null);}}/></View>
        </View>
      </View>:<View style={styles.linkRow}>
        <TouchableOpacity style={styles.link} onPress={()=>setAddingStation(true)} accessibilityRole="button" accessibilityLabel="Add new station"><Text style={styles.linkText}>+ Add new station</Text></TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={onManageStations} accessibilityRole="button" accessibilityLabel="Manage stations"><Text style={styles.linkText}>Manage stations</Text></TouchableOpacity>
      </View>}
      <SegmentedChoice label="Fuel type *" options={[{id:'diesel',label:'Diesel'},{id:'gasoline',label:'Gasoline'}]} selectedId={fuelType} onSelect={next=>onChange({...draft,fuelType:next})}/>
      <AppField label="Receipt number (optional)" value={draft.receiptNumber??''} onChangeText={receiptNumber=>onChange({...draft,receiptNumber})}/>
      <AppField label="Price (optional · cost history only)" value={draft.pricePerLitreUsd} onChangeText={pricePerLitreUsd=>onChange({...draft,pricePerLitreUsd})} keyboardType="decimal-pad" placeholder="Unpriced"/>
    </Step>:null}

    {kind==='tank_batch'?<Step number={2} title="Batch">
      {options.length?<>
        <SearchableSelect label="Batch *" options={options} selectedId={draft.batchId||oldest} onSelect={id=>onChange({...draft,batchId:id===oldest?'':id})} placeholder="Select batch"/>
        <Text style={styles.hint}>Pre-selected automatically. You can change it to another open batch.</Text>
      </>:<View style={styles.empty}>
        <Text style={styles.emptyTitle}>No open batch</Text>
        <Text style={styles.emptyBody}>No diesel batch has diesel left. Record a diesel delivery to start one. This fill is still saved, with an Overfill Alert.</Text>
      </View>}
      <TouchableOpacity style={styles.link} onPress={()=>onChange({...draft,fuelType:'gasoline',batchId:''})} accessibilityRole="button" accessibilityLabel="Fill with gasoline instead"><Text style={styles.linkText}>Fill with gasoline instead</Text></TouchableOpacity>
    </Step>:null}

    {kind==='tank_plain'?<Step number={2} title="Fuel">
      <SegmentedChoice label="Fuel type *" options={[{id:'diesel',label:'Diesel'},{id:'gasoline',label:'Gasoline'}]} selectedId={fuelType} onSelect={next=>onChange({...draft,fuelType:next,batchId:''})}/>
      <Text style={styles.hint}>{fuelType==='gasoline'?'Gasoline is bought as needed rather than stored, so this fill records its cost but does not change the diesel tank balance.':'Diesel batches have not been started, so this fill is recorded as before.'}</Text>
      <AppField label="USD price per litre" value={draft.pricePerLitreUsd} onChangeText={pricePerLitreUsd=>onChange({...draft,pricePerLitreUsd})} keyboardType="decimal-pad" placeholder="Unpriced"/>
      {needsOverride?<AppField label="Price override reason *" value={draft.priceOverrideReason} onChangeText={priceOverrideReason=>onChange({...draft,priceOverrideReason})} multiline/>:null}
    </Step>:null}

    <Step number={3} title="Equipment">
      <SegmentedChoice label="Equipment type *" options={[{id:'machine',label:'Machine'},{id:'truck',label:'Truck'}]} selectedId={draft.equipmentType} onSelect={equipmentType=>onChange({...draft,equipmentType,equipmentId:''})}/>
      <SearchableSelect label={`${draft.equipmentType==='truck'?'Truck':'Machine'} *`} options={equipmentPool.map(value=>({id:value.id,label:value.name,detail:value.detail??`Saved ${draft.equipmentType} profile`}))} selectedId={draft.equipmentId} onSelect={equipmentId=>onChange({...draft,equipmentId})} placeholder={`Select ${draft.equipmentType}`}/>
    </Step>

    <Step number={4} title="Destination">
      {lockedProjectId
        ?<View style={styles.locked}><Text style={styles.lockedLabel}>Fuel destination (locked)</Text><Text style={styles.lockedValue}>Project: {projectName}</Text></View>
        :<FuelDestinationFields value={{destinationType,projectId:draft.projectId,companySiteId:draft.companySiteId??''}} onChange={next=>onChange({...draft,...next})} projects={setup.projects} companySites={setup.companySites} onManageSites={onManageSites}/>}
    </Step>

    <Step number={5} title="Quantity and date">
      <View style={styles.pair}>
        <View style={styles.flex}><AppField label="Litres *" value={draft.litres} onChangeText={litres=>onChange({...draft,litres})} keyboardType="decimal-pad"/></View>
        <View style={styles.flex}><DatePickerField label="Date *" value={draft.recordDate} onChange={recordDate=>onChange({...draft,recordDate})} minDate={dateProject?.startDate} maxDate={dateProject?.endDate??todayIso()}/></View>
      </View>
      <AppField label="Odometer (optional, reference only)" value={draft.odometerReading} onChangeText={odometerReading=>onChange({...draft,odometerReading})} placeholder="Not recorded"/>
      <AppField label="Note (optional)" value={draft.notes} onChangeText={notes=>onChange({...draft,notes})} placeholder="Add a note" multiline/>
    </Step>

    {tankLines?<Preview lines={tankLines} tone="batch"/>:null}
    {kind==='tank_batch'&&!tankLines&&previewNote?<Text style={styles.hint}>{previewNote}</Text>:null}
    {overfill?<View style={styles.alert} accessibilityRole="alert"><Text style={styles.alertText}>{overfill}</Text></View>:null}
    {stationLines?<Preview lines={stationLines} tone="neutral"/>:null}
    {kind==='tank_plain'?(plainCost!=null
      ?<Preview tone="neutral" lines={[{label:'Fill cost',note:`${formatLitres(litresNumber)} × ${priceNumber.toFixed(2)}/L`,value:formatMoney(plainCost),kind:'total'}]}/>
      :<Feedback kind="warning">No price entered: this fill will be saved as Unpriced and listed separately in reports.</Feedback>):null}

    <AppButton label="Save Fill" tone="primary" busy={busy} disabled={!fillFormReady(draft,kind)} onPress={onSave}/>
  </View>;
}

function Step({number,title,children}:{number:number;title:string;children:ReactNode}){
  return <View style={styles.step} accessibilityRole="summary" accessibilityLabel={`Step ${number}, ${title}`}>
    <View style={styles.stepHead}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View><Text style={styles.stepTitle}>{title.toUpperCase()}</Text></View>
    {children}
  </View>;
}

/** The "Before you save" panel. The tint says nothing by itself: every line is written out in words. */
function Preview({lines,tone}:{lines:PreviewLine[];tone:'batch'|'neutral'}){
  return <View style={[styles.preview,tone==='neutral'&&styles.previewNeutral]}>
    <Text style={styles.previewTitle}>BEFORE YOU SAVE</Text>
    {lines.map((line,index)=><View key={`${line.label}-${index}`} style={[styles.previewRow,line.kind==='total'&&styles.previewTotal]}>
      <View style={styles.previewCopy}>
        <Text style={[styles.previewLabel,line.kind==='total'&&styles.previewLabelStrong,line.kind==='alert'&&styles.previewAlert]}>{line.label}</Text>
        {line.note?<Text style={[styles.previewNote,line.kind==='alert'&&styles.previewAlert]}>{line.note}</Text>:null}
      </View>
      <Text style={[styles.previewValue,line.kind==='total'&&styles.previewLabelStrong,line.kind==='alert'&&styles.previewAlert]}>{line.value}</Text>
    </View>)}
  </View>;
}

const styles=StyleSheet.create({
  form:{gap:16},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  hint:{color:colors.muted,fontSize:12,lineHeight:17},
  flex:{flex:1,minWidth:0},
  pair:{flexDirection:'row',gap:10,alignItems:'flex-start'},
  step:{backgroundColor:colors.surface,borderRadius:radius.lg,padding:17,gap:12,borderWidth:1,borderColor:'#E8DED0'},
  stepHead:{flexDirection:'row',alignItems:'center',gap:8},
  stepNumber:{width:24,height:24,borderRadius:12,backgroundColor:colors.navy,alignItems:'center',justifyContent:'center'},
  stepNumberText:{color:'#FFFFFF',fontSize:12,fontWeight:'900'},
  stepTitle:{color:colors.navy,fontSize:12,fontWeight:'900',letterSpacing:1},
  link:{minHeight:48,justifyContent:'center'},
  linkRow:{flexDirection:'row',flexWrap:'wrap',columnGap:20},
  linkText:{color:colors.navy,fontSize:14,fontWeight:'900'},
  inline:{gap:10,padding:12,borderRadius:radius.md,backgroundColor:colors.cream,borderWidth:1,borderColor:'#E8DED0'},
  empty:{gap:6,padding:14,borderRadius:radius.md,borderWidth:1,borderStyle:'dashed',borderColor:colors.line,backgroundColor:colors.cream},
  emptyTitle:{color:colors.ink,fontSize:14,fontWeight:'900'},
  emptyBody:{color:colors.muted,fontSize:13,lineHeight:19},
  locked:{gap:3,padding:12,borderRadius:radius.md,backgroundColor:colors.cream},
  lockedLabel:{color:colors.muted,fontSize:12,fontWeight:'800'},
  lockedValue:{color:colors.ink,fontSize:14,fontWeight:'900'},
  preview:{backgroundColor:'#EEF2F7',borderRadius:radius.lg,padding:16,gap:4,borderWidth:1,borderColor:'#C7D3E2'},
  previewNeutral:{backgroundColor:colors.creamSoft,borderColor:colors.line},
  previewTitle:{color:colors.navy,fontSize:12,fontWeight:'900',letterSpacing:1,marginBottom:4},
  previewRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:12,paddingVertical:8,borderTopWidth:1,borderTopColor:'rgba(23,63,103,0.12)'},
  previewTotal:{borderTopWidth:2,borderTopColor:colors.navy},
  previewCopy:{flex:1,minWidth:0,gap:2},
  previewLabel:{color:colors.ink,fontSize:13,fontWeight:'700'},
  previewLabelStrong:{fontWeight:'900',color:colors.ink},
  previewNote:{color:colors.muted,fontSize:12,lineHeight:17},
  previewValue:{color:colors.ink,fontSize:13,fontWeight:'800',textAlign:'right',maxWidth:'55%'},
  previewAlert:{color:colors.danger,fontWeight:'900'},
  alert:{backgroundColor:'#FDECEA',borderRadius:radius.md,borderWidth:1,borderColor:'#F3B4AE',padding:14},
  alertText:{color:colors.danger,fontSize:13,lineHeight:19,fontWeight:'800'},
});
