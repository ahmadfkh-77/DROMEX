import type {CloudRecord,CloudSession} from '../../domain/cloud';
import type {FirebasePublicConfig} from '../../config/firebase';
import * as FileSystem from 'expo-file-system/legacy';

type Fetcher = typeof fetch;
type FirestoreValue={nullValue?:null;booleanValue?:boolean;integerValue?:string;doubleValue?:number;stringValue?:string;timestampValue?:string;mapValue?:{fields:Record<string,FirestoreValue>};arrayValue?:{values:FirestoreValue[]}};
type FirestoreDocument={name:string;fields?:Record<string,FirestoreValue>;updateTime?:string};

const authMessages:Record<string,string>={
  EMAIL_NOT_FOUND:'The owner account was not found.',INVALID_PASSWORD:'The password is incorrect.',INVALID_LOGIN_CREDENTIALS:'The email or password is incorrect.',USER_DISABLED:'This owner account is disabled.',TOO_MANY_ATTEMPTS_TRY_LATER:'Too many attempts. Wait before trying again.',INVALID_EMAIL:'Enter a valid email address.',WEAK_PASSWORD:'The password must contain at least 12 characters.',TOKEN_EXPIRED:'The owner session expired. Sign in again.',USER_NOT_FOUND:'The owner account was not found.',
};

export class FirebaseRestGateway {
  constructor(private readonly config:FirebasePublicConfig,private readonly request:Fetcher=fetch){}

  async signIn(email:string,password:string):Promise<CloudSession>{
    const value=await this.authCall<{localId:string;email:string;idToken:string;refreshToken:string;expiresIn:string}>('accounts:signInWithPassword',{email,password,returnSecureToken:true});
    const session:CloudSession={uid:value.localId,email:value.email,emailVerified:false,idToken:value.idToken,refreshToken:value.refreshToken,expiresAt:Date.now()+Number(value.expiresIn)*1000};
    return this.lookup(session);
  }

  async refresh(session:CloudSession):Promise<CloudSession>{
    const response=await this.request(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.config.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`});
    const body=await json(response);if(!response.ok)throw firebaseError(body);
    const value=body as {user_id:string;id_token:string;refresh_token:string;expires_in:string};
    return this.lookup({...session,uid:value.user_id,idToken:value.id_token,refreshToken:value.refresh_token,expiresAt:Date.now()+Number(value.expires_in)*1000});
  }

  async lookup(session:CloudSession):Promise<CloudSession>{
    const value=await this.authCall<{users?:Array<{localId:string;email:string;emailVerified?:boolean}>}>('accounts:lookup',{idToken:session.idToken});const user=value.users?.[0];if(!user)throw new Error('The owner session could not be verified.');return{...session,uid:user.localId,email:user.email,emailVerified:Boolean(user.emailVerified)};
  }

  async sendPasswordReset(email:string):Promise<void>{try{await this.authCall('accounts:sendOobCode',{requestType:'PASSWORD_RESET',email});}catch(cause){if(cause instanceof Error&&/account was not found|email not found/i.test(cause.message))return;throw cause;}}
  async sendEmailVerification(idToken:string):Promise<void>{await this.authCall('accounts:sendOobCode',{requestType:'VERIFY_EMAIL',idToken});}

  async hasRecords(uid:string,idToken:string):Promise<boolean>{
    const rows=await this.runQuery(uid,idToken,{from:[{collectionId:'records'}],limit:1});return rows.length>0;
  }

  async registerDevice(uid:string,deviceId:string,email:string,idToken:string):Promise<void>{
    const name=`projects/${this.config.projectId}/databases/(default)/documents/owners/${uid}/devices/${encodeURIComponent(deviceId)}`;const existing=await this.request(`https://firestore.googleapis.com/v1/${name}`,{headers:bearer(idToken)});if(existing.ok)return;if(existing.status!==404){const body=await json(existing);throw firebaseError(body);}const response=await this.request(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents:commit`,{method:'POST',headers:{...bearer(idToken),'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name,fields:{deviceId:toValue(deviceId),ownerEmail:toValue(email)}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]})});const body=await json(response);if(!response.ok)throw firebaseError(body);
  }

  async getRecord(uid:string,key:string,idToken:string):Promise<CloudRecord|null>{
    const name=this.documentName(uid,key);const response=await this.request(`https://firestore.googleapis.com/v1/${name}`,{headers:bearer(idToken)});if(response.status===404)return null;const body=await json(response);if(!response.ok)throw firebaseError(body);return fromDocument(body as FirestoreDocument);
  }

  async putRecord(uid:string,record:Omit<CloudRecord,'cloudUpdatedAt'>,idToken:string):Promise<void>{
    const name=this.documentName(uid,record.key);const fields:Record<string,FirestoreValue>={key:toValue(record.key),table:toValue(record.table),recordId:toValue(record.recordId),row:toValue(record.row),tombstone:toValue(record.tombstone),clientModifiedAt:toValue(record.clientModifiedAt),deviceId:toValue(record.deviceId)};
    const response=await this.request(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents:commit`,{method:'POST',headers:{...bearer(idToken),'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:{name,fields},updateTransforms:[{fieldPath:'cloudUpdatedAt',setToServerValue:'REQUEST_TIME'}]}]})});const body=await json(response);if(!response.ok)throw firebaseError(body);
  }

  async listChanges(uid:string,after:string,idToken:string):Promise<CloudRecord[]>{
    const rows=await this.runQuery(uid,idToken,{from:[{collectionId:'records'}],where:{fieldFilter:{field:{fieldPath:'cloudUpdatedAt'},op:'GREATER_THAN',value:{timestampValue:after}}},orderBy:[{field:{fieldPath:'cloudUpdatedAt'},direction:'ASCENDING'}],limit:250});return rows.map(fromDocument);
  }

  async uploadFile(path:string,uri:string,idToken:string):Promise<void>{
    const extension=uri.split('.').pop()?.split('?')[0]?.toLowerCase();const mime=extension==='png'?'image/png':extension==='webp'?'image/webp':'image/jpeg';const url=`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(this.config.storageBucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`;const result=await FileSystem.uploadAsync(url,uri,{httpMethod:'POST',uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,headers:{Authorization:`Firebase ${idToken}`,'Content-Type':mime}});if(result.status<200||result.status>=300)throw firebaseError(parseText(result.body));
  }

  async downloadFile(path:string,target:string,idToken:string):Promise<void>{
    const directory=target.slice(0,target.lastIndexOf('/')+1);await FileSystem.makeDirectoryAsync(directory,{intermediates:true});const url=`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(this.config.storageBucket)}/o/${encodeURIComponent(path)}?alt=media`;const result=await FileSystem.downloadAsync(url,target,{headers:{Authorization:`Firebase ${idToken}`}});if(result.status<200||result.status>=300)throw new Error(`Cloud attachment download failed (${result.status}).`);
  }

  private async runQuery(uid:string,idToken:string,structuredQuery:Record<string,unknown>):Promise<FirestoreDocument[]>{
    const url=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents/owners/${encodeURIComponent(uid)}:runQuery`;const response=await this.request(url,{method:'POST',headers:{...bearer(idToken),'Content-Type':'application/json'},body:JSON.stringify({structuredQuery})});const body=await json(response);if(!response.ok)throw firebaseError(body);return(Array.isArray(body)?body:[]).flatMap(value=>value&&typeof value==='object'&&'document'in value?[value.document as FirestoreDocument]:[]);
  }

  private documentName(uid:string,key:string){return`projects/${this.config.projectId}/databases/(default)/documents/owners/${uid}/records/${encodeURIComponent(key)}`;}
  private async authCall<T=unknown>(method:string,payload:unknown):Promise<T>{const response=await this.request(`https://identitytoolkit.googleapis.com/v1/${method}?key=${encodeURIComponent(this.config.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const body=await json(response);if(!response.ok)throw firebaseError(body);return body as T;}
}

const bearer=(token:string)=>({Authorization:`Bearer ${token}`});
async function json(response:Response):Promise<unknown>{const text=await response.text();if(!text)return{};try{return JSON.parse(text) as unknown;}catch{return{error:{message:text}};}}
function firebaseError(value:unknown):Error{const message=typeof value==='object'&&value&&'error'in value&&typeof value.error==='object'&&value.error&&'message'in value.error?String(value.error.message):'The cloud service could not complete the request.';const code=message.split(' : ')[0]??message;return new Error(authMessages[code]??message.replace(/_/g,' ').toLocaleLowerCase('en-US'));}
function toValue(value:unknown):FirestoreValue{if(value===null||value===undefined)return{nullValue:null};if(typeof value==='boolean')return{booleanValue:value};if(typeof value==='number')return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};if(typeof value==='string')return{stringValue:value};if(Array.isArray(value))return{arrayValue:{values:value.map(toValue)}};if(typeof value==='object'){const fields:Record<string,FirestoreValue>={};for(const[key,item]of Object.entries(value as Record<string,unknown>))fields[key]=toValue(item);return{mapValue:{fields}};}return{stringValue:String(value)};}
function fromValue(value:FirestoreValue|undefined):unknown{if(!value)return null;if('nullValue'in value)return null;if('booleanValue'in value)return value.booleanValue;if('integerValue'in value)return Number(value.integerValue);if('doubleValue'in value)return value.doubleValue;if('stringValue'in value)return value.stringValue;if('timestampValue'in value)return value.timestampValue;if('arrayValue'in value)return(value.arrayValue?.values??[]).map(fromValue);if('mapValue'in value){const result:Record<string,unknown>={};for(const[key,item]of Object.entries(value.mapValue?.fields??{}))result[key]=fromValue(item);return result;}return null;}
function fromDocument(document:FirestoreDocument):CloudRecord{const fields=document.fields??{};return{key:String(fromValue(fields.key)??''),table:String(fromValue(fields.table)??''),recordId:String(fromValue(fields.recordId)??''),row:(fromValue(fields.row)??null)as Record<string,unknown>|null,tombstone:Boolean(fromValue(fields.tombstone)),clientModifiedAt:String(fromValue(fields.clientModifiedAt)??''),cloudUpdatedAt:String(fromValue(fields.cloudUpdatedAt)??document.updateTime??new Date(0).toISOString()),deviceId:String(fromValue(fields.deviceId)??'')};}
function parseText(value:string):unknown{try{return JSON.parse(value)as unknown;}catch{return{error:{message:value}};}}
