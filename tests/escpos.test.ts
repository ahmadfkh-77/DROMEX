import {describe,expect,it} from 'vitest';

import type {ConfirmedLoad} from '../src/domain/loads';
import {buildLoadEscPos,labelValueLines,signatureRaster,wrapText} from '../src/services/escpos';

const load:ConfirmedLoad={
  quantityMethod:'direct',netWeightKg:null,convertedQuantity:25,billedQuantity:25,subtotalUsd:50,vatAmountUsd:5.5,finalTotalUsd:55.5,
  id:'load-1',transactionNumber:'20260825-A-00001',confirmedAt:'2026-08-25T12:00:00.000Z',customerName:'Road Works Ltd',projectName:'North Road',projectLocation:'North district',destinationAddress:null,itemName:'PVC Pipe',itemCode:'PVC-01',categoryName:'Pipes',driverName:'Ali Driver',truckPlate:'123456',requestedQuantityKg:null,emptyWeightKg:null,fullWeightKg:null,conversionName:null,conversionRule:null,directQuantity:25,directUnitName:'Piece',directUnitSymbol:'pc',outputUnitSymbol:'pc',unitPriceUsd:2,vatRatePercent:11,paymentStatus:'Unpaid',signatureStatus:'Signed',signaturePaths:['M 10 20 L 100 80 L 250 40'],notes:null,companyName:'DROMEX',companyAddress:'Beirut',companyPhone:'01000000',companyEmail:null,companyTaxVatNumber:null,companyReceiptFooter:'Thank you',companyLogoUri:null,
};

describe('ESC/POS thermal output',()=>{
  it('wraps long lines without exceeding the paper width',()=>{
    expect(wrapText('one two three four five',8)).toEqual(['one two','three','four','five']);
  });

  it('builds a direct-quantity receipt without weighbridge fields',()=>{
    const output=buildLoadEscPos(load,'receipt','58').toString('utf8');
    expect(output).toContain('DROMEX');
    expect(output).toContain('PVC Pipe');
    expect(output).toContain('Quantity:');
    expect(output).toContain('25.000 pc');
    expect(output).not.toContain('Empty weight');
  });

  it('prints preview-like label and right-aligned value columns',()=>{
    const [line]=labelValueLines('Quantity','25.000 pc','58');
    expect(line).toHaveLength(32);
    expect(line).toBe('Quantity:              25.000 pc');
  });

  it('wraps long values inside the right column without moving labels',()=>{
    const lines=labelValueLines('Customer','A very long customer company name','58');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.startsWith('Customer:')).toBe(true);
    expect(lines[1]?.slice(0,14).trim()).toBe('');
    expect(lines.every(line=>line.length===32)).toBe(true);
  });

  it('includes the authorization signature as an ESC/POS raster image',()=>{
    const output=buildLoadEscPos(load,'authorization','58');
    expect(output.includes(Buffer.from([0x1d,0x76,0x30,0x00]))).toBe(true);
    expect(output.toString('utf8')).toContain('Driver signature: Ali Driver');
  });

  it('creates non-empty signature pixels',()=>{
    const raster=signatureRaster(['M 0 0 L 320 140'],'58');
    expect([...raster.subarray(8,-1)].some(value=>value!==0)).toBe(true);
  });
});
