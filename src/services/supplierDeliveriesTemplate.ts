import {NOT_RECORDED,pdfDayLabel,type SupplierDeliveriesPdf} from '../domain/supplierDeliveriesPdf';
import {breakAfterHyphens,colgroup,columnWidths,type ColumnSpec} from './pdfColumns';
import {reportCss} from './pdfTheme';

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
/** In a narrow number column of the steel layout the words wrap instead of running into the next column. */
const missingWrap=`<span class="missing wrap">${NOT_RECORDED}</span>`;

export function buildSupplierDeliveriesHtml(input:SupplierDeliveriesPdfInput):string{
  const {report}=input,prices=report.includePrices;
  const lengths=report.hasLength,pieces=report.hasPieces||lengths;
  const head=['Load','Date, time','Material','Driver · truck','Ticket',...(pieces?['Pieces']:[]),...(lengths?['Length per bar','Meters']:[]),'Quantity',...(prices?['Price','Total']:[]),'Status'].map((label,position)=>`<th${label==='Pieces'||label==='Length per bar'||label==='Meters'||label==='Quantity'||label==='Price'||label==='Total'?' class="num"':''}>${e(label)}</th>`);
  // Widths come from the content of every load in the report (see pdfColumns.ts): each column has room for its longest word, the load
  // number may break after a hyphen, and the widths add up to exactly 100%, so nothing runs into the next column.
  const everyLoad=report.destinations.flatMap(destination=>destination.loads);
  const NR=NOT_RECORDED;
  const specs:ColumnSpec[]=[
    {header:'Load',kind:'code',cells:everyLoad.map(load=>load.reference)},
    {header:'Date, time',cells:everyLoad.map(load=>day(load.recordedAt))},
    {header:'Material',cells:everyLoad.map(load=>load.item)},
    {header:'Driver · truck',cells:everyLoad.map(load=>load.driver)},
    {header:'Ticket',cells:everyLoad.map(load=>load.ticket??NR)},
    ...(pieces?[{header:'Pieces',cells:everyLoad.map(load=>load.pieces??NR)}]:[]),
    ...(lengths?[{header:'Length per bar',cells:everyLoad.map(load=>load.length??NR)},{header:'Meters',cells:everyLoad.map(load=>load.meters??NR)}]:[]),
    {header:'Quantity',kind:'number',cells:everyLoad.flatMap(load=>[load.quantityText,...(lengths&&load.weightNote?load.weightNote.split(' '):[])])},
    ...(prices?[{header:'Price',kind:'number' as const,cells:everyLoad.map(load=>load.unitPrice??'')},{header:'Total',kind:'number' as const,cells:everyLoad.map(load=>load.total??'')}]:[]),
    {header:'Status',cells:everyLoad.map(load=>load.status)},
  ];
  const colgroupHtml=colgroup(columnWidths(specs));
  const columnCount=head.length;
  const blocks=report.destinations.map((destination,index)=>{
    const rows=destination.loads.map(load=>`<tr>
      <td><span class="ln">${breakAfterHyphens(t(load.reference))}</span></td>
      <td>${e(day(load.recordedAt))}<div class="muted">${e(time(load.recordedAt))}</div></td>
      <td>${t(load.item)}</td><td>${t(load.driver)}</td><td>${load.ticket?t(load.ticket):missing}</td>${pieces?`<td class="num${lengths?' wr':''}">${load.pieces?e(load.pieces):(lengths?missingWrap:missing)}</td>`:''}${lengths?`<td class="num wr">${load.length?e(load.length):missingWrap}</td><td class="num wr">${load.meters?e(load.meters):missingWrap}</td>`:''}
      <td class="num">${e(load.quantityText)}${lengths&&load.weightNote?`<div class="muted">${e(load.weightNote)}</div>`:''}</td>${prices?`<td class="num">${e(load.unitPrice)}</td><td class="num">${e(load.total)}</td>`:''}
      <td><b>${e(load.status)}</b>${load.statusNote?`<div class="muted">${e(load.statusNote)}</div>`:''}</td></tr>`).join('');
    // One Total row per material and unit, under the loads: units are never added together.
    // Totals by material have their own box with only Material, Loads and Quantity: a total has no single driver, ticket or status.
    const totals=destination.totals.map(total=>`<tr class="total-row"><td>${t(total.item)}${total.piecesText?` · ${e(total.piecesText)}`:''}</td><td class="num">${total.count}</td><td class="num">${e(total.quantityText)}</td></tr>`).join('');
    const materials=new Set(destination.totals.map(total=>total.item)).size;
    // The destination bar is the first row of the table header, so it repeats on every page above the column titles.
    const bar=`<div class="block-bar"><span class="block-index">${index+1}</span><span class="block-name">${t(destination.label)}</span><span class="block-figures">${destination.loads.length} load${destination.loads.length===1?'':'s'} · ${materials} material${materials===1?'':'s'}</span></div>`;
    return `<section class="block table-block"><div class="block-body"><table class="grid">${colgroupHtml}<thead><tr class="bar-row"><th colspan="${columnCount}">${bar}</th></tr><tr>${head.join('')}</tr></thead><tbody>${rows}</tbody></table>
    ${prices&&destination.unpricedCount?`<p class="note">${destination.unpricedCount} unpriced load${destination.unpricedCount===1?'':'s'}: shown as Unpriced, never as zero.</p>`:''}</div></section>
    <section class="block table-block"><div class="block-body"><table class="grid total-grid"><colgroup><col style="width:62%"/><col style="width:16%"/><col style="width:22%"/></colgroup><thead><tr class="bar-row"><th colspan="3"><div class="block-bar"><span class="block-index">${index+1}</span><span class="block-name">${t(destination.label)}</span><span class="block-figures">Totals by material</span></div></th></tr><tr><th>Material</th><th class="num">Loads</th><th class="num">Quantity</th></tr></thead><tbody>${totals}</tbody></table></div></section>`;
  }).join('');
  // Received from this supplier: one row per material, grouped by category, each unit on its own.
  const sortedTotals=[...report.totals].sort((a,b)=>(a.categoryName??'').localeCompare(b.categoryName??'')||a.item.localeCompare(b.item)||a.unitSymbol.localeCompare(b.unitSymbol));
  let lastCategory:string|null=null;
  const summaryRows=sortedTotals.map(total=>{
    const category=total.categoryName||'Materials';
    const group=category!==lastCategory?`<tr class="group-row"><td colspan="${pieces?5:4}">${t(category)}</td></tr>`:'';lastCategory=category;
    return `${group}<tr><td class="indent">${t(total.item)}</td><td>${e(total.unitSymbol)}</td><td class="num">${total.count}</td>${pieces?`<td class="num">${e(total.piecesText)}</td>`:''}<td class="num">${e(total.quantityText)}</td></tr>`;
  }).join('');
  const materialCount=new Set(report.totals.map(total=>total.item)).size;
  const summary=report.totals.length?`<div class="panel"><div class="panel-head">Received from this supplier <span>${report.loadCount} load${report.loadCount===1?'':'s'} · ${materialCount} material${materialCount===1?'':'s'}</span></div>
    <table class="grid"><colgroup>${(pieces?[40,10,12,16,22]:[48,12,14,26]).map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr><th>Material</th><th>Unit</th><th class="num">Loads</th>${pieces?'<th class="num">Pieces</th>':''}<th class="num">Quantity</th></tr></thead><tbody>${summaryRows}<tr class="total-row"><td colspan="2">Total loads</td><td class="num">${report.loadCount}</td>${pieces?'<td></td>':''}<td class="num muted">each unit on its own</td></tr></tbody></table></div>`:'';
  const categories=report.categories.map(category=>`<section class="block"><div class="block-bar"><span class="block-index">S</span><span class="block-name">${t(category.categoryName)} summary · quantity added per unit</span><span class="block-figures">${category.loadCount} load${category.loadCount===1?'':'s'}</span></div>
    <div class="block-body"><table><colgroup>${[40,20,20,20].map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr><th>${t(category.categoryName)} item</th><th class="num">Loads</th><th class="num">Pieces</th><th class="num">Quantity</th></tr></thead><tbody>${category.items.map(item=>`<tr><td>${t(item.item)}</td><td class="num">${item.loadCount}</td><td class="num">${item.piecesText?e(item.piecesText):missing}</td><td class="num">${e(item.quantityText)}</td></tr>`).join('')}
    ${category.totals.map((total,position)=>`<tr class="total-row"><td>Total ${t(category.categoryName)}, all items</td><td class="num">${total.loadCount}</td><td class="num">${position===0&&category.piecesText?e(category.piecesText):''}</td><td class="num">${e(total.quantityText)}</td></tr>`).join('')}</tbody></table>
    <p class="note">A quantity is added only to the same unit. Pieces are shown beside it and never added to a weight or volume. Cancelled loads are not included.</p></div></section>`).join('');
  const diesel=report.diesel?`<section class="block"><div class="block-bar"><span class="block-index">D</span><span class="block-name">Diesel delivered (litres only)</span><span class="block-figures">${report.diesel.batchCount} batch${report.diesel.batchCount===1?'':'es'}</span></div>
    <div class="block-body"><table><colgroup>${(prices?[20,22,20,12,13,13]:[28,30,24,18]).map(width=>`<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr><th>Date</th><th>Batch</th><th>Invoice</th><th class="num">Litres</th>${prices?'<th class="num">Price / L</th><th class="num">Amount</th>':''}</tr></thead><tbody>${report.diesel.rows.map(row=>`<tr><td>${e(row.date)}</td><td>${e(row.batchNumber)}</td><td>${t(row.invoice)}</td><td class="num">${e(row.litres)}</td>${prices?`<td class="num">${e(row.price)}</td><td class="num">${e(row.amount)}</td>`:''}</tr>`).join('')}
    <tr class="total-row"><td colspan="3">Total diesel</td><td class="num">${e(report.diesel.totalLitres)}</td>${prices?`<td></td><td class="num">${e(report.diesel.amount??'')}</td>`:''}</tr></tbody></table>
    <p class="note">Litres are never added to tons or m³.${prices?' The amount covers the priced batches only, with VAT as recorded.':''}${report.diesel.unpricedNote?` ${e(report.diesel.unpricedNote)}.`:''}</p></div></section>`:'';
  const running=`${input.companyName} · Totals · ${report.supplierName} · Export only, no records changed`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(report.fileName.replace(/\.pdf$/,''))}</title><style>
    @page{size:A4;margin:12mm 11mm 16mm;@bottom-left{content:"${css(running)}";font-size:7.5pt;color:#5A6570}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#5A6570}}
    @media screen{body{max-width:210mm;margin:0 auto;padding:12mm}}
    ${reportCss()}
    body{font-size:8.5pt}
    bdi{unicode-bidi:isolate}
    .brand{font-size:11pt;font-weight:700;color:#173F67;overflow-wrap:anywhere}
    .head-right{min-width:0}.subtitle{overflow-wrap:anywhere}
    .grid{table-layout:fixed}
    .missing{color:#8A6D1D;font-style:italic;white-space:nowrap}.missing.wrap{white-space:normal;font-size:6.5pt}.num.wr{white-space:normal}.num .muted{white-space:normal}th.num{white-space:normal}
    .ln{font-weight:700;color:#173F67}
    .note{font-size:7.5pt;color:#52606D;margin:2mm 0 0}.empty{border:.35mm dashed #9FB0C2;padding:5mm;text-align:center}
  </style></head><body>
  <div class="head"><div>${input.logo?`<img class="logo" src="${input.logo}"/>`:''}<div class="brand">${t(input.companyName)}</div>${input.contactLine?`<div class="contact">${t(input.contactLine)}</div>`:''}</div>
    <div class="head-right"><h1>Totals</h1><div class="subtitle">${t(report.supplierName)}</div><div class="when">${e(day(report.generatedAt))}, ${e(time(report.generatedAt))}</div></div></div>
  <div class="panel keys">${report.meta.map(item=>`<div><span class="figure-label">${e(item.label)}</span><b>${t(item.value)}</b></div>`).join('')}</div>
  ${report.empty?'<div class="empty">No deliveries match these filters.</div>':summary+blocks+categories+diesel}
  <div class="notes"><h4>Notes</h4><ol><li>Quantities are added only to the same unit; different units are never added together. Litres are never added to tons or m³.</li><li>Cancelled loads are not included.</li><li>This PDF is an export only: it changes no record.</li></ol></div>
  </body></html>`;
}
