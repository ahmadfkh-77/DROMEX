import { dumpsText, type WasteDriverLine, type WasteHistory, type WasteProjectBlock } from '../domain/wasteHistory';
import { colgroup, columnWidths } from './pdfColumns';
import { reportCss } from './pdfTheme';

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
    ${reportCss()}
    body{font-size:8.5pt}
    .brand{font-size:11pt;font-weight:700;color:#173F67;overflow-wrap:anywhere}
    .tile b{font-size:9.5pt;color:#1F2933;overflow-wrap:anywhere}
    .band{font-weight:700;letter-spacing:.6px;color:#173F67;border-bottom:.8mm solid #C84B31;padding:1.6mm 0;margin:5mm 0 3mm;break-after:avoid;font-size:8.5pt}
    .block{margin:0 0 4mm}
    .block-total{font-size:10pt;font-weight:700}
    .proj{margin:0 0 3mm;break-inside:avoid}.proj-top{display:flex;align-items:baseline;gap:2mm;break-after:avoid}
    .ty{font-size:6.5pt;font-weight:700;letter-spacing:.6px;color:#173F67}
    .pname{font-size:10.5pt;font-weight:700;color:${NAME_COLOUR};overflow-wrap:anywhere}
    .loc{color:#52606D;font-size:8pt;margin:0 0 1mm;overflow-wrap:anywhere}
    table{table-layout:fixed}
    tbody tr.tot td{font-weight:700;color:#173F67;background:#F5F7FA;border-top:.45mm solid #173F67;border-bottom:none}
    .card{border:.35mm solid #9FB0C2;padding:3mm 3.5mm;margin:0 0 4mm;break-inside:avoid;background:#FFFFFF}.card h3{margin:0 0 2mm;font-size:10pt;color:#173F67}
  </style></head><body>
    <div class="head"><div>${input.logo ? `<img class="logo" src="${input.logo}" alt=""/>` : ''}<div class="brand">${t(input.companyName)}</div>${input.contactLine ? `<div class="contact">${t(input.contactLine)}</div>` : ''}</div>
      <div class="head-right"><h1>Waste Dump History</h1><div class="when">${e(stamp(input.generatedAt))}</div></div></div>
    <div class="tiles"><div class="tile"><span class="figure-label">Period</span><b>${t(input.periodLabel)}</b></div><div class="tile"><span class="figure-label">Location</span><b>${t(input.projectLabel)}</b></div><div class="tile"><span class="figure-label">Days</span><b>${history.days.length}</b></div><div class="tile"><span class="figure-label">Dumps counted</span><b>${history.total}</b></div></div>
    ${history.days.length ? `<div class="band">DAY BY DAY, NEWEST FIRST</div>${days}
    <div class="band">PERIOD TOTALS PER DRIVER</div>
    <div class="card">${periodProjects}</div>
    ${input.includeAllProjectsDriverTotals ? `<div class="card"><h3>Each driver, all projects</h3>${driversTable(history.periodDrivers, 'All drivers', history.total)}</div>` : ''}` : '<p class="empty">No waste dumps were counted in this period.</p>'}
    <div class="notes"><h4>Notes</h4><ol><li>Every number is a count of dumps; a waste dump has no quantity or unit. Cancelled dumps are never counted${history.cancelledCount ? ` (${history.cancelledCount} cancelled in this period were left out)` : ''}.</li><li>A dump with no driver recorded is listed as No driver. This is a list only, not an invoice or bill.</li></ol></div>
  </body></html>`;
}
