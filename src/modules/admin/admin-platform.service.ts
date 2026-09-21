import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { DbService } from "@/db/db.module";
import { adminPermissions, appSettings, appUsageLog, auditLogs, authSessionsLog, banners, businessCategories, notifications, orders, permissionBundleItems, permissionBundles, permissionDefs, profiles, stores, userRoles, walletTransactions } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import type { Claims } from "@/common/auth";
import { AuditService } from "@/common/audit/audit.service";
import { WalletService } from "@/modules/wallet/wallet.service";
import { num } from "@/domain/money";
import type { BroadcastDto, OrdersFilterDto, SendNotificationDto, StatusFilterDto } from "./dto";

/** Stores, wallets, settings, notifications, permissions, content, oversight, overview — the remaining admin_* RPCs. */
@Injectable()
export class AdminPlatformService {
  constructor(private dbs: DbService, private audit: AuditService, private wallet: WalletService) {}

  // ---------- overview (admin.index.tsx) ----------
  async overview() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [u] = await this.dbs.db.select({ users: sql<number>`count(*)::int`, pending: sql<number>`count(*) filter (where ${profiles.accountStatus} = 'pending')::int` }).from(profiles);
    const [m] = await this.dbs.db.select({ merchants: sql<number>`count(distinct user_id)::int` }).from(userRoles).where(eq(userRoles.role, "merchant"));
    const [s] = await this.dbs.db.select({ active: sql<number>`count(*) filter (where status = 'active')::int`, pending: sql<number>`count(*) filter (where status = 'pending')::int` }).from(stores);
    const [o] = await this.dbs.db.select({ today: sql<number>`count(*) filter (where ${orders.createdAt} >= ${start})::int`, todayTotal: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.createdAt} >= ${start}), 0)`,
      todayCommission: sql<string>`coalesce(sum(${orders.commissionAmount}) filter (where ${orders.createdAt} >= ${start}), 0)`, returns: sql<number>`count(*) filter (where ${orders.returnStatus} = 'requested')::int` }).from(orders);
    return { users: u.users, pending_accounts: u.pending, merchants: m.merchants, stores_active: s.active, stores_pending: s.pending, orders_today: o.today,
      sales_today: num(o.todayTotal), commission_today: num(o.todayCommission), pending_wallet_tx: await this.wallet.pendingCount(), returns_requested: o.returns };
  }

  // ---------- stores ----------
  listStores(status?: string) {
    return this.dbs.db.select({ s: stores, ownerName: profiles.name, ownerPhone: profiles.phone, categoryName: businessCategories.nameAr }).from(stores)
      .leftJoin(profiles, eq(profiles.id, stores.ownerId)).leftJoin(businessCategories, eq(businessCategories.id, stores.businessCategoryId))
      .where(status ? eq(stores.status, status as "active") : undefined).orderBy(desc(stores.createdAt)).limit(500);
  }
  async setStoreStatus(actor: Claims, id: string, status: "pending" | "active" | "suspended" | "rejected") {
    const [s] = await this.dbs.db.update(stores).set({ status, ...(status !== "active" && { isOpen: false }) }).where(eq(stores.id, id)).returning();
    if (!s) throw new AppError("not_found");
    await this.audit.log(actor, { action: "set_store_status", table: "stores", recordId: id, recordLabel: s.name, newData: { status } });
    return s;
  }
  async setStoreCommission(actor: Claims, id: string, pct: number) {
    const [s] = await this.dbs.db.update(stores).set({ commissionPct: pct.toFixed(2) }).where(eq(stores.id, id)).returning();
    if (!s) throw new AppError("not_found");
    await this.audit.log(actor, { action: "set_store_commission", table: "stores", recordId: id, recordLabel: s.name, newData: { commission_pct: pct } });
    return s;
  }
  async setStoreCategory(actor: Claims, id: string, categoryId: string | null) {
    const [s] = await this.dbs.db.update(stores).set({ businessCategoryId: categoryId }).where(eq(stores.id, id)).returning();
    if (!s) throw new AppError("not_found");
    await this.audit.log(actor, { action: "set_store_category", table: "stores", recordId: id, recordLabel: s.name, newData: { business_category_id: categoryId } });
    return s;
  }

  // ---------- orders (read-only, admin.orders.tsx / analytics export) ----------
  async listOrders(q: OrdersFilterDto) {
    return this.dbs.db.select({ o: orders, storeName: stores.name }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
      .where(and(q.status ? eq(orders.status, q.status as "sent") : undefined, q.store_id ? eq(orders.storeId, q.store_id) : undefined,
        q.from ? gte(orders.createdAt, new Date(q.from)) : undefined, q.to ? lte(orders.createdAt, new Date(q.to)) : undefined))
      .orderBy(desc(orders.createdAt)).limit(q.limit);
  }

  // ---------- wallets ----------
  listWalletTx(status?: string, limit = 100) {
    return this.dbs.db.select({ t: walletTransactions, userName: profiles.name, userPhone: profiles.phone }).from(walletTransactions).leftJoin(profiles, eq(profiles.id, walletTransactions.userId))
      .where(status ? eq(walletTransactions.status, status as "pending") : undefined).orderBy(desc(walletTransactions.createdAt)).limit(limit);
  }
  async respondWalletTx(actor: Claims, id: string, approve: boolean) {
    return this.dbs.withTx(async (tx) => {
      const row = await this.wallet.respond(tx, id, approve);
      await this.audit.log(actor, { action: approve ? "approve_wallet_tx" : "reject_wallet_tx", table: "wallet_transactions", recordId: id, newData: { amount: row.amount, type: row.type } }, tx);
      return row;
    });
  }

  // ---------- settings ----------
  settings() { return this.dbs.db.select().from(appSettings).orderBy(asc(appSettings.key)); }
  async setSetting(actor: Claims, key: string, value: unknown) {
    const [row] = await this.dbs.db.insert(appSettings).values({ key, value, updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } }).returning();
    await this.audit.log(actor, { action: "set_setting", table: "app_settings", recordId: key, newData: { value } });
    return row;
  }

  // ---------- notifications ----------
  async send(actor: Claims, d: SendNotificationDto) {
    const [n] = await this.dbs.db.insert(notifications).values({ userId: d.user_id, title: d.title, body: d.body, link: d.link ?? null, type: d.type }).returning();
    await this.audit.log(actor, { action: "send_notification", table: "notifications", recordId: n.id, newData: { user_id: d.user_id, title: d.title } });
    return n;
  }
  /** admin_broadcast_notification: segment resolved on users+user_roles (no auth.users any more). Returns the recipient count. */
  async broadcast(actor: Claims, d: BroadcastDto) {
    const roleFilter = d.segment === "customers" ? sql`exists (select 1 from ${userRoles} r where r.user_id = profiles.id and r.role = 'customer') and not exists (select 1 from ${userRoles} r where r.user_id = profiles.id and r.role = 'merchant')`
      : d.segment === "merchants" ? sql`exists (select 1 from ${userRoles} r where r.user_id = profiles.id and r.role = 'merchant')` : sql`true`;
    const targets = await this.dbs.db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.accountStatus, "active"), roleFilter));
    if (targets.length) await this.dbs.db.insert(notifications).values(targets.map((t) => ({ userId: t.id, title: d.title, body: d.body, link: d.link ?? null, type: "broadcast" })));
    await this.audit.log(actor, { action: "broadcast", table: "notifications", newData: { segment: d.segment, title: d.title, recipients: targets.length } });
    return { recipients: targets.length };
  }
  /** admin.notifications.tsx oversight: latest notifications of everyone with the owner's name. */
  allNotifications(search?: string, limit = 100) {
    return this.dbs.db.select({ n: notifications, userName: profiles.name, userPhone: profiles.phone }).from(notifications).leftJoin(profiles, eq(profiles.id, notifications.userId))
      .where(search ? or(ilike(notifications.title, `%${search}%`), ilike(profiles.name, `%${search}%`), ilike(profiles.phone, `%${search}%`)) : undefined).orderBy(desc(notifications.createdAt)).limit(limit);
  }

  // ---------- permissions (super only) ----------
  async permissionCatalog() {
    const defs = await this.dbs.db.select().from(permissionDefs).orderBy(asc(permissionDefs.sort));
    const bundles = await this.dbs.db.select().from(permissionBundles).orderBy(asc(permissionBundles.sort));
    const items = await this.dbs.db.select().from(permissionBundleItems);
    return { defs, bundles: bundles.map((b) => ({ ...b, perms: items.filter((i) => i.bundle === b.bundle).map((i) => i.permission) })) };
  }
  userPermissions(userId: string) { return this.dbs.db.select({ p: adminPermissions.permission }).from(adminPermissions).where(eq(adminPermissions.userId, userId)).then((r) => r.map((x) => x.p)); }
  async grantPermission(actor: Claims, userId: string, perm: string, grant: boolean) {
    if (grant) await this.dbs.db.insert(adminPermissions).values({ userId, permission: perm, grantedBy: actor.sub }).onConflictDoNothing();
    else await this.dbs.db.delete(adminPermissions).where(and(eq(adminPermissions.userId, userId), eq(adminPermissions.permission, perm)));
    await this.audit.log(actor, { action: grant ? "grant_permission" : "revoke_permission", table: "admin_permissions", recordId: userId, newData: { perm } });
    return this.userPermissions(userId);
  }
  async applyBundle(actor: Claims, userId: string, bundle: string) {
    const perms = (await this.dbs.db.select({ p: permissionBundleItems.permission }).from(permissionBundleItems).where(eq(permissionBundleItems.bundle, bundle))).map((r) => r.p);
    if (!perms.length) throw new AppError("bundle_not_found");
    await this.dbs.db.insert(adminPermissions).values(perms.map((p) => ({ userId, permission: p, grantedBy: actor.sub }))).onConflictDoNothing();
    await this.audit.log(actor, { action: "apply_bundle", table: "admin_permissions", recordId: userId, newData: { bundle } });
    return this.userPermissions(userId);
  }
  async upsertBundle(actor: Claims, bundle: string, label: string, perms: string[], sort = 0) {
    await this.dbs.withTx(async (tx) => {
      await tx.insert(permissionBundles).values({ bundle, label, sort }).onConflictDoUpdate({ target: permissionBundles.bundle, set: { label, sort } });
      await tx.delete(permissionBundleItems).where(eq(permissionBundleItems.bundle, bundle));
      if (perms.length) await tx.insert(permissionBundleItems).values(perms.map((p) => ({ bundle, permission: p })));
    });
    await this.audit.log(actor, { action: "upsert_bundle", table: "permission_bundles", recordId: bundle, newData: { label, perms } });
    return this.permissionCatalog();
  }
  async deleteBundle(actor: Claims, bundle: string) {
    await this.dbs.db.delete(permissionBundles).where(eq(permissionBundles.bundle, bundle));
    await this.audit.log(actor, { action: "delete_bundle", table: "permission_bundles", recordId: bundle });
  }

  // ---------- content: banners + business categories ----------
  banners() { return this.dbs.db.select().from(banners).orderBy(asc(banners.sortOrder), desc(banners.createdAt)); }
  async upsertBanner(actor: Claims, d: { id?: string; title?: string | null; subtitle?: string | null; image_url?: string | null; link?: string | null; bg_color?: string | null; store_id?: string | null; is_active?: boolean; sort_order?: number }) {
    const values = { title: d.title?.trim() || "بانر", subtitle: d.subtitle ?? null, imageUrl: d.image_url ?? null, link: d.link ?? null, bgColor: d.bg_color ?? null, storeId: d.store_id ?? null, isActive: d.is_active ?? true, sortOrder: d.sort_order ?? 0 };
    const [row] = d.id ? await this.dbs.db.update(banners).set(values).where(eq(banners.id, d.id)).returning() : await this.dbs.db.insert(banners).values(values).returning();
    if (!row) throw new AppError("not_found");
    await this.audit.log(actor, { action: d.id ? "UPDATE" : "INSERT", table: "banners", recordId: row.id, recordLabel: row.title, newData: values });
    return row;
  }
  async deleteBanner(actor: Claims, id: string) {
    const r = await this.dbs.db.delete(banners).where(eq(banners.id, id)).returning({ id: banners.id });
    if (!r.length) throw new AppError("not_found");
    await this.audit.log(actor, { action: "DELETE", table: "banners", recordId: id });
  }
  businessCategoriesAll() { return this.dbs.db.select().from(businessCategories).orderBy(asc(businessCategories.sortOrder)); }
  async upsertBusinessCategory(actor: Claims, d: { id?: string; name_ar: string; slug?: string; is_active?: boolean; sort_order?: number }) {
    const values = { nameAr: d.name_ar, ...(d.is_active !== undefined && { isActive: d.is_active }), ...(d.sort_order !== undefined && { sortOrder: d.sort_order }) };
    const [row] = d.id ? await this.dbs.db.update(businessCategories).set(values).where(eq(businessCategories.id, d.id)).returning()
      : await this.dbs.db.insert(businessCategories).values({ ...values, slug: d.slug ?? `type_${Date.now()}` }).returning();
    if (!row) throw new AppError("not_found");
    await this.audit.log(actor, { action: d.id ? "UPDATE" : "INSERT", table: "business_categories", recordId: row.id, recordLabel: row.nameAr, newData: values });
    return row;
  }

  async deleteBusinessCategory(actor: Claims, id: string) {
    const [{ n }] = await this.dbs.db.select({ n: sql<number>`(select count(*) from ${stores} where business_category_id = ${id})::int + (select count(*) from ${profiles} where business_category_id = ${id})::int` }).from(sql`(select 1) x`);
    if (n > 0) throw new AppError("conflict", { reason: "in_use", references: n });
    const r = await this.dbs.db.delete(businessCategories).where(eq(businessCategories.id, id)).returning({ id: businessCategories.id });
    if (!r.length) throw new AppError("not_found");
    await this.audit.log(actor, { action: "DELETE", table: "business_categories", recordId: id });
  }

  // ---------- oversight: audit logs, login sessions, app usage, user file ----------
  async auditLogsList(q: { user_id?: string; search?: string; role_group?: string; action?: string; table?: string; from?: string; to?: string; limit: number; offset: number }) {
    const roleGroup = q.role_group === "staff" ? inArray(auditLogs.userRole, ["super_admin", "admin", "operations", "support", "finance"]) : q.role_group && q.role_group !== "all" ? eq(auditLogs.userRole, q.role_group) : undefined;
    const where = and(q.user_id ? eq(auditLogs.userId, q.user_id) : undefined, q.search ? ilike(auditLogs.userName, `%${q.search}%`) : undefined, roleGroup,
      q.action ? eq(auditLogs.action, q.action) : undefined, q.table ? eq(auditLogs.tableName, q.table) : undefined,
      q.from ? gte(auditLogs.createdAt, new Date(q.from)) : undefined, q.to ? lte(auditLogs.createdAt, new Date(q.to)) : undefined);
    const [items, [{ total }]] = await Promise.all([
      this.dbs.db.select({ a: auditLogs, userPhone: profiles.phone }).from(auditLogs).leftJoin(profiles, eq(profiles.id, auditLogs.userId)).where(where).orderBy(desc(auditLogs.createdAt)).limit(q.limit).offset(q.offset),
      this.dbs.db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    ]);
    return { items: items.map((r) => ({ ...r.a, userPhone: r.userPhone })), total };
  }
  async loginSessions(q: StatusFilterDto & { user_id?: string }) {
    const where = and(q.user_id ? eq(authSessionsLog.userId, q.user_id) : undefined, q.status === "active" ? sql`${authSessionsLog.logoutAt} is null` : q.status === "closed" ? sql`${authSessionsLog.logoutAt} is not null` : undefined);
    const [items, [{ total }]] = await Promise.all([
      this.dbs.db.select({ s: authSessionsLog, userName: profiles.name, userPhone: profiles.phone }).from(authSessionsLog).leftJoin(profiles, eq(profiles.id, authSessionsLog.userId)).where(where).orderBy(desc(authSessionsLog.loginAt)).limit(q.limit).offset(q.offset),
      this.dbs.db.select({ total: sql<number>`count(*)::int` }).from(authSessionsLog).where(where),
    ]);
    return { items: items.map((r) => ({ ...r.s, isActive: !r.s.logoutAt, userName: r.userName, userPhone: r.userPhone })), total };
  }
  async appUsage(q: StatusFilterDto & { user_id?: string }) {
    const where = and(q.user_id ? eq(appUsageLog.userId, q.user_id) : undefined, q.status === "open" ? sql`${appUsageLog.closedAt} is null` : q.status === "closed" ? sql`${appUsageLog.closedAt} is not null` : undefined);
    const [items, [{ total }]] = await Promise.all([
      this.dbs.db.select({ u: appUsageLog, userName: profiles.name, userPhone: profiles.phone, duration: sql<number>`extract(epoch from coalesce(${appUsageLog.closedAt}, ${appUsageLog.lastPingAt}) - ${appUsageLog.openedAt})::int` })
        .from(appUsageLog).leftJoin(profiles, eq(profiles.id, appUsageLog.userId)).where(where).orderBy(desc(appUsageLog.openedAt)).limit(q.limit).offset(q.offset),
      this.dbs.db.select({ total: sql<number>`count(*)::int` }).from(appUsageLog).where(where),
    ]);
    return { items: items.map((r) => ({ ...r.u, isOpen: !r.u.closedAt, durationSeconds: r.duration, userName: r.userName, userPhone: r.userPhone })), total };
  }
  /** admin_list_user_files: one row per user with activity counters. */
  async userFiles(q: { user_id?: string; search?: string; status?: string; limit: number; offset: number }) {
    const where = and(q.user_id ? eq(profiles.id, q.user_id) : undefined, q.search ? or(ilike(profiles.name, `%${q.search}%`), ilike(profiles.phone, `%${q.search}%`)) : undefined,
      q.status === "open" ? sql`exists (select 1 from ${appUsageLog} a where a.user_id = profiles.id and a.closed_at is null)` : undefined);
    const [items, [{ total }]] = await Promise.all([
      this.dbs.db.select({
        userId: profiles.id, userName: profiles.name, userPhone: profiles.phone, registeredAt: profiles.createdAt,
        userRole: sql<string>`(select r.role::text from ${userRoles} r where r.user_id = profiles.id order by case r.role when 'super_admin' then 0 when 'merchant' then 1 else 2 end limit 1)`,
        totalOpens: sql<number>`(select count(*)::int from ${appUsageLog} a where a.user_id = profiles.id)`,
        isOpenNow: sql<boolean>`exists (select 1 from ${appUsageLog} a where a.user_id = profiles.id and a.closed_at is null)`,
        lastOpenedAt: sql<string>`(select max(a.opened_at) from ${appUsageLog} a where a.user_id = profiles.id)`,
        totalLogins: sql<number>`(select count(*)::int from ${authSessionsLog} s where s.user_id = profiles.id)`,
        activeSessions: sql<number>`(select count(*)::int from ${authSessionsLog} s where s.user_id = profiles.id and s.logout_at is null)`,
        lastLoginAt: sql<string>`(select max(s.login_at) from ${authSessionsLog} s where s.user_id = profiles.id)`,
        totalActions: sql<number>`(select count(*)::int from ${auditLogs} l where l.user_id = profiles.id)`,
        lastActionAt: sql<string>`(select max(l.created_at) from ${auditLogs} l where l.user_id = profiles.id)`,
      }).from(profiles).where(where).orderBy(desc(profiles.createdAt)).limit(q.limit).offset(q.offset),
      this.dbs.db.select({ total: sql<number>`count(*)::int` }).from(profiles).where(where),
    ]);
    return { items, total };
  }
}
