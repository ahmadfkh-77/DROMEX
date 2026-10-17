import { dumpsText, type WasteDriverLine, type WasteHistory, type WasteProjectBlock } from '../domain/wasteHistory';
import { colgroup, columnWidths } from './pdfColumns';

/**
 * The Waste Dump History as an A4 PDF, grouped the way the screen is: one block per day (newest first) with the day total, inside
 * it each project (its name in the project colour, its location in grey under it), each driver's dumps and the project total;
 * then the period totals per driver inside each project and, optionally, each driver over all projects. A dump has no quantity
 * or unit, so every number is a count of dumps. Cancelled dumps are never counted. The word PROJECT stays beside each name, so a
 * black and white print reads the same. It is a list only: it changes no record.
 */
export type WasteHistoryPdf = {
  companyName: string;
  logo: string | null;
  contactLine: string | null;
  generatedAt: string;
  /** "All locations" or the name of the one project or company site. */
  projectLabel: string;
  periodLabel: string;
  history: WasteHistory;
  includeAllProjectsDriverTotals: boolean;
};

/** The project and site name colour (colors.brand). */
export const NAME_COLOUR = '#C84B31';

const e = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
const t = (value: unknown) => `<span dir="auto">${e(value)}</span>`;
const css = (value: string) => value.replace(/["\\]/g, '').replace(/\r?\n/g, ' ');
const two = (value: number) => String(value).padStart(2, '0');
const stamp = (raw: string) => { const date = new Date(raw); return Number.isNaN(date.getTime()) ? raw.slice(0, 10) : `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${two(date.getHours())}:${two(date.getMinutes())}`; };

/** Driver and Dumps: the driver column takes the room it needs and Dumps stays narrow, 100% in all. */
export function wasteDriverWidths(drivers: readonly WasteDriverLine[]): number[] {
  return columnWidths([
    { header: 'Driver', cells: drivers.map((driver) => driver.name) },
    { header: 'Dumps', kind: 'number', cells: drivers.map((driver) => String(driver.count)) },
  ]);
}

function projectBlock(block: WasteProjectBlock): string {
  const totalLabel = block.locationType === 'company_site' ? 'Site total' : 'Project total';
  return `<div class="proj"><div class="proj-top"><span class="ty">${block.locationType === 'company_site' ? 'COMPANY SITE' : 'PROJECT'}</span><span class="pname">${t(block.projectName)}</span></div>
    ${block.location ? `<div class="loc">${t(block.location)}</div>` : ''}
    <table>${colgroup(wasteDriverWidths(block.drivers))}<thead><tr><th>Driver</th><th class="num">Dumps</th></tr></thead><tbody>${block.drivers.map((driver) => `<tr><td>${t(driver.name)}</td><td class="num">${driver.count}</td></tr>`).join('')}<tr class="tot"><td>${e(totalLabel)}</td><td class="num">${block.total}</td></tr></tbody></table></div>`;
}

function driversTable(drivers: readonly WasteDriverLine[], totalLabel: string, total: number): string {
  return `<table>${colgroup(wasteDriverWidths(drivers))}<thead><tr><th>Driver</th><th class="num">Dumps</th></tr></thead><tbody>${drivers.map((driver) => `<tr><td>${t(driver.name)}</td><td class="num">${driver.count}</td></tr>`).join('')}<tr class="tot"><td>${e(totalLabel)}</td><td class="num">${total}</td></tr></tbody></table>`;
}

export function buildWasteHistoryHtml(input: WasteHistoryPdf): string {
  const history = input.history;
  const days = history.days.map((day) => `<section class="block"><div class="block-bar"><span class="block-name">${e(day.label)}</span><span class="block-total">${e(dumpsText(day.total))}</span></div>
      <div class="block-body">${day.projects.map((block) => projectBlock(block)).join('')}</div></section>`).join('');
  const periodProjects = history.periodProjects.map((block) => projectBlock(block)).join('');
  const running = `${input.companyName} · Waste Dump History · Export only, no records changed`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Waste Dump History</title><style>
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
    .band{background:#173F67;color:#FFF8ED;font-weight:700;letter-spacing:.6px;padding:1.6mm 3mm;margin:4mm 0 2mm;border-radius:1.6mm;break-after:avoid;font-size:8.5pt}
    .block{border:1px solid #CFC5B3;border-radius:3mm;margin:0 0 4mm;overflow:hidden;background:#FFFFFF}
    .block-bar{display:flex;align-items:center;justify-content:space-between;gap:3mm;background:#173F67;color:#FFF8ED;padding:2.2mm 4mm;break-after:avoid;break-inside:avoid}
    .block-name{font-size:11pt;font-weight:700}.block-total{font-size:10pt;font-weight:700}.block-body{padding:2mm 3mm 1mm}
    .proj{margin:0 0 3mm;break-inside:avoid}.proj-top{display:flex;align-items:baseline;gap:2mm;break-after:avoid}
    .ty{font-size:6.5pt;font-weight:700;letter-spacing:.6px;color:#173F67}
    .pname{font-size:10.5pt;font-weight:700;color:${NAME_COLOUR};overflow-wrap:anywhere}
    .loc{color:#5A6570;font-size:8pt;margin:0 0 1mm;overflow-wrap:anywhere}
    table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}
    th{text-align:left;color:#173F67;font-size:7pt;border-bottom:1.5px solid #173F67;padding:1.2mm 1.6mm;vertical-align:bottom}
    td{padding:1.2mm 1.6mm;border-bottom:.3mm solid #EAE3D7;vertical-align:top;overflow-wrap:anywhere}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    tr.tot td{font-weight:700;color:#173F67;border-bottom:none;border-top:1.5px solid #173F67}
    .card{border:1px solid #CFC5B3;border-radius:3mm;padding:3mm 4mm;margin:0 0 4mm;break-inside:avoid}.card h3{margin:0 0 2mm;font-size:10pt;color:#173F67}
    .note{color:#5A6570;font-size:7.5pt;margin-top:3mm}.empty{margin:0;color:#5A6570;font-style:italic}
  </style></head><body>
    <div class="head"><div>${input.logo ? `<img class="logo" src="${input.logo}" alt=""/>` : ''}<div class="brand">${t(input.companyName)}</div>${input.contactLine ? `<div class="contact">${t(input.contactLine)}</div>` : ''}</div>
      <div class="head-right"><h1>Waste Dump History</h1><div class="when">${e(stamp(input.generatedAt))}</div></div></div>
    <div class="summary"><div><span class="label">Period</span><b>${t(input.periodLabel)}</b></div><div><span class="label">Location</span><b>${t(input.projectLabel)}</b></div><div><span class="label">Days</span><b>${history.days.length}</b></div><div><span class="label">Dumps counted</span><b>${history.total}</b></div></div>
    ${history.days.length ? `<div class="band">DAY BY DAY, NEWEST FIRST</div>${days}
    <div class="band">PERIOD TOTALS PER DRIVER</div>
    <div class="card">${periodProjects}</div>
    ${input.includeAllProjectsDriverTotals ? `<div class="card"><h3>Each driver, all projects</h3>${driversTable(history.periodDrivers, 'All drivers', history.total)}</div>` : ''}` : '<p class="empty">No waste dumps were counted in this period.</p>'}
    <p class="note">Every number is a count of dumps; a waste dump has no quantity or unit. Cancelled dumps are never counted${history.cancelledCount ? ` (${history.cancelledCount} cancelled in this period were left out)` : ''}. A dump with no driver recorded is listed as No driver. This is a list only, not an invoice or bill.</p>
  </body></html>`;
}
