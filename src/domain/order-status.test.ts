import { describe, it, expect } from "vitest";
import { canCustomerCancel, canMerchantTransition, canRate, canRequestReturn } from "@/domain/order-status";

describe("order status machine", () => {
  it("happy path", () => {
    expect(canMerchantTransition("sent", "accepted")).toBe(true);
    expect(canMerchantTransition("accepted", "preparing")).toBe(true);
    expect(canMerchantTransition("preparing", "out_for_delivery")).toBe(true);
    expect(canMerchantTransition("out_for_delivery", "delivered")).toBe(true);
  });
  it("no skipping, no going back, terminal states are final", () => {
    expect(canMerchantTransition("sent", "delivered")).toBe(false);
    expect(canMerchantTransition("preparing", "sent")).toBe(false);
    expect(canMerchantTransition("delivered", "declined")).toBe(false);
    expect(canMerchantTransition("cancelled", "accepted")).toBe(false);
  });
  it("decline only before preparation starts", () => {
    expect(canMerchantTransition("sent", "declined")).toBe(true);
    expect(canMerchantTransition("accepted", "declined")).toBe(true);
    expect(canMerchantTransition("preparing", "declined")).toBe(false);
  });
  it("customer rules", () => {
    expect(canCustomerCancel("sent")).toBe(true);
    expect(canCustomerCancel("accepted")).toBe(false);
    expect(canRequestReturn("delivered", "none")).toBe(true);
    expect(canRequestReturn("delivered", "requested")).toBe(false);
    expect(canRequestReturn("sent", "none")).toBe(false);
    expect(canRate("delivered")).toBe(true);
    expect(canRate("sent")).toBe(false);
  });
});
