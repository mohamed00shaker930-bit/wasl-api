import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const checkoutSchema = z.object({
  store_id: z.string().uuid(),
  items: z.array(z.object({ product_id: z.string().uuid(), qty: z.number().int().min(1).max(999), note: z.string().trim().max(200).optional() })).min(1).max(100),
  payment_method: z.enum(["cash", "credit", "wallet", "jeeb", "jawali", "hasab", "onecash"]),
  location: z.object({
    landmark: z.string().trim().min(1).max(300),
    phone: z.string().trim().max(20).optional(),
    label: z.string().trim().max(80).optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  }),
  note: z.string().trim().max(500).optional(),
  wallet_ref: z.string().trim().max(80).optional(),
});
export class CheckoutDto extends createZodDto(checkoutSchema) {}

export class OrdersQueryDto extends createZodDto(z.object({
  status: z.enum(["sent", "accepted", "preparing", "out_for_delivery", "delivered", "declined", "cancelled"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  channel: z.enum(["online", "in_store"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})) {}

export class StatusDto extends createZodDto(z.object({ status: z.enum(["accepted", "preparing", "out_for_delivery", "delivered", "declined"]) })) {}
export class ReturnDto extends createZodDto(z.object({ reason: z.string().trim().min(1).max(500) })) {}
export class RatingDto extends createZodDto(z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() })) {}
export class DecisionDto extends createZodDto(z.object({ approve: z.boolean() })) {}
