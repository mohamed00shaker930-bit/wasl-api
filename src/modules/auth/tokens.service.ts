import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { APP_CONFIG } from "@/config/config.module";
import type { AppConfig } from "@/config/config.schema";
import { DbService, type Tx } from "@/db/db.module";
import { refreshTokens } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";
import type { Claims } from "@/common/auth";

export type ClientKind = "web" | "mobile";

export function parseTtlMs(ttl: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(ttl.trim());
  if (!m) throw new Error(`bad TTL: ${ttl}`);
  const n = Number(m[1]);
  return n * ({ ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] ?? "ms"] as number);
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

@Injectable()
export class TokensService {
  constructor(private jwt: JwtService, private dbs: DbService, @Inject(APP_CONFIG) private cfg: AppConfig) {}

  get refreshTtlMs() { return parseTtlMs(this.cfg.JWT_REFRESH_TTL); }
  get accessTtlMs() { return parseTtlMs(this.cfg.JWT_ACCESS_TTL); }

  signAccess(claims: Claims): Promise<string> {
    const { iat: _i, exp: _e, ...payload } = claims;
    return this.jwt.signAsync(payload, { secret: this.cfg.JWT_ACCESS_SECRET, expiresIn: Math.floor(this.accessTtlMs / 1000) });
  }

  /** Creates a new refresh token (new family unless one is given). Returns the raw token for the client. */
  async issueRefresh(tx: Tx, userId: string, client: ClientKind, meta: { userAgent?: string; ip?: string }, family: string = randomUUID()) {
    const raw = randomBytes(32).toString("base64url");
    const [row] = await tx.insert(refreshTokens).values({
      userId, family, client, userAgent: meta.userAgent?.slice(0, 300), ip: meta.ip?.slice(0, 64),
      tokenHash: sha256(raw), expiresAt: new Date(Date.now() + this.refreshTtlMs),
    }).returning({ id: refreshTokens.id });
    return { raw, id: row.id, family };
  }

  /**
   * Rotation with reuse detection: a revoked token being presented again means it leaked, so the whole
   * family is revoked. Returns the row so the caller can issue the replacement in the same transaction.
   */
  async consumeRefresh(tx: Tx, raw: string) {
    const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw))).limit(1);
    if (!row) throw new AppError("invalid_token");
    if (row.revokedAt) {
      // Must commit even though the caller's transaction is about to roll back: use the pool, not `tx`.
      await this.dbs.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.family, row.family), isNull(refreshTokens.revokedAt)));
      throw new AppError("token_reused");
    }
    if (row.expiresAt.getTime() < Date.now()) throw new AppError("invalid_token");
    return row;
  }

  async revokeToken(tx: Tx, id: string, replacedBy?: string) {
    await tx.update(refreshTokens).set({ revokedAt: new Date(), replacedBy }).where(eq(refreshTokens.id, id));
  }

  async revokeAllForUser(tx: Tx, userId: string, exceptFamily?: string) {
    const rows = await tx.select({ id: refreshTokens.id, family: refreshTokens.family }).from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    for (const r of rows) if (r.family !== exceptFamily) await this.revokeToken(tx, r.id);
  }
}
