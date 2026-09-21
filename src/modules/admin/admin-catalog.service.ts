import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { DbService } from "@/db/db.module";
import { catalogCategories, catalogItems } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import type { Claims } from "@/common/auth";
import { AuditService } from "@/common/audit/audit.service";
import { money } from "@/domain/money";

export interface CatalogCategoryInput { name: string; icon?: string | null; image_url?: string | null; main_section?: string | null; parent_category?: string | null; sort_order?: number }
export interface CatalogItemInput { name: string; default_price?: number | null; image_url?: string | null; barcode?: string | null; category_id?: string | null; category_name?: string | null; category_path?: string | null; description?: string; main_section?: string | null; subcategory?: string | null; sort_order?: number; source?: "seed" | "merchant" | "library_import" }

/** admin.library.tsx + library-import.tsx: CRUD, reorder, bulk upsert (admin_bulk_update_catalog_items), wipe. */
@Injectable()
export class AdminCatalogService {
  constructor(private dbs: DbService, private audit: AuditService) {}

  async upsertCategory(actor: Claims, d: CatalogCategoryInput, id?: string) {
    const values = { name: d.name, icon: d.icon ?? null, imageUrl: d.image_url ?? null, mainSection: d.main_section ?? null, parentCategory: d.parent_category ?? null, ...(d.sort_order !== undefined && { sortOrder: d.sort_order }) };
    const [row] = id ? await this.dbs.db.update(catalogCategories).set(values).where(eq(catalogCategories.id, id)).returning() : await this.dbs.db.insert(catalogCategories).values(values).returning();
    if (!row) throw new AppError("not_found");
    // keep the denormalised copies on items in step (the old admin UI did this client-side)
    if (id) await this.dbs.db.update(catalogItems).set({ categoryName: row.name, mainSection: row.mainSection }).where(eq(catalogItems.categoryId, id));
    await this.audit.log(actor, { action: id ? "UPDATE" : "INSERT", table: "catalog_categories", recordId: row.id, recordLabel: row.name, newData: values });
    return row;
  }
  /** Deleting a category re-parents its items to `moveTo` (or leaves them uncategorised), as the old UI did. */
  async deleteCategory(actor: Claims, id: string, moveTo?: string) {
    await this.dbs.withTx(async (tx) => {
      const [target] = moveTo ? await tx.select().from(catalogCategories).where(eq(catalogCategories.id, moveTo)).limit(1) : [];
      await tx.update(catalogItems).set({ categoryId: moveTo ?? null, categoryName: target?.name ?? null, mainSection: target?.mainSection ?? null }).where(eq(catalogItems.categoryId, id));
      const r = await tx.delete(catalogCategories).where(eq(catalogCategories.id, id)).returning({ id: catalogCategories.id });
      if (!r.length) throw new AppError("not_found");
    });
    await this.audit.log(actor, { action: "DELETE", table: "catalog_categories", recordId: id, newData: { moved_items_to: moveTo ?? null } });
  }
  async reorderCategories(actor: Claims, orderedIds: string[]) {
    await this.dbs.withTx(async (tx) => { for (let i = 0; i < orderedIds.length; i++) await tx.update(catalogCategories).set({ sortOrder: i }).where(eq(catalogCategories.id, orderedIds[i])); });
    await this.audit.log(actor, { action: "reorder", table: "catalog_categories", newData: { count: orderedIds.length } });
  }

  private itemValues(d: Partial<CatalogItemInput>) {
    return {
      ...(d.name !== undefined && { name: d.name }), ...(d.default_price !== undefined && { defaultPrice: money(d.default_price ?? 0) }),
      ...(d.image_url !== undefined && { imageUrl: d.image_url }), ...(d.barcode !== undefined && { barcode: d.barcode || null }), ...(d.category_id !== undefined && { categoryId: d.category_id }),
      ...(d.category_name !== undefined && { categoryName: d.category_name }), ...(d.category_path !== undefined && { categoryPath: d.category_path }), ...(d.description !== undefined && { description: d.description }),
      ...(d.main_section !== undefined && { mainSection: d.main_section }), ...(d.subcategory !== undefined && { subcategory: d.subcategory }), ...(d.sort_order !== undefined && { sortOrder: d.sort_order }), ...(d.source !== undefined && { source: d.source }),
    };
  }
  async createItem(actor: Claims, d: CatalogItemInput) {
    const [row] = await this.dbs.db.insert(catalogItems).values({ ...this.itemValues(d), name: d.name, source: d.source ?? "seed" }).onConflictDoNothing().returning();
    if (!row) throw new AppError("conflict", { reason: "duplicate_name_barcode" });
    await this.audit.log(actor, { action: "INSERT", table: "catalog_items", recordId: row.id, recordLabel: row.name });
    return row;
  }
  async updateItem(actor: Claims, id: string, d: Partial<CatalogItemInput>) {
    const [row] = await this.dbs.db.update(catalogItems).set(this.itemValues(d)).where(eq(catalogItems.id, id)).returning();
    if (!row) throw new AppError("not_found");
    await this.audit.log(actor, { action: "UPDATE", table: "catalog_items", recordId: id, recordLabel: row.name, changedFields: Object.keys(d) });
    return row;
  }
  async deleteItem(actor: Claims, id: string) {
    const r = await this.dbs.db.delete(catalogItems).where(eq(catalogItems.id, id)).returning({ id: catalogItems.id, name: catalogItems.name });
    if (!r.length) throw new AppError("not_found");
    await this.audit.log(actor, { action: "DELETE", table: "catalog_items", recordId: id, recordLabel: r[0].name });
  }
  /** Excel import / ZIP import: rows with `id` are updated, others inserted; per-row errors are returned, not thrown. */
  async bulkUpsert(actor: Claims, rows: (Partial<CatalogItemInput> & { id?: string })[]) {
    const errors: { index: number; error: string }[] = []; let inserted = 0, updated = 0;
    await this.dbs.withTx(async (tx) => {
      for (const [i, r] of rows.entries()) {
        try {
          if (r.id) { const u = await tx.update(catalogItems).set(this.itemValues(r)).where(eq(catalogItems.id, r.id)).returning({ id: catalogItems.id }); if (u.length) updated++; else errors.push({ index: i, error: "not_found" }); }
          else if (!r.name) errors.push({ index: i, error: "name_required" });
          else { const ins = await tx.insert(catalogItems).values({ ...this.itemValues(r), name: r.name, source: r.source ?? "library_import" }).onConflictDoNothing().returning({ id: catalogItems.id }); if (ins.length) inserted++; else errors.push({ index: i, error: "duplicate" }); }
        } catch (e) { errors.push({ index: i, error: (e as Error).message.slice(0, 200) }); }
      }
    });
    await this.audit.log(actor, { action: "bulk_upsert", table: "catalog_items", newData: { rows: rows.length, inserted, updated, errors: errors.length } });
    return { inserted, updated, errors };
  }
  async normalizeSortOrder() {
    await this.dbs.db.execute(sql`with ranked as (select id, row_number() over (partition by category_id order by sort_order, name) - 1 as rn from ${catalogItems}) update ${catalogItems} c set sort_order = r.rn from ranked r where r.id = c.id`);
  }
  /** library-import.tsx "wipe everything" (super only, audited). Files in the bucket are left to the files cleanup job. */
  async wipe(actor: Claims) {
    const [{ n }] = await this.dbs.db.select({ n: sql<number>`count(*)::int` }).from(catalogItems);
    await this.dbs.withTx(async (tx) => { await tx.delete(catalogItems); await tx.delete(catalogCategories); });
    await this.audit.log(actor, { action: "wipe", table: "catalog_items", newData: { deleted_items: n } });
    return { deleted_items: n };
  }
}
