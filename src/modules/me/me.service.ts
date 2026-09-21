import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { Inject } from "@nestjs/common";
import { DbService } from "@/db/db.module";
import { appUsageLog, deviceTokens, favorites, locations, notifications, products, profiles, refreshTokens, stores, users } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import { APP_CONFIG } from "@/config/config.module";
import type { AppConfig } from "@/config/config.schema";
import type { DeviceTokenDto, FavoriteDto, LocationDto, UpdateProfileDto } from "./dto";

@Injectable()
export class MeService {
  constructor(private dbs: DbService, @Inject(APP_CONFIG) private cfg: AppConfig) {}

  // ---------- profile ----------
  async profile(userId: string) {
    const [p] = await this.dbs.db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!p) throw new AppError("not_found");
    return p;
  }
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const [p] = await this.dbs.db.update(profiles).set({
      ...(dto.name !== undefined && { name: dto.name }), ...(dto.city !== undefined && { city: dto.city }),
      ...(dto.district !== undefined && { district: dto.district }), ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.business_name !== undefined && { businessName: dto.business_name }),
      ...(dto.business_category_id !== undefined && { businessCategoryId: dto.business_category_id }),
    }).where(eq(profiles.id, userId)).returning();
    if (!p) throw new AppError("not_found");
    return p;
  }

  /**
   * Self-service deletion (old RPC delete_my_account). Orders/ledger rows are kept for the merchants' books;
   * the account is marked deleted, personal fields are blanked, and every session is revoked.
   */
  async deleteAccount(userId: string) {
    await this.dbs.withTx(async (tx) => {
      await tx.update(profiles).set({ accountStatus: "deleted", name: "حساب محذوف", address: null, statusReason: "self-deleted" }).where(eq(profiles.id, userId));
      await tx.update(users).set({ disabledAt: new Date(), passwordHash: "!deleted" }).where(eq(users.id, userId));
      await tx.update(stores).set({ status: "suspended", isOpen: false }).where(eq(stores.ownerId, userId));
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      await tx.delete(deviceTokens).where(eq(deviceTokens.userId, userId));
    });
  }

  // ---------- locations ----------
  listLocations(userId: string) {
    return this.dbs.db.select().from(locations).where(eq(locations.userId, userId)).orderBy(desc(locations.createdAt));
  }
  async addLocation(userId: string, dto: LocationDto) {
    const [row] = await this.dbs.db.insert(locations).values({ userId, label: dto.label, landmarkText: dto.landmark_text, phone: dto.phone ?? null, lat: dto.lat ?? null, lng: dto.lng ?? null }).returning();
    return row;
  }
  async updateLocation(userId: string, id: string, dto: LocationDto) {
    const [row] = await this.dbs.db.update(locations).set({ label: dto.label, landmarkText: dto.landmark_text, phone: dto.phone ?? null, lat: dto.lat ?? null, lng: dto.lng ?? null })
      .where(and(eq(locations.id, id), eq(locations.userId, userId))).returning();
    if (!row) throw new AppError("not_found");
    return row;
  }
  async deleteLocation(userId: string, id: string) {
    const rows = await this.dbs.db.delete(locations).where(and(eq(locations.id, id), eq(locations.userId, userId))).returning({ id: locations.id });
    if (!rows.length) throw new AppError("not_found");
  }

  // ---------- favorites ----------
  async listFavorites(userId: string) {
    const favs = await this.dbs.db.select().from(favorites).where(eq(favorites.userId, userId)).orderBy(desc(favorites.createdAt));
    const storeIds = favs.filter((f) => f.targetType === "store").map((f) => f.targetId);
    const productIds = favs.filter((f) => f.targetType === "product").map((f) => f.targetId);
    const [s, p] = await Promise.all([
      storeIds.length ? this.dbs.db.select().from(stores).where(inArray(stores.id, storeIds)) : [],
      productIds.length ? this.dbs.db.select({ p: products, storeName: stores.name }).from(products).leftJoin(stores, eq(stores.id, products.storeId)).where(inArray(products.id, productIds)) : [],
    ]);
    return { favorites: favs, stores: s, products: p.map((r) => ({ ...r.p, storeName: r.storeName })) };
  }
  async addFavorite(userId: string, dto: FavoriteDto) {
    await this.dbs.db.insert(favorites).values({ userId, targetType: dto.target_type, targetId: dto.target_id }).onConflictDoNothing();
  }
  async removeFavorite(userId: string, dto: FavoriteDto) {
    await this.dbs.db.delete(favorites).where(and(eq(favorites.userId, userId), eq(favorites.targetType, dto.target_type), eq(favorites.targetId, dto.target_id)));
  }

  // ---------- notifications ----------
  async listNotifications(userId: string, limit: number, before?: string) {
    const rows = await this.dbs.db.select().from(notifications)
      .where(and(eq(notifications.userId, userId), before ? lt(notifications.createdAt, new Date(before)) : undefined))
      .orderBy(desc(notifications.createdAt)).limit(limit);
    const [{ unread }] = await this.dbs.db.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { items: rows, unread };
  }
  async markRead(userId: string, id: string) {
    await this.dbs.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
  }
  async markAllRead(userId: string) {
    await this.dbs.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  // ---------- app-usage sessions (old app_session_open/ping/close) ----------
  private beaconToken(sessionId: string) {
    return createHmac("sha256", this.cfg.JWT_ACCESS_SECRET).update("beacon:" + sessionId).digest("base64url");
  }
  async sessionOpen(userId: string, userAgent?: string) {
    const [row] = await this.dbs.db.insert(appUsageLog).values({ userId, userAgent: userAgent?.slice(0, 300) }).returning({ id: appUsageLog.id });
    // navigator.sendBeacon cannot set headers, so close() accepts this token instead of the JWT
    return { id: row.id, beacon_token: this.beaconToken(row.id) };
  }
  async sessionPing(userId: string, id: string) {
    await this.dbs.db.update(appUsageLog).set({ lastPingAt: new Date() }).where(and(eq(appUsageLog.id, id), eq(appUsageLog.userId, userId), isNull(appUsageLog.closedAt)));
  }
  async sessionClose(id: string, closeType: string | undefined, auth: { userId?: string; beaconToken?: string }) {
    if (!auth.userId && auth.beaconToken !== this.beaconToken(id)) throw new AppError("invalid_token");
    await this.dbs.db.update(appUsageLog).set({ closedAt: new Date(), closeType: closeType ?? "pagehide" })
      .where(and(eq(appUsageLog.id, id), auth.userId ? eq(appUsageLog.userId, auth.userId) : undefined, isNull(appUsageLog.closedAt)));
  }
  /** Sessions with no ping for 5 minutes are closed by the scheduler (old behaviour relied on the client only). */
  async closeStaleSessions() {
    const r = await this.dbs.db.update(appUsageLog).set({ closedAt: sql`last_ping_at`, closeType: "timeout" })
      .where(and(isNull(appUsageLog.closedAt), lt(appUsageLog.lastPingAt, new Date(Date.now() - 5 * 60_000)))).returning({ id: appUsageLog.id });
    return r.length;
  }

  // ---------- push device tokens (FCM later) ----------
  async registerDevice(userId: string, dto: DeviceTokenDto) {
    await this.dbs.db.insert(deviceTokens).values({ userId, token: dto.token, platform: dto.platform })
      .onConflictDoUpdate({ target: [deviceTokens.userId, deviceTokens.token], set: { lastSeenAt: new Date(), platform: dto.platform } });
  }
  async removeDevice(userId: string, token: string) {
    await this.dbs.db.delete(deviceTokens).where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)));
  }
}
