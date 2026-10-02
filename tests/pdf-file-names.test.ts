import {describe,expect,it} from 'vitest';

import {groupDocumentLines,type BusinessDocument,type RecordSnapshot} from '../src/domain/businessDocuments';
import {companyLoadTotalsFileName,documentFileName,safeFileNamePart} from '../src/domain/recordFormat';

/** DEC-487. PDF file names say what the document is, for whom, which project and which month. */
const snap=(projectName:string|null,recordedAt='2026-08-10T09:00:00'):RecordSnapshot=>({recordType:'company_load',recordId:Math.random().toString(36),reference:'TX',loadNumber:null,loadNumberSeriesName:null,itemKey:'i',itemName:'Asphalt',unitKey:'u',unitSymbol:'t',quantity:1,projectId:projectName?`id-${projectName}`:null,projectName,partyId:'c',partyName:'Road Co',recordedAt,enteredAt:null,unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null});
const doc=(overrides:Partial<BusinessDocument>,records:RecordSnapshot[]=[snap('Mountain Road')]):BusinessDocument=>({id:'d',kind:'customer_invoice',status:'Issued',draftNumber:'DRAFT-3',documentNumber:'INV-2026-014',partyType:'customer',partyId:'c',partyName:'Road Co',periodFrom:'2026-08-01',periodTo:'2026-08-31',selectionMethod:'date_range',issueDate:'2026-09-01',dueDate:null,reference:null,notes:null,issuer:null,recipient:null,terms:null,signer:null,signerSelection:null,logoUri:null,
  records:records.map((snapshot,position)=>({key:`company_load:${snapshot.recordId}`,snapshot,position})),groups:groupDocumentLines(records),problems:[],history:[],payment:null,issuedAt:null,cancelledAt:null,cancellationReason:null,createdAt:'',updatedAt:'',...overrides});

describe('document PDF file names',()=>{
  it('names the number, customer, single project and month',()=>{
    expect(documentFileName(doc({}))).toBe('INV-2026-014 - Road Co - Mountain Road - Aug 2026.pdf');
  });
  it('counts projects when there are several, and leaves the project out when there is none',()=>{
    expect(documentFileName(doc({},[snap('Mountain Road'),snap('Coastal Road'),snap('Mountain Road'),snap(null)]))).toBe('INV-2026-014 - Road Co - 2 projects - Aug 2026.pdf');
    expect(documentFileName(doc({},[snap(null)]))).toBe('INV-2026-014 - Road Co - Aug 2026.pdf');
  });
  it('spans months and years, and falls back to the records’ own dates without a period',()=>{
    expect(documentFileName(doc({periodFrom:'2026-07-15',periodTo:'2026-08-31'}))).toBe('INV-2026-014 - Road Co - Mountain Road - Jul-Aug 2026.pdf');
    expect(documentFileName(doc({periodFrom:'2025-12-01',periodTo:'2026-01-31'}))).toBe('INV-2026-014 - Road Co - Mountain Road - Dec 2025-Jan 2026.pdf');
    expect(documentFileName(doc({periodFrom:null,periodTo:null},[snap('Mountain Road','2026-06-03T09:00:00'),snap('Mountain Road','2026-06-28T09:00:00')]))).toBe('INV-2026-014 - Road Co - Mountain Road - Jun 2026.pdf');
  });
  it('marks a draft by its draft number and a cancelled document in words',()=>{
    expect(documentFileName(doc({status:'Draft',documentNumber:null}))).toBe('DRAFT-3 - Road Co - Mountain Road - Aug 2026.pdf');
    expect(documentFileName(doc({status:'Cancelled'}))).toBe('INV-2026-014 - Road Co - Mountain Road - Aug 2026 - CANCELLED.pdf');
  });
  it('keeps Arabic names and removes characters phones and Windows reject',()=>{
    expect(documentFileName(doc({partyName:'شركة الطرق'}))).toBe('INV-2026-014 - شركة الطرق - Mountain Road - Aug 2026.pdf');
    expect(documentFileName(doc({partyName:'Road / Co: "North" <Ltd>?'},[snap('Site *1*|A')]))).toBe('INV-2026-014 - Road Co North Ltd - Site 1 A - Aug 2026.pdf');
  });
  it('shortens very long names so the file name stays usable',()=>{
    const name=documentFileName(doc({partyName:'National Roads and Bridges General Contracting Company SAL Lebanon Branch Office'},[snap('Mountain Road main carriageway rehabilitation phase two from km 12 to km 19')]));
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.startsWith('INV-2026-014 - National Roads')).toBe(true);
    expect(name.endsWith(' - Aug 2026.pdf')).toBe(true);
  });
});

describe('Company Load Totals file names',()=>{
  it('names the project and period when filtered, and says All dates otherwise',()=>{
    expect(companyLoadTotalsFileName({projectName:'Mountain Road',fromDate:'2026-08-01',toDate:'2026-08-31'})).toBe('Company Load Totals - Mountain Road - Aug 2026.pdf');
    expect(companyLoadTotalsFileName({projectName:null,fromDate:'',toDate:''})).toBe('Company Load Totals - All dates.pdf');
    expect(companyLoadTotalsFileName({projectName:null,fromDate:'2026-08-01',toDate:''})).toBe('Company Load Totals - From Aug 2026.pdf');
  });
});

describe('file name parts',()=>{
  it('trims, collapses spaces and never returns an empty part for a real name',()=>{
    expect(safeFileNamePart('  Road   Co  ')).toBe('Road Co');
    expect(safeFileNamePart('???')).toBe('');
  });
});

describe('export wiring',()=>{
  it('uses these names for both exports and stores names with spaces or Arabic safely',async()=>{
    const {readFileSync}=await import('node:fs');
    const source=readFileSync('src/services/documentExport.ts','utf8');
    expect(source).toContain('buildBusinessDocumentHtml(doc,logo),documentFileName(doc)');
    expect(source).toContain('companyLoadTotalsFileName(input.fileName)');
    expect(source).toContain('${encodeURIComponent(filename)}');
  });
});
