import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { validateConfig, type AppConfig } from "./config.schema";

export const APP_CONFIG = Symbol("APP_CONFIG");

/** NestConfigModule loads .env into process.env and validates; APP_CONFIG exposes the typed, validated object. */
@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, validate: validateConfig })],
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => validateConfig(process.env as Record<string, unknown>) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
