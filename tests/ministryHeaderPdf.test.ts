import { describe, expect, it } from 'vitest';
import { buildProjectReportHtmlWithWaste } from '../src/services/projectReportWasteTemplate';
import type { DailyProjectReport, ProjectReportSetup, ReportProject } from '../src/domain/projectReports';

const project: ReportProject = { id: 'p', name: 'Road', customerName: 'Customer', location: 'Aley', status: 'active' };
const plainCompany: ProjectReportSetup['company'] = { name: 'DROMEX', logoUri: null, address: null, phone: null, email: null, taxVatNumber: null, ministryName: null, ministryNameAr: null, ministryLogoUri: null, consultingAgencyName: null, consultingAgencyNameAr: null, customHeaderEn: null, customHeaderAr: null };
const ministryCompany: ProjectReportSetup['company'] = { ...plainCompany, ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png' };
const LOGO = 'data:image/png;base64,AAAA';
const MINISTRY_AR = 'وزارة الأشغال العامة';
const AGENCY_AR = 'سيدار للاستشارات الهندسية';

const baseReport: DailyProjectReport = {
  id: 'r', projectId: 'p', workDate: '2026-08-11', workDescription: 'Excavation', workers: [], drivers: [], truckPlates: [], machines: [],
  materials: [], workerSafety: [], photos: [], notes: '', problemsDelaysIncidents: '', weatherSiteConditions: '', workStartTime: '', workEndTime: '',
  breakMinutes: '', nextWorkPlanned: '', consultantSignoffEnabled: false, consultantName: '', consultantSignaturePaths: [],
  showMinistryHeader: false, showConsultingAgency: false, showCustomHeader: false, createdAt: '', updatedAt: '',
};

function render(report: Partial<DailyProjectReport>, company = ministryCompany, ministryLogo: string | null = LOGO) {
  return buildProjectReportHtmlWithWaste({ ...baseReport, ...report }, project, [], [], [], [], company, null, [], false, ministryLogo);
}

// Assertions must ignore the <style> block, which names every CSS class whether it is used or not.
function body(html: string) { return html.slice(html.indexOf('</style></head><body>')); }
function pageOne(html: string) { const b = body(html); return b.slice(0, b.indexOf('<div class="page-two">')); }
function pageTwo(html: string) { const b = body(html); return b.slice(b.indexOf('<div class="page-two">')); }

describe('three independent optional headers (DEC-398)', () => {
  it('renders nothing when no switch is on, even with everything configured', () => {
    const html = render({}, { ...ministryCompany, consultingAgencyName: 'Cedar Engineering', customHeaderEn: 'Contract 114' });
    expect(body(html)).not.toContain('institutional');
    expect(body(html)).not.toContain('Ministry of Works');
    expect(body(html)).not.toContain('Cedar Engineering');
    expect(body(html)).not.toContain('Contract 114');
    expect(body(html)).not.toContain(LOGO);
  });

  it('renders each header alone when only its own switch is on', () => {
    const company = { ...ministryCompany, consultingAgencyName: 'Cedar Engineering', customHeaderEn: 'Contract 114' };
    const ministryOnly = pageOne(render({ showMinistryHeader: true }, company));
    expect(ministryOnly).toContain('inst-ministry');
    expect(ministryOnly).not.toContain('inst-agency');
    expect(ministryOnly).not.toContain('inst-custom');

    const agencyOnly = pageOne(render({ showConsultingAgency: true }, company, null));
    expect(agencyOnly).toContain('inst-agency');
    expect(agencyOnly).not.toContain('inst-ministry');
    expect(agencyOnly).not.toContain('inst-custom');

    const customOnly = pageOne(render({ showCustomHeader: true }, company, null));
    expect(customOnly).toContain('inst-custom');
    expect(customOnly).not.toContain('inst-ministry');
    expect(customOnly).not.toContain('inst-agency');
  });

  it('renders all three together, in the order ministry, agency, custom (DEC-401)', () => {
    const html = pageOne(render({ showMinistryHeader: true, showConsultingAgency: true, showCustomHeader: true },
      { ...ministryCompany, consultingAgencyName: 'Cedar Engineering', customHeaderEn: 'Contract 114' }));
    expect(html.indexOf('inst-ministry')).toBeLessThan(html.indexOf('inst-agency'));
    expect(html.indexOf('inst-agency')).toBeLessThan(html.indexOf('inst-custom'));
  });

  it('renders a header switched on but never configured as nothing at all', () => {
    const html = render({ showMinistryHeader: true, showConsultingAgency: true, showCustomHeader: true }, plainCompany, null);
    expect(body(html)).not.toContain('institutional');
    expect(body(html)).toContain('<div class="page-two">');
  });

  it('never repeats any header on page two', () => {
    const html = render({ showMinistryHeader: true, showConsultingAgency: true, showCustomHeader: true },
      { ...ministryCompany, consultingAgencyName: 'Cedar Engineering', customHeaderEn: 'Contract 114' });
    expect(pageTwo(html)).not.toContain('institutional');
    expect(pageTwo(html)).not.toContain('Ministry of Works');
    expect(pageTwo(html)).not.toContain('Cedar Engineering');
    expect(pageTwo(html)).not.toContain(LOGO);
  });

  it('escapes markup in every header value', () => {
    const html = render({ showMinistryHeader: true, showConsultingAgency: true, showCustomHeader: true },
      { ...ministryCompany, ministryName: '<script>a</script>', consultingAgencyName: '<script>b</script>', customHeaderEn: '<script>c</script>' }, null);
    expect(body(html)).not.toContain('<script>');
    expect(body(html)).toContain('&lt;script&gt;');
  });
});

describe('consulting agency is independent of consultant sign-off (DEC-399)', () => {
  const agencyCompany: ProjectReportSetup['company'] = { ...plainCompany, consultingAgencyName: 'Cedar Engineering Consultants' };
  const complete = { consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M10 10 L20 20'] };

  // This is the behaviour DEC-399 exists to create, and it is the exact inverse of what the previous
  // implementation guaranteed. It is asserted in both directions on purpose.
  it('shows the agency with sign-off OFF when its own switch is on', () => {
    const html = render({ showConsultingAgency: true, consultantSignoffEnabled: false }, agencyCompany, null);
    expect(pageOne(html)).toContain('Cedar Engineering Consultants');
    expect(body(html)).not.toContain('consultant-section');
  });

  it('hides the agency with sign-off ON when its own switch is off', () => {
    const html = render({ ...complete, showConsultingAgency: false }, agencyCompany, null);
    expect(body(html)).not.toContain('Cedar Engineering Consultants');
    expect(pageTwo(html)).toContain('Jad Khoury');
  });

  it('keeps the personal name and signature at the end of page two, before Photo Evidence', () => {
    const html = render({ ...complete, showConsultingAgency: true }, agencyCompany, null);
    expect(pageOne(html)).not.toContain('Jad Khoury');
    expect(pageOne(html)).not.toContain('consultant-signature-box');
    const two = pageTwo(html);
    expect(two).toContain('Jad Khoury');
    expect(two.indexOf('consultant-section')).toBeLessThan(two.indexOf('Photo evidence'));
    expect(two.indexOf('Site notes and follow-up')).toBeLessThan(two.indexOf('consultant-section'));
  });

  it('shows the agency header alongside an incomplete sign-off, with no signature image', () => {
    const html = render({ showConsultingAgency: true, consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: [] }, agencyCompany, null);
    expect(pageOne(html)).toContain('Cedar Engineering Consultants');
    expect(pageTwo(html)).toContain('Consultant sign-off incomplete.');
    expect(body(html)).not.toContain('consultant-signature-box');
  });

  it('leaves a report with every switch off byte-identical whether or not an agency is configured', () => {
    expect(render({ consultantSignoffEnabled: false }, agencyCompany, null)).toBe(render({ consultantSignoffEnabled: false }, plainCompany, null));
  });
});

describe('bilingual direction and balance (DEC-400)', () => {
  it('places English left-to-right and Arabic right-to-left, facing each other', () => {
    const html = pageOne(render({ showMinistryHeader: true }, { ...ministryCompany, ministryNameAr: MINISTRY_AR }));
    expect(html).toContain('<div class="bi-en" dir="ltr" lang="en">Ministry of Works</div>');
    expect(html).toContain(`<div class="bi-ar" dir="rtl" lang="ar">${MINISTRY_AR}</div>`);
    expect(html.indexOf('bi-en')).toBeLessThan(html.indexOf('bi-ar'));
    expect(html).not.toContain('bi-solo');
  });

  it('gives a single configured language the full width instead of an empty facing column', () => {
    const englishOnly = pageOne(render({ showMinistryHeader: true }, { ...ministryCompany, ministryNameAr: null }));
    expect(englishOnly).toContain('class="bi-en bi-solo"');
    expect(englishOnly).not.toContain('class="bi-ar"');

    const arabicOnly = pageOne(render({ showMinistryHeader: true }, { ...ministryCompany, ministryName: null, ministryNameAr: MINISTRY_AR }));
    expect(arabicOnly).toContain('class="bi-ar bi-solo"');
    expect(arabicOnly).not.toContain('class="bi-en"');
  });

  it('supports Arabic on every one of the three headers', () => {
    const html = pageOne(render({ showMinistryHeader: true, showConsultingAgency: true, showCustomHeader: true },
      { ...ministryCompany, ministryNameAr: MINISTRY_AR, consultingAgencyNameAr: AGENCY_AR, customHeaderAr: 'عقد ٢٠٢٦/١١٤' }));
    expect(html).toContain(MINISTRY_AR);
    expect(html).toContain(AGENCY_AR);
    expect(html).toContain('عقد ٢٠٢٦/١١٤');
    expect((html.match(/dir="rtl"/g) ?? [])).toHaveLength(3);
  });

  it('declares an Arabic-capable font stack without bundling a font file', () => {
    const html = render({ showMinistryHeader: true }, { ...ministryCompany, ministryNameAr: MINISTRY_AR });
    expect(html).toContain(`.bi-ar{direction:rtl;text-align:right;font-family:'Noto Naskh Arabic','Geeza Pro','Segoe UI',Arial,sans-serif}`);
    // Body falls through per glyph, so a mixed line shapes without a per-element override.
    expect(html).toContain(`font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif`);
    expect(html).not.toContain('@font-face');
    expect(html).not.toContain('base64,AAAAAA');
  });

  it('escapes markup inside Arabic values too', () => {
    const html = render({ showMinistryHeader: true }, { ...ministryCompany, ministryNameAr: '<script>ع</script>' }, null);
    expect(body(html)).not.toContain('<script>');
    expect(body(html)).toContain('&lt;script&gt;');
  });

  it('lets long values in either language wrap rather than overflow', () => {
    const html = render({ showMinistryHeader: true }, {
      ...ministryCompany,
      ministryName: 'Ministry of Public Works, Transport and Infrastructure Development',
      ministryNameAr: `${MINISTRY_AR} والنقل وتطوير البنية التحتية`,
    });
    expect(pageOne(html)).toContain('Ministry of Public Works, Transport and Infrastructure Development');
    expect(html).toContain('overflow-wrap:anywhere');
  });
});

describe('page-one composition and logo ownership (DEC-401)', () => {
  it('orders the logo row, institutional text, divider, and centred title', () => {
    const one = pageOne(render({ showMinistryHeader: true }));
    expect(one.indexOf('logo-row')).toBeLessThan(one.indexOf('institutional'));
    expect(one.indexOf('institutional')).toBeLessThan(one.indexOf('head-rule'));
    expect(one.indexOf('head-rule')).toBeLessThan(one.indexOf('doc-title'));
    expect(one).toContain('<h1 class="doc-title">DAILY PROJECT REPORT</h1>');
  });

  it('puts the company logo on the left and the ministry logo on the right', () => {
    const one = pageOne(buildProjectReportHtmlWithWaste({ ...baseReport, showMinistryHeader: true }, project, [], [], [], [], ministryCompany, 'data:image/png;base64,CCCC', [], false, LOGO));
    expect(one.indexOf('company-slot')).toBeLessThan(one.indexOf('ministry-slot'));
    expect(one).toContain('class="company-logo" src="data:image/png;base64,CCCC"');
    expect(one).toContain(`class="ministry-logo" src="${LOGO}"`);
  });

  it('keeps the company logo when the ministry header is switched off', () => {
    const one = pageOne(buildProjectReportHtmlWithWaste({ ...baseReport, showMinistryHeader: false }, project, [], [], [], [], ministryCompany, 'data:image/png;base64,CCCC', [], false, LOGO));
    expect(one).toContain('class="company-logo" src="data:image/png;base64,CCCC"');
    expect(one).not.toContain('ministry-slot');
    expect(one).not.toContain(LOGO);
  });

  it('falls back to the ministry name when the logo file cannot be read', () => {
    // documentExport passes null when imageUriToDataUrl throws; the name must still render.
    const one = pageOne(render({ showMinistryHeader: true }, ministryCompany, null));
    expect(one).toContain('Ministry of Works');
    expect(one).not.toContain('ministry-slot');
  });

  it('scales logos proportionally and never stretches or crops them', () => {
    const html = render({ showMinistryHeader: true });
    expect(html).toContain('.company-logo,.ministry-logo{max-width:min(100%,56mm);width:auto;height:auto;max-height:26mm;object-fit:contain}');
  });

  it('keeps the report title and the Contractor label', () => {
    const html = render({ showMinistryHeader: true });
    expect(body(html)).toContain('DAILY PROJECT REPORT');
    expect(body(html)).toContain('Contractor');
  });

  it('keeps page one identical whether or not headers are configured, when every switch is off', () => {
    const configured = render({}, { ...ministryCompany, ministryNameAr: MINISTRY_AR, consultingAgencyName: 'Cedar', customHeaderEn: 'Contract' }, LOGO);
    const unconfigured = render({}, plainCompany, null);
    expect(configured).toBe(unconfigured);
  });

  it('keeps both page structures intact on a dense report with all three headers', () => {
    const dense = {
      showMinistryHeader: true, showConsultingAgency: true, showCustomHeader: true,
      consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M10 10 L20 20'],
      workers: Array.from({ length: 25 }, (_, i) => `Worker ${i + 1}`),
      drivers: Array.from({ length: 8 }, (_, i) => `Driver ${i + 1}`),
      truckPlates: Array.from({ length: 8 }, (_, i) => `PLATE-${i + 1}`),
      machines: Array.from({ length: 6 }, (_, i) => `Machine ${i + 1}`),
      materials: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, itemId: `i${i}`, itemName: `Material ${i + 1}`, quantity: i + 1, unitId: 'unit_t', unitName: 'Tonne', unitSymbol: 't', movement: 'used' as const })),
      photos: Array.from({ length: 20 }, (_, i) => `file:///photo${i}.jpg`),
      notes: 'x'.repeat(2000), problemsDelaysIncidents: 'y'.repeat(2000),
    };
    const html = buildProjectReportHtmlWithWaste({ ...baseReport, ...dense }, project, [], [], [], [],
      { ...ministryCompany, ministryNameAr: MINISTRY_AR, consultingAgencyName: 'Cedar Engineering Consultants', consultingAgencyNameAr: AGENCY_AR, customHeaderEn: 'Contract 2026/114' }, null,
      dense.photos.map(() => 'data:image/jpeg;base64,AAAA'), false, LOGO);
    const one = pageOne(html); const two = pageTwo(html);
    expect(one).toContain('inst-ministry');
    expect(one).toContain('inst-agency');
    expect(one).toContain('inst-custom');
    expect(one).toContain('Material 30');
    expect(one).not.toContain('Jad Khoury');
    expect(two.indexOf('consultant-section')).toBeLessThan(two.indexOf('Photo evidence'));
    expect((html.match(/<div class="page-two">/g) ?? [])).toHaveLength(1);
  });
});

describe('approval safety (DEC-390 / DEC-032)', () => {
  const forbidden = ['Approved by', 'approved by', 'Certified by', 'certified by', 'Authorised by', 'Authorized by', 'Endorsed by', 'endorsement'];

  it('uses no approval or endorsement wording in any header or consultant state', () => {
    const company = { ...ministryCompany, ministryNameAr: MINISTRY_AR, consultingAgencyName: 'Cedar Engineering', consultingAgencyNameAr: AGENCY_AR, customHeaderEn: 'Contract 114' };
    const variants = [
      render({ showMinistryHeader: true, showConsultingAgency: true, showCustomHeader: true, consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M10 10'] }, company),
      render({ showMinistryHeader: true, showConsultingAgency: true, consultantSignoffEnabled: true, consultantName: '', consultantSignaturePaths: [] }, company),
      render({ showConsultingAgency: true }, company, null),
      render({}, company, null),
    ];
    for (const html of variants) for (const phrase of forbidden) expect(body(html)).not.toContain(phrase);
  });

  it('carries no verb on the agency header line', () => {
    const one = pageOne(render({ showConsultingAgency: true }, { ...plainCompany, consultingAgencyName: 'Cedar Engineering Consultants' }, null));
    expect(one).toContain('Cedar Engineering Consultants');
    // The old implementation printed a "Consultant" label beside it; the header is now the name alone.
    expect(one).not.toContain('agency-label');
  });

  it('labels the sign-off with the permitted wording only', () => {
    const html = render({ consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M10 10'] });
    expect(body(html)).toContain('Consultant Sign-off');
    expect(body(html)).not.toContain('Approval');
  });
});
