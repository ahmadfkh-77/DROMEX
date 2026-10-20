/**
 * DEC-520. The shared look of the report PDFs: DROMEX navy with a thin orange rule, square boxes with thin borders, plain numbers and
 * plain-text figures (no badges, no pills, no rounded cards), grey group rows, total rows and a navy table header rule. One colour carries the
 * structure (navy) and orange only draws the rule, so the figures stay the loudest thing on the page. Used by the Totals family of PDFs.
 */
export const reportColors={navy:'#173F67',orange:'#C84B31',ink:'#1F2933',muted:'#52606D',group:'#EAF0F6',soft:'#F5F7FA',line:'#D5DDE5',cell:'#9FB0C2'} as const;

/** The common rules. A template adds its own page size, its running text and whatever only it needs. */
export function reportCss():string{
  const c=reportColors;
  return `
    *{box-sizing:border-box}
    body{font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif;color:${c.ink};font-size:9pt;line-height:1.35}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;border-bottom:.8mm solid ${c.orange};padding-bottom:4mm;margin-bottom:3mm}
    .logo{max-width:40mm;max-height:18mm;object-fit:contain;display:block;margin-bottom:1.5mm}
    h1{font-size:20pt;color:${c.navy};margin:0;text-align:right;font-weight:700}
    .head-right{text-align:right}
    .subtitle{color:${c.ink};font-size:11pt;font-weight:700;margin-top:1mm}
    .when{color:${c.muted};font-size:8.5pt;margin-top:1mm}
    .meta{color:#3E4C59;margin:0 0 4mm;font-size:8.5pt}
    .note-plain{color:#3E4C59;margin:0 0 4mm;font-size:8.5pt}
    .contact{font-size:8pt;color:${c.muted};margin-top:.5mm;overflow-wrap:anywhere}
    .tiles{display:flex;border:.35mm solid ${c.cell};margin:0 0 5mm;break-inside:avoid;background:#FFFFFF}
    .tile{flex:1;padding:2.8mm 3.5mm;border-right:.35mm solid ${c.cell}}
    .tile:last-child{border-right:none}
    .tile b{display:block;font-size:14pt;color:${c.navy};margin-top:.5mm;font-variant-numeric:tabular-nums}
    .figure-label{display:block;color:${c.muted};font-size:6.8pt;font-weight:700;text-transform:uppercase;letter-spacing:.7px}
    .contents{border:.35mm solid ${c.cell};margin:0 0 5mm;break-inside:avoid;background:#FFFFFF}
    .contents h3{margin:0;padding:2mm 3.5mm;font-size:8.5pt;letter-spacing:.5px;text-transform:uppercase;color:${c.navy};background:${c.group};border-bottom:.35mm solid ${c.cell}}
    .contents ol{list-style:none;margin:0;padding:0}
    .contents li{display:flex;align-items:baseline;gap:3mm;padding:1.9mm 3.5mm;border-top:.2mm solid ${c.line}}
    .contents li:first-child{border-top:none}
    .contents-index{flex:0 0 6mm;font-weight:700;color:${c.navy}}
    .contents-name{flex:1;font-weight:700}
    .contents-figures{text-align:right;color:#3E4C59}
    .block{border:.35mm solid ${c.cell};margin:0 0 6mm;background:#FFFFFF}
    .block-bar{display:flex;align-items:baseline;gap:3mm;background:${c.navy};color:#FFFFFF;padding:2.7mm 3.5mm;border-bottom:.8mm solid ${c.orange};break-after:avoid;break-inside:avoid}
    .block-index{flex:0 0 auto;font-weight:700;font-size:11pt}
    .block-name{flex:1;font-size:11.5pt;font-weight:700}
    .block-figures{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:1mm 4mm;font-size:8.5pt;color:#DCE6F0}
    .block-body{padding:3mm 3.5mm 4mm}
    .table-block .block-body{padding:0}
    .pill{display:inline-block;white-space:nowrap}
    .contents .pill{margin-left:2mm}
    .figures{display:flex;flex-wrap:wrap;border:.35mm solid ${c.cell};margin:1mm 0 3mm;break-inside:avoid;break-after:avoid;width:fit-content;max-width:100%}
    .figure{display:flex;align-items:stretch;border-right:.35mm solid ${c.cell}}
    .figure:last-child{border-right:none}
    .figure.side{flex-direction:column;justify-content:center;min-width:30mm;padding:2mm 3mm}
    .figure-unit{display:flex;align-items:center;padding:2mm 3mm;border-right:.35mm solid ${c.cell};font-weight:700;color:${c.navy};font-size:10pt}
    .figure-cell{padding:2mm 3mm;min-width:26mm;border-right:.35mm solid ${c.cell}}
    .figure-cell:last-child{border-right:none}
    .figure-cell b,.figure.side b{display:block;font-size:11.5pt;color:${c.navy};font-variant-numeric:tabular-nums}
    .spaced{margin-top:1.5mm}
    .sub{font-size:8.5pt;color:${c.navy};margin:4mm 0 1mm;text-transform:uppercase;letter-spacing:.5px;break-after:avoid}
    .lead{margin:0 0 2mm;color:#3E4C59}
    table{width:100%;border-collapse:collapse}
    thead{display:table-header-group}
    tr{break-inside:avoid}
    th{text-align:left;color:${c.navy};font-size:7.5pt;font-weight:700;border-bottom:.45mm solid ${c.navy};padding:1.5mm 1.6mm;vertical-align:bottom}
    td{padding:1.7mm 1.6mm;border-bottom:.2mm solid ${c.line};vertical-align:top;overflow-wrap:anywhere}
    tbody tr:nth-child(even) td{background:${c.soft}}
    tbody tr.group-row td{background:${c.group};font-weight:700;color:${c.ink};padding-top:2mm}
    tbody tr.total-row td{font-weight:700;color:${c.navy};background:${c.soft};border-top:.45mm solid ${c.navy};border-bottom:none}
    tbody tr.sub-row td{background:#FFFFFF;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${c.navy};border-top:.35mm solid ${c.cell};padding-top:2mm}
    tr.bar-row th{padding:0;border:none;font-weight:400;text-align:left}
    td.indent{padding-left:5mm}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .nowrap{white-space:nowrap}
    .wrap{white-space:normal}
    .muted{color:#6B7681;font-size:7.5pt;font-weight:400}
    .missing{color:#6B7681;font-style:italic;font-weight:400}
    .empty{margin:0;color:#6B7681;font-style:italic}
    .panel{border:.35mm solid ${c.cell};margin:0 0 5mm;background:#FFFFFF}
    .panel-head{display:flex;justify-content:space-between;gap:3mm;padding:2mm 3.5mm;font-size:8.5pt;letter-spacing:.5px;text-transform:uppercase;font-weight:700;color:${c.navy};background:${c.group};border-bottom:.35mm solid ${c.cell}}
    .panel-head span{font-weight:400;text-transform:none;letter-spacing:0;color:#3E4C59}
    .keys{display:flex;flex-wrap:wrap}
    .keys div{flex:1 1 30%;min-width:0;padding:2.4mm 3.5mm;border-right:.35mm solid ${c.cell}}
    .keys div:last-child{border-right:none}
    .keys b{display:block;font-size:9pt;color:${c.ink};overflow-wrap:anywhere}
    .block-body .note{padding:2mm 3.5mm;margin:0}
    .notes{color:${c.muted};font-size:7.5pt;margin-top:5mm}
    .notes h4{margin:0;color:${c.navy};text-transform:uppercase;letter-spacing:.5px;font-size:7.5pt}
    .notes ol{margin:1mm 0 0;padding-left:4mm}
    .notes li{margin:.4mm 0}`;
}
