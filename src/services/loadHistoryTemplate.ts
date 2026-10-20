import { NOT_RECORDED, type LoadHistoryPdfRow } from '../domain/loadHistoryPdf';
import { breakAfterHyphens, colgroup, columnWidths, type ColumnSpec } from './pdfColumns';
import { reportCss } from './pdfTheme';

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
/** Date and time, Load No., Item, Supplier, Customer, Driver, Truck plate, Quantity, Status: widths from the content, 100% in all (see pdfColumns.ts). */
export function loadHistoryWidths(rows: readonly LoadHistoryPdfRow[]): number[] {
  const NR = NOT_RECORDED;
  const specs: ColumnSpec[] = [
    { header: 'Date, time', cells: rows.map((row) => day(row.recordedAt)) },
    { header: 'Load No.', kind: 'code', cells: rows.flatMap((row) => [row.loadNumber ?? row.loadNumberLabel, `Transaction ${row.transaction}`]) },
    { header: 'Item', cells: rows.map((row) => row.item) },
    { header: 'Supplier', cells: rows.map((row) => row.supplier) },
    { header: 'Customer', cells: rows.map((row) => row.customer) },
    { header: 'Driver', cells: rows.map((row) => row.driver ?? NR) },
    { header: 'Truck plate', cells: rows.map((row) => row.truckPlate ?? NR) },
    { header: 'Quantity', kind: 'number', cells: rows.map((row) => row.quantityText) },
    { header: 'Status', cells: rows.map((row) => row.statusLabel) },
  ];
  return columnWidths(specs);
}

export function buildLoadHistoryHtml(input: LoadHistoryPdf): string {
  const rows = input.rows.map((row) => `<tr>
    <td>${e(day(row.recordedAt))}<div class="muted">${e(time(row.recordedAt))}</div></td>
    <td>${row.loadNumber ? `<span class="ln">${breakAfterHyphens(e(row.loadNumber))}</span>` : `<span class="legacy">${e(row.loadNumberLabel)}</span>`}<div class="muted">Transaction ${breakAfterHyphens(e(row.transaction))}</div></td>
    <td>${t(row.item)}</td><td>${t(row.supplier)}</td><td>${t(row.customer)}</td><td>${orMissing(row.driver)}</td><td>${orMissing(row.truckPlate)}</td>
    <td class="num">${e(row.quantityText)}</td>
    <td><b>${e(row.statusLabel)}</b>${row.statusNote ? `<div class="muted">${e(row.statusNote)}</div>` : ''}</td></tr>`).join('');
  const head = ['Date, time', 'Load No.', 'Item', 'Supplier', 'Customer', 'Driver', 'Truck plate', 'Quantity', 'Status'].map((column, position) => `<th${position === 7 ? ' class="num"' : ''}>${e(column)}</th>`).join('');
  // One Total row per unit under the list: each unit is totalled on its own and never added to another.
  const totalRows = input.totals.map((total) => `<tr class="total-row"><td colspan="7">Total · ${total.loadCount} load${total.loadCount === 1 ? '' : 's'}</td><td class="num">${e(`${Math.round(total.quantity * 1000) / 1000} ${total.unitSymbol}`.trim())}</td><td></td></tr>`).join('');
  const running = `${input.companyName} · Load History · Export only, no records changed`;
  const summary = input.summary;
  // The section bar is the first row of the table header, so it repeats on every page above the column titles.
  const bar = `<div class="block-bar"><span class="block-index">1</span><span class="block-name">All loads, newest first</span></div>`;
  const tile = (label: string, value: string) => `<div class="tile"><span class="figure-label">${e(label)}</span><b>${value}</b></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Load History</title><style>
    @page{size:A4;margin:12mm 11mm 16mm;@bottom-left{content:"${css(running)}";font-size:7.5pt;color:#5A6570}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#5A6570}}
    @media screen{body{max-width:210mm;margin:0 auto;padding:12mm}}
    ${reportCss()}
    body{font-size:8.5pt}
    .brand{font-size:11pt;font-weight:700;color:#173F67;overflow-wrap:anywhere}
    .tile b{font-size:9.5pt;color:#1F2933;overflow-wrap:anywhere}
    .grid{table-layout:fixed}
    .ln{font-weight:700;color:#173F67}.legacy{color:#52606D;font-style:italic}
    .empty{margin:0;padding:3mm 3.5mm;color:#6B7681;font-style:italic}
  </style></head><body>
    <div class="head"><div>${input.logo ? `<img class="logo" src="${input.logo}" alt=""/>` : ''}<div class="brand">${t(input.companyName)}</div>${input.contactLine ? `<div class="contact">${t(input.contactLine)}</div>` : ''}</div>
      <div class="head-right"><h1>Load History</h1><div class="when">${e(day(input.generatedAt))}, ${e(time(input.generatedAt))}</div></div></div>
    <div class="tiles">${tile('Period', t(summary.period))}${tile('Customer', t(summary.customer))}${tile('Items', t(summary.items))}${tile('Status', t(summary.status))}${tile('Loads listed', e(summary.listed))}</div>
    <section class="block table-block" data-kind="load-history">
      <div class="block-body">${input.rows.length ? `<table class="loads grid">${colgroup(loadHistoryWidths(input.rows))}<thead><tr class="bar-row"><th colspan="9">${bar}</th></tr><tr>${head}</tr></thead><tbody>${rows}${totalRows}</tbody></table>` : `${bar}<p class="empty">No active loads match these filters.</p>`}</div></section>
    <div class="notes"><h4>Notes</h4><ol><li>Each unit is totalled on its own and different units are never added together. Cancelled loads are never included.</li><li>A load with no driver or plate recorded says Not recorded. This is a list of loads, not an invoice or bill.</li></ol></div>
  </body></html>`;
}
