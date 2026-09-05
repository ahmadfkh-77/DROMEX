import { describe, expect, it } from 'vitest';
import { buildProjectReportHtmlWithWaste } from '../src/services/projectReportWasteTemplate';
import type { DailyProjectReport, ProjectReportSetup, ReportProject } from '../src/domain/projectReports';

const project: ReportProject = { id: 'p', name: 'Road', customerName: 'Customer', location: 'Aley', status: 'active' };
const plainCompany: ProjectReportSetup['company'] = { name: 'DROMEX', logoUri: null, address: null, phone: null, email: null, taxVatNumber: null, ministryName: null, ministryLogoUri: null, consultingAgencyName: null };
const ministryCompany: ProjectReportSetup['company'] = { ...plainCompany, ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png' };
const LOGO = 'data:image/png;base64,AAAA';

const baseReport: DailyProjectReport = {
  id: 'r', projectId: 'p', workDate: '2026-08-11', workDescription: 'Excavation', workers: [], drivers: [], truckPlates: [], machines: [],
  materials: [], workerSafety: [], photos: [], notes: '', problemsDelaysIncidents: '', weatherSiteConditions: '', workStartTime: '', workEndTime: '',
  breakMinutes: '', nextWorkPlanned: '', consultantSignoffEnabled: false, consultantName: '', consultantSignaturePaths: [], showMinistryHeader: false, createdAt: '', updatedAt: '',
};

function render(report: Partial<DailyProjectReport>, company = ministryCompany, ministryLogo: string | null = LOGO) {
  return buildProjectReportHtmlWithWaste({ ...baseReport, ...report }, project, [], [], [], [], company, null, [], false, ministryLogo);
}

// Assertions must ignore the <style> block, which names every CSS class whether it is used or not.
function body(html: string) { return html.slice(html.indexOf('</style></head><body>')); }
// Page one is everything before the .page-two container; the container itself starts the second page.
function pageOne(html: string) { const b = body(html); return b.slice(0, b.indexOf('<div class="page-two">')); }
function pageTwo(html: string) { const b = body(html); return b.slice(b.indexOf('<div class="page-two">')); }

describe('ministry header in the daily-report PDF (DEC-389)', () => {
  it('renders nothing when the report does not opt in, even with a fully configured ministry', () => {
    const html = render({ showMinistryHeader: false });
    expect(body(html)).not.toContain('ministry-identity');
    expect(body(html)).not.toContain('Ministry of Works');
    expect(body(html)).not.toContain(LOGO);
  });

  it('renders the logo and the name at the top of page one when both are configured', () => {
    const html = render({ showMinistryHeader: true });
    expect(pageOne(html)).toContain('ministry-identity');
    expect(pageOne(html)).toContain('Ministry of Works');
    expect(pageOne(html)).toContain(LOGO);
    // The ministry sits inside the header row, and the title drops to the strip beneath it.
    expect(pageOne(html)).toContain('report-heading');
    expect(body(html).indexOf('ministry-identity')).toBeLessThan(body(html).indexOf('report-heading'));
    // Page one's title moved into the strip; page two keeps its own header untouched.
    expect(pageOne(html)).not.toContain('class="report-title"');
    expect(pageTwo(html)).toContain('class="report-title"');
  });

  it('renders the name alone when only the name is configured', () => {
    const html = render({ showMinistryHeader: true }, { ...ministryCompany, ministryLogoUri: null }, null);
    expect(pageOne(html)).toContain('Ministry of Works');
    expect(body(html)).not.toContain('ministry-logo');
  });

  it('renders the logo alone when only the logo is configured', () => {
    const html = render({ showMinistryHeader: true }, { ...ministryCompany, ministryName: null }, LOGO);
    expect(pageOne(html)).toContain('ministry-logo');
    expect(body(html)).not.toContain('Ministry of Works');
    expect(body(html)).toContain('ministry-identity');
  });

  it('omits the block entirely when nothing is configured', () => {
    const html = render({ showMinistryHeader: true }, plainCompany, null);
    expect(body(html)).not.toContain('ministry-identity');
  });

  it('falls back to the name when the logo file cannot be read', () => {
    // documentExport passes null when imageUriToDataUrl throws; the block must still render.
    const html = render({ showMinistryHeader: true }, ministryCompany, null);
    expect(pageOne(html)).toContain('ministry-identity');
    expect(pageOne(html)).toContain('Ministry of Works');
    expect(body(html)).not.toContain('ministry-logo');
  });

  it('omits the block, without failing, when the logo is unreadable and no name is configured', () => {
    const html = render({ showMinistryHeader: true }, { ...ministryCompany, ministryName: null }, null);
    expect(body(html)).not.toContain('ministry-identity');
    expect(body(html)).toContain('<div class="page-two">');
  });

  it('never repeats the ministry block on page two', () => {
    const html = render({ showMinistryHeader: true });
    expect(pageTwo(html)).not.toContain('ministry-identity');
    expect(pageTwo(html)).not.toContain('Ministry of Works');
    expect(pageTwo(html)).not.toContain(LOGO);
  });

  it('keeps the existing report title and the Contractor label untouched', () => {
    const html = render({ showMinistryHeader: true });
    expect(body(html)).toContain('DAILY PROJECT REPORT');
    expect(body(html)).toContain('Contractor');
  });

  it('escapes a ministry name containing markup', () => {
    const html = render({ showMinistryHeader: true }, { ...ministryCompany, ministryName: '<script>x</script>' });
    expect(body(html)).not.toContain('<script>x</script>');
    expect(body(html)).toContain('&lt;script&gt;');
  });
});

describe('consultant sign-off split placement (DEC-390 / DEC-391)', () => {
  const complete = { consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M10 10 L20 20'] };
  const agencyCompany: ProjectReportSetup['company'] = { ...plainCompany, consultingAgencyName: 'Cedar Engineering Consultants' };

  it('puts the personal name and signature at the end of page two, immediately before Photo Evidence', () => {
    const html = render(complete, agencyCompany, null);
    expect(pageTwo(html)).toContain('consultant-signature-box');
    expect(pageTwo(html)).toContain('Jad Khoury');
    expect(pageOne(html)).not.toContain('Jad Khoury');
    expect(pageOne(html)).not.toContain('consultant-signature-box');
    const two = pageTwo(html);
    expect(two.indexOf('consultant-section')).toBeLessThan(two.indexOf('Photo evidence'));
    expect(two.indexOf('Site notes and follow-up')).toBeLessThan(two.indexOf('consultant-section'));
  });

  it('puts the agency name alone under the report title on page one', () => {
    const html = render(complete, agencyCompany, null);
    expect(pageOne(html)).toContain('agency-line');
    expect(pageOne(html)).toContain('Cedar Engineering Consultants');
    // The personal name is never part of the page-one header.
    expect(pageOne(html)).not.toContain('Jad Khoury');
    expect(body(html).indexOf('agency-line')).toBeLessThan(body(html).indexOf('project-line'));
    expect(pageTwo(html)).not.toContain('agency-line');
  });

  it('omits the agency line when no agency name is configured', () => {
    const html = render(complete, plainCompany, null);
    expect(body(html)).not.toContain('agency-line');
    expect(pageTwo(html)).toContain('Jad Khoury');
  });

  it('shows the agency name alongside the incomplete message, with no signature', () => {
    const html = render({ consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: [] }, agencyCompany, null);
    expect(pageOne(html)).toContain('Cedar Engineering Consultants');
    expect(pageTwo(html)).toContain('Consultant sign-off incomplete.');
    expect(pageTwo(html)).toContain('Signature not supplied.');
    expect(body(html)).not.toContain('consultant-signature-box');
    expect(body(html)).not.toContain('<svg viewBox="0 0 320 140">');
  });

  it('renders no agency, no name, and no signature when sign-off is disabled', () => {
    const html = render({ consultantSignoffEnabled: false, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M0 0'] }, agencyCompany, null);
    expect(body(html)).not.toContain('consultant-section');
    expect(body(html)).not.toContain('Jad Khoury');
    expect(body(html)).not.toContain('agency-line');
    expect(body(html)).not.toContain('Cedar Engineering Consultants');
  });

  it('escapes an agency name containing markup', () => {
    const html = render(complete, { ...plainCompany, consultingAgencyName: '<script>x</script>' }, null);
    expect(body(html)).not.toContain('<script>x</script>');
    expect(body(html)).toContain('&lt;script&gt;');
  });

  it('leaves an unbranded report otherwise identical to one with no agency configured', () => {
    // Only the agency line may differ; the rest of the document must be untouched.
    const withAgency = render({ consultantSignoffEnabled: false }, agencyCompany, null);
    const without = render({ consultantSignoffEnabled: false }, plainCompany, null);
    expect(withAgency).toBe(without);
  });
});

describe('header sizing and resilience', () => {
  const longCompany: ProjectReportSetup['company'] = {
    ...plainCompany,
    name: 'Dromex Contracting and General Trading Company Limited Liability',
    ministryName: 'Ministry of Public Works, Transport and Infrastructure Development',
    ministryLogoUri: 'file:///ministry.png',
  };

  it('marks the header branded only when the ministry occupies the right slot', () => {
    expect(pageOne(render({ showMinistryHeader: true }))).toContain('<header class="branded">');
    expect(pageOne(render({ showMinistryHeader: false }))).toContain('<header>');
    expect(pageOne(render({ showMinistryHeader: false }))).not.toContain('class="branded"');
    // Enabled but nothing configured falls back to the unbranded header.
    expect(pageOne(render({ showMinistryHeader: true }, plainCompany, null))).not.toContain('class="branded"');
  });

  it('carries larger contained logo rules that cannot overflow or distort', () => {
    const html = render({ showMinistryHeader: true });
    expect(html).toContain('header.branded .brand img,header.branded .ministry-identity .ministry-logo{max-width:min(100%,56mm);width:auto;height:auto;max-height:26mm}');
    // width/height auto keeps the intrinsic aspect ratio; min() keeps it inside its column.
    expect(html).toContain('header.branded{align-items:center;gap:8mm');
  });

  it('renders long company and ministry names in full with wrapping enabled', () => {
    const html = render({ showMinistryHeader: true }, longCompany, LOGO);
    expect(pageOne(html)).toContain('Dromex Contracting and General Trading Company Limited Liability');
    expect(pageOne(html)).toContain('Ministry of Public Works, Transport and Infrastructure Development');
    expect(html).toContain('overflow-wrap:anywhere');
  });

  it('keeps the unbranded header byte-identical whether or not a ministry is configured', () => {
    const configured = render({ showMinistryHeader: false }, longCompany, LOGO);
    const unconfigured = render({ showMinistryHeader: false }, { ...longCompany, ministryName: null, ministryLogoUri: null }, null);
    expect(configured).toBe(unconfigured);
    expect(configured).not.toContain('class="branded"');
  });

  it('keeps both page structures intact on a dense report', () => {
    const dense = {
      showMinistryHeader: true,
      consultantSignoffEnabled: true,
      consultantName: 'Jad Khoury',
      consultantSignaturePaths: ['M10 10 L20 20'],
      workers: Array.from({ length: 25 }, (_, i) => `Worker ${i + 1}`),
      drivers: Array.from({ length: 8 }, (_, i) => `Driver ${i + 1}`),
      truckPlates: Array.from({ length: 8 }, (_, i) => `PLATE-${i + 1}`),
      machines: Array.from({ length: 6 }, (_, i) => `Machine ${i + 1}`),
      materials: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, itemId: `i${i}`, itemName: `Material ${i + 1}`, quantity: i + 1, unitId: 'unit_t', unitName: 'Tonne', unitSymbol: 't', movement: 'used' as const })),
      photos: Array.from({ length: 20 }, (_, i) => `file:///photo${i}.jpg`),
      notes: 'x'.repeat(2000),
      problemsDelaysIncidents: 'y'.repeat(2000),
    };
    const html = buildProjectReportHtmlWithWaste({ ...baseReport, ...dense }, project, [], [], [], [],
      { ...ministryCompany, consultingAgencyName: 'Cedar Engineering Consultants' }, null,
      dense.photos.map(() => 'data:image/jpeg;base64,AAAA'), false, LOGO);
    const one = pageOne(html); const two = pageTwo(html);
    expect(one).toContain('ministry-identity');
    expect(one).toContain('agency-line');
    expect(one).toContain('Material 30');
    expect(one).not.toContain('Jad Khoury');
    expect(two.indexOf('consultant-section')).toBeLessThan(two.indexOf('Photo evidence'));
    expect(two).toContain('Jad Khoury');
    expect((html.match(/<div class="page-two">/g) ?? [])).toHaveLength(1);
  });
});

describe('approval safety (DEC-390 / DEC-032)', () => {
  const forbidden = ['Approved by', 'approved by', 'Certified by', 'certified by', 'Authorised by', 'Authorized by', 'Endorsed by', 'endorsement'];

  it('uses no approval or endorsement wording in any ministry or consultant state', () => {
    const variants = [
      render({ showMinistryHeader: true, consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M10 10'] }),
      render({ showMinistryHeader: true, consultantSignoffEnabled: true, consultantName: '', consultantSignaturePaths: [] }),
      render({ showMinistryHeader: true }),
      render({ showMinistryHeader: false, consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M10 10'] }),
    ];
    for (const html of variants) for (const phrase of forbidden) expect(body(html)).not.toContain(phrase);
  });

  it('labels the sign-off with the permitted wording only', () => {
    const html = render({ consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M10 10'] });
    expect(body(html)).toContain('Consultant Sign-off');
    expect(body(html)).not.toContain('Approval');
  });
});
