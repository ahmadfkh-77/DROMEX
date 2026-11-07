import type {WorkbookRow} from '../domain/businessReports';
import {localTime,sumAmounts,type CompanyDailyReport,type DayPlace} from '../domain/companyDailyReport';
import type {SheetSpec} from './businessWorkbook';

/**
 * Company Daily Report as Excel sheets: the same facts as the PDF. "Summary" (date, key figures, totals by material and unit), one sheet per
 * place that has records, and a Data Dictionary. Quantities are real numbers with the unit in its own column, so a sheet can be summed; units
 * are never added together. Anything not recorded has no row, no sheet and no zero. Cancelled records are never in it. Read-only.
 */
const round3=(value:number)=>Math.round(value*1000)/1000;
const SHEET_MAX=31;
const tileMaterial:Record<string,{label:string;unit:string}>={loadsOut:{label:'Company loads',unit:'loads'},supplierLoads:{label:'Supplier loads',unit:'loads'},fuel:{label:'Fuel given',unit:'litres'},waste:{label:'Waste trips',unit:'trips'}};

/** A legal, unique Excel sheet name: no \ / ? * [ ] :, at most 31 characters, never repeated (case-insensitive). */
export function sheetName(wanted:string,taken:Set<string>):string{
  const clean=wanted.replace(/[\\/?*[\]:]/g,' ').replace(/\s+/g,' ').trim()||'Place';
  let name=clean.slice(0,SHEET_MAX).trim();let n=2;
  while(taken.has(name.toLowerCase())){const suffix=` (${n++})`;name=`${clean.slice(0,SHEET_MAX-suffix.length).trim()}${suffix}`;}
  taken.add(name.toLowerCase());return name;
}

const dollars=(cents:number|null|undefined)=>cents==null?null:Math.round(cents)/100;
const priceColumns=(r:{priceBasis?:'per_unit'|'whole'|null;unitPriceCents?:number|null;amountCents?:number|null}):WorkbookRow=>({'Unit Price USD':r.amountCents==null||r.priceBasis==='whole'?null:dollars(r.unitPriceCents),'Price Basis':r.amountCents==null?null:r.priceBasis==='whole'?'As a whole':'Per unit','Amount USD':dollars(r.amountCents)});
const placeRows=(day:string,place:DayPlace,prices:boolean):WorkbookRow[]=>{
  const base=(id:string,type:string,time:string)=>({'Record ID':id,'Record Type':type,Date:day,Time:localTime(time)});
  return [
    ...place.loadsOut.map((l):WorkbookRow=>({...base(l.id,'Company load',l.time),'Load No.':l.loadNumber,Material:l.itemName,Unit:l.unitSymbol,Quantity:round3(l.quantity),Details:null,Truck:l.truckPlate,Driver:l.driverName,'Delivered By':null,Ticket:null,'Bitumen Used kg':l.bitumenKg,...(prices?priceColumns(l):{})})),
    ...place.supplierLoads.map((l):WorkbookRow=>({...base(l.id,'Supplier load',l.time),'Load No.':l.number,Material:l.itemName,Unit:l.unitSymbol,Quantity:round3(l.quantity),Details:l.supplierName,Truck:l.truckPlate,Driver:null,'Delivered By':l.deliveredBy==='supplier'?'Supplier delivering':l.deliveredBy==='company'?'Our driver':null,Ticket:l.ticket,'Bitumen Used kg':null,...(prices?priceColumns(l):{})})),
    ...place.fills.map((f):WorkbookRow=>({...base(f.id,'Fuel given',f.time),'Load No.':null,Material:f.fuelType,Unit:'litres',Quantity:round3(f.litres),Details:f.givenTo,Truck:null,Driver:f.operatorName,'Delivered By':null,Ticket:null,'Bitumen Used kg':null,...(prices?priceColumns(f):{})})),
    ...place.dumps.map((d):WorkbookRow=>({...base(d.id,'Waste dump',d.time),'Load No.':null,Material:d.material,Unit:'trip',Quantity:1,Details:d.area,Truck:d.truckPlate,Driver:d.driverName,'Delivered By':null,Ticket:null,'Bitumen Used kg':null,...(prices?{'Unit Price USD':null,'Price Basis':null,'Amount USD':null}:{})})),
  ];
};

export function companyDailyReportSheets(report:CompanyDailyReport,options:{prices?:boolean;attendance?:boolean}={}):SheetSpec[]{
  const prices=options.prices===true;
  const summary:WorkbookRow[]=[];
  const row=(section:string,material:string,unit:string,records:number|null,amount:number,bitumen:number|null=null,list?:readonly {amountCents?:number|null}[]):WorkbookRow=>{
    const base:WorkbookRow={Date:report.day,Section:section,Material:material,Unit:unit,Records:records,Amount:round3(amount),'Bitumen Used kg':bitumen};
    if(prices&&list){const sum=sumAmounts(list);base['Value USD']=sum.priced?dollars(sum.cents):null;base['Unpriced Records']=sum.unpriced;}
    return base;
  };
  const allOut=report.places.flatMap(p=>p.loadsOut),allIn=report.places.flatMap(p=>p.supplierLoads);
  for(const tile of report.tiles){const info=tileMaterial[tile.key]!;summary.push(row('Key figure',info.label,info.unit==='litres'?'litres':info.unit,null,tile.value));}
  for(const m of report.materials.filter(v=>v.outLoads>0))summary.push(row('Company loads',m.itemName,m.unitSymbol,m.outLoads,m.outQuantity,m.bitumenKg,allOut.filter(l=>l.itemName===m.itemName&&l.unitSymbol===m.unitSymbol)));
  for(const m of report.materials.filter(v=>v.inLoads>0))summary.push(row('Supplier loads',m.itemName,m.unitSymbol,m.inLoads,m.inQuantity,null,allIn.filter(l=>l.itemName===m.itemName&&l.unitSymbol===m.unitSymbol)));
  const fuel=new Map<string,{litres:number;fills:DayPlace['fills']}>();
  for(const place of report.places)for(const f of place.fills){const v=fuel.get(f.fuelType)??{litres:0,fills:[]};v.litres+=f.litres;v.fills.push(f);fuel.set(f.fuelType,v);}
  for(const [type,v] of [...fuel.entries()].sort((a,b)=>a[0].localeCompare(b[0])))summary.push(row('Fuel given',type,'litres',v.fills.length,v.litres,null,v.fills));

  const taken=new Set<string>(['summary','data dictionary','contract target','attendance']);
  const sheets:SheetSpec[]=[{name:'Summary',rows:summary}];
  for(const place of report.places)sheets.push({name:sheetName(place.name,taken),rows:placeRows(report.day,place,prices)});
  const sheet=options.attendance===true?report.attendance:undefined;
  if(sheet&&sheet.count>0){
    const group=(name:string,rows:typeof sheet.people)=>rows.flatMap(r=>r.places.map((p):WorkbookRow=>({Date:report.day,Group:name,'Record ID':r.id,Name:r.name,Role:r.detail,'Place Type':p.type==='project'?'Project':p.type==='company_site'?'Company site':'Typed place',Place:p.name})));
    sheets.push({name:'Attendance',rows:[...group('People',sheet.people),...group('Trucks',sheet.trucks),...group('Machines',sheet.machines)]});
  }
  const contract:WorkbookRow[]=report.places.filter(p=>p.contract?.included).flatMap(p=>p.contract!.rows.map((r):WorkbookRow=>({Project:p.name,Item:r.name,Unit:r.unitSymbol,'Contract Quantity':round3(r.quantity),'Used Before Today':round3(r.usedBefore),'Used Today':round3(r.usedToday),Used:round3(r.used),'Percent Used':r.percentUsed,Left:round3(r.left),'Over By':r.overBy>0?round3(r.overBy):null})));
  if(contract.length)sheets.push({name:'Contract target',rows:contract});
  const dictionary:WorkbookRow[]=[
    {Sheet:'Contract target',Column:'Used Before Today / Used Today / Percent Used / Left',Meaning:'Only for projects whose Contract target switch was ON. The figures of Contract Quantities as of the end of the day: loads linked to the target in its own unit plus reasoned adjustments; other units are never converted.'},
    {Sheet:'Summary',Column:'Section',Meaning:'Key figure, Company loads, Supplier loads or Fuel given. Different units are never added together: each material and unit has its own row.'},
    {Sheet:'Summary',Column:'Records / Amount',Meaning:'How many records, and their total quantity in the Unit column.'},
    {Sheet:'Place sheets',Column:'Record Type',Meaning:'Company load, Supplier load, Fuel given or Waste dump. Cancelled records are not included.'},
    {Sheet:'Place sheets',Column:'Quantity / Unit',Meaning:'A real number and its unit (tons, m³, litres, or one trip per waste dump), so the column can be summed per unit.'},
    {Sheet:'Place sheets',Column:'Bitumen Used kg',Meaning:'Only for asphalt company loads, from the bitumen rule. Empty means not applicable, or it could not be worked out or is not fully covered by a batch; it is never zero.'},
    {Sheet:'Place sheets',Column:'Delivered By',Meaning:'For supplier loads: Supplier delivering, or Our driver.'},
    {Sheet:'Place sheets',Column:'Unit Price USD / Price Basis / Amount USD',Meaning:'Only when Prices was on. As the record kept it, before VAT. Empty means Unpriced, never zero. An as-a-whole price has no unit price.'},
    {Sheet:'Summary',Column:'Value USD / Unpriced Records',Meaning:'Only when Prices was on. Company loads (sales), Supplier loads (purchases) and Fuel given (cost) are separate rows and are never added together; unpriced records are counted, not valued.'},
    {Sheet:'Attendance',Column:'Group / Name / Role / Place',Meaning:'Only when the Attendance sheet switch was on: who worked that day and where, one row per place. Presence and places only: no hours, no pay.'},
    {Sheet:'All sheets',Column:'Record ID',Meaning:'The stable identifier of the record in DROMEX.'},
  ];
  sheets.push({name:'Data Dictionary',rows:dictionary});
  return sheets;
}
