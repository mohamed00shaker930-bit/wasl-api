export type CreditTxStatus = "pending" | "approved" | "rejected";
export type CreditTxType = "charge" | "payment";

export type CreditTx = {
  id: string;
  type: CreditTxType;
  status: CreditTxStatus;
  amount: number | string;
  created_at?: string;
  note?: string | null;
  order_id?: string | null;
};

export type CreditAccount = {
  id: string;
  customer_id: string;
  store_id?: string;
  balance: number | string;
  stores?: { name?: string | null } | null;
  credit_transactions?: CreditTx[];
};

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * الرصيد المتوقع من دفتر القيود: مديونية معتمدة تُضاف، وسداد معتمد يُخصم (بحدّ أدنى صفر).
 * لا فوائد ولا غرامات تأخير — أي مبلغ إضافي يعني خللاً.
 */
export function expectedBalance(txs: CreditTx[] = []): number {
  return txs
    .filter((t) => t.status === "approved")
    .slice()
    .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
    .reduce((bal, t) => (t.type === "charge" ? bal + num(t.amount) : Math.max(0, bal - num(t.amount))), 0);
}

/** يطابق رصيد الحساب مع مجموع قيوده المعتمدة */
export function isLedgerConsistent(account: CreditAccount): boolean {
  return expectedBalance(account.credit_transactions ?? []) === num(account.balance);
}

export function totalDebt(accounts: CreditAccount[] = []): number {
  return accounts.reduce((s, a) => s + num(a.balance), 0);
}

export type PendingCharge = CreditTx & { accountId: string; storeName?: string | null };

/** المديونيات المعلّقة التي تنتظر موافقة العميل */
export function pendingCharges(accounts: CreditAccount[] = []): PendingCharge[] {
  return accounts.flatMap((a) =>
    (a.credit_transactions ?? [])
      .filter((t) => t.status === "pending" && t.type === "charge")
      .map((t) => ({ ...t, accountId: a.id, storeName: a.stores?.name ?? null })),
  );
}

export function pendingCount(account: CreditAccount): number {
  return (account.credit_transactions ?? []).filter((t) => t.status === "pending").length;
}

/** العميل يردّ فقط على قيد معلّق في حسابه هو */
export function canCustomerRespond(tx: CreditTx, account: CreditAccount, userId: string): boolean {
  return tx.status === "pending" && !!userId && account.customer_id === userId;
}

/** التاجر يلغي القيود المعلّقة فقط — المعتمد يُصحَّح بقيد سداد مقابل */
export function canMerchantCancel(tx: CreditTx): boolean {
  return tx.status === "pending";
}

/** الأثر المتوقع لردّ العميل على الرصيد */
export function balanceAfterResponse(current: number | string, tx: CreditTx, approve: boolean): number {
  const base = num(current);
  if (tx.status !== "pending" || !approve) return base;
  return tx.type === "charge" ? base + num(tx.amount) : Math.max(0, base - num(tx.amount));
}
