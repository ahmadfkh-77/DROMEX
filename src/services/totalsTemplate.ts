import type {CompanyTotalsRecord} from '../data/repositories/CompanyTotalsRepository';
import {buildMaterialTree,treeTotals,unitDifferences,type CompanyTotalsData,type MaterialNode,type RecordedValue,type UnitMeasures} from '../domain/companyTotals';
import {fuelTypeLabels} from '../domain/fuel';
import {formatTotalQuantity,summarizeFuelFills,type ProjectFuelFill} from '../domain/projectTotals';
import {formatCents,formatDay,formatRecordedAt,recordMoneyLine,recordReferences,recordTitle} from '../domain/recordFormat';
import {companyLoadReference,deliveredByLabel,INTERNAL_PROJECT,priceAsRecorded,supplierBox,unitTotals,vatAndTotal,type CustomerBox} from '../domain/projectTotalsPdf';

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
  return `<section class="block">
    <div class="block-bar"><span class="block-index">${index}</span><span class="block-name">${t(material.itemName)}</span><span class="block-figures">${headline(material.units,showUsed)}</span></div>
    <div class="block-body">
      <div class="figures">${figures}
        <div class="figure side"><span class="figure-label">Records</span><b>${material.inclusion.total}</b>${prices?`<span class="figure-label spaced">Recorded value</span><b>${value(material.value)}</b>`:''}</div>
      </div>
      ${deliveredRows?`<h4 class="sub">Delivered — by project and supplier</h4>
      <table class="grid"><colgroup>${(prices?[46,10,18,10,16]:[52,12,22,14]).map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr><th>Project · supplier or source</th><th>Unit</th><th class="num">Delivered</th><th class="num">Records</th>${prices?'<th class="num">Recorded value</th>':''}</tr></thead><tbody>${deliveredRows}</tbody></table>`:''}
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
    ${prices?`<td class="num">${fill.pricePerLitreCents==null?'<span class="missing">No price recorded</span>':`${e(formatCents(fill.pricePerLitreCents))} / L`}</td><td class="num">${fill.costCents==null?'':e(formatCents(fill.costCents))}</td>`:''}</tr>`).join('');
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
  return `<section class="block" data-kind="history">
    <div class="block-bar"><span class="block-index">${index}</span><span class="block-name">Loads history · ${plural(sorted.length,'load')}</span></div>
    <div class="block-body">${loadListTable(sorted,prices,showProject)}</div>
  </section>`;
}

const dateCell=(raw:string)=>`${e(formatDay(localDay(raw)))}<div class="muted">${e(localTime(raw))}</div>`;

/** What the Supplier column reads on the company's own loads (Owner decision, Phase 5). */
const PLANT_COMPANY_LABEL='Plant Company';
/**
 * Phase 5. Column widths of every load list, each set adding up to exactly 100%, so the base columns keep their
 * order and nearly their width with or without prices and a Project column. Order: Date, time | Load No. | Item |
 * Supplier | Customer | Driver | Truck plate | Unit | Quantity, then Project, then the two price columns.
 */
const LOAD_LIST_WIDTHS={plain:[11,10,12,12,12,12,10,6,15],project:[10,9,10,10,10,10,9,5,12],prices:[9,9,10,10,10,10,8,5,9],projectPrices:[8,8,9,9,9,9,8,4,8]};
const notRecordedOr=(raw:string|null|undefined)=>raw?t(raw):missing;

/**
 * Phase 5. One table for every list of loads in a Totals PDF (Loads History, Customer Deliveries, and the company
 * and supplier loads of a Project Totals). Every fact has its own column: no two values share a cell except the
 * date with its time and a load number with its reference. Supplier is "Plant Company" on the company's own
 * loads; Customer on an incoming delivery is the customer of its project. Fixed layout, numbers right-aligned.
 */
function loadListTable(records:CompanyTotalsRecord[],prices:boolean,showProject:boolean):string{
  const base=showProject?(prices?LOAD_LIST_WIDTHS.projectPrices:LOAD_LIST_WIDTHS.project):(prices?LOAD_LIST_WIDTHS.prices:LOAD_LIST_WIDTHS.plain);
  const widths=[...base,...(showProject?[prices?10:15]:[]),...(prices?(showProject?[9,9]:[10,10]):[])];
  const rows=records.map(record=>{
    const s=record.snapshot,d=record.details,company=s.recordType==='company_load';
    const driver=company?d?.driverName:d?.deliveredBy==='supplier'?'Supplier delivering':d?.driverName;
    const number=company
      ?`${s.loadNumber?`<span class="ln">${e(s.loadNumber)}</span>`:`<span class="legacy" title="${e(recordTitle(s))}">Legacy load</span>`}<div class="muted">${e(companyLoadReference(s))}</div>`
      :`<span class="ln">${e(s.reference)}</span>${s.supplierReference?`<div class="muted">Supplier ticket ${e(s.supplierReference)}</div>`:''}`;
    const priceCells=prices?`<td class="num wrap">${s.unitPriceCents==null?'<span class="missing">No price recorded</span>':e(priceAsRecorded(s))}</td><td class="num wrap">${s.totalCents==null?missing:e(vatAndTotal(s))}</td>`:'';
    return `<tr><td class="nowrap">${dateCell(s.recordedAt)}</td><td>${number}</td><td>${t(s.itemName)}</td>
      <td>${company?t(PLANT_COMPANY_LABEL):t(s.partyName)}</td><td>${notRecordedOr(company?s.partyName:d?.customerName)}</td>
      <td>${notRecordedOr(driver)}</td><td>${notRecordedOr(d?.truckPlate)}</td><td>${e(s.unitSymbol)}</td><td class="num">${e(formatTotalQuantity(s.quantity,'').trim())}</td>
      ${showProject?`<td>${s.projectName?t(s.projectName):missing}</td>`:''}${priceCells}</tr>`;
  }).join('');
  const columns=['Date, time','Load No.','Item','Supplier','Customer','Driver','Truck plate','Unit','Quantity'];
  const head=columns.map((column,position)=>`<th${position===8?' class="num"':''}>${e(column)}</th>`).join('')+(showProject?'<th>Project</th>':'')+(prices?'<th class="num">Price as recorded</th><th class="num">VAT · Total</th>':'');
  return `<table class="grid history"><colgroup>${widths.map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
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
  return `<section class="block" data-kind="project-${kind}-loads">
    <div class="block-bar"><span class="block-index">${index}</span><span class="block-name">${e(title)}</span><span class="block-figures">${pills}<span class="pill">${plural(ordered.length,'load')}</span></span></div>
    <div class="block-body">${loadListTable(ordered,prices,false)}</div>
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
  const companyIndex=tree.length+(input.fuel?1:0)+1,supplierIndex=companyIndex+(companyLoads.length?1:0);
  const contents=[...tree.map((material,index)=>`<li><span class="contents-index">${index+1}</span><span class="contents-name">${t(material.itemName)}</span><span class="contents-figures">${headline(material.units,showUsed)}</span></li>`),
    input.fuel?`<li><span class="contents-index">${fuelIndex}</span><span class="contents-name">Fuel used on this project</span><span class="contents-figures">${plural(input.fuel.length,'fill')}</span></li>`:'',
    history?`<li><span class="contents-index">${historyIndex}</span><span class="contents-name">Loads history</span><span class="contents-figures">${plural(history.length,'load')}</span></li>`:'',
    companyLoads.length?`<li><span class="contents-index">${companyIndex}</span><span class="contents-name">Company loads delivered</span><span class="contents-figures">${plural(companyLoads.length,'load')}</span></li>`:'',
    supplierLoads.length?`<li><span class="contents-index">${supplierIndex}</span><span class="contents-name">Supplier loads delivered</span><span class="contents-figures">${plural(supplierLoads.length,'load')}</span></li>`:''].join('');
  const tiles=[`<div class="tile"><span class="figure-label">Materials</span><b>${whole.materialCount}</b></div>`,`<div class="tile"><span class="figure-label">Records delivered</span><b>${whole.inclusion.total}</b></div>`,
    prices?`<div class="tile"><span class="figure-label">Recorded value</span><b>${whole.value.totalCents==null?'<span class="missing">No prices recorded</span>':e(formatCents(whole.value.totalCents))}</b>${whole.value.unpricedCount?`<div class="muted">${plural(whole.value.unpricedCount,'record')} unpriced</div>`:''}</div>`:''].join('');

  // Phase 5. A priced list adds two price columns (and perhaps Project) to nine others: that needs the width of a landscape page.
  const landscape=prices&&Boolean(history||companyLoads.length||supplierLoads.length);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(input.title)}</title><style>
    @page{size:${landscape?'A4 landscape':'A4'};margin:12mm 11mm 14mm}
    @media screen{body{max-width:${landscape?'297mm':'210mm'};margin:0 auto;padding:12mm}}
    *{box-sizing:border-box}
    body{font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif;color:#17212B;font-size:9pt;line-height:1.35}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;border-bottom:2px solid #C84B31;padding-bottom:4mm;margin-bottom:3mm}
    .logo{max-width:40mm;max-height:18mm;object-fit:contain;display:block;margin-bottom:1.5mm}
    h1{font-size:18pt;color:#173F67;margin:0;text-align:right}
    .head-right{text-align:right}
    .subtitle{color:#17212B;font-size:12pt;font-weight:700;margin-top:1mm}
    .when{color:#5A6570;font-size:9pt;margin-top:1mm}
    .meta{color:#4F5B66;margin:0 0 3mm}
    .notice{color:#6E4B1F;background:#FFF3D8;border-radius:2mm;padding:2mm 3mm;margin:0 0 3mm}
    .tiles{display:flex;gap:3mm;margin:0 0 4mm}
    .tile{flex:1;border:1px solid #E3DBCD;border-radius:2.5mm;padding:2.5mm 3.5mm;background:#FFFFFF}
    .tile b{display:block;font-size:13pt;margin-top:.5mm;font-variant-numeric:tabular-nums}
    .contents{border:1px solid #E3DBCD;border-radius:2.5mm;background:#F5F2EC;padding:3mm 4mm;margin:0 0 6mm;break-inside:avoid}
    .contents h3{margin:0 0 2mm;font-size:10pt;color:#173F67}
    .contents ol{list-style:none;margin:0;padding:0}
    .contents li{display:flex;align-items:center;gap:3mm;padding:1.4mm 0;border-top:.3mm solid #E3DBCD}
    .contents li:first-child{border-top:none}
    .contents-index{flex:0 0 6mm;height:6mm;border-radius:1.5mm;background:#173F67;color:#FFFFFF;font-weight:700;font-size:8pt;display:flex;align-items:center;justify-content:center}
    .contents-name{flex:1;font-weight:700}
    .contents-figures{text-align:right}
    .block{border:1px solid #CFC5B3;border-radius:3mm;margin:0 0 7mm;overflow:hidden;background:#FFFFFF}
    .block-bar{display:flex;align-items:center;gap:3mm;background:#173F67;color:#FFF8ED;padding:2.6mm 4mm;break-after:avoid;break-inside:avoid}
    .block-index{flex:0 0 7mm;height:7mm;border-radius:1.6mm;background:#C84B31;color:#FFFFFF;font-weight:700;display:flex;align-items:center;justify-content:center}
    .block-name{flex:1;font-size:12.5pt;font-weight:700}
    .block-figures{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:1.5mm}
    .block-body{padding:3mm 4mm 4mm}
    .pill{display:inline-block;border-radius:5mm;padding:.8mm 2.6mm;font-size:8.5pt;font-weight:700;white-space:nowrap}
    .block-bar .pill{background:rgba(255,255,255,.16);color:#FFF8ED}
    .contents .pill{margin-left:1mm}
    .contents .pill.delivered{background:#EEF3F8;color:#173F67}
    .contents .pill.used{background:#F6F0E6;color:#6E4B1F}
    .figures{display:flex;flex-wrap:wrap;align-items:flex-start;gap:2.5mm;break-inside:avoid;break-after:avoid}
    .figure{display:flex;align-items:center;gap:2mm;border:1px solid #E3DBCD;border-radius:2.5mm;padding:2mm}
    .figure.side{flex-direction:column;justify-content:center;min-width:30mm}
    .figure-unit{align-self:center;min-width:9mm;text-align:center;font-weight:700;color:#173F67;font-size:10pt}
    .figure-cell{border-radius:2mm;padding:1.6mm 3mm;min-width:26mm}
    .figure-cell.delivered{background:#EEF3F8}
    .figure-cell.used{background:#F6F0E6}
    .figure-cell b,.figure.side b{display:block;font-size:11.5pt;font-variant-numeric:tabular-nums}
    .figure-label{display:block;color:#5A6570;font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.3px}
    .figure-cell.delivered .figure-label{color:#173F67}
    .figure-cell.used .figure-label{color:#6E4B1F}
    .spaced{margin-top:1.5mm}
    .sub{font-size:9.5pt;color:#173F67;margin:4.5mm 0 1.5mm;break-after:avoid}
    .lead{margin:0 0 2mm;color:#4F5B66}
    table{width:100%;border-collapse:collapse}
    thead{display:table-header-group}
    tr{break-inside:avoid}
    th{text-align:left;color:#173F67;font-size:7.5pt;border-bottom:1.5px solid #173F67;padding:1.4mm 1.6mm}
    td{padding:1.4mm 1.6mm;border-bottom:.3mm solid #EAE3D7;vertical-align:top;overflow-wrap:anywhere}
    tbody tr:nth-child(even) td{background:#FAF8F4}
    tr.group-row td{background:#F0EBE2;font-weight:700;color:#17212B;border-bottom:.3mm solid #D9CFBE;padding-top:1.8mm}
    td.indent{padding-left:5mm}
    .grid{table-layout:fixed}
    .history td{font-size:8pt}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .nowrap{white-space:nowrap}
    .wrap{white-space:normal}
    .muted{color:#5A6570;font-size:7.5pt;font-weight:400}
    .missing{color:#5A6570;font-style:italic;font-weight:400}
    .empty{margin:0;color:#5A6570;font-style:italic}
    .note{color:#5A6570;font-size:8pt;margin-top:4mm}
    .contact{font-size:8pt;color:#444;margin-top:.5mm;overflow-wrap:anywhere}
    .proj{border:1px solid #E3DBCD;border-radius:2.5mm;background:#F5F2EC;padding:2.5mm 4mm;margin:0 0 3mm;display:flex;gap:6mm;flex-wrap:wrap}
    .proj .figure-label{margin-bottom:.3mm}.proj b{font-size:10.5pt}
    .two{display:flex;gap:4mm;margin:0 0 3mm;break-inside:avoid}.box{flex:1;border:1px solid #CFC5B3;border-radius:2.5mm;padding:2.5mm 4mm;background:#FFFFFF}
    .box-label{display:block;color:#5A6570;font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.3px}.box b{display:block;font-size:11.5pt;color:#173F67;overflow-wrap:anywhere}
    .ln{font-weight:700;color:#173F67;white-space:nowrap}.legacy{color:#5A6570;font-style:italic;font-weight:400}.ok{color:#2F6B3A;font-weight:700;font-size:7.5pt}
  </style></head><body>
    <div class="head"><div>${input.logo?`<img class="logo" src="${input.logo}" alt=""/>`:''}<b>${t(input.companyName)}</b>${input.contactLine?`<div class="contact">${t(input.contactLine)}</div>`:''}</div>
      <div class="head-right"><h1>${t(input.title)}</h1>${input.issuedTo?`<div class="subtitle">Issued to: ${t(input.issuedTo)}</div>`:''}${input.project?`<div class="subtitle">${input.project.customer.label===INTERNAL_PROJECT?t(INTERNAL_PROJECT):`Customer: ${t(input.project.customer.label)}`}</div>`:''}<div class="when">${e(formatRecordedAt(input.generatedAt))}</div></div></div>
    ${input.project?`<div class="proj"><div><span class="figure-label">Project</span><b>${t(input.project.name)}</b></div><div><span class="figure-label">Location</span><b>${input.project.location?t(input.project.location):missing}</b></div><div><span class="figure-label">Status</span><b>${e(input.project.status)}</b></div></div>
    ${customerSupplierBoxes(input.project.customer,input.project.loads.filter(record=>record.status!=='Cancelled'))}`:''}
    <div class="meta">${input.filters.map(t).join(' · ')}</div>
    ${history||input.project?'<p class="notice">A record of the loads delivered — not an invoice or bill. It does not change any record or document status.</p>':''}
    ${input.data.usageHiddenReason&&!history?`<p class="notice">${e(input.data.usageHiddenReason)}</p>`:''}
    <div class="tiles">${tiles}</div>
    ${contents?`<nav class="contents"><h3>Contents</h3><ol>${contents}</ol></nav>`:''}
    ${tree.map((material,index)=>materialBlock(material,index+1,showUsed,prices)).join('')||'<p class="empty">Nothing recorded for these filters.</p>'}
    ${input.fuel?fuelBlock(input.fuel,fuelIndex,prices):''}
    ${history?historyBlock(history,historyIndex,prices,showProject):''}
    ${companyLoads.length?projectLoadsBlock('company',companyLoads,companyIndex,prices):''}
    ${supplierLoads.length?projectLoadsBlock('supplier',supplierLoads,supplierIndex,prices):''}
    <p class="note">Delivered counts Active Supplier Loads and company loads; Used and Transported come from Daily Reports. Each unit is totalled on its own and different units are never added together. Use is not recorded per supplier. "Delivered minus recorded use" is not an inventory balance.${prices?' Amounts add only records with a recorded price.':''}</p>
  </body></html>`;
}
