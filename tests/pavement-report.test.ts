import {describe,expect,it} from 'vitest';

import type {PavementCalculation} from '../src/domain/pavement';
import {buildPavementPdfHtml,buildPavementSheets} from '../src/domain/pavementReport';
import {buildWorkbookFromSheets} from '../src/services/businessWorkbook';

/**
 * The Pavement Quantity PDF and workbook with road sections (DEC-518). A calculation with sections lists each section and their total; a calculation
 * without sections exports exactly as before.
 */
const base={projectId:'road',projectName:'Coastal Road',lengthM:null,widthM:null,spreadRateKgM2:90,densityTM3:2.4,looseThicknessFactor:1.2,allowancePercent:5,notes:'',createdAt:'2026-10-20T09:00:00.000Z',updatedAt:'2026-10-20T09:00:00.000Z'};
const withSections:PavementCalculation={...base,id:'calc_sections',name:'Wearing course <Stn 0+000>',areaM2:146,areaSections:[{name:'Station 0+000–0+010',lengthM:10,widthStartM:4,widthEndM:4.4},{name:'',lengthM:20,widthStartM:4.4,widthEndM:6}],theoreticalKg:13140,allowanceKg:657,plannedKg:13797,thicknessMm:37.5,looseThicknessMm:45};
const typed:PavementCalculation={...base,id:'calc_typed',name:'Binder course',lengthM:500,widthM:7,areaM2:3500,areaSections:null,spreadRateKgM2:110,looseThicknessFactor:null,theoreticalKg:385000,allowanceKg:19250,plannedKg:404250,thicknessMm:45.8,looseThicknessMm:null};

describe('the PDF',()=>{
  it('lists each road section and their total under the calculation, with the rule and the assumption',()=>{
    const html=buildPavementPdfHtml([withSections],'Coastal Road','20 Oct 2026');
    expect(html).toContain('Road sections of Wearing course &lt;Stn 0+000&gt;');
    expect(html).toContain('<td>1 · Station 0+000–0+010</td><td>10.00</td><td>4.00</td><td>4.40</td><td>42.00</td>');
    expect(html).toContain('<td>2 · Section 2</td><td>20.00</td><td>4.40</td><td>6.00</td><td>104.00</td>');
    expect(html).toContain('<td>Total · 2 sections</td><td></td><td></td><td></td><td>146.00</td>');
    expect(html).toContain('Section area = length × (width 1 + width 2) ÷ 2. The width is assumed to change in a straight line inside each section.');
    expect(html).toContain('<td>146.00</td><td>90.0</td>');
  });
  it('keeps the main row, the totals line and the notes as before',()=>{
    const html=buildPavementPdfHtml([withSections,typed],'Coastal Road','20 Oct 2026');
    expect(html).toContain('2 calculations · 3646.00 m² entered area · 398.140 t theoretical · 418.047 t planned');
    expect(html).toContain('Approved project drawings, mix design, trial strip, and engineer requirements control construction.');
    expect(html).toContain('Coastal Road · 20 Oct 2026');
  });
  it('is exactly the same as before for calculations without sections, with no sections table or extra style',()=>{
    const html=buildPavementPdfHtml([typed],'Coastal Road','20 Oct 2026');
    expect(html).not.toContain('Road sections');expect(html).not.toContain('sectionsRow');expect(html).not.toContain('table.sub');
    expect(html).toContain('<tbody><tr><td>Binder course</td><td>3500.00</td><td>110.0</td><td>2.40</td><td>45.8</td><td>—</td><td>—</td><td>385.000</td><td>5.0%</td><td>404.250</td></tr></tbody>');
  });
});

describe('the workbook',()=>{
  it('keeps the two sheets and their columns for calculations without sections',()=>{
    const sheets=buildPavementSheets([typed],'Coastal Road');
    expect(sheets.map(sheet=>sheet.name)).toEqual(['Project Summary','Pavement Calculations']);
    expect(Object.keys(sheets[1]!.rows[0]!)).toEqual(['Project','Layer / section','Length m','Width m','Area m²','Spread kg/m²','Density t/m³','Finished compacted thickness mm','Loose thickness factor','Before-compaction loose thickness mm','Theoretical kg','Theoretical t','Allowance %','Allowance kg','Planned kg','Planned t','Notes','Updated']);
  });
  it('adds an Area Sections sheet with one flat row per section, and a trailing Calculation ID on the calculations sheet',()=>{
    const sheets=buildPavementSheets([withSections,typed],'Coastal Road');
    expect(sheets.map(sheet=>sheet.name)).toEqual(['Project Summary','Pavement Calculations','Area Sections']);
    expect(sheets[1]!.rows.map(row=>row['Calculation ID'])).toEqual(['calc_sections','calc_typed']);
    expect(sheets[1]!.rows[0]).toMatchObject({'Length m':null,'Width m':null,'Area m²':146});
    expect(sheets[2]!.rows).toEqual([
      {'Project':'Coastal Road','Calculation ID':'calc_sections','Layer / section':'Wearing course <Stn 0+000>','Section #':1,'Section name':'Station 0+000–0+010','Length m':10,'Width 1 m':4,'Width 2 m':4.4,'Section area m²':42,'Calculation area m²':146},
      {'Project':'Coastal Road','Calculation ID':'calc_sections','Layer / section':'Wearing course <Stn 0+000>','Section #':2,'Section name':'','Length m':20,'Width 1 m':4.4,'Width 2 m':6,'Section area m²':104,'Calculation area m²':146},
    ]);
    expect(sheets[0]!.rows[0]).toMatchObject({'Calculations':2,'Entered area total m²':3646});
  });
  it('builds a real workbook from the sheets',()=>{
    expect(buildWorkbookFromSheets(buildPavementSheets([withSections],'Coastal Road')).length).toBeGreaterThan(1000);
  });
});
