import {describe,expect,it} from 'vitest';

import type {EligibleRecord,RecordSnapshot} from '../src/domain/businessDocuments';
import {candidateParties,reviewSplit} from '../src/ui/documentFlow';

/** DEC-487 (3). Turning a selection into one document for one party, without silently dropping anything. */
const snap=(id:string,type:'company_load'|'supplier_load',partyId:string,partyName:string):RecordSnapshot=>({recordType:type,recordId:id,reference:id,loadNumber:null,loadNumberSeriesName:null,itemKey:'i',itemName:'Sand',unitKey:'u',unitSymbol:'t',quantity:1,projectId:null,projectName:null,partyId,partyName,recordedAt:'2026-08-10T09:00:00',enteredAt:null,unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null});
const record=(id:string,type:'company_load'|'supplier_load',partyId:string,partyName:string,links:EligibleRecord['links']=[]):EligibleRecord=>({key:`${type}:${id}`,snapshot:snap(id,type,partyId,partyName),seriesId:null,inclusion:{state:'not_included'},links});

describe('candidate parties',()=>{
  it('groups a selection by customer and supplier, largest first, so the Owner picks one party per document',()=>{
    const parties=candidateParties([record('a','supplier_load','s1','Alpha'),record('b','supplier_load','s1','Alpha'),record('c','company_load','c1','Road Co'),record('d','supplier_load','s2','Beta')]);
    expect(parties.map(party=>[party.side,party.partyName,party.keys.length])).toEqual([['supplier','Alpha',2],['supplier','Beta',1],['customer','Road Co',1]]);
  });
});

describe('review split',()=>{
  it('separates records already in an Issued document of the chosen kind, naming the document',()=>{
    const issued={documentId:'d',kind:'supplier_bill' as const,status:'Issued' as const,draftNumber:'DRAFT-1',documentNumber:'BILL-2026-001',issueDate:'2026-09-01'};
    const split=reviewSplit([record('a','supplier_load','s1','Alpha',[issued]),record('b','supplier_load','s1','Alpha'),record('c','supplier_load','s1','Alpha',[{...issued,kind:'supplier_statement',documentNumber:'SST-2026-001'}])],'supplier_bill');
    expect(split.available.map(value=>value.key)).toEqual(['supplier_load:b','supplier_load:c']);
    expect(split.blocked).toEqual([{record:expect.objectContaining({key:'supplier_load:a'}),reason:'Already included in BILL-2026-001'}]);
  });
});
