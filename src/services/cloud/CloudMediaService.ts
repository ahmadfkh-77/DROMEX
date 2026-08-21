import * as FileSystem from 'expo-file-system/legacy';
import type {FirebaseRestGateway} from './FirebaseRestGateway';

const marker='cloud-storage://';
const singleFields:Record<string,string[]>= {company_settings:['logo_uri'],loads:['company_logo_uri'],quick_text_documents:['company_logo_uri'],project_media:['uri']};
const jsonFields:Record<string,string[]>= {daily_project_reports:['photos_json'],quarry_purchases:['photos_json']};

export class CloudMediaService{
  constructor(private readonly gateway:FirebaseRestGateway){}

  async prepareUpload(uid:string,table:string,recordId:string,row:Record<string,unknown>,idToken:string){const next={...row};for(const field of singleFields[table]??[]){const uri=typeof next[field]==='string'?String(next[field]):'';if(uri&&!uri.startsWith(marker)){const path=this.path(uid,table,recordId,field,0,uri);await this.gateway.uploadFile(path,uri,idToken);next[field]=`${marker}${path}`;}}for(const field of jsonFields[table]??[]){const values=parseArray(next[field]);const uploaded:string[]=[];for(let index=0;index<values.length;index+=1){const uri=values[index]!;if(uri.startsWith(marker)){uploaded.push(uri);continue;}const path=this.path(uid,table,recordId,field,index,uri);await this.gateway.uploadFile(path,uri,idToken);uploaded.push(`${marker}${path}`);}next[field]=JSON.stringify(uploaded);}return next;}

  async materialize(uid:string,table:string,recordId:string,row:Record<string,unknown>,idToken:string){const next={...row};for(const field of singleFields[table]??[]){const value=typeof next[field]==='string'?String(next[field]):'';if(value.startsWith(marker))next[field]=await this.download(uid,table,recordId,field,0,value.slice(marker.length),idToken);}for(const field of jsonFields[table]??[]){const values=parseArray(next[field]);const local:string[]=[];for(let index=0;index<values.length;index+=1){const value=values[index]!;local.push(value.startsWith(marker)?await this.download(uid,table,recordId,field,index,value.slice(marker.length),idToken):value);}next[field]=JSON.stringify(local);}return next;}

  private async download(uid:string,table:string,recordId:string,field:string,index:number,path:string,idToken:string){if(!FileSystem.documentDirectory)throw new Error('Permanent app storage is unavailable for cloud attachments.');const extension=path.split('.').pop()?.toLowerCase()||'jpg';const safe=(value:string)=>value.replace(/[^a-zA-Z0-9_-]/g,'_');const target=`${FileSystem.documentDirectory}cloud-sync/${safe(uid)}/${safe(table)}/${safe(recordId)}/${safe(field)}-${index}.${extension}`;const info=await FileSystem.getInfoAsync(target);if(!info.exists)await this.gateway.downloadFile(path,target,idToken);return target;}
  private path(uid:string,table:string,recordId:string,field:string,index:number,uri:string){const extension=uri.split('.').pop()?.split('?')[0]?.toLowerCase()||'jpg';const safe=(value:string)=>value.replace(/[^a-zA-Z0-9_.-]/g,'_');if(field==='company_logo_uri'||table==='company_settings'){const filename=uri.split('/').pop()?.split('?')[0]||`company-logo.${extension}`;return`owners/${safe(uid)}/media/company-logos/${safe(filename)}`;}return`owners/${safe(uid)}/media/${safe(table)}/${safe(recordId)}/${safe(field)}-${index}.${safe(extension)}`;}
}

function parseArray(value:unknown):string[]{if(Array.isArray(value))return value.filter(item=>typeof item==='string')as string[];if(typeof value!=='string'||!value)return[];try{const parsed=JSON.parse(value)as unknown;return Array.isArray(parsed)?parsed.filter(item=>typeof item==='string')as string[]:[];}catch{return[];}}
