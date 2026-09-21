import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { bootTestApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string, merchant: string, customer: string, storeId: string, productId: string;

beforeAll(async () => {
  t = await bootTestApp();
  await t.seedSuperAdmin("770000000", "admin123");
  await t.register({ phone: "773000001", password: "secret1", name: "بقالة", user_type: "merchant", business_name: "بقالة الاختبار" });
  await t.register({ phone: "774000001", password: "secret1", name: "عميل", user_type: "customer" });
});
afterAll(async () => { await t?.close(); });

describe("auth", () => {
  it("pending accounts cannot log in; active ones can", async () => {
    const r = await t.http().post("/api/auth/login").send({ phone: "774000001", password: "secret1" });
    expect(r.status).toBe(403); expect(r.body.error).toBe("account_pending");
    await t.activate("773000001"); await t.activate("774000001");
    admin = (await t.login("770000000", "admin123")).access_token;
    const m = await t.login("773000001", "secret1"); merchant = m.access_token; storeId = m.user.store_id!;
    customer = (await t.login("774000001", "secret1")).access_token;
    expect(storeId).toBeTruthy();
  });
  it("refresh rotation detects reuse", async () => {
    const first = await t.login("774000001", "secret1");
    const r1 = await t.http().post("/api/auth/refresh").set("x-client", "mobile").send({ refresh_token: first.refresh_token });
    expect(r1.status).toBe(200);
    const replay = await t.http().post("/api/auth/refresh").set("x-client", "mobile").send({ refresh_token: first.refresh_token });
    expect(replay.status).toBe(401); expect(replay.body.error).toBe("token_reused");
    const dead = await t.http().post("/api/auth/refresh").set("x-client", "mobile").send({ refresh_token: r1.body.refresh_token });
    expect(dead.status).toBe(401);
  });
  it("web client gets an httpOnly cookie", async () => {
    const r = await t.http().post("/api/auth/login").send({ phone: "774000001", password: "secret1" });
    expect(r.headers["set-cookie"]?.[0]).toMatch(/wasl_refresh=.*HttpOnly/);
    expect(r.body.refresh_token).toBeUndefined();
  });
});

describe("guards", () => {
  it("customer cannot reach merchant or admin routes", async () => {
    expect((await t.http().get("/api/merchant/orders").set("authorization", `Bearer ${customer}`)).status).toBe(403);
    expect((await t.http().get("/api/admin/overview").set("authorization", `Bearer ${customer}`)).status).toBe(403);
    expect((await t.http().get("/api/me/profile")).status).toBe(401);
  });
});

describe("orders and money", () => {
  it("merchant creates a product; checkout uses server prices", async () => {
    const p = await t.http().post("/api/merchant/products").set("authorization", `Bearer ${merchant}`).send({ name: "حليب", price: 900 });
    expect(p.status).toBe(201); productId = p.body.id;
    const o = await t.http().post("/api/orders").set("authorization", `Bearer ${customer}`).send({ store_id: storeId, items: [{ product_id: productId, qty: 2, price: 1 }], payment_method: "cash", location: { landmark: "x" } });
    expect(o.status).toBe(201); expect(Number(o.body.total)).toBe(1800); expect(o.body.status).toBe("sent");
  });
  it("wallet order needs balance; admin top-up approval applies once", async () => {
    const insufficient = await t.http().post("/api/orders").set("authorization", `Bearer ${customer}`).send({ store_id: storeId, items: [{ product_id: productId, qty: 1 }], payment_method: "wallet", location: { landmark: "x" } });
    expect(insufficient.status).toBe(422); expect(insufficient.body.error).toBe("wallet_insufficient");
    const topup = await t.http().post("/api/me/wallet/topups").set("authorization", `Bearer ${customer}`).send({ amount: 2000, method: "jeeb", reference: "T1" });
    expect(topup.body.status).toBe("pending");
    const ok = await t.http().post(`/api/admin/wallets/transactions/${topup.body.id}/respond`).set("authorization", `Bearer ${admin}`).send({ approve: true });
    expect(ok.status).toBe(201);
    const again = await t.http().post(`/api/admin/wallets/transactions/${topup.body.id}/respond`).set("authorization", `Bearer ${admin}`).send({ approve: true });
    expect(again.status).toBe(409);
    const paid = await t.http().post("/api/orders").set("authorization", `Bearer ${customer}`).send({ store_id: storeId, items: [{ product_id: productId, qty: 1 }], payment_method: "wallet", location: { landmark: "x" } });
    expect(paid.body.status).toBe("delivered");
    const w = await t.http().get("/api/me/wallet").set("authorization", `Bearer ${customer}`);
    expect(w.body.balance).toBe(1100);
  });
  it("credit: merchant approval charges, repayment reduces, ledger consistent", async () => {
    const o = await t.http().post("/api/orders").set("authorization", `Bearer ${customer}`).send({ store_id: storeId, items: [{ product_id: productId, qty: 1 }], payment_method: "credit", location: { landmark: "x" } });
    expect(o.body.creditStatus).toBe("pending");
    const blocked = await t.http().patch(`/api/merchant/orders/${o.body.id}/status`).set("authorization", `Bearer ${merchant}`).send({ status: "accepted" });
    expect(blocked.status).toBe(422);
    const dec = await t.http().post(`/api/merchant/orders/${o.body.id}/credit-decision`).set("authorization", `Bearer ${merchant}`).send({ approve: true });
    expect(dec.body.creditStatus).toBe("approved");
    const acc = (await t.http().get("/api/merchant/credit/accounts").set("authorization", `Bearer ${merchant}`)).body[0];
    expect(Number(acc.balance)).toBe(900);
    await t.http().post(`/api/merchant/credit/accounts/${acc.id}/transactions`).set("authorization", `Bearer ${merchant}`).send({ type: "payment", amount: 400 });
    const ledger = (await t.http().get("/api/me/credit").set("authorization", `Bearer ${customer}`)).body[0];
    expect(ledger.balance).toBe(500); expect(ledger.ledger_consistent).toBe(true);
    const { rows } = await t.sql.query("select count(*)::int as n from credit_transactions where status='approved'");
    expect(rows[0].n).toBe(2);
  });
  it("status machine rejects skips and customers can only cancel while sent", async () => {
    const o = await t.http().post("/api/orders").set("authorization", `Bearer ${customer}`).send({ store_id: storeId, items: [{ product_id: productId, qty: 1 }], payment_method: "cash", location: { landmark: "x" } });
    expect((await t.http().patch(`/api/merchant/orders/${o.body.id}/status`).set("authorization", `Bearer ${merchant}`).send({ status: "delivered" })).status).toBe(422);
    expect((await t.http().patch(`/api/merchant/orders/${o.body.id}/status`).set("authorization", `Bearer ${merchant}`).send({ status: "accepted" })).body.status).toBe("accepted");
    expect((await t.http().post(`/api/me/orders/${o.body.id}/cancel`).set("authorization", `Bearer ${customer}`)).status).toBe(422);
  });
});

describe("POS ingestion", () => {
  it("is idempotent per client op id and rejects unknown products", async () => {
    const env = { op_id: randomUUID(), order: { id: randomUUID(), payment_method: "cash", created_at: new Date().toISOString() }, items: [{ product_id: productId, name: "حليب", price: 900, qty: 3 }] };
    const first = await t.http().post("/api/merchant/pos/sales").set("authorization", `Bearer ${merchant}`).send(env);
    expect(first.status).toBe(201); expect(first.body.total).toBe(2700);
    const replay = await t.http().post("/api/merchant/pos/sales").set("authorization", `Bearer ${merchant}`).send(env);
    expect(replay.status).toBe(200); expect(replay.body.replay).toBe(true);
    const { rows } = await t.sql.query("select count(*)::int as n from orders where id=$1", [env.order.id]);
    expect(rows[0].n).toBe(1);
    const bad = await t.http().post("/api/merchant/pos/sales").set("authorization", `Bearer ${merchant}`).send({ ...env, op_id: randomUUID(), order: { ...env.order, id: randomUUID() }, items: [{ product_id: randomUUID(), name: "x", price: 1, qty: 1 }] });
    expect(bad.status).toBe(422); expect(bad.body.error).toBe("product_unknown");
  });
});

describe("admin", () => {
  it("staff with a bundle carries perms and is blocked elsewhere", async () => {
    const s = await t.http().post("/api/admin/staff").set("authorization", `Bearer ${admin}`).send({ phone: "775000001", password: "staff123", name: "محاسب", role: "finance" });
    expect(s.status).toBe(201);
    await t.http().post("/api/admin/permissions/grant").set("authorization", `Bearer ${admin}`).send({ user_id: s.body.id, perm: "wallets.manage", grant: true });
    await t.sql.query("update users set force_password_change=false where phone='775000001'");
    const staff = (await t.login("775000001", "staff123")).access_token;
    expect((await t.http().get("/api/admin/wallets/transactions").set("authorization", `Bearer ${staff}`)).status).toBe(200);
    expect((await t.http().post("/api/admin/users").set("authorization", `Bearer ${staff}`).send({ phone: "776000001", password: "x12345", name: "xx", user_type: "customer" })).status).toBe(403);
    expect((await t.http().get("/api/admin/permissions/catalog").set("authorization", `Bearer ${staff}`)).status).toBe(403);
  });
  it("mutations are audited", async () => {
    const { rows } = await t.sql.query("select count(*)::int as n from audit_logs");
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
