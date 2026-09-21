import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/** Whitelist: account_status, approved_*, phone, user_type, suspended_* are never client-writable (old guard_profile_protected_fields). */
export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  city: z.string().trim().max(80).nullable().optional(),
  district: z.string().trim().max(80).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  business_name: z.string().trim().max(120).nullable().optional(),
  business_category_id: z.string().uuid().nullable().optional(),
});
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}

export const locationSchema = z.object({
  label: z.string().trim().min(1).max(80),
  landmark_text: z.string().trim().min(1).max(300),
  phone: z.string().trim().max(20).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});
export class LocationDto extends createZodDto(locationSchema) {}

export const favoriteSchema = z.object({ target_type: z.enum(["store", "product"]), target_id: z.string().uuid() });
export class FavoriteDto extends createZodDto(favoriteSchema) {}

export const sessionOpenSchema = z.object({ user_agent: z.string().max(300).optional() });
export class SessionOpenDto extends createZodDto(sessionOpenSchema) {}
export const sessionCloseSchema = z.object({ close_type: z.enum(["pagehide", "logout", "timeout"]).optional(), beacon_token: z.string().optional() });
export class SessionCloseDto extends createZodDto(sessionCloseSchema) {}

export const deviceTokenSchema = z.object({ token: z.string().min(10).max(4096), platform: z.enum(["android", "ios", "web"]) });
export class DeviceTokenDto extends createZodDto(deviceTokenSchema) {}

export const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.string().datetime().optional() });
export class ListQueryDto extends createZodDto(listQuerySchema) {}
