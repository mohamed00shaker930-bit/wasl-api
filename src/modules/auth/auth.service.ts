import { Injectable, Logger } from "@nestjs/common";
import { and, eq, or } from "drizzle-orm";
import { DbService } from "@/db/db.module";
import { authSessionsLog, passwordResetRequests, profiles, stores, userRoles, users } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import type { Claims } from "@/common/auth";
import { ClaimsService } from "./claims.service";
import { TokensService, type ClientKind } from "./tokens.service";
import { hashPassword, verifyPassword, type PasswordAlgo } from "./password";
import type { RegisterDto, ChangePasswordDto } from "./dto";

export interface RequestMeta { userAgent?: string; ip?: string; client: ClientKind }
export interface TokenPair { access_token: string; refresh_token: string; expires_in: number; claims: Claims }

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  constructor(private dbs: DbService, private claims: ClaimsService, private tokens: TokensService) {}

  /** Self-registration lands in `pending`; an admin approves it (same UX as before). No tokens are issued. */
  async register(dto: RegisterDto) {
    const [taken] = await this.dbs.db.select({ id: users.id }).from(users).where(eq(users.phone, dto.phone)).limit(1);
    if (taken) throw new AppError("phone_taken");
    const passwordHash = await hashPassword(dto.password);
    const userId = await this.dbs.withTx(async (tx) => {
      const [u] = await tx.insert(users).values({ phone: dto.phone, passwordHash, passwordAlgo: "argon2id" }).returning({ id: users.id });
      // the AFTER INSERT trigger claim_pending_customers links in-store credit customers by phone
      await tx.insert(profiles).values({
        id: u.id, phone: dto.phone, name: dto.name, accountStatus: "pending", userType: dto.user_type,
        city: dto.city, district: dto.district, address: dto.address, businessName: dto.business_name, businessCategoryId: dto.business_category_id,
      });
      await tx.insert(userRoles).values({ userId: u.id, role: dto.user_type });
      if (dto.user_type === "merchant") {
        await tx.insert(stores).values({ ownerId: u.id, name: dto.business_name!, phone: dto.phone, area: [dto.city, dto.district].filter(Boolean).join(" - ") || null, status: "pending", businessCategoryId: dto.business_category_id });
      }
      return u.id;
    });
    return { id: userId, status: "pending" as const };
  }

  async login(phone: string, password: string, meta: RequestMeta): Promise<TokenPair> {
    const [u] = await this.dbs.db.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (!u || !(await verifyPassword(password, u.passwordHash, u.passwordAlgo as PasswordAlgo))) throw new AppError("invalid_credentials");
    await this.claims.assertAccountActive(this.dbs.db, u.id);
    return this.dbs.withTx(async (tx) => {
      const patch: Partial<typeof users.$inferInsert> = { lastLoginAt: new Date() };
      if (u.passwordAlgo === "bcrypt") { patch.passwordHash = await hashPassword(password); patch.passwordAlgo = "argon2id"; }
      await tx.update(users).set(patch).where(eq(users.id, u.id));
      const claims = await this.claims.build(tx, u.id);
      const refresh = await this.tokens.issueRefresh(tx, u.id, meta.client, meta);
      await tx.insert(authSessionsLog).values({ userId: u.id, sessionId: refresh.family, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300), lastSeenAt: new Date() });
      return { access_token: await this.tokens.signAccess(claims), refresh_token: refresh.raw, expires_in: Math.floor(this.tokens.accessTtlMs / 1000), claims };
    });
  }

  async refresh(raw: string, meta: RequestMeta): Promise<TokenPair> {
    return this.dbs.withTx(async (tx) => {
      const row = await this.tokens.consumeRefresh(tx, raw);
      await this.claims.assertAccountActive(tx, row.userId);
      const next = await this.tokens.issueRefresh(tx, row.userId, row.client as ClientKind, meta, row.family);
      await this.tokens.revokeToken(tx, row.id, next.id);
      await tx.update(authSessionsLog).set({ lastSeenAt: new Date() }).where(and(eq(authSessionsLog.sessionId, row.family), eq(authSessionsLog.userId, row.userId)));
      const claims = await this.claims.build(tx, row.userId);
      return { access_token: await this.tokens.signAccess(claims), refresh_token: next.raw, expires_in: Math.floor(this.tokens.accessTtlMs / 1000), claims };
    });
  }

  async logout(raw: string | undefined, userId: string | undefined) {
    if (!raw) return;
    await this.dbs.withTx(async (tx) => {
      try {
        const row = await this.tokens.consumeRefresh(tx, raw);
        await this.tokens.revokeToken(tx, row.id);
        await tx.update(authSessionsLog).set({ logoutAt: new Date(), logoutType: "manual" }).where(and(eq(authSessionsLog.sessionId, row.family), eq(authSessionsLog.userId, row.userId)));
      } catch (e) {
        if (!(e instanceof AppError)) throw e; // an invalid/reused token on logout is not an error for the caller
        this.log.debug(`logout with unusable refresh token for ${userId ?? "?"}: ${e.code}`);
      }
    });
  }

  /** Requires the current password unless the account is under force_password_change (temp password just used to log in). */
  async changePassword(userId: string, dto: ChangePasswordDto, currentFamily?: string) {
    const [u] = await this.dbs.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new AppError("invalid_token");
    if (!u.forcePasswordChange) {
      if (!dto.current_password || !(await verifyPassword(dto.current_password, u.passwordHash, u.passwordAlgo as PasswordAlgo))) throw new AppError("invalid_credentials");
    }
    const passwordHash = await hashPassword(dto.new_password);
    await this.dbs.withTx(async (tx) => {
      await tx.update(users).set({ passwordHash, passwordAlgo: "argon2id", forcePasswordChange: false }).where(eq(users.id, userId));
      await this.tokens.revokeAllForUser(tx, userId, currentFamily);
    });
  }

  /** Always succeeds from the caller's point of view (no user enumeration); one open request per phone. */
  async requestPasswordReset(phone: string, reason?: string) {
    const [p] = await this.dbs.db.select({ id: profiles.id, name: profiles.name, type: profiles.userType }).from(profiles).where(eq(profiles.phone, phone)).limit(1);
    const [open] = await this.dbs.db.select({ id: passwordResetRequests.id }).from(passwordResetRequests)
      .where(and(eq(passwordResetRequests.phone, phone), eq(passwordResetRequests.status, "pending"))).limit(1);
    if (open) return;
    await this.dbs.db.insert(passwordResetRequests).values({ phone, userId: p?.id, userType: p?.type, applicantName: p?.name, reason: reason?.slice(0, 500) });
  }

  /** Used by GET /auth/me: fresh claims + the profile the shells need. */
  async me(userId: string) {
    const claims = await this.claims.build(this.dbs.db, userId);
    const [p] = await this.dbs.db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    let store = null;
    if (claims.store_id) [store] = await this.dbs.db.select().from(stores).where(eq(stores.id, claims.store_id)).limit(1);
    return { user: { id: userId, phone: claims.phone, name: p?.name ?? null, account_status: p?.accountStatus ?? "pending", user_type: p?.userType ?? null, force_password_change: claims.fpc },
             roles: claims.roles, perms: claims.perms, super: claims.super, is_staff: claims.staff, store };
  }

  async findUserIdByPhone(phone: string) {
    const [u] = await this.dbs.db.select({ id: users.id }).from(users).where(or(eq(users.phone, phone))).limit(1);
    return u?.id;
  }
}
