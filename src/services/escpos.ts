import {Buffer} from 'buffer';

import type {ConfirmedLoad} from '../domain/loads';
import type {QuickTextDocument} from '../domain/quickText';
import type {LoadDocumentKind,PaperWidth} from './documentTemplates';

const ESC=0x1b,GS=0x1d;
const command=(...values:number[])=>Buffer.from(values);
const text=(value:string)=>Buffer.from(value.replace(/\r/g,''),'utf8');
const divider=(columns:number)=>'-'.repeat(columns);

class EscPosDocument{
  private readonly parts:Buffer[]=[];
  constructor(readonly paper:PaperWidth){this.parts.push(command(ESC,0x40),command(ESC,0x33,36));}
  align(value:0|1|2){this.parts.push(command(ESC,0x61,value));return this;}
  bold(value:boolean){this.parts.push(command(ESC,0x45,value?1:0));return this;}
  size(value:0|1){this.parts.push(command(GS,0x21,value?0x11:0));return this;}
  line(value=''){this.parts.push(text(`${value}\n`));return this;}
  wrapped(value:string,columns=this.paper==='58'?32:48){for(const line of wrapText(value,columns))this.line(line);return this;}
  raster(value:Buffer){this.parts.push(value);return this;}
  finish(){this.parts.push(command(ESC,0x64,4));return Buffer.concat(this.parts);}
}

export function wrapText(value:string,width:number):string[]{
  const result:string[]=[];
  for(const sourceLine of String(value??'').split('\n')){
    const words=sourceLine.trim().split(/\s+/).filter(Boolean);
    if(!words.length){result.push('');continue;}
    let line='';
    for(const word of words){
      if(word.length>width){if(line){result.push(line);line='';}for(let index=0;index<word.length;index+=width)result.push(word.slice(index,index+width));continue;}
      const candidate=line?`${line} ${word}`:word;
      if(candidate.length>width){result.push(line);line=word;}else line=candidate;
    }
    if(line)result.push(line);
  }
  return result;
}

export function labelValueLines(label:string,value:unknown,paper:PaperWidth):string[]{
  const columns=paper==='58'?32:48,labelWidth=paper==='58'?14:20,gap=1,valueWidth=columns-labelWidth-gap;
  const labels=wrapText(`${label}:`,labelWidth),values=wrapText(String(value??'—'),valueWidth),count=Math.max(labels.length,values.length);
  return Array.from({length:count},(_,index)=>{
    const left=(labels[index]??'').padEnd(labelWidth);
    const right=(values[index]??'').padStart(valueWidth);
    return `${left}${' '.repeat(gap)}${right}`;
  });
}

function labelled(doc:EscPosDocument,label:string,value:unknown,strong=false){
  if(strong)doc.bold(true);
  for(const line of labelValueLines(label,value,doc.paper))doc.line(line);
  if(strong)doc.bold(false);
}

function companyHeader(doc:EscPosDocument,name:string,address:string|null,phone:string|null,email:string|null,tax:string|null){
  doc.align(1).bold(true).size(1).wrapped(name).size(0).bold(false);
  if(address)doc.wrapped(address);
  if(phone)doc.wrapped(phone);
  if(email)doc.wrapped(email);
  if(tax)doc.wrapped(`Tax/VAT: ${tax}`);
  doc.line('').align(0).line(divider(doc.paper==='58'?32:48));
}

export function buildLoadEscPos(record:ConfirmedLoad,kind:LoadDocumentKind,paper:PaperWidth):Buffer{
  const doc=new EscPosDocument(paper),columns=paper==='58'?32:48;
  companyHeader(doc,record.companyName,record.companyAddress,record.companyPhone,record.companyEmail,record.companyTaxVatNumber);
  doc.align(1).bold(true).wrapped(kind==='receipt'?'RECEIPT':'DELIVERY AUTHORIZATION').bold(false).line('').align(0);
  labelled(doc,'Transaction',record.transactionNumber);
  labelled(doc,'Date',new Date(record.confirmedAt).toLocaleString());
  labelled(doc,'Customer',record.customerName);
  if(record.projectName)labelled(doc,'Project',record.projectName);
  labelled(doc,'Item',record.itemName);
  if(kind==='receipt'){
    doc.line('').line(divider(columns));
    labelled(doc,'Quantity',`${record.billedQuantity.toFixed(3)} ${record.outputUnitSymbol}`);
    labelled(doc,'Unit price',record.unitPriceUsd==null?'Unpriced':`$${record.unitPriceUsd.toFixed(2)}`);
    if(record.unitPriceUsd!=null){
      doc.line('');
      labelled(doc,'Subtotal',`$${record.subtotalUsd?.toFixed(2)}`);
      labelled(doc,'VAT rate',`${record.vatRatePercent??0}%`);
      labelled(doc,'VAT amount',`$${record.vatAmountUsd?.toFixed(2)}`);
      doc.line(divider(columns));
      labelled(doc,'Final total',`$${record.finalTotalUsd?.toFixed(2)}`,true);
    }
  }else{
    doc.line('').line(divider(columns));
    const destination=record.projectLocation??record.destinationAddress;
    if(destination)labelled(doc,'Destination',destination);
    labelled(doc,'Driver',record.driverName);
    labelled(doc,'Truck plate',record.truckPlate);
    if(record.quantityMethod==='weighbridge'){
      if(record.requestedQuantityKg!=null)labelled(doc,'Requested quantity',`${record.requestedQuantityKg} kg`);
      labelled(doc,'Empty weight',`${record.emptyWeightKg} kg`);
      labelled(doc,'Full weight',`${record.fullWeightKg} kg`);
      labelled(doc,'Net weight',`${record.netWeightKg} kg`,true);
      labelled(doc,'Converted quantity',`${record.billedQuantity.toFixed(3)} ${record.outputUnitSymbol}`);
    }else labelled(doc,'Quantity',`${record.billedQuantity.toFixed(3)} ${record.outputUnitSymbol}`,true);
    if(record.signaturePaths.length){
      doc.line('').line(divider(columns)).line('').align(1).raster(signatureRaster(record.signaturePaths,paper)).wrapped(`Driver signature: ${record.driverName}`).align(0);
    }else labelled(doc,'Driver signature','Unsigned');
  }
  if(record.companyReceiptFooter)doc.line('').line(divider(columns)).line('').align(1).wrapped(record.companyReceiptFooter).align(0);
  return doc.finish();
}

export function buildQuickTextEscPos(record:QuickTextDocument):Buffer{
  const doc=new EscPosDocument(record.paperWidth),columns=record.paperWidth==='58'?32:48;
  companyHeader(doc,record.companyName,record.companyAddress,record.companyPhone,record.companyEmail,record.companyTaxVatNumber);
  doc.align(1).bold(true).wrapped(record.title).bold(false).line('').align(0);
  labelled(doc,'Document',record.documentNumber);
  labelled(doc,'Date',new Date(record.createdAt).toLocaleString());
  if(record.reference)labelled(doc,'Reference',record.reference);
  if(record.customerName)labelled(doc,'Customer',record.customerName);
  if(record.projectName)labelled(doc,'Project',record.projectName);
  doc.line('').line(divider(columns)).line('');
  doc.align(record.alignment==='center'?1:record.alignment==='right'?2:0).bold(record.emphasis!=='normal').wrapped(record.message).bold(false).align(0);
  if(record.preparedBy)labelled(doc,'Prepared by',record.preparedBy);
  if(record.showSignatureLine)doc.line('').line('________________________').line('Signature');
  if(record.companyReceiptFooter)doc.line('').line(divider(columns)).line('').align(1).wrapped(record.companyReceiptFooter).align(0);
  return doc.finish();
}

export function buildTestEscPos(name:string,paper:PaperWidth):Buffer{
  const doc=new EscPosDocument(paper),columns=paper==='58'?32:48;
  doc.align(1).bold(true).size(1).line('DROMEX').size(0).line('BLUETOOTH TEST').bold(false).line(divider(columns)).wrapped(`Printer: ${name}`).wrapped(`Paper: ${paper} mm`).wrapped(new Date().toLocaleString()).line(divider(columns)).bold(true).line('PAIRING SUCCESSFUL').bold(false);
  return doc.finish();
}

export function signatureRaster(paths:string[],paper:PaperWidth):Buffer{
  const targetWidth=Math.min(paper==='58'?320:480,320),targetHeight=Math.round(140*(targetWidth/320));
  const bytesPerRow=Math.ceil(targetWidth/8),pixels=new Uint8Array(bytesPerRow*targetHeight);
  const setPixel=(x:number,y:number)=>{if(x<0||y<0||x>=targetWidth||y>=targetHeight)return;const index=y*bytesPerRow+(x>>3);pixels[index]=(pixels[index]??0)|(0x80>>(x&7));};
  const draw=(x0:number,y0:number,x1:number,y1:number)=>{let dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1,err=dx+dy;while(true){for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)setPixel(x0+ox,y0+oy);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}};
  for(const path of paths){
    const numbers=(path.match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);let previous:[number,number]|null=null;
    for(let index=0;index+1<numbers.length;index+=2){const point:[number,number]=[Math.round(numbers[index]!*(targetWidth/320)),Math.round(numbers[index+1]!*(targetHeight/140))];if(previous)draw(previous[0],previous[1],point[0],point[1]);previous=point;}
  }
  return Buffer.concat([command(GS,0x76,0x30,0x00,bytesPerRow&0xff,(bytesPerRow>>8)&0xff,targetHeight&0xff,(targetHeight>>8)&0xff),Buffer.from(pixels),text('\n')]);
}
