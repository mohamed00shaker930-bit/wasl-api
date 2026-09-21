// Phase 1/5: products/stores/banners whose image_url is a base64 data URL (the old merchant UI stored images inline)
// are decoded, re-encoded to WebP and moved to object storage. Batched and resumable (rows already on https are skipped).
//   DATABASE_URL=... pnpm exec tsx scripts/migrate-base64-images.ts
import "dotenv/config";
import { Client } from "pg";
import sharp from "sharp";
import { validateConfig } from "../src/config/config.schema";
import { DiskDriver, MinioDriver } from "../src/modules/files/storage.driver";

const cfg = validateConfig(process.env as Record<string, unknown>);
const driver = cfg.STORAGE_DRIVER === "minio" ? new MinioDriver(cfg, cfg.S3_PUBLIC_BASE_URL) : new DiskDriver(cfg.DISK_STORAGE_ROOT, cfg.S3_PUBLIC_BASE_URL);
const TARGETS: { table: string; bucket: string; owner: string | null }[] = [
  { table: "products", bucket: "product-images", owner: "store_id" },
  { table: "stores", bucket: "store-images", owner: null },
  { table: "banners", bucket: "banners", owner: null },
];

async function main() {
  const db = new Client({ connectionString: cfg.DATABASE_URL }); await db.connect();
  for (const t of TARGETS) {
    let done = 0, failed = 0;
    for (;;) {
      const { rows } = await db.query(`select id, ${t.owner ?? "null as owner"}${t.owner ? " as owner" : ""}, image_url from ${t.table} where image_url like 'data:image/%' limit 200`);
      if (!rows.length) break;
      for (const r of rows) {
        try {
          const b64 = String(r.image_url).split(",")[1] ?? "";
          const buf = await sharp(Buffer.from(b64, "base64")).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
          const key = `${r.owner ?? "shared"}/${r.id}.webp`;
          await driver.put(t.bucket, key, buf, "image/webp");
          await db.query(`update ${t.table} set image_url = $1 where id = $2`, [driver.publicUrl(t.bucket, key), r.id]);
          done++;
        } catch (e) {
          failed++;
          await db.query(`update ${t.table} set image_url = null where id = $1`, [r.id]); // unreadable inline image: drop it rather than loop forever
          console.warn(`${t.table} ${r.id}: ${(e as Error).message}`);
        }
      }
      console.log(`${t.table}: ${done} migrated, ${failed} failed so far`);
    }
  }
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
