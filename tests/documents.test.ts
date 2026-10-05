import { describe, expect, it } from 'vitest';
import type { ConfirmedLoad } from '../src/domain/loads';
import { buildLoadDocumentHtml } from '../src/services/documentTemplates';
import {buildQuickTextHtml} from '../src/services/documentTemplates';
import {emptyQuickTextDraft} from '../src/domain/quickText';

const load = {
  transactionNumber:'20260811-ABCD-00001',confirmedAt:'2026-08-11T12:00:00.000Z',companyName:'DROMEX',companyAddress:null,companyPhone:null,companyEmail:null,companyTaxVatNumber:null,companyReceiptFooter:null,companyLogoUri:null,customerName:'Customer',projectName:'Road',projectLocation:'Beirut',destinationAddress:null,itemName:'Asphalt',driverName:'Ali',truckPlate:'123456',requestedQuantityKg:null,emptyWeightKg:10000,fullWeightKg:30555,netWeightKg:20555,billedQuantity:20.555,outputUnitSymbol:'t',unitPriceUsd:90,subtotalUsd:1849.95,vatRatePercent:11,vatAmountUsd:203.49,finalTotalUsd:2053.44,signaturePaths:['M 10 10 L 100 80'],
} as unknown as ConfirmedLoad;

describe('load PDF documents',()=>{
  it('uses converted value under the Quantity label on a receipt and omits raw weights',()=>{
    const html=buildLoadDocumentHtml(load,'receipt','58');
    expect(html).toContain('Quantity:'); expect(html).toContain('20.555 t'); expect(html).not.toContain('Net weight:'); expect(html).not.toContain('Driver signature:');
  });
  it('keeps operational weights and signature on the delivery authorization',()=>{
    const html=buildLoadDocumentHtml(load,'authorization','80');
    expect(html).toContain('Net weight:'); expect(html).toContain('20555 kg'); expect(html).toContain('<svg'); expect(html).toContain('Driver signature: Ali'); expect(html).not.toContain('Final total:');
  });
  it('prints direct pipe quantity and omits every scale field',()=>{
    const html=buildLoadDocumentHtml({...load,quantityMethod:'direct',itemName:'PVC Pipe',billedQuantity:50,outputUnitSymbol:'pc',emptyWeightKg:null,fullWeightKg:null,netWeightKg:null},'authorization','58');
    expect(html).toContain('50.000 pc');
    expect(html).not.toContain('Empty weight:');
    expect(html).not.toContain('Full weight:');
    expect(html).not.toContain('Net weight:');
    expect(html).not.toContain('Converted quantity:');
  });
  it('shows no cancelled banner for an active load',()=>{
    const html=buildLoadDocumentHtml({...load,status:'Active',cancellationReason:null,cancelledAt:null},'receipt','58');
    expect(html).not.toContain('CANCELLED');
  });
  it('shows a cancelled banner with reason and date on both the receipt and delivery authorization for a cancelled load',()=>{
    const cancelled={...load,status:'Cancelled',cancellationReason:'Customer changed the order',cancelledAt:'2026-08-12T09:30:00.000Z'} as unknown as ConfirmedLoad;
    const receipt=buildLoadDocumentHtml(cancelled,'receipt','58');
    expect(receipt).toContain('CANCELLED — NOT AN ACTIVE DELIVERY');
    expect(receipt).toContain('Reason: Customer changed the order');
    expect(receipt).toContain(new Date('2026-08-12T09:30:00.000Z').toLocaleString());
    const auth=buildLoadDocumentHtml(cancelled,'authorization','80');
    expect(auth).toContain('CANCELLED — NOT AN ACTIVE DELIVERY');
  });
  it('shows a dash for the cancellation reason when none was recorded',()=>{
    const cancelled={...load,status:'Cancelled',cancellationReason:null,cancelledAt:'2026-08-12T09:30:00.000Z'} as unknown as ConfirmedLoad;
    const html=buildLoadDocumentHtml(cancelled,'receipt','58');
    expect(html).toContain('Reason: —');
  });
});

describe('Quick Text PDF documents',()=>{
  const company={name:'DROMEX',address:'Beirut',phone:'+961 1 234 567',email:'office@example.com',taxVatNumber:'VAT-1',receiptFooter:'Thank you'};
  it('keeps a full minimum page while preserving normal text size on 58 mm paper',()=>{
    const html=buildQuickTextHtml({...emptyQuickTextDraft,message:'A'},company,null);
    expect(html).toContain('@page{size:58mm 176mm');
    expect(html).toContain('min-height:170mm');
    expect(html).toContain('font-size:10pt');
    expect(html).toContain('<div class="message">A</div>');
  });
  it('supports 80 mm, company letterhead, multiline text, and HTML escaping',()=>{
    const html=buildQuickTextHtml({...emptyQuickTextDraft,paperWidth:'80',message:'First line\nSecond <line>'},company,null);
    expect(html).toContain('@page{size:80mm 159mm');
    expect(html).toContain('<h1>DROMEX</h1>');
    expect(html).toContain('First line\nSecond &lt;line&gt;');
  });
});

describe('Load No. on the PDF receipt and authorization (DEC-504)',()=>{
  const numbered={...load,loadNumber:'ASP-00058',loadNumberSeriesName:'Asphalt'} as unknown as ConfirmedLoad;
  it('prints Load No. above the transaction number on both documents',()=>{
    for(const kind of ['receipt','authorization'] as const){
      const html=buildLoadDocumentHtml(numbered,kind,'58');
      expect(html).toContain('Load No.');
      expect(html).toContain('ASP-00058');
      expect(html.indexOf('Load No.')).toBeLessThan(html.indexOf('Transaction'));
      expect(html).toContain('20260811-ABCD-00001');
    }
  });
  it('keeps a number issued by an earlier build exactly as issued',()=>{
    expect(buildLoadDocumentHtml({...numbered,loadNumber:'ASP-2026-001'} as ConfirmedLoad,'receipt','80')).toContain('ASP-2026-001');
  });
  it('prints no Load No. row for a load that never had a number',()=>{
    expect(buildLoadDocumentHtml(load,'receipt','58')).not.toContain('Load No.');
    expect(buildLoadDocumentHtml({...load,loadNumber:null} as ConfirmedLoad,'authorization','58')).not.toContain('Load No.');
  });
  it('centres the company title and every contact line',()=>{
    const html=buildLoadDocumentHtml({...numbered,companyAddress:'Main Road, Hasbaya',companyPhone:'+961 70 123 456',companyEmail:'info@dromex.example',companyTaxVatNumber:'123456-601'} as ConfirmedLoad,'receipt','58');
    expect(html).toMatch(/h1{text-align:center/);
    expect(html).toMatch(/[^h]p{text-align:center/);
    for(const text of ['Main Road, Hasbaya','+961 70 123 456','info@dromex.example','Tax/VAT: 123456-601'])expect(html).toContain(`<p>${text}</p>`);
  });
});
