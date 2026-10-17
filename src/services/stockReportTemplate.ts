import type {StockReport,StockReportItem} from '../domain/stockReport';
import {colgroup,columnWidths} from './pdfColumns';

/**
 * The Stock Report as A4 pages, laid out like the Bitumen and Diesel batch reports: company and contact on the left, the title on the right,
 * a summary strip, navy section bands, tables whose widths are worked out from their content, and a footer with the running title and the
 * page number. A report for all Stock opens with one summary table (each unit on its own line) and then one section per item, each starting
 * on a new page. It is a report only: it changes no record.
 */
export type StockReportCompany={companyName:string;logo:string|null;contactLine:string|null};

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<span dir="auto">${e(value)}</span>`;
const css=(value:string)=>value.replace(/["\\]/g,'').replace(/\r?\n/g,' ').split('<').join('').split('>').join('');
const two=(value:number)=>String(value).padStart(2,'0');
const when=(raw:string)=>{const date=new Date(raw);return Number.isNaN(date.getTime())?raw.slice(0,10):`${date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}, ${two(date.getHours())}:${two(date.getMinutes())}`;};

function itemSection(item:StockReportItem,pricesIncluded:boolean,breakBefore:boolean):string{
  const batchHeaders=['Batch','Received','Supplier','Invoice','Quantity','Used','Left','Status',...(pricesIncluded?['Price','Amount']:[])];
  const batchValues=item.batches.map(row=>[row.batchNumber,row.date,row.supplier,row.invoice,row.quantity,row.used,row.remaining,row.status,...(pricesIncluded?[row.price??'',row.amount??'']:[])]);
  const numericBatch=[false,false,false,false,true,true,true,false,...(pricesIncluded?[true,true]:[])];
  const batchWidths=columnWidths(batchHeaders.map((header,index)=>({header,kind:numericBatch[index]?'amount' as const:'text' as const,cells:batchValues.map(values=>values[index]??'')})));
  const batches=item.batches.length?`<table>${colgroup(batchWidths)}<thead><tr>${batchHeaders.map((header,index)=>`<th${numericBatch[index]?' class="num"':''}>${e(header)}</th>`).join('')}</tr></thead><tbody>${batchValues.map(values=>`<tr>${values.map((value,index)=>`<td${numericBatch[index]?' class="num"':''}>${t(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p class="note">No batch arrived in this period.</p>';
  const useHeaders=['Date','Source','Batches','Quantity','Status','Note'];
  const useValues=item.uses.map(row=>[row.date,row.source,row.batches,row.quantity,row.status,row.note]);
  const useWidths=columnWidths(useHeaders.map((header,index)=>({header,kind:index===3?'amount' as const:'text' as const,cells:useValues.map(values=>values[index]??'')})));
  const uses=item.uses.length?`<table>${colgroup(useWidths)}<thead><tr>${useHeaders.map((header,index)=>`<th${index===3?' class="num"':''}>${e(header)}</th>`).join('')}</tr></thead><tbody>${useValues.map(values=>`<tr>${values.map((value,index)=>`<td${index===3?' class="num"':''}>${t(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p class="note">Nothing was used in this period.</p>';
  return `<section${breakBefore?' class="pb"':''}>
    <div class="band">${t(item.name)} · ${t(item.unit)}</div>
    <div class="figs"><div><span class="label">Received</span><b>${e(item.received)}</b></div><div><span class="label">Used</span><b>${e(item.used)}</b></div><div class="strong"><span class="label">On hand now</span><b>${e(item.onHand)}</b></div></div>
    <div class="band">BATCHES</div>${batches}
    <div class="band">USES</div>${uses}
    ${item.cancelledNote?`<p class="note">${e(item.cancelledNote)}</p>`:''}
  </section>`;
}

export function buildStockReportHtml(report:StockReport,company:StockReportCompany):string{
  const running=`${company.companyName} · ${report.title} · ${report.scopeLabel}`;
  const summary=[['Scope',report.scopeLabel],['Period',report.rangeLabel],['Prices',report.pricesIncluded?'Included':'Excluded'],['Items',String(report.items.length)]].map(([label,value])=>`<div><span class="label">${e(label)}</span><b>${t(value)}</b></div>`).join('');
  const headers=['Item','Unit','Received','Used','On hand now','Open batches'];
  const values=report.summary.map(row=>[row.item,row.unit,row.received,row.used,row.onHand,String(row.openBatches)]);
  const widths=columnWidths(headers.map((header,index)=>({header,kind:index>=2?'amount' as const:'text' as const,cells:values.map(row=>row[index]??'')})));
  const summaryTable=report.isSingle?'':`<div class="band">STOCK ON HAND</div><table>${colgroup(widths)}<thead><tr>${headers.map((header,index)=>`<th${index>=2?' class="num"':''}>${e(header)}</th>`).join('')}</tr></thead><tbody>${values.map(row=>`<tr>${row.map((value,index)=>`<td${index>=2?' class="num"':''}>${t(value)}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="note">Each unit is shown on its own line. Bags, tons and gallons are never added together. Received and Used are for the period; On hand is what is left now.</p>`;
  const sections=report.items.map((item,index)=>itemSection(item,report.pricesIncluded,!report.isSingle||index>0)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(report.title)}</title><style>
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
    .figs{display:flex;gap:2.5mm}.figs div{flex:1;min-width:0;border:1px solid #CFC5B3;border-radius:2mm;padding:2mm 3mm;text-align:right}.figs .label{display:block;font-size:6.5pt;text-transform:uppercase;color:#5A6570;font-weight:700;text-align:left}.figs b{font-size:13pt;font-variant-numeric:tabular-nums;white-space:nowrap}.figs .strong{border-color:#173F67;background:#F1F5F9}.figs .strong b{color:#173F67}
    table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}
    th{text-align:left;color:#173F67;font-size:7pt;border-bottom:1.5px solid #173F67;padding:1.2mm 1.6mm;vertical-align:bottom}
    td{padding:1.4mm 1.6mm;border-bottom:.3mm solid #EAE3D7;vertical-align:top;overflow-wrap:anywhere}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .pb{break-before:page}
    .note{color:#5A6570;font-size:7.5pt;margin:2mm 0 0}
  </style></head><body>
    <div class="head"><div>${company.logo?`<img class="logo" src="${company.logo}" alt=""/>`:''}<div class="brand">${t(company.companyName)}</div>${company.contactLine?`<div class="contact">${t(company.contactLine)}</div>`:''}</div>
      <div class="head-right"><h1>${e(report.title)}</h1><div class="when">${e(when(report.exportedAt))}${report.pricesIncluded?' · with prices':''}</div></div></div>
    <div class="summary">${summary}</div>
    ${summaryTable}
    ${sections}
    <p class="note">A cancelled batch or use is listed and never counted.${report.pricesIncluded?' A batch without a price says Unpriced and is never treated as zero; an amount includes VAT only where the batch has it.':''}</p>
  </body></html>`;
}
