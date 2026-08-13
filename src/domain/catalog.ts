export const usageAreas = ['loads', 'quarry', 'dailyReports'] as const;

export type UsageArea = (typeof usageAreas)[number];

export type Category = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CatalogItem = {
  id: string;
  categoryId: string;
  name: string;
  internalCode: string | null;
  description: string | null;
  defaultUnitId: string | null;
  defaultReceiptPriceUsd: number | null;
  usageAreas: UsageArea[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CatalogUnitOption = { id: string; name: string; symbol: string };

export type ItemDraft = {
  categoryId: string;
  name: string;
  internalCode?: string;
  description?: string;
  defaultUnitId?: string;
  defaultReceiptPriceUsd?: number | null;
  usageAreas: UsageArea[];
};

export type ValidationIssue = {
  field: keyof ItemDraft | 'form';
  message: string;
};

export function normalizeIdentity(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function validateCategoryName(name: string, existing: Category[]): ValidationIssue[] {
  const normalized = normalizeIdentity(name);
  if (!normalized) {
    return [{ field: 'form', message: 'Category name is required.' }];
  }
  if (existing.some((category) => normalizeIdentity(category.name) === normalized)) {
    return [{ field: 'form', message: 'A category with this name already exists.' }];
  }
  return [];
}

export function validateItemDraft(draft: ItemDraft, existing: CatalogItem[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const normalizedName = normalizeIdentity(draft.name);
  const normalizedCode = draft.internalCode ? normalizeIdentity(draft.internalCode) : '';

  if (!draft.categoryId) issues.push({ field: 'categoryId', message: 'Category is required.' });
  if (!normalizedName) issues.push({ field: 'name', message: 'Item name is required.' });
  if (draft.usageAreas.length === 0) {
    issues.push({ field: 'usageAreas', message: 'Select at least one usage area.' });
  }
  if (draft.defaultReceiptPriceUsd != null && (!Number.isFinite(draft.defaultReceiptPriceUsd)||draft.defaultReceiptPriceUsd < 0||Math.abs(Math.round(draft.defaultReceiptPriceUsd*100)-draft.defaultReceiptPriceUsd*100)>1e-8)) {
    issues.push({ field: 'defaultReceiptPriceUsd', message: 'Default price must be zero or more with no more than two decimals.' });
  }
  if (
    normalizedCode &&
    existing.some(
      (item) => item.internalCode && normalizeIdentity(item.internalCode) === normalizedCode,
    )
  ) {
    issues.push({ field: 'internalCode', message: 'Internal code must be unique.' });
  }

  return issues;
}

export function findSimilarItems(name: string, existing: CatalogItem[]): CatalogItem[] {
  const normalized = normalizeIdentity(name);
  if (!normalized) return [];
  return existing.filter((item) => {
    const candidate = normalizeIdentity(item.name);
    return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
  });
}
