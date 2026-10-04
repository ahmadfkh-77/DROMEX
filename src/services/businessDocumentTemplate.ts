import {documentKindInfo,type BusinessDocument,type PartyBlock} from '../domain/businessDocuments';
import {formatTotalQuantity} from '../domain/projectTotals';
import {formatCents,formatDay,formatRecordedAt,recordMoneyLine,recordReferences,recordTitle} from '../domain/recordFormat';

/**
 * DEC-500 (2), (4), (5). The A4 PDF of a statement, invoice or bill. It prints the document's own frozen
 * snapshot only: issuer, recipient, terms, lines, records and signer exactly as they were at issue.
 * Empty fields are left out rather than printed blank. Units are never combined, a missing price is
 * never shown as zero, and a signature keeps its proportions. Nothing here claims legal, tax or
 * accounting compliance. Payment status is live data and is therefore never printed.
 */
const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
const t=(value:unknown)=>`<span dir="auto">${e(value)}</span>`;

function partyHtml(heading:string,block:PartyBlock|null):string{
  if(!block)return '';
  const lines:[string,string|null][]=[['',block.tradingName?`Trading as ${block.tradingName}`:null],['Attention',block.contactPerson],['',block.address],['Phone',block.phone],['Email',block.email],['Website',block.website],['Tax / VAT no.',block.taxRegistrationNumber],['Company reg. no.',block.companyRegistrationNumber]];
  return `<div class="party"><div class="label">${e(heading)}</div>${block.name?`<div class="party-name">${t(block.name)}</div>`:''}${lines.filter(([,value])=>value).map(([label,value])=>`<div class="party-line">${label?`<span class="muted">${e(label)}:</span> `:''}${t(value)}</div>`).join('')}</div>`;
}

export function buildBusinessDocumentHtml(doc:BusinessDocument,logo:string|null):string{
  const info=documentKindInfo[doc.kind];
  const ourSide=doc.partyType==='customer';
  /** Your business heads every document, with the Company Settings logo it was issued with: the issuer of an invoice, the recipient of a bill. */
  const business=ourSide?doc.issuer:doc.recipient;
  const title=info.label;
  const number=doc.documentNumber??doc.draftNumber;
  const period=doc.periodFrom||doc.periodTo?`${formatDay(doc.periodFrom)} – ${formatDay(doc.periodTo)}`:null;
  const meta:[string,string|null][]=[['Number',number],['Issue date',doc.issueDate?formatDay(doc.issueDate):null],['Due date',doc.dueDate?formatDay(doc.dueDate):null],['Period',period],['Reference / PO',doc.reference]];
  const banner=doc.status==='Draft'?'<div class="banner draft">DRAFT — NOT ISSUED</div>'
    :doc.status==='Cancelled'?`<div class="banner cancelled">CANCELLED${doc.cancelledAt?` on ${e(formatDay(doc.cancelledAt.slice(0,10)))}`:''}${doc.cancellationReason?`<div class="banner-reason">Reason: ${t(doc.cancellationReason)}</div>`:''}</div>`:'';
  const official=info.mode==='official';
  const money=doc.groups.money;
  const recordCount=doc.records.length;

  const projectTables=doc.groups.projects.map(project=>`<table class="lines">
    <thead><tr class="project-row"><th colspan="${official?5:4}">${t(project.projectName)}</th></tr>
    <tr><th>Item</th><th class="num">Quantity</th><th class="num">Records</th>${official?'<th class="num">Unit price</th>':''}<th class="num">Amount</th></tr></thead>
    <tbody>${project.lines.map(line=>`<tr><td>${t(line.itemName)}${line.priceBasis==='whole'?'<div class="muted small">Priced for the whole delivery</div>':''}</td>
      <td class="num">${e(formatTotalQuantity(line.quantity,line.unitSymbol))}</td><td class="num">${line.recordCount}</td>
      ${official?`<td class="num">${line.unitPriceCents==null?'<span class="muted">No price recorded</span>':`${e(formatCents(line.unitPriceCents))}${line.priceBasis==='whole'?'':` / ${e(line.unitSymbol)}`}`}</td>`:''}
      <td class="num">${line.totalCents==null?'<span class="muted">No price recorded</span>':e(formatCents(line.totalCents))}${line.vatRateBasisPoints?`<div class="muted small">incl. VAT ${line.vatRateBasisPoints/100}%</div>`:''}</td></tr>`).join('')}</tbody></table>`).join('');

  const quantities=`<table class="summary keep"><thead><tr><th>Total quantity, by unit</th><th class="num">Quantity</th><th class="num">Records</th></tr></thead>
    <tbody>${doc.groups.quantityByUnit.map(unit=>`<tr><td>${e(unit.unitSymbol)}</td><td class="num strong">${e(formatTotalQuantity(unit.quantity,unit.unitSymbol))}</td><td class="num">${unit.recordCount}</td></tr>`).join('')}</tbody></table>
    <p class="muted small">Each unit is totalled on its own. Different units are never added together.</p>`;

  const moneyNote=money.unpricedCount?`<p class="note">${money.unpricedCount} of ${recordCount} record${recordCount===1?'':'s'} ${money.unpricedCount===1?'has':'have'} no recorded price. ${money.unpricedCount===1?'It is listed with quantities only and adds':'They are listed with quantities only and add'} nothing to the amounts.</p>`:'';
  const totals=money.totalCents==null?`<div class="totals keep"><p class="note">No record on this document has a recorded price, so it shows quantities only.</p></div>`
    :`<div class="totals keep"><table class="money"><tbody>
      <tr><td>Subtotal</td><td class="num">${e(formatCents(money.subtotalCents))}</td></tr>
      ${money.vatCents?`<tr><td>VAT (as recorded on each record)</td><td class="num">${e(formatCents(money.vatCents))}</td></tr>`:''}
      <tr class="grand"><td>Total (${e(doc.terms?.currency??'USD')})</td><td class="num">${e(formatCents(money.totalCents))}</td></tr>
    </tbody></table>${moneyNote}</div>`;

  const recordRows=doc.records.map(({snapshot})=>`<tr><td>${e(recordTitle(snapshot))}<div class="muted small">${e(recordReferences(snapshot))}</div></td>
    <td>${e(formatRecordedAt(snapshot.recordedAt))}</td><td>${t(snapshot.itemName)}<div class="muted small">${t(snapshot.projectName??'No project')}</div></td>
    <td class="num">${e(formatTotalQuantity(snapshot.quantity,snapshot.unitSymbol))}</td><td class="num">${e(recordMoneyLine(snapshot))}</td></tr>`).join('');
  const recordsTable=`<h2 class="section">Records on this document</h2><table class="records"><thead><tr><th>${ourSide?'Load number / reference':'Supplier Load / ticket'}</th><th>Date and time</th><th>Item and project</th><th class="num">Quantity</th><th class="num">Price as recorded</th></tr></thead><tbody>${recordRows}</tbody></table>`;

  const terms=doc.terms;
  const termLines:[string,string|null][]=[['Payment terms',terms?.paymentTerms??null],['Payment instructions',terms?.bankDetails??null]];
  const termsHtml=termLines.some(([,value])=>value)||doc.notes?`<div class="terms keep">${termLines.filter(([,value])=>value).map(([label,value])=>`<div><span class="label">${e(label)}</span><div class="pre">${t(value)}</div></div>`).join('')}${doc.notes?`<div><span class="label">Notes</span><div class="pre">${t(doc.notes)}</div></div>`:''}</div>`:'';

  const signer=doc.signer;
  const signerHtml=signer?`<div class="signer keep">${signer.display==='name_with_signature'&&signer.signature.length?`<svg viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet" class="signature">${signer.signature.map(path=>`<path d="${e(path)}" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`:'<div class="by-name">Signed by name</div>'}
    <div class="signer-rule"></div><div class="signer-name">${t(signer.name)}</div>${signer.jobTitle?`<div class="muted">${t(signer.jobTitle)}</div>`:''}${signer.department?`<div class="muted">${t(signer.department)}</div>`:''}</div>`:'';

  const internalNote=info.mode==='internal'?'<p class="internal">Internal statement — not a tax invoice. Prepared from DROMEX records for review between the parties.</p>':'';
  const footer=terms?.footerNote?`<div class="footer">${t(terms.footerNote)}</div>`:'';
  const fromLabel=ourSide?'From':'Supplier';const toLabel=ourSide?'Bill to':'Billed to';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(title)} ${e(number)}</title><style>
    @page{size:A4;margin:14mm 14mm 16mm}
    *{box-sizing:border-box}
    body{font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif;color:#17212B;font-size:9.5pt;line-height:1.4;margin:0}
    @media screen{body{max-width:210mm;margin:0 auto;padding:14mm;background:#fff}}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;border-bottom:2px solid #C84B31;padding-bottom:5mm}
    .brand{flex:1;min-width:0;display:flex;flex-direction:column;gap:1.5mm}
    .logo{max-width:48mm;max-height:24mm;object-fit:contain;object-position:left center;display:block}
    .brand-name{font-size:13pt;font-weight:700;color:#17212B}
    .brand-line{color:#5A6570;font-size:8.5pt}
    .title-panel{flex:0 0 auto;max-width:92mm;margin-left:auto;text-align:right;background:#F5F2EC;border:1px solid #E3DBCD;border-radius:3mm;padding:4mm 5mm}
    .doc-title{font-size:22pt;font-weight:700;color:#173F67;margin:0 0 1mm;letter-spacing:.5px}
    .meta{border-collapse:collapse;margin-left:auto}
    .meta td{padding:.7mm 0 .7mm 5mm;text-align:right;vertical-align:top;border-bottom:none}
    .meta td:first-child{color:#65717D;padding-left:0}
    .parties{display:flex;gap:8mm;margin:5mm 0}
    .party{flex:1;min-width:0;border:1px solid #DDD7CC;border-radius:3mm;padding:3mm 4mm;break-inside:avoid}
    .label{color:#65717D;font-size:8pt;font-weight:700;letter-spacing:.3px;text-transform:uppercase;display:block;margin-bottom:1mm}
    .party-name{font-size:11pt;font-weight:700;margin-bottom:1mm}
    .party-line{overflow-wrap:anywhere}
    .muted{color:#5A6570}.small{font-size:8pt}.strong{font-weight:700}.pre{white-space:pre-wrap;overflow-wrap:anywhere}
    .banner{border:1mm solid;border-radius:2mm;text-align:center;font-weight:700;font-size:12pt;padding:2.5mm;margin:4mm 0}
    .banner.draft{color:#9A6512;border-color:#9A6512}.banner.cancelled{color:#B3261E;border-color:#B3261E}
    .banner-reason{font-size:9pt;font-weight:400;margin-top:1mm}
    table{width:100%;border-collapse:collapse}
    thead{display:table-header-group}
    tr{break-inside:avoid}
    th{text-align:left;color:#173F67;font-size:8pt;border-bottom:1.5px solid #173F67;padding:1.6mm 1.6mm}
    td{padding:1.6mm;border-bottom:.3mm solid #E3DBCD;vertical-align:top;overflow-wrap:anywhere}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    td.num{white-space:normal}
    .lines{margin-top:3mm}
    .project-row th{font-size:10pt;color:#17212B;border-bottom:none;padding-top:3mm;background:#F5F2EC}
    .keep{break-inside:avoid}
    .summary{margin-top:5mm}
    .totals{margin:4mm 0 0 auto;width:62%}
    .money td{border-bottom:.3mm solid #E3DBCD}
    .money .grand td{font-size:12pt;font-weight:700;border-top:1.5px solid #173F67;border-bottom:none}
    .note{color:#5A6570;font-size:8.5pt;margin:2mm 0 0}
    .section{font-size:11pt;color:#173F67;margin:7mm 0 2mm;break-after:avoid}
    .records td{font-size:8.5pt}
    .terms{display:flex;flex-direction:column;gap:3mm;margin-top:6mm;border-top:.3mm solid #DDD7CC;padding-top:3mm}
    .signer{width:70mm;margin:9mm 0 0 auto;text-align:center}
    .signature{width:60mm;height:26mm;display:block;margin:0 auto}
    .by-name{color:#5A6570;font-style:italic;margin:6mm 0 2mm}
    .signer-rule{border-top:.4mm solid #17212B;margin:1mm 0 1.5mm}
    .signer-name{font-weight:700}
    .internal{color:#5A6570;font-size:8.5pt;font-style:italic;margin-top:6mm}
    .footer{margin-top:6mm;border-top:.3mm solid #DDD7CC;padding-top:2mm;color:#5A6570;font-size:8pt;text-align:center;white-space:pre-wrap}
  </style></head><body>
    <div class="head">
      <div class="brand">${logo?`<img class="logo" src="${logo}" alt=""/>`:''}${business?.name?`<div class="brand-name">${t(business.name)}</div>`:''}${[business?.address,business?.phone,business?.email].filter(Boolean).map(line=>`<div class="brand-line">${t(line)}</div>`).join('')}</div>
      <div class="title-panel"><h1 class="doc-title">${e(title)}</h1><table class="meta"><tbody>${meta.filter(([,value])=>value).map(([label,value])=>`<tr><td>${e(label)}</td><td class="strong">${t(value)}</td></tr>`).join('')}</tbody></table></div>
    </div>
    ${banner}
    <div class="parties">${partyHtml(fromLabel,doc.issuer)}${partyHtml(toLabel,doc.recipient)}</div>
    ${projectTables}
    ${quantities}
    ${totals}
    ${termsHtml}
    ${signerHtml}
    ${recordsTable}
    ${internalNote}
    ${footer}
  </body></html>`;
}
