import type {AttendanceRow,AttendanceSheet} from '../domain/attendance';
import {equipmentTypeLabel,placeMaterials,sumAmounts,supplierLoadDriver,localTime,type ArrivalGroup,type CompanyDailyReport,type DayPlace,type DayTile,type PlaceMaterial} from '../domain/companyDailyReport';
import {reportCss} from './pdfTheme';

/**
 * Company Daily Report as an A4 PDF (DEC-520 look). One block per place (projects, company sites, then "No project or site"), inside it
 * one bordered table per material with its own total row, then the place's fuel and waste dumps, then the project's Contract target when
 * its switch is on; last, Totals by material in separate tables. The first six columns of every record table are the same, so they line up
 * from table to table; the Bitumen used column exists only in asphalt tables. Quantities only unless the Prices switch is on: then Price
 * and Amount columns appear only in tables where a price was recorded, "Unpriced" is never shown as 0, and company loads (sales), supplier
 * loads (purchases) and fuel (cost) are never added into one total. Anything not recorded is not printed, and fold state on screen never
 * changes it. It only lists records: it changes none.
 */
export type CompanyDailyReportPdf={logo:string|null;report:CompanyDailyReport;/** Off unless the Prices switch is on. */prices?:boolean;/** The Attendance sheet switch: off unless true here (the screen default is on). */attendance?:boolean};

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<span dir="auto">${e(value)}</span>`;
const css=(value:string)=>value.replace(/["\\]/g,'').replace(/\r?\n/g,' ');
const dash=(value:string|null|undefined)=>value&&value.trim()?value.trim():'-';
const number=(value:number)=>(Math.round(value*1000)/1000).toLocaleString('en-US',{maximumFractionDigits:3});
const money=(cents:number)=>`$${(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const unitWord=(symbol:string)=>symbol==='t'?'tons':symbol==='L'?'litres':symbol;
const amount=(value:number,symbol:string)=>`${number(value)} ${unitWord(symbol)}`;
const loadsWord=(count:number)=>`${count} load${count===1?'':'s'}`;
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function longDay(day:string):string{
  const [year=0,month=1,date=1]=day.split('-').map(Number);const when=new Date(year,month-1,date);
  return `${WEEKDAYS[when.getDay()]} ${date} ${MONTHS[month-1]} ${year}`;
}
const tileLabel:Record<DayTile['key'],string>={loadsOut:'Company loads',supplierLoads:'Supplier loads',fuel:'Fuel given',waste:'Waste trips'};

type Priced={priceBasis?:'per_unit'|'whole'|null;unitPriceCents?:number|null;amountCents?:number|null};
/** The price cell: a per-unit price, "As a whole", or Unpriced (never $0.00). */
const priceCell=(r:Priced)=>r.amountCents==null?'Unpriced':r.priceBasis==='whole'?'As a whole':r.unitPriceCents!=null?money(r.unitPriceCents):'Unpriced';
const amountCell=(r:Priced)=>r.amountCents==null?'Unpriced':money(r.amountCents);
const anyPriced=(list:readonly Priced[])=>list.some(r=>r.amountCents!=null);
const totalCell=(list:readonly Priced[])=>{const s=sumAmounts(list);return `${s.priced?money(s.cents):''}${s.unpriced?`${s.priced?' · ':''}${s.unpriced} unpriced`:''}`;};

// Record tables: Time, Load no., Details, Quantity, Truck, Driver (+ Bitumen used only for asphalt, + Price and Amount only where a price was recorded).
// The first five columns have the same widths in every table (so Time, Load no., Details, Quantity and Truck line up from table to table); the Driver column
// takes whatever width is left, so every table fills the whole width of its box. The extra columns (Bitumen used, Price, Amount) are taken from Driver's share.
const FIRST_FIVE=[9,12,26,13,12];const FIRST_FIVE_PRICES=[8,12,17,11,9];const BITUMEN=12;const BITUMEN_PRICED=10;const PRICE=10;
type TableOptions={bitumen:boolean;priced:boolean;/** True when the whole document shows prices, so every table uses the narrower first columns and they still line up. */prices?:boolean};
const widthsFor=({bitumen,priced,prices}:TableOptions)=>{
  const first=prices||priced?FIRST_FIVE_PRICES:FIRST_FIVE;const extras=[...(bitumen?[prices||priced?BITUMEN_PRICED:BITUMEN]:[]),...(priced?[PRICE,PRICE]:[])];
  return [...first,100-first.reduce((a,b)=>a+b,0)-extras.reduce((a,b)=>a+b,0),...extras];
};
const heading=({bitumen,priced}:TableOptions)=>`<thead><tr><th>Time</th><th>Load no.</th><th>Details</th><th class="num">Quantity</th><th>Truck</th><th>Driver</th>${bitumen?'<th class="num">Bitumen used</th>':''}${priced?'<th class="num">Price</th><th class="num">Amount</th>':''}</tr></thead>`;
/** `rows` are the cells of the six shared columns, then Bitumen used (asphalt only), then Price and Amount (priced tables only). */
const recordTable=(rows:string[][],total:{label:string;quantity:string;bitumen?:string;amount?:string}|null,options:TableOptions)=>{
  const widths=widthsFor(options);const numeric=new Set([3,...(options.bitumen?[6]:[]),...(options.priced?[widths.length-2,widths.length-1]:[])]);
  return `<table class="rec"><colgroup>${widths.map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup>${heading(options)}<tbody>${rows.map(cells=>`<tr>${cells.map((cell,index)=>`<td${numeric.has(index)?' class="num nowrap"':''}>${t(cell)}</td>`).join('')}</tr>`).join('')}${total?`<tr class="total-row"><td colspan="3">${t(total.label)}</td><td class="num nowrap">${e(total.quantity)}</td><td colspan="2"></td>${options.bitumen?`<td class="num nowrap">${e(total.bitumen??'')}</td>`:''}${options.priced?`<td></td><td class="num">${e(total.amount??'').split(' · ').join('<br/>')}</td>`:''}</tr>`:''}</tbody></table>`;
};

const subHeading=(title:string)=>`<div class="sub-head">${t(title)}</div>`;
const material=(m:PlaceMaterial,prices:boolean):string=>{
  const figures=[m.loadsOut.length?`Company loads ${amount(m.outQuantity,m.unitSymbol)} · ${loadsWord(m.loadsOut.length)}`:'',m.supplierLoads.length?`Supplier loads ${amount(m.inQuantity,m.unitSymbol)} · ${loadsWord(m.supplierLoads.length)}`:'',
    m.bitumenApplies?(m.bitumenKg!==null?`Bitumen used ${number(m.bitumenKg)} kg`:'Bitumen not counted'):''].filter(Boolean).join(' · ');
  const name=m.itemName.toLowerCase();
  const outPriced=prices&&anyPriced(m.loadsOut),inPriced=prices&&anyPriced(m.supplierLoads);
  const out=m.loadsOut.length?recordTable(m.loadsOut.map(l=>[localTime(l.time),dash(l.loadNumber),'Company load',amount(l.quantity,l.unitSymbol),dash(l.truckPlate),dash(l.driverName),...(m.bitumenApplies?[l.bitumenKg!==null?`${number(l.bitumenKg)} kg`:'not counted']:[]),...(outPriced?[priceCell(l),amountCell(l)]:[])]),
    {label:`Total ${name}, company loads`,quantity:amount(m.outQuantity,m.unitSymbol),bitumen:m.bitumenApplies?(m.bitumenKg!==null?`${number(m.bitumenKg)} kg`:'not counted'):undefined,amount:outPriced?totalCell(m.loadsOut):undefined},{bitumen:m.bitumenApplies,priced:outPriced,prices}):'';
  const incoming=m.supplierLoads.length?recordTable(m.supplierLoads.map(l=>[localTime(l.time),dash(l.number),`${dash(l.supplierName)}${l.ticket?`, ticket ${l.ticket}`:''}`,amount(l.quantity,l.unitSymbol),dash(l.truckPlate),supplierLoadDriver(l),...(inPriced?[priceCell(l),amountCell(l)]:[])]),
    {label:`Total ${name}, supplier loads`,quantity:amount(m.inQuantity,m.unitSymbol),amount:inPriced?totalCell(m.supplierLoads):undefined},{bitumen:false,priced:inPriced,prices}):'';
  const both=m.loadsOut.length>0&&m.supplierLoads.length>0;
  return `<div class="mat"><div class="mat-head"><span>${t(`${m.itemName} (${m.unitSymbol})`)}</span><span class="mat-figures">${t(figures)}</span></div>${both?subHeading('Company loads'):''}${out}${both?subHeading('Supplier loads'):''}${incoming}</div>`;
};

function contractBox(place:DayPlace,day:string):string{
  if(!place.contract||!place.contract.included)return '';
  const rows=place.contract.rows.map(r=>`<tr><td>${t(r.name)}</td><td class="num">${e(amount(r.quantity,r.unitSymbol))}</td><td class="num">${e(amount(r.usedBefore,r.unitSymbol))}</td><td class="num">${e(amount(r.usedToday,r.unitSymbol))}</td><td class="num">${e(number(r.percentUsed))}%${r.overBy>0?` (over by ${e(amount(r.overBy,r.unitSymbol))})`:''}</td><td class="num">${e(amount(r.left,r.unitSymbol))}</td></tr>`).join('');
  return `<div class="mat"><div class="mat-head"><span>Contract target</span><span class="mat-figures">as of ${e(longDay(day))}</span></div><table class="sum"><colgroup><col style="width:22%"/><col style="width:15%"/><col style="width:16%"/><col style="width:14%"/><col style="width:13%"/><col style="width:20%"/></colgroup><thead><tr><th>Item</th><th class="num">Contract quantity</th><th class="num">Used before today</th><th class="num">Used today</th><th class="num">% used</th><th class="num">Left</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function fuelBox(place:DayPlace,prices:boolean):string{
  if(!place.fills.length)return '';
  const litres=Math.round(place.fills.reduce((sum,f)=>sum+f.litres,0)*1000)/1000;
  const types=[...new Set(place.fills.map(f=>f.fuelType))];const priced=prices&&anyPriced(place.fills);
  // The same structure as the Daily Report's Fuel used table: each fill says which truck or machine got it, and what kind it is.
  const widths=priced?[9,26,13,14,12,13,13]:[10,34,18,18,20];
  const head=['Time','Equipment','Truck or machine','Fuel type','Litres',...(priced?['Price','Amount']:[])];
  const numeric=new Set([4,...(priced?[5,6]:[])]);
  const body=place.fills.map(f=>[localTime(f.time),f.givenTo,equipmentTypeLabel(f.equipmentType),f.fuelType,`${number(f.litres)} litres`,...(priced?[priceCell(f),amountCell(f)]:[])]);
  const total=`<tr class="total-row"><td colspan="4">Total fuel given</td><td class="num nowrap">${e(`${number(litres)} litres`)}</td>${priced?`<td></td><td class="num">${e(totalCell(place.fills).split(' · ').join('<br/>'))}</td>`:''}</tr>`;
  return `<div class="mat"><div class="mat-head"><span>Fuel given</span><span class="mat-figures">${t(`${types.join(', ')} · ${number(litres)} litres`)}</span></div><table class="sum"><colgroup>${widths.map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr>${head.map((h,i)=>`<th${numeric.has(i)?' class="num"':''}>${e(h)}</th>`).join('')}</tr></thead><tbody>${body.map(cells=>`<tr>${cells.map((cell,i)=>`<td${numeric.has(i)?' class="num nowrap"':''}>${t(cell)}</td>`).join('')}</tr>`).join('')}${total}</tbody></table></div>`;
}
function wasteBox(place:DayPlace,prices:boolean):string{
  if(!place.dumps.length)return '';
  const groups=new Map<string,DayPlace['dumps']>();
  for(const d of place.dumps){const key=[d.material,d.area,d.truckPlate,d.driverName].join('\u001f');const list=groups.get(key);if(list)list.push(d);else groups.set(key,[d]);}
  const rows=[...groups.values()].map(list=>{const first=localTime(list[0]!.time),last=localTime(list[list.length-1]!.time);const d=list[0]!;
    return [first===last?first:`${first}-${last}`,'-',[d.material,d.area].filter(Boolean).map(String).join(', ')||'-',`${list.length} trip${list.length===1?'':'s'}`,dash(d.truckPlate),dash(d.driverName)];});
  return `<div class="mat"><div class="mat-head"><span>Waste dumps</span><span class="mat-figures">${t(`${place.dumps.length} trip${place.dumps.length===1?'':'s'}`)}</span></div>${recordTable(rows,{label:'Total waste trips',quantity:`${place.dumps.length} trip${place.dumps.length===1?'':'s'}`},{bitumen:false,priced:false,prices})}</div>`;
}
/** Prices on: the recorded value of the place, one line per kind. Sales, purchases and fuel cost are never added into one number. */
function valueBox(place:DayPlace):string{
  const lines=[['Company loads value',place.loadsOut],['Supplier loads value',place.supplierLoads],['Fuel cost',place.fills]] as const;
  const shown=lines.filter(([,list])=>anyPriced(list));
  if(!shown.length)return '';
  return `<div class="mat"><div class="mat-head"><span>Recorded value of this place</span><span class="mat-figures">US dollars · kinds are never added together</span></div><table class="sum"><colgroup><col style="width:70%"/><col style="width:30%"/></colgroup><tbody>${shown.map(([label,list])=>`<tr><td>${e(label)}</td><td class="num">${e(totalCell(list))}</td></tr>`).join('')}</tbody></table></div>`;
}

const placeKind=(place:DayPlace)=>place.kind==='project'?(place.contract?`Project · contract target ${place.contract.included?'included':'not included'}`:'Project'):place.kind==='site'?'Company site':'Records without a project or site';

function summaryTable(rows:string[][],valueHeading?:string):string{
  const widths=valueHeading?[34,14,12,18,22]:[46,18,16,20];
  return `<table class="sum"><colgroup>${widths.map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr><th>Material</th><th>Unit</th><th class="num">Loads</th><th class="num">Amount</th>${valueHeading?`<th class="num">${e(valueHeading)}</th>`:''}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((cell,i)=>`<td${i>=2?' class="num"':''}>${i<2?t(cell):e(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/** Arrived today: deliveries into company stock, one table per kind with its own total row. Never tied to a project. */
const noun=(kind:string,count:number)=>kind==='stock'?(count===1?'receipt':'receipts'):(count===1?'delivery':'deliveries');
function arrivalsBlock(groups:ArrivalGroup[],index:number,prices:boolean):string{
  const table=(group:ArrivalGroup)=>{
    const priced=prices&&anyPriced(group.rows);const third=group.kind==='fuel'?'Ticket':group.kind==='bitumen'?'Grade':'Item';const second=group.kind==='stock'?'Supplier':'Supplier';
    const widths=priced?[9,25,18,18,15,15]:[10,30,22,38];
    const head=group.kind==='stock'?['Time','Item','Supplier','Quantity']:['Time',second,third,'Quantity'];
    const cells=(row:ArrivalGroup['rows'][number])=>group.kind==='stock'?[localTime(row.time),row.material,dash(row.supplierName),amount(row.quantity,row.unitSymbol)]:[localTime(row.time),dash(row.supplierName),dash(row.detail),amount(row.quantity,row.unitSymbol)];
    const totalRows=group.totals.map(total=>`<tr class="total-row"><td colspan="3">${t(`Total ${total.material.toLowerCase()} ${group.kind==='stock'?'received':'arrived'}${group.totals.length>1?` (${unitWord(total.unitSymbol)})`:''}`)}</td><td class="num nowrap">${e(amount(total.quantity,total.unitSymbol))}</td>${priced?`<td></td><td class="num">${e(totalCell(group.rows.filter(r=>r.material===total.material&&r.unitSymbol===total.unitSymbol)).split(' · ').join('<br/>'))}</td>`:''}</tr>`).join('');
    const body=group.rows.map(row=>`<tr>${cells(row).map((cell,i)=>`<td${i===3?' class="num nowrap"':''}>${t(cell)}</td>`).join('')}${priced?`<td class="num nowrap">${e(priceCell(row))}</td><td class="num nowrap">${e(amountCell(row))}</td>`:''}</tr>`).join('');
    const figures=group.totals.map(total=>amount(total.quantity,total.unitSymbol)).join(' · ');
    return `<div class="mat"><div class="mat-head"><span>${e(group.title)}</span><span class="mat-figures">${t(`${group.rows.length} ${noun(group.kind,group.rows.length)} · ${figures}`)}</span></div><table class="sum"><colgroup>${widths.map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr>${head.map((h,i)=>`<th${i===3?' class="num"':''}>${e(h)}</th>`).join('')}${priced?'<th class="num">Price</th><th class="num">Amount</th>':''}</tr></thead><tbody>${body}${totalRows}</tbody></table></div>`;
  };
  return `<section class="block"><div class="block-bar"><span class="block-index">${index}.</span><span class="block-name">Arrived today</span><span class="block-figures">Company stock · not tied to a project</span></div><div class="block-body">${groups.map(table).join('')}</div></section>`;
}

/** Issues and Daily Reports of the day: a list only, with photos and notes counted, never printed. */
function issuesBlock(report:CompanyDailyReport,index:number):string{
  const issues=report.issues.length?`<div class="mat"><div class="mat-head"><span>Issues</span><span class="mat-figures">${t(`${report.issues.length} issue${report.issues.length===1?'':'s'} · ${report.issues.filter(i=>i.status==='Open').length} open`)}</span></div><table class="sum"><colgroup><col style="width:10%"/><col style="width:22%"/><col style="width:44%"/><col style="width:12%"/><col style="width:12%"/></colgroup><thead><tr><th>Time</th><th>Project</th><th>Issue</th><th>Priority</th><th>Status</th></tr></thead><tbody>${report.issues.map(i=>`<tr><td>${e(localTime(i.time))}</td><td>${t(i.projectName)}</td><td>${t(i.title)}</td><td>${t(i.priority)}</td><td>${e(i.status)}</td></tr>`).join('')}</tbody></table></div>`:'';
  const photos=report.dailyReports.reduce((sum,r)=>sum+r.photos,0);
  const reports=report.dailyReports.length?`<div class="mat"><div class="mat-head"><span>Daily Reports</span><span class="mat-figures">${t(`${report.dailyReports.length} report${report.dailyReports.length===1?'':'s'} · ${photos} photo${photos===1?'':'s'}`)}</span></div><table class="sum"><colgroup><col style="width:52%"/><col style="width:24%"/><col style="width:24%"/></colgroup><thead><tr><th>Project</th><th class="num">Photos</th><th class="num">Notes</th></tr></thead><tbody>${report.dailyReports.map(r=>`<tr><td>${t(r.projectName)}</td><td class="num">${r.photos}</td><td class="num">${r.notes}</td></tr>`).join('')}</tbody></table></div>`:'';
  return `<section class="block"><div class="block-bar"><span class="block-index">${index}.</span><span class="block-name">Issues and Daily Reports</span><span class="block-figures">Counts only: photos and long notes are not printed</span></div><div class="block-body">${issues}${reports}</div></section>`;
}

/** The Attendance sheet (DEC-544): People, Trucks and Machines that worked, each with every place. Presence and places only. */
function attendanceBlock(sheet:AttendanceSheet,index:number):string{
  const table=(title:string,first:string,second:string,rows:AttendanceRow[])=>rows.length?`<div class="mat"><div class="mat-head"><span>${e(title)}</span><span class="mat-figures">${rows.length}</span></div><table class="sum"><colgroup><col style="width:30%"/><col style="width:22%"/><col style="width:48%"/></colgroup><thead><tr><th>${e(first)}</th><th>${e(second)}</th><th>Worked at</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${t(r.name)}</td><td>${t(dash(r.detail))}</td><td>${t(r.workedAt)}</td></tr>`).join('')}</tbody></table></div>`:'';
  return `<section class="block"><div class="block-bar"><span class="block-index">${index}.</span><span class="block-name">Attendance sheet</span><span class="block-figures">Only people and equipment that worked today</span></div><div class="block-body">${table('People','Name','Role',sheet.people)}${table('Trucks','Truck','Type',sheet.trucks)}${table('Machines','Machine','Type',sheet.machines)}</div></section>`;
}

export function buildCompanyDailyReportHtml(input:CompanyDailyReportPdf):string{
  const {report}=input;const prices=input.prices===true;const sheet=input.attendance===true&&report.attendance&&report.attendance.count>0?report.attendance:null;const empty=report.isEmpty&&!sheet;const date=longDay(report.day);const running=`Company Daily Report · ${date}`;
  const tiles=report.tiles.length?`<div class="tiles">${report.tiles.map(tile=>`<div class="tile"><span class="figure-label">${e(tileLabel[tile.key])}</span><b>${e(number(tile.value))}${tile.unit?` ${e(tile.unit)}`:''}</b></div>`).join('')}</div>`:'';
  const blocks=report.places.map((place,index)=>`<section class="block"><div class="block-bar"><span class="block-index">${index+1}.</span><span class="block-name">${t(place.name)}</span><span class="block-figures">${e(placeKind(place))}</span></div><div class="block-body">${placeMaterials(place).map(m=>material(m,prices)).join('')}${fuelBox(place,prices)}${wasteBox(place,prices)}${prices?valueBox(place):''}${contractBox(place,report.day)}</div></section>`).join('');

  const allOut=report.places.flatMap(p=>p.loadsOut),allIn=report.places.flatMap(p=>p.supplierLoads),allFills=report.places.flatMap(p=>p.fills);
  const fuelByType=new Map<string,{litres:number;fills:typeof allFills}>();
  for(const f of allFills){const row=fuelByType.get(f.fuelType)??{litres:0,fills:[]};row.litres+=f.litres;row.fills.push(f);fuelByType.set(f.fuelType,row);}
  const valueOf=(list:readonly Priced[])=>prices&&anyPriced(list)?totalCell(list):prices?'-':undefined;
  const company=report.materials.filter(m=>m.outLoads>0).map(m=>{const mine=allOut.filter(l=>l.itemName===m.itemName&&l.unitSymbol===m.unitSymbol);return [m.itemName,unitWord(m.unitSymbol),String(m.outLoads),number(m.outQuantity),...(prices?[valueOf(mine)!]:[])];});
  const supplier=report.materials.filter(m=>m.inLoads>0).map(m=>{const mine=allIn.filter(l=>l.itemName===m.itemName&&l.unitSymbol===m.unitSymbol);return [m.itemName,unitWord(m.unitSymbol),String(m.inLoads),number(m.inQuantity),...(prices?[valueOf(mine)!]:[])];});
  const fuel=[...fuelByType.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([type,v])=>[type,'litres',String(v.fills.length),number(v.litres),...(prices?[valueOf(v.fills)!]:[])]);
  const fuelArrivedRows=report.arrivals.filter(g=>g.kind==='fuel').flatMap(g=>g.totals.map(total=>[total.material,'litres',String(total.count),number(total.quantity),...(prices?[valueOf(g.rows.filter(r=>r.material===total.material))!]:[])]));
  const hasTotals=Boolean(company.length||supplier.length||fuel.length||fuelArrivedRows.length);
  let next=report.places.length;const totalsIdx=hasTotals?++next:0;const arrivedIdx=report.arrivals.length?++next:0;const issuesIdx=report.issues.length||report.dailyReports.length?++next:0;const attendIdx=sheet?++next:0;
  const box=(title:string,body:string)=>`<div class="mat"><div class="mat-head"><span>${e(title)}</span></div>${body}</div>`;
  const heading2=prices?'Value (USD)':undefined;
  const totals=hasTotals?`<section class="block"><div class="block-bar"><span class="block-index">${totalsIdx}.</span><span class="block-name">Totals by material</span><span class="block-figures">All places · different units are never added together</span></div><div class="block-body">${
    company.length?box('Company loads',summaryTable(company,heading2)+(report.bitumenKg!==null?`<table class="sum"><tbody><tr class="total-row"><td style="width:80%">Bitumen used by asphalt loads (loads that could be counted)</td><td class="num">${e(number(report.bitumenKg))} kg</td></tr></tbody></table>`:'')):''}${
    supplier.length?box('Supplier loads',summaryTable(supplier,heading2)):''}${fuel.length?box('Fuel given',summaryTable(fuel,heading2)):''}${fuelArrivedRows.length?box('Fuel arrived',summaryTable(fuelArrivedRows,heading2)):''}</div></section>`:'';
  const names=[...report.places.map(place=>[place.name,placeKind(place)]),...(hasTotals?[['Totals by material','']]:[]),...(arrivedIdx?[['Arrived today','']]:[]),...(issuesIdx?[['Issues and Daily Reports','']]:[]),...(sheet?[['Attendance sheet','']]:[])] as string[][];
  const contents=names.length?`<div class="contents"><h3>Contents</h3><ol>${names.map(([name,kind],index)=>`<li><span class="contents-index">${index+1}</span><span class="contents-name">${t(name)}</span><span class="contents-figures">${e(kind)}</span></li>`).join('')}</ol></div>`:'';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Company Daily Report</title><style>
    @page{size:A4;margin:12mm 11mm 16mm;@bottom-left{content:"${css(running)}";font-size:7.5pt;color:#5A6570}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#5A6570}}
    @media screen{body{max-width:210mm;margin:0 auto;padding:12mm}}
    ${reportCss()}
    h1.title-left{text-align:left;font-size:18pt}
    .mat{border:.3mm solid #9FB0C2;margin:0 0 4mm}
    .mat-head{display:flex;justify-content:space-between;gap:3mm;background:#DBE6F1;color:#173F67;font-weight:700;padding:1.8mm 2.5mm;break-after:avoid}
    .mat-figures{font-weight:400;color:#173F67;text-align:right}
    .sub-head{background:#EAF0F6;font-weight:700;padding:1.2mm 2.5mm;border-top:.2mm solid #9FB0C2;border-bottom:.2mm solid #9FB0C2;break-after:avoid}
    table.rec,table.sum{margin:0;table-layout:fixed;width:100%}
    .block-body{padding:3mm 3.5mm 0}
    .empty-day{margin:10mm 0;font-size:11pt;color:#52606D}
  </style></head><body>
    <div class="head"><div>${input.logo?`<img class="logo" src="${input.logo}" alt=""/>`:''}<h1 class="title-left">Company Daily Report</h1></div><div class="head-right"><div class="subtitle">${e(date)}</div><div class="when">${prices?'Prices included':'Quantities only, no prices'}</div></div></div>
    ${empty?'<p class="empty-day">Nothing was recorded on this day.</p>':`${tiles}${contents}${blocks}${totals}${arrivedIdx?arrivalsBlock(report.arrivals,arrivedIdx,prices):''}${issuesIdx?issuesBlock(report,issuesIdx):''}${sheet?attendanceBlock(sheet,attendIdx):''}`}
  </body></html>`;
}
