import {useCallback,useEffect,useMemo,useState,type ReactNode} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {BusinessDocumentRepository} from '../../data/repositories/BusinessDocumentRepository';
import type {CompanyTotalsRepository,UsageRecord} from '../../data/repositories/CompanyTotalsRepository';
import type {LoadNumberSeriesRepository} from '../../data/repositories/LoadNumberSeriesRepository';
import type {ProjectTotalsRepository} from '../../data/repositories/ProjectTotalsRepository';
import type {ProfileRepository} from '../../data/repositories/ProfileRepository';
import type {RecordSnapshot} from '../../domain/businessDocuments';
import type {CompanyTotalsFilters} from '../../domain/companyTotals';
import {fuelTypeLabels} from '../../domain/fuel';
import type {Project} from '../../domain/loads';
import {constructionSourceLabels,formatTotalQuantity,summarizeConstruction,summarizeFuel,type Measure,type ProjectTotalsData} from '../../domain/projectTotals';
import {AppPage,Feedback,PageHeader} from '../components/AppPrimitives';
import {TotalsExplorer,type ExplorerLevel} from '../components/totals/TotalsExplorer';
import type {DocumentStart} from '../documentFlow';
import {colors} from '../theme';
import {stepUp} from './CompanyTotalsScreen';

const records=(count:number)=>`${count} record${count===1?'':'s'}`;

/**
 * DEC-481 / DEC-500. A project's Totals: Project → Material → Supplier → original records, through the
 * same explorer as Home → Totals, so a document started here is the same document everywhere. Fuel and
 * wall/foundation materials keep their own sections (DEC-481): each fuel type and each construction
 * source is counted on its own and never added to Daily Report use.
 */
export function ProjectTotalsScreen({project,repository,totals,documents,series,profiles,level:savedLevel,onLevel,onBack,onOpenRecord,onOpenReport,onCreateDocument}:{
  level?:ExplorerLevel;onLevel?:(level:ExplorerLevel)=>void;
  project:Project;repository:ProjectTotalsRepository;totals:CompanyTotalsRepository;documents:BusinessDocumentRepository;series:LoadNumberSeriesRepository;profiles?:ProfileRepository;onBack:()=>void;
  onOpenRecord:(record:RecordSnapshot)=>void;onOpenReport:(usage:UsageRecord)=>void;onCreateDocument:(start:DocumentStart)=>void;
}){
  const[ownLevel,setOwnLevel]=useState<ExplorerLevel>({});
  const level=savedLevel??ownLevel;const setLevel=onLevel??setOwnLevel;
  const[filters,setFilters]=useState<CompanyTotalsFilters|null>(null);
  const[data,setData]=useState<ProjectTotalsData|null>(null);
  const[error,setError]=useState<string|null>(null);
  const onFilters=useCallback((next:CompanyTotalsFilters)=>setFilters(next),[]);
  useEffect(()=>{
    if(!filters)return;
    let active=true;setError(null);
    repository.getProjectTotals(project.id,{fromDate:filters.fromDate,toDate:filters.toDate}).then(next=>{if(active)setData(next);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Fuel and construction totals could not be calculated.');});
    return()=>{active=false;};
  },[repository,project.id,filters?.fromDate,filters?.toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const top=!level.material;
  const showSite=top&&filters&&filters.view!=='delivered'&&!filters.itemKey&&!filters.supplierKey&&!filters.seriesId&&filters.inclusion==='all';
  const fuel=useMemo(()=>data&&showSite?summarizeFuel(data.fuel):[],[data,showSite]);
  const construction=useMemo(()=>data&&showSite?summarizeConstruction(data.construction):[],[data,showSite]);

  return <AppPage keyboard>
    <PageHeader eyebrow="PROJECT TOTALS" title={project.name} onBack={()=>stepUp(level,onBack,setLevel,true)}/>
    {top?<Text style={styles.lead}>Delivered and used are separate records and are never added together. Every total stays in its own unit; nothing is converted.</Text>:null}
    <TotalsExplorer scope={{kind:'project',projectId:project.id,projectName:project.name,customerId:project.customerId,customerName:project.customerName,location:project.location,status:project.status==='completed'?'Completed':'Active'}} totals={totals} documents={documents} series={series} profiles={profiles} loadFuelFills={range=>repository.listFuelFills(project.id,range)} level={level} onLevel={setLevel}
      onOpenRecord={onOpenRecord} onOpenReport={onOpenReport} onCreateDocument={onCreateDocument} onFilters={onFilters}/>

    {error&&showSite?<Feedback kind="error">{error}</Feedback>:null}
    {fuel.length?<Section title="Fuel used" note="Equipment fills to this project. Each fuel type is totalled on its own; diesel and gasoline are never added together.">
      <View style={styles.ledger}>
        {fuel.map((type,index)=><View key={type.fuelType} style={[styles.block,index>0&&styles.rule]}>
          <LedgerLine label={`${fuelTypeLabels[type.fuelType]} used`} value={{quantity:type.litres,recordCount:type.recordCount}} unitSymbol="L" strong/>
          {type.equipment.map(equipment=><LedgerLine key={equipment.equipmentName} label={equipment.equipmentName} value={{quantity:equipment.litres,recordCount:equipment.recordCount}} unitSymbol="L" indent/>)}
        </View>)}
      </View>
    </Section>:null}
    {construction.length?<Section title="Wall and foundation materials used" note="Actual quantities only. Each source is listed on its own and never added together or to Daily Report use, because one pour may be recorded in more than one place.">
      <View style={styles.ledger}>
        {construction.map((group,index)=><View key={`${group.materialKey}-${group.unitKey}`} style={[styles.block,index>0&&styles.rule]}>
          <Text style={styles.groupTitle}>{group.materialLabel} <Text style={styles.groupUnit}>· used, in {group.unitSymbol}</Text></Text>
          {group.sources.map(source=><LedgerLine key={source.source} label={constructionSourceLabels[source.source]} value={source} unitSymbol={group.unitSymbol} indent/>)}
        </View>)}
      </View>
    </Section>:null}
  </AppPage>;
}

function Section({title,note,children}:{title:string;note?:string;children:ReactNode}){
  return <View style={styles.section}>
    <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
    {note?<Text style={styles.sectionNote}>{note}</Text>:null}
    {children}
  </View>;
}

function LedgerLine({label,value,unitSymbol,strong=false,indent=false}:{label:string;value:Measure|null;unitSymbol:string;strong?:boolean;indent?:boolean}){
  const spoken=`${label}: ${value?formatTotalQuantity(value.quantity,unitSymbol):'Not recorded'}`;
  return <View style={styles.line} accessible accessibilityLabel={spoken}>
    <Text style={[styles.lineLabel,strong&&styles.lineStrong,indent&&styles.lineIndent]}>{label}</Text>
    <View style={styles.lineValueBox}>
      {value?<Text style={[styles.lineValue,strong&&styles.lineStrong]}>{formatTotalQuantity(value.quantity,unitSymbol)}</Text>:<Text style={styles.notRecorded}>Not recorded</Text>}
      {value?<Text style={styles.valueCount}>{records(value.recordCount)}</Text>:null}
    </View>
  </View>;
}

const styles=StyleSheet.create({
  lead:{color:'#4F5B66',fontSize:14,lineHeight:20},
  section:{gap:8,marginTop:6},
  sectionTitle:{color:colors.ink,fontSize:17,fontWeight:'800'},
  sectionNote:{color:'#4F5B66',fontSize:13,lineHeight:19},
  ledger:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:'#E3DBCD',overflow:'hidden'},
  block:{paddingHorizontal:16,paddingVertical:8},
  rule:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line},
  groupTitle:{color:colors.ink,fontSize:15,fontWeight:'700',paddingTop:6},
  groupUnit:{color:colors.muted,fontSize:13,fontWeight:'500'},
  line:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10,paddingVertical:6},
  lineLabel:{flex:1,minWidth:0,color:colors.ink,fontSize:14,fontWeight:'500'},
  lineStrong:{fontWeight:'700'},
  lineIndent:{color:'#4F5B66',paddingLeft:12},
  lineValueBox:{alignItems:'flex-end',flexShrink:0,maxWidth:'55%'},
  lineValue:{color:colors.ink,fontSize:15,fontWeight:'600',fontVariant:['tabular-nums']},
  valueCount:{color:'#5A6570',fontSize:12,marginTop:1},
  notRecorded:{color:'#5A6570',fontSize:14,fontStyle:'italic'},
});
