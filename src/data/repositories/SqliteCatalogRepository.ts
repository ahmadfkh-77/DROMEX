import type { SQLiteDatabase } from 'expo-sqlite';

import type { CatalogItem, CatalogUnitOption, Category, ItemDraft, UsageArea } from '../../domain/catalog';
import type { CatalogRepository } from './CatalogRepository';

type CategoryRow = {
  id: string;
  name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  category_id: string;
  name: string;
  internal_code: string | null;
  description: string | null;
  default_unit_id: string | null;
  default_receipt_price_usd_cents: number | null;
  loads_enabled: number;
  quarry_enabled: number;
  daily_reports_enabled: number;
  is_active: number;
  created_at: string;
  updated_at: string;
};

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToItem(row: ItemRow): CatalogItem {
  const itemUsageAreas: UsageArea[] = [];
  if (row.loads_enabled === 1) itemUsageAreas.push('loads');
  if (row.quarry_enabled === 1) itemUsageAreas.push('quarry');
  if (row.daily_reports_enabled === 1) itemUsageAreas.push('dailyReports');

  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    internalCode: row.internal_code,
    description: row.description,
    defaultUnitId: row.default_unit_id,
    defaultReceiptPriceUsd:
      row.default_receipt_price_usd_cents == null
        ? null
        : row.default_receipt_price_usd_cents / 100,
    usageAreas: itemUsageAreas,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteCatalogRepository implements CatalogRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async listCategories(): Promise<Category[]> {
    const rows = await this.db.getAllAsync<CategoryRow>(
      'SELECT * FROM categories WHERE is_active = 1 ORDER BY name COLLATE NOCASE',
    );
    return rows.map(rowToCategory);
  }

  async listItems(): Promise<CatalogItem[]> {
    const rows = await this.db.getAllAsync<ItemRow>(
      'SELECT * FROM catalog_items WHERE is_active = 1 ORDER BY name COLLATE NOCASE',
    );
    return rows.map(rowToItem);
  }

  async listUnits(): Promise<CatalogUnitOption[]> {
    return this.db.getAllAsync<CatalogUnitOption>(
      'SELECT id, name, symbol FROM measurement_units WHERE is_active = 1 ORDER BY name COLLATE NOCASE',
    );
  }

  async createCategory(name: string): Promise<Category> {
    const now = new Date().toISOString();
    const category: Category = {
      id: makeId('cat'),
      name: name.trim().replace(/\s+/g, ' '),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO categories (id, name, is_active, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`,
        category.id,
        category.name,
        now,
        now,
      );
      await this.enqueue('category', category.id, category);
    });

    return category;
  }

  async createItem(draft: ItemDraft): Promise<CatalogItem> {
    const now = new Date().toISOString();
    const item: CatalogItem = {
      id: makeId('item'),
      categoryId: draft.categoryId,
      name: draft.name.trim().replace(/\s+/g, ' '),
      internalCode: draft.internalCode?.trim() || null,
      description: draft.description?.trim() || null,
      defaultUnitId: draft.defaultUnitId?.trim() || null,
      defaultReceiptPriceUsd: draft.defaultReceiptPriceUsd ?? null,
      usageAreas: [...new Set(draft.usageAreas)],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO catalog_items (
          id, category_id, name, internal_code, description, default_unit_id,
          default_receipt_price_usd_cents, loads_enabled, quarry_enabled,
          daily_reports_enabled, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        item.id,
        item.categoryId,
        item.name,
        item.internalCode,
        item.description,
        item.defaultUnitId,
        item.defaultReceiptPriceUsd == null
          ? null
          : Math.round(item.defaultReceiptPriceUsd * 100),
        item.usageAreas.includes('loads') ? 1 : 0,
        item.usageAreas.includes('quarry') ? 1 : 0,
        item.usageAreas.includes('dailyReports') ? 1 : 0,
        now,
        now,
      );
      await this.enqueue('catalogItem', item.id, item);
    });

    return item;
  }

  async updateItem(itemId: string, draft: ItemDraft): Promise<CatalogItem> {
    const existing = await this.db.getFirstAsync<ItemRow>(
      'SELECT * FROM catalog_items WHERE id = ? AND is_active = 1', itemId,
    );
    if (!existing) throw new Error('Active item was not found.');
    const now = new Date().toISOString();
    const item: CatalogItem = {
      id: itemId,
      categoryId: draft.categoryId,
      name: draft.name.trim().replace(/\s+/g, ' '),
      internalCode: draft.internalCode?.trim() || null,
      description: draft.description?.trim() || null,
      defaultUnitId: draft.defaultUnitId?.trim() || null,
      defaultReceiptPriceUsd: draft.defaultReceiptPriceUsd ?? null,
      usageAreas: [...new Set(draft.usageAreas)],
      isActive: true,
      createdAt: existing.created_at,
      updatedAt: now,
    };
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`UPDATE catalog_items SET category_id=?, name=?, internal_code=?, description=?,
        default_unit_id=?, default_receipt_price_usd_cents=?, loads_enabled=?, quarry_enabled=?,
        daily_reports_enabled=?, updated_at=? WHERE id=?`, item.categoryId, item.name, item.internalCode,
        item.description, item.defaultUnitId, item.defaultReceiptPriceUsd == null ? null : Math.round(item.defaultReceiptPriceUsd * 100),
        item.usageAreas.includes('loads') ? 1 : 0, item.usageAreas.includes('quarry') ? 1 : 0,
        item.usageAreas.includes('dailyReports') ? 1 : 0, now, itemId);
      await this.enqueue('catalogItem', itemId, item);
    });
    return item;
  }

  private async enqueue(entityType: string, entityId: string, payload: unknown): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO sync_outbox (entity_type, entity_id, operation, payload_json, created_at)
       VALUES (?, ?, 'upsert', ?, ?)`,
      entityType,
      entityId,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
  }
}
