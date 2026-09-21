// Applies src/db/migrations/*.sql in filename order, recording each in public._migrations.
// Usage: pnpm db:migrate   (DATABASE_URL from .env)
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

export async function runMigrations(databaseUrl: string, dir = resolve(__dirname, "migrations")) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public._migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query("SELECT pg_advisory_lock(7245177)");
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM public._migrations")).rows.map((r) => r.name));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(resolve(dir, f), "utf8");
      // ALTER TYPE ... ADD VALUE cannot run inside a transaction block: such files opt out with a header comment.
      const noTx = /^--\s*no-transaction/m.test(sql);
      if (!noTx) await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO public._migrations(name) VALUES ($1)", [f]);
        if (!noTx) await client.query("COMMIT");
      } catch (e) {
        if (!noTx) await client.query("ROLLBACK");
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
      applied.push(f);
    }
    await client.query("SELECT pg_advisory_unlock(7245177)");
    return applied;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations(process.env.DATABASE_URL!)
    .then((a) => { console.log(a.length ? `applied: ${a.join(", ")}` : "up to date"); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
