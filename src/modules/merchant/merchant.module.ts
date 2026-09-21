import { Module } from "@nestjs/common";
import { CreditModule } from "@/modules/credit/credit.module";
import { MerchantController } from "./merchant.controller";
import { MerchantService } from "./merchant.service";
@Module({ imports: [CreditModule], controllers: [MerchantController], providers: [MerchantService], exports: [MerchantService] })
export class MerchantModule {}
