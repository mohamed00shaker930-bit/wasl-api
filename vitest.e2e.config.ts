import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import { resolve } from "node:path";

// End-to-end tests boot the real Nest app against TEST_DATABASE_URL (default: the wasl-ops embedded Postgres, database wasl_test).
// SWC keeps decorator metadata (esbuild does not), which NestJS DI needs.
export default defineConfig({
  plugins: [swc.vite({ jsc: { target: "es2022", transform: { legacyDecorator: true, decoratorMetadata: true } } })],
  test: { include: ["test/**/*.e2e.test.ts"], globals: true, testTimeout: 60_000, hookTimeout: 180_000, fileParallelism: false, setupFiles: ["test/setup-env.ts"] },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
