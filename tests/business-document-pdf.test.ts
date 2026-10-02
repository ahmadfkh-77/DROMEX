import {describe,expect,it} from 'vitest';

import {groupDocumentLines,type BusinessDocument,type RecordSnapshot} from '../src/domain/businessDocuments';
import {buildBusinessDocumentHtml} from '../src/services/businessDocumentTemplate';

/** DEC-487 (2), (4), (5). The issued-document PDF prints the frozen snapshot, never invents a field, and never stretches a signature. */
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';
const snap=(overrides:Partial<RecordSnapshot>):RecordSnapshot=>({recordType:'company_load',recordId:'l1',reference:'20260810-AB12-00007',loadNumber:'ASP-2026-004',loadNumberSeriesName:'Asphalt',itemKey:'id:a',itemName:'Asphalt',unitKey:'unit_ton',unitSymbol:'t',quantity:10,projectId:'p',projectName:'Mountain Road',partyId:'c',partyName:'Road Co',recordedAt:'2026-08-10T09:05:00',enteredAt:null,unitPriceCents:1500,priceBasis:'per_unit',subtotalCents:15000,vatRateBasisPoints:1100,vatCents:1650,totalCents:16650,supplierReference:null,...overrides});
const records=[snap({}),snap({recordId:'l2',reference:'TX-2',loadNumber:null,unitKey:'unit_m3',unitSymbol:'m³',quantity:4,unitPriceCents:null,subtotalCents:null,vatCents:null,totalCents:null,vatRateBasisPoints:null,itemName:'رمل <Sand>'})];
const base:BusinessDocument={id:'d',kind:'customer_invoice',status:'Issued',draftNumber:'DRAFT-3',documentNumber:'INV-2026-014',partyType:'customer',partyId:'c',partyName:'Road Co',periodFrom:'2026-08-01',periodTo:'2026-08-31',selectionMethod:'date_range',
  issueDate:'2026-09-01',dueDate:'2026-10-01',reference:'PO-77',notes:'Thank you',
  issuer:{name:'DROMEX Plant SAL',tradingName:null,contactPerson:null,address:'Aley',phone:'01 234',email:null,website:null,taxRegistrationNumber:'VAT-77',companyRegistrationNumber:null},
  recipient:{name:'شركة الطرق',tradingName:null,contactPerson:'Maya',address:'Beirut',phone:null,email:null,website:null,taxRegistrationNumber:null,companyRegistrationNumber:null},
  terms:{currency:'USD',paymentTerms:'Net 30',bankDetails:'IBAN LB00 0000',footerNote:null},
  signer:{signerId:'s',name:'Rana Haddad',jobTitle:'Finance Manager',department:null,display:'name_with_signature',signature:[STROKE]},signerSelection:null,logoUri:null,
  records:records.map((snapshot,position)=>({key:`company_load:${snapshot.recordId}`,snapshot,position})),groups:groupDocumentLines(records),problems:[],history:[],payment:null,
  issuedAt:'2026-09-01T10:00:00Z',cancelledAt:null,cancellationReason:null,createdAt:'',updatedAt:''};

describe('business document PDF',()=>{
  const html=buildBusinessDocumentHtml(base,null);
  it('titles the document by kind and prints its number, dates, reference and parties',()=>{
    expect(html).toContain('>Invoice<');
    for(const text of ['INV-2026-014','1 Sep 2026','1 Oct 2026','1 Aug 2026 – 31 Aug 2026','PO-77','DROMEX Plant SAL','VAT-77','Maya','Net 30','IBAN LB00 0000'])expect(html).toContain(text);
  });
  it('puts the company logo and name on the left and the document title panel on the right',()=>{
    const withLogo=buildBusinessDocumentHtml(base,'data:image/png;base64,AAAA');
    expect(withLogo).toContain('<img class="logo" src="data:image/png;base64,AAAA"');
    const brand=withLogo.indexOf('class="brand"'),panel=withLogo.indexOf('class="title-panel"');
    expect(brand).toBeGreaterThan(-1);expect(panel).toBeGreaterThan(brand);
    expect(withLogo).toMatch(/.title-panel{[^}]*margin-left:auto[^}]*text-align:right/);
    expect(html).not.toContain('<img');
  });
  it('agrees the unpriced note with its count',()=>{
    expect(html).toContain('It is listed with quantities only and adds nothing to the amounts.');
  });

  it('omits empty fields instead of printing Not configured or blanks',()=>{
    expect(html).not.toContain('Not configured');
    expect(html).not.toMatch(/Email:\s*</);
  });
  it('escapes record text and marks direction for Arabic and mixed names',()=>{
    expect(html).toContain('رمل &lt;Sand&gt;');
    expect(html).not.toContain('<Sand>');
    expect(html).toContain('dir="auto"');
  });
  it('repeats table headings on later pages and keeps totals with their rows',()=>{
    expect(html).toMatch(/<thead>[\s\S]*Item[\s\S]*<\/thead>/);
    expect(html).toContain('display:table-header-group');
    expect(html).toContain('break-inside:avoid');
  });
  it('keeps each unit separate and never prints a price that was not recorded',()=>{
    expect(html).toContain('10 t');
    expect(html).toContain('4 m³');
    expect(html).not.toMatch(/14 (t|m³)/);
    expect(html).toContain('No price recorded');
    expect(html).not.toContain('$0.00');
    expect(html).toContain('1 of 2 records has no recorded price');
    expect(html).toContain('$166.50');
  });
  it('lists every record with its load number or the legacy wording',()=>{
    expect(html).toContain('ASP-2026-004');
    expect(html).toContain('Legacy load — no generated load number');
    expect(html).toContain('20260810-AB12-00007');
  });
  it('prints the signer snapshot without stretching the signature',()=>{
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('Rana Haddad');
    expect(html).toContain('Finance Manager');
    const nameOnly=buildBusinessDocumentHtml({...base,signer:{...base.signer!,display:'name_only',signature:[]}},null);
    expect(nameOnly).not.toContain('<svg');
    expect(nameOnly).toContain('Signed by name');
  });
  it('marks a draft and a cancelled document unmistakably',()=>{
    expect(buildBusinessDocumentHtml({...base,status:'Draft',documentNumber:null},null)).toContain('DRAFT — NOT ISSUED');
    const cancelled=buildBusinessDocumentHtml({...base,status:'Cancelled',cancellationReason:'Wrong PO',cancelledAt:'2026-09-03T08:00:00Z'},null);
    expect(cancelled).toContain('CANCELLED');
    expect(cancelled).toContain('Wrong PO');
  });
  it('labels an internal statement as not a tax invoice and makes no compliance claim anywhere',()=>{
    const statement=buildBusinessDocumentHtml({...base,kind:'customer_statement',documentNumber:'CST-2026-001'},null);
    expect(statement).toContain('Customer statement');
    expect(statement).toContain('Internal statement — not a tax invoice');
    expect(html).not.toMatch(/complian|certified|approved by/i);
  });
  it('labels supplier documents from the supplier’s side',()=>{
    const bill=buildBusinessDocumentHtml({...base,kind:'supplier_bill',partyType:'supplier',documentNumber:'BILL-2026-001'},null);
    expect(bill).toContain('>Bill<');
    expect(bill).toContain('Supplier');
    expect(bill).toContain('Billed to');
  });
});
