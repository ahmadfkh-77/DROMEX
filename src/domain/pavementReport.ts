import type {PavementCalculation} from './pavement';
import {sectionArea,totalSectionArea} from './pavement';

/**
 * What the Pavement Quantity PDF and Excel workbook contain (DEC-518). Built here as plain text and rows so they can be tested; the exporter only
 * prints and shares them. A calculation that has road sections shows each one (name, length, Width 1, Width 2, area) and their total under it in
 * the PDF, and the workbook gains an Area Sections sheet. A calculation without sections exports exactly as before.
 */
export const esc=(value:unknown)=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const total=(records:readonly PavementCalculation[],key:'areaM2'|'theoreticalKg'|'allowanceKg'|'plannedKg')=>records.reduce((sum,row)=>sum+row[key],0);
export const hasAreaSections=(record:PavementCalculation)=>!!record.areaSections&&record.areaSections.length>0;

const COLUMNS=10;
const sectionsNote='Section area = length × (width 1 + width 2) ÷ 2. The width is assumed to change in a straight line inside each section.';

function sectionsRows(record:PavementCalculation):string{
  const sections=record.areaSections??[];
  const lines=sections.map((section,index)=>`<tr><td>${index+1} · ${esc(section.name||`Section ${index+1}`)}</td><td>${section.lengthM.toFixed(2)}</td><td>${section.widthStartM.toFixed(2)}</td><td>${section.widthEndM.toFixed(2)}</td><td>${sectionArea(section).toFixed(2)}</td></tr>`).join('');
  return `<tr class="sectionsRow"><td colspan="${COLUMNS}"><div class="sectionsTitle">Road sections of ${esc(record.name)}</div><table class="sub"><thead><tr><th>Section</th><th>Length m</th><th>Width 1 m</th><th>Width 2 m</th><th>Area m²</th></tr></thead><tbody>${lines}<tr class="subTotal"><td>Total · ${sections.length} section${sections.length===1?'':'s'}</td><td></td><td></td><td></td><td>${totalSectionArea(sections).toFixed(2)}</td></tr></tbody></table><div class="sectionsNote">${esc(sectionsNote)}</div></td></tr>`;
}

export function buildPavementPdfHtml(records:readonly PavementCalculation[],projectName:string,generatedAt:string):string{
  const anySections=records.some(hasAreaSections);
  const rows=records.map(row=>`<tr><td>${esc(row.name)}</td><td>${row.areaM2.toFixed(2)}</td><td>${row.spreadRateKgM2.toFixed(1)}</td><td>${row.densityTM3.toFixed(2)}</td><td>${row.thicknessMm.toFixed(1)}</td><td>${row.looseThicknessMm===null?'—':row.looseThicknessMm.toFixed(1)}</td><td>${row.looseThicknessFactor===null?'—':row.looseThicknessFactor.toFixed(2)}</td><td>${(row.theoreticalKg/1000).toFixed(3)}</td><td>${row.allowancePercent.toFixed(1)}%</td><td>${(row.plannedKg/1000).toFixed(3)}</td></tr>${hasAreaSections(row)?sectionsRows(row):''}`).join('');
  const sectionStyles=anySections?'.sectionsRow>td{padding:4px 6px 10px 18px;text-align:left}.sectionsTitle{color:#173F67;font-weight:bold;margin:2px 0 4px}table.sub{width:100%}table.sub th{background:#EEF2F7;color:#173F67}.subTotal td{font-weight:bold;background:#F5F2EC}.sectionsNote{color:#65717D;margin-top:3px}':'';
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:12mm}body{font-family:Arial;color:#17212B}h1{color:#173F67}h2{color:#C84B31}.meta{color:#65717D}table{width:100%;border-collapse:collapse;font-size:8px}th{background:#173F67;color:white}th,td{padding:6px;border:1px solid #DDD7CC;text-align:right}th:first-child,td:first-child{text-align:left}.totals{margin-top:16px;padding:12px;background:#FFF8ED;border-left:5px solid #C84B31;font-weight:bold}${sectionStyles}</style></head><body><h1>DROMEX</h1><h2>Asphalt Pavement Quantity Report</h2><p class="meta">${esc(projectName)} · ${esc(generatedAt)}</p><table><thead><tr><th>Layer / section</th><th>Area m²</th><th>kg/m²</th><th>Density t/m³</th><th>Finished mm</th><th>Loose mm</th><th>Factor</th><th>Theoretical t</th><th>Allowance</th><th>Planned t</th></tr></thead><tbody>${rows}</tbody></table><div class="totals">${records.length} calculations · ${total(records,'areaM2').toFixed(2)} m² entered area · ${(total(records,'theoreticalKg')/1000).toFixed(3)} t theoretical · ${(total(records,'plannedKg')/1000).toFixed(3)} t planned</div><p class="meta">Loose thickness is shown only when an entered project/paver factor is available. Quantities are estimates from entered geometry, spread rates, density, factor, and allowances. Approved project drawings, mix design, trial strip, and engineer requirements control construction.</p></body></html>`;
}

export type PavementSheet={name:string;rows:Record<string,string|number|null>[]};

/**
 * The workbook sheets. Project Summary and Pavement Calculations keep their columns. When any calculation has road sections, Pavement Calculations
 * gains a trailing Calculation ID and an Area Sections sheet lists one flat row per section (filterable, with the calculation's id and name).
 */
export function buildPavementSheets(records:readonly PavementCalculation[],projectName:string):PavementSheet[]{
  const anySections=records.some(hasAreaSections);
  const summary=[{'Project':projectName,'Calculations':records.length,'Entered area total m²':total(records,'areaM2'),'Theoretical total t':total(records,'theoreticalKg')/1000,'Allowance total t':total(records,'allowanceKg')/1000,'Planned total t':total(records,'plannedKg')/1000}];
  const calculations=records.map(row=>({'Project':row.projectName,'Layer / section':row.name,'Length m':row.lengthM,'Width m':row.widthM,'Area m²':row.areaM2,'Spread kg/m²':row.spreadRateKgM2,'Density t/m³':row.densityTM3,'Finished compacted thickness mm':row.thicknessMm,'Loose thickness factor':row.looseThicknessFactor,'Before-compaction loose thickness mm':row.looseThicknessMm,'Theoretical kg':row.theoreticalKg,'Theoretical t':row.theoreticalKg/1000,'Allowance %':row.allowancePercent,'Allowance kg':row.allowanceKg,'Planned kg':row.plannedKg,'Planned t':row.plannedKg/1000,'Notes':row.notes,'Updated':row.updatedAt,...(anySections?{'Calculation ID':row.id}:{})}));
  const sheets:PavementSheet[]=[{name:'Project Summary',rows:summary},{name:'Pavement Calculations',rows:calculations}];
  if(anySections){
    const sections=records.filter(hasAreaSections).flatMap(row=>row.areaSections!.map((section,index)=>({'Project':row.projectName,'Calculation ID':row.id,'Layer / section':row.name,'Section #':index+1,'Section name':section.name,'Length m':section.lengthM,'Width 1 m':section.widthStartM,'Width 2 m':section.widthEndM,'Section area m²':sectionArea(section),'Calculation area m²':row.areaM2})));
    sheets.push({name:'Area Sections',rows:sections});
  }
  return sheets;
}
