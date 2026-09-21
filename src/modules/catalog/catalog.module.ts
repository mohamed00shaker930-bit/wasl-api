import { Module } from "@nestjs/common";
import { CatalogController, PublicController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({ controllers: [PublicController, CatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
