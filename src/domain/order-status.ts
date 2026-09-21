import type { OrderStatus } from "./types";

/**
 * Merchant-driven order lifecycle (was implicit in merchant.orders.tsx buttons):
 *   sent → accepted | declined ; accepted → preparing | declined ; preparing → out_for_delivery ; out_for_delivery → delivered
 * Customers may only cancel while the order is still `sent`.
 */
export const MERCHANT_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  sent: ["accepted", "declined"],
  accepted: ["preparing", "declined"],
  preparing: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: [],
  declined: [],
  cancelled: [],
};
export function canMerchantTransition(from: OrderStatus, to: OrderStatus): boolean {
  return MERCHANT_TRANSITIONS[from]?.includes(to) ?? false;
}
export function canCustomerCancel(status: OrderStatus): boolean {
  return status === "sent";
}
export function canRequestReturn(status: OrderStatus, returnStatus: string): boolean {
  return status === "delivered" && returnStatus === "none";
}
export function canRate(status: OrderStatus): boolean {
  return status === "delivered";
}
