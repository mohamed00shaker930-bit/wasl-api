import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { YEMENI_PHONE_RE } from "@/domain/phone";

const phone = z.string().regex(YEMENI_PHONE_RE, "invalid_phone");
const password = z.string().min(6).max(72);

export const registerSchema = z.object({
  phone,
  password,
  name: z.string().trim().min(2).max(80),
  user_type: z.enum(["customer", "merchant"]),
  city: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  address: z.string().trim().max(200).optional(),
  business_name: z.string().trim().max(120).optional(),
  business_category_id: z.string().uuid().optional(),
}).superRefine((v, ctx) => {
  if (v.user_type === "merchant" && !v.business_name) ctx.addIssue({ code: "custom", path: ["business_name"], message: "business_required" });
});
export class RegisterDto extends createZodDto(registerSchema) {}

export const loginSchema = z.object({ phone, password: z.string().min(1).max(72) });
export class LoginDto extends createZodDto(loginSchema) {}

export const refreshSchema = z.object({ refresh_token: z.string().min(20).optional() });
export class RefreshDto extends createZodDto(refreshSchema) {}

export const changePasswordSchema = z.object({ current_password: z.string().max(72).optional(), new_password: password });
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}

export const passwordResetRequestSchema = z.object({ phone, reason: z.string().trim().max(500).optional() });
export class PasswordResetRequestDto extends createZodDto(passwordResetRequestSchema) {}
