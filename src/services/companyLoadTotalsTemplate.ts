import type {CompanyTotalsRecord} from '../data/repositories/CompanyTotalsRepository';
import {LEGACY_SERIES_KEY,type CompanyLoadGroupNode,type UnitQuantity} from '../domain/companyTotals';
import {formatTotalQuantity} from '../domain/projectTotals';
import {formatDay,formatRecordedAt,recordTitle} from '../domain/recordFormat';

/**
 * DEC-500 (6). Company Load Totals as an A4 PDF: the filters it covers, then each series (or item) with
 * its load count and per-unit totals, its projects, and every load. Cancelled loads are listed under
 * their own heading and never added to a total. Table headings repeat on every page.
 */
export type CompanyLoadTotalsPdf={companyName:string;/** Company Settings address, phone, email and Tax/VAT under the name. */contactLine?:string|null;logo:string|null;generatedAt:string;filters:string[];groupBy:'series'|'item';groups:CompanyLoadGroupNode[];loads:CompanyTotalsRecord[]};

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<span dir="auto">${e(value)}</span>`;
const units=(values:UnitQuantity[])=>values.length?values.map(value=>e(formatTotalQuantity(value.quantity,value.unitSymbol))).join('<br/>'):'—';
const two=(value:number)=>String(value).padStart(2,'0');
/** The load's own local calendar day (YYYY-MM-DD) and time, without depending on the phone locale. */
const localDay=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value.slice(0,10):`${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}`;};
const localTime=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':`${two(date.getHours())}:${two(date.getMinutes())}`;};
const loadsWord=(count:number)=>`${count} load${count===1?'':'s'}`;

function groupKeyOf(record:CompanyTotalsRecord,groupBy:'series'|'item'){
  if(groupBy==='item')return record.snapshot.itemKey;
  return record.snapshot.loadNumber?record.seriesId??LEGACY_SERIES_KEY:LEGACY_SERIES_KEY;
}

export function buildCompanyLoadTotalsHtml(input:CompanyLoadTotalsPdf):string{
  const sections=input.groups.map(group=>{
    const own=input.loads.filter(record=>groupKeyOf(record,input.groupBy)===group.key);
    const active=own.filter(record=>record.status==='Active');
    const cancelled=own.filter(record=>record.status==='Cancelled');
    const projectRows=group.projects.map(project=>`<tr><td>${t(project.projectName)}</td><td class="num nowrap">${loadsWord(project.loadCount)}</td><td class="num nowrap">${units(project.units)}</td><td class="num">${project.cancelledCount||''}</td></tr>`).join('');
    const loadRow=(record:CompanyTotalsRecord)=>`<tr><td class="strong">${e(recordTitle(record.snapshot))}<div class="muted">Transaction ${e(record.snapshot.reference)}</div></td>
      <td class="nowrap">${e(formatDay(localDay(record.snapshot.recordedAt)))}<div class="muted">${e(localTime(record.snapshot.recordedAt))}</div></td><td>${t(record.snapshot.itemName)}</td><td>${t(record.snapshot.projectName??'No project')}<div class="muted">${t(record.snapshot.partyName)}</div></td>
      <td class="num nowrap">${e(formatTotalQuantity(record.snapshot.quantity,record.snapshot.unitSymbol))}</td>
      <td class="history">${record.status==='Cancelled'?`Cancelled${record.cancellationReason?` — ${t(record.cancellationReason)}`:''}`:record.correctionCount?`Corrected ${record.correctionCount}×`:''}</td></tr>`;
    const table=(caption:string,rows:CompanyTotalsRecord[])=>rows.length?`<table class="loads"><colgroup><col style="width:19%"/><col style="width:13%"/><col style="width:19%"/><col style="width:28%"/><col style="width:10%"/><col style="width:11%"/></colgroup><thead><tr class="caption"><th colspan="6">${t(group.label)} · ${e(caption)}</th></tr>
      <tr><th>Load number</th><th>Date and time</th><th>Item</th><th>Project and customer</th><th class="num">Quantity</th><th>History</th></tr></thead><tbody>${rows.map(loadRow).join('')}</tbody></table>`:'';
    return `<section class="group">
      <h2>${t(group.label)}</h2>
      <div class="summary"><div><span class="label">Loads</span><b>${loadsWord(group.loadCount)}</b></div><div><span class="label">Delivered</span><b>${units(group.units)}</b></div>${group.cancelledCount?`<div><span class="label">Cancelled, not counted</span><b>${loadsWord(group.cancelledCount)}</b></div>`:''}</div>
      <table class="projects"><thead><tr><th>Project</th><th class="num">Loads</th><th class="num">Delivered</th><th class="num">Cancelled</th></tr></thead><tbody>${projectRows}</tbody></table>
      ${table('Loads',active)}
      ${cancelled.length?`<h3>Cancelled — not counted</h3>${table('Cancelled — not counted',cancelled)}`:''}
    </section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Company Load Totals</title><style>
    @page{size:A4;margin:13mm 12mm 15mm}
    @media screen{body{max-width:210mm;margin:0 auto;padding:12mm}}
    *{box-sizing:border-box}
    body{font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif;color:#17212B;font-size:9pt;line-height:1.35}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;border-bottom:2px solid #C84B31;padding-bottom:4mm;margin-bottom:4mm}
    .contact{font-size:8pt;color:#444;margin-top:.5mm;overflow-wrap:anywhere}
    .logo{max-width:40mm;max-height:18mm;object-fit:contain;display:block;margin-bottom:1.5mm}
    h1{font-size:18pt;color:#173F67;margin:0;text-align:right}
    .filters{text-align:right;color:#5A6570;font-size:8.5pt;margin-top:1mm}
    h2{font-size:12.5pt;color:#173F67;margin:6mm 0 2mm;break-after:avoid}
    h3{font-size:10pt;color:#B3261E;margin:4mm 0 1.5mm;break-after:avoid}
    .summary{display:flex;gap:8mm;background:#F5F2EC;border:1px solid #E3DBCD;border-radius:2.5mm;padding:2.5mm 4mm;break-inside:avoid;break-after:avoid}
    .summary .label{display:block;color:#5A6570;font-size:7.5pt;font-weight:700;text-transform:uppercase}
    .summary b{font-size:11pt;font-variant-numeric:tabular-nums}
    table{width:100%;border-collapse:collapse;margin-top:2.5mm}
    thead{display:table-header-group}
    tr{break-inside:avoid}
    th{text-align:left;color:#173F67;font-size:7.5pt;border-bottom:1.5px solid #173F67;padding:1.3mm}
    td{padding:1.3mm;border-bottom:.3mm solid #E3DBCD;vertical-align:top;overflow-wrap:anywhere}
    .caption th{color:#17212B;font-size:8.5pt;background:#F5F2EC;border-bottom:none}
    .num{text-align:right;font-variant-numeric:tabular-nums}
    .strong{font-weight:700}.muted{color:#5A6570;font-size:7.5pt}
    .loads{table-layout:fixed}
    .nowrap{white-space:nowrap}
    .history{font-size:8pt}
    .loads .muted{overflow-wrap:anywhere}
    .note{color:#5A6570;font-size:8pt;margin-top:6mm}
    .meta{color:#4F5B66;margin:0 0 2mm}
  </style></head><body>
    <div class="head"><div>${input.logo?`<img class="logo" src="${input.logo}" alt=""/>`:''}<b>${t(input.companyName)}</b>${input.contactLine?`<div class="contact">${t(input.contactLine)}</div>`:''}</div>
      <div><h1>Company Load Totals</h1><div class="filters">${e(formatRecordedAt(input.generatedAt))}</div></div></div>
    <p class="meta">${input.filters.map(e).join(' · ')}</p>
    ${sections||'<p>No company loads match these filters.</p>'}
    <p class="note">Each unit is totalled on its own; different units are never added together. Cancelled loads keep their number and are listed, but are never counted. Loads confirmed before number series existed are shown as legacy loads with no generated number.</p>
  </body></html>`;
}
