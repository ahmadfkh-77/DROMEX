import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useReducedMotion } from '../components/ExpandableMenu';
import { colors } from '../theme';

const usageLabels: Record<UsageArea, string> = {
  loads: 'Loads',
  quarry: 'Supplier',
  dailyReports: 'Daily reports',
};

export function CatalogScreen({
  repository,
  onBack,
}: {
  repository: CatalogRepository;
  onBack: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const [loaded, setLoaded] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [units, setUnits] = useState<CatalogUnitOption[]>([]);
  const [search, setSearch] = useState('');
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
  const [openCategories,setOpenCategories]=useState<Set<string>>(()=>new Set());

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
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const categoryGroups=useMemo(()=>categories.map(category=>({category,items:items.filter(item=>item.categoryId===category.id)})).filter(group=>group.items.length>0),[categories,items]);
  const query = search.trim().toLocaleLowerCase('en-US');
  const hasQuery = query.length > 0;
  const matches = useCallback((item: CatalogItem) => !query || [item.name, item.internalCode, item.description].filter(Boolean).some((value) => value!.toLocaleLowerCase('en-US').includes(query)), [query]);
  const visibleGroups = useMemo(() => {
    if (!hasQuery) return categoryGroups;
    return categoryGroups.map((group) => ({ category: group.category, items: group.items.filter(matches) })).filter((group) => group.items.length > 0);
  }, [categoryGroups, hasQuery, matches]);

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

    const matchesExisting = findSimilarItems(itemName, otherItems);
    if (matchesExisting.length > 0) {
      Alert.alert(
        'Possible duplicate',
        `Similar item: ${matchesExisting[0]?.name}. You can still save intentional variants.`,
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

  function toggleCategory(id:string){if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setOpenCategories(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});}

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity onPress={onBack} style={styles.heroBack} accessibilityRole="button" accessibilityLabel="Back"><Text style={styles.heroBackText}>Back</Text></TouchableOpacity>
          <View style={styles.flex}><Text style={styles.heroEyebrow}>SETTINGS</Text><Text style={styles.heroTitle}>Item Catalog</Text></View>
        </View>
        <Text style={styles.heroPurpose}>Organize categories and materials used across receipts, supplier loads, and daily reports.</Text>
        <View style={styles.heroSummaryRow}>
          <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{categories.length}</Text><Text style={styles.heroSummaryLabel}>CATEGORIES</Text></View>
          <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{items.length}</Text><Text style={styles.heroSummaryLabel}>ITEMS</Text></View>
          <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{units.length}</Text><Text style={styles.heroSummaryLabel}>UNITS</Text></View>
        </View>
      </View>

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add category</Text>
        <TextInput
          style={styles.input}
          value={categoryName}
          onChangeText={setCategoryName}
          placeholder="e.g. Produced materials"
          placeholderTextColor="#89939B"
          accessibilityLabel="New category name"
        />
        <TouchableOpacity style={styles.darkButton} onPress={() => void addCategory()} disabled={busy} accessibilityRole="button" accessibilityLabel="Create category" accessibilityState={{ disabled: busy, busy }}>
          <Text style={styles.darkButtonLabel}>Create category</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.formHeader}><Text style={styles.cardTitle}>{editingItemId ? 'Edit item' : 'Add item'}</Text>{editingItemId ? <TouchableOpacity style={styles.cancelEditWrap} onPress={resetItemForm} accessibilityRole="button" accessibilityLabel="Cancel editing"><Text style={styles.cancelText}>Cancel editing</Text></TouchableOpacity> : null}</View>
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
          accessibilityLabel="Item name"
        />
        <Text style={styles.label}>Description / notes (optional)</Text>
        <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} multiline placeholder="Item details" placeholderTextColor="#89939B" accessibilityLabel="Description or notes" />
        <SearchableSelect label="Default unit (optional)" options={units.map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))} selectedId={defaultUnitId} onSelect={setDefaultUnitId} placeholder="No default unit" />
        {defaultUnitId ? <TouchableOpacity style={styles.cancelEditWrap} onPress={() => setDefaultUnitId('')} accessibilityRole="button" accessibilityLabel="Clear default unit"><Text style={styles.cancelText}>Clear default unit</Text></TouchableOpacity> : null}
        <Text style={styles.label}>Default receipt price USD (optional)</Text>
        <TextInput style={styles.input} value={defaultPrice} onChangeText={setDefaultPrice} keyboardType="decimal-pad" placeholder="e.g. 90.00" placeholderTextColor="#89939B" accessibilityLabel="Default receipt price in USD" />
        <Text style={styles.label}>Internal code (optional)</Text>
        <TextInput
          style={styles.input}
          value={internalCode}
          onChangeText={setInternalCode}
          autoCapitalize="characters"
          placeholder="e.g. AC-WC"
          placeholderTextColor="#89939B"
          accessibilityLabel="Internal code"
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
        <TouchableOpacity style={styles.primaryButton} onPress={() => void addItem()} disabled={busy} accessibilityRole="button" accessibilityLabel={editingItemId ? 'Save item changes' : 'Create item'} accessibilityState={{ disabled: busy, busy }}>
          <Text style={styles.primaryButtonLabel}>{busy ? 'Saving…' : editingItemId ? 'Save item changes' : 'Create item'}</Text>
        </TouchableOpacity>
      </View>

      {!loaded ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={colors.brand} /><Text style={styles.helper}>Loading catalog…</Text></View>
      ) : (
        <>
          {items.length ? (
            <View style={styles.searchBar}>
              <Text style={styles.searchGlyph}>⌕</Text>
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search item name, internal code, or description"
                placeholderTextColor="#89939B"
                accessibilityLabel="Search items by name, internal code, or description"
              />
              {search.length ? (
                <TouchableOpacity style={styles.searchClear} onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Text style={styles.searchClearText}>×</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <View style={styles.listHeader}>
            <Text style={styles.cardTitle}>Active items</Text>
            <Text style={styles.count}>{items.length}</Text>
          </View>

          {!categories.length ? (
            <Empty title="No categories yet" body="Create a category above to start building the catalog." />
          ) : !items.length ? (
            <Empty title="No items yet" body="Add an item above once a category exists." />
          ) : visibleGroups.length ? (
            visibleGroups.map(({ category, items: categoryItems }) => {
              const isOpen = openCategories.has(category.id) || hasQuery;
              return (
                <View key={category.id} style={styles.categoryGroup}>
                  <TouchableOpacity
                    activeOpacity={.72}
                    style={styles.categoryHeader}
                    onPress={() => toggleCategory(category.id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`${category.name}, ${categoryItems.length} item${categoryItems.length === 1 ? '' : 's'}`}
                  >
                    <View style={styles.categoryCopy}>
                      <Text style={styles.categoryEyebrow}>CATEGORY</Text>
                      <Text style={styles.categoryTitle}>{category.name}</Text>
                    </View>
                    <View style={styles.categoryRight}>
                      <Text style={styles.categoryCount}>{categoryItems.length}</Text>
                      <Text style={styles.categoryMark}>{isOpen ? '×' : '+'}</Text>
                    </View>
                  </TouchableOpacity>
                  {isOpen ? (
                    <View style={styles.categoryItems}>
                      {categoryItems.map((item) => {
                        const unit = item.defaultUnitId ? unitById.get(item.defaultUnitId) : undefined;
                        return (
                          <View key={item.id} style={[styles.itemRow, editingItemId === item.id && styles.itemRowEditing]}>
                            <Text style={styles.itemName}>{item.name}</Text>
                            <View style={styles.itemBadgeRow}>
                              {unit ? <View style={styles.unitChip}><Text style={styles.unitChipText}>{unit.symbol}</Text></View> : null}
                              {item.defaultReceiptPriceUsd != null ? <View style={styles.priceChip}><Text style={styles.priceChipText}>${item.defaultReceiptPriceUsd.toFixed(2)}</Text></View> : null}
                              {item.internalCode ? <View style={styles.codeChip}><Text style={styles.codeChipText}>{item.internalCode}</Text></View> : null}
                            </View>
                            <View style={styles.usageRow}>
                              {item.usageAreas.map((area) => (
                                <View key={area} style={styles.usagePill}><Text style={styles.usagePillText}>{usageLabels[area]}</Text></View>
                              ))}
                            </View>
                            <TouchableOpacity
                              style={styles.editChip}
                              onPress={() => editItem(item)}
                              accessibilityRole="button"
                              accessibilityLabel={`Edit item ${item.name}`}
                            >
                              <Text style={styles.editChipText}>Edit item</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Empty title="No matches" body={`No items match "${search.trim()}".`} onClearSearch={() => setSearch('')} />
          )}
        </>
      )}
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: selected }}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

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
  loading: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 30 },
  content: { padding: 20, paddingBottom: 36, gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '700' },

  hero: { backgroundColor: colors.navy, borderRadius: 18, padding: 18, gap: 12, shadowColor: colors.navyDeep, shadowOpacity: .22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroBack: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroBackText: { color: '#FFF8ED', fontWeight: '800' },
  heroEyebrow: { color: '#F2A184', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: '#FFF8ED', fontSize: 26, fontWeight: '900', marginTop: 2 },
  heroPurpose: { color: '#D5E4EF', fontSize: 12, lineHeight: 17 },
  heroSummaryRow: { flexDirection: 'row', gap: 12, marginTop: 2, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.22)' },
  heroSummaryItem: { flex: 1, gap: 2 },
  heroSummaryValue: { color: '#FFF8ED', fontSize: 20, fontWeight: '900' },
  heroSummaryLabel: { color: '#D5E4EF', fontSize: 9, fontWeight: '800', letterSpacing: .6 },

  card: { padding: 17, gap: 11, borderRadius: 16, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cancelEditWrap: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  cancelText: { color: colors.brandDark, fontWeight: '800', fontSize: 13 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: 3 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: colors.ink, fontSize: 15, backgroundColor: '#FCFBF8' },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 13, backgroundColor: '#FCFBF8' },
  chipSelected: { borderColor: colors.brand, backgroundColor: '#FBE9E4' },
  chipLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  chipLabelSelected: { color: colors.brandDark },
  darkButton: { minHeight: 48, alignSelf: 'flex-start', borderRadius: 10, backgroundColor: colors.ink, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  darkButtonLabel: { color: '#FFFFFF', fontWeight: '800' },
  primaryButton: { minHeight: 48, marginTop: 6, borderRadius: 11, backgroundColor: colors.brand, padding: 14, alignItems: 'center', justifyContent: 'center' },
  primaryButtonLabel: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, shadowColor: '#17212B', shadowOpacity: .05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  searchGlyph: { color: colors.brand, fontSize: 19, fontWeight: '900' },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '600', paddingVertical: 12 },
  searchClear: { minHeight: 32, minWidth: 32, borderRadius: 16, backgroundColor: '#EEEAE2', alignItems: 'center', justifyContent: 'center' },
  searchClearText: { color: colors.muted, fontSize: 16, fontWeight: '900', lineHeight: 18 },

  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { minWidth: 28, textAlign: 'center', color: colors.brandDark, backgroundColor: '#FBE9E4', padding: 5, borderRadius: 14, fontWeight: '800' },

  categoryGroup: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#B8CBD8', backgroundColor: '#EDF4F7' },
  categoryHeader: { minHeight: 74, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: colors.navy, borderLeftWidth: 5, borderLeftColor: colors.brand, flexDirection: 'row', alignItems: 'center', gap: 12 },
  categoryCopy: { flex: 1, minWidth: 0 },
  categoryEyebrow: { color: '#F2A184', fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  categoryTitle: { color: '#FFF', fontSize: 18, fontWeight: '900', marginTop: 3 },
  categoryRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryCount: { minWidth: 30, textAlign: 'center', color: colors.navy, backgroundColor: '#F3B09A', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 15, fontWeight: '900' },
  categoryMark: { color: '#FFF', fontSize: 25, fontWeight: '500', width: 22, textAlign: 'center' },
  categoryItems: { padding: 10, gap: 9 },

  itemRow: { padding: 15, borderRadius: 12, backgroundColor: colors.surface, gap: 8, borderWidth: 1, borderColor: '#D7E2E8' },
  itemRowEditing: { borderWidth: 1, borderColor: colors.brand },
  itemName: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  itemBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  unitChip: { backgroundColor: colors.resultSoft, borderWidth: 1, borderColor: colors.resultDark, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  unitChipText: { color: colors.resultDark, fontSize: 11, fontWeight: '900' },
  priceChip: { backgroundColor: '#E5F3EC', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  priceChipText: { color: colors.success, fontSize: 11, fontWeight: '900' },
  codeChip: { backgroundColor: '#EEEAE2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  codeChipText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  usageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  usagePill: { backgroundColor: '#FBE9E4', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  usagePillText: { color: colors.brandDark, fontSize: 11, fontWeight: '700' },
  editChip: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.line, borderRadius: 9, paddingHorizontal: 12 },
  editChipText: { color: colors.ink, fontWeight: '800', fontSize: 13 },

  empty: { borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', borderRadius: 14, padding: 18, gap: 5 },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  emptyClear: { minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 2 },
  emptyClearText: { color: colors.brandDark, fontWeight: '900', fontSize: 12 },
});
