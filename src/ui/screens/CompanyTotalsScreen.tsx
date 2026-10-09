import {useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';

import type {BusinessDocumentRepository} from '../../data/repositories/BusinessDocumentRepository';
import type {CompanyTotalsRepository,UsageRecord} from '../../data/repositories/CompanyTotalsRepository';
import type {LoadNumberSeriesRepository} from '../../data/repositories/LoadNumberSeriesRepository';
import type {ProfileRepository} from '../../data/repositories/ProfileRepository';
import type {RecordSnapshot} from '../../domain/businessDocuments';
import {AppPage,PageHeader} from '../components/AppPrimitives';
import type {CompanyHeaderRepository} from '../../data/repositories/CompanyHeaderRepository';
import {TotalsExplorer,type ExplorerLevel} from '../components/totals/TotalsExplorer';
import type {DocumentStart} from '../documentFlow';
import {colors} from '../theme';

/** Steps the explorer up one level; at the top it leaves the screen. */
export function stepUp(level:ExplorerLevel,leave:()=>void,setLevel:(next:ExplorerLevel)=>void,skipProject=false){
  if(level.supplier){setLevel({material:level.material,project:level.project});return;}
  if(level.project&&!skipProject){setLevel({material:level.material});return;}
  if(level.material){setLevel({});return;}
  leave();
}

/**
 * DEC-500 (1). Home → Totals: company-wide Material → Project → Supplier → original records, with the
 * document status of every record read from the shared document links.
 */
export function CompanyTotalsScreen({totals,documents,series,profiles,headers,onOpenCompanySetups,level:savedLevel,onLevel,onBack,onOpenRecord,onOpenReport,onCreateDocument,onOpenCompanyLoadTotals,onOpenDocuments}:{
  /** Kept by the app shell so returning from a record or document lands on the same level. */
  level?:ExplorerLevel;onLevel?:(level:ExplorerLevel)=>void;
  totals:CompanyTotalsRepository;documents:BusinessDocumentRepository;series:LoadNumberSeriesRepository;profiles?:ProfileRepository;headers?:CompanyHeaderRepository;onOpenCompanySetups?:()=>void;onBack:()=>void;
  onOpenRecord:(record:RecordSnapshot)=>void;onOpenReport:(usage:UsageRecord)=>void;onCreateDocument:(start:DocumentStart)=>void;
  onOpenCompanyLoadTotals:()=>void;onOpenDocuments:()=>void;
}){
  const[ownLevel,setOwnLevel]=useState<ExplorerLevel>({});
  const level=savedLevel??ownLevel;const setLevel=onLevel??setOwnLevel;
  const top=!level.material;
  return <AppPage keyboard>
    <PageHeader eyebrow="COMPANY TOTALS" title="Totals" onBack={()=>stepUp(level,onBack,setLevel)}/>
    {top?<Text style={styles.lead}>Every project, every material. Delivered and used stay separate, and each unit stays on its own line.</Text>:null}
    <TotalsExplorer scope={{kind:'company'}} totals={totals} documents={documents} series={series} profiles={profiles} headers={headers} onOpenCompanySetups={onOpenCompanySetups} level={level} onLevel={setLevel}
      onOpenRecord={onOpenRecord} onOpenReport={onOpenReport} onCreateDocument={onCreateDocument}/>
    {top?<View style={styles.links}>
      <LinkRow title="Company Load Totals" body="Company loads by number series, item and project, with a PDF." onPress={onOpenCompanyLoadTotals}/>
      <LinkRow title="Invoices & Bills" body="Drafts, issued documents and cancelled history." onPress={onOpenDocuments}/>
    </View>:null}
  </AppPage>;
}

export function LinkRow({title,body,onPress}:{title:string;body:string;onPress:()=>void}){
  return <Pressable onPress={onPress} style={({pressed})=>[styles.link,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={`${title}. ${body}`}>
    <View style={styles.flex}><Text style={styles.linkTitle}>{title}</Text><Text style={styles.linkBody}>{body}</Text></View>
    <View style={styles.linkArrow}><Text style={styles.linkArrowText} importantForAccessibility="no">›</Text></View>
  </Pressable>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  pressed:{backgroundColor:'#F7F4EE'},
  lead:{color:'#4F5B66',fontSize:14,lineHeight:20},
  links:{gap:10,marginTop:4},
  link:{minHeight:64,flexDirection:'row',alignItems:'center',gap:12,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:'#D9CFBE',paddingHorizontal:16,paddingVertical:12},
  linkTitle:{color:colors.ink,fontSize:15,fontWeight:'700'},
  linkBody:{color:'#5A6570',fontSize:13,lineHeight:18,marginTop:2},
  linkArrow:{width:32,height:32,borderRadius:16,backgroundColor:'#EEF3F8',alignItems:'center',justifyContent:'center'},
  linkArrowText:{color:colors.navy,fontSize:20,fontWeight:'700'},
});
