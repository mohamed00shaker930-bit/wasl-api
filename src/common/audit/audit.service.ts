import { Injectable } from "@nestjs/common";
import { DbService, type Tx } from "@/db/db.module";
import { auditLogs, profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Claims } from "@/common/auth";

/** Writes audit_logs rows (the old app relied on DB triggers with auth.uid(); the actor now comes from the JWT). */
@Injectable()
export class AuditService {
  constructor(private dbs: DbService) {}
  async log(actor: Claims | null, entry: { action: string; table: string; recordId?: string | null; recordLabel?: string | null; oldData?: unknown; newData?: unknown; changedFields?: string[] }, tx?: Tx) {
    const db = tx ?? this.dbs.db;
    let userName: string | null = null;
    if (actor) { const [p] = await db.select({ name: profiles.name }).from(profiles).where(eq(profiles.id, actor.sub)).limit(1); userName = p?.name ?? null; }
    await db.insert(auditLogs).values({
      userId: actor?.sub ?? null, userName, userRole: actor ? (actor.super ? "super_admin" : actor.roles[0] ?? null) : "system",
      action: entry.action, tableName: entry.table, recordId: entry.recordId ?? null, recordLabel: entry.recordLabel ?? null,
      oldData: entry.oldData ?? null, newData: entry.newData ?? null, changedFields: entry.changedFields ?? null,
    });
  }
}
