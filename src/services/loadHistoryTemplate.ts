import { NOT_RECORDED, type LoadHistoryPdfRow } from '../domain/loadHistoryPdf';

/**
 * Phase 5. The Load History export as an A4 PDF: the company header, a summary strip (Period, Customer, Items,
 * Status, Loads listed), one table of the Active loads newest first, the totals per unit, and a footer on every
 * page with the company name and the page number. Every fact has its own column and the widths add up to exactly
 * 100%; numbers are right-aligned, long names wrap, and the headings repeat on every page. It is a list only: it
 * changes no record. Cancelled loads are never in it.
 */
export type LoadHistoryPdf = {
  companyName: string;
  logo: string | null;
  contactLine: string | null;
  generatedAt: string;
  summary: { period: string; customer: string; items: string; status: string; listed: string };
  rows: LoadHistoryPdfRow[];
  totals: { unitSymbol: string; quantity: number; loadCount: number }[];
};

const e = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
const t = (value: unknown) => `<span dir="auto">${e(value)}</span>`;
const css = (value: string) => value.replace(/["\\]/g, '').replace(/\r?\n/g, ' ');
const two = (value: number) => String(value).padStart(2, '0');
const day = (raw: string) => { const date = new Date(raw); return Number.isNaN(date.getTime()) ? raw.slice(0, 10) : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const time = (raw: string) => { const date = new Date(raw); return Number.isNaN(date.getTime()) ? '' : `${two(date.getHours())}:${two(date.getMinutes())}`; };
const missing = `<span class="missing">${NOT_RECORDED}</span>`;
const orMissing = (value: string | null) => (value ? t(value) : missing);
/** Date and time, Load No., Item, Supplier, Customer, Driver, Truck plate, Quantity, Status: 100% in all. */
export const LOAD_HISTORY_WIDTHS = [11, 10, 12, 11, 12, 11, 9, 9, 15] as const;

export function buildLoadHistoryHtml(input: LoadHistoryPdf): string {
  const rows = input.rows.map((row) => `<tr>
    <td class="nowrap">${e(day(row.recordedAt))}<div class="muted">${e(time(row.recordedAt))}</div></td>
    <td>${row.loadNumber ? `<span class="ln">${e(row.loadNumber)}</span>` : `<span class="legacy">${e(row.loadNumberLabel)}</span>`}<div class="muted">Transaction ${e(row.transaction)}</div></td>
    <td>${t(row.item)}</td><td>${t(row.supplier)}</td><td>${t(row.customer)}</td><td>${orMissing(row.driver)}</td><td>${orMissing(row.truckPlate)}</td>
    <td class="num">${e(row.quantityText)}</td>
    <td><b>${e(row.statusLabel)}</b>${row.statusNote ? `<div class="muted">${e(row.statusNote)}</div>` : ''}</td></tr>`).join('');
  const head = ['Date, time', 'Load No.', 'Item', 'Supplier', 'Customer', 'Driver', 'Truck plate', 'Quantity', 'Status'].map((column, position) => `<th${position === 7 ? ' class="num"' : ''}>${e(column)}</th>`).join('');
  const totals = input.totals.map((total) => `<span class="pill">${e(`${Math.round(total.quantity * 1000) / 1000} ${total.unitSymbol}`.trim())} · ${total.loadCount} load${total.loadCount === 1 ? '' : 's'}</span>`).join('');
  const running = `${input.companyName} · Load History · Export only, no records changed`;
  const summary = input.summary;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Load History</title><style>
    @page{size:A4;margin:12mm 11mm 16mm;@bottom-left{content:"${css(running)}";font-size:7.5pt;color:#5A6570}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#5A6570}}
    @media screen{body{max-width:210mm;margin:0 auto;padding:12mm}}
    *{box-sizing:border-box}
    body{font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif;color:#17212B;font-size:8.5pt;line-height:1.35}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;border-bottom:2px solid #C84B31;padding-bottom:4mm;margin-bottom:3mm}
    .logo{max-width:40mm;max-height:18mm;object-fit:contain;display:block;margin-bottom:1.5mm}
    .brand{font-size:11pt;font-weight:700;color:#173F67;overflow-wrap:anywhere}.contact{font-size:8pt;color:#444;margin-top:.5mm;overflow-wrap:anywhere}
    h1{font-size:18pt;color:#173F67;margin:0;text-align:right}.head-right{text-align:right}.when{color:#5A6570;font-size:8.5pt;margin-top:1mm}
    .summary{display:flex;gap:2.5mm;margin:0 0 4mm}.summary div{flex:1;min-width:0;border:1px solid #E3DBCD;border-radius:2mm;background:#FBF9F4;padding:2mm 3mm}
    .summary .label{display:block;color:#5A6570;font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.3px}.summary b{font-size:9pt;overflow-wrap:anywhere}
    .block{border:1px solid #CFC5B3;border-radius:3mm;margin:0 0 5mm;overflow:hidden;background:#FFFFFF}
    .block-bar{display:flex;align-items:center;gap:3mm;background:#173F67;color:#FFF8ED;padding:2.4mm 4mm;break-after:avoid;break-inside:avoid}
    .block-index{flex:0 0 7mm;height:7mm;border-radius:1.6mm;background:#C84B31;color:#FFFFFF;font-weight:700;display:flex;align-items:center;justify-content:center}
    .block-name{flex:1;font-size:12pt;font-weight:700}.block-body{padding:2mm 3mm 3mm}
    table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}
    th{text-align:left;color:#173F67;font-size:7pt;border-bottom:1.5px solid #173F67;padding:1.4mm 1.6mm;vertical-align:bottom}
    td{padding:1.4mm 1.6mm;border-bottom:.3mm solid #EAE3D7;vertical-align:top;overflow-wrap:anywhere}
    tbody tr:nth-child(even) td{background:#FAF8F4}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.nowrap{white-space:nowrap}
    .muted{color:#5A6570;font-size:7pt;font-weight:400}.missing{color:#5A6570;font-style:italic;font-weight:400}
    .ln{font-weight:700;color:#173F67;white-space:nowrap}.legacy{color:#5A6570;font-style:italic}
    .totals{display:flex;flex-wrap:wrap;gap:2mm;margin:3mm 0 0;break-inside:avoid}.pill{display:inline-block;border-radius:5mm;padding:.8mm 2.6mm;font-size:8.5pt;font-weight:700;background:#FBE9E4;color:#8E2E1B;white-space:nowrap}
    .note{color:#5A6570;font-size:7.5pt;margin-top:3mm}.empty{margin:0;color:#5A6570;font-style:italic}
  </style></head><body>
    <div class="head"><div>${input.logo ? `<img class="logo" src="${input.logo}" alt=""/>` : ''}<div class="brand">${t(input.companyName)}</div>${input.contactLine ? `<div class="contact">${t(input.contactLine)}</div>` : ''}</div>
      <div class="head-right"><h1>Load History</h1><div class="when">${e(day(input.generatedAt))}, ${e(time(input.generatedAt))}</div></div></div>
    <div class="summary"><div><span class="label">Period</span><b>${t(summary.period)}</b></div><div><span class="label">Customer</span><b>${t(summary.customer)}</b></div><div><span class="label">Items</span><b>${t(summary.items)}</b></div><div><span class="label">Status</span><b>${t(summary.status)}</b></div><div><span class="label">Loads listed</span><b>${e(summary.listed)}</b></div></div>
    <section class="block" data-kind="load-history"><div class="block-bar"><span class="block-index">1</span><span class="block-name">All loads, newest first</span></div>
      <div class="block-body">${input.rows.length ? `<table class="loads"><colgroup>${LOAD_HISTORY_WIDTHS.map((width) => `<col style="width:${width}%"/>`).join('')}</colgroup><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">No active loads match these filters.</p>'}</div></section>
    ${totals ? `<div class="totals">${totals}</div>` : ''}
    <p class="note">Each unit is totalled on its own and different units are never added together. Cancelled loads are never included. A load with no driver or plate recorded says Not recorded. This is a list of loads, not an invoice or bill.</p>
  </body></html>`;
}
