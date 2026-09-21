import { describe, it, expect } from "vitest";
import {
  expectedBalance,
  isLedgerConsistent,
  totalDebt,
  pendingCharges,
  pendingCount,
  canCustomerRespond,
  canMerchantCancel,
  balanceAfterResponse,
  type CreditAccount,
  type CreditTx,
} from "@/domain/credit-rules";

let seq = 0;
const tx = (
  type: CreditTx["type"],
  amount: number,
  status: CreditTx["status"] = "approved",
): CreditTx => ({
  id: `t${++seq}`,
  type,
  amount,
  status,
  created_at: new Date(2026, 0, 1, 0, seq).toISOString(),
});

const account = (over: Partial<CreditAccount> = {}): CreditAccount => ({
  id: "acc-1",
  customer_id: "cust-1",
  balance: 0,
  stores: { name: "بقالة الحي" },
  credit_transactions: [],
  ...over,
});

describe("الأجل — قاعدة عدم الفائدة", () => {
  it("مديونية معتمدة تُضاف بمبلغها الاسمي فقط", () => {
    expect(expectedBalance([tx("charge", 10000)])).toBe(10000);
  });

  it("السداد يخصم بمبلغه الاسمي فقط", () => {
    expect(expectedBalance([tx("charge", 10000), tx("payment", 4000)])).toBe(6000);
  });

  it("سداد كامل يصفّر الدين — بلا رسوم متبقية", () => {
    expect(expectedBalance([tx("charge", 10000), tx("payment", 10000)])).toBe(0);
  });

  it("السداد الزائد لا ينتج رصيداً سالباً", () => {
    expect(expectedBalance([tx("charge", 5000), tx("payment", 8000)])).toBe(0);
  });

  it("مرور الوقت لا يزيد الدين (لا غرامة تأخير)", () => {
    const old: CreditTx = { id: "old", type: "charge", amount: 7000, status: "approved", created_at: "2020-01-01T00:00:00Z" };
    expect(expectedBalance([old])).toBe(7000);
  });

  it("الدين النهائي = مجموع المديونيات ناقص السدادات بالضبط", () => {
    const txs = [tx("charge", 3000), tx("charge", 2500), tx("payment", 1500), tx("charge", 1000)];
    expect(expectedBalance(txs)).toBe(3000 + 2500 - 1500 + 1000);
  });
});

describe("الأجل — القيود غير المعتمدة لا تُحتسب", () => {
  it("المديونية المعلّقة لا تُضاف قبل موافقة العميل", () => {
    expect(expectedBalance([tx("charge", 9000, "pending")])).toBe(0);
  });

  it("المديونية المرفوضة لا تُضاف أبداً", () => {
    expect(expectedBalance([tx("charge", 9000, "rejected")])).toBe(0);
  });

  it("يخلط المعتمد وغير المعتمد بشكل صحيح", () => {
    const txs = [tx("charge", 5000), tx("charge", 3000, "pending"), tx("charge", 2000, "rejected")];
    expect(expectedBalance(txs)).toBe(5000);
  });
});

describe("الأجل — تطابق الرصيد مع الدفتر", () => {
  it("رصيد مطابق يمرّ", () => {
    const a = account({ balance: 6000, credit_transactions: [tx("charge", 10000), tx("payment", 4000)] });
    expect(isLedgerConsistent(a)).toBe(true);
  });

  it("يكتشف رصيداً منتفخاً (فائدة مضافة)", () => {
    const a = account({ balance: 6600, credit_transactions: [tx("charge", 10000), tx("payment", 4000)] });
    expect(isLedgerConsistent(a)).toBe(false);
  });

  it("يقبل الأرقام النصية القادمة من القاعدة", () => {
    const a = account({ balance: "6000", credit_transactions: [tx("charge", 10000), tx("payment", 4000)] });
    expect(isLedgerConsistent(a)).toBe(true);
  });
});

describe("الأجل — الإجماليات وطلبات الموافقة", () => {
  it("إجمالي الديون يجمع كل الحسابات", () => {
    expect(totalDebt([account({ balance: 1000 }), account({ id: "a2", balance: "2500" })])).toBe(3500);
  });

  it("إجمالي بلا حسابات = صفر", () => {
    expect(totalDebt([])).toBe(0);
    expect(totalDebt(undefined)).toBe(0);
  });

  it("يستخرج المديونيات المعلّقة فقط مع اسم البقالة", () => {
    const a = account({
      credit_transactions: [tx("charge", 1000, "pending"), tx("payment", 500, "pending"), tx("charge", 700)],
    });
    const p = pendingCharges([a]);
    expect(p).toHaveLength(1);
    expect(p[0].amount).toBe(1000);
    expect(p[0].storeName).toBe("بقالة الحي");
    expect(p[0].accountId).toBe("acc-1");
  });

  it("عدّاد المعلّق يشمل المديونيات والسدادات المعلّقة", () => {
    const a = account({ credit_transactions: [tx("charge", 1000, "pending"), tx("payment", 500, "pending"), tx("charge", 700)] });
    expect(pendingCount(a)).toBe(2);
  });
});

describe("الأجل — صلاحيات الموافقة والإلغاء", () => {
  const a = account({ customer_id: "cust-1" });

  it("صاحب الحساب يردّ على قيد معلّق", () => {
    expect(canCustomerRespond(tx("charge", 100, "pending"), a, "cust-1")).toBe(true);
  });

  it("عميل آخر لا يردّ", () => {
    expect(canCustomerRespond(tx("charge", 100, "pending"), a, "cust-2")).toBe(false);
  });

  it("لا ردّ بلا جلسة", () => {
    expect(canCustomerRespond(tx("charge", 100, "pending"), a, "")).toBe(false);
  });

  it("لا ردّ مرتين على نفس القيد", () => {
    expect(canCustomerRespond(tx("charge", 100, "approved"), a, "cust-1")).toBe(false);
    expect(canCustomerRespond(tx("charge", 100, "rejected"), a, "cust-1")).toBe(false);
  });

  it("التاجر يلغي المعلّق فقط", () => {
    expect(canMerchantCancel(tx("charge", 100, "pending"))).toBe(true);
    expect(canMerchantCancel(tx("charge", 100, "approved"))).toBe(false);
  });
});

describe("الأجل — أثر ردّ العميل على الرصيد", () => {
  it("الموافقة على مديونية تزيد الرصيد بمبلغها", () => {
    expect(balanceAfterResponse(2000, tx("charge", 500, "pending"), true)).toBe(2500);
  });
  it("الرفض لا يغيّر الرصيد", () => {
    expect(balanceAfterResponse(2000, tx("charge", 500, "pending"), false)).toBe(2000);
  });
  it("قيد غير معلّق لا أثر له", () => {
    expect(balanceAfterResponse(2000, tx("charge", 500, "approved"), true)).toBe(2000);
  });
  it("الموافقة على سداد تخصم بحدّ أدنى صفر", () => {
    expect(balanceAfterResponse(300, tx("payment", 500, "pending"), true)).toBe(0);
  });
});
