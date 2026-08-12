import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { LoadRepository } from '../../data/repositories/LoadRepository';
import type { ProfileRepository } from '../../data/repositories/ProfileRepository';
import { validateCompanySettings } from '../../domain/profiles';
import { pickPersistentImage } from '../../services/media';
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
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}><Text style={styles.backLabel}>Back</Text></TouchableOpacity>
        <View style={styles.headerCopy}><Text style={styles.eyebrow}>SETTINGS</Text><Text style={styles.title}>Company profile</Text></View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.success}>Company profile saved. The own-company customer record is ready.</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Business information</Text>
        <Text style={styles.helper}>These details will appear on new receipts and delivery authorizations.</Text>
        <Field label="Company name *" value={companyName} onChangeText={setCompanyName} placeholder="DROMEX" />
        <Field label="Address" value={address} onChangeText={setAddress} multiline />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Tax / VAT registration number" value={taxVatNumber} onChangeText={setTaxVatNumber} />
        <Field label="Receipt footer message" value={receiptFooter} onChangeText={setReceiptFooter} multiline placeholder="Thank you for your business" />
        <View style={styles.logoPlaceholder}>
          <Text style={styles.logoTitle}>Company logo</Text>
          {logoUri ? <Image source={{ uri: logoUri }} style={styles.logoPreview} resizeMode="contain" /> : <Text style={styles.helper}>No logo selected.</Text>}
          <View style={styles.logoActions}><TouchableOpacity style={styles.logoButton} onPress={() => void pickPersistentImage('company').then((uri) => { if (uri) setLogoUri(uri); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not select logo.'))}><Text style={styles.logoButtonText}>{logoUri ? 'Replace logo' : 'Choose logo'}</Text></TouchableOpacity>{logoUri ? <TouchableOpacity onPress={() => setLogoUri(null)}><Text style={styles.removeLogo}>Remove</Text></TouchableOpacity> : null}</View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tax settings</Text>
        <Text style={styles.helper}>This universal VAT rate will apply to future numeric-priced receipts and purchases.</Text>
        <Field label="VAT percentage" value={vatRate} onChangeText={setVatRate} keyboardType="decimal-pad" placeholder="0" />
      </View>

      <View style={styles.demoCard}>
        <View style={styles.demoHeading}><View style={styles.demoCopy}><Text style={styles.cardTitle}>Demo data</Text><Text style={styles.helper}>Optional testing tools for linked receipts, projects, DPRs, waste dumps, profiles, and payment history.</Text></View><Text style={styles.demoBadge}>TEST ONLY</Text></View>
        {demoMessage ? <Text style={styles.demoMessage}>{demoMessage}</Text> : null}
        <View style={styles.demoActions}>
          <TouchableOpacity style={styles.demoLoad} disabled={demoBusy} onPress={() => void loadDemoData()}><Text style={styles.demoLoadText}>{demoBusy ? 'Working...' : 'Load linked demo data'}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.demoRemove} disabled={demoBusy} onPress={removeDemoData}><Text style={styles.demoRemoveText}>Remove demo data</Text></TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.saveButton} onPress={() => void save()} disabled={busy}>
        <Text style={styles.saveButtonLabel}>{busy ? 'Saving...' : 'Save company settings'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({ label, ...props }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'decimal-pad';
  autoCapitalize?: 'none' | 'sentences';
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, props.multiline && styles.multiline]} placeholderTextColor="#89939B" {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 36, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  headerCopy: { flex: 1 },
  backButton: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface },
  backLabel: { color: colors.ink, fontWeight: '700' },
  eyebrow: { color: colors.brand, fontWeight: '800', fontSize: 11, letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  error: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '600' },
  success: { color: colors.success, backgroundColor: '#E5F3EC', borderRadius: 10, padding: 12, fontWeight: '700' },
  card: { padding: 17, gap: 12, borderRadius: 16, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  field: { gap: 6 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, backgroundColor: '#FCFBF8' },
  multiline: { minHeight: 76, textAlignVertical: 'top' },
  logoPlaceholder: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 12, padding: 14, gap: 4 },
  logoTitle: { color: colors.ink, fontWeight: '800' },
  logoPreview: { width: '100%', height: 100, backgroundColor: '#FFF', borderRadius: 8 },
  logoActions: { flexDirection: 'row', alignItems: 'center', gap: 14 }, logoButton: { backgroundColor: colors.ink, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9 }, logoButtonText: { color: '#FFF', fontWeight: '800' }, removeLogo: { color: colors.danger, fontWeight: '800' },
  saveButton: { borderRadius: 12, backgroundColor: colors.brand, padding: 15, alignItems: 'center' },
  saveButtonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  demoCard: { padding: 17, gap: 12, borderRadius: 16, backgroundColor: '#FFF3D8', borderWidth: 1, borderColor: '#D8A84E' },
  demoHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, demoCopy: { flex: 1, minWidth: 0 }, demoBadge: { color: colors.warning, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  demoMessage: { color: colors.ink, fontSize: 12, lineHeight: 18, fontWeight: '700' }, demoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  demoLoad: { flexGrow: 1, minWidth: 150, backgroundColor: colors.ink, borderRadius: 10, padding: 12, alignItems: 'center' }, demoLoadText: { color: '#FFF', fontWeight: '900' },
  demoRemove: { flexGrow: 1, minWidth: 130, borderWidth: 1, borderColor: colors.danger, borderRadius: 10, padding: 12, alignItems: 'center' }, demoRemoveText: { color: colors.danger, fontWeight: '900' },
});
