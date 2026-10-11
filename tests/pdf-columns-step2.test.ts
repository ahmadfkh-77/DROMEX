import {describe,expect,it} from 'vitest';import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';import {buildProjectCompletionHtml} from '../src/services/projectCompletionTemplate';

import {groupDocumentLines,type BusinessDocument,type RecordSnapshot} from '../src/domain/businessDocuments';
import {buildBusinessDocumentHtml} from '../src/services/businessDocumentTemplate';

/** DEC-500 (2), (4), (5). The issued-document PDF prints the frozen snapshot, never invents a field, and never stretches a signature. */
const noWbr=(html:string)=>html.replace(/<wbr>/g,'');
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

const company={name:'DROMEX S.A.R.L.',logoUri:null,address:'Beirut',phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null};
const project={id:'p',name:'Highway Link',customerName:'Al Amal Contracting',location:'Zahle',status:'active'};
const report={workDate:'2026-10-10',workDescription:'Excavation and hauling',workers:[],drivers:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,consultingAgencyId:null,consultingAgencyNameEn:null,consultingAgencyNameAr:null,projectId:'p',id:'r',createdAt:'',updatedAt:''};
const loads=[0,1,2,3].map(i=>({id:'l'+i,transactionNumber:'20261010-GKQ4-0000'+i,loadNumber:i%2?'ASP-00017':'AGGREGATES-00002',itemName:i%2?'Deformed ribbed reinforcing bar grade 60':'Asphalt',quantity:18.5+i,unitSymbol:'t',driverName:'Mohamad mohsen',truckPlate:'M355965',finalTotalUsd:i%2?1665:null,workDate:'2026-10-10'}));
const quarry=[0,1,2].map(i=>({id:'q'+i,purchaseNumber:'SUP-20261010-GKQ4-0003'+i,confirmedAt:'2026-10-10T09:00:00',itemId:'i1',itemName:'Gravel 3/4',supplierId:'s1',supplierName:'Saad Quarry Trading Company',unitId:'u',unitSymbol:'t',quantity:22+i,deliveryLabel:i?'Supplier delivering':'Our driver · Omar Haddad',truckPlate:i?'':'B 884211',supplierTicketNumber:i?null:'T-4471',finalTotalUsd:i?null:660,categoryName:'Aggregates'}));
const fuel=[{id:'f1',confirmedAt:'2026-10-10T07:30:00',equipmentName:'CAT 320 excavator',fuelType:'diesel',litres:120.5,pricePerLitreUsd:1.1,consumptionCostUsd:132.55,odometerReading:'12345',notes:null},{id:'f2',confirmedAt:'2026-10-10T13:10:00',equipmentName:'Truck B 884211',fuelType:'diesel',litres:80,pricePerLitreUsd:null,consumptionCostUsd:null,odometerReading:null,notes:null}];
const dumps=[0,1,2,3,4,5].map(i=>({id:'d'+i,dumpedAt:`2026-10-10T0${7+i}:15:00`,materialType:i%2?'Demolition debris':'Excavation soil',dumpLocation:i%2?'Landfill, Aley':'Quarry pit A',truckPlate:'112233',driverName:'R. Haddad',notes:i===1?'Mixed with rebar and wire, second inspection at the gate':null}));

/** Step 2 of the PDF spacing fix: the Daily Report, Project Completion and invoice tables take their widths from the content too. */
const sumOf=(group:string)=>[...group.matchAll(/width:(\d+)%/g)].reduce((sum,match)=>sum+Number(match[1]),0);
const groups=(html:string)=>html.match(/<colgroup>.*?<\/colgroup>/gs)??[];
describe('the remaining PDFs',()=>{
  it('gives every table of the Daily Report widths that add up to 100, with and without prices, and a load number that can wrap',()=>{
    for(const prices of [false,true]){
      const html=buildProjectReportHtmlWithWaste(report as never,project as never,loads as never,quarry as never,dumps as never,fuel as never,company as never,null,[],prices);
      const all=groups(html);expect(all.length).toBeGreaterThanOrEqual(5);
      for(const group of all)expect(sumOf(group)).toBe(100);
      expect(html).toContain('AGGREGATES-<wbr>00002');expect(html).toContain('SUP-<wbr>20261010-<wbr>GKQ4-<wbr>00030');
    }
  });
  it('does the same for the Project Completion appendices',()=>{
    const html=buildProjectCompletionHtml({...project,status:'completed'} as never,[report] as never,loads as never,dumps.map(d=>({...d,workDate:'2026-10-10'})) as never,company as never,null,[]);
    const all=groups(html);expect(all.length).toBe(2);for(const group of all)expect(sumOf(group)).toBe(100);
    expect(html).toContain('ASP-<wbr>00017');
  });
  it('does the same for the issued document lines and records tables, official or not',()=>{
    const html=buildBusinessDocumentHtml(base,null);const all=groups(html);
    expect(all.length).toBeGreaterThanOrEqual(2);for(const group of all)expect(sumOf(group)).toBe(100);
  });
});
