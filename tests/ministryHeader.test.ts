import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../src/data/database/migrations';
import { SqliteProfileRepository } from '../src/data/repositories/SqliteProfileRepository';
import { SqliteProjectReportRepository } from '../src/data/repositories/SqliteProjectReportRepository';
import { ministryHeaderState } from '../src/domain/profiles';
import { consultantSignoffState, emptyDailyReport } from '../src/domain/projectReports';

class TestDatabase {
  readonly raw = new DatabaseSync(':memory:');
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const result = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({ changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

describe('ministry header state (DEC-389)', () => {
  it('reports which parts of the optional configuration exist', () => {
    expect(ministryHeaderState({ ministryName: 'Ministry of Works', ministryLogoUri: 'file:///m.png' })).toBe('complete');
    expect(ministryHeaderState({ ministryName: 'Ministry of Works', ministryLogoUri: null })).toBe('name-only');
    expect(ministryHeaderState({ ministryName: null, ministryLogoUri: 'file:///m.png' })).toBe('logo-only');
    expect(ministryHeaderState({ ministryName: null, ministryLogoUri: null })).toBe('not-configured');
    expect(ministryHeaderState({})).toBe('not-configured');
  });

  it('treats blank and whitespace-only values as not configured', () => {
    expect(ministryHeaderState({ ministryName: '   ', ministryLogoUri: '  ' })).toBe('not-configured');
    expect(ministryHeaderState({ ministryName: '  Ministry of Works  ', ministryLogoUri: '' })).toBe('name-only');
  });
});

describe('ministry header persistence', () => {
  const databases: TestDatabase[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  async function setup() {
    const database = new TestDatabase();
    databases.push(database);
    await migrateDatabase(database as never);
    const now = '2026-08-19T00:00:00.000Z';
    database.raw.exec(`
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_1','company','Road Works Ltd',0,1,'${now}','${now}');
      INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('project_1','cust_1','Road Project','Beirut','active','2026-07-01','${now}','${now}',0);
    `);
    return { database, profiles: new SqliteProfileRepository(database as never), reports: new SqliteProjectReportRepository(database as never) };
  }

  it('defaults a new report to ministry header OFF', () => {
    expect(emptyDailyReport('project_1').showMinistryHeader).toBe(false);
  });

  it('round-trips ministry name and logo through company settings', async () => {
    const { profiles } = await setup();
    const saved = await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png' });
    expect(saved).toMatchObject({ ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png' });
    const loaded = await profiles.getCompanySettings();
    expect(loaded).toMatchObject({ ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png', companyName: 'DROMEX' });
    expect(ministryHeaderState(loaded)).toBe('complete');
  });

  it('leaves ministry values unset when they are never configured', async () => {
    const { profiles } = await setup();
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11 });
    const loaded = await profiles.getCompanySettings();
    expect(loaded.ministryName).toBeNull();
    expect(loaded.ministryLogoUri).toBeNull();
    expect(ministryHeaderState(loaded)).toBe('not-configured');
  });

  it('allows configuring only one of the two values', async () => {
    const { profiles } = await setup();
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, ministryName: 'Ministry of Works' });
    expect(ministryHeaderState(await profiles.getCompanySettings())).toBe('name-only');
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, ministryLogoUri: 'file:///ministry.png' });
    expect(ministryHeaderState(await profiles.getCompanySettings())).toBe('logo-only');
  });

  it('never blocks saving settings because ministry values are missing', async () => {
    const { profiles } = await setup();
    await expect(profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11 })).resolves.toMatchObject({ companyName: 'DROMEX' });
  });

  it('round-trips the per-report ministry flag and keeps it independent of sign-off', async () => {
    const { reports } = await setup();
    const draft = { ...emptyDailyReport('project_1'), workDate: '2026-08-19', workDescription: 'Base course', showMinistryHeader: true };
    const saved = await reports.saveReport(draft);
    expect(saved.showMinistryHeader).toBe(true);
    expect(saved.consultantSignoffEnabled).toBe(false);
    const reloaded = await reports.getReportForDate('project_1', '2026-08-19');
    expect(reloaded?.showMinistryHeader).toBe(true);
    const off = await reports.saveReport({ ...draft, id: saved.id, showMinistryHeader: false });
    expect(off.showMinistryHeader).toBe(false);
    expect((await reports.getReportForDate('project_1', '2026-08-19'))?.showMinistryHeader).toBe(false);
  });

  it('loads a pre-migration report row as ministry header OFF', async () => {
    const { database, reports } = await setup();
    const now = '2026-08-19T00:00:00.000Z';
    database.raw.exec(`INSERT INTO daily_project_reports (id,project_id,work_date,work_description,created_at,updated_at) VALUES ('legacy_1','project_1','2026-08-18','Legacy row','${now}','${now}');`);
    const loaded = await reports.getReportForDate('project_1', '2026-08-18');
    expect(loaded?.showMinistryHeader).toBe(false);
    expect(loaded?.workDescription).toBe('Legacy row');
  });

  it('exposes the configured ministry values through daily-report setup', async () => {
    const { profiles, reports } = await setup();
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png' });
    const setupResult = await reports.getSetup();
    expect(setupResult.company).toMatchObject({ name: 'DROMEX', ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png' });
  });

  // The Ministry Header section's badge and warning are derived entirely from this state, so pin
  // the value the editor computes for each saved configuration.
  it('derives the editor state from saved settings for every configuration', async () => {
    const { profiles, reports } = await setup();
    const stateAfter = async (extra: {ministryName?: string | null; ministryLogoUri?: string | null}) => {
      await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, ...extra });
      return ministryHeaderState((await reports.getSetup()).company);
    };
    expect(await stateAfter({})).toBe('not-configured');
    expect(await stateAfter({ ministryName: 'Ministry of Works' })).toBe('name-only');
    expect(await stateAfter({ ministryLogoUri: 'file:///ministry.png' })).toBe('logo-only');
    expect(await stateAfter({ ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png' })).toBe('complete');
  });

  it('keeps consultant sign-off data intact when the ministry flag is saved alongside it', async () => {
    const { reports } = await setup();
    const draft = { ...emptyDailyReport('project_1'), workDate: '2026-08-19', workDescription: 'Base course',
      consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M10 10 L20 20'], showMinistryHeader: true };
    const saved = await reports.saveReport(draft);
    expect(saved).toMatchObject({ consultantSignoffEnabled: true, consultantName: 'Jad Khoury', showMinistryHeader: true });
    expect(saved.consultantSignaturePaths).toEqual(['M10 10 L20 20']);
    // Turning the ministry header off must not disturb the sign-off, per DEC-388.
    const off = await reports.saveReport({ ...draft, id: saved.id, showMinistryHeader: false });
    expect(off).toMatchObject({ consultantSignoffEnabled: true, consultantName: 'Jad Khoury', showMinistryHeader: false });
    expect(off.consultantSignaturePaths).toEqual(['M10 10 L20 20']);
  });

  // DEC-391: the consulting agency is global, optional, and deliberately outside completeness.
  it('round-trips the consulting agency name through company settings', async () => {
    const { profiles } = await setup();
    const saved = await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, consultingAgencyName: 'Cedar Engineering Consultants' });
    expect(saved.consultingAgencyName).toBe('Cedar Engineering Consultants');
    expect((await profiles.getCompanySettings()).consultingAgencyName).toBe('Cedar Engineering Consultants');
  });

  it('stores an unset, blank, or whitespace-only agency name as null', async () => {
    const { profiles } = await setup();
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11 });
    expect((await profiles.getCompanySettings()).consultingAgencyName).toBeNull();
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, consultingAgencyName: '   ' });
    expect((await profiles.getCompanySettings()).consultingAgencyName).toBeNull();
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, consultingAgencyName: '  Cedar  Engineering  ' });
    expect((await profiles.getCompanySettings()).consultingAgencyName).toBe('Cedar Engineering');
  });

  it('exposes the consulting agency name through daily-report setup', async () => {
    const { profiles, reports } = await setup();
    expect((await reports.getSetup()).company.consultingAgencyName).toBeNull();
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, consultingAgencyName: 'Cedar Engineering Consultants' });
    expect((await reports.getSetup()).company.consultingAgencyName).toBe('Cedar Engineering Consultants');
  });

  it('keeps the agency name out of sign-off completeness entirely', () => {
    const base = emptyDailyReport('project_1');
    // consultantSignoffState reads only the report; an agency name lives on settings and cannot reach it.
    expect(consultantSignoffState({ ...base, consultantSignoffEnabled: false })).toBe('disabled');
    expect(consultantSignoffState({ ...base, consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: [] })).toBe('incomplete');
    expect(consultantSignoffState({ ...base, consultantSignoffEnabled: true, consultantName: '', consultantSignaturePaths: ['M0 0'] })).toBe('incomplete');
    expect(consultantSignoffState({ ...base, consultantSignoffEnabled: true, consultantName: 'Jad Khoury', consultantSignaturePaths: ['M0 0'] })).toBe('complete');
  });

  it('leaves ministry values and the report flag untouched when only the agency name changes', async () => {
    const { profiles, reports } = await setup();
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png' });
    const draft = { ...emptyDailyReport('project_1'), workDate: '2026-08-19', workDescription: 'Base course', showMinistryHeader: true };
    const savedReport = await reports.saveReport(draft);
    await profiles.saveCompanySettings({ companyName: 'DROMEX', vatRatePercent: 11, ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png', consultingAgencyName: 'Cedar Engineering Consultants' });
    const company = (await reports.getSetup()).company;
    expect(company).toMatchObject({ ministryName: 'Ministry of Works', ministryLogoUri: 'file:///ministry.png', consultingAgencyName: 'Cedar Engineering Consultants' });
    expect((await reports.getReportForDate('project_1', '2026-08-19'))?.showMinistryHeader).toBe(true);
    expect(savedReport.showMinistryHeader).toBe(true);
  });

  it('exposes null ministry values through setup when nothing is configured', async () => {
    const { reports } = await setup();
    const setupResult = await reports.getSetup();
    expect(setupResult.company.ministryName).toBeNull();
    expect(setupResult.company.ministryLogoUri).toBeNull();
  });
});
