import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type { CatalogRepository } from '../../data/repositories/CatalogRepository';
import {
  findSimilarItems,
  type CatalogItem,
  type CatalogUnitOption,
  type Category,
  type UsageArea,
  validateCategoryName,
  validateItemDraft,
} from '../../domain/catalog';
import { SearchableSelect } from '../components/SearchableSelect';
import { colors } from '../theme';

const usageLabels: Record<UsageArea, string> = {
  loads: 'Loads',
  quarry: 'Quarry',
  dailyReports: 'Daily reports',
};

export function CatalogScreen({
  repository,
  onBack,
}: {
  repository: CatalogRepository;
  onBack: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [units, setUnits] = useState<CatalogUnitOption[]>([]);
  const [categoryName, setCategoryName] = useState('');
  const [itemName, setItemName] = useState('');
  const [internalCode, setInternalCode] = useState('');
  const [description, setDescription] = useState('');
  const [defaultUnitId, setDefaultUnitId] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [selectedUsage, setSelectedUsage] = useState<UsageArea[]>(['loads']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextCategories, nextItems, nextUnits] = await Promise.all([
      repository.listCategories(),
      repository.listItems(),
      repository.listUnits(),
    ]);
    setCategories(nextCategories);
    setItems(nextItems);
    setUnits(nextUnits);
    setCategoryId((current) => current || nextCategories[0]?.id || '');
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  async function addCategory() {
    const issues = validateCategoryName(categoryName, categories);
    if (issues[0]) return setError(issues[0].message);
    setBusy(true);
    setError(null);
    try {
      const created = await repository.createCategory(categoryName);
      setCategoryName('');
      setCategoryId(created.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create category.');
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    const draft = {
      categoryId,
      name: itemName,
      internalCode,
      description,
      defaultUnitId,
      defaultReceiptPriceUsd: defaultPrice.trim() ? Number(defaultPrice.replace(',', '.')) : null,
      usageAreas: selectedUsage,
    };
    const otherItems = items.filter((item) => item.id !== editingItemId);
    const issues = validateItemDraft(draft, otherItems);
    if (issues[0]) return setError(issues[0].message);

    const matches = findSimilarItems(itemName, otherItems);
    if (matches.length > 0) {
      Alert.alert(
        'Possible duplicate',
        `Similar item: ${matches[0]?.name}. You can still save intentional variants.`,
        [
          { text: 'Review', style: 'cancel' },
          { text: 'Save anyway', onPress: () => void persistItem(draft) },
        ],
      );
      return;
    }
    await persistItem(draft);
  }

  async function persistItem(draft: {
    categoryId: string;
    name: string;
    internalCode: string;
    description: string;
    defaultUnitId: string;
    defaultReceiptPriceUsd: number | null;
    usageAreas: UsageArea[];
  }) {
    setBusy(true);
    setError(null);
    try {
      if (editingItemId) await repository.updateItem(editingItemId, draft);
      else await repository.createItem(draft);
      resetItemForm();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create item.');
    } finally {
      setBusy(false);
    }
  }

  function resetItemForm() {
    setEditingItemId(null); setItemName(''); setInternalCode(''); setDescription('');
    setDefaultUnitId(''); setDefaultPrice(''); setSelectedUsage(['loads']);
  }

  function editItem(item: CatalogItem) {
    setEditingItemId(item.id); setCategoryId(item.categoryId); setItemName(item.name);
    setInternalCode(item.internalCode ?? ''); setDescription(item.description ?? '');
    setDefaultUnitId(item.defaultUnitId ?? '');
    setDefaultPrice(item.defaultReceiptPriceUsd == null ? '' : String(item.defaultReceiptPriceUsd));
    setSelectedUsage(item.usageAreas); setError(null);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 190, animated: true }));
  }

  function toggleUsage(area: UsageArea) {
    setSelectedUsage((current) =>
      current.includes(area) ? current.filter((value) => value !== area) : [...current, area],
    );
  }

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>SETTINGS</Text>
          <Text style={styles.title}>Item Catalog</Text>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add category</Text>
        <TextInput
          style={styles.input}
          value={categoryName}
          onChangeText={setCategoryName}
          placeholder="e.g. Produced materials"
          placeholderTextColor="#89939B"
        />
        <TouchableOpacity style={styles.darkButton} onPress={() => void addCategory()} disabled={busy}>
          <Text style={styles.darkButtonLabel}>Create category</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.formHeader}><Text style={styles.cardTitle}>{editingItemId ? 'Edit active item' : 'Add item'}</Text>{editingItemId ? <TouchableOpacity onPress={resetItemForm}><Text style={styles.cancelText}>Cancel edit</Text></TouchableOpacity> : null}</View>
        <SearchableSelect
          label="Category *"
          options={categories.map((category) => ({ id: category.id, label: category.name }))}
          selectedId={categoryId}
          onSelect={setCategoryId}
          placeholder={categories.length ? 'Select category' : 'Create a category first'}
        />
        <Text style={styles.label}>Item name</Text>
        <TextInput
          style={styles.input}
          value={itemName}
          onChangeText={setItemName}
          placeholder="e.g. Asphalt wearing course"
          placeholderTextColor="#89939B"
        />
        <Text style={styles.label}>Description / notes (optional)</Text>
        <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} multiline placeholder="Item details" placeholderTextColor="#89939B" />
        <SearchableSelect label="Default unit (optional)" options={units.map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))} selectedId={defaultUnitId} onSelect={setDefaultUnitId} placeholder="No default unit" />
        {defaultUnitId ? <TouchableOpacity onPress={() => setDefaultUnitId('')}><Text style={styles.cancelText}>Clear default unit</Text></TouchableOpacity> : null}
        <Text style={styles.label}>Default receipt price USD (optional)</Text>
        <TextInput style={styles.input} value={defaultPrice} onChangeText={setDefaultPrice} keyboardType="decimal-pad" placeholder="e.g. 90.00" placeholderTextColor="#89939B" />
        <Text style={styles.label}>Internal code (optional)</Text>
        <TextInput
          style={styles.input}
          value={internalCode}
          onChangeText={setInternalCode}
          autoCapitalize="characters"
          placeholder="e.g. AC-WC"
          placeholderTextColor="#89939B"
        />
        <Text style={styles.label}>Usage areas</Text>
        <View style={styles.chips}>
          {(Object.keys(usageLabels) as UsageArea[]).map((area) => (
            <Chip
              key={area}
              label={usageLabels[area]}
              selected={selectedUsage.includes(area)}
              onPress={() => toggleUsage(area)}
            />
          ))}
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={() => void addItem()} disabled={busy}>
          <Text style={styles.primaryButtonLabel}>{busy ? 'Saving…' : editingItemId ? 'Save item changes' : 'Create item'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.cardTitle}>Active items</Text>
        <Text style={styles.count}>{items.length}</Text>
      </View>
      {items.map((item) => (
        <View key={item.id} style={[styles.itemRow, editingItemId === item.id && styles.itemRowEditing]}>
          <View style={styles.itemCopy}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemMeta}>
              {categoryNames.get(item.categoryId) ?? 'Unknown category'}
              {item.internalCode ? ` · ${item.internalCode}` : ''}
            </Text>
          </View>
          <Text style={styles.usageText}>{item.usageAreas.map((area) => usageLabels[area]).join(' · ')}</Text>
          <TouchableOpacity style={styles.editButton} onPress={() => editItem(item)}><Text style={styles.editButtonText}>Edit item</Text></TouchableOpacity>
        </View>
      ))}
      {items.length === 0 ? <Text style={styles.empty}>No items yet.</Text> : null}
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </TouchableOpacity>
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
  card: { padding: 17, gap: 11, borderRadius: 16, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cancelText: { color: colors.brandDark, fontWeight: '800', fontSize: 13 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: 3 },
  helper: { color: colors.muted, fontSize: 13 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: colors.ink, fontSize: 15, backgroundColor: '#FCFBF8' },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FCFBF8' },
  chipSelected: { borderColor: colors.brand, backgroundColor: '#FBE9E4' },
  chipLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  chipLabelSelected: { color: colors.brandDark },
  darkButton: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: colors.ink, paddingHorizontal: 15, paddingVertical: 11 },
  darkButtonLabel: { color: '#FFFFFF', fontWeight: '800' },
  primaryButton: { marginTop: 6, borderRadius: 11, backgroundColor: colors.brand, padding: 14, alignItems: 'center' },
  primaryButtonLabel: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 },
  count: { minWidth: 28, textAlign: 'center', color: colors.brandDark, backgroundColor: '#FBE9E4', padding: 5, borderRadius: 14, fontWeight: '800' },
  itemRow: { padding: 15, borderRadius: 14, backgroundColor: colors.surface, gap: 8 },
  itemRowEditing: { borderWidth: 1, borderColor: colors.brand },
  itemCopy: { gap: 3 },
  itemName: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  itemMeta: { color: colors.muted, fontSize: 13 },
  usageText: { color: colors.brandDark, fontSize: 12, fontWeight: '700' },
  editButton: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.line, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 },
  editButtonText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 20 },
});
