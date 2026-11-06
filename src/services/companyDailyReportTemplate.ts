import {placeMaterials,type CompanyDailyReport,type DayPlace,type DayTile,type PlaceMaterial} from '../domain/companyDailyReport';
import {localTime} from '../domain/companyDailyReport';
import {reportCss} from './pdfTheme';

/**
 * Company Daily Report as an A4 PDF (DEC-520 look). One block per place (projects, company sites, then "No project or site"), inside it
 * one bordered table per material with its own total row, then the place's fuel and waste dumps; last, Totals by material in three
 * separate tables. The first six columns of every record table are the same, so they line up from table to table; the Bitumen used
 * column exists only in asphalt tables. Quantities only: no prices. Anything not recorded is not printed, and fold state on screen never
 * changes it. It only lists records: it changes none.
 */
export type CompanyDailyReportPdf={logo:string|null;report:CompanyDailyReport};

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<span dir="auto">${e(value)}</span>`;
const css=(value:string)=>value.replace(/["\\]/g,'').replace(/\r?\n/g,' ');
const dash=(value:string|null|undefined)=>value&&value.trim()?value.trim():'-';
const number=(value:number)=>(Math.round(value*1000)/1000).toLocaleString('en-US',{maximumFractionDigits:3});
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

// Record tables: Time, Load no., Details, Quantity, Truck, Driver (+ Bitumen used only for asphalt). Same widths everywhere, so columns line up.
const WIDTHS=[9,12,26,13,12,16];const BITUMEN_WIDTH=12;
const colgroupFor=(bitumen:boolean)=>`<colgroup>${WIDTHS.map(width=>`<col style="width:${width}%"/>`).join('')}${bitumen?`<col style="width:${BITUMEN_WIDTH}%"/>`:''}</colgroup>`;
const heading=(bitumen:boolean)=>`<thead><tr><th>Time</th><th>Load no.</th><th>Details</th><th class="num">Quantity</th><th>Truck</th><th>Driver</th>${bitumen?'<th class="num">Bitumen used</th>':''}</tr></thead>`;
const recordTable=(rows:string[][],total:{label:string;quantity:string;bitumen?:string}|null,bitumen:boolean)=>
  `<table class="rec${bitumen?' wide':''}">${colgroupFor(bitumen)}${heading(bitumen)}<tbody>${rows.map(cells=>`<tr>${cells.map((cell,index)=>`<td${index===3||index===6?' class="num nowrap"':''}>${t(cell)}</td>`).join('')}</tr>`).join('')}${total?`<tr class="total-row"><td colspan="3">${t(total.label)}</td><td class="num nowrap">${e(total.quantity)}</td><td colspan="2"></td>${bitumen?`<td class="num nowrap">${e(total.bitumen??'')}</td>`:''}</tr>`:''}</tbody></table>`;

const subHeading=(title:string)=>`<div class="sub-head">${t(title)}</div>`;
const material=(m:PlaceMaterial):string=>{
  const figures=[m.loadsOut.length?`Company loads ${amount(m.outQuantity,m.unitSymbol)} · ${loadsWord(m.loadsOut.length)}`:'',m.supplierLoads.length?`Supplier loads ${amount(m.inQuantity,m.unitSymbol)} · ${loadsWord(m.supplierLoads.length)}`:'',
    m.bitumenApplies?(m.bitumenKg!==null?`Bitumen used ${number(m.bitumenKg)} kg`:'Bitumen not counted'):''].filter(Boolean).join(' · ');
  const name=m.itemName.toLowerCase();
  const out=m.loadsOut.length?recordTable(m.loadsOut.map(l=>[localTime(l.time),dash(l.loadNumber),'Company load',amount(l.quantity,l.unitSymbol),dash(l.truckPlate),dash(l.driverName),...(m.bitumenApplies?[l.bitumenKg!==null?`${number(l.bitumenKg)} kg`:'not counted']:[])]),
    {label:`Total ${name}, company loads`,quantity:amount(m.outQuantity,m.unitSymbol),bitumen:m.bitumenApplies?(m.bitumenKg!==null?`${number(m.bitumenKg)} kg`:'not counted'):undefined},m.bitumenApplies):'';
  const incoming=m.supplierLoads.length?recordTable(m.supplierLoads.map(l=>[localTime(l.time),dash(l.number),`${dash(l.supplierName)}${l.ticket?`, ticket ${l.ticket}`:''}`,amount(l.quantity,l.unitSymbol),dash(l.truckPlate),l.deliveredBy==='supplier'?'Supplier delivering':l.deliveredBy==='company'?'Our driver':'-']),
    {label:`Total ${name}, supplier loads`,quantity:amount(m.inQuantity,m.unitSymbol)},false):'';
  const both=m.loadsOut.length>0&&m.supplierLoads.length>0;
  return `<div class="mat"><div class="mat-head"><span>${t(`${m.itemName} (${m.unitSymbol})`)}</span><span class="mat-figures">${t(figures)}</span></div>${both?subHeading('Company loads'):''}${out}${both?subHeading('Supplier loads'):''}${incoming}</div>`;
};

function fuelBox(place:DayPlace):string{
  if(!place.fills.length)return '';
  const litres=Math.round(place.fills.reduce((sum,f)=>sum+f.litres,0)*1000)/1000;
  const types=[...new Set(place.fills.map(f=>f.fuelType))];
  return `<div class="mat"><div class="mat-head"><span>Fuel given</span><span class="mat-figures">${t(`${types.join(', ')} · ${number(litres)} litres`)}</span></div>${recordTable(place.fills.map(f=>[localTime(f.time),'-',`${f.givenTo} (${f.fuelType})`,`${number(f.litres)} litres`,'-',dash(f.operatorName)]),{label:'Total fuel given',quantity:`${number(litres)} litres`},false)}</div>`;
}
function wasteBox(place:DayPlace):string{
  if(!place.dumps.length)return '';
  const groups=new Map<string,DayPlace['dumps']>();
  for(const d of place.dumps){const key=[d.material,d.area,d.truckPlate,d.driverName].join('\u001f');const list=groups.get(key);if(list)list.push(d);else groups.set(key,[d]);}
  const rows=[...groups.values()].map(list=>{const first=localTime(list[0]!.time),last=localTime(list[list.length-1]!.time);const d=list[0]!;
    return [first===last?first:`${first}-${last}`,'-',[d.material,d.area].filter(Boolean).map(String).join(', ')||'-',`${list.length} trip${list.length===1?'':'s'}`,dash(d.truckPlate),dash(d.driverName)];});
  return `<div class="mat"><div class="mat-head"><span>Waste dumps</span><span class="mat-figures">${t(`${place.dumps.length} trip${place.dumps.length===1?'':'s'}`)}</span></div>${recordTable(rows,{label:'Total waste trips',quantity:`${place.dumps.length} trip${place.dumps.length===1?'':'s'}`},false)}</div>`;
}

const placeKind=(place:DayPlace)=>place.kind==='project'?'Project':place.kind==='site'?'Company site':'Records without a project or site';

function summaryTable(rows:string[][]):string{
  return `<table class="sum"><colgroup><col style="width:46%"/><col style="width:18%"/><col style="width:16%"/><col style="width:20%"/></colgroup><thead><tr><th>Material</th><th>Unit</th><th class="num">Loads</th><th class="num">Amount</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${t(r[0])}</td><td>${t(r[1])}</td><td class="num">${e(r[2])}</td><td class="num">${e(r[3])}</td></tr>`).join('')}</tbody></table>`;
}

export function buildCompanyDailyReportHtml(input:CompanyDailyReportPdf):string{
  const {report}=input;const date=longDay(report.day);const running=`Company Daily Report · ${date}`;
  const tiles=report.tiles.length?`<div class="tiles">${report.tiles.map(tile=>`<div class="tile"><span class="figure-label">${e(tileLabel[tile.key])}</span><b>${e(number(tile.value))}${tile.unit?` ${e(tile.unit)}`:''}</b></div>`).join('')}</div>`:'';
  const contents=report.places.length?`<div class="contents"><h3>Contents</h3><ol>${report.places.map((place,index)=>`<li><span class="contents-index">${index+1}</span><span class="contents-name">${t(place.name)}</span><span class="contents-figures">${e(placeKind(place))}</span></li>`).join('')}<li><span class="contents-index">${report.places.length+1}</span><span class="contents-name">Totals by material</span><span class="contents-figures"></span></li></ol></div>`:'';
  const blocks=report.places.map((place,index)=>`<section class="block"><div class="block-bar"><span class="block-index">${index+1}.</span><span class="block-name">${t(place.name)}</span><span class="block-figures">${e(placeKind(place))}</span></div><div class="block-body">${placeMaterials(place).map(material).join('')}${fuelBox(place)}${wasteBox(place)}</div></section>`).join('');

  const fuelByType=new Map<string,{litres:number;fills:number}>();
  for(const place of report.places)for(const f of place.fills){const row=fuelByType.get(f.fuelType)??{litres:0,fills:0};row.litres+=f.litres;row.fills+=1;fuelByType.set(f.fuelType,row);}
  const company=report.materials.filter(m=>m.outLoads>0).map(m=>[m.itemName,unitWord(m.unitSymbol),String(m.outLoads),number(m.outQuantity)]);
  const supplier=report.materials.filter(m=>m.inLoads>0).map(m=>[m.itemName,unitWord(m.unitSymbol),String(m.inLoads),number(m.inQuantity)]);
  const fuel=[...fuelByType.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([type,v])=>[type,'litres',String(v.fills),number(v.litres)]);
  const box=(title:string,body:string)=>`<div class="mat"><div class="mat-head"><span>${e(title)}</span></div>${body}</div>`;
  const totals=report.places.length?`<section class="block"><div class="block-bar"><span class="block-index">${report.places.length+1}.</span><span class="block-name">Totals by material</span><span class="block-figures">All places · different units are never added together</span></div><div class="block-body">${
    company.length?box('Company loads',summaryTable(company)+(report.bitumenKg!==null?`<table class="sum"><tbody><tr class="total-row"><td style="width:80%">Bitumen used by asphalt loads (loads that could be counted)</td><td class="num">${e(number(report.bitumenKg))} kg</td></tr></tbody></table>`:'')):''}${
    supplier.length?box('Supplier loads',summaryTable(supplier)):''}${fuel.length?box('Fuel given',summaryTable(fuel)):''}</div></section>`:'';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Company Daily Report</title><style>
    @page{size:A4;margin:12mm 11mm 16mm;@bottom-left{content:"${css(running)}";font-size:7.5pt;color:#5A6570}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#5A6570}}
    @media screen{body{max-width:210mm;margin:0 auto;padding:12mm}}
    ${reportCss()}
    h1.title-left{text-align:left;font-size:18pt}
    .mat{border:.3mm solid #9FB0C2;margin:0 0 4mm}
    .mat-head{display:flex;justify-content:space-between;gap:3mm;background:#DBE6F1;color:#173F67;font-weight:700;padding:1.8mm 2.5mm;break-after:avoid}
    .mat-figures{font-weight:400;color:#173F67;text-align:right}
    .sub-head{background:#EAF0F6;font-weight:700;padding:1.2mm 2.5mm;border-top:.2mm solid #9FB0C2;border-bottom:.2mm solid #9FB0C2;break-after:avoid}
    table.rec,table.sum{margin:0;table-layout:fixed}
    table.rec{width:88%}table.rec.wide{width:100%}
    .block-body{padding:3mm 3.5mm 0}
    .empty-day{margin:10mm 0;font-size:11pt;color:#52606D}
  </style></head><body>
    <div class="head"><div>${input.logo?`<img class="logo" src="${input.logo}" alt=""/>`:''}<h1 class="title-left">Company Daily Report</h1></div><div class="head-right"><div class="subtitle">${e(date)}</div><div class="when">Quantities only, no prices</div></div></div>
    ${report.isEmpty?'<p class="empty-day">Nothing was recorded on this day.</p>':`${tiles}${contents}${blocks}${totals}`}
  </body></html>`;
}
