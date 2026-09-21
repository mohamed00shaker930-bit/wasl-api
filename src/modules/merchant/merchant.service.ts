import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { DbService } from "@/db/db.module";
import { catalogItems, categories, creditAccounts, customProductRequests, orderItems, orders, pendingCustomers, posIngestLog, productOffers, products, profiles, stores } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import { money, num } from "@/domain/money";
import { CreditService } from "@/modules/credit/credit.service";
import type { CategoryDto, CreateProductDto, OfferDto, PendingCustomerDto, PosProductDto, PosSaleDto, UpdateProductDto, UpdateStoreDto } from "./dto";

@Injectable()
export class MerchantService {
  constructor(private dbs: DbService, private credit: CreditService) {}

  // ---------- store ----------
  async store(storeId: string) {
    const [s] = await this.dbs.db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!s) throw new AppError("not_found");
    return s;
  }
  async updateStore(storeId: string, d: UpdateStoreDto) {
    const [s] = await this.dbs.db.update(stores).set({
      ...(d.name !== undefined && { name: d.name }), ...(d.area !== undefined && { area: d.area }), ...(d.delivery_info !== undefined && { deliveryInfo: d.delivery_info }),
      ...(d.phone !== undefined && { phone: d.phone }), ...(d.image_url !== undefined && { imageUrl: d.image_url }), ...(d.is_open !== undefined && { isOpen: d.is_open }),
      ...(d.lat !== undefined && { lat: d.lat }), ...(d.lng !== undefined && { lng: d.lng }), ...(d.business_category_id !== undefined && { businessCategoryId: d.business_category_id }),
    }).where(eq(stores.id, storeId)).returning();
    return s;
  }
  /** merchant.index.tsx tiles. */
  async dashboard(storeId: string) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [c] = await this.dbs.db.select({
      newOrders: sql<number>`count(*) filter (where ${orders.status} = 'sent')::int`,
      todayOrders: sql<number>`count(*) filter (where ${orders.createdAt} >= ${start})::int`,
      todayRevenue: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.createdAt} >= ${start} and ${orders.status} = 'delivered'), 0)`,
      pendingReturns: sql<number>`count(*) filter (where ${orders.returnStatus} = 'requested')::int`,
    }).from(orders).where(eq(orders.storeId, storeId));
    return { new_orders: c.newOrders, today_orders: c.todayOrders, today_revenue: num(c.todayRevenue), pending_returns: c.pendingReturns, credit_outstanding: await this.credit.storeOutstanding(storeId) };
  }

  // ---------- categories / products / offers ----------
  categories(storeId: string) { return this.dbs.db.select().from(categories).where(eq(categories.storeId, storeId)).orderBy(asc(categories.sortOrder), asc(categories.name)); }
  async createCategory(storeId: string, d: CategoryDto) { const [c] = await this.dbs.db.insert(categories).values({ storeId, name: d.name, sortOrder: d.sort_order ?? 0 }).returning(); return c; }
  async updateCategory(storeId: string, id: string, d: CategoryDto) {
    const [c] = await this.dbs.db.update(categories).set({ name: d.name, ...(d.sort_order !== undefined && { sortOrder: d.sort_order }) }).where(and(eq(categories.id, id), eq(categories.storeId, storeId))).returning();
    if (!c) throw new AppError("not_found"); return c;
  }
  async deleteCategory(storeId: string, id: string) {
    const r = await this.dbs.db.delete(categories).where(and(eq(categories.id, id), eq(categories.storeId, storeId))).returning({ id: categories.id });
    if (!r.length) throw new AppError("not_found");
  }
  products(storeId: string) { return this.dbs.db.select().from(products).where(eq(products.storeId, storeId)).orderBy(asc(products.name)); }
  private productRow(storeId: string, d: Partial<CreateProductDto>) {
    return {
      ...(d.name !== undefined && { name: d.name }), ...(d.price !== undefined && { price: money(d.price) }), ...(d.category_id !== undefined && { categoryId: d.category_id }),
      ...(d.barcode !== undefined && { barcode: d.barcode || null }), ...(d.in_stock !== undefined && { inStock: d.in_stock }), ...(d.image_url !== undefined && { imageUrl: d.image_url }),
      ...(d.lib_category !== undefined && { libCategory: d.lib_category }), ...(d.main_section !== undefined && { mainSection: d.main_section }), ...(d.subcategory !== undefined && { subcategory: d.subcategory }),
      storeId,
    };
  }
  async createProduct(storeId: string, d: CreateProductDto, id?: string) {
    const [p] = await this.dbs.db.insert(products).values({ id, ...this.productRow(storeId, d), name: d.name, price: money(d.price) }).onConflictDoNothing().returning();
    return p ?? null;
  }
  async updateProduct(storeId: string, id: string, d: UpdateProductDto) {
    const [p] = await this.dbs.db.update(products).set(this.productRow(storeId, d)).where(and(eq(products.id, id), eq(products.storeId, storeId))).returning();
    if (!p) throw new AppError("not_found"); return p;
  }
  async deleteProduct(storeId: string, id: string) {
    const r = await this.dbs.db.delete(products).where(and(eq(products.id, id), eq(products.storeId, storeId))).returning({ id: products.id });
    if (!r.length) throw new AppError("not_found");
  }
  /** CatalogPicker: copy library items into the store, creating store categories from category_name as the old client did. */
  async importFromCatalog(storeId: string, itemIds: string[]) {
    const items = await this.dbs.db.select().from(catalogItems).where(inArray(catalogItems.id, itemIds));
    return this.dbs.withTx(async (tx) => {
      const existing = await tx.select().from(categories).where(eq(categories.storeId, storeId));
      const byName = new Map(existing.map((c) => [c.name, c.id]));
      for (const name of new Set(items.map((i) => i.categoryName).filter((n): n is string => !!n))) {
        if (!byName.has(name)) { const [c] = await tx.insert(categories).values({ storeId, name }).returning(); byName.set(name, c.id); }
      }
      const rows = items.map((i) => ({ storeId, name: i.name, price: i.defaultPrice ?? "0", barcode: i.barcode, imageUrl: i.imageUrl, categoryId: i.categoryName ? byName.get(i.categoryName) ?? null : null, libCategory: i.categoryName, mainSection: i.mainSection, subcategory: i.subcategory }));
      const inserted = rows.length ? await tx.insert(products).values(rows).onConflictDoNothing().returning({ id: products.id }) : [];
      if (items.length) await tx.update(catalogItems).set({ usageCount: sql`${catalogItems.usageCount} + 1` }).where(inArray(catalogItems.id, itemIds));
      return { imported: inserted.length, skipped: rows.length - inserted.length };
    });
  }
  offers(storeId: string) { return this.dbs.db.select().from(productOffers).where(eq(productOffers.storeId, storeId)).orderBy(desc(productOffers.createdAt)); }
  async createOffer(storeId: string, d: OfferDto) {
    const [p] = await this.dbs.db.select({ id: products.id }).from(products).where(and(eq(products.id, d.product_id), eq(products.storeId, storeId))).limit(1);
    if (!p) throw new AppError("product_unknown");
    const [o] = await this.dbs.db.insert(productOffers).values({ storeId, productId: d.product_id, discountPrice: money(d.discount_price), startsAt: d.starts_at ? new Date(d.starts_at) : undefined, endsAt: d.ends_at ? new Date(d.ends_at) : null, maxQty: d.max_qty ?? null, active: d.active ?? true }).returning();
    return o;
  }
  async updateOffer(storeId: string, id: string, d: Partial<OfferDto>) {
    const [o] = await this.dbs.db.update(productOffers).set({
      ...(d.discount_price !== undefined && { discountPrice: money(d.discount_price) }), ...(d.starts_at ? { startsAt: new Date(d.starts_at) } : {}),
      ...(d.ends_at !== undefined && { endsAt: d.ends_at ? new Date(d.ends_at) : null }), ...(d.max_qty !== undefined && { maxQty: d.max_qty }), ...(d.active !== undefined && { active: d.active }),
    }).where(and(eq(productOffers.id, id), eq(productOffers.storeId, storeId))).returning();
    if (!o) throw new AppError("not_found"); return o;
  }
  async deleteOffer(storeId: string, id: string) {
    const r = await this.dbs.db.delete(productOffers).where(and(eq(productOffers.id, id), eq(productOffers.storeId, storeId))).returning({ id: productOffers.id });
    if (!r.length) throw new AppError("not_found");
  }

  // ---------- pending (unregistered) customers ----------
  pendingCustomers(storeId: string) { return this.dbs.db.select().from(pendingCustomers).where(and(eq(pendingCustomers.storeId, storeId), isNull(pendingCustomers.claimedByUserId))).orderBy(asc(pendingCustomers.name)); }
  async createPendingCustomer(storeId: string, createdBy: string, d: PendingCustomerDto) {
    const [row] = await this.dbs.db.insert(pendingCustomers).values({ storeId, createdBy, name: d.name, phone: d.phone }).returning();
    return row;
  }

  // ---------- custom product requests (merchant side) ----------
  customRequests(storeId: string) {
    return this.dbs.db.select({ r: customProductRequests, customerName: profiles.name }).from(customProductRequests).leftJoin(profiles, eq(profiles.id, customProductRequests.customerId))
      .where(eq(customProductRequests.storeId, storeId)).orderBy(desc(customProductRequests.createdAt));
  }
  async quote(storeId: string, id: string, price: number, note: string | null) {
    const [r] = await this.dbs.db.update(customProductRequests).set({ merchantPrice: money(price), merchantNote: note, status: "quoted" })
      .where(and(eq(customProductRequests.id, id), eq(customProductRequests.storeId, storeId), eq(customProductRequests.status, "pending"))).returning();
    if (!r) throw new AppError("not_found"); return r;
  }
  async rejectRequest(storeId: string, id: string) {
    const [r] = await this.dbs.db.update(customProductRequests).set({ status: "rejected" }).where(and(eq(customProductRequests.id, id), eq(customProductRequests.storeId, storeId))).returning();
    if (!r) throw new AppError("not_found"); return r;
  }

  // ---------- reports (merchant.reports.tsx aggregation, now server-side) ----------
  async reportSummary(storeId: string, from: Date, to: Date) {
    const rows = await this.dbs.db.select().from(orders).where(and(eq(orders.storeId, storeId), gte(orders.createdAt, from), lte(orders.createdAt, to)));
    const delivered = rows.filter((o) => o.status === "delivered");
    const byPayment: Record<string, { count: number; total: number }> = {};
    for (const o of delivered) { const b = (byPayment[o.paymentMethod] ??= { count: 0, total: 0 }); b.count++; b.total += num(o.total); }
    const ids = delivered.map((o) => o.id);
    const items = ids.length ? await this.dbs.db.select({ name: orderItems.name, qty: sql<number>`sum(${orderItems.qty})::int`, total: sql<string>`sum(${orderItems.qty} * ${orderItems.price})` }).from(orderItems).where(inArray(orderItems.orderId, ids)).groupBy(orderItems.name).orderBy(desc(sql`sum(${orderItems.qty})`)).limit(5) : [];
    const revenue = delivered.reduce((s, o) => s + num(o.total), 0);
    return {
      from, to, orders: rows.length, delivered: delivered.length, cancelled: rows.filter((o) => ["declined", "cancelled"].includes(o.status)).length,
      revenue, average_order: delivered.length ? revenue / delivered.length : 0,
      online: delivered.filter((o) => o.channel === "online").length, in_store: delivered.filter((o) => o.channel === "in_store").length,
      online_revenue: delivered.filter((o) => o.channel === "online").reduce((s, o) => s + num(o.total), 0),
      in_store_revenue: delivered.filter((o) => o.channel === "in_store").reduce((s, o) => s + num(o.total), 0),
      by_payment: byPayment, top_products: items.map((i) => ({ ...i, total: num(i.total) })),
      commission: delivered.reduce((s, o) => s + num(o.commissionAmount), 0),
    };
  }
  async reportOrders(storeId: string, from: Date, to: Date) {
    const rows = await this.dbs.db.select().from(orders).where(and(eq(orders.storeId, storeId), gte(orders.createdAt, from), lte(orders.createdAt, to))).orderBy(desc(orders.createdAt));
    const items = rows.length ? await this.dbs.db.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((o) => o.id))) : [];
    return rows.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id) }));
  }

  // ---------- POS ----------
  /** Local cache preload: products + credit customers + pending customers (merchant.pos.tsx did this with 3–4 queries and an RPC per customer). */
  async posSnapshot(storeId: string, since?: Date) {
    const prods = await this.dbs.db.select().from(products).where(and(eq(products.storeId, storeId), since ? gt(products.createdAt, since) : undefined));
    const registered = await this.dbs.db.select({ id: creditAccounts.customerId, name: profiles.name, phone: profiles.phone, kind: sql<string>`'registered'`, accountId: creditAccounts.id, balance: creditAccounts.balance })
      .from(creditAccounts).leftJoin(profiles, eq(profiles.id, creditAccounts.customerId)).where(eq(creditAccounts.storeId, storeId));
    const pending = await this.pendingCustomers(storeId);
    return { at: new Date(), products: prods, customers: [...registered, ...pending.map((p) => ({ id: p.id, name: p.name, phone: p.phone, kind: "pending", accountId: null, balance: null }))] };
  }

  /**
   * Idempotent ingestion of one outbox `sale` op. Everything in one transaction; the client op id is the idempotency key.
   * First call → 201 with the result; replay → 200 with the stored result. Unknown products → 422 (client marks the op failed, as before).
   */
  async posSale(storeId: string, merchantId: string, d: PosSaleDto): Promise<{ replay: boolean; result: Record<string, unknown> }> {
    return this.dbs.withTx(async (tx) => {
      const [claimed] = await tx.insert(posIngestLog).values({ clientOpId: d.op_id, storeId, kind: "sale", result: { pending: true } }).onConflictDoNothing().returning();
      if (!claimed) {
        const [prev] = await tx.select().from(posIngestLog).where(eq(posIngestLog.clientOpId, d.op_id)).limit(1);
        if (prev && prev.storeId !== storeId) throw new AppError("forbidden");
        return { replay: true, result: prev!.result as Record<string, unknown> };
      }
      const productIds = d.items.map((i) => i.product_id).filter((x): x is string => !!x);
      const known = productIds.length ? await tx.select({ id: products.id }).from(products).where(and(eq(products.storeId, storeId), inArray(products.id, productIds))) : [];
      const missing = productIds.filter((id) => !known.some((k) => k.id === id));
      if (missing.length) throw new AppError("product_unknown", { product_ids: missing });

      const isCredit = d.order.payment_method === "credit";
      const registeredCredit = isCredit && d.credit?.customerKind === "registered";
      // in-store: cash/e-wallet sales are complete; credit sales wait for the customer's approval (pending customers: note only)
      const customerId = registeredCredit ? d.credit!.customerId : (d.order.customer_id ?? merchantId);
      const total = d.items.reduce((s, i) => s + i.price * i.qty, 0);
      if (d.order.total != null && Math.abs(d.order.total - total) > 0.01) {
        // recorded, not fatal: the server-side sum of the captured line prices is authoritative
        await tx.update(posIngestLog).set({ result: { pending: true, total_mismatch: { client: d.order.total, server: total } } }).where(eq(posIngestLog.clientOpId, d.op_id));
      }
      const [store] = await tx.select({ commissionPct: stores.commissionPct }).from(stores).where(eq(stores.id, storeId)).limit(1);
      const [order] = await tx.insert(orders).values({
        id: d.order.id, customerId, storeId, total: money(total), paymentMethod: d.order.payment_method, channel: "in_store",
        status: isCredit ? "sent" : "delivered", creditStatus: isCredit ? "pending" : null, note: d.order.note ?? null,
        createdAt: new Date(d.order.created_at), commissionPct: store?.commissionPct ?? undefined,
      }).onConflictDoNothing().returning({ id: orders.id });
      if (order) await tx.insert(orderItems).values(d.items.map((i) => ({ id: i.id, orderId: d.order.id, productId: i.product_id, name: i.name, price: money(i.price), qty: i.qty, note: i.note ?? null }))).onConflictDoNothing();
      let creditTxId: string | null = null;
      if (registeredCredit && d.credit) {
        const acc = await this.credit.ensureAccount(tx, d.credit.customerId, storeId);
        const row = await this.credit.addEntry(tx, { id: d.credit.txId, accountId: acc.id, type: "charge", amount: d.credit.amount, status: "pending", orderId: d.order.id, note: d.credit.note ?? "بيع داخل المحل - أجل" });
        creditTxId = row?.id ?? d.credit.txId;
      }
      const result = { order_id: d.order.id, total, credit_tx_id: creditTxId, created: !!order };
      await tx.update(posIngestLog).set({ result }).where(eq(posIngestLog.clientOpId, d.op_id));
      return { replay: false, result };
    });
  }

  /** Idempotent ingestion of one outbox `new_product` op (keyed by the client-generated product id). */
  async posProduct(storeId: string, d: PosProductDto) {
    const p = await this.createProduct(storeId, d, d.id);
    if (p) return { replay: false, result: p };
    const [existing] = await this.dbs.db.select().from(products).where(and(eq(products.id, d.id), eq(products.storeId, storeId))).limit(1);
    if (!existing) throw new AppError("conflict", { reason: "id_belongs_to_another_store" });
    return { replay: true, result: existing };
  }
}
