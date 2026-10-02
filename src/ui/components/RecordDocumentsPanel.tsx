import {useEffect,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';

import type {BusinessDocumentRepository} from '../../data/repositories/BusinessDocumentRepository';
import {deriveInclusion,documentKindInfo,type DocumentLink,type DocumentRecordType} from '../../domain/businessDocuments';
import {colors} from '../theme';
import {InclusionPill} from './totals/TotalsParts';

/**
 * DEC-487 (3). The document status of one original record, read from the shared document links: the
 * same answer Totals and Invoices & Bills give. Lists every document the record has been on, including
 * drafts and cancelled history, each opening that document.
 */
export function RecordDocumentsPanel({documents,recordType,recordId,onOpenDocument}:{documents:BusinessDocumentRepository;recordType:DocumentRecordType;recordId:string;onOpenDocument?:(id:string)=>void}){
  const key=`${recordType}:${recordId}`;
  const[links,setLinks]=useState<DocumentLink[]|null>(null);
  useEffect(()=>{let active=true;documents.inclusionFor([key]).then(found=>{if(active)setLinks(found[key]??[]);}).catch(()=>{if(active)setLinks([]);});return()=>{active=false;};},[documents,key]);
  if(!links)return null;
  return <View style={styles.panel} accessibilityRole="summary">
    <Text style={styles.title}>Invoices & Bills</Text>
    <InclusionPill state={deriveInclusion(links)}/>
    {links.map(link=><Pressable key={link.documentId} disabled={!onOpenDocument} onPress={()=>onOpenDocument?.(link.documentId)} style={styles.row} accessibilityRole="button"
      accessibilityLabel={`${link.documentNumber??link.draftNumber}, ${documentKindInfo[link.kind].label}, ${link.status}. Open document.`}>
      <View style={styles.flex}><Text style={styles.number}>{link.documentNumber??link.draftNumber}</Text><Text style={styles.meta}>{documentKindInfo[link.kind].mode==='internal'?`Internal ${documentKindInfo[link.kind].label.toLocaleLowerCase('en-US')}`:documentKindInfo[link.kind].label} · {link.status}</Text></View>
      {onOpenDocument?<Text style={styles.chevron}>›</Text>:null}
    </Pressable>)}
    {!links.length?<Text style={styles.meta}>Not on any statement, invoice or bill.</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  panel:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:'#E3DBCD',padding:14,gap:8},
  title:{color:colors.ink,fontSize:15,fontWeight:'800'},
  row:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,paddingTop:6},
  number:{color:colors.ink,fontSize:14,fontWeight:'700',fontVariant:['tabular-nums']},
  meta:{color:'#4F5B66',fontSize:12,lineHeight:17},
  chevron:{color:colors.navy,fontSize:22,fontWeight:'600'},
});
