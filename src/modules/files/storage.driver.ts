import { Inject, Injectable, Logger } from "@nestjs/common";
import { mkdirSync, promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PutObjectCommand, DeleteObjectCommand, S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { APP_CONFIG } from "@/config/config.module";
import type { AppConfig } from "@/config/config.schema";

export interface StorageDriver {
  put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  remove(bucket: string, key: string): Promise<void>;
  list(bucket: string, prefix: string): Promise<string[]>;
  publicUrl(bucket: string, key: string): string;
}

/** Local filesystem (dev, or single-server prod behind Caddy `/files/*`). Layout: <root>/<bucket>/<key>. */
export class DiskDriver implements StorageDriver {
  constructor(private root: string, private publicBase: string) { mkdirSync(root, { recursive: true }); }
  private path(bucket: string, key: string) {
    const p = resolve(this.root, bucket, key);
    if (!p.startsWith(resolve(this.root))) throw new Error("path traversal");
    return p;
  }
  async put(bucket: string, key: string, body: Buffer) { const p = this.path(bucket, key); await fs.mkdir(dirname(p), { recursive: true }); await fs.writeFile(p, body); }
  async remove(bucket: string, key: string) { await fs.rm(this.path(bucket, key), { force: true }); }
  async list(bucket: string, prefix: string) {
    const base = this.path(bucket, prefix);
    const out: string[] = [];
    const walk = async (dir: string) => { for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) { const p = join(dir, e.name); if (e.isDirectory()) await walk(p); else out.push(p.slice(resolve(this.root, bucket).length + 1)); } };
    await walk(base);
    return out;
  }
  publicUrl(bucket: string, key: string) { return `${this.publicBase}/${bucket}/${key}`; }
}

/** MinIO / any S3-compatible store; buckets are public-read so URLs are plain. */
export class MinioDriver implements StorageDriver {
  private s3: S3Client;
  constructor(cfg: AppConfig, private publicBase: string) {
    this.s3 = new S3Client({ endpoint: cfg.S3_ENDPOINT, region: cfg.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: cfg.S3_ACCESS_KEY!, secretAccessKey: cfg.S3_SECRET_KEY! } });
  }
  async put(bucket: string, key: string, body: Buffer, contentType: string) { await this.s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })); }
  async remove(bucket: string, key: string) { await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }
  async list(bucket: string, prefix: string) {
    const out: string[] = []; let token: string | undefined;
    do { const r = await this.s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })); out.push(...(r.Contents ?? []).map((c) => c.Key!)); token = r.NextContinuationToken; } while (token);
    return out;
  }
  publicUrl(bucket: string, key: string) { return `${this.publicBase}/${bucket}/${key}`; }
}

export const STORAGE = Symbol("STORAGE");
@Injectable()
export class StorageFactory {
  private readonly log = new Logger("Storage");
  constructor(@Inject(APP_CONFIG) private cfg: AppConfig) {}
  create(): StorageDriver {
    if (this.cfg.STORAGE_DRIVER === "minio") { this.log.log(`MinIO at ${this.cfg.S3_ENDPOINT}`); return new MinioDriver(this.cfg, this.cfg.S3_PUBLIC_BASE_URL); }
    this.log.log(`disk storage at ${resolve(this.cfg.DISK_STORAGE_ROOT)}`);
    return new DiskDriver(this.cfg.DISK_STORAGE_ROOT, this.cfg.S3_PUBLIC_BASE_URL);
  }
}
