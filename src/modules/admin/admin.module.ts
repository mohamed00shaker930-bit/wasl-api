import { Module } from "@nestjs/common";
import { WalletModule } from "@/modules/wallet/wallet.module";
import { AdminController } from "./admin.controller";
import { AdminUsersService } from "./admin-users.service";
import { AdminPlatformService } from "./admin-platform.service";
import { AdminCatalogController } from "./admin-catalog.controller";
import { AdminCatalogService } from "./admin-catalog.service";
import { AdminKpisService } from "./admin-kpis.service";
@Module({ imports: [WalletModule], controllers: [AdminController, AdminCatalogController], providers: [AdminUsersService, AdminPlatformService, AdminCatalogService, AdminKpisService] })
export class AdminModule {}
