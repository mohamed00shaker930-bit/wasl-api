import type { CartItem } from "./cart";

export type PayMethod = "cash" | "credit" | "wallet" | "jeeb" | "jawali" | "hasab" | "onecash";
/** Since the migration the DB enum payment_method includes 'wallet'; kept as an alias for readability. */
export type DbPayMethod = PayMethod;

export const EXTERNAL_WALLETS: { id: PayMethod; name: string; color: string; short: string }[] = [
  { id: "jeeb", name: "جيب", color: "#7C3AED", short: "ج" },
  { id: "jawali", name: "جوالي", color: "#EA580C", short: "ج" },
  { id: "hasab", name: "حساب", color: "#0891B2", short: "ح" },
  { id: "onecash", name: "ون كاش", color: "#16A34A", short: "1" },
];

export function cartTotal(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.price * i.qty, 0);
}

/** محفظة خارجية = تحويل يدوي يحتاج رقم عملية مرجعي */
export function isExternalWallet(m: PayMethod): boolean {
  return m !== "cash" && m !== "credit" && m !== "wallet";
}

/** Was a wallet→cash mapping while the Supabase enum lacked 'wallet'; the enum now has it, so this is the identity. */
export function toDbPaymentMethod(m: PayMethod): DbPayMethod {
  return m;
}

export function buildOrderNote(input: { payment: PayMethod; walletRef?: string; note?: string }): string | null {
  const { payment, walletRef, note } = input;
  const walletName = EXTERNAL_WALLETS.find((w) => w.id === payment)?.name;
  const parts = [
    isExternalWallet(payment)
      ? (walletRef ? `محفظة ${walletName} • رقم العملية: ${walletRef}` : `دفع عبر ${walletName}`)
      : null,
    payment === "wallet" ? "دفع من محفظة التطبيق" : null,
    note || null,
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(" — ") : null;
}

export type CheckoutValidation = { ok: true } | { ok: false; error: string };

export function validateCheckout(input: {
  storeId: string | null;
  items: CartItem[];
  landmark: string;
  payment: PayMethod;
  walletBalance?: number | string | null;
}): CheckoutValidation {
  if (!input.items.length) return { ok: false, error: "سلتك فارغة" };
  if (!input.storeId) return { ok: false, error: "لم يتم تحديد البقالة" };
  if (!input.landmark.trim()) return { ok: false, error: "اكتب وصف موقع التوصيل" };
  const total = cartTotal(input.items);
  if (!(total > 0)) return { ok: false, error: "قيمة الطلب غير صحيحة" };
  if (input.payment === "wallet" && Number(input.walletBalance ?? 0) < total) {
    return { ok: false, error: "رصيد المحفظة غير كافٍ" };
  }
  return { ok: true };
}

export function buildOrderRow(input: {
  customerId: string;
  storeId: string;
  items: CartItem[];
  payment: PayMethod;
  landmark: string;
  phone?: string;
  note?: string;
  walletRef?: string;
}) {
  return {
    customer_id: input.customerId,
    store_id: input.storeId,
    total: cartTotal(input.items),
    payment_method: toDbPaymentMethod(input.payment),
    credit_status: input.payment === "credit" ? "pending" : null,
    status: input.payment === "wallet" ? "delivered" : "sent",
    note: buildOrderNote({ payment: input.payment, walletRef: input.walletRef, note: input.note }),
    location_landmark: input.landmark,
    location_phone: input.phone || null,
  };
}

export function buildOrderItems(orderId: string, items: CartItem[]) {
  return items.map((i) => ({
    order_id: orderId,
    product_id: i.productId,
    name: i.name,
    price: i.price,
    qty: i.qty,
    note: i.note || null,
  }));
}
