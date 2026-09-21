// pnpm db:seed — idempotent. Creates the first super admin from SEED_SUPER_ADMIN_* and the permission catalog.
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "../schema";
import { hashPassword } from "@/modules/auth/password";
import { PERMISSION_DEFS, PERMISSION_BUNDLES } from "./permissions";
import { YEMENI_PHONE_RE } from "@/domain/phone";

type SeedDb = ReturnType<typeof drizzle<typeof schema>>;

/** Permission catalog + bundles + app_settings defaults. Idempotent; also used by the e2e bootstrap. */
export async function seedReferenceData(db: SeedDb) {
  for (const d of PERMISSION_DEFS) {
    await db.insert(schema.permissionDefs).values(d).onConflictDoUpdate({ target: schema.permissionDefs.perm, set: { grp: d.grp, grpLabel: d.grpLabel, label: d.label, sort: d.sort, superOnly: d.superOnly } });
  }
  for (const b of PERMISSION_BUNDLES) {
    await db.insert(schema.permissionBundles).values({ bundle: b.bundle, label: b.label, sort: b.sort }).onConflictDoUpdate({ target: schema.permissionBundles.bundle, set: { label: b.label, sort: b.sort } });
    for (const p of b.perms) await db.insert(schema.permissionBundleItems).values({ bundle: b.bundle, permission: p }).onConflictDoNothing();
  }
  console.log(`permission defs: ${PERMISSION_DEFS.length}, bundles: ${PERMISSION_BUNDLES.length}`);

  // 1b) app_settings defaults (were seeded by migration 20260627195816; the schema-only baseline dropped the rows)
  const SETTINGS: Record<string, unknown> = { default_commission_pct: 0, delivery_fee: 0, min_order: 0, max_credit: 50000, support_phone: "", wallets_enabled: true, credit_enabled: true, ewallets_enabled: true };
  for (const [key, value] of Object.entries(SETTINGS)) await db.insert(schema.appSettings).values({ key, value }).onConflictDoNothing();
  console.log(`app_settings ensured: ${Object.keys(SETTINGS).join(", ")}`);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  await seedReferenceData(db);

  // 2) super admin
  const phone = process.env.SEED_SUPER_ADMIN_PHONE, password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (!phone || !password) { console.log("SEED_SUPER_ADMIN_PHONE/PASSWORD not set; skipping super admin"); await pool.end(); return; }
  if (!YEMENI_PHONE_RE.test(phone)) throw new Error("SEED_SUPER_ADMIN_PHONE must be a 9-digit Yemeni mobile number");
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
  const id = existing?.id ?? randomUUID();
  if (!existing) {
    await db.insert(schema.users).values({ id, phone, passwordHash: await hashPassword(password), passwordAlgo: "argon2id", forcePasswordChange: true });
    await db.insert(schema.profiles).values({ id, phone, name: "المدير العام", accountStatus: "active", userType: "admin", approvedAt: new Date() });
    console.log(`created super admin ${phone} (must change password at first login)`);
  } else {
    await db.update(schema.profiles).set({ accountStatus: "active" }).where(eq(schema.profiles.id, id));
    console.log(`super admin ${phone} already exists; ensured active`);
  }
  await db.insert(schema.userRoles).values({ userId: id, role: "super_admin" }).onConflictDoNothing();
  await pool.end();
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
