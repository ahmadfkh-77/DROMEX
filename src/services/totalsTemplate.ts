import type {CompanyTotalsRecord} from '../data/repositories/CompanyTotalsRepository';
import {buildMaterialTree,treeTotals,unitDifferences,type CompanyTotalsData,type MaterialNode,type RecordedValue,type UnitMeasures} from '../domain/companyTotals';
import {formatFuelPriceUsd,fuelPriceFromStored,fuelTypeLabels} from '../domain/fuel';
import {breakAfterHyphens,colgroup,columnWidths,type ColumnSpec} from './pdfColumns';
import {reportCss} from './pdfTheme';
import {formatTotalQuantity,summarizeFuelFills,type ProjectFuelFill} from '../domain/projectTotals';
import {formatCents,formatDay,formatRecordedAt,recordMoneyLine,recordReferences,recordTitle} from '../domain/recordFormat';
import {companyLoadReference,deliveredByLabel,INTERNAL_PROJECT,priceAsRecorded,supplierBox,supplierNameOf,unitTotals,vatAndTotal,type CustomerBox} from '../domain/projectTotalsPdf';

/**
 * DEC-500 (1), DEC-501, DEC-502. Company Totals, Project Totals and Loads History as an A4 PDF.
 *
 * Layout: a contents list, then every material in its own numbered block -- a navy title bar carrying
 * its name and headline totals, tinted Delivered and Used figures per unit, suppliers grouped under
 * their project, striped rows -- then optional Fuel and Loads History blocks. Without prices no amount
 * appears; with prices only recorded prices are added and unpriced records are counted. Units, and
 * diesel and gasoline, are never added together.
 */
export type TotalsPdf={companyName:string;logo:string|null;title:string;scope:'company'|'project';filters:string[];generatedAt:string;includePrices:boolean;data:CompanyTotalsData;
  /** Loads History: every load behind the totals, listed oldest first. Not a billing document. */
  records?:CompanyTotalsRecord[];
  /** "Issued to: …" under the title on the top right: the supplier, or the one customer of company loads. */
  issuedTo?:string|null;
  /** Company Totals (summary level): every Active load behind the totals, listed after the materials. Cancelled loads are left out. */
  loads?:CompanyTotalsRecord[];
  /** Company Totals with exactly one customer chosen: printed in bold under the title (the title is then "Totals"). */
  customerName?:string|null;
  /** Loads History only: false leaves the Project column out (default shown). */
  showProject?:boolean;
  /** Project Totals only: the project's equipment fills; omitted means fuel is left out. */
  fuel?:ProjectFuelFill[];
  /** Company Settings address, phone, email and Tax/VAT, joined with a middle dot, under the company name. */
  contactLine?:string|null;
  /** Project Totals top level: the project, its customer box, and every Active load behind the totals (company and supplier kept apart). */
  project?:{name:string;location:string|null;status:string;customer:CustomerBox;loads:CompanyTotalsRecord[]}};

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<span dir="auto">${e(value)}</span>`;
const css=(value:string)=>value.replace(/["\\]/g,'').replace(/\r?\n/g,' ');
const missing='<span class="missing">Not recorded</span>';
const qty=(measure:{quantity:number}|null,unitSymbol:string)=>measure?e(formatTotalQuantity(measure.quantity,unitSymbol)):missing;
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
const value=(recorded:RecordedValue)=>recorded.totalCents==null?'<span class="missing">No prices recorded</span>'
  :`${e(formatCents(recorded.totalCents))}${recorded.unpricedCount?`<div class="muted">${plural(recorded.unpricedCount,'record')} unpriced</div>`:''}`;
const two=(number:number)=>String(number).padStart(2,'0');
const localDay=(raw:string)=>{const date=new Date(raw);return Number.isNaN(date.getTime())?raw.slice(0,10):`${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}`;};
const localTime=(raw:string)=>{const date=new Date(raw);return Number.isNaN(date.getTime())?'':`${two(date.getHours())}:${two(date.getMinutes())}`;};

/** "Delivered 12 m³ · 16 t" and "Used 9 m³" -- each unit on its own, never one combined figure. */
function headline(units:UnitMeasures[],showUsed:boolean):string{
  const delivered=units.filter(unit=>unit.delivered).map(unit=>formatTotalQuantity(unit.delivered!.quantity,unit.unitSymbol));
  const used=showUsed?units.filter(unit=>unit.used).map(unit=>formatTotalQuantity(unit.used!.quantity,unit.unitSymbol)):[];
  return [delivered.length?`<span class="pill delivered">Delivered ${e(delivered.join(' · '))}</span>`:'',used.length?`<span class="pill used">Used ${e(used.join(' · '))}</span>`:''].join('');
}

function materialBlock(material:MaterialNode,index:number,showUsed:boolean,prices:boolean):string{
  const figures=material.units.map(unit=>`<div class="figure">
      <div class="figure-unit">${e(unit.unitSymbol)}</div>
      <div class="figure-cell delivered"><span class="figure-label">Delivered</span><b>${qty(unit.delivered,unit.unitSymbol)}</b></div>
      ${showUsed?`<div class="figure-cell used"><span class="figure-label">Used</span><b>${qty(unit.used,unit.unitSymbol)}</b></div>`:''}
    </div>`).join('');
  const columns=prices?5:4;
  const deliveredRows=material.projects.filter(project=>project.suppliers.length).map(project=>`<tr class="group-row"><td colspan="${columns}">${t(project.projectName)}</td></tr>`+
    project.suppliers.flatMap(supplier=>supplier.units.map((unit,position)=>`<tr><td class="indent">${position===0?t(supplier.supplierName):''}</td><td>${e(unit.unitSymbol)}</td>
      <td class="num">${e(formatTotalQuantity(unit.quantity,unit.unitSymbol))}</td><td class="num">${plural(unit.recordCount,'record')}</td>${prices?`<td class="num">${position===0?value(supplier.value):''}</td>`:''}</tr>`)).join('')).join('');
  const useRows=showUsed?material.projects.flatMap(project=>{
    const lines=project.units.filter(unit=>unit.used||unit.transported);
    const differences=new Map(unitDifferences(project.units).map(line=>[line.unitKey,line.difference]));
    return lines.map((unit,position)=>`<tr><td>${position===0?t(project.projectName):''}</td><td>${e(unit.unitSymbol)}</td>
      <td class="num">${qty(unit.used,unit.unitSymbol)}</td><td class="num">${unit.transported?e(formatTotalQuantity(unit.transported.quantity,unit.unitSymbol)):''}</td>
      <td class="num">${differences.has(unit.unitKey)?e(formatTotalQuantity(differences.get(unit.unitKey)!,unit.unitSymbol)):''}</td></tr>`);
  }).join(''):'';
  const deliveredTotals=material.units.filter(unit=>unit.delivered).map((unit,position)=>`<tr class="total-row"><td>Total</td><td>${e(unit.unitSymbol)}</td><td class="num">${e(formatTotalQuantity(unit.delivered!.quantity,unit.unitSymbol))}</td><td class="num">${plural(unit.delivered!.recordCount,'record')}</td>${prices?`<td class="num">${position===0?value(material.value):''}</td>`:''}</tr>`).join('');
  return `<section class="block">
    <div class="block-bar"><span class="block-index">${index}</span><span class="block-name">${t(material.itemName)}</span><span class="block-figures">${headline(material.units,showUsed)}</span></div>
    <div class="block-body">
      <div class="figures">${figures}
        <div class="figure side"><span class="figure-label">Records</span><b>${material.inclusion.total}</b>${prices?`<span class="figure-label spaced">Recorded value</span><b>${value(material.value)}</b>`:''}</div>
      </div>
      ${deliveredRows?`<h4 class="sub">Delivered — by project and supplier</h4>
      <table class="grid"><colgroup>${(prices?[46,10,18,10,16]:[52,12,22,14]).map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr><th>Project · supplier or source</th><th>Unit</th><th class="num">Delivered</th><th class="num">Records</th>${prices?'<th class="num">Recorded value</th>':''}</tr></thead><tbody>${deliveredRows}${deliveredTotals}</tbody></table>`:''}
      ${useRows?`<h4 class="sub">Recorded on site — Daily Reports</h4>
      <table class="grid"><colgroup><col style="width:34%"/><col style="width:10%"/><col style="width:18%"/><col style="width:18%"/><col style="width:20%"/></colgroup><thead><tr><th>Project</th><th>Unit</th><th class="num">Used</th><th class="num">Transported</th><th class="num">Delivered minus recorded use</th></tr></thead><tbody>${useRows}</tbody></table>`:''}
    </div>
  </section>`;
}

function fuelBlock(fills:ProjectFuelFill[],index:number,prices:boolean):string{
  const summary=summarizeFuelFills(fills);
  if(!fills.length)return `<section class="block" data-kind="fuel"><div class="block-bar"><span class="block-index">${index}</span><span class="block-name">Fuel used on this project</span></div>
    <div class="block-body"><p class="empty">No fuel fills recorded for this project in this period.</p></div></section>`;
  const bar=summary.types.map(type=>`<span class="pill">${e(fuelTypeLabels[type.fuelType])} ${e(formatTotalQuantity(type.litres,'L'))}</span>`).join('');
  const equipmentRows=summary.types.map(type=>`<tr class="group-row"><td colspan="3">${e(fuelTypeLabels[type.fuelType])} · ${e(formatTotalQuantity(type.litres,'L'))} · ${plural(type.recordCount,'fill')}</td></tr>`+
    type.equipment.map(item=>`<tr><td class="indent">${t(item.equipmentName)}</td><td class="num">${e(formatTotalQuantity(item.litres,'L'))}</td><td class="num">${plural(item.recordCount,'fill')}</td></tr>`).join('')).join('');
  const fillRows=fills.map(fill=>`<tr><td class="nowrap">${e(formatDay(localDay(fill.confirmedAt)))}<div class="muted">${e(localTime(fill.confirmedAt))}</div></td><td>${t(fill.equipmentName)}</td>
    <td>${e(fuelTypeLabels[fill.fuelType])}</td><td class="num">${e(formatTotalQuantity(fill.litres,'L'))}</td>
    ${prices?`<td class="num">${fill.pricePerLitreCents==null?'<span class="missing">No price recorded</span>':`${e(formatFuelPriceUsd(fuelPriceFromStored(fill.pricePerLitreCents)))} / L`}</td><td class="num">${fill.costCents==null?'':e(formatCents(fill.costCents))}</td>`:''}</tr>`).join('');
  return `<section class="block" data-kind="fuel">
    <div class="block-bar"><span class="block-index">${index}</span><span class="block-name">Fuel used on this project</span><span class="block-figures">${bar}</span></div>
    <div class="block-body">
      <p class="lead">Equipment fills recorded to this project. Each fuel type is totalled on its own; diesel and gasoline are never added together.${prices?` Fuel cost of priced fills: <b>${summary.cost.totalCents==null?'No prices recorded':e(formatCents(summary.cost.totalCents))}</b>${summary.cost.unpricedCount?` (${plural(summary.cost.unpricedCount,'fill')} unpriced)`:''}.`:''}</p>
      <h4 class="sub">By fuel type and equipment</h4>
      <table class="grid"><colgroup><col style="width:60%"/><col style="width:22%"/><col style="width:18%"/></colgroup><thead><tr><th>Fuel type · equipment</th><th class="num">Litres</th><th class="num">Fills</th></tr></thead><tbody>${equipmentRows}</tbody></table>
      <h4 class="sub">Every fill</h4>
      <table class="grid"><colgroup>${(prices?[14,30,12,14,16,14]:[18,40,16,26]).map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr><th>Date and time</th><th>Equipment</th><th>Fuel</th><th class="num">Litres</th>${prices?'<th class="num">Price</th><th class="num">Cost</th>':''}</tr></thead><tbody>${fillRows}</tbody></table>
    </div>
  </section>`;
}

function historyBlock(records:CompanyTotalsRecord[],index:number,prices:boolean,showProject:boolean):string{
  const sorted=[...records].sort((a,b)=>a.snapshot.recordedAt.localeCompare(b.snapshot.recordedAt)||a.snapshot.reference.localeCompare(b.snapshot.reference,undefined,{numeric:true}));
  const bar=`<div class="block-bar"><span class="block-index">${index}</span><span class="block-name">Loads history · ${plural(sorted.length,'load')}</span></div>`;
  return `<section class="block table-block" data-kind="history">
    <div class="block-body">${loadListTable(sorted,prices,showProject,bar)}</div>
  </section>`;
}

const dateCell=(raw:string)=>`${e(formatDay(localDay(raw)))}<div class="muted">${e(localTime(raw))}</div>`;
const notRecordedOr=(raw:string|null|undefined)=>raw?t(raw):missing;

/**
 * One table for every list of loads in a Totals PDF (Loads History, Customer Deliveries, and the company and supplier
 * loads of a Project Totals). Every fact has its own column; the quantity is printed with its unit ("27 M³") so the
 * number and its unit are never apart. Supplier is the Plant Company's real name on the company's own loads and the outside
 * supplier on an incoming one; Customer on an incoming delivery is the customer of its project. The widths come from the
 * content (see pdfColumns.ts): every column has room for its longest word and a load number breaks after a hyphen, so
 * nothing runs into the next column. Numbers are right-aligned.
 */
function loadListTable(records:CompanyTotalsRecord[],prices:boolean,showProject:boolean,bar:string|null=null):string{
  const quantityOf=(s:CompanyTotalsRecord['snapshot'])=>`${formatTotalQuantity(s.quantity,'').trim()} ${s.unitSymbol}`.trim();
  const lines=records.map(record=>{
    const s=record.snapshot,d=record.details,company=s.recordType==='company_load';
    const driver=company?d?.driverName:d?.deliveredBy==='supplier'?'Supplier delivering':d?.driverName;
    const number=company?(s.loadNumber??'Legacy load'):s.reference;
    return {record,s,d,company,driver,number,quantity:quantityOf(s)};
  });
  const rows=lines.map(({record,s,d,company,driver,number,quantity})=>{
    const numberCell=company
      ?`${s.loadNumber?`<span class="ln">${breakAfterHyphens(e(s.loadNumber))}</span>`:`<span class="legacy" title="${e(recordTitle(s))}">Legacy load</span>`}<div class="muted">${breakAfterHyphens(e(companyLoadReference(s)))}</div>`
      :`<span class="ln">${breakAfterHyphens(e(s.reference))}</span>${s.supplierReference?`<div class="muted">Supplier ticket ${e(s.supplierReference)}</div>`:''}`;
    const priceCells=prices?`<td class="num wrap">${s.unitPriceCents==null?'<span class="missing">No price recorded</span>':e(priceAsRecorded(s))}</td><td class="num wrap">${s.totalCents==null?missing:e(vatAndTotal(s))}</td>`:'';
    void record;void number;
    return `<tr><td>${dateCell(s.recordedAt)}</td><td>${numberCell}</td><td>${t(s.itemName)}</td>
      <td>${notRecordedOr(supplierNameOf({snapshot:s,details:d}))}</td><td>${notRecordedOr(company?s.partyName:d?.customerName)}</td>
      <td>${notRecordedOr(driver)}</td><td>${notRecordedOr(d?.truckPlate)}</td><td class="num">${e(quantity)}</td>
      ${showProject?`<td>${s.projectName?t(s.projectName):missing}</td>`:''}${priceCells}</tr>`;
  }).join('');
  const NR='Not recorded';
  const specs:ColumnSpec[]=[
    {header:'Date, time',cells:lines.map(line=>formatDay(localDay(line.s.recordedAt)))},
    {header:'Load No.',kind:'code',cells:lines.flatMap(line=>line.company?[line.s.loadNumber??'Legacy load',companyLoadReference(line.s)]:[line.s.reference,...(line.s.supplierReference?[`Supplier ticket ${line.s.supplierReference}`]:[])])},
    {header:'Item',cells:lines.map(line=>line.s.itemName)},
    {header:'Supplier',cells:lines.map(line=>supplierNameOf({snapshot:line.s,details:line.d})??NR)},
    {header:'Customer',cells:lines.map(line=>(line.company?line.s.partyName:line.d?.customerName)??NR)},
    {header:'Driver',cells:lines.map(line=>line.driver??NR)},
    {header:'Truck plate',cells:lines.map(line=>line.d?.truckPlate??NR)},
    {header:'Quantity',kind:'number',cells:lines.map(line=>line.quantity)},
    ...(showProject?[{header:'Project',cells:lines.map(line=>line.s.projectName??NR)} as ColumnSpec]:[]),
    ...(prices?[{header:'Price as recorded',kind:'amount',cells:lines.map(line=>line.s.unitPriceCents==null?'No price recorded':priceAsRecorded(line.s))} as ColumnSpec,{header:'VAT · Total',kind:'amount',cells:lines.map(line=>line.s.totalCents==null?NR:vatAndTotal(line.s))} as ColumnSpec]:[]),
  ];
  // Ten or more columns (a Project column with prices) use a smaller type so every word still fits its column on A4.
  const dense=specs.length>=10;
  const widths=columnWidths(specs,dense?{fontPt:7,headerPt:6.5}:{});
  const head=specs.map(spec=>`<th${spec.header==='Quantity'?' class="num"':(prices&&(spec.header==='Price as recorded'||spec.header==='VAT · Total'))?' class="num wrap"':''}>${e(spec.header)}</th>`).join('');
  // The quantity is the eighth column. The total row sums each unit on its own; units are never added together.
  const rest=(showProject?1:0)+(prices?2:0);
  const totalRow=lines.length?`<tr class="total-row"><td colspan="7">Total · ${plural(lines.length,'load')}</td><td class="num">${unitTotals(records).map(unit=>e(formatTotalQuantity(unit.quantity,unit.unitSymbol))).join('<br/>')}</td>${rest?`<td colspan="${rest}"></td>`:''}</tr>`:'';
  return `<table class="grid history${dense?' dense':''}">${colgroup(widths)}<thead>${bar?`<tr class="bar-row"><th colspan="${specs.length}">${bar}</th></tr>`:''}<tr>${head}</tr></thead><tbody>${rows}${totalRow}</tbody></table>`;
}

/**
 * Project Totals: every Active load behind the totals, listed per load. Company loads (delivered to
 * the customer) and Supplier Loads (incoming) are separate sections with their own labels and their
 * own per-unit totals; units are never added together. Cancelled loads are not listed. Both sections use the
 * same columns as every other load list. Price and VAT columns exist only on a priced export. Empty sections are left out.
 */
function projectLoadsBlock(kind:'company'|'supplier',records:CompanyTotalsRecord[],index:number,prices:boolean):string{
  const ordered=[...records].sort((a,b)=>a.snapshot.recordedAt.localeCompare(b.snapshot.recordedAt)||a.snapshot.reference.localeCompare(b.snapshot.reference,undefined,{numeric:true}));
  const pills=unitTotals(ordered).map(unit=>`<span class="pill">${e(formatTotalQuantity(unit.quantity,unit.unitSymbol))}</span>`).join('');
  const title=kind==='company'?'Company loads delivered · own deliveries':'Supplier loads delivered · incoming from suppliers';
  const bar=`<div class="block-bar"><span class="block-index">${index}</span><span class="block-name">${e(title)}</span><span class="block-figures">${pills}<span class="pill">${plural(ordered.length,'load')}</span></span></div>`;
  return `<section class="block table-block" data-kind="project-${kind}-loads">
    <div class="block-body">${loadListTable(ordered,prices,false,bar)}</div>
  </section>`;
}

/** Company Totals: every Active load behind the totals, in the same table as every other load list. */
function loadsDeliveredBlock(records:CompanyTotalsRecord[],index:number,prices:boolean,showProject:boolean):string{
  const ordered=[...records].sort((a,b)=>a.snapshot.recordedAt.localeCompare(b.snapshot.recordedAt)||a.snapshot.reference.localeCompare(b.snapshot.reference,undefined,{numeric:true}));
  const bar=`<div class="block-bar"><span class="block-index">${index}</span><span class="block-name">Loads delivered · ${plural(ordered.length,'load')}</span></div>`;
  return `<section class="block table-block" data-kind="loads-delivered">
    <div class="block-body">${loadListTable(ordered,prices,showProject,bar)}</div>
  </section>`;
}

/** The two boxes under the header: the project's customer, and its supplier(s) in the period. */
function customerSupplierBoxes(customer:CustomerBox,loads:CompanyTotalsRecord[]):string{
  const supplier=supplierBox(loads);
  return `<div class="two"><div class="box"><span class="box-label">Customer</span><b>${t(customer.label)}</b>${customer.note?`<div class="muted">${e(customer.note)}</div>`:''}</div>
    <div class="box"><span class="box-label">Supplier</span><b>${t(supplier.label)}</b>${supplier.names.length?`<div class="muted">${supplier.names.map(t).join(' · ')}</div>`:''}</div></div>`;
}

export function buildTotalsHtml(input:TotalsPdf):string{
  const tree=buildMaterialTree(input.data);
  const whole=treeTotals(tree);
  const showUsed=!input.data.usageHiddenReason;
  const prices=input.includePrices;
  const showProject=input.showProject!==false;
  const history=input.records??null;
  const fuelIndex=tree.length+1;
  const historyIndex=tree.length+(input.fuel?1:0)+1;
  // Cancelled loads are never listed (Owner decision); the totals already exclude them.
  const projectLoads=(input.project?.loads??[]).filter(record=>record.status!=='Cancelled');
  const companyLoads=projectLoads.filter(record=>record.snapshot.recordType==='company_load'),supplierLoads=projectLoads.filter(record=>record.snapshot.recordType==='supplier_load');
  const summaryLoads=(input.loads??[]).filter(record=>record.status!=='Cancelled');
  const summaryIndex=tree.length+(input.fuel?1:0)+1;
  const companyIndex=tree.length+(input.fuel?1:0)+1,supplierIndex=companyIndex+(companyLoads.length?1:0);
  const contents=[...tree.map((material,index)=>`<li><span class="contents-index">${index+1}</span><span class="contents-name">${t(material.itemName)}</span><span class="contents-figures">${headline(material.units,showUsed)}</span></li>`),
    input.fuel?`<li><span class="contents-index">${fuelIndex}</span><span class="contents-name">Fuel used on this project</span><span class="contents-figures">${plural(input.fuel.length,'fill')}</span></li>`:'',
    history?`<li><span class="contents-index">${historyIndex}</span><span class="contents-name">Loads history</span><span class="contents-figures">${plural(history.length,'load')}</span></li>`:'',
    summaryLoads.length?`<li><span class="contents-index">${summaryIndex}</span><span class="contents-name">Loads delivered</span><span class="contents-figures">${plural(summaryLoads.length,'load')}</span></li>`:'',
    companyLoads.length?`<li><span class="contents-index">${companyIndex}</span><span class="contents-name">Company loads delivered</span><span class="contents-figures">${plural(companyLoads.length,'load')}</span></li>`:'',
    supplierLoads.length?`<li><span class="contents-index">${supplierIndex}</span><span class="contents-name">Supplier loads delivered</span><span class="contents-figures">${plural(supplierLoads.length,'load')}</span></li>`:''].join('');
  const tiles=[`<div class="tile"><span class="figure-label">Materials</span><b>${whole.materialCount}</b></div>`,`<div class="tile"><span class="figure-label">Records delivered</span><b>${whole.inclusion.total}</b></div>`,
    prices?`<div class="tile"><span class="figure-label">Recorded value</span><b>${whole.value.totalCents==null?'<span class="missing">No prices recorded</span>':e(formatCents(whole.value.totalCents))}</b>${whole.value.unpricedCount?`<div class="muted">${plural(whole.value.unpricedCount,'record')} unpriced</div>`:''}</div>`:''].join('');

  // Phase 5. A priced list adds two price columns (and perhaps Project) to nine others: that needs the width of a landscape page.
  const landscape=prices&&Boolean(history||summaryLoads.length||companyLoads.length||supplierLoads.length);
  const running=`${input.companyName} · ${input.title}${input.customerName?` · ${input.customerName}`:''}${input.issuedTo?` · ${input.issuedTo}`:''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(input.title)}</title><style>
    @page{size:${landscape?'A4 landscape':'A4'};margin:12mm 11mm 16mm;@bottom-left{content:"${css(running)}";font-size:7.5pt;color:#5A6570}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#5A6570}}
    ${reportCss()}
    @media screen{body{max-width:${landscape?'297mm':'210mm'};margin:0 auto;padding:12mm}}
    .grid{table-layout:fixed}
    .history td{font-size:8pt}.history.dense td{font-size:7pt}.history.dense th{font-size:6.5pt}
    .proj{border:.35mm solid #9FB0C2;background:#FFFFFF;padding:2.5mm 3.5mm;margin:0 0 3mm;display:flex;gap:6mm;flex-wrap:wrap}
    .proj .figure-label{margin-bottom:.3mm}.proj b{font-size:10.5pt;color:#173F67}
    .two{display:flex;gap:4mm;margin:0 0 3mm;break-inside:avoid}.box{flex:1;border:.35mm solid #9FB0C2;padding:2.5mm 3.5mm;background:#FFFFFF}
    .box-label{display:block;color:#52606D;font-size:6.8pt;font-weight:700;text-transform:uppercase;letter-spacing:.7px}.box b{display:block;font-size:11.5pt;color:#173F67;overflow-wrap:anywhere}
    .ln{font-weight:700;color:#173F67}.legacy{color:#52606D;font-style:italic;font-weight:400}.ok{color:#2F6B3A;font-weight:700;font-size:7.5pt}
  </style></head><body>
    <div class="head"><div>${input.logo?`<img class="logo" src="${input.logo}" alt=""/>`:''}<b>${t(input.companyName)}</b>${input.contactLine?`<div class="contact">${t(input.contactLine)}</div>`:''}</div>
      <div class="head-right"><h1>${t(input.title)}</h1>${input.issuedTo?`<div class="subtitle">Issued to: ${t(input.issuedTo)}</div>`:''}${input.customerName?`<div class="subtitle">${t(input.customerName)}</div>`:''}${input.project?`<div class="subtitle">${input.project.customer.label===INTERNAL_PROJECT?t(INTERNAL_PROJECT):`Customer: ${t(input.project.customer.label)}`}</div>`:''}<div class="when">${e(formatRecordedAt(input.generatedAt))}</div></div></div>
    ${input.project?`<div class="proj"><div><span class="figure-label">Project</span><b>${t(input.project.name)}</b></div><div><span class="figure-label">Location</span><b>${input.project.location?t(input.project.location):missing}</b></div><div><span class="figure-label">Status</span><b>${e(input.project.status)}</b></div></div>
    ${customerSupplierBoxes(input.project.customer,input.project.loads.filter(record=>record.status!=='Cancelled'))}`:''}
    <div class="meta">${input.filters.map(t).join(' · ')}</div>
    ${input.data.usageHiddenReason&&!history?`<p class="note-plain">${e(input.data.usageHiddenReason)}</p>`:''}
    <div class="tiles">${tiles}</div>
    ${contents?`<nav class="contents"><h3>Contents</h3><ol>${contents}</ol></nav>`:''}
    ${tree.map((material,index)=>materialBlock(material,index+1,showUsed,prices)).join('')||'<p class="empty">Nothing recorded for these filters.</p>'}
    ${input.fuel?fuelBlock(input.fuel,fuelIndex,prices):''}
    ${history?historyBlock(history,historyIndex,prices,showProject):''}
    ${summaryLoads.length?loadsDeliveredBlock(summaryLoads,summaryIndex,prices,showProject):''}
    ${companyLoads.length?projectLoadsBlock('company',companyLoads,companyIndex,prices):''}
    ${supplierLoads.length?projectLoadsBlock('supplier',supplierLoads,supplierIndex,prices):''}
    <div class="notes"><h4>Notes</h4><ol><li>Delivered counts Active Supplier Loads and company loads; Used and Transported come from Daily Reports. Each unit is totalled on its own and different units are never added together.</li><li>Use is not recorded per supplier. "Delivered minus recorded use" is not an inventory balance.</li>${prices?'<li>Amounts add only records with a recorded price.</li>':''}</ol></div>
  </body></html>`;
}
