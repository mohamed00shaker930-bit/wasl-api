import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { DbService } from "@/db/db.module";
import { appSettings, banners, businessCategories, catalogCategories, catalogItems, categories, productOffers, products, stores } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import type { CatalogItemsQueryDto, ProductsQueryDto, StoresQueryDto } from "./dto";

/** Keys of app_settings that unauthenticated clients may read (everything else is admin-only). */
export const PUBLIC_SETTINGS = ["delivery_fee", "min_order", "max_credit", "support_phone", "wallets_enabled", "credit_enabled", "ewallets_enabled"] as const;

@Injectable()
export class CatalogService {
  constructor(private dbs: DbService) {}

  /** Active stores; if lat/lng are given they are sorted by distance (haversine, km) — the old client did this in JS. */
  async listStores(q: StoresQueryDto) {
    const distance = q.lat != null && q.lng != null
      ? sql<number>`6371 * acos(least(1.0, cos(radians(${q.lat})) * cos(radians(${stores.lat})) * cos(radians(${stores.lng}) - radians(${q.lng})) + sin(radians(${q.lat})) * sin(radians(${stores.lat}))))`
      : sql<number>`null`;
    return this.dbs.db.select({
      id: stores.id, name: stores.name, area: stores.area, lat: stores.lat, lng: stores.lng, isOpen: stores.isOpen, rating: stores.rating,
      ratingCount: stores.ratingCount, deliveryInfo: stores.deliveryInfo, phone: stores.phone, imageUrl: stores.imageUrl,
      businessCategoryId: stores.businessCategoryId, distanceKm: distance,
    }).from(stores)
      .where(and(eq(stores.status, "active"), q.q ? ilike(stores.name, `%${q.q}%`) : undefined, q.category_id ? eq(stores.businessCategoryId, q.category_id) : undefined))
      .orderBy(q.lat != null && q.lng != null ? asc(distance) : desc(stores.rating), asc(stores.name))
      .limit(q.limit);
  }

  async getStore(id: string) {
    const [s] = await this.dbs.db.select().from(stores).where(and(eq(stores.id, id), eq(stores.status, "active"))).limit(1);
    if (!s) throw new AppError("not_found");
    const { commissionPct: _c, ownerId: _o, ...pub } = s;
    return pub;
  }

  storeCategories(storeId: string) {
    return this.dbs.db.select().from(categories).where(eq(categories.storeId, storeId)).orderBy(asc(categories.sortOrder), asc(categories.name));
  }

  /** Products of a store with the active offer (if any) merged in, exactly as store.$storeId.tsx computed it client-side. */
  async storeProducts(storeId: string, q: ProductsQueryDto) {
    const rows = await this.dbs.db.select().from(products)
      .where(and(eq(products.storeId, storeId),
        q.category_id ? eq(products.categoryId, q.category_id) : undefined,
        q.q ? ilike(products.name, `%${q.q}%`) : undefined,
        q.barcode ? eq(products.barcode, q.barcode) : undefined,
        q.in_stock ? eq(products.inStock, true) : undefined))
      .orderBy(asc(products.name));
    const offers = await this.activeOffers(storeId);
    const byProduct = new Map(offers.map((o) => [o.productId, o]));
    return rows.map((p) => {
      const o = byProduct.get(p.id);
      return { ...p, offer: o ? { id: o.id, discountPrice: o.discountPrice, endsAt: o.endsAt, remaining: o.maxQty != null ? o.maxQty - o.soldQty : null } : null };
    });
  }

  activeOffers(storeId: string) {
    const now = new Date();
    return this.dbs.db.select().from(productOffers).where(and(
      eq(productOffers.storeId, storeId), eq(productOffers.active, true),
      or(isNull(productOffers.startsAt), lte(productOffers.startsAt, now)),
      or(isNull(productOffers.endsAt), gt(productOffers.endsAt, now)),
      or(isNull(productOffers.maxQty), sql`${productOffers.soldQty} < ${productOffers.maxQty}`),
    ));
  }

  /** Effective unit price for a product right now (offer price if an active offer exists). Used by checkout. */
  async effectivePrices(storeId: string, productIds: string[]) {
    if (!productIds.length) return new Map<string, { price: number; name: string; inStock: boolean; offerId?: string }>();
    const rows = await this.dbs.db.select().from(products).where(and(eq(products.storeId, storeId), inArray(products.id, productIds)));
    const offers = await this.activeOffers(storeId);
    const byProduct = new Map(offers.map((o) => [o.productId, o]));
    return new Map(rows.map((p) => {
      const o = byProduct.get(p.id);
      return [p.id, { price: Number(o?.discountPrice ?? p.price), name: p.name, inStock: p.inStock, offerId: o?.id }];
    }));
  }

  /** Cross-store barcode lookup for the customer scanner (was a single products query across all stores). */
  async productsByBarcode(barcode: string, limit = 20) {
    return this.dbs.db.select({ p: products, storeName: stores.name, storeIsOpen: stores.isOpen, storeLat: stores.lat, storeLng: stores.lng })
      .from(products).innerJoin(stores, eq(stores.id, products.storeId))
      .where(and(eq(products.barcode, barcode), eq(products.inStock, true), eq(stores.status, "active"))).limit(limit);
  }

  banners() {
    return this.dbs.db.select().from(banners).where(eq(banners.isActive, true)).orderBy(asc(banners.sortOrder), desc(banners.createdAt));
  }
  businessCategories() {
    return this.dbs.db.select().from(businessCategories).where(eq(businessCategories.isActive, true)).orderBy(asc(businessCategories.sortOrder));
  }
  async publicSettings() {
    const rows = await this.dbs.db.select().from(appSettings).where(inArray(appSettings.key, [...PUBLIC_SETTINGS]));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async catalogCategories() {
    const counts = this.dbs.db.select({ categoryId: catalogItems.categoryId, n: sql<number>`count(*)::int`.as("n") }).from(catalogItems).groupBy(catalogItems.categoryId).as("counts");
    return this.dbs.db.select({ id: catalogCategories.id, name: catalogCategories.name, icon: catalogCategories.icon, imageUrl: catalogCategories.imageUrl,
      mainSection: catalogCategories.mainSection, parentCategory: catalogCategories.parentCategory, sortOrder: catalogCategories.sortOrder, usageCount: catalogCategories.usageCount,
      itemsCount: sql<number>`coalesce(${counts.n}, 0)` })
      .from(catalogCategories).leftJoin(counts, eq(counts.categoryId, catalogCategories.id))
      .orderBy(asc(catalogCategories.sortOrder), asc(catalogCategories.name));
  }
  async catalogItems(q: CatalogItemsQueryDto) {
    const where = and(q.category_id ? eq(catalogItems.categoryId, q.category_id) : undefined, q.q ? or(ilike(catalogItems.name, `%${q.q}%`), eq(catalogItems.barcode, q.q)) : undefined);
    const order = q.sort === "newest" ? desc(catalogItems.createdAt) : q.sort === "usage" ? desc(catalogItems.usageCount) : asc(catalogItems.name);
    const [items, [{ total }]] = await Promise.all([
      this.dbs.db.select().from(catalogItems).where(where).orderBy(asc(catalogItems.sortOrder), order).limit(q.limit).offset((q.page - 1) * q.limit),
      this.dbs.db.select({ total: sql<number>`count(*)::int` }).from(catalogItems).where(where),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
}
