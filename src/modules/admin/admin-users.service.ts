import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { DbService } from "@/db/db.module";
import { adminPermissions, businessCategories, passwordResetRequests, permissionBundleItems, permissionBundles, profiles, refreshTokens, stores, userRoles, users } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import type { Claims } from "@/common/auth";
import { AuditService } from "@/common/audit/audit.service";
import { hashPassword } from "@/modules/auth/password";
import { WalletService } from "@/modules/wallet/wallet.service";
import type { AccountStatusDto, AdminUpdateProfileDto, CreateStaffDto, CreateUserDto, ListUsersDto, UserRoleDto } from "./dto";

const STAFF = ["super_admin", "admin", "operations", "support", "finance"] as const;

/** Replaces admin_list_users, admin_get_user_detail, admin_update_profile, admin_set_account_status, admin_set_user_role,
 *  admin_decide_account_request, admin_decide_password_reset, admin_grant_wallet_credit and both edge functions. */
@Injectable()
export class AdminUsersService {
  constructor(private dbs: DbService, private audit: AuditService, private wallet: WalletService) {}

  async list(q: ListUsersDto) {
    const roleSub = (roles: readonly string[]) => sql`exists (select 1 from ${userRoles} r where r.user_id = profiles.id and r.role = any(${sql.raw(`array[${roles.map((r) => `'${r}'`).join(",")}]::app_role[]`)}))`;
    const where = and(
      q.kind === "customers" ? and(roleSub(["customer"]), sql`not ${roleSub(["merchant", ...STAFF])}`) : undefined,
      q.kind === "merchants" ? roleSub(["merchant"]) : undefined,
      q.kind === "staff" ? roleSub(STAFF) : undefined,
      q.role ? roleSub([q.role]) : undefined,
      q.status ? eq(profiles.accountStatus, q.status) : undefined,
      q.search ? or(ilike(profiles.name, `%${q.search}%`), ilike(profiles.phone, `%${q.search}%`), ilike(profiles.businessName, `%${q.search}%`)) : undefined,
      q.category_slug ? sql`exists (select 1 from ${businessCategories} b where b.id = profiles.business_category_id and b.slug = ${q.category_slug})` : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      this.dbs.db.select({ p: profiles, roles: sql<string[]>`(select coalesce(array_agg(r.role::text), '{}') from ${userRoles} r where r.user_id = profiles.id)`,
        stores: sql<unknown>`(select coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'status', s.status)), '[]') from ${stores} s where s.owner_id = profiles.id)` })
        .from(profiles).where(where).orderBy(desc(profiles.createdAt)).limit(q.limit).offset(q.offset),
      this.dbs.db.select({ total: sql<number>`count(*)::int` }).from(profiles).where(where),
    ]);
    return { items: rows.map((r) => ({ ...r.p, roles: r.roles, stores: r.stores })), total, limit: q.limit, offset: q.offset };
  }

  async detail(userId: string) {
    const [p] = await this.dbs.db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!p) throw new AppError("not_found");
    const [u] = await this.dbs.db.select({ createdAt: users.createdAt, lastLoginAt: users.lastLoginAt, forcePasswordChange: users.forcePasswordChange, disabledAt: users.disabledAt }).from(users).where(eq(users.id, userId)).limit(1);
    const roles = (await this.dbs.db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role);
    const perms = (await this.dbs.db.select({ p: adminPermissions.permission }).from(adminPermissions).where(eq(adminPermissions.userId, userId))).map((r) => r.p);
    const ownedStores = await this.dbs.db.select().from(stores).where(eq(stores.ownerId, userId));
    const wallet = await this.wallet.summary(userId);
    return { profile: p, user: u, roles, perms, stores: ownedStores, wallet };
  }

  async updateProfile(actor: Claims, userId: string, d: AdminUpdateProfileDto) {
    const [before] = await this.dbs.db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!before) throw new AppError("not_found");
    const [after] = await this.dbs.db.update(profiles).set({ ...(d.name !== undefined && { name: d.name }), ...(d.city !== undefined && { city: d.city }), ...(d.district !== undefined && { district: d.district }), ...(d.address !== undefined && { address: d.address }), ...(d.business_name !== undefined && { businessName: d.business_name }) }).where(eq(profiles.id, userId)).returning();
    await this.audit.log(actor, { action: "UPDATE", table: "profiles", recordId: userId, recordLabel: after.name, oldData: before, newData: after, changedFields: Object.keys(d) });
    return after;
  }

  /** admin_set_account_status: suspended/rejected/deleted revoke every session; deletions also disable login. */
  async setStatus(actor: Claims, userId: string, d: AccountStatusDto) {
    return this.dbs.withTx(async (tx) => {
      const [before] = await tx.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      if (!before) throw new AppError("not_found");
      const [after] = await tx.update(profiles).set({ accountStatus: d.status, statusReason: d.reason ?? null, suspendedUntil: d.status === "suspended" && d.until ? new Date(d.until) : null,
        ...(d.status === "active" && { approvedAt: new Date(), approvedBy: actor.sub }) }).where(eq(profiles.id, userId)).returning();
      if (d.status !== "active") await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      await tx.update(users).set({ disabledAt: d.status === "deleted" ? new Date() : null }).where(eq(users.id, userId));
      await this.audit.log(actor, { action: "UPDATE", table: "profiles", recordId: userId, recordLabel: after.name, oldData: { account_status: before.accountStatus }, newData: { account_status: after.accountStatus, reason: d.reason }, changedFields: ["account_status"] }, tx);
      return after;
    });
  }

  async setRole(actor: Claims, userId: string, d: UserRoleDto) {
    if (d.role === "super_admin" && !actor.super) throw new AppError("forbidden");
    if (d.grant) await this.dbs.db.insert(userRoles).values({ userId, role: d.role }).onConflictDoNothing();
    else await this.dbs.db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, d.role)));
    await this.audit.log(actor, { action: d.grant ? "INSERT" : "DELETE", table: "user_roles", recordId: userId, newData: { role: d.role, grant: d.grant } });
    return this.detail(userId);
  }

  pendingAccountRequests() {
    return this.dbs.db.select({ p: profiles, categoryName: businessCategories.nameAr }).from(profiles).leftJoin(businessCategories, eq(businessCategories.id, profiles.businessCategoryId))
      .where(eq(profiles.accountStatus, "pending")).orderBy(desc(profiles.createdAt));
  }
  /** admin_decide_account_request: approving a merchant also activates their pending store. */
  async decideAccountRequest(actor: Claims, userId: string, approve: boolean, reason?: string) {
    return this.dbs.withTx(async (tx) => {
      const [p] = await tx.select().from(profiles).where(and(eq(profiles.id, userId), eq(profiles.accountStatus, "pending"))).limit(1);
      if (!p) throw new AppError("not_found");
      const [after] = await tx.update(profiles).set(approve ? { accountStatus: "active", approvedAt: new Date(), approvedBy: actor.sub, statusReason: null } : { accountStatus: "rejected", statusReason: reason ?? null }).where(eq(profiles.id, userId)).returning();
      if (approve) await tx.update(stores).set({ status: "active" }).where(and(eq(stores.ownerId, userId), eq(stores.status, "pending")));
      await this.audit.log(actor, { action: approve ? "approve_account" : "reject_account", table: "profiles", recordId: userId, recordLabel: p.name, newData: { reason } }, tx);
      return after;
    });
  }

  listPasswordResets(status?: string) {
    return this.dbs.db.select().from(passwordResetRequests).where(status ? eq(passwordResetRequests.status, status) : undefined).orderBy(desc(passwordResetRequests.requestedAt)).limit(200);
  }
  /** admin_decide_password_reset: the temp password is delivered out of band, the user must change it at first login. */
  async decidePasswordReset(actor: Claims, id: string, approve: boolean, tempPassword?: string) {
    return this.dbs.withTx(async (tx) => {
      const [r] = await tx.select().from(passwordResetRequests).where(and(eq(passwordResetRequests.id, id), eq(passwordResetRequests.status, "pending"))).for("update");
      if (!r) throw new AppError("not_found");
      if (approve) {
        if (!tempPassword) throw new AppError("validation", { field: "temp_password" });
        const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.phone, r.phone)).limit(1);
        if (!u) throw new AppError("not_found", { reason: "no_user_for_phone" });
        await tx.update(users).set({ passwordHash: await hashPassword(tempPassword), passwordAlgo: "argon2id", forcePasswordChange: true }).where(eq(users.id, u.id));
        await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, u.id), isNull(refreshTokens.revokedAt)));
      }
      const [after] = await tx.update(passwordResetRequests).set({ status: approve ? "approved" : "rejected", decidedAt: new Date(), decidedBy: actor.sub }).where(eq(passwordResetRequests.id, id)).returning();
      await this.audit.log(actor, { action: approve ? "approve_password_reset" : "reject_password_reset", table: "password_reset_requests", recordId: id, recordLabel: r.phone }, tx);
      return after;
    });
  }

  /** Edge function admin-create-user, now with real HTTP codes. */
  async createUser(actor: Claims, d: CreateUserDto) {
    const [taken] = await this.dbs.db.select({ id: users.id }).from(users).where(eq(users.phone, d.phone)).limit(1);
    if (taken) throw new AppError("phone_taken");
    const passwordHash = await hashPassword(d.password);
    return this.dbs.withTx(async (tx) => {
      const [u] = await tx.insert(users).values({ phone: d.phone, passwordHash, passwordAlgo: "argon2id", forcePasswordChange: true }).returning({ id: users.id });
      await tx.insert(profiles).values({ id: u.id, phone: d.phone, name: d.name, accountStatus: "active", userType: d.user_type, approvedAt: new Date(), approvedBy: actor.sub, city: d.city, district: d.district, address: d.address, businessName: d.business_name, businessCategoryId: d.business_category_id });
      await tx.insert(userRoles).values({ userId: u.id, role: d.user_type }).onConflictDoNothing();
      if (d.user_type === "merchant") await tx.insert(stores).values({ ownerId: u.id, name: d.business_name!, phone: d.phone, area: [d.city, d.district].filter(Boolean).join(" - ") || null, status: "active", businessCategoryId: d.business_category_id });
      await this.audit.log(actor, { action: "create_user", table: "profiles", recordId: u.id, recordLabel: d.name, newData: { phone: d.phone, user_type: d.user_type, business_name: d.business_name } }, tx);
      return { id: u.id };
    });
  }
  /** Edge function admin-create-staff (super only): staff role + optional permission bundle. */
  async createStaff(actor: Claims, d: CreateStaffDto) {
    const [taken] = await this.dbs.db.select({ id: users.id }).from(users).where(eq(users.phone, d.phone)).limit(1);
    if (taken) throw new AppError("phone_taken");
    let bundlePerms: string[] = [];
    if (d.bundle) {
      const [b] = await this.dbs.db.select().from(permissionBundles).where(eq(permissionBundles.bundle, d.bundle)).limit(1);
      if (!b) throw new AppError("bundle_not_found");
      bundlePerms = (await this.dbs.db.select({ p: permissionBundleItems.permission }).from(permissionBundleItems).where(eq(permissionBundleItems.bundle, d.bundle))).map((r) => r.p);
    }
    const passwordHash = await hashPassword(d.password);
    return this.dbs.withTx(async (tx) => {
      const [u] = await tx.insert(users).values({ phone: d.phone, passwordHash, passwordAlgo: "argon2id", forcePasswordChange: true }).returning({ id: users.id });
      await tx.insert(profiles).values({ id: u.id, phone: d.phone, name: d.name, accountStatus: "active", userType: "admin", approvedAt: new Date(), approvedBy: actor.sub });
      await tx.insert(userRoles).values({ userId: u.id, role: d.role }).onConflictDoNothing();
      if (bundlePerms.length) await tx.insert(adminPermissions).values(bundlePerms.map((p) => ({ userId: u.id, permission: p, grantedBy: actor.sub }))).onConflictDoNothing();
      await this.audit.log(actor, { action: "create_staff", table: "profiles", recordId: u.id, recordLabel: d.name, newData: { phone: d.phone, role: d.role, bundle: d.bundle } }, tx);
      return { id: u.id, perms: bundlePerms };
    });
  }

  async grantWallet(actor: Claims, userId: string, amount: number, note?: string) {
    return this.dbs.withTx(async (tx) => {
      const row = await this.wallet.creditWallet(tx, userId, amount, "adjustment", note ?? "منحة من الإدارة", undefined, "admin");
      await this.audit.log(actor, { action: "wallet_grant", table: "wallet_transactions", recordId: row.id, newData: { user_id: userId, amount, note } }, tx);
      return row;
    });
  }
}
