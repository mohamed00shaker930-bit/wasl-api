import { defineConfig } from "drizzle-kit";

// Migrations are plain SQL files applied by src/db/migrate.ts (0000_baseline.sql comes from wasl-ops/db/build-baseline.sh).
// `drizzle-kit pull` regenerates src/db/schema/generated.ts from a database that has the migrations applied.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/pulled",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://wasl:wasl@127.0.0.1:55432/wasl_dev" },
  casing: "snake_case",
});
