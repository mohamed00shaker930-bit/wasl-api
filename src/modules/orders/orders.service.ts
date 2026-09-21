import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { DbService, type Tx } from "@/db/db.module";
import { creditAccounts, creditTransactions, customerRatings, orderItems, orders, productOffers, profiles, ratings, stores } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import { buildOrderNote, isExternalWallet, type PayMethod } from "@/domain/checkout";
import { money, num } from "@/domain/money";
import { canCustomerCancel, canMerchantTransition, canRate, canRequestReturn } from "@/domain/order-status";
import type { OrderStatus } from "@/domain/types";
import { CatalogService } from "@/modules/catalog/catalog.service";
import { WalletService } from "@/modules/wallet/wallet.service";
import { CreditService } from "@/modules/credit/credit.service";
import type { CheckoutDto, OrdersQueryDto } from "./dto";

@Injectable()
export class OrdersService {
  constructor(private dbs: DbService, private catalog: CatalogService, private wallet: WalletService, private credit: CreditService) {}

  /**
   * Checkout (cart.tsx + pay_order_with_wallet, in ONE transaction). The client never supplies prices or the total:
   * unit prices are read from products/offers at this moment and order_items are written with them; the DB trigger
   * recomputes orders.total and commission from the items. Initial status follows checkout.ts:
   * cash/external → sent; credit → sent + credit_status pending; wallet → delivered (paid).
   */
  async checkout(customerId: string, dto: CheckoutDto) {
    const [store] = await this.dbs.db.select().from(stores).where(eq(stores.id, dto.store_id)).limit(1);
    if (!store) throw new AppError("store_missing");
    if (store.status !== "active") throw new AppError("store_not_active");
    const prices = await this.catalog.effectivePrices(store.id, dto.items.map((i) => i.product_id));
    const lines = dto.items.map((i) => {
      const p = prices.get(i.product_id);
      if (!p) throw new AppError("product_unknown", { product_id: i.product_id });
      if (!p.inStock) throw new AppError("product_out_of_stock", { product_id: i.product_id, name: p.name });
      return { productId: i.product_id, name: p.name, price: p.price, qty: i.qty, note: i.note ?? null, offerId: p.offerId };
    });
    const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
    if (!(total > 0)) throw new AppError("invalid_total");
    const payment = dto.payment_method as PayMethod;

    return this.dbs.withTx(async (tx) => {
      const [order] = await tx.insert(orders).values({
        customerId, storeId: store.id, total: money(total), paymentMethod: payment,
        creditStatus: payment === "credit" ? "pending" : null,
        status: payment === "wallet" ? "delivered" : "sent",
        channel: "online",
        note: buildOrderNote({ payment, walletRef: dto.wallet_ref, note: dto.note }),
        locationLandmark: dto.location.landmark, locationPhone: dto.location.phone || null, locationLabel: dto.location.label ?? null,
        locationLat: dto.location.lat ?? null, locationLng: dto.location.lng ?? null,
        commissionPct: store.commissionPct ?? undefined,
      }).returning();
      await tx.insert(orderItems).values(lines.map((l) => ({ orderId: order.id, productId: l.productId, name: l.name, price: money(l.price), qty: l.qty, note: l.note })));
      for (const l of lines) if (l.offerId) await tx.update(productOffers).set({ soldQty: sql`${productOffers.soldQty} + ${l.qty}` }).where(eq(productOffers.id, l.offerId));
      if (payment === "wallet") await this.wallet.payOrder(tx, customerId, order.id, total);
      // credit: the charge entry is created when the merchant approves the credit (merchant.orders.tsx flow); nothing yet.
      const [fresh] = await tx.select().from(orders).where(eq(orders.id, order.id)).limit(1);
      return { ...fresh, items: lines.map(({ offerId: _o, ...l }) => l) };
    });
  }

  // ---------- customer ----------
  async listForCustomer(customerId: string, q: OrdersQueryDto) {
    const rows = await this.dbs.db.select({ o: orders, storeName: stores.name, rated: sql<boolean>`exists (select 1 from ratings r where r.order_id = orders.id)` })
      .from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
      .where(and(eq(orders.customerId, customerId), q.status ? eq(orders.status, q.status) : undefined)).orderBy(desc(orders.createdAt)).limit(q.limit);
    return this.attachItems(rows.map((r) => ({ ...r.o, rated: r.rated, store: { id: r.o.storeId, name: r.storeName } })));
  }
  async getForCustomer(customerId: string, id: string) {
    const [o] = await this.dbs.db.select().from(orders).where(and(eq(orders.id, id), eq(orders.customerId, customerId))).limit(1);
    if (!o) throw new AppError("not_found");
    return (await this.attachItems([o]))[0];
  }
  async customerCancel(customerId: string, id: string) {
    return this.dbs.withTx(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.customerId, customerId))).for("update");
      if (!o) throw new AppError("not_found");
      if (!canCustomerCancel(o.status as OrderStatus)) throw new AppError("invalid_status_transition", { from: o.status, to: "cancelled" });
      const [u] = await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, id)).returning();
      return u;
    });
  }
  /** customer_request_return(): delivered orders only, once. */
  async customerRequestReturn(customerId: string, id: string, reason: string) {
    return this.dbs.withTx(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.customerId, customerId))).for("update");
      if (!o) throw new AppError("not_found");
      if (!canRequestReturn(o.status as OrderStatus, o.returnStatus)) throw new AppError("return_not_allowed");
      const [u] = await tx.update(orders).set({ returnStatus: "requested", returnReason: reason, returnRequestedAt: new Date() }).where(eq(orders.id, id)).returning();
      return u;
    });
  }
  async customerRate(customerId: string, id: string, stars: number, comment?: string) {
    const [o] = await this.dbs.db.select().from(orders).where(and(eq(orders.id, id), eq(orders.customerId, customerId))).limit(1);
    if (!o) throw new AppError("not_found");
    if (!canRate(o.status as OrderStatus)) throw new AppError("invalid_status_transition", { reason: "not_delivered" });
    const [exists] = await this.dbs.db.select({ id: ratings.id }).from(ratings).where(eq(ratings.orderId, id)).limit(1);
    if (exists) throw new AppError("already_rated");
    const [r] = await this.dbs.db.insert(ratings).values({ customerId, storeId: o.storeId, orderId: id, stars, comment: comment ?? null }).returning();
    return r; // trigger update_store_rating refreshes stores.rating
  }

  // ---------- merchant ----------
  async listForStore(storeId: string, q: OrdersQueryDto) {
    const rows = await this.dbs.db.select().from(orders).where(and(eq(orders.storeId, storeId),
      q.status ? eq(orders.status, q.status) : undefined, q.channel ? eq(orders.channel, q.channel) : undefined,
      q.from ? gte(orders.createdAt, new Date(q.from)) : undefined, q.to ? lte(orders.createdAt, new Date(q.to)) : undefined))
      .orderBy(desc(orders.createdAt)).limit(q.limit);
    return this.attachItems(rows);
  }
  async getForStore(storeId: string, id: string) {
    const [o] = await this.dbs.db.select().from(orders).where(and(eq(orders.id, id), eq(orders.storeId, storeId))).limit(1);
    if (!o) throw new AppError("not_found");
    return (await this.attachItems([o]))[0];
  }
  /** get_order_customer(): name/phone of the customer, only to the merchant of that order. */
  async orderCustomer(storeId: string, id: string) {
    const [row] = await this.dbs.db.select({ name: profiles.name, phone: profiles.phone, locationPhone: orders.locationPhone }).from(orders)
      .leftJoin(profiles, eq(profiles.id, orders.customerId)).where(and(eq(orders.id, id), eq(orders.storeId, storeId))).limit(1);
    if (!row) throw new AppError("not_found");
    return { name: row.name, phone: row.locationPhone || row.phone };
  }
  async merchantSetStatus(storeId: string, id: string, to: OrderStatus) {
    return this.dbs.withTx(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.storeId, storeId))).for("update");
      if (!o) throw new AppError("not_found");
      if (!canMerchantTransition(o.status as OrderStatus, to)) throw new AppError("invalid_status_transition", { from: o.status, to });
      if (o.paymentMethod === "credit" && o.creditStatus === "pending" && to !== "declined") throw new AppError("invalid_status_transition", { reason: "credit_pending" });
      const [u] = await tx.update(orders).set({ status: to }).where(eq(orders.id, id)).returning();
      return u; // trigger notify_order_status tells the customer
    });
  }
  /**
   * Merchant decides an online credit order (merchant.orders.tsx): approve → account + approved charge (balance moves now)
   * and the order continues to `accepted`; decline → credit declined and order declined.
   */
  async merchantCreditDecision(storeId: string, id: string, approve: boolean) {
    return this.dbs.withTx(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.storeId, storeId))).for("update");
      if (!o) throw new AppError("not_found");
      if (o.paymentMethod !== "credit" || o.creditStatus !== "pending") throw new AppError("credit_tx_not_pending");
      if (approve) {
        const acc = await this.credit.ensureAccount(tx, o.customerId, storeId);
        await this.credit.addEntry(tx, { accountId: acc.id, type: "charge", amount: num(o.total), status: "approved", orderId: o.id, note: "طلب أجل" });
        const [u] = await tx.update(orders).set({ creditStatus: "approved", status: o.status === "sent" ? "accepted" : o.status }).where(eq(orders.id, id)).returning();
        return u;
      }
      const [u] = await tx.update(orders).set({ creditStatus: "declined", status: "declined" }).where(eq(orders.id, id)).returning();
      return u;
    });
  }
  /** Return decision. Approval refunds a wallet payment or posts a credit `payment` for the order amount. */
  async merchantReturnDecision(storeId: string, id: string, approve: boolean) {
    return this.dbs.withTx(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.storeId, storeId))).for("update");
      if (!o) throw new AppError("not_found");
      if (o.returnStatus !== "requested") throw new AppError("return_not_allowed", { status: o.returnStatus });
      if (approve) {
        if (o.paymentMethod === "wallet") await this.wallet.creditWallet(tx, o.customerId, num(o.total), "refund", "استرجاع طلب", o.id, "wallet");
        if (o.paymentMethod === "credit" && o.creditStatus === "approved") {
          const [acc] = await tx.select().from(creditAccounts).where(and(eq(creditAccounts.customerId, o.customerId), eq(creditAccounts.storeId, storeId))).limit(1);
          if (acc) await this.credit.addEntry(tx, { accountId: acc.id, type: "payment", amount: num(o.total), status: "approved", orderId: o.id, note: "استرجاع طلب أجل" });
        }
      }
      const [u] = await tx.update(orders).set({ returnStatus: approve ? "approved" : "rejected", returnRespondedAt: new Date() }).where(eq(orders.id, id)).returning();
      return u;
    });
  }
  async merchantRateCustomer(storeId: string, orderId: string, stars: number, comment?: string) {
    const [o] = await this.dbs.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, storeId))).limit(1);
    if (!o) throw new AppError("not_found");
    const [r] = await this.dbs.db.insert(customerRatings).values({ customerId: o.customerId, storeId, orderId, stars, comment: comment ?? null }).onConflictDoNothing().returning();
    if (!r) throw new AppError("already_rated");
    return r;
  }

  private async attachItems<T extends { id: string }>(list: T[]) {
    if (!list.length) return [] as (T & { items: (typeof orderItems.$inferSelect)[]; customerRated: boolean; rated: boolean })[];
    const ids = list.map((o) => o.id);
    const [items, merchantRatings, customerRatingsRows] = await Promise.all([
      this.dbs.db.select().from(orderItems).where(inArray(orderItems.orderId, ids)),
      this.dbs.db.select({ orderId: customerRatings.orderId }).from(customerRatings).where(inArray(customerRatings.orderId, ids)),
      this.dbs.db.select({ orderId: ratings.orderId }).from(ratings).where(inArray(ratings.orderId, ids)),
    ]);
    const ratedByMerchant = new Set(merchantRatings.map((r) => r.orderId)), ratedByCustomer = new Set(customerRatingsRows.map((r) => r.orderId));
    // customerRated: the merchant already rated this customer; rated: the customer already rated the order
    return list.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id), customerRated: ratedByMerchant.has(o.id), rated: ratedByCustomer.has(o.id) }));
  }
}
