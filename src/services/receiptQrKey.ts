import * as Crypto from 'expo-crypto';
import Storage from 'expo-sqlite/kv-store';

import type {ConfirmedLoad} from '../domain/loads';
import {buildReceiptQrPayload,receiptQrFacts,verifyReceiptQrPayload,type ReceiptQrCheck} from '../domain/receiptQr';

/**
 * DEC-541. The secret behind the receipt QR code. It is made once on first use and kept as an app preference, so the encrypted backup
 * carries it and a restored phone still verifies receipts it printed before. It is never printed or shown.
 */
export const RECEIPT_QR_KEY_PREFERENCE='dromex.receipt-qr-key.v1';

export async function receiptQrKey():Promise<string>{
  const existing=await Storage.getItem(RECEIPT_QR_KEY_PREFERENCE);
  if(existing&&/^[0-9a-f]{64}$/.test(existing))return existing;
  const created=Array.from(Crypto.getRandomBytes(32),byte=>byte.toString(16).padStart(2,'0')).join('');
  await Storage.setItem(RECEIPT_QR_KEY_PREFERENCE,created);
  return created;
}

/** The text to put in the QR for this load, or null for a cancelled load (not an active delivery). */
export async function receiptQrPayloadFor(record:ConfirmedLoad):Promise<string|null>{
  const facts=receiptQrFacts(record);
  return facts?buildReceiptQrPayload(facts,await receiptQrKey()):null;
}

export async function verifyScannedReceipt(text:string):Promise<ReceiptQrCheck>{
  return verifyReceiptQrPayload(text,await receiptQrKey());
}
