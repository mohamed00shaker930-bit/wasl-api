import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { CurrentUser, type Claims } from "@/common/auth";
import { WalletService } from "./wallet.service";

const topupSchema = z.object({
  amount: z.number().min(100).max(1_000_000),
  method: z.enum(["jeeb", "jawali", "hasab", "onecash", "cash"]),
  reference: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});
class TopupDto extends createZodDto(topupSchema) {}
class LimitDto extends createZodDto(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })) {}

@ApiTags("wallet") @ApiBearerAuth()
@Controller("me/wallet")
export class WalletController {
  constructor(private wallet: WalletService) {}
  @Get() summary(@CurrentUser() u: Claims) { return this.wallet.summary(u.sub); }
  @Get("transactions") transactions(@CurrentUser() u: Claims, @Query() q: LimitDto) { return this.wallet.transactions(u.sub, q.limit); }
  @Post("topups") topup(@CurrentUser() u: Claims, @Body() dto: TopupDto) { return this.wallet.requestTopup(u.sub, dto.amount, dto.method, dto.reference ?? null, dto.note ?? null); }
}
