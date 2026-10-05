import {describe,expect,it} from 'vitest';

import {
  deriveInclusion,documentKindInfo,formatDocumentNumber,groupDocumentLines,inclusionLabel,summarizeInclusion,validateDocumentNumber,validateDocumentPrefix,
  type DocumentLink,type RecordSnapshot,
} from '../src/domain/businessDocuments';

/** DEC-500 (2)-(4). Document kinds, derived inclusion status, and unit-separated document lines. */
const link=(overrides:Partial<DocumentLink>):DocumentLink=>({documentId:'d',kind:'customer_invoice',status:'Draft',draftNumber:'DRAFT-1',documentNumber:null,issueDate:null,...overrides});
const snap=(overrides:Partial<RecordSnapshot>):RecordSnapshot=>({recordType:'company_load',recordId:'l1',reference:'TX-1',loadNumber:'LOAD-2026-001',loadNumberSeriesName:'Company loads',itemKey:'id:sand',itemName:'Sand',unitKey:'unit_ton',unitSymbol:'t',quantity:10,projectId:'road',projectName:'Mountain Road',partyId:'customer',partyName:'Road Co',recordedAt:'2026-08-10T09:00:00',enteredAt:'2026-08-10T09:00:05',unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null,...overrides});

describe('document kinds',()=>{
  it('separates customer and supplier sides and internal and official modes in plain words',()=>{
    expect(documentKindInfo.customer_statement).toMatchObject({side:'customer',mode:'internal',recordType:'company_load',label:'Customer statement'});
    expect(documentKindInfo.customer_invoice).toMatchObject({side:'customer',mode:'official',recordType:'company_load',label:'Invoice'});
    expect(documentKindInfo.supplier_statement).toMatchObject({side:'supplier',mode:'internal',recordType:'supplier_load',label:'Supplier statement'});
    expect(documentKindInfo.supplier_bill).toMatchObject({side:'supplier',mode:'official',recordType:'supplier_load',label:'Bill'});
  });
});

describe('inclusion status derived from links',()=>{
  it('reads Not included yet with no links, and ignores discarded drafts',()=>{
    expect(deriveInclusion([])).toEqual({state:'not_included'});
    expect(deriveInclusion([link({status:'Cancelled'})])).toEqual({state:'not_included'});
    expect(inclusionLabel({state:'not_included'})).toBe('Not included yet');
  });

  it('reads In draft, naming every draft',()=>{
    const state=deriveInclusion([link({draftNumber:'DRAFT-3'}),link({documentId:'e',draftNumber:'DRAFT-5'})]);
    expect(state).toMatchObject({state:'in_draft'});
    expect(inclusionLabel(state)).toBe('In draft DRAFT-3, DRAFT-5');
  });

  it('reads Included in the issued document, which outranks drafts and cancelled history',()=>{
    const state=deriveInclusion([link({draftNumber:'DRAFT-3'}),link({documentId:'x',status:'Issued',documentNumber:'INV-2026-014',issueDate:'2026-09-01'}),link({documentId:'y',status:'Cancelled',documentNumber:'INV-2026-002'})]);
    expect(inclusionLabel(state)).toBe('Included in INV-2026-014');
  });

  it('reads Previously included in a cancelled issued document',()=>{
    const state=deriveInclusion([link({status:'Cancelled',documentNumber:'INV-2026-002'})]);
    expect(inclusionLabel(state)).toBe('Previously included in cancelled INV-2026-002');
  });

  it('can be narrowed to one document kind',()=>{
    const links=[link({kind:'customer_statement',status:'Issued',documentNumber:'CST-2026-001'})];
    expect(inclusionLabel(deriveInclusion(links))).toBe('Included in CST-2026-001');
    expect(deriveInclusion(links,'customer_invoice')).toEqual({state:'not_included'});
  });
});

describe('aggregate inclusion summaries',()=>{
  const included=deriveInclusion([link({status:'Issued',documentNumber:'INV-2026-014'})]);
  const other=deriveInclusion([link({documentId:'z',status:'Issued',documentNumber:'INV-2026-015'})]);
  const draft=deriveInclusion([link({})]);
  const none=deriveInclusion([]);
  it('counts included, in draft and not included',()=>{
    expect(summarizeInclusion([included,other,included,included,included,none,none])).toBe('7 records · 5 included · 2 not included');
    expect(summarizeInclusion([draft,none,none,none])).toBe('4 records · 1 in draft · 3 not included');
  });
  it('names the one document when every record is in it',()=>{
    expect(summarizeInclusion([included,included,included])).toBe('3 records · all included in INV-2026-014');
    expect(summarizeInclusion([none])).toBe('1 record · not included');
  });
  it('counts a record in a cancelled document as not included',()=>{
    expect(summarizeInclusion([deriveInclusion([link({status:'Cancelled',documentNumber:'INV-2026-002'})]),none])).toBe('2 records · 2 not included');
  });
});

describe('document lines',()=>{
  it('groups by project then item and unit, never adding across units',()=>{
    const groups=groupDocumentLines([
      snap({recordId:'a',quantity:10}),snap({recordId:'b',quantity:5.5}),snap({recordId:'c',unitKey:'unit_m3',unitSymbol:'m³',quantity:4}),
      snap({recordId:'d',projectId:null,projectName:null,quantity:2}),
    ]);
    expect(groups.projects.map(value=>[value.projectName,value.lines.map(line=>[line.itemName,line.unitSymbol,line.quantity,line.recordCount])])).toEqual([
      ['Mountain Road',[['Sand','m³',4,1],['Sand','t',15.5,2]]],
      ['No project',[['Sand','t',2,1]]],
    ]);
    expect(groups.quantityByUnit).toEqual([{unitKey:'unit_m3',unitSymbol:'m³',quantity:4,recordCount:1},{unitKey:'unit_ton',unitSymbol:'t',quantity:17.5,recordCount:3}]);
  });

  it('keeps one unit price per line and totals money only from priced records',()=>{
    const groups=groupDocumentLines([
      snap({recordId:'a',quantity:10,unitPriceCents:1500,subtotalCents:15000,vatRateBasisPoints:1100,vatCents:1650,totalCents:16650}),
      snap({recordId:'b',quantity:5,unitPriceCents:1500,subtotalCents:7500,vatRateBasisPoints:1100,vatCents:825,totalCents:8325}),
      snap({recordId:'c',quantity:3,unitPriceCents:1800,subtotalCents:5400,vatRateBasisPoints:1100,vatCents:594,totalCents:5994}),
      snap({recordId:'d',quantity:2}),
    ]);
    expect(groups.projects[0]!.lines.map(line=>[line.unitPriceCents,line.quantity,line.subtotalCents,line.unpricedCount])).toEqual([[1500,15,22500,0],[1800,3,5400,0],[null,2,null,1]]);
    expect(groups.money).toEqual({subtotalCents:27900,vatCents:3069,totalCents:30969,pricedCount:3,unpricedCount:1});
  });

  it('reports no money at all when nothing is priced, rather than zero',()=>{
    expect(groupDocumentLines([snap({})]).money).toEqual({subtotalCents:null,vatCents:null,totalCents:null,pricedCount:0,unpricedCount:1});
  });

  it('keeps a whole-price supplier load as its own line',()=>{
    const groups=groupDocumentLines([snap({recordType:'supplier_load',recordId:'q',priceBasis:'whole',unitPriceCents:50000,subtotalCents:50000,vatCents:0,totalCents:50000,vatRateBasisPoints:0}),snap({recordType:'supplier_load',recordId:'r',priceBasis:'whole',unitPriceCents:50000,subtotalCents:50000,vatCents:0,totalCents:50000,vatRateBasisPoints:0})]);
    expect(groups.projects[0]!.lines.map(line=>[line.priceBasis,line.recordCount])).toEqual([['whole',1],['whole',1]]);
  });
});

describe('document numbers',()=>{
  it('formats and validates numbers and prefixes',()=>{
    expect(formatDocumentNumber('INV',2026,14)).toBe('INV-2026-014');
    expect(validateDocumentNumber(' INV/2026-14 ')).toEqual([]);
    expect(validateDocumentNumber('')).toEqual(['Enter a document number.']);
    expect(validateDocumentNumber('INV 14<')).toEqual(['Use letters, digits, and - / . _ only (40 characters at most).']);
    expect(validateDocumentPrefix('INV')).toEqual([]);
    expect(validateDocumentPrefix('IN1')).toEqual(['A prefix must be 2 to 6 letters A–Z.']);
  });
});
