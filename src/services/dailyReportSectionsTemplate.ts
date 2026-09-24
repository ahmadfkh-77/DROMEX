import {normalizeCustomResourceSnapshots,type CustomResourceSnapshot} from '../domain/customDirectories';
import type {LinkedQuarryLoad} from '../domain/projectReports';
import {groupSupplierLoads,type UnitQuantity} from '../domain/supplierLoadGroups';
import {normalizeSupervisorSignoffs,type SupervisorSignoffSnapshot} from '../domain/supervisors';

/**
 * Daily Report PDF sections added by DEC-478 and DEC-479, kept out of projectReportWasteTemplate.ts so
 * that file only places them. Every value printed here comes from the report's own saved snapshot:
 * nothing is looked up from a directory at render time, so a later rename or archive never changes an
 * issued report. All custom text is escaped, and `dir="auto"` lets an Arabic or mixed name lay itself out.
 */
const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
const cell=(value:string|null)=>value?`<td dir="auto">${e(value)}</td>`:'<td class="resource-missing">&mdash;</td>';

/** DEC-478. One block per selected directory, in the recorded order; an empty directory prints nothing. */
export function customResourcesHtml(snapshots:readonly CustomResourceSnapshot[]|undefined):string{
  const groups=normalizeCustomResourceSnapshots(snapshots??[]);
  if(!groups.length)return '';
  return groups.map(group=>`<div class="resource-group"><h3 class="resource-head" dir="auto">${e(group.directoryName)}</h3><table class="resource-table"><thead><tr><th>Name</th><th>Identifier</th><th>Note</th></tr></thead><tbody>${
    group.entries.map(entry=>`<tr>${cell(entry.name)}${cell(entry.identifier)}${cell(entry.note)}</tr>`).join('')
  }</tbody></table></div>`).join('');
}

const fmt=(value:number)=>Number.isInteger(value)?String(value):value.toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
const money=(value:number)=>`$${value.toFixed(2)}`;
/** A money subtotal that never shows a false $0.00: all-unpriced reads Unpriced, a mix names the unpriced count. */
const pricedLabel=(usd:{pricedTotalUsd:number;unpricedCount:number},loadCount:number)=>
  usd.unpricedCount>=loadCount?'Unpriced':`${money(usd.pricedTotalUsd)}${usd.unpricedCount?` + ${usd.unpricedCount} unpriced`:''}`;

/**
 * DEC-480. Supplier Loads grouped Item -> Supplier -> loads, from the shared domain grouping. Each item is
 * its own table whose heading row sits inside <thead>, so the item name and column headings repeat at the
 * top of every page the item continues on. A supplier's loads and subtotals form one tbody kept together
 * where it fits; subtotal and item-total rows never split from their values. Quantity is the last data
 * column so every subtotal sits directly under it, one row per unit -- there is never a figure that adds
 * tonnes to cubic metres. Levels are told apart by words and rule weight, so the table reads in grayscale.
 */
export function supplierLoadsHtml(loads:readonly LinkedQuarryLoad[],includePrices:boolean):string{
  const groups=groupSupplierLoads(loads);
  const columns=includePrices?6:5;
  if(!groups.length)return `<table class="table-accent-supplier"><tbody><tr><td colspan="${columns}" class="empty">No project-linked supplier loads for this date</td></tr></tbody></table>`;
  const head=`<tr><th>Reference</th><th>Delivery</th><th>Truck</th><th>Ticket</th><th>Quantity</th>${includePrices?'<th>Total</th>':''}</tr>`;
  // One fixed column set for every item table, so quantities and totals line up from item to item.
  const widths=includePrices?[20,24,14,12,14,16]:[24,30,16,14,16];
  const colgroup=`<colgroup>${widths.map(width=>`<col style="width:${width}%">`).join('')}</colgroup>`;
  const quantityRows=(cls:string,label:string,values:UnitQuantity[],usd:{pricedTotalUsd:number;unpricedCount:number})=>values.map((value,index)=>
    `<tr class="${cls}"><td colspan="4" dir="auto">${e(label)}</td><td class="number">${fmt(value.quantity)} ${e(value.unitSymbol)}</td>${includePrices?`<td class="number">${index===0?pricedLabel(usd,values.reduce((sum,value)=>sum+value.loadCount,0)):''}</td>`:''}</tr>`).join('');
  return groups.map(item=>`<table class="table-accent-supplier supplier-table">${colgroup}<thead><tr class="item-heading"><th colspan="${columns}" dir="auto">${e(item.itemName)}</th></tr>${head}</thead>${
    item.suppliers.map(supplier=>`<tbody class="supplier-group"><tr class="supplier-heading"><td colspan="${columns}" dir="auto">${e(supplier.supplierName)}</td></tr>${
      supplier.loads.map(load=>`<tr><td>${e(load.purchaseNumber)}</td><td dir="auto">${e(load.deliveryLabel)}</td><td>${load.truckPlate?e(load.truckPlate):'&mdash;'}</td><td>${load.supplierTicketNumber?e(load.supplierTicketNumber):'&mdash;'}</td><td class="number">${fmt(load.quantity)} ${e(load.unitSymbol)}</td>${includePrices?`<td class="number">${load.finalTotalUsd==null?'Unpriced':money(load.finalTotalUsd)}</td>`:''}</tr>`).join('')
    }${quantityRows('subtotal-row',`Supplier subtotal · ${supplier.supplierName}`,supplier.subtotals,supplier)}</tbody>`).join('')
  }<tbody class="item-total">${quantityRows('item-total-row',`Item total delivered · ${item.itemName}`,item.totals,item)}</tbody></table>`).join('');
}

/**
 * DEC-479. Supervisor Sign-off, closing the report. Each supervisor is one block that never splits
 * across a page. A chosen signature is drawn from the report's own stroke copy with
 * `preserveAspectRatio="xMidYMid meet"`, so it is scaled evenly and never stretched or cropped; strokes
 * are re-validated here, so nothing but move/line path data can reach the document. A name-only
 * sign-off is a complete record in its own right and says so, rather than leaving an empty signing box.
 */
export function supervisorSignoffHtml(snapshots:readonly SupervisorSignoffSnapshot[]|undefined):string{
  const signoffs=normalizeSupervisorSignoffs(snapshots??[]);
  if(!signoffs.length)return '';
  const blocks=signoffs.map(signoff=>{
    const signed=signoff.display==='name_with_signature'&&signoff.signature.length>0;
    const mark=signed
      ?`<svg class="signoff-signature" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Signature">${signoff.signature.map(stroke=>`<path d="${e(stroke)}" fill="none" stroke="#17212b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`
      :'<div class="signoff-by-name">Sign-off recorded by name</div>';
    return `<div class="signoff-block${signed?'':' signoff-name-only'}"><div class="signoff-mark">${mark}</div><div class="signoff-name" dir="auto">${e(signoff.name)}</div>${signoff.jobTitle?`<div class="signoff-title" dir="auto">${e(signoff.jobTitle)}</div>`:''}</div>`;
  }).join('');
  return `<section class="signoff-section"><h2 class="keep-next">Supervisor Sign-off</h2><div class="signoff-grid">${blocks}</div></section>`;
}

/**
 * Print rules for the sections above. A directory block stays on one page when it can; its heading
 * never strands at the foot of a page, and a long table breaks only between rows.
 */
export const DAILY_REPORT_SECTIONS_CSS=`
    .keep-next{break-after:avoid;page-break-after:avoid}
    .resource-group{margin-top:3mm;break-inside:avoid;page-break-inside:avoid}
    .resource-head{margin:0 0 1.2mm;font-size:9.5pt;font-weight:800;color:#173f67;letter-spacing:.2pt;break-after:avoid;page-break-after:avoid;overflow-wrap:anywhere}
    .resource-table{table-layout:fixed}.resource-table th:nth-child(1){width:38%}.resource-table th:nth-child(2){width:22%}
    .resource-table td{overflow-wrap:anywhere}.resource-table tr{break-inside:avoid;page-break-inside:avoid}
    .resource-missing{color:#65717d}
    .supplier-table{margin-bottom:3mm;table-layout:fixed}
    .supplier-table td,.supplier-table th{overflow-wrap:anywhere}
    .supplier-table .item-heading th{background:#173f67;color:#fff;font-size:9pt;font-weight:800;letter-spacing:.3pt;text-transform:uppercase;overflow-wrap:anywhere}
    .supplier-group{break-inside:avoid;page-break-inside:avoid}
    .supplier-heading td{font-weight:800;color:#17212b;background:#f5f2ec;border-top:1.5px solid #17212b;overflow-wrap:anywhere}
    .subtotal-row,.item-total-row{break-inside:avoid;page-break-inside:avoid}
    .subtotal-row td{font-weight:700;font-style:italic;border-top:1px solid #65717d}
    .item-total-row td{font-weight:900;border-top:2px solid #17212b;background:#fff8ed}
    .signoff-section{margin-top:5mm}
    .signoff-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5mm}
    .signoff-block{break-inside:avoid;page-break-inside:avoid;padding:3mm 4mm 3.5mm;border:1px solid #d9d5ce;border-top:3px solid #173f67;background:#fff}
    .signoff-mark{height:24mm;border-bottom:1px solid #17212b;display:flex;align-items:flex-end;justify-content:center}
    .signoff-signature{width:100%;height:22mm;display:block}
    .signoff-by-name{align-self:center;margin:auto 0;font-size:8pt;font-weight:700;letter-spacing:.4pt;text-transform:uppercase;color:#65717d}
    .signoff-name-only .signoff-mark{border-bottom-style:dashed;border-bottom-color:#9aa3aa}
    .signoff-name{margin-top:2mm;font-size:10.5pt;font-weight:800;color:#17212b;overflow-wrap:anywhere}
    .signoff-title{margin-top:.6mm;font-size:8.5pt;color:#65717d;overflow-wrap:anywhere}`;
