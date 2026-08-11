import type { CatalogItem, CatalogUnitOption, Category, ItemDraft } from '../../domain/catalog';

export interface CatalogRepository {
  listCategories(): Promise<Category[]>;
  listItems(): Promise<CatalogItem[]>;
  listUnits(): Promise<CatalogUnitOption[]>;
  createCategory(name: string): Promise<Category>;
  createItem(draft: ItemDraft): Promise<CatalogItem>;
  updateItem(itemId: string, draft: ItemDraft): Promise<CatalogItem>;
}
