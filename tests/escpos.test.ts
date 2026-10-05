import {describe,expect,it} from 'vitest';

import type {ConfirmedLoad} from '../src/domain/loads';
import {buildLoadEscPos,centerLine,centeredLines,labelValueLines,signatureRaster,wrapText} from '../src/services/escpos';

const load:ConfirmedLoad={
  quantityMethod:'direct',netWeightKg:null,convertedQuantity:25,billedQuantity:25,subtotalUsd:50,vatAmountUsd:5.5,finalTotalUsd:55.5,
  id:'load-1',transactionNumber:'20260825-A-00001',confirmedAt:'2026-08-25T12:00:00.000Z',customerName:'Road Works Ltd',projectName:'North Road',projectLocation:'North district',destinationAddress:null,itemName:'PVC Pipe',itemCode:'PVC-01',categoryName:'Pipes',driverName:'Ali Driver',truckPlate:'123456',requestedQuantityKg:null,emptyWeightKg:null,fullWeightKg:null,conversionName:null,conversionRule:null,directQuantity:25,directUnitName:'Piece',directUnitSymbol:'pc',outputUnitSymbol:'pc',unitPriceUsd:2,vatRatePercent:11,paymentStatus:'Unpaid',signatureStatus:'Signed',signaturePaths:['M 10 20 L 100 80 L 250 40'],notes:null,companyName:'DROMEX',companyAddress:'Beirut',companyPhone:'01000000',companyEmail:null,companyTaxVatNumber:null,companyReceiptFooter:'Thank you',companyLogoUri:null,
  status:'Active',cancellationReason:null,cancelledAt:null,correctionHistory:[],
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

  it('prints no cancelled marker for an active load',()=>{
    const output=buildLoadEscPos(load,'receipt','58').toString('utf8');
    expect(output).not.toContain('CANCELLED');
  });

  it('prints a cancelled marker with reason and date before the document body for a cancelled load',()=>{
    const cancelled:ConfirmedLoad={...load,status:'Cancelled',cancellationReason:'Customer changed the order',cancelledAt:'2026-08-26T09:30:00.000Z'};
    const output=buildLoadEscPos(cancelled,'receipt','58').toString('utf8');
    expect(output).toContain('CANCELLED');
    expect(output).toContain('NOT AN ACTIVE DELIVERY');
    expect(output).toContain('Reason: Customer changed the');
    expect(output).toContain('order');
    expect(output).toContain('Cancelled 8/26/2026');
    expect(output.indexOf('CANCELLED')).toBeLessThan(output.indexOf('RECEIPT'));
  });
});

describe('centred company header',()=>{
  const full:ConfirmedLoad={...load,companyAddress:'Hasbaya Main Road Near The Old Market Square',companyPhone:'+961 70 123 456',companyEmail:'info@dromex.example',companyTaxVatNumber:'123456-601'};
  /** The text of the line that carries `text`, with the spaces in front of it and the character before them. */
  const lineWith=(output:string,text:string)=>{
    const at=output.indexOf(text);
    if(at<0)throw new Error(`"${text}" was not printed`);
    let start=at;while(start>0&&output[start-1]===' ')start--;
    return {leading:at-start};
  };

  it('centres a line by padding it to the paper width',()=>{
    expect(centerLine('abc',9)).toBe('   abc');
    expect(centerLine('ab',9)).toBe('   ab');
    expect(centerLine('abcdefghi',9)).toBe('abcdefghi');
    expect(centerLine('too long for width',5)).toBe('too long for width');
  });

  it('wraps a long line and centres every wrapped line',()=>{
    const lines=centeredLines('Main Road Hasbaya South Lebanon',16);
    expect(lines).toEqual(['   Main Road',' Hasbaya South','    Lebanon']);
    for(const line of lines)expect(line.length).toBeLessThanOrEqual(16);
  });

  it('prints address, phone, email and tax lines centred on 58 mm paper',()=>{
    const output=buildLoadEscPos(full,'receipt','58').toString('utf8');
    for(const text of ['+961 70 123 456','info@dromex.example','Tax/VAT: 123456-601']){
      expect(lineWith(output,text).leading).toBe(Math.floor((32-text.length)/2));
    }
    expect(lineWith(output,'Hasbaya Main Road Near The Old').leading).toBe(Math.floor((32-'Hasbaya Main Road Near The Old'.length)/2));
    expect(lineWith(output,'Market Square').leading).toBe(Math.floor((32-'Market Square'.length)/2));
  });

  it('prints them centred on 80 mm paper',()=>{
    const output=buildLoadEscPos(full,'receipt','80').toString('utf8');
    expect(lineWith(output,'+961 70 123 456').leading).toBe(Math.floor((48-'+961 70 123 456'.length)/2));
    expect(lineWith(output,'Hasbaya Main Road Near The Old Market Square').leading).toBe(Math.floor((48-'Hasbaya Main Road Near The Old Market Square'.length)/2));
  });

  it('centres the company name at double size using half the paper width',()=>{
    const output=buildLoadEscPos({...full,companyName:'DROMEX ASPHALT'},'receipt','58').toString('utf8');
    expect(lineWith(output,'DROMEX ASPHALT').leading).toBe(Math.floor((16-'DROMEX ASPHALT'.length)/2));
  });

  it('centres the header of a delivery authorization too',()=>{
    const output=buildLoadEscPos(full,'authorization','58').toString('utf8');
    expect(lineWith(output,'+961 70 123 456').leading).toBe(Math.floor((32-'+961 70 123 456'.length)/2));
  });
});

describe('Load No. on the printed document',()=>{
  const numbered:ConfirmedLoad={...load,loadNumber:'ASP-00058',loadNumberSeriesName:'Asphalt'};

  it('prints Load No. on the receipt directly above the transaction number',()=>{
    const output=buildLoadEscPos(numbered,'receipt','58').toString('utf8');
    expect(output).toContain('Load No.:');
    expect(output).toContain('ASP-00058');
    expect(output.indexOf('Load No.:')).toBeLessThan(output.indexOf('Transaction:'));
    expect(output).toContain('20260825-A-00001');
  });

  it('prints Load No. on the delivery authorization too',()=>{
    const output=buildLoadEscPos(numbered,'authorization','58').toString('utf8');
    expect(output).toContain('Load No.:');
    expect(output).toContain('ASP-00058');
  });

  it('prints Load No. in bold',()=>{
    const output=buildLoadEscPos(numbered,'receipt','58');
    const boldOn=Buffer.from([0x1b,0x45,0x01]),text=Buffer.from('Load No.:');
    const at=output.indexOf(text);
    expect(at).toBeGreaterThan(boldOn.length);
    expect(output.subarray(at-boldOn.length,at).equals(boldOn)).toBe(true);
  });

  it('keeps a number issued by an earlier build exactly as issued',()=>{
    const output=buildLoadEscPos({...load,loadNumber:'ASP-2026-001'},'receipt','58').toString('utf8');
    expect(output).toContain('ASP-2026-001');
  });

  it('prints no Load No. line for a load that never had a number',()=>{
    const legacy=buildLoadEscPos(load,'receipt','58').toString('utf8');
    expect(legacy).not.toContain('Load No.');
    expect(buildLoadEscPos({...load,loadNumber:null},'receipt','58').toString('utf8')).not.toContain('Load No.');
  });
});
