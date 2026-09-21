import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/** Whitelist (old guard_store_protected_fields): status, commission_pct, owner_id, rating* are admin-only. */
export class UpdateStoreDto extends createZodDto(z.object({
  name: z.string().trim().min(2).max(120).optional(),
  area: z.string().trim().max(120).nullable().optional(),
  delivery_info: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  image_url: z.string().url().max(500).nullable().optional(),
  is_open: z.boolean().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  business_category_id: z.string().uuid().nullable().optional(),
})) {}

const productBase = {
  name: z.string().trim().min(1).max(160),
  price: z.number().min(0).max(10_000_000),
  category_id: z.string().uuid().nullable().optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
  in_stock: z.boolean().optional(),
  image_url: z.string().max(500).nullable().optional().refine((v) => !v || !v.startsWith("data:"), "image_url must be a stored file URL, not a data: URL"),
  lib_category: z.string().trim().max(120).nullable().optional(),
  main_section: z.string().trim().max(120).nullable().optional(),
  subcategory: z.string().trim().max(120).nullable().optional(),
};
export class CreateProductDto extends createZodDto(z.object(productBase)) {}
export class UpdateProductDto extends createZodDto(z.object(productBase).partial()) {}
export class CategoryDto extends createZodDto(z.object({ name: z.string().trim().min(1).max(80), sort_order: z.number().int().min(0).optional() })) {}
const offerSchema = z.object({
  product_id: z.string().uuid(), discount_price: z.number().min(0),
  starts_at: z.string().datetime().nullable().optional(), ends_at: z.string().datetime().nullable().optional(),
  max_qty: z.number().int().min(1).nullable().optional(), active: z.boolean().optional(),
});
export class OfferDto extends createZodDto(offerSchema) {}
export class OfferPatchDto extends createZodDto(offerSchema.partial()) {}
export class ImportFromCatalogDto extends createZodDto(z.object({ catalog_item_ids: z.array(z.string().uuid()).min(1).max(500) })) {}
export class PendingCustomerDto extends createZodDto(z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().min(6).max(20) })) {}
export class QuoteDto extends createZodDto(z.object({ price: z.number().min(0), note: z.string().trim().max(300).nullable().optional() })) {}
export class RangeDto extends createZodDto(z.object({ from: z.string().datetime(), to: z.string().datetime() })) {}
export class SnapshotDto extends createZodDto(z.object({ since: z.string().datetime().optional() })) {}

/** POS outbox envelope, unchanged from pos-outbox.ts so web and Flutter clients can send it verbatim. */
export const posSaleSchema = z.object({
  op_id: z.string().uuid(),
  order: z.object({
    id: z.string().uuid(),
    customer_id: z.string().uuid().nullable().optional(),
    payment_method: z.enum(["cash", "credit", "wallet", "jeeb", "jawali", "hasab", "onecash"]),
    note: z.string().max(500).nullable().optional(),
    created_at: z.string().datetime(),
    total: z.number().optional(),
  }),
  items: z.array(z.object({ id: z.string().uuid().optional(), product_id: z.string().uuid().nullable(), name: z.string().max(160), price: z.number().min(0), qty: z.number().int().min(1), note: z.string().max(200).nullable().optional() })).min(1).max(200),
  credit: z.object({ customerKind: z.enum(["registered", "pending"]), customerId: z.string().uuid(), txId: z.string().uuid(), amount: z.number().positive(), note: z.string().max(300).nullable().optional() }).nullable().optional(),
});
export class PosSaleDto extends createZodDto(posSaleSchema) {}
export class PosProductDto extends createZodDto(z.object({ op_id: z.string().uuid().optional(), id: z.string().uuid(), ...productBase })) {}
