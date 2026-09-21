import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { ZodValidationPipe } from "nestjs-zod";
import { ConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { AppExceptionFilter } from "./common/errors/http-exception.filter";
import { ForcePasswordChangeGuard, JwtAuthGuard, RolesPermsGuard } from "./common/auth";
import { AuthModule } from "./modules/auth/auth.module";
import { MeModule } from "./modules/me/me.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { CreditModule } from "./modules/credit/credit.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { MerchantModule } from "./modules/merchant/merchant.module";
import { EventsModule } from "./modules/events/events.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AuditModule } from "./common/audit/audit.module";
import { FilesModule } from "./modules/files/files.module";
import { CustomRequestsModule } from "./modules/custom-requests/custom-requests.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule,
    DbModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
    AuthModule,
    MeModule,
    CatalogModule,
    WalletModule,
    CreditModule,
    OrdersModule,
    MerchantModule,
    EventsModule,
    AdminModule,
    AuditModule,
    FilesModule,
    CustomRequestsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    // order matters: throttle -> authenticate -> force-password-change -> roles/perms
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ForcePasswordChangeGuard },
    { provide: APP_GUARD, useClass: RolesPermsGuard },
  ],
})
export class AppModule {}
