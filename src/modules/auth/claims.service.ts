import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DbService, type Tx, type Db } from "@/db/db.module";
import { adminPermissions, profiles, stores, userRoles, users } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import type { AppRole, Claims } from "@/common/auth";

const STAFF_ROLES: AppRole[] = ["super_admin", "admin", "operations", "support", "finance"];

@Injectable()
export class ClaimsService {
  constructor(private dbs: DbService) {}

  /**
   * The account-status gate that the old app only enforced in the browser: pending/rejected/suspended/deleted
   * accounts never receive a token. Runs at login and at every refresh.
   */
  async assertAccountActive(db: Db | Tx, userId: string) {
    const [p] = await db.select({ status: profiles.accountStatus, reason: profiles.statusReason, until: profiles.suspendedUntil })
      .from(profiles).where(eq(profiles.id, userId)).limit(1);
    const [u] = await db.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u || u.disabledAt) throw new AppError("account_deleted");
    const status = p?.status ?? "pending";
    if (status === "suspended" && p?.until && p.until.getTime() < Date.now()) return; // suspension expired
    if (status !== "active") {
      const code = status === "pending" ? "account_pending" : status === "rejected" ? "account_rejected" : status === "suspended" ? "account_suspended" : "account_deleted";
      throw new AppError(code, { reason: p?.reason ?? undefined, suspended_until: p?.until ?? undefined });
    }
  }

  async build(db: Db | Tx, userId: string): Promise<Claims> {
    const [u] = await db.select({ phone: users.phone, fpc: users.forcePasswordChange }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new AppError("invalid_token");
    const roles = (await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.role as AppRole);
    const isSuper = roles.includes("super_admin");
    const staff = roles.some((r) => STAFF_ROLES.includes(r));
    const perms = staff ? (await db.select({ p: adminPermissions.permission }).from(adminPermissions).where(eq(adminPermissions.userId, userId))).map((r) => r.p) : [];
    let storeId: string | undefined;
    if (roles.includes("merchant")) {
      // owner may have several rows historically; prefer an active store, then the newest
      const rows = await db.select({ id: stores.id, status: stores.status }).from(stores).where(eq(stores.ownerId, userId)).orderBy(desc(stores.createdAt));
      storeId = (rows.find((s) => s.status === "active") ?? rows[0])?.id;
    }
    return { sub: userId, phone: u.phone, roles, perms, super: isSuper, staff, store_id: storeId, fpc: u.fpc };
  }
}
