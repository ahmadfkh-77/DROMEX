import {gcm} from '@noble/ciphers/aes';
import {sha256} from '@noble/hashes/sha256';
import {pbkdf2Async} from '@noble/hashes/pbkdf2';
import {bytesToUtf8,utf8ToBytes} from '@noble/hashes/utils';

const MAGIC='DROMEX-ENCRYPTED-BACKUP';
const FORMAT_VERSION=1;
const DEFAULT_ITERATIONS=310_000;
const AAD=utf8ToBytes(`${MAGIC}:${FORMAT_VERSION}`);

type Envelope={magic:string;formatVersion:number;kdf:'PBKDF2-HMAC-SHA256';iterations:number;salt:string;cipher:'AES-256-GCM';nonce:string;payload:string};
type CryptoOptions={iterations?:number;randomBytes?:(size:number)=>Uint8Array};

export async function encryptBackupBytes(plain:Uint8Array,password:string,options:CryptoOptions={}):Promise<Uint8Array>{
  validateNewBackupPassword(password);
  const iterations=options.iterations??DEFAULT_ITERATIONS;
  if(!Number.isSafeInteger(iterations)||iterations<10_000||iterations>2_000_000)throw new Error('The backup encryption work factor is invalid.');
  const random=options.randomBytes??secureRandom;
  const salt=random(16),nonce=random(12);
  const key=await derive(password,salt,iterations);
  try{
    const payload=gcm(key,nonce,AAD).encrypt(plain);
    // The same JSON envelope as always, written straight into bytes: the payload is encoded into the output without ever becoming
    // a giant string, so a large backup needs a fraction of the memory and time.
    const header:Envelope={magic:MAGIC,formatVersion:FORMAT_VERSION,kdf:'PBKDF2-HMAC-SHA256',iterations,salt:bytesToBase64(salt),cipher:'AES-256-GCM',nonce:bytesToBase64(nonce),payload:''};
    const json=JSON.stringify(header);
    const prefix=utf8ToBytes(json.slice(0,json.length-2)),suffix=utf8ToBytes('"}');
    const out=new Uint8Array(prefix.length+base64Length(payload.length)+suffix.length);
    out.set(prefix,0);const end=encodeBase64Into(payload,out,prefix.length);out.set(suffix,end);
    return out;
  }finally{key.fill(0);}
}

export async function decryptBackupBytes(encrypted:Uint8Array,password:string):Promise<Uint8Array>{
  if(!password)throw new Error('Enter the backup password.');
  let envelope:Envelope;
  // The payload is the last, very large field. Read the small header on its own and decode the payload straight from the bytes;
  // anything that does not look like that falls back to parsing the whole file.
  let payloadBytes:Uint8Array|null=null;
  try{
    const split=splitEnvelope(encrypted);
    if(split){envelope=JSON.parse(split.header) as Envelope;payloadBytes=decodeBase64From(encrypted,split.start,split.end);}
    else envelope=JSON.parse(bytesToUtf8(encrypted)) as Envelope;
  }catch{throw new Error('This is not a valid DROMEX backup file.');}
  if(envelope.magic!==MAGIC||envelope.formatVersion!==FORMAT_VERSION||envelope.kdf!=='PBKDF2-HMAC-SHA256'||envelope.cipher!=='AES-256-GCM')throw new Error('This backup format is not supported. Update DROMEX and try again.');
  if(!Number.isSafeInteger(envelope.iterations)||envelope.iterations<10_000||envelope.iterations>2_000_000)throw new Error('This backup has invalid encryption settings.');
  let salt:Uint8Array,nonce:Uint8Array,payload:Uint8Array;
  try{salt=base64ToBytes(envelope.salt);nonce=base64ToBytes(envelope.nonce);payload=payloadBytes??base64ToBytes(envelope.payload);}catch{throw new Error('This backup file is damaged.');}
  if(salt.length!==16||nonce.length!==12||payload.length<16)throw new Error('This backup file is damaged.');
  const key=await derive(password,salt,envelope.iterations);
  try{return gcm(key,nonce,AAD).decrypt(payload);}catch{throw new Error('The backup password is incorrect, or the backup file is damaged.');}finally{key.fill(0);}
}

/** Where the payload sits in an envelope: the header JSON without it, and the byte range of the base64 text. null when the file does not have that shape. */
function splitEnvelope(bytes:Uint8Array):{header:string;start:number;end:number}|null{
  const head=bytesToUtf8(bytes.subarray(0,Math.min(bytes.length,4096)));
  const marker='"payload":"',at=head.indexOf(marker);
  if(at<0)return null;
  let end=bytes.length-1;
  while(end>0&&bytes[end]!==34)end-=1;
  const start=at+marker.length;
  if(end<start)return null;
  return{header:`${head.slice(0,at)}"payload":""}`,start,end};
}

export function validateNewBackupPassword(password:string){if(password.length<12)throw new Error('Use a backup password of at least 12 characters.');}

async function derive(password:string,salt:Uint8Array,iterations:number){return pbkdf2Async(sha256,utf8ToBytes(password.normalize('NFC')),salt,{c:iterations,dkLen:32,asyncTick:12});}

function secureRandom(size:number){const cryptoValue=(globalThis as {crypto?:{getRandomValues?:<T extends ArrayBufferView|null>(array:T)=>T}}).crypto;if(!cryptoValue?.getRandomValues)throw new Error('Secure random generation is unavailable on this device.');const bytes=new Uint8Array(size);cryptoValue.getRandomValues(bytes);return bytes;}

const B64=Uint8Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',character=>character.charCodeAt(0));
const B64_INDEX=(()=>{const table=new Uint8Array(256).fill(255);B64.forEach((code,index)=>{table[code]=index;});return table;})();
export const base64Length=(byteCount:number)=>Math.ceil(byteCount/3)*4;
/** Base64 of `bytes` written as ASCII straight into `out` at `offset`; returns the offset after the last byte written. */
export function encodeBase64Into(bytes:Uint8Array,out:Uint8Array,offset:number):number{
  let o=offset;const full=bytes.length-(bytes.length%3);
  for(let i=0;i<full;i+=3){const n=(bytes[i]!<<16)|(bytes[i+1]!<<8)|bytes[i+2]!;out[o++]=B64[n>>18]!;out[o++]=B64[(n>>12)&63]!;out[o++]=B64[(n>>6)&63]!;out[o++]=B64[n&63]!;}
  const rest=bytes.length-full;
  if(rest===1){const n=bytes[full]!<<16;out[o++]=B64[n>>18]!;out[o++]=B64[(n>>12)&63]!;out[o++]=61;out[o++]=61;}
  else if(rest===2){const n=(bytes[full]!<<16)|(bytes[full+1]!<<8);out[o++]=B64[n>>18]!;out[o++]=B64[(n>>12)&63]!;out[o++]=B64[(n>>6)&63]!;out[o++]=61;}
  return o;
}
/** Decodes base64 held as ASCII bytes in `source[start,end)`, without making a string. Throws on anything that is not valid base64. */
export function decodeBase64From(source:Uint8Array,start:number,end:number):Uint8Array{
  const length=end-start;
  if(length<=0||length%4!==0)throw new Error('Invalid base64 data.');
  const padding=source[end-1]===61?(source[end-2]===61?2:1):0;
  const out=new Uint8Array((length/4)*3-padding);let o=0;
  for(let i=start;i<end;i+=4){
    const a=B64_INDEX[source[i]!]!,b=B64_INDEX[source[i+1]!]!,last=i+4>=end;
    const c=last&&padding===2?0:B64_INDEX[source[i+2]!]!,d=last&&padding>=1?0:B64_INDEX[source[i+3]!]!;
    if(a===255||b===255||c===255||d===255)throw new Error('Invalid base64 data.');
    const n=(a<<18)|(b<<12)|(c<<6)|d;
    if(o<out.length)out[o++]=n>>16;if(o<out.length)out[o++]=(n>>8)&255;if(o<out.length)out[o++]=n&255;
  }
  return out;
}

export function bytesToBase64(bytes:Uint8Array){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';for(let index=0;index<bytes.length;index+=3){const a=bytes[index]??0,b=bytes[index+1]??0,c=bytes[index+2]??0,value=(a<<16)|(b<<8)|c;result+=alphabet[(value>>18)&63]??'';result+=alphabet[(value>>12)&63]??'';result+=index+1<bytes.length?(alphabet[(value>>6)&63]??''):'=';result+=index+2<bytes.length?(alphabet[value&63]??''):'=';}return result;}

export function base64ToBytes(value:string){const clean=value.replace(/\s/g,'');if(!clean||clean.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(clean))throw new Error('Invalid base64 data.');const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';const outputLength=(clean.length/4)*3-(clean.endsWith('==')?2:clean.endsWith('=')?1:0),output=new Uint8Array(outputLength);let offset=0;for(let index=0;index<clean.length;index+=4){const a=alphabet.indexOf(clean[index]??''),b=alphabet.indexOf(clean[index+1]??''),c=clean[index+2]==='='?0:alphabet.indexOf(clean[index+2]??''),d=clean[index+3]==='='?0:alphabet.indexOf(clean[index+3]??'');if(a<0||b<0||c<0||d<0)throw new Error('Invalid base64 data.');const packed=(a<<18)|(b<<12)|(c<<6)|d;if(offset<output.length)output[offset++]=(packed>>16)&255;if(offset<output.length)output[offset++]=(packed>>8)&255;if(offset<output.length)output[offset++]=packed&255;}return output;}
