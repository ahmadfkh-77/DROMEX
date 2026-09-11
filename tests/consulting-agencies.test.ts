import {describe,expect,it} from 'vitest';

import {
  consultingAgencyDisplayLabel,
  consultingAgencyNeedsEnglishName,
  normalizeAgencyKey,
  normalizeAgencyName,
  resolveConsultingAgencySelectorOptions,
  validateConsultingAgencyDraft,
  type ConsultingAgency,
} from '../src/domain/profiles';

describe('consulting agency normalization',()=>{
  it('treats surrounding whitespace as the same key',()=>{
    expect(normalizeAgencyKey('Cedar')).toBe(normalizeAgencyKey(' Cedar '));
  });
  it('treats capitalization as the same key',()=>{
    expect(normalizeAgencyKey('Cedar')).toBe(normalizeAgencyKey('CEDAR'));
    expect(normalizeAgencyKey('Cedar')).toBe(normalizeAgencyKey('cedar'));
  });
  it('collapses repeated internal whitespace',()=>{
    expect(normalizeAgencyKey('Cedar   Engineering')).toBe(normalizeAgencyKey('Cedar Engineering'));
  });
  it('produces different keys for genuinely different names',()=>{
    expect(normalizeAgencyKey('Cedar')).not.toBe(normalizeAgencyKey('Cedra'));
  });

  it('normalizes the stored display name by trimming and collapsing whitespace, without changing case',()=>{
    expect(normalizeAgencyName('  Cedar   Engineering  ')).toBe('Cedar Engineering');
    // Case is preserved for the displayed name; only the key is case-folded.
    expect(normalizeAgencyName('CEDAR')).toBe('CEDAR');
  });
});

describe('consulting agency validation',()=>{
  it('requires a non-empty English name for a new draft',()=>{
    expect(validateConsultingAgencyDraft({nameEn:''})).toEqual(['English agency name is required.']);
    expect(validateConsultingAgencyDraft({nameEn:'   '})).toEqual(['English agency name is required.']);
    expect(validateConsultingAgencyDraft({nameEn:'Cedar'})).toEqual([]);
  });
  it('does not require an Arabic name',()=>{
    expect(validateConsultingAgencyDraft({nameEn:'Cedar',nameAr:null})).toEqual([]);
    expect(validateConsultingAgencyDraft({nameEn:'Cedar'})).toEqual([]);
  });
});

describe('legacy Arabic-only agency display (DEC-416)',()=>{
  const legacy: Pick<ConsultingAgency,'nameEn'|'nameAr'> = {nameEn:'',nameAr:'سيدار للاستشارات الهندسية'};
  const englishOnly: Pick<ConsultingAgency,'nameEn'|'nameAr'> = {nameEn:'Cedar',nameAr:null};
  const neither: Pick<ConsultingAgency,'nameEn'|'nameAr'> = {nameEn:'',nameAr:null};

  it('falls back to the Arabic name as the display label when English is empty',()=>{
    expect(consultingAgencyDisplayLabel(legacy)).toBe('سيدار للاستشارات الهندسية');
  });
  it('never invents or copies text into the English field itself',()=>{
    // The stored nameEn must remain exactly '' — display fallback is presentation only.
    expect(legacy.nameEn).toBe('');
  });
  it('uses the English name when present',()=>{
    expect(consultingAgencyDisplayLabel(englishOnly)).toBe('Cedar');
  });
  it('flags a legacy agency as needing an English name when edited',()=>{
    expect(consultingAgencyNeedsEnglishName(legacy)).toBe(true);
    expect(consultingAgencyNeedsEnglishName(englishOnly)).toBe(false);
  });
  it('has a safe fallback when neither language exists', () => {
    expect(consultingAgencyDisplayLabel(neither)).toBe('Unnamed agency');
  });
});

describe('consulting agency selector options (DEC-417)',()=>{
  const active1={id:'a1',nameEn:'Cedar',nameAr:null,isActive:true};
  const active2={id:'a2',nameEn:'Oakridge',nameAr:null,isActive:true};
  const inactiveOther={id:'a3',nameEn:'Maple',nameAr:null,isActive:false};
  const currentInactive={id:'a4',nameEn:'Willow',nameAr:null,isActive:false};
  const currentActive={id:'a1',nameEn:'Cedar',nameAr:null,isActive:true};

  it('offers every active agency when there is no current assignment',()=>{
    expect(resolveConsultingAgencySelectorOptions([active1,active2],null)).toEqual([active1,active2]);
  });
  it('includes the currently assigned agency even when it is inactive',()=>{
    expect(resolveConsultingAgencySelectorOptions([active1,active2],currentInactive)).toEqual([active1,active2,currentInactive]);
  });
  it('never offers an inactive agency other than the current one',()=>{
    const options=resolveConsultingAgencySelectorOptions([active1,active2],currentInactive);
    expect(options).not.toContainEqual(inactiveOther);
  });
  it('does not duplicate the current agency when it is already active and already in the list',()=>{
    expect(resolveConsultingAgencySelectorOptions([active1,active2],currentActive)).toEqual([active1,active2]);
  });
});
