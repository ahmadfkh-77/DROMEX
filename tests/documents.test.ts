import { describe, expect, it } from 'vitest';
import type { ConfirmedLoad } from '../src/domain/loads';
import { buildLoadDocumentHtml } from '../src/services/documentTemplates';

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
});
