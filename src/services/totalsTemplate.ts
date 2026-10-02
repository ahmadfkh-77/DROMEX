import {buildMaterialTree,treeTotals,unitDifferences,type CompanyTotalsData,type RecordedValue,type UnitMeasures} from '../domain/companyTotals';
import {formatTotalQuantity} from '../domain/projectTotals';
import {formatCents,formatDay,formatRecordedAt,recordMoneyLine,recordReferences,recordTitle} from '../domain/recordFormat';
import type {CompanyTotalsRecord} from '../data/repositories/CompanyTotalsRepository';

/**
 * DEC-487 (1). Company Totals and Project Totals as an A4 PDF, for the filters on screen: each material
 * with Delivered and Used per unit, then by project and supplier, then recorded use. Without prices
 * (the default, as for Daily Reports) no amount appears anywhere; with prices only recorded prices are
 * added and unpriced records are counted. Units are never added together.
 */
export type TotalsPdf={companyName:string;logo:string|null;title:string;scope:'company'|'project';filters:string[];generatedAt:string;includePrices:boolean;data:CompanyTotalsData;
  /** Loads History: every load behind the totals, listed oldest first. Not a billing document. */
  records?:CompanyTotalsRecord[];
  /** "Issued to: …" under the title on the top right: the supplier, or the one customer of company loads. */
  issuedTo?:string|null;
  /** Loads History only: false leaves the Project column out (default shown). */
  showProject?:boolean};

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<span dir="auto">${e(value)}</span>`;
const missing='<span class="missing">Not recorded</span>';
const qty=(measure:{quantity:number}|null,unitSymbol:string)=>measure?e(formatTotalQuantity(measure.quantity,unitSymbol)):missing;
const value=(recorded:RecordedValue)=>recorded.totalCents==null?'<span class="missing">No prices recorded</span>'
  :`${e(formatCents(recorded.totalCents))}${recorded.unpricedCount?`<div class="muted">${recorded.unpricedCount} record${recorded.unpricedCount===1?'':'s'} unpriced</div>`:''}`;
const records=(count:number)=>`${count} record${count===1?'':'s'}`;

function unitRows(units:UnitMeasures[],showUsed:boolean){
  return units.map(unit=>`<tr><td>${e(unit.unitSymbol)}</td><td class="num">${qty(unit.delivered,unit.unitSymbol)}</td>${showUsed?`<td class="num">${qty(unit.used,unit.unitSymbol)}</td>`:''}</tr>`).join('');
}

export function buildTotalsHtml(input:TotalsPdf):string{
  const tree=buildMaterialTree(input.data);
  const whole=treeTotals(tree);
  const showUsed=!input.data.usageHiddenReason;
  const prices=input.includePrices;
  const sections=tree.map(material=>{
    const deliveredRows=material.projects.flatMap(project=>project.suppliers.flatMap(supplier=>supplier.units.map((unit,index)=>`<tr>
      <td>${index===0?t(project.projectName):''}</td><td>${index===0?t(supplier.supplierName):''}</td><td>${e(unit.unitSymbol)}</td>
      <td class="num">${e(formatTotalQuantity(unit.quantity,unit.unitSymbol))}</td><td class="num">${records(unit.recordCount)}</td>${prices?`<td class="num">${index===0?value(supplier.value):''}</td>`:''}</tr>`))).join('');
    const useRows=showUsed?material.projects.flatMap(project=>{
      const lines=project.units.filter(unit=>unit.used||unit.transported);
      const differences=new Map(unitDifferences(project.units).map(line=>[line.unitKey,line.difference]));
      return lines.map((unit,index)=>`<tr><td>${index===0?t(project.projectName):''}</td><td>${e(unit.unitSymbol)}</td>
        <td class="num">${qty(unit.used,unit.unitSymbol)}</td><td class="num">${unit.transported?e(formatTotalQuantity(unit.transported.quantity,unit.unitSymbol)):''}</td>
        <td class="num">${differences.has(unit.unitKey)?e(formatTotalQuantity(differences.get(unit.unitKey)!,unit.unitSymbol)):''}</td></tr>`);
    }).join(''):'';
    return `<section class="material">
      <h2>${t(material.itemName)}</h2>
      <div class="summary keep"><table class="units"><thead><tr><th>Unit</th><th class="num">Delivered</th>${showUsed?'<th class="num">Used</th>':''}</tr></thead><tbody>${unitRows(material.units,showUsed)}</tbody></table>
        <div class="summary-side"><div><span class="label">Records</span><b>${material.inclusion.total}</b></div>${prices?`<div><span class="label">Recorded value</span><b>${value(material.value)}</b></div>`:''}</div></div>
      ${deliveredRows?`<table class="detail"><thead><tr class="caption"><th colspan="${prices?6:5}">${t(material.itemName)} · Delivered, by project and supplier</th></tr>
        <tr><th>Project</th><th>Supplier or source</th><th>Unit</th><th class="num">Delivered</th><th class="num">Records</th>${prices?'<th class="num">Recorded value</th>':''}</tr></thead><tbody>${deliveredRows}</tbody></table>`:''}
      ${useRows?`<table class="detail"><thead><tr class="caption"><th colspan="5">${t(material.itemName)} · Recorded on site (Daily Reports)</th></tr>
        <tr><th>Project</th><th>Unit</th><th class="num">Used</th><th class="num">Transported</th><th class="num">Delivered minus recorded use</th></tr></thead><tbody>${useRows}</tbody></table>`:''}
    </section>`;
  }).join('');
  const showProject=input.showProject!==false;
  const history=input.records?[...input.records].sort((a,b)=>a.snapshot.recordedAt.localeCompare(b.snapshot.recordedAt)||a.snapshot.reference.localeCompare(b.snapshot.reference,undefined,{numeric:true})):null;
  const time=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};
  const day=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value.slice(0,10):`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
  const historyHtml=history?`<h2 class="history-title">Loads history · ${history.length} load${history.length===1?'':'s'}</h2>
    <table class="history"><colgroup><col style="width:13%"/><col style="width:22%"/>${showProject?'<col style="width:19%"/>':''}<col style="width:18%"/><col style="width:${(prices?12:28)+(showProject?0:19)}%"/><col style="width:10%"/>${prices?'<col style="width:16%"/>':''}</colgroup>
    <thead><tr><th>Date and time</th><th>Number and reference</th>${showProject?'<th>Project</th>':''}<th>Supplier or customer</th><th>Item</th><th class="num">Quantity</th>${prices?'<th class="num">Price as recorded</th>':''}</tr></thead>
    <tbody>${history.map(record=>{const s=record.snapshot;return `<tr><td class="nowrap">${e(formatDay(day(s.recordedAt)))}<div class="muted">${e(time(s.recordedAt))}</div></td>
      <td><b>${e(recordTitle(s))}</b><div class="muted">${e(recordReferences(s))}</div></td>${showProject?`<td>${t(s.projectName??'No project')}</td>`:''}
      <td>${t(s.recordType==='company_load'?`Company load · ${s.partyName}`:s.partyName)}</td><td>${t(s.itemName)}</td>
      <td class="num">${e(formatTotalQuantity(s.quantity,s.unitSymbol))}</td>${prices?`<td class="num wrap">${s.unitPriceCents==null?'<span class="missing">No price recorded</span>':e(recordMoneyLine(s))}</td>`:''}</tr>`;}).join('')}</tbody></table>`:'';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(input.title)}</title><style>
    @page{size:A4;margin:13mm 12mm 15mm}
    @media screen{body{max-width:210mm;margin:0 auto;padding:12mm}}
    *{box-sizing:border-box}
    body{font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif;color:#17212B;font-size:9pt;line-height:1.35}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;border-bottom:2px solid #C84B31;padding-bottom:4mm;margin-bottom:3mm}
    .logo{max-width:40mm;max-height:18mm;object-fit:contain;display:block;margin-bottom:1.5mm}
    h1{font-size:18pt;color:#173F67;margin:0;text-align:right}
    .filters{text-align:right;color:#5A6570;font-size:8.5pt;margin-top:1mm}
    .mode{display:inline-block;margin-top:1.5mm;border:1px solid #173F67;color:#173F67;border-radius:3mm;padding:.6mm 2.5mm;font-weight:700;font-size:8pt}
    .overview{color:#4F5B66;margin:0 0 3mm}
    h2{font-size:12.5pt;color:#173F67;margin:6mm 0 2mm;break-after:avoid}
    .summary{display:flex;gap:6mm;align-items:flex-start;background:#F5F2EC;border:1px solid #E3DBCD;border-radius:2.5mm;padding:2.5mm 4mm}
    .summary .units{width:auto;min-width:70mm;margin:0}
    .summary-side{display:flex;gap:6mm}
    .label{display:block;color:#5A6570;font-size:7.5pt;font-weight:700;text-transform:uppercase}
    .summary b{font-size:11pt;font-variant-numeric:tabular-nums}
    table{width:100%;border-collapse:collapse;margin-top:2.5mm}
    thead{display:table-header-group}
    tr,.keep{break-inside:avoid}
    th{text-align:left;color:#173F67;font-size:7.5pt;border-bottom:1.5px solid #173F67;padding:1.3mm}
    td{padding:1.3mm;border-bottom:.3mm solid #E3DBCD;vertical-align:top;overflow-wrap:anywhere}
    .caption th{color:#17212B;font-size:8.5pt;background:#F5F2EC;border-bottom:none}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .muted{color:#5A6570;font-size:7.5pt}.missing{color:#5A6570;font-style:italic}
    .notice{color:#6E4B1F;background:#FFF3D8;border-radius:2mm;padding:2mm 3mm;margin:2mm 0}
    .note{color:#5A6570;font-size:8pt;margin-top:6mm}
    .head-right{text-align:right}
    .when{color:#5A6570;font-size:9pt;margin-top:1mm}
    .subtitle{color:#17212B;font-size:12pt;font-weight:700;margin-top:1mm}
    .meta{display:flex;flex-wrap:wrap;align-items:center;gap:2mm 4mm;color:#4F5B66;margin:0 0 3mm}
    .history-title{margin-top:8mm}
    .history{table-layout:fixed}
    .nowrap{white-space:nowrap}
    .wrap{white-space:normal}
  </style></head><body>
    <div class="head"><div>${input.logo?`<img class="logo" src="${input.logo}" alt=""/>`:''}<b>${t(input.companyName)}</b></div>
      <div class="head-right"><h1>${t(input.title)}</h1>${input.issuedTo?`<div class="subtitle">Issued to: ${t(input.issuedTo)}</div>`:''}<div class="when">${e(formatRecordedAt(input.generatedAt))}</div></div></div>
    <div class="meta">${input.filters.map(t).join(' · ')}</div>
    ${history?'<p class="notice">A record of the loads delivered — not an invoice or bill. It does not change any document status.</p>':''}
    <p class="overview">${whole.materialCount} material${whole.materialCount===1?'':'s'} · ${records(whole.inclusion.total)} delivered${prices&&whole.value.totalCents!=null?` · recorded value ${e(formatCents(whole.value.totalCents))}${whole.value.unpricedCount?` (${records(whole.value.unpricedCount)} unpriced)`:''}`:''}</p>
    ${input.data.usageHiddenReason&&!history?`<p class="notice">${e(input.data.usageHiddenReason)}</p>`:''}
    ${sections||'<p>Nothing recorded for these filters.</p>'}
    ${historyHtml}
    <p class="note">Delivered counts Active Supplier Loads and company loads; Used and Transported come from Daily Reports. Each unit is totalled on its own and different units are never added together. Use is not recorded per supplier. "Delivered minus recorded use" is not an inventory balance.${prices?' Amounts add only records with a recorded price.':''}</p>
  </body></html>`;
}
