import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { APP_CONFIG } from "./config/config.module";
import type { AppConfig } from "./config/config.schema";

export function buildOpenApi(app: NestExpressApplication) {
  const doc = new DocumentBuilder().setTitle("Wasl API").setVersion("1").addBearerAuth().build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, doc));
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const cfg = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix("api");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.set("trust proxy", 1); // Caddy in front
  const origins = cfg.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins, credentials: true, exposedHeaders: ["Content-Disposition"] });
  SwaggerModule.setup("api/docs", app, buildOpenApi(app));
  app.enableShutdownHooks();
  await app.listen(cfg.PORT);
  new Logger("bootstrap").log(`wasl-api listening on :${cfg.PORT} (${cfg.NODE_ENV}); docs at /api/docs`);
}
if (require.main === module) bootstrap();
