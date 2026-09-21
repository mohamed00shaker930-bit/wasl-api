import { z } from "zod";

export const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.string().default("30d"),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  CORS_ORIGINS: z.string().default(""),
  STORAGE_DRIVER: z.enum(["minio", "disk"]).default("disk"),
  DISK_STORAGE_ROOT: z.string().default("./.files"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_PUBLIC_BASE_URL: z.string().default("http://localhost:3000/api/files"),
  SEED_SUPER_ADMIN_PHONE: z.string().optional(),
  SEED_SUPER_ADMIN_PASSWORD: z.string().optional(),
});
export type AppConfig = z.infer<typeof configSchema>;

export function validateConfig(raw: Record<string, unknown>): AppConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid environment: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
