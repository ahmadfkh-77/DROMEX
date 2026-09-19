import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import type {Foundation} from '../src/domain/foundations';
import type {LinkedFoundationActivity,LinkedWallWork} from '../src/domain/projectReports';
import {foundationOnlyRows,wallFoundationRows} from '../src/services/dailyReportWorkbookCore';
import {wallConstructionSectionHtml} from '../src/services/projectReportWasteTemplate';

/**
 * DEC-468 UI and export contracts. No React Native renderer in this stack, so the screen checks read
 * component source to pin which controls exist; the report/workbook checks exercise real functions.
 */
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');
const FORM='src/ui/components/FoundationGeometryForm.tsx';

const foundation=(overrides:Partial<Foundation>={}):Foundation=>({
  id:'f1',projectId:'road',constructionSectionId:'sec',legacyWallId:null,reference:'Foundation F1',location:'North abutment',
  materialType:null,concretePurpose:null,customPurposeId:null,customPurposeLabel:null,
  quantity:null,quantityUnit:null,manualOverride:false,consumptionDate:null,
  lengthM:30,heightM:.4,bottomThicknessM:.75,topThicknessM:.75,deductionM3:0,grossVolumeM3:9,netVolumeM3:9,
  status:'planned',constructedOn:null,curingStartedOn:null,curedOn:null,curingNote:'',notes:'',
  correctionHistory:[],createdAt:'2026-09-18T00:00:00Z',updatedAt:null,...overrides,
});
const legacyFoundation=()=>foundation({materialType:'ready_mix',concretePurpose:'footing',quantity:9,quantityUnit:'m3',manualOverride:true,consumptionDate:'2026-09-01'});

describe('the Foundation form records an envelope, not a consumption',()=>{
  const form=source(FORM);

  it('has removed every legacy material-consumption control',()=>{
    // The rendered controls must be gone. A type-only import that carries a legacy value through is
    // not a control, so this checks for the elements themselves.
    for(const gone of ['Consumed quantity','Ready-mix m³','Site-mixed','Use Calculated','Manual quantity override','<ConcretePurposeField','<DatePickerField','accessibilityRole="radio"','accessibilityRole="checkbox"'])
      expect(form).not.toContain(gone);
  });

  it('keeps identity, geometry, deductions and notes',()=>{
    for(const kept of ['Foundation reference','Location','Length (m)','Height / depth (m)','Bottom thickness (m)','Top thickness (m)','Volume deductions','Foundation notes'])
      expect(form).toContain(kept);
  });

  it('labels the result as the structural envelope and explains where materials go',()=>{
    expect(form).toContain('Structural envelope volume');
    expect(form).toContain('Record actual Stone and concrete separately through Lifts');
  });

  it('never populates a consumed quantity from the calculated volume',()=>{
    expect(form).not.toMatch(/quantity:\s*String\(/);
    expect(form).not.toContain('useCalculated');
  });

  it('carries an existing legacy record through untouched instead of editing or clearing it',()=>{
    expect(form).toContain('legacy');
    expect(form).toMatch(/materialType:\s*form\.legacy\.material/);
    expect(form).toMatch(/quantity:\s*form\.legacy\.quantity/);
  });

  it('keeps one clear primary action',()=>{
    expect((form.match(/tone="navy"/g)??[])).toHaveLength(1);
  });
});

describe('actual materials belong only to the lift phases',()=>{
  it('records actual Stone only in the Stone Lift editor',()=>{
    expect(source('src/ui/screens/StoneLiftEditorScreen.tsx')).toContain('Final Stone quantity');
    expect(source(FORM)).not.toContain('Stone quantity');
    expect(source('src/ui/screens/FoundationGeometryScreen.tsx')).not.toContain('Stone quantity');
  });

  it('records actual concrete, its type and its purpose only in the Concrete Matrix editor',()=>{
    const concrete=source('src/ui/screens/ConcreteMatrixEditorScreen.tsx');
    expect(concrete).toContain('saveConcreteMatrixPhase');
    expect(concrete).toMatch(/purpose/);
    expect(source(FORM)).not.toContain('saveConcreteMatrixPhase');
  });

  it('shows an existing top-level material record read-only, labelled as legacy',()=>{
    const overview=source('src/ui/screens/FoundationOverviewScreen.tsx');
    expect(overview).toContain('Legacy foundation material record');
    expect(overview).toMatch(/before the Lift workflow|recorded before/i);
  });
});

describe('reports leave an absent foundation consumption empty, never zero',()=>{
  const wall=(target:Foundation):LinkedWallWork=>({
    wallId:'wall-a',wallName:'Retaining wall A',system:'rubble_masonry',purpose:'retaining',lengthM:20,heightM:4,
    bottomThicknessM:.8,topThicknessM:.4,netVolumeM3:48,plannedVolumeM3:48,layers:[],entries:[],
    foundation:target,constructionSectionName:'Section A',foundationEvents:[],foundationStatusAsOf:'planned',
    foundationComposition:null,foundationLifts:null,wallLifts:null,foundationLegacyStage:null,
  });

  it('prints no recorded quantity for a foundation carrying none',()=>{
    const html=wallConstructionSectionHtml([wall(foundation())]);
    expect(html).not.toContain('not recorded m³');
    expect(html).not.toMatch(/Recorded\s+0(\.00)?\s*m³/);
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
    expect(html).toMatch(/No Lift materials recorded yet.|Materials recorded through d+ Lifts?:/);
  });

  it('still prints a legacy foundation material record honestly',()=>{
    const html=wallConstructionSectionHtml([wall(legacyFoundation())]);
    expect(html).toContain('9');
    expect(html).toMatch(/Ready-mix/i);
  });

  it('leaves the workbook material columns empty rather than zero or a false unit',()=>{
    const rows=wallFoundationRows([wall(foundation())]);
    expect(rows).toHaveLength(1);
    const row=rows[0]!;
    expect(row.Material).toBeNull();
    expect(row['Recorded Quantity']).toBeNull();
    expect(row['Quantity Unit']).toBeNull();
    expect(row.Purpose).toBeNull();
    expect(row['Consumption Date']).toBeNull();
    expect(row['Foundation Net Volume m³']).toBe(9);
  });

  it('keeps the workbook columns populated for a legacy record',()=>{
    const row=wallFoundationRows([wall(legacyFoundation())])[0]!;
    expect(row['Recorded Quantity']).toBe(9);
    expect(row['Quantity Unit']).toBe('m³');
    expect(row.Material).toBeTruthy();
  });

  it('applies the same rule to a foundation with no wall linked yet',()=>{
    const activity:LinkedFoundationActivity={foundation:foundation(),constructionSectionName:'Section A',foundationEvents:[],
      foundationStatusAsOf:'planned',composition:null,lifts:null,legacyStage:null};
    const row=foundationOnlyRows([activity])[0]!;
    expect(row.Material).toBeNull();
    expect(row['Recorded Quantity']).toBeNull();
    expect(row['Quantity Unit']).toBeNull();
    expect(row['Foundation Net Volume m³']).toBe(9);
  });
});
