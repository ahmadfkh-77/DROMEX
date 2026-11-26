import type {ContractReport,ContractReportRow} from '../domain/contractReport';
import {reportColors,reportCss} from './pdfTheme';

/**
 * DEC-522 Phase E. The Quantity Targets report PDF in the Totals look (DEC-520): the header company's logo, name and contact line on the
 * left, the title, project and customer on the right, square boxes with a navy bar and an orange rule, and numbered Notes. A4 landscape,
 * because the internal version has eleven columns. Every column is ruled, and heavier lines separate the Contract, Use, Balance and Saving
 * groups so the allowed quantity reads apart from what was used. It changes no record.
 */
export type ContractReportHeader={companyName:string;logo:string|null;contactLine:string|null};

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<span dir="auto">${e(value)}</span>`;
const css=(value:string)=>value.replace(/["\\]/g,'').replace(/\r?\n/g,' ').split('<').join('').split('>').join('');
const n=(value:number)=>String(Number(value.toFixed(3)));
const signed=(value:number)=>value===0?'0':value<0?`−${n(-value)}`:`+${n(value)}`;
const pct=(value:number)=>`${value.toFixed(1)}%`;
const usd=(value:number)=>`$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const when=(raw:string)=>{const date=new Date(raw);return `${date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}, ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};

function saving(row:ContractReportRow):string{
  if(row.savingUsd===null)return '<span class="missing">no price</span>';
  if(row.tone==='over'&&row.savingUsd===0)return '—';
  return `${usd(row.savingUsd)}${row.savingIsEstimate?' *':''}`;
}

function itemsTable(report:ContractReport):string{
  const prices=report.includePrices;
  const groups=`<tr class="grp"><th colspan="2">Item</th><th class="g">Target</th><th class="g" colspan="4">Use</th><th class="g" colspan="3">Balance</th>${prices?'<th class="g" colspan="2">Saving</th>':''}</tr>`;
  const heads=`<tr><th>Item · materials</th><th>Unit</th><th class="num g">Target</th><th class="num g">From loads</th><th class="num">Site entries</th><th class="num">Adjust.</th><th class="num">Used</th><th class="num g">Remaining</th><th class="num">% used</th><th>Status</th>${prices?'<th class="num g">Leftover</th><th class="num">Saving</th>':''}</tr>`;
  const body=report.rows.map(row=>`<tr>
    <td><b>${t(row.name)}</b> <span class="mode ${row.tracking==='MANUAL'?'m':row.tracking==='LINKED MANUAL'?'lm':'a'}">${e(row.tracking)}</span>${row.materials?`<br/><span class="muted">${t(row.materials)}</span>`:row.manual?'<br/><span class="muted">No material linked</span>':''}</td><td>${t(row.unit)}</td>
    <td class="num g">${n(row.contract)}</td><td class="num g">${row.tracking==='LINKED MANUAL'?(row.delivered?row.delivered.split('; ').map(value=>t(value)).join('<br/>'):'—'):row.manual?'—':n(row.fromLoads)}</td><td class="num">${row.siteEntries===null?'—':n(row.siteEntries)}</td><td class="num">${signed(row.adjustments)}</td><td class="num"><b>${n(row.used)}</b></td>
    <td class="num g">${n(row.remaining)}</td><td class="num">${pct(row.percentUsed)}</td><td class="status ${row.tone}">${t(row.status)}</td>
    ${prices?`<td class="num g">${row.leftover===null?'':n(row.leftover)}</td><td class="num">${saving(row)}</td>`:''}
  </tr>`).join('');
  const subtitle=report.trackedBySiteEntries?`<p class="note-plain" style="padding:2mm 3.5mm 0;margin:0 0 2mm"><b>Site entries</b> track LINKED MANUAL and MANUAL targets. AUTOMATIC targets are calculated from loads.</p>`:'';
  return `${subtitle}<table class="cq"><thead>${groups}${heads}</thead><tbody>${body}</tbody></table>`;
}

function smallTable(headers:string[],numeric:boolean[],rows:string[][],widths:number[]):string{
  return `<table class="cq small"><colgroup>${widths.map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr>${headers.map((header,index)=>`<th${numeric[index]?' class="num"':''}>${e(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map((cell,index)=>`<td${numeric[index]?' class="num"':''}>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function buildContractReportHtml(report:ContractReport,header:ContractReportHeader):string{
  const c=reportColors,prices=report.includePrices;
  const running=`${header.companyName} · ${report.title} · ${report.project.name}`;
  const percent=report.summary.overallPercentUsed===null?'—':pct(report.summary.overallPercentUsed);
  const tiles=[
    [`Quantity used (${report.summary.basis==='value'?'weighted by target value':'average of items'})`,percent],
    ['Items complete',report.summary.itemsComplete],
    ...(report.trackedBySiteEntries?[['Tracked automatically',String(report.rows.length-report.trackedBySiteEntries)],['Tracked by site entries',String(report.trackedBySiteEntries)]]:[]),
    ...(prices?[['Saving, finished items',usd(report.summary.totalSavingUsd??0)],['Estimated, items in progress',usd(report.summary.estimatedSavingUsd??0)]]:[]),
  ].map(([label,value])=>`<div class="tile"><span class="figure-label">${e(label)}</span><b>${e(value)}</b></div>`).join('');
  let index=1;
  const block=(name:string,body:string,table=true)=>`<section class="block${table?' table-block':''}"><div class="block-bar"><span class="block-index">${index++}</span><span class="block-name">${e(name)}</span></div><div class="block-body">${body}</div></section>`;
  const summary=block('Project summary',`<div class="tiles flat">${tiles}</div>`,false);
  const items=block('Targets',report.rows.length?itemsTable(report):'<p class="empty">No targets.</p>');
  const savingsBody=(prices?smallTable(['Largest saving first','Leftover','Saving'],[false,true,true],report.savings.length?report.savings.map(value=>[t(value.name),e(value.leftover),usd(value.savingUsd)]):[['<span class="missing">No finished item has a saving yet.</span>','','']],[60,20,20]):'')
    +smallTable(['Largest overrun first','Over by','% used'],[false,true,true],report.overruns.length?report.overruns.map(value=>[t(value.name),e(value.overBy),pct(value.percentUsed)]):[['<span class="missing">No item is over target.</span>','','']],[60,20,20]);
  const overruns=block(prices?'Savings and overruns':'Overruns',savingsBody);
  const notCounted=report.notCounted.length?block('Not counted',smallTable(['Load','Item','Quantity','Why'],[false,false,true,false],report.notCounted.map(value=>[t(value.load),t(value.item),e(value.quantity),e(value.why)]),[28,24,13,35])):'';
  const entries=report.siteEntries.some(value=>value.entries.length)?block('Site entries',report.siteEntries.filter(value=>value.entries.length).map(value=>`<div class="sub">${t(value.name)} · ${e(value.tracking)} · ${value.entries.length} entr${value.entries.length===1?'y':'ies'} · total ${n(value.total)} ${t(value.unit)}</div>`+smallTable(['Date','Amount','Entries total after','Note / reason'],[false,true,true,false],[...value.entries].reverse().map(entry=>[e(new Date(entry.date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})),`${signed(entry.amount)} ${e(value.unit)}`,n(entry.totalAfter),t(entry.note)]),[20,20,20,40])).join('')):'';
  return `<!doctype html><html><head><meta charset="utf-8"/><style>${reportCss()}
    @page{size:A4 landscape;margin:12mm 11mm 16mm;@bottom-left{content:"${css(running)}";font-size:7.5pt;color:#5A6570}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#5A6570}}
    .tiles.flat{margin:0;border:none}
    table.cq{table-layout:auto}table.cq.small{table-layout:fixed}
    table.cq th,table.cq td{border-right:.2mm solid ${c.line}}
    table.cq th:last-child,table.cq td:last-child{border-right:none}
    table.cq .g{border-left:.5mm solid ${c.navy}}
    table.cq tr.grp th{background:${c.group};text-align:center;font-size:6.8pt;letter-spacing:.7px;text-transform:uppercase;border-bottom:.2mm solid ${c.cell}}
    .mode{display:inline-block;font-size:6pt;font-weight:700;letter-spacing:.4px;color:#fff;border-radius:1mm;padding:.3mm 1.4mm;vertical-align:1px}.mode.a{background:#1E7B4B}.mode.lm{background:#B7791F}.mode.m{background:#D9571F}
    .sub{font-weight:700;color:#173F67;padding:2mm 0 1mm}
    td.status{font-weight:700}td.status.over{color:#A61B12}td.status.done{color:#2F6B3A}
  </style></head><body>
    <div class="head"><div>${header.logo?`<img class="logo" src="${header.logo}" alt=""/>`:''}<b>${t(header.companyName)}</b>${header.contactLine?`<div class="contact">${t(header.contactLine)}</div>`:''}</div>
      <div class="head-right"><h1>${t(report.title)}</h1><div class="subtitle">Project: ${t(report.project.name)}</div><div class="subtitle">Customer: ${t(report.project.customerName)}</div><div class="when">As of ${e(when(report.generatedAt))} · ${prices?'With prices':'Without prices'}</div></div></div>
    ${summary}${items}${entries}${overruns}${notCounted}
  </body></html>`;
}
