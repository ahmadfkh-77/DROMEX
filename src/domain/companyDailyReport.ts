/**
 * Company Daily Report, phase 1: a read-only model of everything recorded on one day across every project, company
 * site and "no project". It only groups and adds what other parts of the app already recorded; it never changes data.
 * Rule: anything not recorded is not shown (no empty place, section or zero figure), and cancelled records are excluded.
 */

export type RecordStatus='Active'|'Cancelled';
export type PlaceKind='project'|'site'|'none';

type PlaceRef={projectId:string|null;projectName:string|null;siteId:string|null;siteName:string|null};
type Base=PlaceRef&{id:string;status:RecordStatus;/** Local date-time of the record, e.g. 2026-11-06T07:40:00. */time:string};

export type DayLoadOut=Base&{loadNumber:string|null;itemName:string;unitSymbol:string;quantity:number;truckPlate:string|null;driverName:string|null;
  /** Bitumen used, from the bitumen engine; null when unknown or not covered ("-"). */bitumenKg:number|null;
  /** True for a load the bitumen rule applies to (asphalt). Left out, it is true when a bitumen figure exists. */bitumenApplies?:boolean};
export type DaySupplierLoad=Base&{number:string|null;itemName:string;unitSymbol:string;quantity:number;supplierName:string|null;deliveredBy:'company'|'supplier'|null;truckPlate:string|null;ticket:string|null};
export type DayFill=Base&{givenTo:string;fuelType:string;operatorName:string|null;litres:number};
export type DayWasteDump=Base&{material:string|null;area:string|null;truckPlate:string|null;driverName:string|null};

export type DayInput={loadsOut:DayLoadOut[];supplierLoads:DaySupplierLoad[];fills:DayFill[];dumps:DayWasteDump[]};

export type DaySection='loadsOut'|'supplierLoads'|'fills'|'dumps';
export type DayPlace={key:string;name:string;kind:PlaceKind;loadsOut:DayLoadOut[];supplierLoads:DaySupplierLoad[];fills:DayFill[];dumps:DayWasteDump[];sections:DaySection[]};
export type DayTile={key:'loadsOut'|'supplierLoads'|'fuel'|'waste';value:number;unit:string|null};
export type DayMaterial={itemName:string;unitSymbol:string;outLoads:number;outQuantity:number;inLoads:number;inQuantity:number;bitumenKg:number|null};
export type CompanyDailyReport={day:string;isEmpty:boolean;tiles:DayTile[];materials:DayMaterial[];bitumenKg:number|null;places:DayPlace[]};
export type MaterialView=DayMaterial&{places:DayPlace[]};

export const NO_PLACE_NAME='No project or site';
const round=(value:number)=>Math.round(value*1e6)/1e6;
const byTime=<T extends {time:string;id:string}>(list:T[])=>[...list].sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));

const pad=(value:number)=>String(value).padStart(2,'0');
const hasZone=(iso:string)=>/(Z|[+-]\d{2}:?\d{2})$/.test(iso);
/** The local calendar day of a stored date-time: values with a time zone are converted, local ones are read as they are. */
export function localDay(iso:string):string{
  if(!hasZone(iso))return iso.slice(0,10);
  const date=new Date(iso);return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}
export function localTime(iso:string):string{
  if(!hasZone(iso))return iso.slice(11,16);
  const date=new Date(iso);return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function placeOf(ref:PlaceRef):{key:string;name:string;kind:PlaceKind}{
  if(ref.projectId)return {key:`project:${ref.projectId}`,name:ref.projectName??'Project',kind:'project'};
  if(ref.siteId)return {key:`site:${ref.siteId}`,name:ref.siteName??'Company site',kind:'site'};
  return {key:'none',name:NO_PLACE_NAME,kind:'none'};
}
const kindRank:Record<PlaceKind,number>={project:0,site:1,none:2};

export function buildCompanyDailyReport(day:string,input:DayInput):CompanyDailyReport{
  const loadsOut=input.loadsOut.filter(v=>v.status==='Active');const supplierLoads=input.supplierLoads.filter(v=>v.status==='Active');
  const fills=input.fills.filter(v=>v.status==='Active');const dumps=input.dumps.filter(v=>v.status==='Active');

  const places=new Map<string,DayPlace>();
  const place=(ref:PlaceRef)=>{const info=placeOf(ref);let found=places.get(info.key);if(!found){found={...info,loadsOut:[],supplierLoads:[],fills:[],dumps:[],sections:[]};places.set(info.key,found);}return found;};
  for(const v of byTime(loadsOut))place(v).loadsOut.push(v);
  for(const v of byTime(supplierLoads))place(v).supplierLoads.push(v);
  for(const v of byTime(fills))place(v).fills.push(v);
  for(const v of byTime(dumps))place(v).dumps.push(v);
  const ordered=[...places.values()].sort((a,b)=>kindRank[a.kind]-kindRank[b.kind]||a.name.localeCompare(b.name));
  for(const p of ordered)p.sections=(['loadsOut','supplierLoads','fills','dumps'] as DaySection[]).filter(s=>p[s].length>0);

  const materials=new Map<string,DayMaterial>();
  const material=(itemName:string,unitSymbol:string)=>{const key=`${itemName}\u001f${unitSymbol}`;let found=materials.get(key);if(!found){found={itemName,unitSymbol,outLoads:0,outQuantity:0,inLoads:0,inQuantity:0,bitumenKg:null};materials.set(key,found);}return found;};
  let bitumenKg:number|null=null;
  for(const v of loadsOut){
    const row=material(v.itemName,v.unitSymbol);row.outLoads+=1;row.outQuantity=round(row.outQuantity+v.quantity);
    if(v.bitumenKg!==null){row.bitumenKg=round((row.bitumenKg??0)+v.bitumenKg);bitumenKg=round((bitumenKg??0)+v.bitumenKg);}
  }
  for(const v of supplierLoads){const row=material(v.itemName,v.unitSymbol);row.inLoads+=1;row.inQuantity=round(row.inQuantity+v.quantity);}

  const litres=round(fills.reduce((sum,v)=>sum+v.litres,0));
  const tiles:DayTile[]=[];
  if(loadsOut.length)tiles.push({key:'loadsOut',value:loadsOut.length,unit:null});
  if(supplierLoads.length)tiles.push({key:'supplierLoads',value:supplierLoads.length,unit:null});
  if(fills.length&&litres>0)tiles.push({key:'fuel',value:litres,unit:'L'});
  if(dumps.length)tiles.push({key:'waste',value:dumps.length,unit:null});

  return {day,isEmpty:ordered.length===0,tiles,materials:[...materials.values()].sort((a,b)=>a.itemName.localeCompare(b.itemName)||a.unitSymbol.localeCompare(b.unitSymbol)),bitumenKg,places:ordered};
}

/** Every record of one material and unit, grouped by place, with its load counts and quantities. Null when nobody moved it that day. */
export function materialView(report:CompanyDailyReport,itemName:string,unitSymbol:string):MaterialView|null{
  const found=report.materials.find(m=>m.itemName===itemName&&m.unitSymbol===unitSymbol);
  if(!found)return null;
  const places=report.places.map(p=>{
    const loadsOut=p.loadsOut.filter(v=>v.itemName===itemName&&v.unitSymbol===unitSymbol);
    const supplierLoads=p.supplierLoads.filter(v=>v.itemName===itemName&&v.unitSymbol===unitSymbol);
    const sections:DaySection[]=[];if(loadsOut.length)sections.push('loadsOut');if(supplierLoads.length)sections.push('supplierLoads');
    return {...p,loadsOut,supplierLoads,fills:[],dumps:[],sections};
  }).filter(p=>p.sections.length>0);
  return {...found,places};
}

export type PlaceMaterial={itemName:string;unitSymbol:string;loadsOut:DayLoadOut[];supplierLoads:DaySupplierLoad[];outQuantity:number;inQuantity:number;
  /** True for asphalt-type material, where bitumen used is shown; other materials never get a bitumen column. */bitumenApplies:boolean;
  /** Bitumen used by the loads that could be counted; null when none could. */bitumenKg:number|null;uncountedLoads:number};

/** The records of one place grouped by material and unit (item name, then unit), so each material can be read and totalled on its own. */
export function placeMaterials(place:Pick<DayPlace,'loadsOut'|'supplierLoads'>):PlaceMaterial[]{
  const map=new Map<string,PlaceMaterial>();
  const get=(itemName:string,unitSymbol:string)=>{const key=`${itemName}\u001f${unitSymbol}`;let found=map.get(key);if(!found){found={itemName,unitSymbol,loadsOut:[],supplierLoads:[],outQuantity:0,inQuantity:0,bitumenApplies:false,bitumenKg:null,uncountedLoads:0};map.set(key,found);}return found;};
  for(const v of place.loadsOut){
    const m=get(v.itemName,v.unitSymbol);m.loadsOut.push(v);m.outQuantity=round(m.outQuantity+v.quantity);
    if(v.bitumenKg!==null){m.bitumenKg=round((m.bitumenKg??0)+v.bitumenKg);m.bitumenApplies=true;}
    else if(v.bitumenApplies){m.bitumenApplies=true;m.uncountedLoads+=1;}
  }
  for(const v of place.supplierLoads){const m=get(v.itemName,v.unitSymbol);m.supplierLoads.push(v);m.inQuantity=round(m.inQuantity+v.quantity);}
  return [...map.values()].sort((a,b)=>a.itemName.localeCompare(b.itemName)||a.unitSymbol.localeCompare(b.unitSymbol));
}

/** The figures on the Home card: only what exists today. */
export function homeFigures(report:CompanyDailyReport):DayTile[]{return report.tiles.filter(t=>t.key!=='waste');}
