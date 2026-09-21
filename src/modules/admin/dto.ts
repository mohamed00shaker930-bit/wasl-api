import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { YEMENI_PHONE_RE } from "@/domain/phone";

const page = { limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) };
export class ListUsersDto extends createZodDto(z.object({
  kind: z.enum(["all", "customers", "merchants", "staff"]).default("all"),
  category_slug: z.string().max(80).optional(), role: z.string().max(40).optional(), search: z.string().trim().max(60).optional(),
  status: z.enum(["pending", "active", "rejected", "suspended", "deleted"]).optional(), ...page,
})) {}
export class CreateUserDto extends createZodDto(z.object({
  phone: z.string().regex(YEMENI_PHONE_RE, "invalid_phone"), password: z.string().min(6).max(72), name: z.string().trim().min(2).max(80),
  user_type: z.enum(["customer", "merchant"]), business_name: z.string().trim().max(120).optional(), business_category_id: z.string().uuid().optional(),
  city: z.string().trim().max(80).optional(), district: z.string().trim().max(80).optional(), address: z.string().trim().max(200).optional(),
}).superRefine((v, ctx) => { if (v.user_type === "merchant" && !v.business_name) ctx.addIssue({ code: "custom", path: ["business_name"], message: "business_required" }); })) {}
export class CreateStaffDto extends createZodDto(z.object({
  phone: z.string().regex(YEMENI_PHONE_RE, "invalid_phone"), password: z.string().min(6).max(72), name: z.string().trim().min(2).max(80),
  role: z.enum(["admin", "operations", "support", "finance"]).default("admin"), bundle: z.string().max(40).optional(),
})) {}
export class AccountStatusDto extends createZodDto(z.object({ status: z.enum(["active", "rejected", "suspended", "deleted"]), reason: z.string().trim().max(300).optional(), until: z.string().datetime().optional() })) {}
export class UserRoleDto extends createZodDto(z.object({ role: z.enum(["customer", "merchant", "super_admin", "admin", "operations", "support", "finance"]), grant: z.boolean() })) {}
export class AdminUpdateProfileDto extends createZodDto(z.object({ name: z.string().trim().min(2).max(80).optional(), city: z.string().max(80).nullable().optional(), district: z.string().max(80).nullable().optional(), address: z.string().max(200).nullable().optional(), business_name: z.string().max(120).nullable().optional() })) {}
export class DecideDto extends createZodDto(z.object({ approve: z.boolean(), reason: z.string().trim().max(300).optional() })) {}
export class DecideResetDto extends createZodDto(z.object({ approve: z.boolean(), temp_password: z.string().min(6).max(50).optional() })) {}
export class StoreStatusDto extends createZodDto(z.object({ status: z.enum(["pending", "active", "suspended", "rejected"]) })) {}
export class StoreCommissionDto extends createZodDto(z.object({ commission_pct: z.number().min(0).max(100) })) {}
export class StoreCategoryDto extends createZodDto(z.object({ business_category_id: z.string().uuid().nullable() })) {}
export class WalletRespondDto extends createZodDto(z.object({ approve: z.boolean() })) {}
export class WalletGrantDto extends createZodDto(z.object({ amount: z.number().positive().max(10_000_000), note: z.string().trim().max(300).optional() })) {}
export class SettingDto extends createZodDto(z.object({ value: z.unknown() })) {}
export class SendNotificationDto extends createZodDto(z.object({ user_id: z.string().uuid(), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), link: z.string().max(200).optional(), type: z.string().max(40).default("admin") })) {}
export class BroadcastDto extends createZodDto(z.object({ segment: z.enum(["all", "customers", "merchants"]), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), link: z.string().max(200).optional() })) {}
export class StatusFilterDto extends createZodDto(z.object({ status: z.string().max(20).optional(), ...page })) {}
export class OrdersFilterDto extends createZodDto(z.object({ status: z.string().max(20).optional(), store_id: z.string().uuid().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(5000).default(100) })) {}
