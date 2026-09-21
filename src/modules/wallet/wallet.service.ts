import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DbService, type Tx } from "@/db/db.module";
import { wallets, walletTransactions } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import { money, num } from "@/domain/money";

/**
 * Wallet ledger. Replaces ensure_wallet(), pay_order_with_wallet(), the apply_wallet_tx trigger and
 * admin_respond_wallet_tx()/admin_grant_wallet_credit(). Every balance change happens here, inside the
 * caller's transaction, after locking the wallet row.
 */
@Injectable()
export class WalletService {
  constructor(private dbs: DbService) {}

  async ensure(tx: Tx, userId: string) {
    const [w] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (w) return w;
    const [created] = await tx.insert(wallets).values({ userId }).onConflictDoNothing().returning();
    if (created) return created;
    const [again] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    return again;
  }

  private async lock(tx: Tx, walletId: string) {
    const [w] = await tx.select().from(wallets).where(eq(wallets.id, walletId)).for("update");
    if (!w) throw new AppError("wallet_missing");
    return w;
  }

  /** Same arithmetic as the old trigger: topup/refund add, payment/adjustment subtract (a negative adjustment adds). */
  private delta(type: string, amount: number) {
    return type === "topup" || type === "refund" ? amount : -amount;
  }

  /** Approved debit for an order. Throws wallet_insufficient instead of clamping at zero. */
  async payOrder(tx: Tx, userId: string, orderId: string, amount: number) {
    const w = await this.lock(tx, (await this.ensure(tx, userId)).id);
    if (num(w.balance) < amount) throw new AppError("wallet_insufficient", { balance: num(w.balance), required: amount });
    await tx.update(wallets).set({ balance: money(num(w.balance) - amount) }).where(eq(wallets.id, w.id));
    const [row] = await tx.insert(walletTransactions).values({ walletId: w.id, userId, type: "payment", status: "approved", amount: money(amount), method: "wallet", orderId, note: "دفع طلب" }).returning();
    return row;
  }

  /** Approved credit to the wallet (refund for a returned order, or an admin adjustment). */
  async creditWallet(tx: Tx, userId: string, amount: number, type: "refund" | "adjustment", note: string | null, orderId?: string, method = "system") {
    const w = await this.lock(tx, (await this.ensure(tx, userId)).id);
    await tx.update(wallets).set({ balance: money(num(w.balance) + amount) }).where(eq(wallets.id, w.id));
    const [row] = await tx.insert(walletTransactions).values({ walletId: w.id, userId, type, status: "approved", amount: money(amount), method, note, orderId }).returning();
    return row;
  }

  /** Customer files a top-up they paid through an external e-wallet; an admin approves it later. */
  async requestTopup(userId: string, amount: number, method: string, reference: string | null, note: string | null) {
    return this.dbs.withTx(async (tx) => {
      const w = await this.ensure(tx, userId);
      const [row] = await tx.insert(walletTransactions).values({ walletId: w.id, userId, type: "topup", status: "pending", amount: money(amount), method, reference, note }).returning();
      return row;
    });
  }

  /** Admin decision on a pending transaction (top-ups today). Approving applies the delta exactly once. */
  async respond(tx: Tx, txId: string, approve: boolean) {
    const [t] = await tx.select().from(walletTransactions).where(eq(walletTransactions.id, txId)).for("update");
    if (!t) throw new AppError("not_found");
    if (t.status !== "pending") throw new AppError("conflict", { reason: "not_pending" });
    if (approve) {
      const w = await this.lock(tx, t.walletId);
      const next = num(w.balance) + this.delta(t.type, num(t.amount));
      if (next < 0) throw new AppError("wallet_insufficient");
      await tx.update(wallets).set({ balance: money(next) }).where(eq(wallets.id, w.id));
    }
    const [updated] = await tx.update(walletTransactions).set({ status: approve ? "approved" : "rejected" }).where(eq(walletTransactions.id, txId)).returning();
    return updated;
  }

  async summary(userId: string) {
    const w = await this.dbs.withTx((tx) => this.ensure(tx, userId));
    return { id: w.id, balance: num(w.balance), created_at: w.createdAt };
  }
  transactions(userId: string, limit = 50) {
    return this.dbs.db.select().from(walletTransactions).where(eq(walletTransactions.userId, userId)).orderBy(desc(walletTransactions.createdAt)).limit(limit);
  }
  pendingTopups() {
    return this.dbs.db.select().from(walletTransactions).where(and(eq(walletTransactions.type, "topup"), eq(walletTransactions.status, "pending"))).orderBy(desc(walletTransactions.createdAt));
  }
  /** For the admin dashboard tile. */
  async pendingCount() {
    const [{ n }] = await this.dbs.db.select({ n: sql<number>`count(*)::int` }).from(walletTransactions).where(eq(walletTransactions.status, "pending"));
    return n;
  }
}
