import {useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {ContractQuantitiesRepository,ContractRowView} from '../../data/repositories/ContractQuantitiesRepository';
import type {ContractProjectSummary} from '../../domain/contractQuantities';
import type {Project} from '../../domain/loads';
import {AppButton,AppCard,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {ContractExportSheet} from '../components/contracts/ContractExportSheet';
import {ContractItemCard,contractUsd} from '../components/contracts/ContractParts';
import {colors} from '../theme';

const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
export const contractMaterialLine=(row:ContractRowView)=>row.materials.map(material=>material.name).join(', ')+` · ${row.item.unitSymbol}`;

/**
 * DEC-522 Phase D1 (mockup tab 1). A project's targets: the whole-project summary, then one card per item with its bar and
 * Allowed / Used / Remaining. Every figure comes from the repository and the domain; this screen does no arithmetic.
 */
export function ContractQuantitiesScreen({project,contracts,onBack,onAdd,onOpenItem}:{
  project:Project;contracts:ContractQuantitiesRepository;onBack:()=>void;onAdd:()=>void;onOpenItem:(contractItemId:string)=>void;
}){
  const[state,setState]=useState<{status:'loading'}|{status:'error';message:string}|{status:'ready';rows:ContractRowView[];summary:ContractProjectSummary}>({status:'loading'});
  const[showCancelled,setShowCancelled]=useState(false);
  const[exporting,setExporting]=useState(false);
  const load=useCallback(()=>{setState({status:'loading'});contracts.listProject(project.id).then(view=>setState({status:'ready',...view})).catch(cause=>setState({status:'error',message:cause instanceof Error?cause.message:'Could not open the targets.'}));},[contracts,project.id]);
  useEffect(load,[load]);

  return <AppPage>
    <PageHeader eyebrow={project.name} title="Quantity Targets" onBack={onBack}/>
    {state.status==='loading'?<View style={styles.center}><ActivityIndicator size="large" color={colors.brand}/><Text style={styles.helper}>Opening targets…</Text></View>:null}
    {state.status==='error'?<><Feedback kind="error">{state.message}</Feedback><AppButton label="Try again" tone="secondary" onPress={load}/></>:null}
    {state.status==='ready'?<Ready rows={state.rows} summary={state.summary} showCancelled={showCancelled} onToggleCancelled={()=>setShowCancelled(value=>!value)} onAdd={onAdd} onOpenItem={onOpenItem}/>:null}
    {state.status==='ready'&&state.summary.itemCount?<>
      <AppButton label="Export report (PDF / Excel)" tone="secondary" onPress={()=>setExporting(true)}/>
      <ContractExportSheet project={project} contracts={contracts} rows={state.rows} summary={state.summary} visible={exporting} onClose={()=>setExporting(false)}/>
    </>:null}
  </AppPage>;
}

function Ready({rows,summary,showCancelled,onToggleCancelled,onAdd,onOpenItem}:{rows:ContractRowView[];summary:ContractProjectSummary;showCancelled:boolean;onToggleCancelled:()=>void;onAdd:()=>void;onOpenItem:(id:string)=>void}){
  const live=rows.filter(row=>!row.item.cancelledAt),cancelled=rows.filter(row=>row.item.cancelledAt);
  const priced=live.some(row=>row.item.unitPriceUsd!==null);
  if(!live.length)return <>
    <EmptyState title="No targets yet" body="Add the quantities from the tender, for example 500 m³ of base course or 300 t of asphalt. Loads you record for this project can then count toward them. Nothing changes for loads until you add an item."/>
    <AppButton label="+ Add target" onPress={onAdd}/>
    {cancelled.length?<CancelledList rows={cancelled} open={showCancelled} onToggle={onToggleCancelled} onOpenItem={onOpenItem}/>:null}
  </>;
  return <>
    <AppCard title="Whole project" hint={summary.overallBasis==='value'?'Weighted by target value, because every item has a target price.':`Average of the ${plural(live.length,'item')}, because ${live.length===1?'it has':'not every item has'} a target price.`}>
      <View style={styles.summary}>
        <Metric value={summary.overallPercentUsed===null?'—':`${summary.overallPercentUsed.toFixed(1)}%`} label="Quantity used"/>
        <Metric value={`${summary.completeCount} of ${summary.itemCount}`} label="Items complete"/>
        <Metric value={priced?contractUsd(summary.totalSavingUsd):'No prices'} label="Saving, finished items" tone={priced?'money':undefined}/>
        <Metric value={String(summary.overruns.length)} label={summary.overruns.length===1?'Item over target':'Items over target'} tone={summary.overruns.length?'over':undefined}/>
      </View>
      {priced&&summary.estimatedSavingUsd>0?<Text style={styles.helper}>Estimated, items still in progress: {contractUsd(summary.estimatedSavingUsd)}</Text>:null}
    </AppCard>
    <AppButton label="+ Add target" onPress={onAdd}/>
    {live.map(row=><ContractItemCard key={row.item.id} item={row.item} usage={row.usage} materialLine={contractMaterialLine(row)} onPress={()=>onOpenItem(row.item.id)}/>)}
    {cancelled.length?<CancelledList rows={cancelled} open={showCancelled} onToggle={onToggleCancelled} onOpenItem={onOpenItem}/>:null}
  </>;
}

function Metric({value,label,tone}:{value:string;label:string;tone?:'money'|'over'}){
  return <View style={styles.metric}><Text style={[styles.metricValue,tone==='money'&&styles.money,tone==='over'&&styles.over]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function CancelledList({rows,open,onToggle,onOpenItem}:{rows:ContractRowView[];open:boolean;onToggle:()=>void;onOpenItem:(id:string)=>void}){
  return <View style={styles.cancelled}>
    <TouchableOpacity style={styles.cancelledHead} onPress={onToggle} accessibilityRole="button" accessibilityState={{expanded:open}}><Text style={styles.cancelledTitle}>Cancelled items · {rows.length}</Text><Text style={styles.mark}>{open?'×':'+'}</Text></TouchableOpacity>
    {open?rows.map(row=><ContractItemCard key={row.item.id} item={row.item} usage={row.usage} materialLine={contractMaterialLine(row)} onPress={()=>onOpenItem(row.item.id)}/>):null}
  </View>;
}

const styles=StyleSheet.create({
  center:{alignItems:'center',gap:10,paddingVertical:30},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  summary:{flexDirection:'row',flexWrap:'wrap',gap:8},
  metric:{flexBasis:'47%',flexGrow:1,backgroundColor:colors.background,borderRadius:12,padding:10},
  metricValue:{color:colors.navy,fontSize:20,fontWeight:'800'},
  metricLabel:{color:colors.muted,fontSize:12,fontWeight:'600',marginTop:2},
  money:{color:'#17693B'},
  over:{color:'#A61B12'},
  cancelled:{borderWidth:1,borderStyle:'dashed',borderColor:'#B9B09C',borderRadius:14,paddingHorizontal:12,paddingBottom:8,gap:8},
  cancelledHead:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  cancelledTitle:{color:'#3C4854',fontSize:13,fontWeight:'800'},
  mark:{color:colors.navy,fontSize:22,fontWeight:'800'},
});
