import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { DbService, type Tx } from "@/db/db.module";
import { creditAccounts, creditTransactions, orders, pendingCustomers, profiles, stores } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import { money, num } from "@/domain/money";
import { canCustomerRespond, canMerchantCancel, expectedBalance, type CreditTx } from "@/domain/credit-rules";

/**
 * Credit ("أجل") ledger. Replaces the apply_credit_tx trigger, customer_respond_credit(), merchant_cancel_credit_tx(),
 * get_credit_customer() and the direct table writes in merchant.orders.tsx / merchant.credit.tsx.
 * Invariants (credit-rules.ts): no interest, no late fees; only approved entries move the balance; a payment never
 * takes the balance below zero; approved entries are never edited (DB trigger credit_tx_append_only backs this up).
 */
@Injectable()
export class CreditService {
  constructor(private dbs: DbService) {}

  async ensureAccount(tx: Tx, customerId: string, storeId: string) {
    const [a] = await tx.insert(creditAccounts).values({ customerId, storeId }).onConflictDoNothing().returning();
    if (a) return a;
    const [existing] = await tx.select().from(creditAccounts).where(and(eq(creditAccounts.customerId, customerId), eq(creditAccounts.storeId, storeId))).limit(1);
    return existing;
  }
  private async lockAccount(tx: Tx, accountId: string) {
    const [a] = await tx.select().from(creditAccounts).where(eq(creditAccounts.id, accountId)).for("update");
    if (!a) throw new AppError("not_found");
    return a;
  }

  /** Applies an entry that just became approved. Same arithmetic as the old trigger, executed exactly once. */
  private async applyApproved(tx: Tx, accountId: string, type: "charge" | "payment", amount: number) {
    const a = await this.lockAccount(tx, accountId);
    const next = type === "charge" ? num(a.balance) + amount : Math.max(0, num(a.balance) - amount);
    await tx.update(creditAccounts).set({ balance: money(next) }).where(eq(creditAccounts.id, accountId));
    return next;
  }

  /** Insert an entry. `approved` entries hit the balance immediately; `pending` ones wait for the customer. */
  async addEntry(tx: Tx, input: { id?: string; accountId: string; type: "charge" | "payment"; amount: number; status: "pending" | "approved"; orderId?: string | null; note?: string | null }) {
    const [row] = await tx.insert(creditTransactions).values({ id: input.id, accountId: input.accountId, type: input.type, amount: money(input.amount), status: input.status, orderId: input.orderId ?? null, note: input.note ?? null })
      .onConflictDoNothing().returning();
    if (!row) return null; // idempotent replay (client-supplied id already stored)
    if (input.status === "approved") await this.applyApproved(tx, input.accountId, input.type, input.amount);
    return row;
  }

  /** customer_respond_credit(): approve/reject a pending charge; cascades to the linked order. */
  async customerRespond(customerId: string, txId: string, approve: boolean) {
    return this.dbs.withTx(async (tx) => {
      const [t] = await tx.select().from(creditTransactions).where(eq(creditTransactions.id, txId)).for("update");
      if (!t) throw new AppError("not_found");
      const [a] = await tx.select().from(creditAccounts).where(eq(creditAccounts.id, t.accountId)).limit(1);
      if (!canCustomerRespond(t as unknown as CreditTx, { customer_id: a.customerId } as never, customerId)) throw new AppError("credit_tx_not_pending");
      await tx.update(creditTransactions).set({ status: approve ? "approved" : "rejected" }).where(eq(creditTransactions.id, txId));
      if (approve) await this.applyApproved(tx, t.accountId, t.type, num(t.amount));
      if (t.orderId) {
        await tx.update(orders).set({ creditStatus: approve ? "approved" : "declined", status: approve ? "delivered" : "cancelled" }).where(eq(orders.id, t.orderId));
      }
      return { id: txId, status: approve ? "approved" : "rejected" };
    });
  }

  /** merchant_cancel_credit_tx(): only pending entries of the merchant's own store. */
  async merchantCancel(storeId: string, txId: string) {
    return this.dbs.withTx(async (tx) => {
      const [t] = await tx.select({ t: creditTransactions, a: creditAccounts }).from(creditTransactions).innerJoin(creditAccounts, eq(creditAccounts.id, creditTransactions.accountId))
        .where(and(eq(creditTransactions.id, txId), eq(creditAccounts.storeId, storeId))).for("update", { of: creditTransactions });
      if (!t) throw new AppError("not_found");
      if (!canMerchantCancel(t.t as unknown as CreditTx)) throw new AppError("credit_tx_not_pending");
      await tx.update(creditTransactions).set({ status: "rejected" }).where(eq(creditTransactions.id, txId));
      if (t.t.orderId) await tx.update(orders).set({ creditStatus: "declined" }).where(and(eq(orders.id, t.t.orderId), eq(orders.creditStatus, "pending")));
      return { id: txId, status: "rejected" };
    });
  }

  /** Merchant records a repayment (approved at once) or posts a charge (pending, needs the customer's approval). */
  async merchantAddEntry(storeId: string, accountId: string, input: { type: "charge" | "payment"; amount: number; note?: string | null }) {
    return this.dbs.withTx(async (tx) => {
      const [a] = await tx.select().from(creditAccounts).where(and(eq(creditAccounts.id, accountId), eq(creditAccounts.storeId, storeId))).limit(1);
      if (!a) throw new AppError("not_found");
      return this.addEntry(tx, { accountId, type: input.type, amount: input.amount, status: input.type === "payment" ? "approved" : "pending", note: input.note ?? (input.type === "payment" ? "سداد" : "أجل") });
    });
  }

  async merchantCreateAccount(storeId: string, customerId: string) {
    const [p] = await this.dbs.db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, customerId)).limit(1);
    if (!p) throw new AppError("not_found");
    return this.dbs.withTx((tx) => this.ensureAccount(tx, customerId, storeId));
  }

  // ---------- reads ----------
  /** Customer view: every account across stores with its entries (credit.tsx). */
  async customerLedger(customerId: string) {
    const accounts = await this.dbs.db.select({ a: creditAccounts, storeName: stores.name }).from(creditAccounts).innerJoin(stores, eq(stores.id, creditAccounts.storeId)).where(eq(creditAccounts.customerId, customerId));
    const ids = accounts.map((x) => x.a.id);
    const txs = ids.length ? await this.dbs.db.select().from(creditTransactions).where(inArray(creditTransactions.accountId, ids)).orderBy(desc(creditTransactions.createdAt)) : [];
    return accounts.map(({ a, storeName }) => {
      const list = txs.filter((t) => t.accountId === a.id);
      const asRule = list.map((t) => ({ ...t, amount: num(t.amount), created_at: t.createdAt.toISOString() })) as unknown as CreditTx[];
      return { ...a, balance: num(a.balance), store: { id: a.storeId, name: storeName }, transactions: list, ledger_consistent: expectedBalance(asRule) === num(a.balance) };
    });
  }

  /** Merchant view with the customer's name/phone (was get_credit_customer, one RPC per account). */
  async storeAccounts(storeId: string) {
    return this.dbs.db.select({ id: creditAccounts.id, customerId: creditAccounts.customerId, balance: creditAccounts.balance, createdAt: creditAccounts.createdAt, customerName: profiles.name, customerPhone: profiles.phone,
        pendingCount: sql<number>`(select count(*)::int from credit_transactions t where t.account_id = credit_accounts.id and t.status = 'pending')`,
        lastTxAt: sql<string | null>`(select max(t.created_at) from credit_transactions t where t.account_id = credit_accounts.id)` })
      .from(creditAccounts).leftJoin(profiles, eq(profiles.id, creditAccounts.customerId)).where(eq(creditAccounts.storeId, storeId)).orderBy(desc(creditAccounts.balance));
  }
  async storeAccount(storeId: string, accountId: string) {
    const [a] = await this.dbs.db.select({ id: creditAccounts.id, customerId: creditAccounts.customerId, balance: creditAccounts.balance, customerName: profiles.name, customerPhone: profiles.phone })
      .from(creditAccounts).leftJoin(profiles, eq(profiles.id, creditAccounts.customerId)).where(and(eq(creditAccounts.id, accountId), eq(creditAccounts.storeId, storeId))).limit(1);
    if (!a) throw new AppError("not_found");
    const transactions = await this.dbs.db.select().from(creditTransactions).where(eq(creditTransactions.accountId, accountId)).orderBy(desc(creditTransactions.createdAt));
    return { ...a, transactions };
  }
  /** Outstanding total for the merchant dashboard tile. */
  async storeOutstanding(storeId: string) {
    const [{ total }] = await this.dbs.db.select({ total: sql<string>`coalesce(sum(${creditAccounts.balance}), 0)` }).from(creditAccounts).where(eq(creditAccounts.storeId, storeId));
    return num(total);
  }

  /**
   * Replaces search_customers_by_name(), which let any authenticated user enumerate phone numbers.
   * A merchant may only search among customers already linked to their store (credit account or order) and their own pending customers.
   */
  async searchStoreCustomers(storeId: string, q: string) {
    const like = `%${q}%`;
    const registered = await this.dbs.db.selectDistinct({ id: profiles.id, name: profiles.name, phone: profiles.phone, kind: sql<string>`'registered'` })
      .from(profiles)
      .where(and(or(sql`${profiles.name} ilike ${like}`, sql`${profiles.phone} like ${like}`),
        or(sql`exists (select 1 from credit_accounts ca where ca.customer_id = profiles.id and ca.store_id = ${storeId})`,
           sql`exists (select 1 from orders o where o.customer_id = profiles.id and o.store_id = ${storeId})`)))
      .limit(10);
    const pending = await this.dbs.db.select({ id: pendingCustomers.id, name: pendingCustomers.name, phone: pendingCustomers.phone, kind: sql<string>`'pending'` })
      .from(pendingCustomers).where(and(eq(pendingCustomers.storeId, storeId), sql`${pendingCustomers.claimedByUserId} is null`, or(sql`${pendingCustomers.name} ilike ${like}`, sql`${pendingCustomers.phone} like ${like}`))).limit(10);
    return [...registered, ...pending];
  }
}
