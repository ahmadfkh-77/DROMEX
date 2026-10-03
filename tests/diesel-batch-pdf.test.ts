import {describe,expect,it} from 'vitest';

import type {DieselBatchReport} from '../src/domain/dieselBatchReport';
import {buildDieselBatchReportHtml} from '../src/services/dieselBatchTemplate';

/** DEC-492, Screen F. The printed layout of the Diesel Batch Report. */
const report=(extra:Partial<DieselBatchReport>={}):DieselBatchReport=>({
  scopeLabel:'DSL-2026-00004 · Invoice 55821',
  metadata:[{label:'Batch',value:'DSL-2026-00004'},{label:'Exported',value:'Sat 3 Oct 2026, 18:42'},{label:'Project filter',value:'All projects'},{label:'Site filter',value:'All sites'},{label:'Station filter',value:'All stations'},{label:'Date range',value:'All dates'},{label:'Prices',value:'Excluded'}],
  summary:{deliveredLitres:1000,filledLitres:640,adjustmentLitres:-20,remainingLitres:340,filteredNote:null},
  sections:[{title:'PROJECTS',destinations:[{name:'مشروع إعادة تأهيل طريق حاصبيا – مرجعيون، المرحلة الثانية',typeLabel:'PROJECT',total:370,totalText:'370 L',totalLabel:'Project total',days:[{label:'Sat 3 Oct 2026',total:130,totalText:'130 L',rows:[{date:'Sat 3 Oct 2026 · 07:40',equipment:'Excavator CAT 320',type:'Machine',source:'Tank · DSL-2026-00004',litres:'130 L'}]}]}]},
    {title:'COMPANY SITES',destinations:[{name:'Main Yard <& Co>',typeLabel:'SITE',total:40,totalText:'40 L',totalLabel:'Site total',days:[{label:'Thu 1 Oct 2026',total:40,totalText:'40 L',rows:[{date:'Thu 1 Oct 2026 · 16:20',equipment:'Generator',type:'Machine',source:'Tank · DSL-2026-00004',litres:'40 L'}]}]}]}],
  batchTotals:[{batchNumber:'DSL-2026-00004',delivered:'1,000 L',deliveryDetail:'Invoice 55821 · Al-Nour Fuel · Thu 1 Oct 2026',filled:'640 L',adjustments:'−20 L',remaining:'340 L',status:'Open · In use'}],
  tank:{litres:'340 L',overfill:'None'},
  destinationTotals:[{label:'Main Yard (Site)',litres:'40 L'},{label:'Total filled',litres:'410 L'}],
  adjustments:[{label:'Dip adjustment · Sat 3 Oct 2026 · DSL-2026-00004',detail:'Calculated remaining 560 L · Dip reading 540 L · Adjustment −20 L'}],
  pricesIncluded:false,empty:false,fileName:'Diesel-Batch-Report-DSL-2026-00004.pdf',...extra,
});
const COMPANY={companyName:'Fakih Asphalt & Contracting',logo:null,contactLine:'Main Road, Hasbaya · +961 70 123 456 · info@fakih.example'};
const html=(extra:Partial<DieselBatchReport>={},company:Parameters<typeof buildDieselBatchReportHtml>[1]=COMPANY)=>buildDieselBatchReportHtml(report(extra),company);

describe('Diesel Batch Report PDF',()=>{
  it('is A4 with the running title and Page X of Y in the margins of every page',()=>{
    const page=html();
    expect(page).toContain('size:A4');
    expect(page).toContain('counter(page)');
    expect(page).toContain('counter(pages)');
    expect(page).toContain('Fakih Asphalt & Contracting · Diesel Batch Report · DSL-2026-00004');
  });
  it('opens with the company, the title, the batch and invoice, every filter written out, and the four figures',()=>{
    const page=html().slice(html().indexOf('<body>'));
    const order=['Fakih Asphalt &amp; Contracting','Main Road, Hasbaya · +961 70 123 456 · info@fakih.example','Diesel Batch Report','DSL-2026-00004 · Invoice 55821','Project filter','Date range','Prices','Delivered','Filled','Adjustments','Remaining'].map(text=>page.indexOf(text));
    expect(order.every(index=>index>=0)).toBe(true);
    expect([...order].sort((a,b)=>a-b)).toEqual(order);
    expect(page).toContain('−20 L');
  });
  it('has navy section bands, a sub-heading per destination, and repeating table headings',()=>{
    const page=html();
    expect(page).toContain('<h2 class="band">PROJECTS</h2>');
    expect(page).toContain('<h2 class="band">COMPANY SITES</h2>');
    expect(page.match(/<thead>/g)!.length).toBeGreaterThanOrEqual(2);
    expect(page).toContain('display:table-header-group');
    expect(page).toContain('<th class="c-date">Date</th><th>Equipment</th><th class="c-type">Type</th><th class="c-src">Source</th><th class="num c-l">Litres</th>');
  });
  it('ends each day with a day total and each destination with its total',()=>{
    const page=html();
    expect(page).toContain('Day total · Sat 3 Oct 2026');
    expect(page).toContain('Project total');
    expect(page).toContain('Site total');
  });
  it('keeps Arabic and long names whole: isolated, wrapping, never truncated',()=>{
    const page=html();
    expect(page).toContain('<bdi dir="auto">مشروع إعادة تأهيل طريق حاصبيا – مرجعيون، المرحلة الثانية</bdi>');
    expect(page).toContain('overflow-wrap:anywhere');
    expect(page).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(page).not.toMatch(/white-space:nowrap;[^}]*overflow:hidden/);
  });
  it('escapes every recorded value',()=>{
    expect(html()).toContain('Main Yard &lt;&amp; Co&gt;');
  });
  it('puts the batch totals, the tank, totals by destination and the dip adjustment on a final page',()=>{
    const page=html();
    const final=page.indexOf('<section class="final">');
    expect(final).toBeGreaterThan(page.indexOf('Project total'));
    for(const text of ['BATCH TOTALS','Invoice 55821 · Al-Nour Fuel · Thu 1 Oct 2026','Diesel in tank now','Overfill Alert','TOTALS BY DESTINATION','Total filled','Dip adjustment · Sat 3 Oct 2026'])expect(page.indexOf(text)).toBeGreaterThan(final);
    expect(page).toContain('break-before:page');
  });
  it('shows no money at all without prices, and price and cost columns with them',()=>{
    expect(html()).not.toContain('Price / L');
    expect(html()).not.toContain('$');
    const priced=html({pricesIncluded:true,sections:[{title:'PROJECTS',destinations:[{name:'Road',typeLabel:'PROJECT',total:130,totalText:'130 L',totalLabel:'Project total',days:[{label:'Sat 3 Oct 2026',total:130,totalText:'130 L',rows:[{date:'Sat 3 Oct 2026 · 07:40',equipment:'Excavator',type:'Machine',source:'Tank · DSL-2026-00004',litres:'130 L',price:'$1.10',cost:'$143.00'}]}]}]}]});
    expect(priced).toContain('Price / L');
    expect(priced).toContain('$143.00');
    // Totals stay under Litres, with the price columns left empty.
    expect(priced).toContain('<td colspan="4">Day total · Sat 3 Oct 2026</td><td class="num">130 L</td><td></td><td></td>');
    expect(priced).toContain('<td colspan="4">Project total</td><td class="num">130 L</td><td></td><td></td>');
    expect(html()).toContain('<td colspan="4">Day total · Sat 3 Oct 2026</td><td class="num">130 L</td></tr>');
  });
  it('states an overfill in words in a bordered box that prints in black and white',()=>{
    const page=html({tank:{litres:'0 L',overfill:'30 L filled with no diesel left in any batch'}});
    expect(page).toContain('Overfill Alert: 30 L filled with no diesel left in any batch');
    expect(page).toContain('.alert{border:1.5px solid');
  });
  it('says so plainly when nothing matches',()=>{
    expect(html({empty:true,sections:[]})).toContain('No fills match these filters.');
  });

  it('uses the company name, logo and contact details from Company Settings, never a fixed DROMEX header',()=>{
    const page=html();
    expect(page).not.toContain('Construction &amp; Plant Management');
    expect(page).not.toContain('Construction & Plant Management');
    expect(page).toContain('<div class="brand">Fakih Asphalt &amp; Contracting</div>');
    expect(html({},{...COMPANY,logo:'data:image/png;base64,AAAA'})).toContain('<img class="logo" src="data:image/png;base64,AAAA"/>');
    expect(page).not.toContain('<img class="logo"');
    expect(html({},{...COMPANY,contactLine:null})).not.toContain('class="contact"');
  });
});

describe('Diesel Batch Report header layout (Owner, 2026-10-04)',()=>{
  it('puts the logo at the top left with the company name under it in a smaller font',()=>{
    const page=buildDieselBatchReportHtml(report(),{companyName:'Fakih Asphalt',logo:'data:image/png;base64,AAAA',contactLine:'Hasbaya'});
    const header=page.slice(page.indexOf('<header class="top">'),page.indexOf('</header>'));
    expect(header.indexOf('<img class="logo"')).toBeLessThan(header.indexOf('<div class="brand">'));
    expect(header.indexOf('<div class="brand">')).toBeLessThan(header.indexOf('<div class="contact">'));
    expect(header.indexOf('<img class="logo"')).toBeLessThan(header.indexOf('Diesel Batch Report'));
    expect(page).toContain('.brand{font-size:10.5pt');
    expect(page).toContain('.logo{max-height:20mm;max-width:40mm;display:block');
  });
});
