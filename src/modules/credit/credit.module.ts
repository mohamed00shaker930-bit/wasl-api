import { Module } from "@nestjs/common";
import { CustomerCreditController, MerchantCreditController } from "./credit.controller";
import { CreditService } from "./credit.service";
@Module({ controllers: [CustomerCreditController, MerchantCreditController], providers: [CreditService], exports: [CreditService] })
export class CreditModule {}
