import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

import {addAction,conversionEquation,conversionMatches,decimalsText,formatQuantity,inactiveLabel,needsSearch,SEARCH_THRESHOLD,unitMatches} from '../src/domain/unitsConversions';

/**
 * DEC-526 Phase 1. Units & Conversions is two tabs, one list at a time, one-line rows, one fixed Add button, with Remove in the
 * edit forms and Reactivate on inactive rows. These tests check the small rules (pure) and that every action the old screen
 * had is still there (static checks, no React Native renderer).
 */
const conversion={name:'Kilograms to tonnes',inputUnitName:'Kilogram',inputUnitSymbol:'kg',outputUnitName:'Tonne',outputUnitSymbol:'t',inputQuantity:1000,outputQuantity:1};

describe('the small rules of the screen (pure)',()=>{
  it('shows search only for lists longer than 8',()=>{
    expect(SEARCH_THRESHOLD).toBe(8);
    expect(needsSearch(8)).toBe(false);
    expect(needsSearch(9)).toBe(true);
    expect(needsSearch(0)).toBe(false);
  });
  it('writes a stored quantity with grouping and no trailing zeros',()=>{
    expect(formatQuantity(1000)).toBe('1,000');
    expect(formatQuantity(1)).toBe('1');
    expect(formatQuantity(0.4167)).toBe('0.4167');
    expect(formatQuantity(1234567.5)).toBe('1,234,567.5');
    expect(formatQuantity(12)).toBe('12');
    expect(formatQuantity(Number.NaN)).toBe('NaN');
  });
  it('finds a unit by name or symbol, ignoring case and spaces; an empty search finds all',()=>{
    const tonne={name:'Tonne',symbol:'t'},cubic={name:'Cubic metre',symbol:'m³'};
    expect(unitMatches(tonne,'')).toBe(true);
    expect(unitMatches(tonne,'  TON ')).toBe(true);
    expect(unitMatches(cubic,'m³')).toBe(true);
    expect(unitMatches(cubic,'cubic')).toBe(true);
    expect(unitMatches(tonne,'litre')).toBe(false);
  });
  it('finds a conversion by its name or by either unit',()=>{
    expect(conversionMatches(conversion,'')).toBe(true);
    expect(conversionMatches(conversion,'kilograms to')).toBe(true);
    expect(conversionMatches(conversion,'KG')).toBe(true);
    expect(conversionMatches(conversion,'tonne')).toBe(true);
    expect(conversionMatches(conversion,'litre')).toBe(false);
  });
  it('reads a conversion as an equation',()=>{
    expect(conversionEquation(conversion)).toEqual({left:'1,000',leftSymbol:'kg',right:'1',rightSymbol:'t',text:'1,000 kg = 1 t'});
    expect(conversionEquation({...conversion,inputQuantity:1,inputUnitSymbol:'t',outputQuantity:0.4167,outputUnitSymbol:'m³'}).text).toBe('1 t = 0.4167 m³');
  });
  it('says decimals in the singular and the plural',()=>{
    expect(decimalsText(0)).toBe('0 decimals');
    expect(decimalsText(1)).toBe('1 decimal');
    expect(decimalsText(3)).toBe('3 decimals');
  });
  it('offers one Add button for the tab you are on, and a conversion needs an active unit first',()=>{
    expect(addAction('units',0)).toEqual({label:'Add unit',enabled:true,hint:null});
    expect(addAction('conversions',0)).toEqual({label:'Add conversion',enabled:false,hint:'Add at least one active unit before creating a conversion.'});
    expect(addAction('conversions',2)).toEqual({label:'Add conversion',enabled:true,hint:null});
  });
  it('labels the collapsed Inactive row',()=>{
    expect(inactiveLabel('units',1)).toBe('Inactive units · 1');
    expect(inactiveLabel('conversions',3)).toBe('Inactive conversions · 3');
  });
});

describe('the screen (static checks)',()=>{
  const screen=readFileSync('src/ui/screens/ReceiptSetupScreen.tsx','utf8');
  const unitRow=screen.slice(screen.indexOf('function UnitListRow('),screen.indexOf('function ConversionListRow('));
  const conversionRow=screen.slice(screen.indexOf('function ConversionListRow('),screen.indexOf('function ReactivateButton('));
  it('is two tabs with counts, one list at a time, under the standard page header',()=>{
    expect(screen).toContain('<PageHeader eyebrow="SETUP" title="Units & Conversions" onBack={onBack} />');
    expect(screen).toContain('<SegmentedChoice');
    expect(screen).toContain('mode="tabs"');
    expect(screen).toContain("{ id: 'units' as const, label: 'Units', count: activeUnits.length }");
    expect(screen).toContain("{ id: 'conversions' as const, label: 'Conversions', count: activeConversions.length }");
    expect(screen).toContain("{tab === 'units' ? (");
  });
  it('drops the banner, the counters, the section numbers and the repeated paragraphs',()=>{
    for(const gone of ['heroSummary','heroPurpose','SectionHeading','sectionMarker','ACTIVE UNITS','ACTIVE CONVERSIONS','Add Unit</Text>','Add Conversion</Text>','A unit is how a quantity is measured, such as tonnes'])expect(screen).not.toContain(gone);
  });
  it('has one fixed Add button that follows the tab and is off when a conversion has no unit to start from',()=>{
    expect(screen).toContain('const add = addAction(tab, activeUnits.length);');
    expect(screen).toContain("onPress={tab === 'units' ? openAddUnit : openAddConversion}");
    expect(screen).toContain('disabled={!add.enabled}');
    expect(screen).toContain('{add.hint ?');
  });
  it('shows a unit as one line and a conversion with the rule as its headline, and puts no Edit or Remove on the rows',()=>{
    expect(unitRow).toContain('unit.symbol');
    expect(unitRow).toContain('unit.name');
    expect(conversionRow).toContain('conversionEquation(conversion)');
    for(const row of [unitRow,conversionRow]){expect(row).not.toContain('Remove');expect(row).not.toContain('>Edit<');expect(row).toContain('onPress={onEdit}');}
  });
  it('keeps Remove, now at the bottom of each edit form, with the same confirmation and outcome sentences',()=>{
    expect(screen).toContain('<RemoveBlock kind="unit"');
    expect(screen).toContain('<RemoveBlock kind="conversion"');
    expect(screen).toContain("{unitSheet === 'edit' && editingUnit ?");
    expect(screen).toContain("{conversionSheet === 'edit' && editingConversion ?");
    for(const text of ['Remove or deactivate "${unit.name}"?','If nothing uses this unit it is deleted.','Unit deleted.','Unit is in use, so it was moved to Inactive and its history was kept.','Remove or deactivate "${value.name}"?','Conversion deleted.','Conversion is in use, so it was moved to Inactive and its history was kept.','repository.removeUnit(unit.id)','repository.removeConversion(value.id)'])expect(screen).toContain(text);
  });
  it('keeps Reactivate, on each inactive row, with the same outcome sentences',()=>{
    expect(screen).toContain("repository.setUnitActive(unit.id, true), 'Unit reactivated.'");
    expect(screen).toContain("repository.setConversionActive(value.id, true), 'Conversion reactivated.'");
    expect(screen).toContain('<ReactivateButton');
  });
  it('keeps the Inactive lists collapsed by default, search above 8 items, and the empty states',()=>{
    expect(screen).toContain('const [inactiveUnitsOpen, setInactiveUnitsOpen] = useState(false);');
    expect(screen).toContain('const [inactiveConversionsOpen, setInactiveConversionsOpen] = useState(false);');
    expect(screen).toContain('needsSearch(units.length)');
    expect(screen).toContain('needsSearch(conversions.length)');
    for(const text of ['No active units yet','No active conversions yet','No matching units','No matching conversions','Clear search'])expect(screen).toContain(text);
  });
  it('keeps the note that confirmed receipts keep the conversion they were saved with',()=>{
    expect(screen).toContain('Confirmed receipts keep the conversion they were saved with, so editing a rule only changes future calculations.');
  });
  it('saves through the same repository calls and keeps the uniqueness messages',()=>{
    for(const text of ['repository.updateUnit(editing, { name: unitName, symbol: unitSymbol })','repository.createUnit({ name: unitName, symbol: unitSymbol })','repository.updateConversion(editing, draft)','repository.createConversion(draft)','Another unit already uses that name.','Another unit already uses that symbol.','Another conversion already uses that name.'])expect(screen).toContain(text);
  });
  it('leaves the conversion form itself for Phase 2',()=>{
    for(const text of ['Decimal places *','<UnitPicker label="Input unit *"','<UnitPicker label="Output unit *"','THIS RULE READS AS'])expect(screen).toContain(text);
  });
  it('uses the shared formatting from the domain file, not its own copy',()=>{
    expect(screen).toContain("from '../../domain/unitsConversions'");
    expect(screen).not.toContain('function formatQuantity(');
  });
});
