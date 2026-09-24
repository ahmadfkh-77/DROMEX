import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import {
  describeFoundationSectionPreference,parseFoundationSectionPreference,serializeFoundationSectionPreference,
  FOUNDATION_SECTION_PREFERENCE_KEY,
} from '../src/domain/reportSectionPreferences';

/**
 * DEC-471. The Owner can exclude Foundation Construction from issued Daily Report output while that
 * part of the workflow is still being finished. Stored as an app preference, so no migration is
 * needed, and defaulting to included so nothing ever disappears from a report by accident.
 */
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

describe('the foundation report-section preference',()=>{
  it('is included by default when nothing has been stored',()=>{
    expect(parseFoundationSectionPreference(null)).toBe(true);
    expect(parseFoundationSectionPreference(undefined)).toBe(true);
    expect(parseFoundationSectionPreference('')).toBe(true);
  });

  it('is excluded only by the exact stored off value',()=>{
    expect(parseFoundationSectionPreference('off')).toBe(false);
    expect(parseFoundationSectionPreference('on')).toBe(true);
  });

  it('fails safe on a corrupt value by still including the section',()=>{
    for(const raw of ['OFF','0','false','no','{}','of'])expect(parseFoundationSectionPreference(raw)).toBe(true);
  });

  it('round-trips through storage',()=>{
    for(const included of [true,false])
      expect(parseFoundationSectionPreference(serializeFoundationSectionPreference(included))).toBe(included);
  });

  it('says plainly that excluding it does not delete anything',()=>{
    expect(describeFoundationSectionPreference(false)).toMatch(/still recorded/i);
    expect(describeFoundationSectionPreference(false)).toMatch(/excluded/i);
    expect(describeFoundationSectionPreference(true)).toMatch(/included/i);
  });

  it('uses a versioned preference key',()=>{
    expect(FOUNDATION_SECTION_PREFERENCE_KEY).toMatch(/^dromex\..*\.v\d+$/);
  });
});

describe('the switch is wired into the Daily Report editor and both exports',()=>{
  const reports=source('src/ui/screens/ReportsScreen.tsx');

  it('reads and stores the preference with the app storage the rest of the app uses',()=>{
    expect(reports).toContain('FOUNDATION_SECTION_PREFERENCE_KEY');
    expect(reports).toContain('parseFoundationSectionPreference');
    expect(reports).toContain('serializeFoundationSectionPreference');
  });

  it('offers a switch in the Foundation Construction section',()=>{
    expect(reports).toMatch(/accessibilityRole="switch"/);
    expect(reports).toContain('includeFoundationSection');
  });

  it('passes an empty activity list to both exports when the section is excluded',()=>{
    // The export call must send [] rather than the fetched rows, so nothing foundation-related can
    // reach the PDF or the workbook while the switch is off.
    expect(reports).toMatch(/includePrices,wallWork,includeFoundationSection\?foundationActivity:\[\]/);
    expect(reports).toMatch(/onProgress:setExportProgress\},wallWork,includeFoundationSection\?foundationActivity:\[\]/);
  });

  it('still records and still shows the foundation in the editor when excluded',()=>{
    expect(reports).toContain('describeFoundationSectionPreference');
    expect(reports).toMatch(/<LedgerSection number="09" title="Foundation Construction"/);
  });
});
