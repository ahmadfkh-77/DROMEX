import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type { ProfileRepository } from '../../data/repositories/ProfileRepository';
import type { FinancialRepository } from '../../data/repositories/FinancialRepository';
import type { FinancialOverview } from '../../domain/financials';
import {
  findPotentialCustomerDuplicates,
  type Customer,
  type CustomerDraft,
  type CustomerType,
  validateCustomerDraft,
} from '../../domain/profiles';
import { useReducedMotion } from '../components/ExpandableMenu';
import { colors } from '../theme';
import {FinancialsScreen} from './FinancialsScreen';

const emptyDraft: CustomerDraft = {
  type: 'individual',
  name: '',
  phone: '',
  email: '',
  address: '',
  taxVatNumber: '',
  notes: '',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function CustomersScreen({
  repository,
  financialRepository,
  onBack,
}: {
  repository: ProfileRepository;
  financialRepository: FinancialRepository;
  onBack: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [draft, setDraft] = useState<CustomerDraft>(emptyDraft);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [financials, setFinancials] = useState<FinancialOverview | null>(null);
  const [showCustomerFinancials, setShowCustomerFinancials] = useState(false);
  const [inactiveOpen, setInactiveOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [next, nextFinancials] = await Promise.all([repository.listCustomers(), financialRepository.getOverview()]);
    setCustomers(next);
    setFinancials(nextFinancials);
    setSelected((current) => next.find((customer) => customer.id === current?.id) ?? null);
    setLoaded(true);
  }, [financialRepository, repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const query = search.trim().toLocaleLowerCase('en-US');
  const byName = (a: Customer, b: Customer) => a.name.localeCompare(b.name);
  const matches = useCallback(
    (customer: Customer) =>
      !query ||
      [customer.name, customer.phone, customer.email, customer.taxVatNumber]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase('en-US').includes(query)),
    [query],
  );
  const activeAll = useMemo(() => customers.filter((c) => c.isActive).sort(byName), [customers]);
  const inactiveAll = useMemo(() => customers.filter((c) => !c.isActive).sort(byName), [customers]);
  const activeVisible = useMemo(() => activeAll.filter(matches), [activeAll, matches]);
  const inactiveVisible = useMemo(() => inactiveAll.filter(matches), [inactiveAll, matches]);
  const hasQuery = query.length > 0;

  function updateDraft<K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function addCustomer() {
    const issues = validateCustomerDraft(draft);
    if (issues[0]) return setError(issues[0]);
    const matchesExisting = findPotentialCustomerDuplicates(draft, customers);
    if (matchesExisting.length > 0) {
      Alert.alert(
        'Possible duplicate customer',
        `Review: ${matchesExisting.slice(0, 3).map((customer) => customer.name).join(', ')}. You may still create a separate profile.`,
        [
          { text: 'Review', style: 'cancel' },
          { text: 'Create separately', onPress: () => void persistCustomer() },
        ],
      );
      return;
    }
    await persistCustomer();
  }

  async function persistCustomer() {
    setBusy(true);
    setError(null);
    try {
      const created = await repository.createCustomer(draft);
      setDraft(emptyDraft);
      setShowForm(false);
      await refresh();
      setSelected(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create customer.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(customer: Customer) {
    setBusy(true);
    setError(null);
    try {
      const updated = await repository.setCustomerActive(customer.id, !customer.isActive);
      await refresh();
      setSelected(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update customer.');
    } finally {
      setBusy(false);
    }
  }

  function requestToggleActive(customer: Customer) {
    if (customer.isActive) {
      Alert.alert(
        'Deactivate this customer?',
        `"${customer.name}" will no longer be selectable for new receipts. All existing records and history remain unchanged, and this customer can be reactivated at any time.`,
        [
          { text: 'Keep Active', style: 'cancel' },
          { text: 'Deactivate', style: 'destructive', onPress: () => void toggleActive(customer) },
        ],
      );
    } else {
      void toggleActive(customer);
    }
  }

  function toggleInactiveSection() {
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setInactiveOpen((value) => !value);
  }

  if (selected && showCustomerFinancials) return <FinancialsScreen repository={financialRepository} customerId={selected.id} onBack={() => setShowCustomerFinancials(false)} />;

  if (selected) {
    const customerTargets = financials?.targets.filter((target) => target.partyType === 'customer' && target.partyId === selected.id) ?? [];
    const billed = customerTargets.reduce((sum, target) => sum + target.totalUsd, 0);
    const paid = customerTargets.reduce((sum, target) => sum + target.paidUsd, 0);
    const remaining = customerTargets.reduce((sum, target) => sum + target.remainingUsd, 0);
    const needsPayment = customerTargets.filter((target) => target.remainingUsd > 0).length;
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.detailHero}>
          <TouchableOpacity onPress={() => setSelected(null)} style={styles.heroBack} accessibilityRole="button" accessibilityLabel="Back to customer list"><Text style={styles.heroBackText}>Back</Text></TouchableOpacity>
          <View style={styles.detailHeroRow}>
            <View style={[styles.avatar, styles.avatarLarge, selected.isOwnCompany ? styles.avatarOwn : styles.avatarNavy]}>
              <Text style={styles.avatarLargeText}>{selected.isOwnCompany ? '★' : initials(selected.name)}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.heroEyebrow}>CUSTOMER RECORD</Text>
              <Text style={styles.heroTitle} numberOfLines={2}>{selected.name}</Text>
              <View style={styles.pillRow}>
                <View style={styles.typePill}><Text style={styles.typePillText}>{selected.isOwnCompany ? 'Own company' : selected.type === 'company' ? 'Company' : 'Individual'}</Text></View>
                <View style={[styles.statusPill, selected.isActive ? styles.statusPillActive : styles.statusPillInactive]}>
                  <View style={[styles.statusDot, selected.isActive ? styles.statusDotActive : styles.statusDotInactive]} />
                  <Text style={[styles.statusPillText, selected.isActive ? styles.statusPillTextActive : styles.statusPillTextInactive]}>{selected.isActive ? 'Active' : 'Inactive'}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact details</Text>
          <Detail label="Phone" value={selected.phone} />
          <Detail label="Email" value={selected.email} />
          <Detail label="Address" value={selected.address} />
          <Detail label="Tax / VAT number" value={selected.taxVatNumber} />
          <Detail label="Notes" value={selected.notes} />
          {!selected.isOwnCompany ? (
            <TouchableOpacity
              style={styles.quietAction}
              onPress={() => requestToggleActive(selected)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={selected.isActive ? `Deactivate ${selected.name}` : `Reactivate ${selected.name}`}
              accessibilityState={{ disabled: busy, busy }}
            >
              <Text style={styles.quietActionText}>{selected.isActive ? 'Deactivate customer ›' : 'Reactivate customer ›'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Customer balance</Text>
        <View style={styles.balanceGrid}>
          <ResultTile label="Records" value={String(customerTargets.length)} />
          <ResultTile label="Billed" value={`$${billed.toFixed(2)}`} />
          <ResultTile label="Paid" value={`$${paid.toFixed(2)}`} />
        </View>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceCardLabel}>REMAINING BALANCE</Text>
          <Text style={styles.balanceCardValue}>${remaining.toFixed(2)}</Text>
          <Text style={styles.helper}>{customerTargets.length ? `${needsPayment} record${needsPayment === 1 ? '' : 's'} need${needsPayment === 1 ? 's' : ''} payment across this customer's projects, direct purchases, and opening balances.` : 'No priced loads or opening balances yet.'}</Text>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.financeButton}
            onPress={() => setShowCustomerFinancials(true)}
            accessibilityRole="button"
            accessibilityLabel={`Open payments and balances for ${selected.name}`}
          >
            <Text style={styles.financeButtonLabel}>Open payments & balances</Text>
            <Text style={styles.financeButtonHint}>Organized by project, direct purchases, and opening balances →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  if (!loaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.helper}>Loading customers…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity onPress={onBack} style={styles.heroBack} accessibilityRole="button" accessibilityLabel="Back"><Text style={styles.heroBackText}>Back</Text></TouchableOpacity>
          <View style={styles.flex}><Text style={styles.heroEyebrow}>RECORDS</Text><Text style={styles.heroTitle}>Customers</Text></View>
        </View>
        <Text style={styles.heroPurpose}>Find a customer, review status and balance, and open related payments.</Text>
        <View style={styles.heroSummaryRow}>
          <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{activeAll.length}</Text><Text style={styles.heroSummaryLabel}>ACTIVE</Text></View>
          <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{inactiveAll.length}</Text><Text style={styles.heroSummaryLabel}>INACTIVE</Text></View>
          <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{customers.length}</Text><Text style={styles.heroSummaryLabel}>TOTAL</Text></View>
        </View>
      </View>

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => setShowForm((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={showForm ? 'Close create customer form' : 'Create Customer'}
        accessibilityState={{ expanded: showForm }}
      >
        <Text style={styles.primaryButtonLabel}>{showForm ? 'Close form' : 'Create Customer'}</Text>
      </TouchableOpacity>

      {showForm ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>New customer</Text>
          <Text style={styles.label}>Customer type</Text>
          <View style={styles.chips}>
            {(['individual', 'company'] as CustomerType[]).map((type) => (
              <Chip
                key={type}
                label={type === 'individual' ? 'Individual' : 'Company'}
                selected={draft.type === type}
                onPress={() => updateDraft('type', type)}
              />
            ))}
          </View>
          <Field label={draft.type === 'company' ? 'Company name *' : 'Full name *'} value={draft.name} onChangeText={(value) => updateDraft('name', value)} />
          <Field label="Phone" value={draft.phone ?? ''} onChangeText={(value) => updateDraft('phone', value)} keyboardType="phone-pad" />
          <Field label="Email" value={draft.email ?? ''} onChangeText={(value) => updateDraft('email', value)} keyboardType="email-address" />
          <Field label="Address" value={draft.address ?? ''} onChangeText={(value) => updateDraft('address', value)} multiline />
          <Field label="Tax / VAT number" value={draft.taxVatNumber ?? ''} onChangeText={(value) => updateDraft('taxVatNumber', value)} />
          <Field label="Notes" value={draft.notes ?? ''} onChangeText={(value) => updateDraft('notes', value)} multiline />
          <TouchableOpacity
            style={styles.saveButton}
            onPress={() => void addCustomer()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Save customer"
            accessibilityState={{ disabled: busy, busy }}
          >
            <Text style={styles.saveButtonLabel}>{busy ? 'Saving...' : 'Save customer'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {customers.length ? (
        <View style={styles.searchBar}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, phone, email, or Tax/VAT"
            placeholderTextColor="#89939B"
            accessibilityLabel="Search customers by name, phone, email, or Tax/VAT number"
          />
          {search.length ? (
            <TouchableOpacity style={styles.searchClear} onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search">
              <Text style={styles.searchClearText}>×</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sectionHeadingRow}><Text style={styles.sectionTitle}>Active Customers</Text><Text style={styles.sectionCount}>{activeAll.length}</Text></View>
      {activeVisible.length ? (
        activeVisible.map((customer) => <CustomerRow key={customer.id} customer={customer} onPress={() => setSelected(customer)} />)
      ) : (
        <Empty
          title={hasQuery ? 'No matches' : 'No active customers yet'}
          body={hasQuery ? `No active customers match "${search.trim()}".` : 'Create one above to get started.'}
          onClearSearch={hasQuery ? () => setSearch('') : undefined}
        />
      )}

      <TouchableOpacity
        activeOpacity={0.75}
        style={styles.completedBand}
        onPress={toggleInactiveSection}
        accessibilityRole="button"
        accessibilityState={{ expanded: inactiveOpen }}
        accessibilityLabel={`Inactive Customers, ${inactiveAll.length} customer${inactiveAll.length === 1 ? '' : 's'}`}
      >
        <View style={styles.flex}>
          <Text style={styles.completedBandTitle}>Inactive Customers</Text>
          <Text style={styles.completedBandHint}>{inactiveOpen ? 'Tap to hide' : 'Tap to view'} · {inactiveAll.length} customer{inactiveAll.length === 1 ? '' : 's'}</Text>
        </View>
        <View style={styles.completedHeaderRight}>
          <View style={styles.countBadge}><Text style={styles.countBadgeText}>{inactiveAll.length}</Text></View>
          <Text style={styles.expandMark}>{inactiveOpen ? '×' : '+'}</Text>
        </View>
      </TouchableOpacity>
      {inactiveOpen ? (
        inactiveVisible.length ? (
          inactiveVisible.map((customer) => <CustomerRow key={customer.id} customer={customer} onPress={() => setSelected(customer)} />)
        ) : (
          <Empty
            title={hasQuery ? 'No matches' : 'No inactive customers'}
            body={hasQuery ? `No inactive customers match "${search.trim()}".` : 'Customers you deactivate will appear here.'}
            onClearSearch={hasQuery ? () => setSearch('') : undefined}
          />
        )
      ) : null}
    </ScrollView>
  );
}

function CustomerRow({ customer, onPress }: { customer: Customer; onPress: () => void }) {
  const meta = [
    customer.isOwnCompany ? 'Own company' : customer.type === 'company' ? 'Company' : 'Individual',
    customer.phone || null,
  ].filter(Boolean).join(' · ');
  return (
    <TouchableOpacity
      style={styles.customerRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${customer.name}. ${customer.isOwnCompany ? 'Own company' : customer.type}. ${customer.isActive ? 'Active' : 'Inactive'}.`}
    >
      <View style={[styles.avatar, customer.isOwnCompany ? styles.avatarOwn : styles.avatarNavy]}>
        <Text style={styles.avatarText}>{customer.isOwnCompany ? '★' : initials(customer.name)}</Text>
      </View>
      <View style={styles.customerCopy}>
        <Text style={styles.customerName} numberOfLines={1}>{customer.name}</Text>
        <Text style={styles.customerMeta} numberOfLines={1}>{meta}</Text>
      </View>
      <View style={[styles.rowStatusPill, customer.isActive ? styles.statusPillActive : styles.statusPillInactive]}>
        <View style={[styles.statusDot, customer.isActive ? styles.statusDotActive : styles.statusDotInactive]} />
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </TouchableOpacity>
  );
}

function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'phone-pad' | 'email-address'; multiline?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input, props.multiline && styles.multiline]} placeholderTextColor="#89939B" accessibilityLabel={label} {...props} /></View>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }}><Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text></TouchableOpacity>;
}

function Detail({ label, value }: { label: string; value: string | null }) { return <View><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value || 'Not provided'}</Text></View>; }
function ResultTile({ label, value }: { label: string; value: string }) { return <View style={styles.resultTile}><Text style={styles.resultTileValue}>{value}</Text><Text style={styles.resultTileLabel}>{label}</Text></View>; }
function Empty({ title, body, onClearSearch }: { title: string; body: string; onClearSearch?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.helper}>{body}</Text>
      {onClearSearch ? (
        <TouchableOpacity style={styles.emptyClear} onPress={onClearSearch} accessibilityRole="button" accessibilityLabel="Clear search">
          <Text style={styles.emptyClearText}>Clear search</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  content: { padding: 20, paddingBottom: 36, gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '700' },

  hero: { backgroundColor: colors.navy, borderRadius: 18, padding: 18, gap: 12, shadowColor: colors.navyDeep, shadowOpacity: .22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroBack: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroBackText: { color: '#FFF8ED', fontWeight: '800' },
  heroEyebrow: { color: '#F2A184', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: '#FFF8ED', fontSize: 27, fontWeight: '900', marginTop: 2 },
  heroPurpose: { color: '#D5E4EF', fontSize: 12, lineHeight: 17 },
  heroSummaryRow: { flexDirection: 'row', gap: 12, marginTop: 2, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.22)' },
  heroSummaryItem: { flex: 1, gap: 2 },
  heroSummaryValue: { color: '#FFF8ED', fontSize: 20, fontWeight: '900' },
  heroSummaryLabel: { color: '#D5E4EF', fontSize: 9, fontWeight: '800', letterSpacing: .6 },

  detailHero: { backgroundColor: colors.navy, borderRadius: 18, padding: 18, gap: 14, shadowColor: colors.navyDeep, shadowOpacity: .22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  detailHeroRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  typePill: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  typePillText: { color: '#FFF8ED', fontWeight: '800', fontSize: 11 },

  primaryButton: { minHeight: 48, borderRadius: 12, backgroundColor: colors.brand, padding: 14, alignItems: 'center', justifyContent: 'center' },
  primaryButtonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  card: { padding: 17, gap: 12, borderRadius: 16, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  field: { gap: 6 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, backgroundColor: '#FCFBF8' },
  multiline: { minHeight: 76, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: '#FCFBF8' },
  chipSelected: { borderColor: colors.brand, backgroundColor: '#FBE9E4' },
  chipLabel: { color: colors.muted, fontWeight: '700' },
  chipLabelSelected: { color: colors.brandDark },
  saveButton: { minHeight: 48, marginTop: 4, borderRadius: 11, backgroundColor: colors.ink, padding: 14, alignItems: 'center', justifyContent: 'center' },
  saveButtonLabel: { color: '#FFFFFF', fontWeight: '800' },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, shadowColor: '#17212B', shadowOpacity: .05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  searchGlyph: { color: colors.brand, fontSize: 19, fontWeight: '900' },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '600', paddingVertical: 12 },
  searchClear: { minHeight: 32, minWidth: 32, borderRadius: 16, backgroundColor: '#EEEAE2', alignItems: 'center', justifyContent: 'center' },
  searchClearText: { color: colors.muted, fontSize: 16, fontWeight: '900', lineHeight: 18 },

  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  sectionCount: { color: colors.brandDark, backgroundColor: '#FBE9E4', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 11, fontWeight: '900', fontSize: 11 },

  customerRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: colors.surface, gap: 12 },
  customerCopy: { flex: 1, minWidth: 0, gap: 3 },
  customerName: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  customerMeta: { color: colors.muted, fontSize: 13 },
  rowChevron: { color: colors.brand, fontSize: 20, fontWeight: '900' },
  rowStatusPill: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },

  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarLarge: { width: 56, height: 56, borderRadius: 28 },
  avatarNavy: { backgroundColor: 'rgba(255,255,255,0.16)' },
  avatarOwn: { backgroundColor: colors.brand },
  avatarText: { color: colors.navy, fontWeight: '900', fontSize: 15 },
  avatarLargeText: { color: '#FFF8ED', fontWeight: '900', fontSize: 20 },

  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, flexShrink: 0 },
  statusPillActive: { backgroundColor: '#E5F3EC' },
  statusPillInactive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotActive: { backgroundColor: colors.success },
  statusDotInactive: { backgroundColor: colors.muted },
  statusPillText: { fontWeight: '900', fontSize: 11 },
  statusPillTextActive: { color: colors.success },
  statusPillTextInactive: { color: '#D5E4EF' },

  detailLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 3 },
  detailValue: { color: colors.ink, fontSize: 15 },
  quietAction: { minHeight: 48, justifyContent: 'center', marginTop: 2 },
  quietActionText: { color: colors.brandDark, fontWeight: '800', fontSize: 13 },

  balanceGrid: { flexDirection: 'row', gap: 9 },
  resultTile: { flex: 1, minHeight: 82, backgroundColor: colors.resultSoft, borderRadius: 13, borderWidth: 2, borderColor: colors.resultDark, padding: 12, justifyContent: 'center' },
  resultTileValue: { color: colors.resultDark, fontSize: 17, fontWeight: '900' },
  resultTileLabel: { color: colors.resultDark, fontSize: 11, marginTop: 6, fontWeight: '700' },

  balanceCard: { padding: 18, borderRadius: 14, backgroundColor: colors.surface, gap: 5, borderWidth: 1, borderColor: colors.line },
  balanceCardLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: .6 },
  balanceCardValue: { color: colors.ink, fontSize: 26, fontWeight: '900', marginTop: 2 },
  financeButton: { minHeight: 48, marginTop: 10, backgroundColor: colors.navy, borderRadius: 12, padding: 14, gap: 4 },
  financeButtonLabel: { color: '#FFF', fontWeight: '900', fontSize: 15 },
  financeButtonHint: { color: '#C9DCEB', fontSize: 11 },

  completedBand: { minHeight: 56, backgroundColor: colors.creamSoft, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  completedBandTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  completedBandHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  completedHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countBadge: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countBadgeText: { color: colors.brandDark, fontWeight: '900', fontSize: 12 },
  expandMark: { color: colors.brandDark, fontSize: 24, fontWeight: '700', width: 22, textAlign: 'center' },

  empty: { borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', borderRadius: 14, padding: 18, gap: 5 },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  emptyClear: { minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 2 },
  emptyClearText: { color: colors.brandDark, fontWeight: '900', fontSize: 12 },
});
