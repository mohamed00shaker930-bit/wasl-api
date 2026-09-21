import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const storesQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  q: z.string().trim().max(80).optional(),
  category_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export class StoresQueryDto extends createZodDto(storesQuerySchema) {}

export const productsQuerySchema = z.object({
  category_id: z.string().uuid().optional(),
  q: z.string().trim().max(80).optional(),
  barcode: z.string().trim().max(64).optional(),
  in_stock: z.coerce.boolean().optional(),
});
export class ProductsQueryDto extends createZodDto(productsQuerySchema) {}

export const catalogItemsQuerySchema = z.object({
  category_id: z.string().uuid().optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["name", "newest", "usage"]).default("name"),
});
export class CatalogItemsQueryDto extends createZodDto(catalogItemsQuerySchema) {}

export const barcodeQuerySchema = z.object({ barcode: z.string().trim().min(3).max(64), limit: z.coerce.number().int().min(1).max(50).default(20) });
export class BarcodeQueryDto extends createZodDto(barcodeQuerySchema) {}
