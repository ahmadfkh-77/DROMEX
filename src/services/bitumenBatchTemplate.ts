import type {BitumenBatchReport} from '../domain/bitumenBatchReport';
import {colgroup,columnWidths} from './pdfColumns';

/**
 * The Bitumen Batch Report as an A4 page, laid out like the Diesel Batch Report: company and contact on the left, the title on the
 * right, a summary strip, navy section bands, figures in kg with tons beside them, and a footer with the running title and the page
 * number. Table widths are worked out from the content and add up to exactly 100%. A cancelled batch carries a CANCELLED mark and
 * says why. It is a report only: it changes no record.
 */
export type BitumenReportCompany={companyName:string;logo:string|null;contactLine:string|null};

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<span dir="auto">${e(value)}</span>`;
const css=(value:string)=>value.replace(/["\\]/g,'').replace(/\r?\n/g,' ');
const two=(value:number)=>String(value).padStart(2,'0');
const when=(raw:string)=>{const date=new Date(raw);return Number.isNaN(date.getTime())?raw.slice(0,10):`${date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}, ${two(date.getHours())}:${two(date.getMinutes())}`;};

export function bitumenTableWidths(headers:readonly string[],values:readonly string[],numeric:readonly boolean[]=[]):number[]{
  return columnWidths(headers.map((header,index)=>({header,kind:numeric[index]?'amount' as const:'text' as const,cells:[values[index]??'']})));
}

export function buildBitumenBatchHtml(report:BitumenBatchReport,company:BitumenReportCompany):string{
  const running=`${company.companyName} · Bitumen Batch Report · ${report.batchNumber}`;
  const summary=report.summary.map(item=>`<div><span class="label">${e(item.label)}</span><b>${t(item.value)}</b></div>`).join('');
  const figures=report.figures.map(figure=>`<div${figure.strong?' class="strong"':''}><span class="label">${e(figure.label)}</span><b>${e(figure.kg)}</b><small>${e(figure.tons)}</small></div>`).join('');
  const detailWidths=bitumenTableWidths(report.detail.headers,report.detail.values);
  const detail=`<table>${colgroup(detailWidths)}<thead><tr>${report.detail.headers.map(header=>`<th>${e(header)}</th>`).join('')}</tr></thead><tbody><tr>${report.detail.values.map(value=>`<td>${t(value)}</td>`).join('')}</tr></tbody></table>`;
  const price=report.price?`<div class="band">PRICE</div>
    <table>${colgroup(bitumenTableWidths(report.price.headers,report.price.values,[false,true,true,true]))}<thead><tr>${report.price.headers.map((header,index)=>`<th${index>0?' class="num"':''}>${e(header)}</th>`).join('')}</tr></thead><tbody><tr>${report.price.values.map((value,index)=>`<td${index>0?' class="num"':''}>${e(value)}</td>`).join('')}</tr></tbody></table>
    <table class="lines">${colgroup([78,22])}<tbody>${report.price.lines.map(line=>`<tr${line.strong?' class="tot"':''}><td>${t(line.label)}</td><td class="num">${e(line.value)}</td></tr>`).join('')}</tbody></table>`:'';
  const historyWidths=columnWidths([{header:'Date',cells:report.history.map(row=>row.date)},{header:'Event',cells:report.history.map(row=>row.event)},{header:'Kg',kind:'number',cells:report.history.map(row=>row.kg)}]);
  const history=`<table>${colgroup(historyWidths)}<thead><tr><th>Date</th><th>Event</th><th class="num">Kg</th></tr></thead><tbody>${report.history.map(row=>`<tr><td>${e(row.date)}</td><td>${t(row.event)}</td><td class="num">${e(row.kg)}</td></tr>`).join('')}<tr class="tot"><td colspan="2">Remaining</td><td class="num">${e(report.remainingLabel)}</td></tr></tbody></table>`;
  const useWidths=report.use?columnWidths([{header:'Date',cells:report.use.rows.map(row=>row.date)},{header:'Load',kind:'code',cells:report.use.rows.flatMap(row=>[row.load,row.item])},{header:'Mix',kind:'number',cells:report.use.rows.map(row=>row.mix)},{header:'Rule',kind:'amount',cells:report.use.rows.map(row=>row.rule)},{header:'Bitumen',kind:'number',cells:report.use.rows.map(row=>row.kg)}]):[];
  const use=report.use?`<div class="band">USE FROM ASPHALT LOADS</div><table>${colgroup(useWidths)}<thead><tr><th>Date</th><th>Load</th><th class="num">Mix</th><th>Rule</th><th class="num">Bitumen</th></tr></thead><tbody>${report.use.rows.map(row=>`<tr><td>${e(row.date)}</td><td>${t(row.load)}<div class="muted">${t(row.item)}</div></td><td class="num">${e(row.mix)}</td><td>${e(row.rule)}</td><td class="num">${e(row.kg)}</td></tr>`).join('')}<tr class="tot"><td colspan="4">Estimated use</td><td class="num">${e(report.use.total)}</td></tr></tbody></table>`:'';
  const adjustments=report.adjustments?`<div class="band">ADJUSTMENTS</div><table>${colgroup(columnWidths([{header:'Date',cells:report.adjustments.rows.map(row=>row.date)},{header:'Reason',cells:report.adjustments.rows.map(row=>row.reason)},{header:'Kg',kind:'number',cells:report.adjustments.rows.map(row=>row.kg)}]))}<thead><tr><th>Date</th><th>Reason</th><th class="num">Kg</th></tr></thead><tbody>${report.adjustments.rows.map(row=>`<tr><td>${e(row.date)}</td><td>${t(row.reason)}</td><td class="num">${e(row.kg)}</td></tr>`).join('')}</tbody></table>`:'';
  const cancellation=report.cancellation?`<div class="band">WHY IT WAS CANCELLED</div><table>${colgroup([24,76])}<tbody><tr><td><b>Cancelled</b></td><td>${e(report.cancellation.when)}</td></tr><tr><td><b>Reason</b></td><td>${t(report.cancellation.reason)}</td></tr></tbody></table>`:'';
  const closure=report.closure?`<div class="band">CLOSED BY HAND</div><table>${colgroup([24,76])}<tbody><tr><td><b>Closed</b></td><td>${e(report.closure.closedOn)}</td></tr><tr><td><b>Left over</b></td><td>${e(report.closure.leftover)}</td></tr><tr><td><b>Reason</b></td><td>${t(report.closure.reason)}</td></tr></tbody></table>`:'';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bitumen Batch Report</title><style>
    @page{size:A4;margin:12mm 11mm 16mm;@bottom-left{content:"${css(running)}";font-size:7.5pt;color:#5A6570}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#5A6570}}
    @media screen{body{max-width:210mm;margin:0 auto;padding:12mm}}
    *{box-sizing:border-box}
    body{font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif;color:#17212B;font-size:8.5pt;line-height:1.35}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;border-bottom:2px solid #C84B31;padding-bottom:4mm;margin-bottom:3mm}
    .logo{max-width:40mm;max-height:18mm;object-fit:contain;display:block;margin-bottom:1.5mm}
    .brand{font-size:11pt;font-weight:700;color:#173F67;overflow-wrap:anywhere}.contact{font-size:8pt;color:#444;margin-top:.5mm;overflow-wrap:anywhere}
    h1{font-size:18pt;color:#173F67;margin:0;text-align:right}.head-right{text-align:right}.when{color:#5A6570;font-size:8.5pt;margin-top:1mm}
    .summary{display:flex;gap:2.5mm;margin:0 0 3mm}.summary div{flex:1;min-width:0;border:1px solid #E3DBCD;border-radius:2mm;background:#FBF9F4;padding:2mm 3mm}
    .summary .label{display:block;color:#5A6570;font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.3px}.summary b{font-size:9pt;overflow-wrap:anywhere}
    .band{background:#173F67;color:#FFF8ED;font-weight:700;letter-spacing:.6px;padding:1.6mm 3mm;margin:4mm 0 2mm;border-radius:1.6mm;break-after:avoid;font-size:8.5pt}
    .figs{display:flex;gap:2.5mm}.figs div{flex:1;min-width:0;border:1px solid #CFC5B3;border-radius:2mm;padding:2mm 3mm;text-align:right}.figs .label{display:block;font-size:6.5pt;text-transform:uppercase;color:#5A6570;font-weight:700;text-align:left}.figs b{font-size:13pt;font-variant-numeric:tabular-nums;white-space:nowrap}.figs small{display:block;color:#5A6570;font-size:7.5pt}.figs .strong{background:#FBE9E4;border-color:#E9B7A9}
    table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}
    th{text-align:left;color:#173F67;font-size:7pt;border-bottom:1.5px solid #173F67;padding:1.2mm 1.6mm;vertical-align:bottom}
    td{padding:1.4mm 1.6mm;border-bottom:.3mm solid #EAE3D7;vertical-align:top;overflow-wrap:anywhere}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.lines{margin-top:2mm}.muted{color:#5A6570;font-size:7pt;font-weight:400}
    tr.tot td{font-weight:700;color:#173F67;border-top:1.5px solid #173F67;border-bottom:none}
    .stamp{display:inline-block;margin-top:2mm;border:2px solid #B3261E;color:#B3261E;font-weight:700;letter-spacing:2px;padding:.8mm 4mm;border-radius:1.6mm;transform:rotate(-4deg);font-size:11pt}
    .note{color:#5A6570;font-size:7.5pt;margin-top:3mm}
  </style></head><body>
    <div class="head"><div>${company.logo?`<img class="logo" src="${company.logo}" alt=""/>`:''}<div class="brand">${t(company.companyName)}</div>${company.contactLine?`<div class="contact">${t(company.contactLine)}</div>`:''}</div>
      <div class="head-right"><h1>Bitumen Batch Report</h1><div class="when">${e(when(report.exportedAt))}${report.pricesIncluded?' · with prices':''}</div>${report.cancelled?'<div class="stamp">CANCELLED</div>':''}</div></div>
    <div class="summary">${summary}</div>
    ${closure}
    ${cancellation}
    <div class="band">BATCH FIGURES${report.estimated?' (ESTIMATED USE)':''}</div><div class="figs">${figures}</div>
    <div class="band">DELIVERY DETAIL</div>${detail}
    ${price}
    ${use}
    ${adjustments}
    <div class="band">HISTORY</div>${history}
    <p class="note">All quantities are in kilograms; tons are shown for reference and are never added to kilograms. ${report.estimated?'Use is an estimate from each load\'s quantity and the rule in force when the load was counted; cancelled loads are reversed and not listed. ':''}${report.pricesIncluded?'An Unpriced batch says Unpriced; a missing price is never shown as zero. ':'Prices are not included in this report. '}${report.cancelled?'A cancelled batch stays on record and is never counted in any total. ':''}This is a report of one bitumen batch, not an invoice or bill.</p>
  </body></html>`;
}
