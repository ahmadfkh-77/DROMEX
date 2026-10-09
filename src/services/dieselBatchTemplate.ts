import type {DieselBatchReport} from '../domain/dieselBatchReport';

/**
 * DEC-505, Screen F. The Diesel Batch Report as printable, searchable A4 HTML. Table headings repeat on
 * every page (thead), each page carries the running title and "Page X of Y" in its margins, and
 * everything reads in black and white: shading only repeats what the words already say.
 */
const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const css=(value:string)=>value.replace(/["\\]/g,'\\$&');

export type DieselReportCompany={companyName:string;logo:string|null;contactLine:string|null};

/** The header shows the company saved in Company Settings: its logo, name and contact details. */
export function buildDieselBatchReportHtml(report:DieselBatchReport,input:DieselReportCompany):string{
  const prices=report.pricesIncluded;
  const running=`${input.companyName} · Diesel Batch Report · ${report.metadata[0]!.value}`;
  const head=`<tr><th class="c-date">Date</th><th>Equipment</th><th class="c-type">Type</th><th class="c-src">Source</th><th class="num c-l">Litres</th>${prices?'<th class="num c-p">Price / L</th><th class="num c-c">Cost</th>':''}</tr>`;
  // Totals sit under Litres: four columns before it, then the price columns stay empty.
  const span=4,trail=prices?'<td></td><td></td>':'';
  const sections=report.sections.map(section=>`<section><h2 class="band">${e(section.title)}</h2>${section.destinations.map(destination=>`
    <div class="dest"><h3><span class="type">${e(destination.typeLabel)}</span><bdi dir="auto">${e(destination.name)}</bdi></h3>
    <table class="grid${prices?' priced':''}"><thead>${head}</thead><tbody>${destination.days.map(day=>`${day.rows.map(row=>`<tr><td>${e(row.date)}</td><td><bdi dir="auto">${e(row.equipment)}</bdi></td><td>${e(row.type)}</td><td><bdi dir="auto">${e(row.source)}</bdi></td><td class="num">${e(row.litres)}</td>${prices?`<td class="num">${e(row.price)}</td><td class="num wrap">${e(row.cost)}</td>`:''}</tr>`).join('')}
      <tr class="daytotal"><td colspan="${span}">Day total · ${e(day.label)}</td><td class="num">${e(day.totalText)}</td>${trail}</tr>`).join('')}
      <tr class="desttotal"><td colspan="${span}">${e(destination.totalLabel)}</td><td class="num">${e(destination.totalText)}</td>${trail}</tr>
    </tbody></table></div>`).join('')}</section>`).join('');
  // DEC-506. A supplier's delivered diesel: litres only, with the recorded amount of the priced batches when prices are on.
  const supplier=report.supplier;
  const supplierSection=supplier?`<section><h2 class="band">SUPPLIER DIESEL DELIVERIES</h2><div class="dest"><h3><span class="type">SUPPLIER</span><bdi dir="auto">${e(supplier.name)}</bdi></h3>
    <table class="grid"><colgroup>${(prices?[19,19,16,14,15,17]:[28,30,24,18]).map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr><th>Date</th><th>Batch</th><th>Invoice</th><th class="num">Litres</th>${prices?'<th class="num">Price / L</th><th class="num">Amount</th>':''}</tr></thead><tbody>${supplier.rows.map(row=>`<tr><td>${e(row.date)}</td><td>${e(row.batchNumber)}</td><td><bdi dir="auto">${e(row.invoice)}</bdi></td><td class="num">${e(row.litres)}</td>${prices?`<td class="num">${e(row.price)}</td><td class="num">${e(row.amount)}</td>`:''}</tr>`).join('')||`<tr><td colspan="${prices?6:4}">No diesel batches from this supplier in these filters.</td></tr>`}
    <tr class="desttotal"><td colspan="3">Supplier total · ${supplier.batchCount} batch${supplier.batchCount===1?'':'es'}</td><td class="num">${e(supplier.totalLitres)}</td>${prices?`<td></td><td class="num">${e(supplier.amount??'')}</td>`:''}</tr></tbody></table>
    <p class="note">${prices?'The amount covers the priced batches only, with VAT as recorded. ':''}${[supplier.unpricedNote,supplier.cancelledNote].filter(Boolean).map(value=>e(value)).join(' · ')}</p></div></section>`:'';
  const litres=(value:number)=>`${value<0?'−':''}${Math.abs(value).toLocaleString('en-US',{maximumFractionDigits:1})} L`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(report.fileName.replace(/\.pdf$/,''))}</title><style>
@page{size:A4;margin:18mm 14mm 16mm;@top-left{content:"${css(running)}";font-size:8pt;color:#555}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:8pt;color:#555}@bottom-left{content:"${css(running)}";font-size:8pt;color:#555}}
*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans","Noto Sans Arabic",Arial,sans-serif;color:#111;font-size:9.5pt;line-height:1.35}
bdi{unicode-bidi:isolate}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.wrap{white-space:normal}
.top{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #173F67;padding-bottom:8px}
.brand{font-size:10.5pt;font-weight:700;color:#173F67;overflow-wrap:anywhere}.contact{font-size:8pt;color:#444;margin-top:1px;overflow-wrap:anywhere}.logo{max-height:20mm;max-width:40mm;display:block;margin-bottom:3px}
.top>div{min-width:0}.title{text-align:right;overflow-wrap:anywhere}.title h1{margin:0;font-size:14pt}.title p{margin:2px 0 0;font-size:9pt;color:#333}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 18px;margin:10px 0 6px;font-size:8.8pt}.meta div{display:flex;gap:8px}.meta b{min-width:92px;color:#444;font-weight:600}
.summary{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #999;margin:10px 0 4px}.summary div{padding:7px 8px;border-left:1px solid #999}.summary div:first-child{border-left:0}.summary .k{font-size:7.5pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#444}.summary .v{font-size:13pt;font-weight:800}.summary .shade{background:#E9EEF4}
.note{font-size:8pt;color:#444;margin:2px 0 0}.alert{border:1.5px solid #B3261E;color:#B3261E;font-weight:700;padding:6px 8px;margin-top:8px}
.band{font-size:10pt;font-weight:800;letter-spacing:.06em;color:#fff;background:#173F67;padding:5px 8px;margin:14px 0 0;break-after:avoid}
.dest{break-inside:auto}.dest h3{font-size:10pt;margin:8px 0 0;padding:6px 6px 4px;border-bottom:1.5px solid #173F67;break-after:avoid;overflow-wrap:anywhere}.dest h3 .type{font-size:7.5pt;color:#444;letter-spacing:.06em;margin-right:6px}
table.grid{width:100%;border-collapse:collapse;table-layout:fixed}table.grid thead{display:table-header-group}table.grid tr{break-inside:avoid}
table.grid th{font-size:7.5pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#333;text-align:left;padding:5px 6px;border-bottom:1px solid #777;background:#F2F3F5}table.grid th.num{text-align:right}
table.grid td{padding:5px 6px;border-bottom:1px solid #DDD;vertical-align:top;overflow-wrap:anywhere}
.c-date{width:20%}.c-type{width:10%}.c-src{width:26%}.c-l{width:14%}.priced .c-date{width:15%}.priced .c-type{width:8%}.priced .c-src{width:20%}.priced .c-l{width:10%}.c-p{width:12%}.c-c{width:13%}
tr.daytotal td{font-weight:700;background:#F5F5F5;border-bottom:1px solid #999}tr.desttotal td{font-weight:800;border-top:1.5px solid #111;border-bottom:0;padding-top:7px}
.final{break-before:page}table.totals{width:100%;border-collapse:collapse;margin-top:8px}table.totals td,table.totals th{padding:6px 8px;border-bottom:1px solid #DDD;text-align:left;vertical-align:top;overflow-wrap:anywhere}table.totals th{font-size:7.5pt;text-transform:uppercase;letter-spacing:.04em;color:#333;background:#F2F3F5}table.totals .strong td{border-top:2px solid #111;font-weight:800}
.adj{border:1px solid #A07A1E;background:#FFF8E6;padding:7px 9px;margin-top:10px;font-size:8.8pt}.adj b{display:block}.empty{border:1px dashed #999;padding:14px;margin-top:14px;text-align:center}
</style></head><body>
<header class="top"><div>${input.logo?`<img class="logo" src="${input.logo}"/>`:''}<div class="brand">${e(input.companyName)}</div>${input.contactLine?`<div class="contact"><bdi dir="auto">${e(input.contactLine)}</bdi></div>`:''}</div><div class="title"><h1>Diesel Batch Report</h1><p>${e(report.scopeLabel)}</p></div></header>
<div class="meta">${report.metadata.map(item=>`<div><b>${e(item.label)}</b><span><bdi dir="auto">${e(item.value)}</bdi></span></div>`).join('')}</div>
<div class="summary"><div><div class="k">Delivered</div><div class="v">${e(litres(report.summary.deliveredLitres))}</div></div><div><div class="k">Filled</div><div class="v">${e(litres(report.summary.filledLitres))}</div></div><div><div class="k">Adjustments</div><div class="v">${e(litres(report.summary.adjustmentLitres))}</div></div><div class="shade"><div class="k">Remaining</div><div class="v">${e(litres(report.summary.remainingLitres))}</div></div></div>
${report.summary.filteredNote?`<p class="note">${e(report.summary.filteredNote)}</p>`:''}
${report.tank.overfill!=='None'?`<div class="alert">Overfill Alert: ${e(report.tank.overfill)}</div>`:''}
${supplierSection}${report.empty?(supplier?'':'<div class="empty">No fills match these filters.</div>'):sections}
<section class="final"><h2 class="band">BATCH TOTALS</h2>
${report.batchTotals.length?`<table class="totals"><thead><tr><th>Batch</th><th class="num">Delivered</th><th class="num">Filled</th><th class="num">Adjustments</th><th class="num">Remaining</th><th>Status</th></tr></thead><tbody>${report.batchTotals.map(batch=>`<tr><td><b>${e(batch.batchNumber)}</b><br/><bdi dir="auto">${e(batch.deliveryDetail)}</bdi></td><td class="num">${e(batch.delivered)}</td><td class="num">${e(batch.filled)}</td><td class="num">${e(batch.adjustments)}</td><td class="num"><b>${e(batch.remaining)}</b></td><td>${e(batch.status)}</td></tr>`).join('')}</tbody></table>`:'<p class="note">No diesel batch supplied the fills in this report.</p>'}
<table class="totals"><tbody><tr class="strong"><td>Diesel in tank now</td><td class="num">${e(report.tank.litres)}</td></tr><tr><td>Overfill Alert</td><td class="num">${e(report.tank.overfill)}</td></tr></tbody></table>
${report.destinationTotals.length?`<h2 class="band">TOTALS BY DESTINATION</h2><table class="totals"><tbody>${report.destinationTotals.map((total,index)=>`<tr${index===report.destinationTotals.length-1?' class="strong"':''}><td><bdi dir="auto">${e(total.label)}</bdi></td><td class="num">${e(total.litres)}</td></tr>`).join('')}</tbody></table>`:''}
${report.adjustments.map(adjustment=>`<div class="adj"><b>${e(adjustment.label)}</b>${e(adjustment.detail)}</div>`).join('')}
</section></body></html>`;
}
