import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { CompanyHeaderRepository } from '../../data/repositories/CompanyHeaderRepository';
import type { DocumentSignerRepository } from '../../data/repositories/DocumentSignerRepository';
import type { DemoArchiveStatus, ProfileRepository } from '../../data/repositories/ProfileRepository';
import type { DocumentSigner } from '../../domain/documentSigners';
import { validateCompanySettings } from '../../domain/profiles';
import { pickPersistentImage } from '../../services/media';
import { AppButton, AppCard, AppField, AppPage, Feedback, PageHeader } from '../components/AppPrimitives';
import { HeaderSignerField, type HeaderSignerValue } from '../components/HeaderSignerField';
import { colors } from '../theme';

/** The Plant Company: the existing Company profile. `headers` and `signers` add its registration number and default signer. */
export function SettingsScreen({ repository, onBack, headers, signers }: { repository: ProfileRepository; onBack: () => void; headers?: CompanyHeaderRepository; signers?: DocumentSignerRepository }) {
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxVatNumber, setTaxVatNumber] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [vatRate, setVatRate] = useState('0');
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [headerSigner, setHeaderSigner] = useState<HeaderSignerValue>({ signerId: null, display: null });
  const [signerList, setSignerList] = useState<DocumentSigner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoStatus, setDemoStatus] = useState<DemoArchiveStatus | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void repository.getCompanySettings().then((settings) => {
      if (!active) return;
      setCompanyName(settings.companyName);
      setAddress(settings.address ?? '');
      setPhone(settings.phone ?? '');
      setEmail(settings.email ?? '');
      setTaxVatNumber(settings.taxVatNumber ?? '');
      setReceiptFooter(settings.receiptFooter ?? '');
      setVatRate(String(settings.vatRatePercent));
      setLogoUri(settings.logoUri);
    });
    return () => { active = false; };
  }, [repository]);

  useEffect(() => {
    if (!headers || !signers) return;
    let active = true;
    void Promise.all([headers.getPlantExtras(), signers.listSigners()]).then(([extras, list]) => {
      if (!active) return;
      setRegistrationNumber(extras.registrationNumber ?? '');
      setHeaderSigner({ signerId: extras.signerId, display: extras.signerDisplay });
      setSignerList(list);
    }).catch(() => { if (active) setError('The registration number and default signer could not be loaded.'); });
    return () => { active = false; };
  }, [headers, signers]);

  useEffect(() => {
    let active = true;
    void repository.getDemoArchiveStatus().then((status) => { if (active) setDemoStatus(status); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not inspect DEMO records.'); });
    return () => { active = false; };
  }, [repository]);

  async function save() {
    const draft = {
      companyName,
      logoUri,
      address,
      phone,
      email,
      taxVatNumber,
      receiptFooter,
      vatRatePercent: vatRate.trim() ? Number(vatRate.replace(',', '.')) : 0,
    };
    const issues = validateCompanySettings(draft);
    if (issues[0]) {
      setSaved(false);
      setError(issues[0]);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await repository.saveCompanySettings(draft);
      if (headers) await headers.savePlantExtras({ registrationNumber, signerId: headerSigner.signerId, signerDisplay: headerSigner.display });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleDemoRecords() {
    if (!demoStatus || demoStatus.projects + demoStatus.loads === 0) return;
    const archive = !demoStatus.isArchived;
    setDemoBusy(true); setDemoMessage(null); setError(null);
    try {
      const next = await repository.setDemoRecordsArchived(archive);
      setDemoStatus(next);
      setDemoMessage(archive ? 'DEMO projects and loads are deactivated and hidden from normal app results.' : 'DEMO projects and loads are visible again. Projects keep their previous Completed status until reactivated from Projects.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update DEMO records.');
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <AppPage keyboard>
      <PageHeader eyebrow="COMPANY SETUPS" title="Plant Company" onBack={onBack} />
      <AppCard tone="navy" title="Your business identity" hint="Keep the details used on future receipts, authorizations, reports, and tax calculations in one place.">
        <View style={styles.contextRow}><Text style={styles.contextLabel}>DOCUMENT PROFILE</Text><Text style={styles.contextValue}>{companyName.trim() || 'Not configured'}</Text></View>
      </AppCard>
      {error ? <Feedback kind="error">{error}</Feedback> : null}
      {saved ? <Feedback kind="success">Company profile saved. The own-company customer record is ready.</Feedback> : null}

      <AppCard title="Company identity" hint="The company name and logo lead your newly generated business documents.">
        <AppField label="Company name *" value={companyName} onChangeText={setCompanyName} placeholder="DROMEX" />
        <View style={styles.logoPanel}>
          <View style={styles.logoHeading}><View style={styles.logoCopy}><Text style={styles.logoTitle}>Company logo</Text><Text style={styles.helper}>Shown in document headers when selected.</Text></View><Text style={[styles.logoStatus, logoUri && styles.logoStatusReady]}>{logoUri ? 'READY' : 'OPTIONAL'}</Text></View>
          {logoUri ? <Image source={{ uri: logoUri }} style={styles.logoPreview} resizeMode="contain" /> : <View style={styles.logoEmpty}><Text style={styles.logoMonogram}>D</Text><Text style={styles.logoEmptyText}>No logo selected</Text></View>}
          <View style={styles.logoActions}><View style={styles.logoAction}><AppButton label={logoUri ? 'Replace Logo' : 'Choose Logo'} tone="secondary" onPress={() => void pickPersistentImage('company').then((uri) => { if (uri) setLogoUri(uri); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not select logo.'))} /></View>{logoUri ? <View style={styles.logoAction}><AppButton label="Remove Logo" tone="danger" onPress={() => setLogoUri(null)} /></View> : null}</View>
        </View>
      </AppCard>

      <AppCard tone="cream" title="Report headers moved" hint="Ministry name and logo, consulting agency, and custom header now live in PDF Settings.">
        <Text style={styles.helper} accessibilityRole="text">More · Setup · PDF Settings holds the optional headers printed on Daily Report PDFs, in English and Arabic. Your company name, logo, contact details, VAT, and receipt footer stay on this screen.</Text>
      </AppCard>

      <AppCard title="Contact details" hint="These details appear beneath the company name on new documents.">
        <AppField label="Address" value={address} onChangeText={setAddress} multiline />
        <AppField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <AppField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      </AppCard>

      <AppCard title="Document details" hint="Optional information used on receipts and authorization output.">
        <AppField label="Tax / VAT registration number" value={taxVatNumber} onChangeText={setTaxVatNumber} />
        {headers ? <AppField label="Company registration number" value={registrationNumber} onChangeText={setRegistrationNumber} /> : null}
        <AppField label="Receipt footer message" value={receiptFooter} onChangeText={setReceiptFooter} multiline placeholder="Thank you for your business" />
      </AppCard>

      {headers && signers ? (
        <AppCard title="Default signer" hint="Chosen from Authorized signers. Their name, title and saved signature print on documents under this header. No second signature is stored here.">
          <HeaderSignerField signers={signerList} value={headerSigner} onChange={setHeaderSigner} />
        </AppCard>
      ) : null}

      <AppCard tone="cream" title="Tax settings" hint="The universal VAT rate applies to future numeric-priced receipts and purchases.">
        <AppField label="VAT percentage" value={vatRate} onChangeText={setVatRate} keyboardType="decimal-pad" placeholder="0" />
      </AppCard>

      <AppCard title="DEMO record visibility" hint="Keep old walkthrough records without mixing them into normal projects, loads, dashboards, reports, or balances.">
        <View style={styles.demoStatusRow}><View style={styles.logoCopy}><Text style={styles.demoCount}>{demoStatus ? `${demoStatus.projects} project${demoStatus.projects === 1 ? '' : 's'} · ${demoStatus.loads} load${demoStatus.loads === 1 ? '' : 's'}` : 'Checking DEMO records…'}</Text><Text style={styles.helper}>{demoStatus?.isArchived ? 'Currently deactivated and hidden' : demoStatus && demoStatus.projects + demoStatus.loads === 0 ? 'No DEMO projects or loads found' : 'Currently visible in app results'}</Text></View>{demoStatus && demoStatus.projects + demoStatus.loads > 0 ? <Text style={[styles.demoBadge, demoStatus.isArchived && styles.demoBadgeHidden]}>{demoStatus.isArchived ? 'INACTIVE' : 'VISIBLE'}</Text> : null}</View>
        {demoMessage ? <Feedback kind="success">{demoMessage}</Feedback> : null}
        <AppButton label={demoStatus?.isArchived ? 'Reactivate DEMO Projects & Loads' : 'Deactivate DEMO Projects & Loads'} tone={demoStatus?.isArchived ? 'navy' : 'danger'} disabled={!demoStatus || demoStatus.projects + demoStatus.loads === 0} busy={demoBusy} onPress={() => void toggleDemoRecords()} />
      </AppCard>

      <AppButton label="Save Company Settings" onPress={() => void save()} busy={busy} />
    </AppPage>
  );
}

const styles = StyleSheet.create({
  contextRow: { marginTop: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#6F8FA9', paddingTop: 12, gap: 3 },
  contextLabel: { color: '#F2A184', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  contextValue: { color: colors.cream, fontSize: 18, fontWeight: '900' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  logoPanel: { borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: '#FCFBF8', padding: 13, gap: 12 },
  logoHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, logoCopy: { flex: 1, minWidth: 0 }, logoTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  logoStatus: { color: colors.muted, backgroundColor: '#EEEAE3', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden', fontSize: 9, fontWeight: '900', letterSpacing: .7 }, logoStatusReady: { color: colors.success, backgroundColor: '#E5F3EC' },
  logoPreview: { width: '100%', height: 110, backgroundColor: '#FFF', borderRadius: 10 },
  logoEmpty: { minHeight: 100, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface }, logoMonogram: { width: 38, height: 38, borderRadius: 19, textAlign: 'center', textAlignVertical: 'center', color: '#FFF', backgroundColor: colors.navy, fontSize: 21, fontWeight: '900', overflow: 'hidden' }, logoEmptyText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  logoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, logoAction: { flexGrow: 1, minWidth: 135 },
  demoStatusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  demoCount: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  demoBadge: { color: colors.brandDark, backgroundColor: '#FBE9E4', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden', fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  demoBadgeHidden: { color: colors.muted, backgroundColor: '#EEEAE3' },
});
