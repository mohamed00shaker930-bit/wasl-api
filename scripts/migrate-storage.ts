// Phase 1/5: upload the files downloaded from Supabase Storage (wasl-ops/dump/files/<bucket>/<key>) to the configured
// storage driver and rewrite the URLs stored in the database. Resumable: rows that already point at S3_PUBLIC_BASE_URL are skipped.
//   DATABASE_URL=... DUMP_FILES=../wasl-ops/dump/files pnpm exec tsx scripts/migrate-storage.ts
import "dotenv/config";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { Client } from "pg";
import { validateConfig } from "../src/config/config.schema";
import { DiskDriver, MinioDriver } from "../src/modules/files/storage.driver";

const cfg = validateConfig(process.env as Record<string, unknown>);
const driver = cfg.STORAGE_DRIVER === "minio" ? new MinioDriver(cfg, cfg.S3_PUBLIC_BASE_URL) : new DiskDriver(cfg.DISK_STORAGE_ROOT, cfg.S3_PUBLIC_BASE_URL);
const root = process.env.DUMP_FILES ?? "../wasl-ops/dump/files";
const OLD_PREFIX = process.env.SUPABASE_PUBLIC_PREFIX ?? "https://kodcctxkdathttbzjraw.supabase.co/storage/v1/object/public/";
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

async function main() {
  let uploaded = 0;
  for (const bucket of readdirSync(root)) {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const file of walk(join(root, bucket))) {
      const key = relative(join(root, bucket), file).split("\\").join("/");
      await driver.put(bucket, key, readFileSync(file), MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
      uploaded++;
    }
    console.log(`${bucket}: uploaded`);
  }
  const db = new Client({ connectionString: cfg.DATABASE_URL }); await db.connect();
  for (const [table, col] of [["catalog_items", "image_url"], ["catalog_categories", "image_url"], ["custom_product_requests", "image_url"], ["banners", "image_url"], ["stores", "image_url"], ["products", "image_url"]]) {
    const r = await db.query(`update ${table} set ${col} = replace(${col}, $1, $2) where ${col} like $3`, [OLD_PREFIX, cfg.S3_PUBLIC_BASE_URL + "/", OLD_PREFIX + "%"]);
    console.log(`${table}.${col}: ${r.rowCount} urls rewritten`);
  }
  await db.end();
  console.log(`done: ${uploaded} files`);
}
main().catch((e) => { console.error(e); process.exit(1); });
