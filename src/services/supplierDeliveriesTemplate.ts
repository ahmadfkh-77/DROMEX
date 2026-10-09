import {NOT_RECORDED,pdfDayLabel,type SupplierDeliveriesPdf} from '../domain/supplierDeliveriesPdf';

/**
 * DEC-506. The supplier deliveries PDF as A4: the header company, "Totals" with the supplier's name in bold, the
 * filters used, one numbered block per destination (project, company site, unassigned) listing every load with its
 * number and prefix, the totals per material (units never mixed), and diesel in its own litres block. Headings repeat
 * on every page. It is an export only: it changes no record.
 */
export type SupplierDeliveriesPdfInput={companyName:string;logo:string|null;contactLine:string|null;report:SupplierDeliveriesPdf};

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<bdi dir="auto">${e(value)}</bdi>`;
const css=(value:string)=>value.replace(/["\\]/g,'').replace(/\r?\n/g,' ');
const two=(value:number)=>String(value).padStart(2,'0');
const day=(raw:string)=>{const date=new Date(raw);return Number.isNaN(date.getTime())?raw.slice(0,10):pdfDayLabel(`${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}`);};
const time=(raw:string)=>{const date=new Date(raw);return Number.isNaN(date.getTime())?'':`${two(date.getHours())}:${two(date.getMinutes())}`;};
const missing=`<span class="missing">${NOT_RECORDED}</span>`;

export function buildSupplierDeliveriesHtml(input:SupplierDeliveriesPdfInput):string{
  const {report}=input,prices=report.includePrices;
  const head=['Load','Date, time','Material','Driver · truck','Ticket','Quantity',...(prices?['Price','Total']:[]),'Status'].map((label,position)=>`<th${label==='Quantity'||label==='Price'||label==='Total'?' class="num"':''}>${e(label)}</th>`);
  const colgroup=`<colgroup>${(prices?[16,10,13,14,11,8,9,9,10]:[19,12,16,17,12,12,12]).map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup>`;
  const blocks=report.destinations.map((destination,index)=>{
    const rows=destination.loads.map(load=>`<tr>
      <td><span class="ln">${t(load.reference)}</span></td>
      <td class="nowrap">${e(day(load.recordedAt))}<div class="muted">${e(time(load.recordedAt))}</div></td>
      <td>${t(load.item)}</td><td>${t(load.driver)}</td><td>${load.ticket?t(load.ticket):missing}</td>
      <td class="num">${e(load.quantityText)}</td>${prices?`<td class="num">${e(load.unitPrice)}</td><td class="num">${e(load.total)}</td>`:''}
      <td><b>${e(load.status)}</b>${load.statusNote?`<div class="muted">${e(load.statusNote)}</div>`:''}</td></tr>`).join('');
    const totals=destination.totals.map(total=>`<span class="pill">${t(total.item)} · ${e(total.quantityText)} · ${total.count} load${total.count===1?'':'s'}</span>`).join('');
    return `<section class="block"><div class="block-bar"><span class="block-index">${index+1}</span><span class="block-name">${t(destination.label)}</span><span class="block-count">${destination.loads.length} load${destination.loads.length===1?'':'s'}</span></div>
    <div class="block-body"><table>${colgroup}<thead><tr>${head.join('')}</tr></thead><tbody>${rows}</tbody></table>
    <div class="pills">${totals}</div>${prices&&destination.unpricedCount?`<p class="note">${destination.unpricedCount} unpriced load${destination.unpricedCount===1?'':'s'}: shown as Unpriced, never as zero.</p>`:''}</div></section>`;
  }).join('');
  const overall=report.totals.map(total=>`<span class="pill strong">${t(total.item)} · ${e(total.quantityText)} · ${total.count}</span>`).join('');
  const diesel=report.diesel?`<section class="block"><div class="block-bar"><span class="block-index">D</span><span class="block-name">Diesel delivered (litres only)</span><span class="block-count">${report.diesel.batchCount} batch${report.diesel.batchCount===1?'':'es'}</span></div>
    <div class="block-body"><table><colgroup>${(prices?[20,22,20,12,13,13]:[28,30,24,18]).map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr><th>Date</th><th>Batch</th><th>Invoice</th><th class="num">Litres</th>${prices?'<th class="num">Price / L</th><th class="num">Amount</th>':''}</tr></thead><tbody>${report.diesel.rows.map(row=>`<tr><td>${e(row.date)}</td><td>${e(row.batchNumber)}</td><td>${t(row.invoice)}</td><td class="num">${e(row.litres)}</td>${prices?`<td class="num">${e(row.price)}</td><td class="num">${e(row.amount)}</td>`:''}</tr>`).join('')}
    <tr class="total"><td colspan="3">Total diesel</td><td class="num">${e(report.diesel.totalLitres)}</td>${prices?`<td></td><td class="num">${e(report.diesel.amount??'')}</td>`:''}</tr></tbody></table>
    <p class="note">Litres are never added to tons or m³.${prices?' The amount covers the priced batches only, with VAT as recorded.':''}${report.diesel.unpricedNote?` ${e(report.diesel.unpricedNote)}.`:''}</p></div></section>`:'';
  const running=`${input.companyName} · Totals · ${report.supplierName} · Export only, no records changed`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(report.fileName.replace(/\.pdf$/,''))}</title><style>
    @page{size:A4;margin:12mm 11mm 16mm;@bottom-left{content:"${css(running)}";font-size:7.5pt;color:#5A6570}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#5A6570}}
    @media screen{body{max-width:210mm;margin:0 auto;padding:12mm}}
    *{box-sizing:border-box}
    body{font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif;color:#17212B;font-size:8.5pt;line-height:1.35}
    bdi{unicode-bidi:isolate}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;border-bottom:2px solid #C84B31;padding-bottom:4mm;margin-bottom:3mm}
    .logo{max-width:40mm;max-height:18mm;object-fit:contain;display:block;margin-bottom:1.5mm}
    .brand{font-size:11pt;font-weight:700;color:#173F67;overflow-wrap:anywhere}.contact{font-size:8pt;color:#444;margin-top:.5mm;overflow-wrap:anywhere}
    h1{font-size:18pt;color:#173F67;margin:0;text-align:right}.head-right{text-align:right;min-width:0}.who{font-size:12pt;font-weight:800;margin-top:1mm;overflow-wrap:anywhere}.when{color:#5A6570;font-size:8.5pt;margin-top:1mm}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:1.5mm 6mm;margin:0 0 4mm;font-size:8.5pt}.meta div{display:flex;gap:2mm;min-width:0}.meta b{min-width:22mm;color:#5A6570;font-weight:700}.meta span{overflow-wrap:anywhere}
    .block{border:1px solid #CFC5B3;border-radius:3mm;margin:0 0 5mm;overflow:hidden;background:#FFFFFF}
    .block-bar{display:flex;align-items:center;gap:3mm;background:#173F67;color:#FFF8ED;padding:2.4mm 4mm;break-after:avoid;break-inside:avoid}
    .block-index{flex:0 0 7mm;height:7mm;border-radius:1.6mm;background:#C84B31;color:#FFFFFF;font-weight:700;display:flex;align-items:center;justify-content:center}
    .block-name{flex:1;font-size:12pt;font-weight:700;overflow-wrap:anywhere}.block-count{font-size:8.5pt;color:#E8DED0}.block-body{padding:2mm 3mm 3mm}
    table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}
    th{text-align:left;color:#173F67;font-size:7pt;border-bottom:1.5px solid #173F67;padding:1.4mm 1.6mm;vertical-align:bottom}
    td{padding:1.4mm 1.6mm;border-bottom:.3mm solid #EAE3D7;vertical-align:top;overflow-wrap:anywhere}
    tbody tr:nth-child(even) td{background:#FAF8F4}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.nowrap{white-space:nowrap}.muted{color:#5A6570;font-size:7pt}.missing{color:#8A6D1D;font-style:italic;white-space:nowrap}
    .ln{font-weight:700;color:#173F67}
    tr.total td{font-weight:800;border-top:1.5px solid #17212B;background:#F5F5F5}
    .pills{display:flex;flex-wrap:wrap;gap:1.5mm;margin-top:2.5mm}.pill{border:1px solid #CFC5B3;border-radius:5mm;padding:.8mm 2.6mm;font-size:8pt;background:#FBF9F4}.pill.strong{background:#EAF1F6;border-color:#173F67;font-weight:700}
    .note{font-size:7.5pt;color:#5A6570;margin:2mm 0 0}.empty{border:1px dashed #999;padding:5mm;text-align:center}
    h2.sum{font-size:10pt;color:#173F67;margin:0 0 1.5mm}
  </style></head><body>
  <div class="head"><div>${input.logo?`<img class="logo" src="${input.logo}"/>`:''}<div class="brand">${t(input.companyName)}</div>${input.contactLine?`<div class="contact">${t(input.contactLine)}</div>`:''}</div>
    <div class="head-right"><h1>Totals</h1><div class="who">${t(report.supplierName)}</div><div class="when">${e(day(report.generatedAt))}, ${e(time(report.generatedAt))}</div></div></div>
  <div class="meta">${report.meta.map(item=>`<div><b>${e(item.label)}</b><span>${t(item.value)}</span></div>`).join('')}</div>
  ${report.totals.length?`<h2 class="sum">Received from this supplier · ${report.loadCount} load${report.loadCount===1?'':'s'}</h2><div class="pills" style="margin:0 0 4mm">${overall}</div>`:''}
  ${report.empty?'<div class="empty">No deliveries match these filters.</div>':blocks+diesel}
  </body></html>`;
}
