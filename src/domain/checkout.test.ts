import { describe, it, expect } from "vitest";
import type { CartItem } from "@/domain/cart";
import {
  cartTotal,
  isExternalWallet,
  toDbPaymentMethod,
  buildOrderNote,
  validateCheckout,
  buildOrderRow,
  buildOrderItems,
  type PayMethod,
} from "@/domain/checkout";

const items: CartItem[] = [
  { productId: "p1", name: "أرز", price: 1500, qty: 2 },
  { productId: "p2", name: "سكر", price: 800, qty: 3 },
];
const TOTAL = 1500 * 2 + 800 * 3; // 5400

const base = {
  storeId: "store-1",
  items,
  landmark: "بجانب الجامع الأزرق",
  payment: "cash" as PayMethod,
  walletBalance: 0,
};

describe("الدفع — حساب الإجمالي", () => {
  it("يحسب الإجمالي من السعر × الكمية", () => {
    expect(cartTotal(items)).toBe(TOTAL);
  });
  it("سلة فارغة = صفر", () => {
    expect(cartTotal([])).toBe(0);
  });
});

describe("الدفع — تصنيف طرق الدفع", () => {
  it("المحافظ الخارجية تُصنَّف صحيحاً", () => {
    expect(isExternalWallet("jeeb")).toBe(true);
    expect(isExternalWallet("jawali")).toBe(true);
    expect(isExternalWallet("hasab")).toBe(true);
    expect(isExternalWallet("onecash")).toBe(true);
  });
  it("النقد والأجل ومحفظة التطبيق ليست محافظ خارجية", () => {
    expect(isExternalWallet("cash")).toBe(false);
    expect(isExternalWallet("credit")).toBe(false);
    expect(isExternalWallet("wallet")).toBe(false);
  });
  it("محفظة التطبيق تُخزَّن في القاعدة كـ wallet (أُضيفت القيمة إلى enum في الترحيل)", () => {
    expect(toDbPaymentMethod("wallet")).toBe("wallet");
  });
  it("بقية الطرق تُخزَّن كما هي", () => {
    (["cash", "credit", "jeeb", "jawali", "hasab", "onecash"] as PayMethod[]).forEach((m) => {
      expect(toDbPaymentMethod(m)).toBe(m);
    });
  });
});

describe("الدفع — التحقق قبل إرسال الطلب", () => {
  it("يرفض السلة الفارغة", () => {
    expect(validateCheckout({ ...base, items: [] })).toEqual({ ok: false, error: "سلتك فارغة" });
  });
  it("يرفض غياب البقالة", () => {
    const r = validateCheckout({ ...base, storeId: null });
    expect(r.ok).toBe(false);
  });
  it("يرفض وصف موقع فارغ أو مسافات فقط", () => {
    expect(validateCheckout({ ...base, landmark: "" }).ok).toBe(false);
    expect(validateCheckout({ ...base, landmark: "   " }).ok).toBe(false);
  });
  it("يرفض الدفع من المحفظة عند عدم كفاية الرصيد", () => {
    const r = validateCheckout({ ...base, payment: "wallet", walletBalance: TOTAL - 1 });
    expect(r).toEqual({ ok: false, error: "رصيد المحفظة غير كافٍ" });
  });
  it("يقبل الدفع من المحفظة عند تساوي الرصيد مع الإجمالي", () => {
    expect(validateCheckout({ ...base, payment: "wallet", walletBalance: TOTAL }).ok).toBe(true);
  });
  it("يتعامل مع الرصيد النصي القادم من القاعدة", () => {
    expect(validateCheckout({ ...base, payment: "wallet", walletBalance: "5400" }).ok).toBe(true);
    expect(validateCheckout({ ...base, payment: "wallet", walletBalance: null }).ok).toBe(false);
  });
  it("لا يفرض رصيد المحفظة على الدفع نقداً أو بالأجل", () => {
    expect(validateCheckout({ ...base, payment: "cash", walletBalance: 0 }).ok).toBe(true);
    expect(validateCheckout({ ...base, payment: "credit", walletBalance: 0 }).ok).toBe(true);
  });
  it("يقبل الطلب السليم", () => {
    expect(validateCheckout(base)).toEqual({ ok: true });
  });
});

describe("الدفع — ملاحظة الطلب", () => {
  it("نقداً بلا ملاحظة = null", () => {
    expect(buildOrderNote({ payment: "cash" })).toBeNull();
  });
  it("محفظة خارجية مع رقم عملية", () => {
    expect(buildOrderNote({ payment: "jawali", walletRef: "TXN123" })).toBe(
      "محفظة جوالي • رقم العملية: TXN123",
    );
  });
  it("محفظة خارجية بلا رقم عملية", () => {
    expect(buildOrderNote({ payment: "jeeb" })).toBe("دفع عبر جيب");
  });
  it("محفظة التطبيق تُوسم في الملاحظة", () => {
    expect(buildOrderNote({ payment: "wallet" })).toBe("دفع من محفظة التطبيق");
  });
  it("تدمج ملاحظة العميل مع بيانات الدفع", () => {
    expect(buildOrderNote({ payment: "onecash", walletRef: "A1", note: "اتركه عند الباب" })).toBe(
      "محفظة ون كاش • رقم العملية: A1 — اتركه عند الباب",
    );
  });
});

describe("الدفع — بناء صف الطلب", () => {
  const row = (payment: PayMethod, extra: Record<string, unknown> = {}) =>
    buildOrderRow({
      customerId: "u1",
      storeId: "store-1",
      items,
      payment,
      landmark: "بجانب الجامع",
      phone: "771234567",
      ...extra,
    });

  it("الإجمالي في الصف يطابق مجموع الأصناف (لا تلاعب بالمبلغ)", () => {
    const r = row("cash");
    const sum = buildOrderItems("o1", items).reduce((s, i) => s + i.price * i.qty, 0);
    expect(r.total).toBe(sum);
    expect(r.total).toBe(TOTAL);
  });

  it("الأجل يبدأ بحالة انتظار موافقة", () => {
    const r = row("credit");
    expect(r.credit_status).toBe("pending");
    expect(r.payment_method).toBe("credit");
    expect(r.status).toBe("sent");
  });

  it("غير الأجل بلا حالة أجل", () => {
    expect(row("cash").credit_status).toBeNull();
    expect(row("jeeb").credit_status).toBeNull();
    expect(row("wallet").credit_status).toBeNull();
  });

  it("طلب محفظة التطبيق يُخزَّن wallet ويبدأ بحالة مرسل ليصل للتاجر", () => {
    const r = row("wallet");
    expect(r.payment_method).toBe("wallet");
    expect(r.status).toBe("sent");
  });

  it("رقم تواصل فارغ يُخزَّن null", () => {
    expect(row("cash", { phone: "" }).location_phone).toBeNull();
  });

  it("أصناف الطلب مرتبطة بالمنتجات ومطابقة للسلة", () => {
    const rows = buildOrderItems("order-9", items);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ order_id: "order-9", product_id: "p1", price: 1500, qty: 2 });
    expect(rows.every((r) => !!r.product_id)).toBe(true);
  });
});
