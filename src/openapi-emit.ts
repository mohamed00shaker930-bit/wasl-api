// pnpm openapi:emit — writes openapi.json without starting the HTTP server (consumed by wasl-web and wasl-mobile codegen).
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { writeFileSync } from "node:fs";
import { AppModule } from "./app.module";
import { buildOpenApi } from "./main";

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  const doc = buildOpenApi(app);
  writeFileSync("openapi.json", JSON.stringify(doc, null, 2));
  console.log(`openapi.json: ${Object.keys(doc.paths).length} paths`);
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
