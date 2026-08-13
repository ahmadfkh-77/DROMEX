import { describe, expect, it } from 'vitest';

import {
  findSimilarItems,
  normalizeIdentity,
  type CatalogItem,
  type Category,
  validateCategoryName,
  validateItemDraft,
} from '../src/domain/catalog';

const category: Category = {
  id: 'cat_1',
  name: 'Produced materials',
  isActive: true,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
};

const item: CatalogItem = {
  id: 'item_1',
  categoryId: category.id,
  name: 'Asphalt wearing course',
  internalCode: 'AC-WC',
  description: null,
  defaultUnitId: null,
  defaultReceiptPriceUsd: null,
  usageAreas: ['loads'],
  isActive: true,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
};

describe('catalog validation', () => {
  it('normalizes case and repeated whitespace for identity comparison', () => {
    expect(normalizeIdentity('  Asphalt   Mix ')).toBe('asphalt mix');
  });

  it('blocks duplicate category names regardless of case', () => {
    expect(validateCategoryName('produced MATERIALS', [category])).toEqual([
      { field: 'form', message: 'A category with this name already exists.' },
    ]);
  });

  it('requires category, item name, and one usage area', () => {
    const issues = validateItemDraft(
      { categoryId: '', name: ' ', usageAreas: [] },
      [],
    );
    expect(issues.map((issue) => issue.field)).toEqual(['categoryId', 'name', 'usageAreas']);
  });

  it('blocks duplicate internal codes regardless of case', () => {
    const issues = validateItemDraft(
      {
        categoryId: category.id,
        name: 'Different product',
        internalCode: 'ac-wc',
        usageAreas: ['loads'],
      },
      [item],
    );
    expect(issues).toContainEqual({ field: 'internalCode', message: 'Internal code must be unique.' });
  });

  it('warns on similar names without making them invalid', () => {
    expect(findSimilarItems('Asphalt wearing', [item])).toEqual([item]);
    expect(
      validateItemDraft(
        { categoryId: category.id, name: 'Asphalt wearing', usageAreas: ['loads'] },
        [item],
      ),
    ).toEqual([]);
  });
  it('rejects non-finite and sub-cent default prices',()=>{expect(validateItemDraft({categoryId:category.id,name:'Stone',usageAreas:['loads'],defaultReceiptPriceUsd:Number.NaN},[])).toContainEqual({field:'defaultReceiptPriceUsd',message:'Default price must be zero or more with no more than two decimals.'});expect(validateItemDraft({categoryId:category.id,name:'Stone',usageAreas:['loads'],defaultReceiptPriceUsd:.001},[])).toContainEqual({field:'defaultReceiptPriceUsd',message:'Default price must be zero or more with no more than two decimals.'});});
});
