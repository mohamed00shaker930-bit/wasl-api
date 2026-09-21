import { Module } from "@nestjs/common";
import { CatalogModule } from "@/modules/catalog/catalog.module";
import { WalletModule } from "@/modules/wallet/wallet.module";
import { CreditModule } from "@/modules/credit/credit.module";
import { CustomerOrdersController, MerchantOrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
@Module({ imports: [CatalogModule, WalletModule, CreditModule], controllers: [CustomerOrdersController, MerchantOrdersController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
