import {useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';

import type {BusinessDocumentRepository} from '../../../data/repositories/BusinessDocumentRepository';
import {documentKindInfo,kindsForSide,type DocumentKind,type DocumentSide,type EligibleRecord,type EligibleRecordQuery,type SelectionMethod} from '../../../domain/businessDocuments';
import {LEGACY_SERIES_KEY,type CompanyTotalsFilters} from '../../../domain/companyTotals';
import {queriesFor} from '../../../domain/documentStartQuery';
export {queriesFor};
import {candidateParties,type CandidateParty,type DocumentStart} from '../../documentFlow';
import {colors} from '../../theme';
import {formatDay} from '../../totalsPresentation';
import {Feedback} from '../AppPrimitives';
import {FocusedSheet,SheetActions} from '../FocusedSheet';
import {SegmentedChoice} from '../SegmentedChoice';

export type StartQuery={context:string;filters:CompanyTotalsFilters;presetKeys?:string[]};
type Method='filtered'|'date_range'|'manual';

/** Plain-language kind choices: an Internal statement or an Official Bill / Invoice. */
const kindCopy:Record<DocumentKind,string>={
  customer_statement:'Internal summary of these loads for the customer. Legal and tax details may be left out.',
  customer_invoice:'Formal invoice using Business Document Settings. You confirm every detail before issuing.',
  supplier_statement:'Internal summary of what this supplier delivered. Legal and tax details may be left out.',
  supplier_bill:'Formal record of the supplier’s bill, with its number and billing details.',
};

/**
 * DEC-500 (3). Starts a document from a totals node or a manual selection: which records, addressed to
 * which one customer or supplier, as which kind. The records themselves are reviewed on the next screen,
 * where anything can still be removed before the draft is saved.
 */
export function DocumentStartSheet({visible,documents,query,onClose,onStart}:{visible:boolean;documents:BusinessDocumentRepository;query:StartQuery|null;onClose:()=>void;onStart:(start:DocumentStart)=>void}){
  const[records,setRecords]=useState<EligibleRecord[]|null>(null);
  const[error,setError]=useState<string|null>(null);
  const[method,setMethod]=useState<Method>('filtered');
  const[partyId,setPartyId]=useState<string>('');
  const[kind,setKind]=useState<DocumentKind|null>(null);
  useEffect(()=>{
    if(!visible||!query)return;
    let active=true;setRecords(null);setError(null);setMethod(query.presetKeys?'manual':'filtered');setPartyId('');setKind(null);
    Promise.all(queriesFor(query.filters,query.presetKeys).map(value=>documents.listEligibleRecords(value)))
      .then(found=>{if(!active)return;const legacyOnly=query.filters.seriesId===LEGACY_SERIES_KEY;setRecords(found.flat().filter(record=>!legacyOnly||!record.snapshot.loadNumber));})
      .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Records could not be loaded.');});
    return()=>{active=false;};
  },[visible,query,documents]);

  const parties=useMemo(()=>records?candidateParties(records):[],[records]);
  const party:CandidateParty|undefined=parties.find(value=>`${value.side}:${value.partyId}`===partyId)??(parties.length===1?parties[0]:undefined);
  const dates=query?{from:query.filters.fromDate,to:query.filters.toDate}:{from:'',to:''};
  const rangeReady=Boolean(dates.from&&dates.to);
  const preset=Boolean(query?.presetKeys);
  const excluded=party&&records?records.length-party.keys.length:0;

  const start=()=>{
    if(!party||!kind||!query)return;
    const selectionMethod:SelectionMethod=method==='date_range'?'date_range':method==='manual'?'manual':'filtered';
    onStart({side:party.side,partyId:party.partyId,partyName:party.partyName,kind,recordKeys:party.keys,preselect:method==='manual'&&!preset?'none':'all',selectionMethod,
      periodFrom:method==='date_range'||(method==='filtered'&&dates.from)?dates.from||null:null,periodTo:method==='date_range'||(method==='filtered'&&dates.to)?dates.to||null:null,context:query.context});
  };

  return <FocusedSheet visible={visible} eyebrow="CREATE A DOCUMENT" title={query?.context??''} onClose={onClose}
    footer={<SheetActions primaryLabel="Review records" onPrimary={start} onCancel={onClose} disabled={!party||!kind||(method==='date_range'&&!rangeReady)}/>}>
    {error?<Feedback kind="error">{error}</Feedback>:!records?<View style={styles.center}><ActivityIndicator color={colors.brand}/><Text style={styles.helper}>Finding records…</Text></View>
      :!records.length?<Feedback kind="warning">No records here can go on a document. Only Active company loads and Supplier Loads can be included, and use records never are.</Feedback>
      :<>
        {!preset?<View style={styles.step}>
          <Text style={styles.stepTitle}>Which records</Text>
          <SegmentedChoice options={[{id:'filtered',label:'Current results',count:records.length},{id:'date_range',label:'Date range'},{id:'manual',label:'Choose one by one'}]} selectedId={method} onSelect={value=>setMethod(value as Method)}/>
          <Text style={styles.helper}>{method==='filtered'?'Every record behind the totals you are looking at, with the filters as they are now.'
            :method==='date_range'?(rangeReady?`Records from ${formatDay(dates.from)} to ${formatDay(dates.to)} — the Covering dates in Filters. Nothing outside them is included.`:'Set From and To under Filters first; this choice uses those dates.')
            :'You tick each record on the next screen. Nothing starts selected.'}</Text>
        </View>:<Text style={styles.helper}>{query?.presetKeys?.length} selected record{query?.presetKeys?.length===1?'':'s'}.</Text>}

        <View style={styles.step}>
          <Text style={styles.stepTitle}>Addressed to</Text>
          <Text style={styles.helper}>A document is for one customer or one supplier.</Text>
          <View style={styles.choices}>
            {parties.map(value=>{const id=`${value.side}:${value.partyId}`;const on=party===value;
              return <Pressable key={id} onPress={()=>{setPartyId(id);setKind(null);}} style={[styles.choice,on&&styles.choiceOn]} accessibilityRole="radio" accessibilityState={{checked:on}}
                accessibilityLabel={`${value.partyName}, ${value.side}, ${value.keys.length} records`}>
                <View style={[styles.radio,on&&styles.radioOn]}>{on?<View style={styles.radioDot}/>:null}</View>
                <View style={styles.flex}><Text style={styles.choiceTitle}>{value.partyName}</Text><Text style={styles.choiceMeta}>{value.side==='customer'?'Customer · company loads':'Supplier · Supplier Loads'} · {value.keys.length} record{value.keys.length===1?'':'s'}</Text></View>
              </Pressable>;})}
          </View>
          {excluded?<Text style={styles.notice}>{excluded} record{excluded===1?' belongs':'s belong'} to other {parties.length>2?'parties':'party'} and will not be on this document.</Text>:null}
        </View>

        {party?<View style={styles.step}>
          <Text style={styles.stepTitle}>Document type</Text>
          <View style={styles.choices}>
            {kindsForSide(party.side as DocumentSide).map(value=>{const on=kind===value;const info=documentKindInfo[value];
              return <Pressable key={value} onPress={()=>setKind(value)} style={[styles.choice,on&&styles.choiceOn]} accessibilityRole="radio" accessibilityState={{checked:on}} accessibilityLabel={`${info.label}. ${kindCopy[value]}`}>
                <View style={[styles.radio,on&&styles.radioOn]}>{on?<View style={styles.radioDot}/>:null}</View>
                <View style={styles.flex}><Text style={styles.choiceTitle}>{info.mode==='internal'?`Internal ${info.label.toLocaleLowerCase('en-US')}`:`Official ${info.label}`}</Text><Text style={styles.choiceMeta}>{kindCopy[value]}</Text></View>
              </Pressable>;})}
          </View>
          <Text style={styles.helper}>DROMEX does not check legal, tax or accounting requirements. You remain responsible for them.</Text>
        </View>:null}
      </>}
  </FocusedSheet>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  center:{alignItems:'center',gap:12,paddingVertical:24},
  helper:{color:'#4F5B66',fontSize:13,lineHeight:19},
  notice:{color:'#4F5B66',fontSize:13,lineHeight:19,backgroundColor:'#FFF3D8',borderRadius:10,padding:10},
  step:{gap:8,marginBottom:18},
  stepTitle:{color:colors.ink,fontSize:16,fontWeight:'800'},
  choices:{gap:8},
  choice:{minHeight:60,flexDirection:'row',alignItems:'center',gap:12,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface,borderRadius:12,paddingHorizontal:14,paddingVertical:10},
  choiceOn:{borderColor:colors.navy,borderWidth:2,backgroundColor:'#F4F7FB'},
  radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:colors.muted,alignItems:'center',justifyContent:'center'},
  radioOn:{borderColor:colors.navy},
  radioDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.navy},
  choiceTitle:{color:colors.ink,fontSize:15,fontWeight:'700'},
  choiceMeta:{color:'#4F5B66',fontSize:12,lineHeight:17,marginTop:2},
});
