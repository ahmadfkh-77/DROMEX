import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
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

export function CustomersScreen({
  repository,
  financialRepository,
  onBack,
}: {
  repository: ProfileRepository;
  financialRepository: FinancialRepository;
  onBack: () => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [draft, setDraft] = useState<CustomerDraft>(emptyDraft);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [financials, setFinancials] = useState<FinancialOverview | null>(null);
  const [showCustomerFinancials,setShowCustomerFinancials]=useState(false);

  const refresh = useCallback(async () => {
    const [next, nextFinancials] = await Promise.all([repository.listCustomers(), financialRepository.getOverview()]);
    setCustomers(next);
    setFinancials(nextFinancials);
    setSelected((current) => next.find((customer) => customer.id === current?.id) ?? null);
  }, [financialRepository, repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleCustomers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('en-US');
    if (!query) return customers;
    return customers.filter((customer) =>
      [customer.name, customer.phone, customer.email, customer.taxVatNumber]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase('en-US').includes(query)),
    );
  }, [customers, search]);

  function updateDraft<K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function addCustomer() {
    const issues = validateCustomerDraft(draft);
    if (issues[0]) return setError(issues[0]);
    const matches = findPotentialCustomerDuplicates(draft, customers);
    if (matches.length > 0) {
      Alert.alert(
        'Possible duplicate customer',
        `Review: ${matches.slice(0, 3).map((customer) => customer.name).join(', ')}. You may still create a separate profile.`,
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

  if(selected&&showCustomerFinancials)return <FinancialsScreen repository={financialRepository} customerId={selected.id} onBack={()=>setShowCustomerFinancials(false)}/>;

  if (selected) {
    const customerTargets = financials?.targets.filter((target) => target.partyType === 'customer' && target.partyId === selected.id) ?? [];
    const billed = customerTargets.reduce((sum, target) => sum + target.totalUsd, 0);
    const paid = customerTargets.reduce((sum, target) => sum + target.paidUsd, 0);
    const remaining = customerTargets.reduce((sum, target) => sum + target.remainingUsd, 0);
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="CUSTOMER RECORD" title={selected.name} onBack={() => setSelected(null)} />
        <View style={styles.profileCard}>
          <View style={styles.rowBetween}>
            <Badge label={selected.isOwnCompany ? 'Own company' : selected.type === 'company' ? 'Company' : 'Individual'} />
            <Text style={[styles.status, !selected.isActive && styles.inactive]}>
              {selected.isActive ? 'Active' : 'Inactive'}
            </Text>
          </View>
          <Detail label="Phone" value={selected.phone} />
          <Detail label="Email" value={selected.email} />
          <Detail label="Address" value={selected.address} />
          <Detail label="Tax / VAT number" value={selected.taxVatNumber} />
          <Detail label="Notes" value={selected.notes} />
          {!selected.isOwnCompany ? (
            <TouchableOpacity
              style={styles.outlineButton}
              onPress={() => void toggleActive(selected)}
              disabled={busy}
            >
              <Text style={styles.outlineButtonLabel}>
                {selected.isActive ? 'Deactivate customer' : 'Reactivate customer'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Customer summary</Text>
        <View style={styles.summaryRow}>
          <Summary label="Records" value={String(customerTargets.length)} />
          <Summary label="Billed" value={`$${billed.toFixed(2)}`} />
          <Summary label="Paid" value={`$${paid.toFixed(2)}`} />
        </View>
        <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Remaining balance: ${remaining.toFixed(2)}</Text><Text style={styles.helper}>{customerTargets.length?`${customerTargets.filter(target=>target.remainingUsd>0).length} records need payment across this customer's projects, direct purchases, and opening balances.`:'No priced loads or opening balances yet.'}</Text><TouchableOpacity activeOpacity={.7} style={styles.financeButton} onPress={()=>setShowCustomerFinancials(true)}><Text style={styles.financeButtonLabel}>Open payments & balances</Text><Text style={styles.financeButtonHint}>Organized by project, direct purchases, and opening balances →</Text></TouchableOpacity></View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenHeader eyebrow="RECORDS" title="Customers" onBack={onBack} />
      {error ? <Text style={styles.error}>{error}</Text> : null}


      <TouchableOpacity style={styles.primaryButton} onPress={() => setShowForm((current) => !current)}>
        <Text style={styles.primaryButtonLabel}>{showForm ? 'Close form' : '+ Create customer'}</Text>
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
          <TouchableOpacity style={styles.saveButton} onPress={() => void addCustomer()} disabled={busy}>
            <Text style={styles.saveButtonLabel}>{busy ? 'Saving...' : 'Save customer'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search name, phone, email, or Tax/VAT"
        placeholderTextColor="#89939B"
      />
      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>Customer records</Text>
        <Text style={styles.count}>{visibleCustomers.length}</Text>
      </View>
      {visibleCustomers.map((customer) => (
        <TouchableOpacity key={customer.id} style={styles.customerRow} onPress={() => setSelected(customer)}>
          <View style={styles.customerCopy}>
            <Text style={styles.customerName}>{customer.name}</Text>
            <Text style={styles.customerMeta}>
              {customer.isOwnCompany ? 'Own company' : customer.type === 'company' ? 'Company' : 'Individual'}
              {customer.phone ? ` · ${customer.phone}` : ''}
            </Text>
          </View>
          <Text style={[styles.openLabel, !customer.isActive && styles.inactive]}>
            {customer.isActive ? 'Open' : 'Inactive'}
          </Text>
        </TouchableOpacity>
      ))}
      {visibleCustomers.length === 0 ? <Text style={styles.emptyText}>No customers found.</Text> : null}
    </ScrollView>
  );
}

function ScreenHeader({ eyebrow, title, onBack }: { eyebrow: string; title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}><Text style={styles.backLabel}>Back</Text></TouchableOpacity>
      <View style={styles.headerCopy}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text></View>
    </View>
  );
}

function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'phone-pad' | 'email-address'; multiline?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input, props.multiline && styles.multiline]} placeholderTextColor="#89939B" {...props} /></View>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}><Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text></TouchableOpacity>;
}

function Badge({ label }: { label: string }) { return <Text style={styles.badge}>{label}</Text>; }
function Detail({ label, value }: { label: string; value: string | null }) { return <View><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value || 'Not provided'}</Text></View>; }
function Summary({ label, value }: { label: string; value: string }) { return <View style={styles.summary}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>; }

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 36, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  headerCopy: { flex: 1 },
  backButton: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface },
  backLabel: { color: colors.ink, fontWeight: '700' },
  eyebrow: { color: colors.brand, fontWeight: '800', fontSize: 11, letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  error: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '600' },
  primaryButton: { borderRadius: 12, backgroundColor: colors.brand, padding: 14, alignItems: 'center' },
  primaryButtonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  card: { padding: 17, gap: 12, borderRadius: 16, backgroundColor: colors.surface },
  profileCard: { padding: 18, gap: 15, borderRadius: 16, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  field: { gap: 6 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, backgroundColor: '#FCFBF8' },
  multiline: { minHeight: 76, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: '#FCFBF8' },
  chipSelected: { borderColor: colors.brand, backgroundColor: '#FBE9E4' },
  chipLabel: { color: colors.muted, fontWeight: '700' },
  chipLabelSelected: { color: colors.brandDark },
  saveButton: { marginTop: 4, borderRadius: 11, backgroundColor: colors.ink, padding: 14, alignItems: 'center' },
  saveButtonLabel: { color: '#FFFFFF', fontWeight: '800' },
  search: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, backgroundColor: colors.surface },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  count: { minWidth: 29, textAlign: 'center', color: colors.brandDark, backgroundColor: '#FBE9E4', padding: 5, borderRadius: 15, fontWeight: '800' },
  customerRow: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, backgroundColor: colors.surface, gap: 12 },
  customerCopy: { flex: 1, gap: 4 },
  customerName: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  customerMeta: { color: colors.muted, fontSize: 13 },
  openLabel: { color: colors.brandDark, fontWeight: '800', fontSize: 13 },
  status: { color: colors.success, fontWeight: '800' },
  inactive: { color: colors.muted },
  badge: { alignSelf: 'flex-start', color: colors.brandDark, backgroundColor: '#FBE9E4', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, fontWeight: '800', fontSize: 12 },
  detailLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 3 },
  detailValue: { color: colors.ink, fontSize: 15 },
  outlineButton: { marginTop: 4, borderWidth: 1, borderColor: colors.line, padding: 12, borderRadius: 10, alignItems: 'center' },
  outlineButtonLabel: { color: colors.ink, fontWeight: '800' },
  financeButton:{marginTop:8,backgroundColor:'#173F67',borderRadius:12,padding:14,gap:4},
  financeButtonLabel:{color:'#FFF',fontWeight:'900',fontSize:15},
  financeButtonHint:{color:'#C9DCEB',fontSize:11},
  summaryRow: { flexDirection: 'row', gap: 9 },
  summary: { flex: 1, minHeight: 82, backgroundColor: colors.surface, borderRadius: 13, padding: 12 },
  summaryValue: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  summaryLabel: { color: colors.muted, fontSize: 11, marginTop: 6 },
  emptyCard: { padding: 18, borderRadius: 14, backgroundColor: colors.surface, gap: 5 },
  emptyTitle: { color: colors.ink, fontWeight: '800' },
  helper: { color: colors.muted, lineHeight: 19 },
  emptyText: { color: colors.muted, textAlign: 'center', paddingVertical: 20 },
});
