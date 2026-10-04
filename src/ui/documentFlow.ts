import type {DocumentKind,DocumentSide,EligibleRecord,SelectionMethod} from '../domain/businessDocuments';

/**
 * DEC-500 (3). What the Review screen needs to start one document: one party, one kind, the candidate
 * records, which of them start ticked, and how they were chosen. Created by the start sheet from any
 * totals level, or by Invoices & Bills for one customer or supplier.
 */
export type DocumentStart={
  side:DocumentSide;partyId:string;partyName:string;kind:DocumentKind;
  recordKeys:string[];preselect:'all'|'none';
  selectionMethod:SelectionMethod;periodFrom:string|null;periodTo:string|null;
  /** Where the selection came from, e.g. "Sand › Mountain Road". */
  context:string;
};

export type CandidateParty={side:DocumentSide;partyId:string;partyName:string;keys:string[]};

/** Records grouped by the party a document would be addressed to; the largest group first. */
export function candidateParties(records:readonly EligibleRecord[]):CandidateParty[]{
  const parties=new Map<string,CandidateParty>();
  for(const record of records){
    const side:DocumentSide=record.snapshot.recordType==='company_load'?'customer':'supplier';
    const id=`${side}:${record.snapshot.partyId}`;
    const party=parties.get(id)??{side,partyId:record.snapshot.partyId,partyName:record.snapshot.partyName,keys:[]};
    party.keys.push(record.key);parties.set(id,party);
  }
  return [...parties.values()].sort((a,b)=>b.keys.length-a.keys.length||a.partyName.localeCompare(b.partyName));
}

/** Splits candidates into those that can go on a document of this kind and those already in an Issued one. */
export function reviewSplit(records:readonly EligibleRecord[],kind:DocumentKind):{available:EligibleRecord[];blocked:{record:EligibleRecord;reason:string}[]}{
  const available:EligibleRecord[]=[];const blocked:{record:EligibleRecord;reason:string}[]=[];
  for(const record of records){
    const issued=record.links.find(link=>link.kind===kind&&link.status==='Issued');
    if(issued)blocked.push({record,reason:`Already included in ${issued.documentNumber}`});
    else available.push(record);
  }
  return {available,blocked};
}
