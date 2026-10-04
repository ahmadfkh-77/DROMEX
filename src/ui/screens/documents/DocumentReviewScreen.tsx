import {useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';

import type {BusinessDocumentRepository} from '../../../data/repositories/BusinessDocumentRepository';
import type {CompanyTotalsRecord} from '../../../data/repositories/CompanyTotalsRepository';
import {documentKindInfo,groupDocumentLines,type EligibleRecord,type RecordSnapshot} from '../../../domain/businessDocuments';
import {formatTotalQuantity} from '../../../domain/projectTotals';
import {AppButton,AppPage,EmptyState,Feedback,PageHeader} from '../../components/AppPrimitives';
import {Ledger,RecordRow,styles as parts} from '../../components/totals/TotalsParts';
import {reviewSplit,type DocumentStart} from '../../documentFlow';
import {colors} from '../../theme';
import {formatCents,formatDay} from '../../totalsPresentation';

const methodLabel={filtered:'Current filtered results',date_range:'Date range',manual:'Chosen one by one'} as const;
const asRow=(record:EligibleRecord):CompanyTotalsRecord=>({key:record.key,snapshot:record.snapshot,seriesId:record.seriesId,status:'Active',cancellationReason:null,correctionCount:0,links:record.links,inclusion:record.inclusion});

/**
 * DEC-500 (3). Review before a draft exists: every candidate record with its item, project, party,
 * date and time, quantity, recorded price and reference; tick or untick any of them; see the totals per
 * unit and why some money is missing. Records already in an Issued document of this kind are listed
 * apart with the document that holds them, and cannot be ticked.
 */
export function DocumentReviewScreen({documents,start,onBack,onCreated,onOpenRecord}:{documents:BusinessDocumentRepository;start:DocumentStart;onBack:()=>void;onCreated:(documentId:string)=>void;onOpenRecord:(record:RecordSnapshot)=>void}){
  const info=documentKindInfo[start.kind];
  const[records,setRecords]=useState<EligibleRecord[]|null>(null);
  const[selected,setSelected]=useState<Set<string>>(()=>new Set());
  const[error,setError]=useState<string|null>(null);
  const[busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    documents.listEligibleRecords({side:start.side,partyId:start.partyId,recordKeys:start.recordKeys})
      .then(found=>{if(!active)return;setRecords(found);const split=reviewSplit(found,start.kind);setSelected(new Set(start.preselect==='all'?split.available.map(value=>value.key):[]));})
      .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Records could not be loaded.');});
    return()=>{active=false;};
  },[documents,start]);

  const split=useMemo(()=>records?reviewSplit(records,start.kind):{available:[],blocked:[]},[records,start.kind]);
  const chosen=useMemo(()=>split.available.filter(record=>selected.has(record.key)),[split,selected]);
  const groups=useMemo(()=>groupDocumentLines(chosen.map(record=>record.snapshot)),[chosen]);
  const missing=start.recordKeys.length-(records?.length??start.recordKeys.length);
  const toggle=(key:string)=>setSelected(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});

  const save=async()=>{
    setBusy(true);setError(null);
    try{const draft=await documents.createDraft({kind:start.kind,partyId:start.partyId,recordKeys:chosen.map(record=>record.key),selectionMethod:start.selectionMethod,periodFrom:start.periodFrom,periodTo:start.periodTo});onCreated(draft.id);}
    catch(cause){setError(cause instanceof Error?cause.message:'The draft could not be saved.');}
    finally{setBusy(false);}
  };

  return <AppPage>
    <PageHeader eyebrow="REVIEW RECORDS" title={`${info.mode==='internal'?'Internal ':'Official '}${info.label.toLocaleLowerCase('en-US')}`} onBack={onBack}/>
    <View style={parts.band}>
      <Text style={parts.trail}>{start.context}</Text>
      <Text style={parts.bandTitle}>{start.partyName}</Text>
      <Text style={parts.bandMeta}>{start.side==='customer'?'Customer':'Supplier'} · {methodLabel[start.selectionMethod]}{start.periodFrom||start.periodTo?` · ${formatDay(start.periodFrom)} – ${formatDay(start.periodTo)}`:''}</Text>
      <Text style={parts.bandMeta}>{chosen.length} of {split.available.length} record{split.available.length===1?'':'s'} ticked. Nothing is saved until you save the draft.</Text>
    </View>

    {error?<Feedback kind="error">{error}</Feedback>:null}
    {!records?(error?null:<View style={styles.center}><ActivityIndicator color={colors.brand}/><Text style={styles.helper}>Loading records…</Text></View>):<>
      {missing>0?<Feedback kind="warning">{missing} record{missing===1?' was':'s were'} cancelled, archived or changed since you chose {missing===1?'it':'them'}, and {missing===1?'is':'are'} left out.</Feedback>:null}
      {split.available.length?<>
        <View style={styles.bulk}>
          <Pressable onPress={()=>setSelected(new Set(split.available.map(record=>record.key)))} style={styles.bulkButton} accessibilityRole="button"><Text style={styles.bulkText}>Tick all</Text></Pressable>
          <Pressable onPress={()=>setSelected(new Set())} style={styles.bulkButton} accessibilityRole="button"><Text style={styles.bulkText}>Untick all</Text></Pressable>
        </View>
        <Ledger title="Records" note="Untick a record to leave it off this document. Tap a record to open it.">
          {split.available.map((record,index)=><RecordRow key={record.key} record={asRow(record)} first={index===0} selectable selected={selected.has(record.key)} onToggle={()=>toggle(record.key)} onOpen={()=>onOpenRecord(record.snapshot)}/>)}
        </Ledger>
      </>:<EmptyState title="No records can be added" body={`Every record here is already on an issued ${info.label.toLocaleLowerCase('en-US')}. Cancel that document first if it is wrong.`}/>}

      {split.blocked.length?<Ledger title="Already on another document" note={`A record can be on only one issued ${info.label.toLocaleLowerCase('en-US')}.`}>
        {split.blocked.map(({record,reason},index)=><View key={record.key} style={[styles.blocked,index>0&&parts.rowRule]}>
          <RecordRow record={asRow(record)} first onOpen={()=>onOpenRecord(record.snapshot)}/>
          <Text style={styles.blockedReason}>{reason}</Text>
        </View>)}
      </Ledger>:null}

      {chosen.length?<View style={styles.totals}>
        <Text style={styles.totalsTitle}>This document would show</Text>
        {groups.quantityByUnit.map(unit=><View key={unit.unitKey} style={styles.totalLine}><Text style={styles.totalLabel}>Total in {unit.unitSymbol} · {unit.recordCount} record{unit.recordCount===1?'':'s'}</Text><Text style={styles.totalValue}>{formatTotalQuantity(unit.quantity,unit.unitSymbol)}</Text></View>)}
        <Text style={styles.helper}>Each unit is totalled on its own; different units are never added together.</Text>
        {groups.money.totalCents!=null?<View style={styles.totalLine}><Text style={styles.totalLabel}>Total of recorded amounts</Text><Text style={styles.totalValue}>{formatCents(groups.money.totalCents)}</Text></View>:null}
        {groups.money.unpricedCount?<Text style={styles.missingMoney}>{groups.money.pricedCount?`${groups.money.unpricedCount} of ${chosen.length} records have no recorded price. They are listed with quantities only and add nothing to the amounts.`:'No ticked record has a recorded price, so the document will show quantities only.'}</Text>:null}
      </View>:null}

      <AppButton label={chosen.length?`Save draft with ${chosen.length} record${chosen.length===1?'':'s'}`:'Tick at least one record'} onPress={()=>void save()} disabled={!chosen.length} busy={busy}
        hint="A draft can still be changed. Records count as included only once the document is issued."/>
    </>}
  </AppPage>;
}

const styles=StyleSheet.create({
  center:{alignItems:'center',gap:12,paddingVertical:24},
  helper:{color:'#4F5B66',fontSize:13,lineHeight:19},
  bulk:{flexDirection:'row',gap:8},
  bulkButton:{minHeight:48,paddingHorizontal:16,borderRadius:12,borderWidth:1,borderColor:colors.navy,backgroundColor:colors.surface,justifyContent:'center'},
  bulkText:{color:colors.navy,fontSize:14,fontWeight:'700'},
  blocked:{paddingBottom:10},
  blockedReason:{color:colors.warning,fontSize:13,fontWeight:'600',paddingHorizontal:16},
  totals:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:'#E3DBCD',padding:16,gap:8},
  totalsTitle:{color:colors.ink,fontSize:16,fontWeight:'800'},
  totalLine:{flexDirection:'row',alignItems:'baseline',gap:10},
  totalLabel:{flex:1,minWidth:0,color:'#4F5B66',fontSize:14},
  totalValue:{color:colors.ink,fontSize:17,fontWeight:'700',fontVariant:['tabular-nums']},
  missingMoney:{color:'#6E4B1F',backgroundColor:'#FFF3D8',borderRadius:10,padding:10,fontSize:13,lineHeight:19},
});
