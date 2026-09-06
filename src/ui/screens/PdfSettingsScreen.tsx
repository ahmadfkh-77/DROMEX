import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { ProfileRepository } from '../../data/repositories/ProfileRepository';
import { documentHeaderConfigured, type CompanySettings, type DocumentHeaderKind } from '../../domain/profiles';
import { pickPersistentImage } from '../../services/media';
import { colors } from '../theme';

type Draft = {
  ministryName: string; ministryNameAr: string; ministryLogoUri: string | null;
  consultingAgencyName: string; consultingAgencyNameAr: string;
  customHeaderEn: string; customHeaderAr: string;
};

const emptyDraft: Draft = {
  ministryName: '', ministryNameAr: '', ministryLogoUri: null,
  consultingAgencyName: '', consultingAgencyNameAr: '',
  customHeaderEn: '', customHeaderAr: '',
};

const draftFrom = (settings: CompanySettings): Draft => ({
  ministryName: settings.ministryName ?? '',
  ministryNameAr: settings.ministryNameAr ?? '',
  ministryLogoUri: settings.ministryLogoUri,
  consultingAgencyName: settings.consultingAgencyName ?? '',
  consultingAgencyNameAr: settings.consultingAgencyNameAr ?? '',
  customHeaderEn: settings.customHeaderEn ?? '',
  customHeaderAr: settings.customHeaderAr ?? '',
});

/** The draft mirrors CompanySettings closely enough to reuse the shared configured-state helper. */
const configuredFrom = (draft: Draft, kind: DocumentHeaderKind) => documentHeaderConfigured({
  ministryName: draft.ministryName, ministryNameAr: draft.ministryNameAr, ministryLogoUri: draft.ministryLogoUri,
  consultingAgencyName: draft.consultingAgencyName, consultingAgencyNameAr: draft.consultingAgencyNameAr,
  customHeaderEn: draft.customHeaderEn, customHeaderAr: draft.customHeaderAr,
}, kind);

/**
 * PDF Settings (DEC-397). It owns the three optional document headers and nothing else: no company
 * identity, no VAT, and never the company logo. Each Daily Report decides on its own whether to
 * print any of these, which is why every section says so rather than implying these values appear
 * automatically.
 */
export function PdfSettingsScreen({ repository, onBack }: { repository: ProfileRepository; onBack: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [failure, setFailure] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    setPhase('loading');
    setFailure(null);
    try {
      setDraft(draftFrom(await repository.getCompanySettings()));
      setPhase('ready');
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not load PDF settings.');
      setPhase('error');
    }
  }, [repository]);

  useEffect(() => { void load(); }, [load, reloadToken]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setDraft(draftFrom(await repository.savePdfSettings(draft)));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save PDF settings.');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'loading') {
    return (
      <View style={styles.screenState} accessibilityRole="text" accessibilityLabel="Loading PDF settings">
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.screenStateBody}>Loading PDF settings…</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Hero onBack={onBack} />
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Could not open PDF Settings</Text>
          <Text style={styles.errorText} accessibilityRole="alert">{failure}</Text>
          <Text style={styles.helper}>Nothing was changed. These are saved values only, so it is safe to try again.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setReloadToken((value) => value + 1)} accessibilityRole="button" accessibilityLabel="Try loading PDF settings again">
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  const ministry = configuredFrom(draft, 'ministry');
  const agency = configuredFrom(draft, 'consultingAgency');
  const custom = configuredFrom(draft, 'customHeader');

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Hero onBack={onBack} />

      <View style={styles.readOnlyBar} accessibilityRole="text" accessibilityLabel="These values are global and shared by every project. Each Daily Report decides on its own whether to print them.">
        <View style={styles.readOnlyMark}><Text style={styles.readOnlyMarkText}>i</Text></View>
        <Text style={styles.readOnlyText}>Saved once, reused everywhere. Each Daily Report chooses which of these to print.</Text>
      </View>

      {error ? <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}
      {saved ? <Text style={styles.successText} accessibilityRole="alert" accessibilityLiveRegion="polite">PDF settings saved.</Text> : null}

      <Section
        number="01"
        title="Ministry"
        purpose="The authority a report is produced for. Shown only on reports whose Show Ministry option is on."
        state={ministry}
        hasLogoSlot
      >
        <EnglishField label="Ministry name (English)" value={draft.ministryName} onChangeText={(value) => set('ministryName', value)} placeholder="Ministry of Public Works" />
        <ArabicField label="Ministry name (Arabic)" value={draft.ministryNameAr} onChangeText={(value) => set('ministryNameAr', value)} placeholder="وزارة الأشغال العامة" />
        <LogoPanel
          uri={draft.ministryLogoUri}
          onPick={() => void pickPersistentImage('ministry')
            .then((uri) => { if (uri) set('ministryLogoUri', uri); })
            .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not select the ministry logo.'))}
          onRemove={() => set('ministryLogoUri', null)}
        />
      </Section>

      <Section
        number="02"
        title="Consulting Agency"
        purpose="The organisation supervising the work. It is independent of Consultant Sign-off: turning the sign-off off never hides this."
        state={agency}
      >
        <EnglishField label="Agency name (English)" value={draft.consultingAgencyName} onChangeText={(value) => set('consultingAgencyName', value)} placeholder="Cedar Engineering Consultants" />
        <ArabicField label="Agency name (Arabic)" value={draft.consultingAgencyNameAr} onChangeText={(value) => set('consultingAgencyNameAr', value)} placeholder="سيدار للاستشارات الهندسية" />
      </Section>

      <Section
        number="03"
        title="Custom Header"
        purpose="Any additional line your reports need, such as a contract or tender reference."
        state={custom}
      >
        <EnglishField label="Custom header (English)" value={draft.customHeaderEn} onChangeText={(value) => set('customHeaderEn', value)} placeholder="Contract 2026/114" multiline />
        <ArabicField label="Custom header (Arabic)" value={draft.customHeaderAr} onChangeText={(value) => set('customHeaderAr', value)} placeholder="عقد ٢٠٢٦/١١٤" multiline />
      </Section>

      <Text style={styles.footnote}>
        Leaving a value empty is allowed. A report prints only the parts that exist, and switching a header off on a report never deletes anything saved here.
      </Text>

      <TouchableOpacity
        style={[styles.primaryButton, busy && styles.buttonDisabled]}
        onPress={() => void save()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Save PDF settings"
        accessibilityState={{ disabled: busy, busy }}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Save PDF Settings</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Hero({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroTopRow}>
        <TouchableOpacity style={styles.heroBack} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.heroBackText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.flex}>
          <Text style={styles.heroEyebrow}>SETUP</Text>
          <Text style={styles.heroTitle}>PDF Settings</Text>
        </View>
      </View>
      <Text style={styles.heroPurpose}>The optional headers printed at the top of Daily Report PDFs, in English and Arabic. Your company name and logo stay in Company &amp; VAT.</Text>
    </View>
  );
}

function Section({ number, title, purpose, state, hasLogoSlot = false, children }: {
  number: string; title: string; purpose: string;
  state: { english: boolean; arabic: boolean; logo: boolean }; hasLogoSlot?: boolean; children: React.ReactNode;
}) {
  const parts: string[] = [];
  if (state.english) parts.push('English');
  if (state.arabic) parts.push('Arabic');
  if (hasLogoSlot && state.logo) parts.push('logo');
  const summary = parts.length ? `${parts.join(' and ')} configured` : 'Nothing configured yet';
  return (
    <View style={styles.section}>
      <View style={styles.sectionTab}><Text style={styles.sectionTabText}>{number}</Text></View>
      <View style={styles.sectionHeader} accessibilityRole="header" accessibilityLabel={`Section ${number}. ${title}. ${summary}.`}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionPurpose}>{purpose}</Text>
        <View style={styles.stateRow}>
          <StatePill label="English" on={state.english} />
          <StatePill label="Arabic" on={state.arabic} />
          {hasLogoSlot ? <StatePill label="Logo" on={state.logo} /> : null}
        </View>
      </View>
      <View style={styles.sectionSeam} />
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

/** Configured state is carried by a filled dot and the words "Set"/"Not set", never by colour alone. */
function StatePill({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={[styles.statePill, on && styles.statePillOn]} accessibilityRole="text" accessibilityLabel={`${label} ${on ? 'is set' : 'is not set'}`}>
      <View style={[styles.stateDot, on && styles.stateDotOn]} />
      <Text style={[styles.statePillText, on && styles.statePillTextOn]}>{label} · {on ? 'Set' : 'Not set'}</Text>
    </View>
  );
}

function EnglishField({ label, multiline, ...props }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, styles.inputLtr, multiline && styles.multiline]}
        placeholderTextColor="#6B7681"
        accessibilityLabel={label}
        multiline={multiline}
        {...props}
      />
    </View>
  );
}

/** DEC-400. Arabic is entered and displayed right-to-left so what is typed matches what prints. */
function ArabicField({ label, multiline, ...props }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, styles.labelRtl]}>{label}</Text>
      <TextInput
        style={[styles.input, styles.inputRtl, multiline && styles.multiline]}
        placeholderTextColor="#6B7681"
        accessibilityLabel={`${label}. Right to left text field.`}
        multiline={multiline}
        {...props}
      />
    </View>
  );
}

function LogoPanel({ uri, onPick, onRemove }: { uri: string | null; onPick: () => void; onRemove: () => void }) {
  return (
    <View style={styles.logoPanel}>
      <View style={styles.logoHeading}>
        <View style={styles.flex}>
          <Text style={styles.fieldLabel}>Ministry logo</Text>
          <Text style={styles.helper}>Prints in its own colours. Saving text never removes it.</Text>
        </View>
      </View>
      {uri
        ? <Image source={{ uri }} style={styles.logoPreview} resizeMode="contain" accessibilityLabel="Selected ministry logo preview" />
        : <View style={styles.logoEmpty} accessibilityRole="text" accessibilityLabel="No ministry logo selected"><Text style={styles.logoMonogram}>M</Text><Text style={styles.logoEmptyText}>No ministry logo selected</Text></View>}
      <View style={styles.logoActions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={onPick} accessibilityRole="button" accessibilityLabel={uri ? 'Replace ministry logo' : 'Choose ministry logo'}>
          <Text style={styles.secondaryButtonText}>{uri ? 'Replace Logo' : 'Choose Logo'}</Text>
        </TouchableOpacity>
        {uri ? (
          <TouchableOpacity style={styles.dangerButton} onPress={onRemove} accessibilityRole="button" accessibilityLabel="Remove ministry logo" accessibilityHint="Removes only the logo. The ministry names are kept.">
            <Text style={styles.dangerButtonText}>Remove Logo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 44, gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  footnote: { color: colors.muted, fontSize: 12, lineHeight: 18, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 13 },
  errorText: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '700', lineHeight: 19 },
  successText: { color: colors.success, backgroundColor: '#E5F3EC', borderRadius: 10, padding: 12, fontWeight: '700', lineHeight: 19 },

  screenState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  screenStateBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  panel: { backgroundColor: colors.surface, borderRadius: 16, padding: 17, gap: 10 },
  panelTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },

  hero: { backgroundColor: colors.navy, borderRadius: 18, padding: 18, gap: 12, shadowColor: colors.navyDeep, shadowOpacity: .22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroBack: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroBackText: { color: '#FFF8ED', fontWeight: '800' },
  heroEyebrow: { color: '#F2A184', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: '#FFF8ED', fontSize: 26, fontWeight: '900', marginTop: 2 },
  heroPurpose: { color: '#D5E4EF', fontSize: 12, lineHeight: 17 },

  readOnlyBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, paddingVertical: 11 },
  readOnlyMark: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#E8F0F6', alignItems: 'center', justifyContent: 'center' },
  readOnlyMarkText: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  readOnlyText: { color: colors.ink, fontSize: 13, fontWeight: '700', flex: 1 },

  section: { marginTop: 16 },
  sectionTab: { position: 'absolute', top: -12, left: 16, zIndex: 2, elevation: 3, backgroundColor: colors.cream, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 4 },
  sectionTabText: { color: colors.navy, fontSize: 12, fontWeight: '900', letterSpacing: .4 },
  sectionHeader: { backgroundColor: colors.navy, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14, gap: 8 },
  sectionTitle: { color: '#FFF8ED', fontSize: 19, fontWeight: '800' },
  sectionPurpose: { color: '#D5E4EF', fontSize: 12, lineHeight: 17 },
  sectionSeam: { height: 3, backgroundColor: colors.brand },
  sectionBody: { backgroundColor: colors.cream, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderWidth: 1, borderTopWidth: 0, borderColor: '#E8DED0', padding: 14, gap: 14 },

  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  statePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  statePillOn: { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'transparent' },
  stateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D5E4EF' },
  stateDotOn: { backgroundColor: '#8FD6B4' },
  statePillText: { color: '#D5E4EF', fontSize: 11, fontWeight: '900' },
  statePillTextOn: { color: '#FFF8ED' },

  field: { gap: 6 },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  labelRtl: { textAlign: 'right' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, backgroundColor: '#FCFBF8' },
  inputLtr: { textAlign: 'left', writingDirection: 'ltr' },
  inputRtl: { textAlign: 'right', writingDirection: 'rtl' },
  multiline: { minHeight: 76, textAlignVertical: 'top' },

  logoPanel: { borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: colors.surface, padding: 13, gap: 12 },
  logoHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  logoPreview: { width: '100%', height: 110, backgroundColor: '#FFF', borderRadius: 10 },
  logoEmpty: { minHeight: 100, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FCFBF8' },
  logoMonogram: { width: 38, height: 38, borderRadius: 19, textAlign: 'center', textAlignVertical: 'center', color: '#FFF', backgroundColor: colors.navy, fontSize: 21, fontWeight: '900', overflow: 'hidden' },
  logoEmptyText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  logoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  primaryButton: { minHeight: 48, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  secondaryButton: { flexGrow: 1, minWidth: 135, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.navy, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryButtonText: { color: colors.navy, fontWeight: '800', fontSize: 15 },
  dangerButton: { flexGrow: 1, minWidth: 135, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  dangerButtonText: { color: colors.danger, fontWeight: '800', fontSize: 15 },
  buttonDisabled: { opacity: .4 },
});
