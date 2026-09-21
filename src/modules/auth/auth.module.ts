import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { ClaimsService } from "./claims.service";
import { TokensService } from "./tokens.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, ClaimsService, TokensService],
  exports: [AuthService, ClaimsService, TokensService, JwtModule],
})
export class AuthModule {}
