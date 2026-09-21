import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { AppError } from "@/common/errors/app-error";
import { STORAGE, type StorageDriver } from "./storage.driver";

export const BUCKETS = { productsLibrary: "products-library", customRequests: "custom-requests", productImages: "product-images", storeImages: "store-images", banners: "banners" } as const;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
export const MAX_UPLOAD = 5 * 1024 * 1024;

@Injectable()
export class FilesService {
  constructor(@Inject(STORAGE) private storage: StorageDriver) {}

  /** Stores an image as WebP (max 1024 px on the long edge, like the old admin library did at 800 px) and returns its public URL. */
  async storeImage(bucket: string, prefix: string, file: { buffer: Buffer; mimetype: string; size: number }, maxPx = 1024) {
    if (!IMAGE_TYPES.has(file.mimetype)) throw new AppError("unsupported_file", { mimetype: file.mimetype });
    if (file.size > MAX_UPLOAD) throw new AppError("file_too_large", { max: MAX_UPLOAD });
    const out = await sharp(file.buffer).rotate().resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const key = `${prefix}/${randomUUID()}.webp`;
    await this.storage.put(bucket, key, out, "image/webp");
    return { bucket, key, url: this.storage.publicUrl(bucket, key), bytes: out.length };
  }
  /** Raw file (used by the base64→object migration script, which already has bytes + type). */
  async storeRaw(bucket: string, key: string, body: Buffer, contentType: string) {
    await this.storage.put(bucket, key, body, contentType);
    return this.storage.publicUrl(bucket, key);
  }
  remove(bucket: string, key: string) { return this.storage.remove(bucket, key); }
  list(bucket: string, prefix: string) { return this.storage.list(bucket, prefix); }
  url(bucket: string, key: string) { return this.storage.publicUrl(bucket, key); }
}
