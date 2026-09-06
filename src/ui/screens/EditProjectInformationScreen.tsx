import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { LoadRepository } from '../../data/repositories/LoadRepository';
import { projectIdentityChanged, validateProjectInformation, type Project } from '../../domain/loads';
import { colors } from '../theme';

/**
 * DEC-404. Corrects a project's descriptive information only. Customer reassignment is deliberately
 * absent because it would move financial attribution between parties, and the start date keeps its
 * own protected workflow. Nothing here deletes or reassigns a record, changes a transaction number,
 * rewrites a stored snapshot, or touches a payment: the repository updates three columns on one row.
 */
export function EditProjectInformationScreen({ repository, project, onBack, onSaved }: {
  repository: LoadRepository; project: Project; onBack: () => void; onSaved: (project: Project) => void;
}) {
  const [name, setName] = useState(project.name);
  const [location, setLocation] = useState(project.location);
  const [notes, setNotes] = useState(project.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = { name, location, notes };
  const identityChanged = projectIdentityChanged(project, draft);
  const dirty = identityChanged || (notes.trim() !== (project.notes ?? '').trim());

  async function persist() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await repository.updateProjectInformation(project.id, draft));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the project information.');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const issues = validateProjectInformation(draft);
    if (issues[0]) { setError(issues.join('\n')); return; }
    // A name or location change alters how the project is identified everywhere it is read live, so
    // it is confirmed rather than applied silently. A notes-only edit needs no confirmation.
    if (!identityChanged) { void persist(); return; }
    Alert.alert(
      'Change how this project is identified?',
      `This project will read as "${name.trim()}" in ${location.trim()} on every screen from now on, and on documents generated after this change.\n\nAlready-confirmed loads, supplier loads, and fuel records keep the project name they were saved with, so your history stays accurate. Payments, totals, transaction numbers, and documents you have already generated are not affected.`,
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Save changes', onPress: () => void persist() },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity style={styles.heroBack} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back without saving">
            <Text style={styles.heroBackText}>Back</Text>
          </TouchableOpacity>
          <View style={styles.flex}>
            <Text style={styles.heroEyebrow}>PROJECT</Text>
            <Text style={styles.heroTitle} numberOfLines={2}>{project.name}</Text>
          </View>
        </View>
        <Text style={styles.heroPurpose}>Correct this project's name, location, and notes. Its customer, dates, status, and every record stay exactly as they are.</Text>
      </View>

      {error ? <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}

      <View style={styles.card}>
        <Field label="Project name *" value={name} onChangeText={setName} placeholder="Airport Road Rehabilitation" />
        <Field label="Location *" value={location} onChangeText={setLocation} placeholder="Beirut" />
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Anything worth recording about this project" />
      </View>

      <View style={styles.lockedCard} accessibilityRole="text" accessibilityLabel="Not editable here: customer, start date, and project status.">
        <Text style={styles.lockedTitle}>Not editable here</Text>
        <LockedRow label="Customer" value={project.customerName} why="Moving a project to another customer would move its receivables, so it is a separate audited change." />
        <LockedRow label="Start date" value={project.startDate ?? 'Not set'} why="Corrected from Projects, where it is checked against the earliest linked record." />
        <LockedRow label="Status" value={project.status === 'completed' ? 'Completed' : 'Active'} why="Changed by completing or reactivating the project." />
      </View>

      <Text style={styles.footnote}>
        Screens and newly generated documents use the updated information. Confirmed loads, supplier loads, and fuel records keep the project name stored with them at the time they were confirmed, so historical records stay accurate.
      </Text>

      <TouchableOpacity
        style={[styles.primaryButton, (busy || !dirty) && styles.buttonDisabled]}
        onPress={save}
        disabled={busy || !dirty}
        accessibilityRole="button"
        accessibilityLabel="Save project information"
        accessibilityHint={identityChanged ? 'Asks for confirmation because the project name or location changes' : undefined}
        accessibilityState={{ disabled: busy || !dirty, busy }}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{dirty ? 'Save Project Information' : 'No changes to save'}</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({ label, multiline, ...props }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={[styles.input, multiline && styles.multiline]} placeholderTextColor="#6B7681" accessibilityLabel={label} multiline={multiline} {...props} />
    </View>
  );
}

function LockedRow({ label, value, why }: { label: string; value: string; why: string }) {
  return (
    <View style={styles.lockedRow}>
      <View style={styles.flex}>
        <Text style={styles.lockedLabel}>{label}</Text>
        <Text style={styles.lockedValue}>{value}</Text>
        <Text style={styles.helper}>{why}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 44, gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  footnote: { color: colors.muted, fontSize: 12, lineHeight: 18, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 13 },
  errorText: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '700', lineHeight: 19 },

  hero: { backgroundColor: colors.navy, borderRadius: 18, padding: 18, gap: 12, shadowColor: colors.navyDeep, shadowOpacity: .22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroBack: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroBackText: { color: '#FFF8ED', fontWeight: '800' },
  heroEyebrow: { color: '#F2A184', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: '#FFF8ED', fontSize: 24, fontWeight: '900', marginTop: 2 },
  heroPurpose: { color: '#D5E4EF', fontSize: 12, lineHeight: 17 },

  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 15, gap: 14 },
  field: { gap: 6 },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, backgroundColor: '#FCFBF8' },
  multiline: { minHeight: 78, textAlignVertical: 'top' },

  lockedCard: { backgroundColor: colors.creamSoft, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 15, gap: 12 },
  lockedTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  lockedRow: { flexDirection: 'row', gap: 10 },
  lockedLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: .6 },
  lockedValue: { color: colors.ink, fontSize: 15, fontWeight: '700', marginTop: 2 },

  primaryButton: { minHeight: 48, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  buttonDisabled: { opacity: .4 },
});
