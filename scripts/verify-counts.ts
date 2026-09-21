// Phase 1/5: compare row counts of the migrated database with wasl-ops/dump/counts.csv captured from Supabase.
//   DATABASE_URL=... COUNTS=../wasl-ops/dump/counts.csv pnpm exec tsx scripts/verify-counts.ts
import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const DROPPED = new Set(["app_admins", "uptime_targets", "uptime_checks", "uptime_incidents", "uptime_pending", "monitoring_settings"]);
async function main() {
  const csv = readFileSync(process.env.COUNTS ?? "../wasl-ops/dump/counts.csv", "utf8").trim().split("\n").slice(1);
  const expected = new Map(csv.map((l) => { const [t, n] = l.split(","); return [t.replace(/"/g, ""), Number(n)]; }));
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  let bad = 0;
  for (const [table, n] of [...expected.entries()].sort()) {
    if (DROPPED.has(table)) { console.log(`${table.padEnd(28)} dropped by design (${n} rows in source)`); continue; }
    const { rows } = await db.query(`select count(*)::int as n from "${table}"`).catch(() => ({ rows: [{ n: null }] }));
    const ok = rows[0].n === n;
    if (!ok) bad++;
    console.log(`${table.padEnd(28)} source ${String(n).padStart(8)}  target ${String(rows[0].n).padStart(8)}  ${ok ? "ok" : "MISMATCH"}`);
  }
  const { rows: [u] } = await db.query("select count(*)::int as n from users");
  console.log(`${"users (from auth.users)".padEnd(28)} target ${String(u.n).padStart(8)}`);
  await db.end();
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
