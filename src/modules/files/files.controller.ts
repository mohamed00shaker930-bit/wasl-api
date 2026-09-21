import { Controller, Get, Inject, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { resolve } from "node:path";
import { CurrentUser, Perms, Public, Roles, requireStore, type Claims } from "@/common/auth";
import { APP_CONFIG } from "@/config/config.module";
import type { AppConfig } from "@/config/config.schema";
import { DbService } from "@/db/db.module";
import { products, stores } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { AppError } from "@/common/errors/app-error";
import { BUCKETS, FilesService, MAX_UPLOAD } from "./files.service";

type Upload = { buffer: Buffer; mimetype: string; size: number; originalname: string };
const upload = () => FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } });

@ApiTags("files") @ApiBearerAuth()
@Controller()
export class FilesController {
  constructor(private files: FilesService, private dbs: DbService, @Inject(APP_CONFIG) private cfg: AppConfig) {}

  /** Photo attached to a custom product request (bucket custom-requests). */
  @Post("files/custom-requests") @UseInterceptors(upload()) @ApiConsumes("multipart/form-data") @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } })
  customRequest(@CurrentUser() u: Claims, @UploadedFile() file: Upload) { return this.files.storeImage(BUCKETS.customRequests, u.sub, file, 1024); }

  /** Replaces the base64 data URL that merchant.products.tsx wrote into products.image_url. */
  @Post("merchant/products/:id/image") @Roles("merchant") @UseInterceptors(upload()) @ApiConsumes("multipart/form-data")
  async productImage(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Upload) {
    const storeId = requireStore(u);
    const [p] = await this.dbs.db.select({ id: products.id }).from(products).where(and(eq(products.id, id), eq(products.storeId, storeId))).limit(1);
    if (!p) throw new AppError("not_found");
    const stored = await this.files.storeImage(BUCKETS.productImages, storeId, file, 800);
    await this.dbs.db.update(products).set({ imageUrl: stored.url }).where(eq(products.id, id));
    return stored;
  }
  @Post("merchant/store/image") @Roles("merchant") @UseInterceptors(upload()) @ApiConsumes("multipart/form-data")
  async storeImage(@CurrentUser() u: Claims, @UploadedFile() file: Upload) {
    const storeId = requireStore(u);
    const stored = await this.files.storeImage(BUCKETS.storeImages, storeId, file, 1024);
    await this.dbs.db.update(stores).set({ imageUrl: stored.url }).where(eq(stores.id, storeId));
    return stored;
  }
  /** Admin library / banner images (bucket products-library, as before). */
  @Post("admin/catalog/images") @Perms("library.manage") @UseInterceptors(upload()) @ApiConsumes("multipart/form-data")
  catalogImage(@UploadedFile() file: Upload) { return this.files.storeImage(BUCKETS.productsLibrary, "items", file, 800); }
  @Post("admin/banners/images") @Perms("content.manage") @UseInterceptors(upload()) @ApiConsumes("multipart/form-data")
  bannerImage(@UploadedFile() file: Upload) { return this.files.storeImage(BUCKETS.banners, "banners", file, 1600); }

  /** Only with STORAGE_DRIVER=disk: serves stored files. With MinIO, Caddy proxies /files/* to the bucket instead. */
  @Public() @Get("files/:bucket/*path")
  serve(@Param("bucket") bucket: string, @Param("path") path: string | string[], @Res() res: Response) {
    if (this.cfg.STORAGE_DRIVER !== "disk") throw new AppError("not_found");
    const rel = Array.isArray(path) ? path.join("/") : path;
    const root = resolve(this.cfg.DISK_STORAGE_ROOT);
    const bucketRoot = resolve(root, bucket);
    if (!bucketRoot.startsWith(root) || !resolve(bucketRoot, rel).startsWith(bucketRoot)) throw new AppError("not_found");
    // `root` option: the storage root may itself be a dot-directory (./.files), which `send` would otherwise refuse
    res.sendFile(rel, { root: bucketRoot, maxAge: "365d", immutable: true, dotfiles: "deny" }, (err) => { if (err) res.status(404).json({ error: "not_found" }); });
  }
}
