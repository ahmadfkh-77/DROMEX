import { useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { LoadRepository } from '../../data/repositories/LoadRepository';
import type { ProfileRepository } from '../../data/repositories/ProfileRepository';
import { validateCompanySettings } from '../../domain/profiles';
import { pickPersistentImage } from '../../services/media';
import { AppButton, AppCard, AppField, AppPage, Feedback, PageHeader } from '../components/AppPrimitives';
import { colors } from '../theme';

export function SettingsScreen({ repository, demoRepository, onBack }: { repository: ProfileRepository; demoRepository: LoadRepository; onBack: () => void }) {
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxVatNumber, setTaxVatNumber] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [vatRate, setVatRate] = useState('0');
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
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
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  async function loadDemoData() {
    setDemoBusy(true);
    setDemoMessage(null);
    try {
      const count = await demoRepository.seedFilterTestLoads();
      setDemoMessage(`${count} linked demo receipts and their projects, DPRs, waste dumps, profiles, and payments are ready.`);
    } catch (cause) {
      setDemoMessage(cause instanceof Error ? cause.message : 'Could not load demo data.');
    } finally {
      setDemoBusy(false);
    }
  }

  function removeDemoData() {
    Alert.alert('Remove all linked demo data?', 'This removes only the reserved demo receipts, customers, projects, DPRs, waste dumps, profiles, and payments. Real records are not affected.', [
      { text: 'Keep demo data', style: 'cancel' },
      { text: 'Remove demo data', style: 'destructive', onPress: async () => {
        setDemoBusy(true);
        setDemoMessage(null);
        try {
          const count = await demoRepository.removeFilterTestLoads();
          setDemoMessage(`${count} demo receipts and all linked demo records were removed. Real records were not changed.`);
        } catch (cause) {
          setDemoMessage(cause instanceof Error ? cause.message : 'Could not remove demo data.');
        } finally {
          setDemoBusy(false);
        }
      } },
    ]);
  }

  return (
    <AppPage keyboard>
      <PageHeader eyebrow="SETTINGS" title="Company profile" onBack={onBack} />
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

      <AppCard title="Contact details" hint="These details appear beneath the company name on new documents.">
        <AppField label="Address" value={address} onChangeText={setAddress} multiline />
        <AppField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <AppField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      </AppCard>

      <AppCard title="Document details" hint="Optional information used on receipts and authorization output.">
        <AppField label="Tax / VAT registration number" value={taxVatNumber} onChangeText={setTaxVatNumber} />
        <AppField label="Receipt footer message" value={receiptFooter} onChangeText={setReceiptFooter} multiline placeholder="Thank you for your business" />
      </AppCard>

      <AppCard tone="cream" title="Tax settings" hint="The universal VAT rate applies to future numeric-priced receipts and purchases.">
        <AppField label="VAT percentage" value={vatRate} onChangeText={setVatRate} keyboardType="decimal-pad" placeholder="0" />
      </AppCard>

      <View style={styles.demoCard}>
        <View style={styles.demoHeading}><View style={styles.demoCopy}><Text style={styles.cardTitle}>Demo data</Text><Text style={styles.helper}>Optional testing tools for linked receipts, projects, DPRs, waste dumps, profiles, and payment history.</Text></View><Text style={styles.demoBadge}>TEST ONLY</Text></View>
        {demoMessage ? <Text style={styles.demoMessage}>{demoMessage}</Text> : null}
        <View style={styles.demoActions}>
          <TouchableOpacity style={styles.demoLoad} disabled={demoBusy} onPress={() => void loadDemoData()}><Text style={styles.demoLoadText}>{demoBusy ? 'Working...' : 'Load linked demo data'}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.demoRemove} disabled={demoBusy} onPress={removeDemoData}><Text style={styles.demoRemoveText}>Remove demo data</Text></TouchableOpacity>
        </View>
      </View>

      <AppButton label="Save Company Settings" onPress={() => void save()} busy={busy} />
    </AppPage>
  );
}

const styles = StyleSheet.create({
  contextRow: { marginTop: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#6F8FA9', paddingTop: 12, gap: 3 },
  contextLabel: { color: '#F2A184', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  contextValue: { color: colors.cream, fontSize: 18, fontWeight: '900' },
  cardTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  logoPanel: { borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: '#FCFBF8', padding: 13, gap: 12 },
  logoHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, logoCopy: { flex: 1, minWidth: 0 }, logoTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  logoStatus: { color: colors.muted, backgroundColor: '#EEEAE3', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden', fontSize: 9, fontWeight: '900', letterSpacing: .7 }, logoStatusReady: { color: colors.success, backgroundColor: '#E5F3EC' },
  logoPreview: { width: '100%', height: 110, backgroundColor: '#FFF', borderRadius: 10 },
  logoEmpty: { minHeight: 100, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface }, logoMonogram: { width: 38, height: 38, borderRadius: 19, textAlign: 'center', textAlignVertical: 'center', color: '#FFF', backgroundColor: colors.navy, fontSize: 21, fontWeight: '900', overflow: 'hidden' }, logoEmptyText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  logoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, logoAction: { flexGrow: 1, minWidth: 135 },
  demoCard: { padding: 17, gap: 12, borderRadius: 16, backgroundColor: '#FFF3D8', borderWidth: 1, borderColor: '#D8A84E' },
  demoHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, demoCopy: { flex: 1, minWidth: 0 }, demoBadge: { color: colors.warning, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  demoMessage: { color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: '700' }, demoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  demoLoad: { flexGrow: 1, minWidth: 150, backgroundColor: colors.ink, borderRadius: 10, padding: 12, alignItems: 'center' }, demoLoadText: { color: '#FFF', fontWeight: '900' },
  demoRemove: { flexGrow: 1, minWidth: 130, borderWidth: 1, borderColor: colors.danger, borderRadius: 10, padding: 12, alignItems: 'center' }, demoRemoveText: { color: colors.danger, fontWeight: '900' },
});
