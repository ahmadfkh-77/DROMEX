import {hmac} from '@noble/hashes/hmac';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils';

import {localDateKey} from './fuel';
import type {ConfirmedLoad} from './loads';

/**
 * DEC-541. The verification QR printed on a receipt or Delivery Authorization. It holds the load's facts as plain readable lines, so any
 * camera shows them, plus a short code: a truncated HMAC-SHA256 of those facts under a secret that stays in this DROMEX (and its backup).
 * Only DROMEX can check the code; an edited fact, or a code made elsewhere, reads as Not valid.
 */
export const RECEIPT_QR_HEADER='DROMEX RECEIPT';
const VERSION='v1';
const CODE_LENGTH=12;

export type ReceiptQrFacts={load:string;receipt:string;date:string;item:string;quantity:string;project:string};

const clean=(value:string|null|undefined)=>(value??'').replace(/\s+/g,' ').trim();

/** The facts a receipt or authorization prints, in the one form that is signed. A cancelled load has none: it is not an active delivery. */
export function receiptQrFacts(record:Pick<ConfirmedLoad,'status'|'loadNumber'|'transactionNumber'|'confirmedAt'|'itemName'|'billedQuantity'|'outputUnitSymbol'|'projectName'>):ReceiptQrFacts|null{
  if(record.status==='Cancelled')return null;
  return{
    load:clean(record.loadNumber)||'-',receipt:clean(record.transactionNumber),date:localDateKey(new Date(record.confirmedAt)),
    item:clean(record.itemName),quantity:`${record.billedQuantity.toFixed(3)} ${clean(record.outputUnitSymbol)}`.trim(),project:clean(record.projectName)||'-',
  };
}

function sign(facts:ReceiptQrFacts,key:string):string{
  const canonical=[VERSION,facts.load,facts.receipt,facts.date,facts.item,facts.quantity,facts.project].join('|');
  return bytesToHex(hmac(sha256,utf8ToBytes(key),utf8ToBytes(canonical))).slice(0,CODE_LENGTH).toUpperCase();
}
const groupCode=(code:string)=>code.match(/.{1,4}/g)!.join('-');

/** The text inside the QR: readable lines, then the code. */
export function buildReceiptQrPayload(facts:ReceiptQrFacts,key:string):string{
  return[RECEIPT_QR_HEADER,`Load ${facts.load}`,`Receipt ${facts.receipt}`,`Date ${facts.date}`,`Item ${facts.item}`,`Qty ${facts.quantity}`,`Project ${facts.project}`,`Code ${groupCode(sign(facts,key))}`].join('\n');
}

export type ReceiptQrCheck={status:'genuine'|'invalid'|'unreadable';facts:ReceiptQrFacts|null};

/** Reads scanned QR text and checks its code against the facts it carries. Never throws. */
export function verifyReceiptQrPayload(text:string,key:string):ReceiptQrCheck{
  const lines=text.replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean);
  if(lines[0]!==RECEIPT_QR_HEADER)return{status:'unreadable',facts:null};
  const value=(label:string)=>{const line=lines.find(entry=>entry.startsWith(`${label} `));return line?line.slice(label.length+1):null;};
  const [load,receipt,date,item,quantity,project,code]=[value('Load'),value('Receipt'),value('Date'),value('Item'),value('Qty'),value('Project'),value('Code')];
  if(load===null||receipt===null||date===null||item===null||quantity===null||project===null||code===null)return{status:'unreadable',facts:null};
  const facts:ReceiptQrFacts={load,receipt,date,item,quantity,project};
  const expected=groupCode(sign(facts,key));
  return{status:code.toUpperCase()===expected?'genuine':'invalid',facts};
}
